#!/usr/bin/env node
/**
 * process-gml.mjs
 *
 * One-time preprocessing script: streams L4143F.gml (CityGML, EPSG:3067 / N2000),
 * filters buildings within 500 m of Kerava railway station, triangulates LOD2 polygon
 * faces via earcut, and writes compact binary geometry + metadata to public/.
 *
 * Output
 *   public/kerava-walls.bin   – wall surface geometry
 *   public/kerava-roofs.bin   – roof surface geometry
 *   public/kerava-meta.json   – per-building metadata + AABB for collision
 *
 * Binary format (both *.bin files)
 *   Bytes 0-3   : vertexCount  (Uint32LE)
 *   Bytes 4-7   : indexCount   (Uint32LE)
 *   Bytes 8 …   : Float32Array  [x,y,z, x,y,z, …]  length = vertexCount*3
 *   Bytes …     : Uint32Array   [i,j,k, …]          length = indexCount
 *
 * Scene-space coordinate mapping (meters)
 *   sceneX =  E - CENTER_E
 *   sceneY =  elevation - BASE_ELEV  (shifted after parse so min Y = 0)
 *   sceneZ = -(N - CENTER_N)         (flip North axis to Three.js −Z forward)
 */

import { createReadStream } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sax from 'sax';
import earcut from 'earcut';

// ── Configuration ──────────────────────────────────────────────────────────────

/** Centre of the 500 m play area: Kerava railway station (EPSG:3067, computed from WGS84 60.403333N 25.105556E) */
const CENTER_E = 395631;
const CENTER_N = 6697831;
const RADIUS   = 500; // metres

/** Rough base elevation – will be refined after parsing */
const BASE_ELEV = 30;

// ── Paths ──────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const GML_PATH  = resolve(__dirname, '../src/world/L4143F.gml');
const OUT_DIR   = resolve(__dirname, '../public');

// ── Accumulators ───────────────────────────────────────────────────────────────

/** Flat vertex arrays  [x, y, z, x, y, z …]  (scene space, before Y-shift) */
const wallVerts = [];
const roofVerts = [];

/** Flat index arrays  [i, j, k …] */
const wallIdxs = [];
const roofIdxs = [];

/** Ground elevation samples: { cx, cz, groundY } – one per kept building (before global shift) */
const elevSamples = [];

/** Per-building metadata (buildings already filtered to radius) */
const buildings = [];

let totalBuildingsSeen  = 0;
let totalBuildingsKept  = 0;

// ── SAX parser state ───────────────────────────────────────────────────────────

let inBuilding       = false;
let inBoundedBy      = false;
let inPolygon        = false;
let inExteriorRing   = false;
let inPosList        = false;

let currentSurfaceType    = null; // 'wall' | 'roof' | 'skip'
let posListBuf            = '';
let polygonExteriorCoords = null; // number[] or null

/** Currently-accumulating building state */
let curBuilding = null; // { id, height, fn, roofType }
let curFaces    = null; // [{ type, coords: number[] }]

/** Simple character-data element tracking */
let charTag = null;
let charBuf = '';

// ── Coordinate helpers ─────────────────────────────────────────────────────────

function toScene(E, N, elev) {
  return [E - CENTER_E, elev - BASE_ELEV, -(N - CENTER_N)];
}

/**
 * Parse a gml:posList text blob into scene-space coordinates.
 * Removes the duplicate closing vertex that GML LinearRing requires.
 */
function parsePosList(text) {
  const nums = text.trim().split(/\s+/).map(Number);
  const pts   = [];
  for (let i = 0; i + 2 < nums.length; i += 3) {
    pts.push(...toScene(nums[i], nums[i + 1], nums[i + 2]));
  }
  // Remove closing vertex (last == first) required by GML spec
  const n = pts.length / 3;
  if (n >= 2) {
    const d2 =
      (pts[0] - pts[(n - 1) * 3]) ** 2 +
      (pts[1] - pts[(n - 1) * 3 + 1]) ** 2 +
      (pts[2] - pts[(n - 1) * 3 + 2]) ** 2;
    if (d2 < 0.01) pts.splice((n - 1) * 3, 3);
  }
  return pts;
}

// ── Triangulation helpers ──────────────────────────────────────────────────────

/**
 * Newell's method to compute an (unnormalised) polygon normal.
 * pts: flat [x,y,z …]
 */
function newellNormal(pts) {
  const n = pts.length / 3;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const j  = (i + 1) % n;
    const xi = pts[i * 3], yi = pts[i * 3 + 1], zi = pts[i * 3 + 2];
    const xj = pts[j * 3], yj = pts[j * 3 + 1], zj = pts[j * 3 + 2];
    nx += (yi - yj) * (zi + zj);
    ny += (zi - zj) * (xi + xj);
    nz += (xi - xj) * (yi + yj);
  }
  return [nx, ny, nz];
}

