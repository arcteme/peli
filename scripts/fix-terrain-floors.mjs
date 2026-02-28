/**
 * fix-terrain-floors.mjs  v4
 *
 * Post-processor for kerava-terrain.bin.
 * Run via `npm run fix-terrain` which FIRST regenerates a fresh IDW baseline
 * with `preprocess-gml`, then applies this script — no contamination possible.
 *
 * This version correctly accounts for the runtime terrain mesh offset & rotation
 * (position.x=34, position.z=-78, rotation.z=-0.069813) applied in CityMap.ts,
 * and uses per-building floorCorners extracted from CityGML GroundSurface data.
 *
 * The terrain mesh transform at runtime:
 *   M = Rx(-π/2) · Rz(-0.069813)
 *   world = meshPosition + M · local
 *
 * Without accounting for this, stamped heights land ~3 columns and ~7 rows off
 * from the intended building positions, causing buildings to float or sink.
 *
 * Strategy:
 *
 *   For each building, convert its world-space footprint to terrain grid space
 *   using the inverse mesh transform, then stamp terrain heights to match.
 *
 *   Zone A  (dist < INNER_DIST from building AABB):
 *     Set terrain = IDW-interpolated floor height from floorCorners.
 *     Bidirectional (raises AND lowers), so buildings neither float nor sink.
 *
 *   Zone B  (INNER_DIST <= dist < GRAD_DIST):
 *     Smoothstep blend from floor height → original IDW terrain.
 *
 *   Blur — box-blur passes over dirty region + 1-cell border.
 *
 *   Re-enforce — re-stamp Zone A after blur; apply gradient as floor (minimum).
 *
 * Usage:
 *   npm run fix-terrain          (chains preprocess-gml automatically)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

// ── Constants ─────────────────────────────────────────────────────────────────

const TERRAIN_HALF = 550;
const TERRAIN_SEGS = 100;
const COLS         = TERRAIN_SEGS + 1;                  // 101
const ROWS         = TERRAIN_SEGS + 1;                  // 101
const CELL_SIZE    = (TERRAIN_HALF * 2) / TERRAIN_SEGS; // 11 m

// Zone A: full cell expansion — catches sub-cell and thin buildings
const INNER_DIST = CELL_SIZE * 1.0;                     // 11 m

// Gradient zone: 6 cells out from INNER_DIST boundary
const GRAD_CELLS = 6;
const GRAD_DIST  = INNER_DIST + GRAD_CELLS * CELL_SIZE; // 11 + 66 = 77 m

const BLUR_PASSES = 12;

// ── Terrain mesh runtime transform (from CityMap.ts _createGround) ────────────
//
// The aerial mesh has these calibration offsets so the aerial photo texture aligns
// with the building geometry:
//   mesh.position.x = 34.0
//   mesh.position.z = -78.0
//   mesh.rotation.z = -0.069813  (≈ -4°)
//
// Combined with rotation.x = -π/2 (plane flip), the full rotation matrix is:
//   M = Rx(-π/2) · Rz(-0.069813)
//
// For a grid vertex with local coords (lx, ly, lz):
//   world_x = 34  + cos(α)·lx + sin(α)·ly
//   world_y =       lz                        (= stored height value)
//   world_z = -78 + sin(α)·lx - cos(α)·ly
//
// where α = 0.069813 (the positive angle; Rz uses -α).

const OFFSET_X  = 34.0;
const OFFSET_Z  = -78.0;
const ROT_ANGLE = 0.069813;

const COS_A = Math.cos(ROT_ANGLE); // ≈ 0.99756
const SIN_A = Math.sin(ROT_ANGLE); // ≈ 0.06976

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
 * Convert world (wx, wz) → terrain grid (col, row) using the inverse mesh transform.
 *
 * Derivation:
 *   local = M^T · (world − position)     (M is orthogonal so M⁻¹ = M^T)
 *   lx = cos(α)·(wx − 34) + sin(α)·(wz + 78)
 *   ly = sin(α)·(wx − 34) − cos(α)·(wz + 78)
 *   col = (lx + 550) / 11
 *   row = (550 − ly) / 11
 */
function worldToGrid(wx, wz) {
  const dx = wx - OFFSET_X;
  const dz = wz - OFFSET_Z; // = wz + 78
  const lx =  COS_A * dx + SIN_A * dz;
  const ly =  SIN_A * dx - COS_A * dz;
  return [(lx + TERRAIN_HALF) / CELL_SIZE, (TERRAIN_HALF - ly) / CELL_SIZE];
}

/**
 * Convert grid (col, row) → world (wx, wz) using the forward mesh transform.
 *
 *   lx = −550 + col · 11
 *   ly =  550 − row · 11
 *   wx = 34  + cos(α)·lx + sin(α)·ly
 *   wz = −78 + sin(α)·lx − cos(α)·ly
 */
function gridToWorld(col, row) {
  const lx = -TERRAIN_HALF + col * CELL_SIZE;
  const ly =  TERRAIN_HALF - row * CELL_SIZE;
  return [
    OFFSET_X + COS_A * lx + SIN_A * ly,
    OFFSET_Z + SIN_A * lx - COS_A * ly,
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
