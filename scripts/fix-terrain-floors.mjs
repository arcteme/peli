/**
 * fix-terrain-floors.mjs  v5
 *
 * Post-processor for kerava-terrain.bin.
 * Run AFTER scripts/extract-terrain.py (which writes the LiDAR baseline).
 *
 * This version uses a direct world-space grid mapping (matching terrainHeightAt
 * in CityMap.ts) and the 551×551 / 2 m grid from extract-terrain.py.
 *
 * Grid mapping (identical to CityMap.terrainHeightAt):
 *   col = (wx + 550) / 2
 *   row = (wz + 550) / 2
 *   wx  = -550 + col * 2
 *   wz  = -550 + row * 2
 *
 * Strategy:
 *
 *   For each building, convert its world-space footprint to terrain grid space
 *   and stamp terrain heights to match.
 *
 *   Zone A  (dist < INNER_DIST from building AABB):
 *     Set terrain = IDW-interpolated floor height from floorCorners.
 *     Bidirectional (raises AND lowers), so buildings neither float nor sink.
 *
 *   Zone B  (INNER_DIST <= dist < GRAD_DIST):
 *     Smoothstep blend from floor height → original LiDAR terrain.
 *
 *   Blur — box-blur passes over dirty region + 1-cell border.
 *
 *   Re-enforce — re-stamp Zone A after blur; apply gradient as floor (minimum).
 *
 * Usage:
 *   python scripts/extract-terrain.py   (generate LiDAR baseline first)
 *   node scripts/fix-terrain-floors.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

// ── Constants ─────────────────────────────────────────────────────────────────

const TERRAIN_HALF = 550;
const TERRAIN_SEGS = 550;
const COLS         = TERRAIN_SEGS + 1;                  // 551
const ROWS         = TERRAIN_SEGS + 1;                  // 551
const CELL_SIZE    = (TERRAIN_HALF * 2) / TERRAIN_SEGS; // 2 m (matches LiDAR resolution)

// Zone A: 1.5 cells (3 m) — stamps the DTM exactly at building footprint + thin margin
// Bidirectional so buildings neither float nor sink vs. the real ground DTM.
const INNER_DIST = CELL_SIZE * 1.5;                     // 3 m

// Gradient zone: 8 cells (16 m blend) — tight enough to avoid berms between buildings
const GRAD_CELLS = 8;
const GRAD_DIST  = INNER_DIST + GRAD_CELLS * CELL_SIZE; //  3 + 16 = 19 m

const BLUR_PASSES = 2;

// Grid ↔ world mapping mirrors CityMap.terrainHeightAt exactly (no mesh offsets):
//   col = (wx + TERRAIN_HALF) / CELL_SIZE
//   row = (wz + TERRAIN_HALF) / CELL_SIZE
// The aerial texture mesh has visual calibration offsets (position/rotation/scale)
// that only affect the photo overlay — terrainHeightAt and this script both use
// the raw world-aligned grid.

// ── Load ──────────────────────────────────────────────────────────────────────

const terrainPath = resolve(ROOT, 'public/kerava-terrain.bin');
const metaPath    = resolve(ROOT, 'data/kerava-meta-full.json');

console.log('[fix-terrain] Reading kerava-terrain.bin ...');
const terrainBuf = readFileSync(terrainPath);
const hdr = new Uint32Array(terrainBuf.buffer, terrainBuf.byteOffset, 2);
if (hdr[0] !== COLS || hdr[1] !== ROWS)
  throw new Error(`Dimension mismatch: expected ${COLS}×${ROWS}, got ${hdr[0]}×${hdr[1]}`);

const heights = new Float32Array(
  terrainBuf.buffer.slice(terrainBuf.byteOffset + 8,
                          terrainBuf.byteOffset + 8 + COLS * ROWS * 4));

// Snapshot original IDW terrain — gradient blends back to this
const original = heights.slice();

console.log('[fix-terrain] Reading kerava-meta-full.json ...');
const meta      = JSON.parse(readFileSync(metaPath, 'utf8'));
const buildings = meta.buildings;
console.log(`[fix-terrain] ${buildings.length} buildings to process`);

// ── Transform helpers ─────────────────────────────────────────────────────────

/**
 * Convert world (wx, wz) → terrain grid (col, row).
 * Mirrors CityMap.terrainHeightAt — direct world-aligned mapping, no mesh offsets.
 */