/**
 * Project a 3D planar polygon ring to 2D and triangulate with earcut.
 * Returns a flat array of triangle vertex indices into pts (in triples).
 * pts: flat [x,y,z …]
 */
function triangulatePolygon(pts) {
  const n = pts.length / 3;
  if (n < 3) return [];

  const [nx, ny, nz] = newellNormal(pts);
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);

  // Drop the dominant axis for 2-D projection
  let u, v;
  if (az >= ax && az >= ay) { u = 0; v = 1; }      // project to XY
  else if (ay >= ax)         { u = 0; v = 2; }      // project to XZ
  else                       { u = 1; v = 2; }      // project to YZ

  const flat2d = [];
  for (let i = 0; i < n; i++) flat2d.push(pts[i * 3 + u], pts[i * 3 + v]);

  return earcut(flat2d, null, 2);
}

// ── Building-level processing ──────────────────────────────────────────────────

function processBuildingEnd() {
  if (!curBuilding || !curFaces || curFaces.length === 0) return;
  totalBuildingsSeen++;

  // Compute XZ centroid to check radius
  let sumX = 0, sumZ = 0, count = 0;
  for (const f of curFaces) {
    for (let i = 0; i < f.coords.length; i += 3) {
      sumX += f.coords[i]; sumZ += f.coords[i + 2]; count++;
    }
  }
  if (count === 0) return;
  const cx = sumX / count, cz = sumZ / count;
  if (Math.hypot(cx, cz) > RADIUS) return; // out of play area

  totalBuildingsKept++;
  if (totalBuildingsKept % 50 === 0) {
    process.stdout.write(`  kept ${totalBuildingsKept} (seen ${totalBuildingsSeen})…\r`);
  }

  // Triangulate faces and append to global buffers;
  // also track AABB for collision
  let minX =  Infinity, minY =  Infinity, minZ =  Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const face of curFaces) {
    const isRoof = face.type === 'roof';
    const verts  = isRoof ? roofVerts : wallVerts;
    const idxs   = isRoof ? roofIdxs  : wallIdxs;

    const offset = verts.length / 3;
    const tris   = triangulatePolygon(face.coords);
    if (tris.length === 0) continue;

    // Append vertices
    for (const c of face.coords) verts.push(c);
    // Append indices (offset into the global buffer)
    for (const idx of tris) idxs.push(offset + idx);

    // Update AABB
    for (let i = 0; i < face.coords.length; i += 3) {
      const x = face.coords[i], y = face.coords[i + 1], z = face.coords[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }

  buildings.push({
    id:       curBuilding.id,
    height:   curBuilding.height,
    fn:       curBuilding.fn,
    roofType: curBuilding.roofType,
    box: { minX, minY, minZ, maxX, maxY, maxZ },
  });

  // Record centroid + base elevation for terrain heightmap generation
  if (isFinite(minY)) elevSamples.push({ cx, cz, groundY: minY });
}

// ── SAX streaming parser ───────────────────────────────────────────────────────

const saxStream = sax.createStream(/* strict= */ true, { trim: false });

saxStream.on('opentag', (node) => {
  const name = node.name;

  // ── Building start ──────────────────────────────────────────────────────────
  if (name === 'bldg:Building') {
    inBuilding  = true;
    curBuilding = { id: node.attributes['gml:id'] || '', height: 0, fn: '', roofType: '' };
    curFaces    = [];
    return;
  }
  if (!inBuilding) return;

  // ── BoundedBy typed surfaces ────────────────────────────────────────────────
  if (name === 'bldg:boundedBy')    { inBoundedBy = true;           return; }
  if (!inBoundedBy) return;

  if (name === 'bldg:RoofSurface')    { currentSurfaceType = 'roof'; return; }
  if (name === 'bldg:WallSurface')    { currentSurfaceType = 'wall'; return; }
  if (name === 'bldg:GroundSurface' ||
      name === 'bldg:ClosureSurface') { currentSurfaceType = 'skip'; return; }

  // ── Polygon geometry ────────────────────────────────────────────────────────
  if (name === 'gml:Polygon' && currentSurfaceType && currentSurfaceType !== 'skip') {
    inPolygon            = true;
    polygonExteriorCoords = null;
    return;
  }
  if (!inPolygon) return;

  if (name === 'gml:exterior') { inExteriorRing = true;  return; }
  if (name === 'gml:interior') { inExteriorRing = false; return; } // holes – skip

  if (name === 'gml:posList' && inExteriorRing) {
    inPosList  = true;
    posListBuf = '';
    return;
  }

  // ── Simple text elements ────────────────────────────────────────────────────
  if (name === 'bldg:measuredHeight' ||
      name === 'bldg:function'       ||
      name === 'bldg:roofType') {
    charTag = name;
    charBuf = '';
  }
});

saxStream.on('closetag', (name) => {
  // ── posList end ─────────────────────────────────────────────────────────────
  if (name === 'gml:posList' && inPosList) {
    // Only capture the exterior ring (first posList per polygon)
    if (polygonExteriorCoords === null) {
      polygonExteriorCoords = parsePosList(posListBuf);
    }
    inPosList  = false;
    posListBuf = '';
    return;
  }

  // ── Exterior ring end ───────────────────────────────────────────────────────
  if (name === 'gml:exterior') { inExteriorRing = false; return; }

  // ── Polygon end ─────────────────────────────────────────────────────────────
  if (name === 'gml:Polygon' && inPolygon) {
    if (polygonExteriorCoords && polygonExteriorCoords.length >= 9) {
      curFaces.push({ type: currentSurfaceType, coords: polygonExteriorCoords });
    }
    inPolygon            = false;
    polygonExteriorCoords = null;
    inExteriorRing       = false;
    return;
  }

  // ── Surface type end ────────────────────────────────────────────────────────
  if (name === 'bldg:RoofSurface'    ||
      name === 'bldg:WallSurface'    ||
      name === 'bldg:GroundSurface'  ||
      name === 'bldg:ClosureSurface') {
    currentSurfaceType = null;
    inPolygon          = false;
    inExteriorRing     = false;
    return;
  }

  if (name === 'bldg:boundedBy') { inBoundedBy = false; return; }

  // ── Building end ────────────────────────────────────────────────────────────
  if (name === 'bldg:Building') {
    processBuildingEnd();
    inBuilding         = false;
    inBoundedBy        = false;
    curBuilding        = null;
    curFaces           = null;
    currentSurfaceType = null;
    inPolygon          = false;
    inExteriorRing     = false;
    inPosList          = false;
    posListBuf         = '';
    return;
  }

  // ── Simple text element end ─────────────────────────────────────────────────
  if (charTag && charTag === name && curBuilding) {
    if (name === 'bldg:measuredHeight') curBuilding.height   = parseFloat(charBuf) || 0;
    else if (name === 'bldg:function')  curBuilding.fn       = charBuf.trim();
    else if (name === 'bldg:roofType')  curBuilding.roofType = charBuf.trim();
    charTag = null;
  }
});

saxStream.on('text',  (t) => { if (inPosList) posListBuf += t; if (charTag) charBuf += t; });
saxStream.on('cdata', (t) => { if (inPosList) posListBuf += t; if (charTag) charBuf += t; });

saxStream.on('error', (err) => {
  console.error('SAX parse error:', err.message);
  saxStream._parser.resume(); // recoverable – skip malformed element
});

// ── Write output ───────────────────────────────────────────────────────────────

saxStream.on('end', async () => {
  console.log(`\nParsed: ${totalBuildingsSeen} buildings total, ${totalBuildingsKept} within ${RADIUS} m radius`);

  if (totalBuildingsKept === 0) {
    console.error('No buildings found in radius — check CENTER_E/CENTER_N or RADIUS');
    process.exit(1);
  }

  // ── Normalise Y so the lowest vertex sits exactly at y = 0 ─────────────────
  let minY = Infinity;
  for (let i = 1; i < wallVerts.length; i += 3) if (wallVerts[i] < minY) minY = wallVerts[i];
  for (let i = 1; i < roofVerts.length; i += 3) if (roofVerts[i] < minY) minY = roofVerts[i];

  console.log(`Ground-level elevation (before shift): ${(minY + BASE_ELEV).toFixed(2)} m ASL`);

  for (let i = 1; i < wallVerts.length; i += 3) wallVerts[i] -= minY;
  for (let i = 1; i < roofVerts.length; i += 3) roofVerts[i] -= minY;
  for (const b of buildings) {
    b.box.minY -= minY;
    b.box.maxY -= minY;
  }
  for (const s of elevSamples) s.groundY -= minY;

  // ── Build terrain heightmap (IDW from building ground samples) ──────────────
  const TERRAIN_SEGS = 100;           // 100 segments → 101×101 vertices
  const TERRAIN_HALF = 550;           // slightly larger than RADIUS so edges are covered
  const COLS = TERRAIN_SEGS + 1;
  const ROWS = TERRAIN_SEGS + 1;
  const cellSize = (TERRAIN_HALF * 2) / TERRAIN_SEGS;
  const heights  = new Float32Array(ROWS * COLS);

  // Add boundary anchors at average elevation so IDW extrapolates gracefully
  const avgElev = elevSamples.reduce((a, s) => a + s.groundY, 0) / elevSamples.length;
  const anchors = [];
  for (let t = 0; t <= 8; t++) {
    const angle = (t / 8) * Math.PI * 2;
    anchors.push({ cx: Math.cos(angle) * TERRAIN_HALF, cz: Math.sin(angle) * TERRAIN_HALF, groundY: avgElev });
  }
  const allSamples = [...elevSamples, ...anchors];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const wx = -TERRAIN_HALF + col * cellSize;
      const wz = -TERRAIN_HALF + row * cellSize;

      let weightSum = 0, valueSum = 0;
      for (const s of allSamples) {
        const d2 = (wx - s.cx) ** 2 + (wz - s.cz) ** 2;
        const w  = 1.0 / (d2 + 25); // d_floor ≈ 5 m — tight fit to building bases
        weightSum += w;
        valueSum  += w * s.groundY;
      }
      heights[row * COLS + col] = weightSum > 0 ? valueSum / weightSum : 0;
    }
  }

  // 1-pass box-blur (3×3 kernel) for smoothness — fewer passes preserves building-base heights
  {
    const tmp = heights.slice();
    for (let row = 1; row < ROWS - 1; row++) {
      for (let col = 1; col < COLS - 1; col++) {
        let sum = 0;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++)
            sum += tmp[(row + dr) * COLS + (col + dc)];
        heights[row * COLS + col] = sum / 9;
      }
    }
  }

  // Floor-stamp: ensure each building's base elevation is the minimum at its grid cell.
  // This prevents blur from pulling terrain below building bases causing floating appearance.
  for (const s of elevSamples) {
    const col = Math.round((s.cx + TERRAIN_HALF) / cellSize);
    const row = Math.round((s.cz + TERRAIN_HALF) / cellSize);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;
    // Stamp the 3×3 neighbourhood so the ground is even under the full footprint
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = row + dr, c = col + dc;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
        const idx = r * COLS + c;
        if (heights[idx] < s.groundY) heights[idx] = s.groundY;
      }
    }
  }

  // ── Write files ─────────────────────────────────────────────────────────────
  await mkdir(OUT_DIR, { recursive: true });

  await writeBin(resolve(OUT_DIR, 'kerava-walls.bin'), wallVerts, wallIdxs);
  await writeBin(resolve(OUT_DIR, 'kerava-roofs.bin'), roofVerts, roofIdxs);

  // Terrain: header [cols:Uint32, rows:Uint32] + Float32Array of heights
  const terrainHeader = new Uint32Array([COLS, ROWS]);
  const terrainBuf = Buffer.concat([
    Buffer.from(terrainHeader.buffer),
    Buffer.from(heights.buffer),
  ]);
  await writeFile(resolve(OUT_DIR, 'kerava-terrain.bin'), terrainBuf);
  console.log(`  kerava-terrain.bin: ${COLS}×${ROWS} height samples, ${(terrainBuf.length / 1024).toFixed(1)} KB`);

  const meta = {
    buildingCount: buildings.length,
    center: { E: CENTER_E, N: CENTER_N },
    radius: RADIUS,
    terrainHalf: TERRAIN_HALF,
    terrainSegs: TERRAIN_SEGS,
    buildings,
  };
  await writeFile(resolve(OUT_DIR, 'kerava-meta.json'), JSON.stringify(meta));
  console.log(`  kerava-meta.json: ${buildings.length} building records`);
  console.log('Done ✓');
});

// ── Binary writer ──────────────────────────────────────────────────────────────

async function writeBin(filePath, verts, idxs) {
  const vertexCount = verts.length / 3;  // number of XYZ triplets
  const indexCount  = idxs.length;       // number of individual indices (triangles * 3)

  const header    = new Uint32Array([vertexCount, indexCount]);
  const positions = new Float32Array(verts);
  const indices   = new Uint32Array(idxs);

  const buf = Buffer.concat([
    Buffer.from(header.buffer),
    Buffer.from(positions.buffer),
    Buffer.from(indices.buffer),
  ]);
  await writeFile(filePath, buf);

  const name = filePath.split(/[/\\]/).pop();
  console.log(`  ${name}: ${vertexCount.toLocaleString()} vertices, ${(indexCount / 3).toLocaleString()} triangles, ${(buf.length / 1024).toFixed(1)} KB`);
}

// ── Kick off ───────────────────────────────────────────────────────────────────

console.log(`Streaming ${GML_PATH} …`);
console.log(`Filtering to ${RADIUS} m radius around E${CENTER_E} N${CENTER_N}\n`);
createReadStream(GML_PATH).pipe(saxStream);