function worldToGrid(wx, wz) {
  return [
    (wx + TERRAIN_HALF) / CELL_SIZE,
    (wz + TERRAIN_HALF) / CELL_SIZE,
  ];
}

/**
 * Convert terrain grid (col, row) → world (wx, wz).
 */
function gridToWorld(col, row) {
  return [
    -TERRAIN_HALF + col * CELL_SIZE,
    -TERRAIN_HALF + row * CELL_SIZE,
  ];
}

// ── General helpers ───────────────────────────────────────────────────────────

const clamp      = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp       = (a, b, t)   => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Nearest distance from point (px, pz) to AABB [x0,x1]×[z0,z1]; 0 if inside. */
function distToAABB(px, pz, x0, x1, z0, z1) {
  const dx = Math.max(x0 - px, 0, px - x1);
  const dz = Math.max(z0 - pz, 0, pz - z1);
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * IDW-interpolated floor height from a building's floorCorners at world (wx, wz).
 * Closer corners contribute more weight, so sloped buildings get correct terrain.
 */
function interpolateFloorHeight(corners, wx, wz) {
  if (corners.length === 1) return corners[0][1];

  let weightSum = 0, valueSum = 0;
  for (const [cx, cy, cz] of corners) {
    const d2 = (wx - cx) ** 2 + (wz - cz) ** 2;
    const w  = 1 / (d2 + 1); // +1 m² prevents singularity at exact corner position
    weightSum += w;
    valueSum  += w * cy;
  }
  return weightSum > 0 ? valueSum / weightSum : corners[0][1];
}

// ── Pass 1: build per-cell maps ───────────────────────────────────────────────
//
// For every grid cell near a building, record the closest building's
// interpolated floor height. "Closest building" (by AABB distance) wins
// for both Zone A and Zone B — this correctly handles adjacent buildings
// at different elevations.

const gradFloor = new Float32Array(COLS * ROWS).fill(0);
const gradDist  = new Float32Array(COLS * ROWS).fill(Infinity);

let validBuildings      = 0;
let totalFloorCorners   = 0;
let buildingsWithGround = 0;

for (const bld of buildings) {
  const { minX, maxX, minY, minZ, maxZ } = bld.box;
  const corners = bld.floorCorners;
  if (!isFinite(minX) || !isFinite(minY)) continue;
  if (!corners || corners.length === 0) continue;
  validBuildings++;
  totalFloorCorners += corners.length;
  // Heuristic: if more than 4 corners, it likely has real GroundSurface data
  if (corners.length > 4) buildingsWithGround++;

  // Compute grid bounding box: transform AABB corners to grid, then pad
  const gridCorners = [
    worldToGrid(minX, minZ), worldToGrid(minX, maxZ),
    worldToGrid(maxX, minZ), worldToGrid(maxX, maxZ),
  ];

  const pad = Math.ceil(GRAD_DIST / CELL_SIZE) + 2;
  let colLo = Infinity, colHi = -Infinity;
  let rowLo = Infinity, rowHi = -Infinity;
  for (const [gc, gr] of gridCorners) {
    if (gc < colLo) colLo = gc;
    if (gc > colHi) colHi = gc;
    if (gr < rowLo) rowLo = gr;
    if (gr > rowHi) rowHi = gr;
  }
  colLo = clamp(Math.floor(colLo) - pad, 0, COLS - 1);
  colHi = clamp(Math.ceil(colHi)  + pad, 0, COLS - 1);
  rowLo = clamp(Math.floor(rowLo) - pad, 0, ROWS - 1);
  rowHi = clamp(Math.ceil(rowHi)  + pad, 0, ROWS - 1);

  for (let row = rowLo; row <= rowHi; row++) {
    for (let col = colLo; col <= colHi; col++) {
      const [wx, wz] = gridToWorld(col, row);
      const dist = distToAABB(wx, wz, minX, maxX, minZ, maxZ);
      if (dist >= GRAD_DIST) continue;

      const idx = row * COLS + col;

      // Closest building wins — prevents bleed between adjacent buildings
      if (dist < gradDist[idx]) {
        gradDist[idx]  = dist;
        gradFloor[idx] = interpolateFloorHeight(corners, wx, wz);
      }
    }
  }
}

console.log(`[fix-terrain] Valid buildings: ${validBuildings} (${buildingsWithGround} with GroundSurface data)`);
console.log(`[fix-terrain] Total floor corners: ${totalFloorCorners}`);

// ── Pass 2: apply zones ──────────────────────────────────────────────────────

const dirty = new Uint8Array(COLS * ROWS);
let statsA = 0, statsBC = 0;

for (let idx = 0; idx < COLS * ROWS; idx++) {
  const dist = gradDist[idx];
  if (dist === Infinity) continue;

  if (dist < INNER_DIST) {
    // Zone A: exact floor, bidirectional (raises AND lowers)
    // This ensures buildings neither float above terrain nor sink below it
    heights[idx] = gradFloor[idx];
    dirty[idx]   = 1;
    statsA++;
  } else {
    // Zone B/C: smoothstep blend from floor height → original IDW terrain
    const t      = smoothstep(INNER_DIST, GRAD_DIST, dist);
    const target = lerp(gradFloor[idx], original[idx], t);
    heights[idx] = target;
    dirty[idx]   = 1;
    statsBC++;
  }
}

// ── Expand dirty mask by one cell for blur border ─────────────────────────────

const dirtyBlur = dirty.slice();
for (let row = 1; row < ROWS - 1; row++)
  for (let col = 1; col < COLS - 1; col++)
    if (dirty[row * COLS + col])
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          dirtyBlur[(row + dr) * COLS + (col + dc)] = 1;

// ── Blur ──────────────────────────────────────────────────────────────────────

for (let pass = 0; pass < BLUR_PASSES; pass++) {
  const snap = heights.slice();
  for (let row = 1; row < ROWS - 1; row++) {
    for (let col = 1; col < COLS - 1; col++) {
      if (!dirtyBlur[row * COLS + col]) continue;
      let sum = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          sum += snap[(row + dr) * COLS + (col + dc)];
      heights[row * COLS + col] = sum / 9;
    }
  }
}

// ── Re-enforce after blur ─────────────────────────────────────────────────────
//
//   Zone A  — exact bidirectional stamp (prevents blur from creating gaps)
//   Zone B  — gradient as FLOOR (raise-only) so blur can't drag below the
//             blend line near buildings

let reEnforcedA = 0, reEnforcedGrad = 0;
for (let idx = 0; idx < COLS * ROWS; idx++) {
  const dist = gradDist[idx];
  if (dist === Infinity) continue;

  if (dist < INNER_DIST) {
    // Zone A: exact floor (bidirectional)
    const target = gradFloor[idx];
    if (heights[idx] !== target) { heights[idx] = target; reEnforcedA++; }
  } else {
    // Gradient zone: re-apply as minimum (raise-only after blur)
    const t      = smoothstep(INNER_DIST, GRAD_DIST, dist);
    const target = lerp(gradFloor[idx], original[idx], t);
    if (heights[idx] < target) { heights[idx] = target; reEnforcedGrad++; }
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

const totalDirty = dirtyBlur.reduce((s, v) => s + v, 0);
const out = Buffer.alloc(8 + COLS * ROWS * 4);
new Uint32Array(out.buffer, out.byteOffset, 2).set([COLS, ROWS]);
new Float32Array(out.buffer, out.byteOffset + 8, COLS * ROWS).set(heights);
writeFileSync(terrainPath, out);

console.log('[fix-terrain] Done.');
console.log(`  Zone A cells stamped (exact floor):  ${statsA}`);
console.log(`  Zone B/C cells stamped (gradient):   ${statsBC}`);
console.log(`  Re-enforced Zone A (exact):          ${reEnforcedA}`);
console.log(`  Re-enforced gradient (floor):        ${reEnforcedGrad}`);
console.log(`  Total blurred cells:                 ${totalDirty}`);
console.log(`  Written: ${terrainPath}`);
