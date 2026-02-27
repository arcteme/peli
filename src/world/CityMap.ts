import * as THREE from 'three';

// ── Types ────────────────────────────────────────────────────────────────────

interface BuildingBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

interface BuildingMeta {
  id:       string;
  height:   number;
  fn:       string;
  roofType: string;
  box:      BuildingBox;
}

interface KeravaMetaJson {
  buildingCount: number;
  buildings:     BuildingMeta[];
  terrainHalf?:  number;
  terrainSegs?:  number;
}

// ── Material palette (spring Kerava) ────────────────────────────────────────

// Building walls: cream-white (residential) + concrete grey (commercial)
const MAT_WALL_A     = new THREE.MeshPhongMaterial({ color: 0xd4cdc4, shininess: 8,  side: THREE.DoubleSide });
const MAT_WALL_B     = new THREE.MeshPhongMaterial({ color: 0xa8a89a, shininess: 8,  side: THREE.DoubleSide });
// Building roofs: rust-red (residential pitched), dark grey (mid-rise flat), light grey (commercial flat)
const MAT_ROOF_A     = new THREE.MeshPhongMaterial({ color: 0x8b3a2a, shininess: 4,  side: THREE.DoubleSide });
const MAT_ROOF_B     = new THREE.MeshPhongMaterial({ color: 0x4a4a4a, shininess: 4,  side: THREE.DoubleSide });
const MAT_ROOF_C     = new THREE.MeshPhongMaterial({ color: 0xb8b0a8, shininess: 4,  side: THREE.DoubleSide });
const MAT_GROUND     = new THREE.MeshLambertMaterial({ color: 0x9e9070 }); // pale straw-tan spring ground
const MAT_URBAN      = new THREE.MeshLambertMaterial({ color: 0x7a7872 }); // grey urban paving
const MAT_ROAD       = new THREE.MeshLambertMaterial({ color: 0x484848 }); // weathered asphalt
const MAT_RAIL       = new THREE.MeshLambertMaterial({ color: 0xb0a898 }); // pale silver-grey ballast
const MAT_RAIL_STEEL = new THREE.MeshLambertMaterial({ color: 0x909090 });
const MAT_PLATFORM   = new THREE.MeshLambertMaterial({ color: 0xd0ccc4 }); // concrete platform
const MAT_MARK       = new THREE.MeshLambertMaterial({ color: 0xcccc80 });
const MAT_PARKING    = new THREE.MeshLambertMaterial({ color: 0x8a8880 }); // pale grey asphalt
const MAT_PARK_LINE  = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 });
const MAT_CONIFER    = new THREE.MeshLambertMaterial({ color: 0x2a5022 }); // spring pine green
const MAT_TRUNK      = new THREE.MeshLambertMaterial({ color: 0x5a3a1a }); // brown trunk
const MAT_DECIDUOUS  = new THREE.MeshLambertMaterial({ color: 0x5a8a30 }); // fresh spring green



const _EMPTY_BOXES: THREE.Box3[] = [];

/**
 * Lightweight 2-D spatial hash for building Box3 colliders.
 * Cells are _cellSize × _cellSize metres in XZ; Y is ignored for binning.
 * Lookup cost is O(cells_touched) ≪ O(236) for small query radii.
 */
class BuildingGrid {
  private readonly _cells    = new Map<number, THREE.Box3[]>();
  private readonly _cellSize: number;

  constructor(colliders: THREE.Box3[], cellSize = 50) {
    this._cellSize = cellSize;
    for (const box of colliders) {
      const x0 = Math.floor(box.min.x / cellSize);
      const z0 = Math.floor(box.min.z / cellSize);
      const x1 = Math.floor(box.max.x / cellSize);
      const z1 = Math.floor(box.max.z / cellSize);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          // Pack two 16-bit signed ints into one 32-bit int for a fast Map key.
          const key = ((cx + 512) & 0xffff) << 16 | ((cz + 512) & 0xffff);
          let cell = this._cells.get(key);
          if (!cell) { cell = []; this._cells.set(key, cell); }
          cell.push(box);
        }
      }
    }
  }

  /**
   * Return all Box3s whose grid cell(s) overlap the circle
   * (position.x ± radius, position.z ± radius).
   * Duplicates are possible when a box spans multiple cells — callers must
   * tolerate that (intersectsBox is idempotent so collision is still correct).
   */
  query(position: THREE.Vector3, radius: number): THREE.Box3[] {
    const cs = this._cellSize;
    const x0 = Math.floor((position.x - radius) / cs);
    const z0 = Math.floor((position.z - radius) / cs);
    const x1 = Math.floor((position.x + radius) / cs);
    const z1 = Math.floor((position.z + radius) / cs);

    // Fast path: single cell
    if (x0 === x1 && z0 === z1) {
      return this._cells.get(((x0 + 512) & 0xffff) << 16 | ((z0 + 512) & 0xffff)) ?? _EMPTY_BOXES;
    }

    const results: THREE.Box3[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this._cells.get(((cx + 512) & 0xffff) << 16 | ((cz + 512) & 0xffff));
        if (cell) for (const b of cell) results.push(b);
      }
    }
    return results;
  }
}

export class CityMap {
  public group:     THREE.Group  = new THREE.Group();
  public colliders: THREE.Box3[] = [];

  /** True once async load() has completed */
  public loaded = false;

  /** The ground/aerial-texture mesh — public so dev tools can move it for alignment. */
  public aerialMesh!: THREE.Mesh;

  /** Stored heightmap for terrain sampling (set by _applyTerrain) */
  private _terrainHeights: Float32Array | null = null;
  private _terrainCols = 101;
  private _terrainRows = 101;
  private _terrainHalf = 550;
  private _renderer: THREE.WebGLRenderer | null = null;

  // Scratch objects reused every frame — never reallocated in hot paths.
  private readonly _scratchBox  = new THREE.Box3();
  private readonly _scratchSize = new THREE.Vector3();
  private readonly _scratchPt   = new THREE.Vector3();
  private _grid: BuildingGrid | null = null;

  constructor(renderer?: THREE.WebGLRenderer) {
    this._renderer = renderer ?? null;
    this.group.name = 'kerava-city';
    this._createGround();  // flat until terrain bin loads
  }

  // ── Async GML loader ──────────────────────────────────────────────────────

  async load(): Promise<void> {
    let meta: KeravaMetaJson;
    let wallsBuf: ArrayBuffer;
    let roofsBuf: ArrayBuffer;
    let terrainBuf: ArrayBuffer | null = null;

    try {
      const [metaResp, wallsResp, roofsResp, terrainResp] = await Promise.all([
        fetch('/kerava-meta.json'),
        fetch('/kerava-walls.bin'),
        fetch('/kerava-roofs.bin'),
        fetch('/kerava-terrain.bin'),
      ]);
      if (!metaResp.ok || !wallsResp.ok || !roofsResp.ok)
        throw new Error('HTTP error fetching geometry files');
      [meta, wallsBuf, roofsBuf] = await Promise.all([
        metaResp.json() as Promise<KeravaMetaJson>,
        wallsResp.arrayBuffer(),
        roofsResp.arrayBuffer(),
      ]);
      if (terrainResp.ok) terrainBuf = await terrainResp.arrayBuffer();
    } catch (err) {
      console.warn('[CityMap] Could not load GML geometry — using placeholder city.', err);
      this._createFallbackBuildings();
      return;
    }

    // Apply terrain heightmap to ground mesh
    if (terrainBuf) this._applyTerrain(terrainBuf);

    // Now that terrain is loaded, place trees
    // Roads and railway are hidden — aerial texture shows them instead
    // this._createRoads();  // re-enable later if 3D roads are needed
    // this._createTrees();  // hidden — uncomment to re-enable

    const wallMesh = this._buildMultiMesh(wallsBuf,
      [MAT_WALL_A, MAT_WALL_B], [0.55]);
    const roofMesh = this._buildMultiMesh(roofsBuf,
      [MAT_ROOF_A, MAT_ROOF_B, MAT_ROOF_C], [0.30, 0.65]);
    if (wallMesh) this.group.add(wallMesh);
    if (roofMesh) this.group.add(roofMesh);

    for (const b of meta.buildings) {
      const { minX, minY, minZ, maxX, maxY, maxZ } = b.box;
      if (!isFinite(minX) || !isFinite(maxX)) continue;
      this.colliders.push(
        new THREE.Box3(
          new THREE.Vector3(minX, minY, minZ),
          new THREE.Vector3(maxX, maxY, maxZ),
        ),
      );
    }

    this.loaded = true;
    this._buildGrid();
    console.log(`[CityMap] Loaded ${meta.buildingCount} buildings | ${this.colliders.length} colliders`);
  }

  // ── Terrain heightmap applicator ─────────────────────────────────────────────

  /**
   * Parse kerava-terrain.bin and reshape the terrain mesh vertex heights.
   *
   * Binary format: [COLS:Uint32][ROWS:Uint32] then Float32Array of COLS×ROWS heights.
   * Vertex (col, row) is at world XZ = (-HALF + col×cell, -HALF + row×cell).
   * After PlaneGeometry rotation.x = -π/2:
   *   local (x, y, z) → world (x, z, −y)
   * So setting position.z on a vertex changes its world Y.
   */
  private _applyTerrain(buf: ArrayBuffer): void {
    const header = new Uint32Array(buf, 0, 2);
    const COLS   = header[0];
    const ROWS   = header[1];
    const heights = new Float32Array(buf, 8, COLS * ROWS);

    this._terrainHeights = heights;
    this._terrainCols    = COLS;
    this._terrainRows    = ROWS;
    // _terrainHalf stays 550 — matches preprocessing constant

    const positions = this.aerialMesh.geometry.attributes.position
      .array as Float32Array;

    // PlaneGeometry(width, height, widthSegs, heightSegs) vertex order:
    //   vertexIdx = row * (widthSegs+1) + col  counting left→right, top→bottom
    // After rotation.x=-π/2: local z → world Y
    const geoCols = COLS; // widthSegs+1
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < geoCols; col++) {
        const vIdx = row * geoCols + col;
        positions[vIdx * 3 + 2] = heights[vIdx]; // set local-z = world-Y
      }
    }

    this.aerialMesh.geometry.attributes.position.needsUpdate = true;
    this.aerialMesh.geometry.computeVertexNormals();

    console.log(`[CityMap] Terrain heightmap applied (${COLS}×${ROWS})`);
  }
  /**
   * Sample terrain height at an arbitrary world (X, Z) using bilinear interpolation.
   * Returns 0 if outside terrain extent or before terrain has loaded.
   */
  terrainHeightAt(wx: number, wz: number): number {
    if (!this._terrainHeights) return 0;
    const COLS = this._terrainCols;
    const ROWS = this._terrainRows;
    const half = 550; // fixed from preprocessing
    const segs = COLS - 1;
    const cell = (half * 2) / segs;

    const fc = (wx + half) / cell;
    const fr = (wz + half) / cell;
    const c0 = Math.floor(fc), r0 = Math.floor(fr);
    const c1 = c0 + 1, r1 = r0 + 1;
    if (c0 < 0 || r0 < 0 || c1 >= COLS || r1 >= ROWS) return 0;

    const tx = fc - c0, tz = fr - r0;
    const h00 = this._terrainHeights[r0 * COLS + c0];
    const h10 = this._terrainHeights[r0 * COLS + c1];
    const h01 = this._terrainHeights[r1 * COLS + c0];
    const h11 = this._terrainHeights[r1 * COLS + c1];
    return h00 * (1-tx)*(1-tz) + h10 * tx*(1-tz) + h01 * (1-tx)*tz + h11 * tx*tz;
  }
  // ── Multi-material binary mesh builder ──────────────────────────────────────

  /**
   * Like _buildMesh but splits the index buffer into groups for multi-material rendering.
   * @param splits  array of fractional boundaries, e.g. [0.55, 0.80] for 3 groups
   */
  private _buildMultiMesh(buf: ArrayBuffer, mats: THREE.Material[], splits: number[]): THREE.Mesh | null {
    const header      = new Uint32Array(buf, 0, 2);
    const vertexCount = header[0];
    const indexCount  = header[1];
    if (vertexCount === 0 || indexCount === 0) return null;

    const posOffset = 8;
    const idxOffset = posOffset + vertexCount * 3 * 4;
    const positions = new Float32Array(buf, posOffset, vertexCount * 3);
    const indices   = new Uint32Array(buf,  idxOffset, indexCount);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    // Build draw groups from fractional boundaries (aligned to triangle boundaries = multiples of 3)
    const boundaries = [0, ...splits.map(f => Math.floor(f * indexCount / 3) * 3), indexCount];
    for (let i = 0; i < mats.length; i++) {
      const start = boundaries[i];
      const count = boundaries[i + 1] - start;
      if (count > 0) geo.addGroup(start, count, i);
    }

    const mesh = new THREE.Mesh(geo, mats);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // ── Static world geometry ────────────────────────────────────────────────────────────

  private _createGround() {
    // Subdivided terrain mesh: 101×101 vertices over 1100×1100 m
    // Heights will be filled by _applyTerrain() once the binary loads.
    const geo  = new THREE.PlaneGeometry(1100, 1100, 100, 100);
    const mesh = new THREE.Mesh(geo, MAT_GROUND);
    mesh.rotation.x    = -Math.PI / 2;
    mesh.receiveShadow = true;
    // Calibration from TextureCalibrator tool (F4) — paste the 3 lines from the exit snippet here
    //mesh.position.x    = 34.0;      // offsetX  (metres)
    //mesh.position.z    = -78.0;     // offsetZ  (metres)
    //mesh.rotation.z    = -0.069813; // rotation (RADIANS) = -4.00°
    //mesh.scale.set(1.0, 1.0, 1.0);  // scale — adjust with [ / ] in F4 calibrator
    mesh.position.x = 66.0;
    mesh.position.z = -20.0;
    mesh.rotation.z = -0.069813;
    mesh.scale.set(1.430000, 1.430000, 1.430000);

    this.aerialMesh    = mesh;
    this.group.add(mesh);

    // Async: swap to aerial photo texture if available (generated by scripts/crop-aerial.py)
    const loader = new THREE.TextureLoader();
    loader.load(
      '/kerava-aerial.jpg',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        // PlaneGeometry default UVs cover 0→1 across the full 1100 m — no adjustment needed
        const mat = new THREE.MeshLambertMaterial({ map: tex });
        mesh.material = mat;

        // Now load the high-res WebP on top — keeps JPEG visible while it downloads
        loader.load(
          '/kerava-ground.webp',
          (hiTex) => {
            hiTex.colorSpace = THREE.SRGBColorSpace;
            // Anisotropic filtering: makes texture sharp at low-altitude grazing angles
            const maxAniso = this._renderer
              ? this._renderer.capabilities.getMaxAnisotropy()
              : 4;
            hiTex.anisotropy = maxAniso;
            (mesh.material as THREE.MeshLambertMaterial).map = hiTex;
            (mesh.material as THREE.MeshLambertMaterial).needsUpdate = true;
            tex.dispose(); // free the JPEG from GPU memory
          },
          undefined,
          () => { /* high-res WebP not found — JPEG stays */ },
        );
      },
      undefined,
      () => { /* texture not yet generated — keep flat MAT_GROUND */ },
    );
  }

  private _createRoads() {
    /** Sample terrain + a small constant so decals sit just above ground */
    const ty = (x: number, z: number, bias = 0.15) => this.terrainHeightAt(x, z) + bias;

    const addPlane = (w: number, h: number, x: number, z: number, rotY = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), MAT_ROAD);
      m.rotation.x = -Math.PI / 2;
      if (rotY) m.rotation.z = rotY;
      m.position.set(x, ty(x, z), z);
      this.group.add(m);
    };

    // Aleksis Kiven tie — main N-S road, ~80 m west of station
    addPlane(16, 1000, -80, 0);
    // Kauppakaari — main E-W road, ~70 m south of station
    addPlane(700, 18, 0, 70);
    // Keravantie / Route 45 — E-W, ~200 m south
    addPlane(700, 16, 0, 200);
    // Secondary N-S connector, ~200 m east
    addPlane(10, 600, 200, 120);

    // Road centre-line dashes on N-S main road
    for (let i = -480; i < 480; i += 14) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 6), MAT_MARK);
      m.rotation.x = -Math.PI / 2;
      m.position.set(-80, ty(-80, i, 0.17), i);
      this.group.add(m);
    }

    // Railway — Päärata main line
    // Bearing: 10.5° clockwise from north (OSM data)
    // RAIL_X=10: ballast x=3→17, 3 m east of station building (maxX=0.1)
    const RAIL_X   = 10;
    const RAIL_ROT = -10.5 * Math.PI / 180;

    const railBase = new THREE.Mesh(new THREE.PlaneGeometry(14, 1500), MAT_RAIL);
    railBase.rotation.x = -Math.PI / 2;
    railBase.rotation.z = RAIL_ROT;          // rotation.z on a flat plane = rotate in XZ = bearing
    railBase.position.set(RAIL_X, ty(RAIL_X, 0, 0.12), 0);
    this.group.add(railBase);

    // Steel rails ±3 m from corridor centre
    for (const off of [-3, 3]) {
      const rail = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 1500), MAT_RAIL_STEEL);
      rail.rotation.x = -Math.PI / 2;
      rail.rotation.z = RAIL_ROT;
      rail.position.set(RAIL_X + off, ty(RAIL_X + off, 0, 0.14), 0);
      this.group.add(rail);
    }
  }

  private _createTrees(): void {
    // Deterministic seeded RNG so layout is stable across reloads
    let _seed = 42;
    const rng = () => { _seed = (Math.imul(_seed, 1664525) + 1013904223) | 0; return (_seed >>> 0) / 0xffffffff; };

    const dummy = new THREE.Object3D();
    dummy.matrixAutoUpdate = false;

    // ── Pine forest — NE quadrant (x 150–480, z −480 to −150) ───────────────
    const PINE_COUNT = 120;
    const iConeBot = new THREE.InstancedMesh(new THREE.ConeGeometry(4.5, 7, 6), MAT_CONIFER, PINE_COUNT);
    const iConeTop = new THREE.InstancedMesh(new THREE.ConeGeometry(3.0, 6, 6), MAT_CONIFER, PINE_COUNT);
    const iTrunkP  = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.4, 4, 5), MAT_TRUNK,   PINE_COUNT);
    iConeBot.castShadow = iConeTop.castShadow = iTrunkP.castShadow = true;

    for (let i = 0; i < PINE_COUNT; i++) {
      const x   = 150 + rng() * 330;
      const z   = -480 + rng() * 330;
      const gnd = this.terrainHeightAt(x, z);
      const s   = 0.75 + rng() * 0.5;
      // trunk
      dummy.position.set(x, gnd + 2, z); dummy.scale.setScalar(s); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      iTrunkP.setMatrixAt(i, dummy.matrix);
      // lower cone crown
      dummy.position.set(x, gnd + 5 * s, z); dummy.updateMatrix();
      iConeBot.setMatrixAt(i, dummy.matrix);
      // upper cone tip
      dummy.position.set(x, gnd + 9 * s, z); dummy.scale.setScalar(s * 0.7); dummy.updateMatrix();
      iConeTop.setMatrixAt(i, dummy.matrix);
    }
    iConeBot.instanceMatrix.needsUpdate = true;
    iConeTop.instanceMatrix.needsUpdate = true;
    iTrunkP.instanceMatrix.needsUpdate  = true;
    this.group.add(iConeBot, iConeTop, iTrunkP);

    // ── Bare deciduous trees — street line + W residential scatter ────────
    const decPos: [number, number][] = [];
    // Street trees alongside Aleksis Kiven tie — placed at kerb, NOT on the road surface (road x: -88 to -72)
    for (let z = -400; z <= 400; z += 18) {
      const side = (Math.floor(z / 18) % 2 === 0) ? -92 : -68; // alternate west/east kerb
      decPos.push([side + (rng() - 0.5) * 3, z]);
    }
    // West residential scatter — with road exclusion
    const onRoad = (x: number, z: number): boolean =>
      Math.abs(x - (-80)) < 10 ||
      Math.abs(z - 70)    < 12 ||
      Math.abs(z - 200)   < 12;
    for (let i = 0; i < 80; i++) {
      let tx: number, tz: number, att = 0;
      do { tx = -80 - rng() * 220; tz = (rng() - 0.5) * 800; att++; }
      while (onRoad(tx, tz) && att < 20);
      if (!onRoad(tx, tz)) decPos.push([tx, tz]);
    }
    const DEC_COUNT  = decPos.length;
    const iCrown  = new THREE.InstancedMesh(new THREE.SphereGeometry(3, 5, 4),           MAT_DECIDUOUS, DEC_COUNT);
    const iTrunkD = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.3, 4, 5), MAT_TRUNK,     DEC_COUNT);
    iCrown.castShadow = iTrunkD.castShadow = true;

    for (let i = 0; i < DEC_COUNT; i++) {
      const [x, z] = decPos[i];
      const gnd = this.terrainHeightAt(x, z);
      const s   = 0.7 + rng() * 0.6;
      // trunk
      dummy.position.set(x, gnd + 2, z); dummy.scale.setScalar(s); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      iTrunkD.setMatrixAt(i, dummy.matrix);
      // flattened crown
      dummy.position.set(x, gnd + 5 * s, z); dummy.scale.set(s, s * 0.7, s); dummy.updateMatrix();
      iCrown.setMatrixAt(i, dummy.matrix);
    }
    iCrown.instanceMatrix.needsUpdate  = true;
    iTrunkD.instanceMatrix.needsUpdate = true;
    this.group.add(iCrown, iTrunkD);
  }

  private _createParking(): void {
    const ty = (x: number, z: number) => this.terrainHeightAt(x, z) + 0.13;

    const addLot = (cx: number, cz: number, w: number, d: number) => {
      const lot = new THREE.Mesh(new THREE.PlaneGeometry(w, d), MAT_PARKING);
      lot.rotation.x = -Math.PI / 2;
      lot.position.set(cx, ty(cx, cz), cz);
      this.group.add(lot);
      // Parking bay stripes every 2.5 m
      const cols = Math.floor(w / 2.5);
      for (let i = 0; i < cols; i++) {
        const sx = cx - w / 2 + (i + 0.5) * (w / cols);
        const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, d * 0.85), MAT_PARK_LINE);
        line.rotation.x = -Math.PI / 2;
        line.position.set(sx, ty(cx, cz) + 0.01, cz);
        this.group.add(line);
      }
    };

    // Commercial zone parking lots, west of railway
    addLot(-60,   90,  80, 50);
    addLot(-130, 140,  60, 40);
    addLot( -90, 200,  70, 35);
    addLot( -40, 250,  50, 30);
  }

  private _createUrbanPaving(): void {
    // Large grey paving overlay for the dense city-centre zone (matches aerial's dominant grey tone)
    // Placed just above terrain; straw ground shows through at the edges
    const zones: [number, number, number, number][] = [
      // [cx, cz, width, depth]
      [ -60,  10, 320, 580],  // main urban core, west of railway
      [  60,  50, 160, 400],  // east of railway commercial strip
      [-100, -200, 200, 200], // south-west zone
    ];
    for (const [cx, cz, w, d] of zones) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), MAT_URBAN);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cx, this.terrainHeightAt(cx, cz) + 0.08, cz);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private _createFallbackBuildings() {
    const mat = new THREE.MeshLambertMaterial({ color: 0xb0a898 });
    const defs: [number, number, number, number, number][] = [
      [0,    0,   50, 40, 16],
      [80,  -40,  30, 30, 22],
      [-70,  20,  35, 25, 18],
      [150,  60,  25, 40, 28],
      [-130, -50, 30, 50, 24],
    ];
    for (const [x, z, w, d, h] of defs) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.colliders.push(
        new THREE.Box3().setFromCenterAndSize(
          new THREE.Vector3(x, h / 2, z),
          new THREE.Vector3(w, h, d),
        ),
      );
    }
    this._buildGrid();
  }

  /** Move the ground/aerial mesh in XZ — used by TextureCalibrator to align the photo. */
  setAerialOffset(x: number, z: number): void {
    this.aerialMesh.position.x = x;
    this.aerialMesh.position.z = z;
  }

  getAerialOffset(): { x: number; z: number } {
    return { x: this.aerialMesh.position.x, z: this.aerialMesh.position.z };
  }

  /** Rotate the ground/aerial mesh around the world Y axis (radians). */
  setAerialRotation(radians: number): void {
    this.aerialMesh.rotation.z = radians;
  }

  getAerialRotation(): number {
    return this.aerialMesh.rotation.z;
  }

  setAerialScale(s: number): void {
    this.aerialMesh.scale.set(s, s, s);
  }

  getAerialScale(): number {
    return this.aerialMesh.scale.x;
  }

  // ── Public collision API ───────────────────────────────────────────────────

  /** Return the Box3s whose grid cell overlaps the given position+radius. */
  queryBuildings(position: THREE.Vector3, radius: number): THREE.Box3[] {
    return this._grid ? this._grid.query(position, radius) : this.colliders;
  }

  checkCollision(position: THREE.Vector3, radius = 3): boolean {
    this._scratchBox.setFromCenterAndSize(
      position,
      this._scratchSize.set(radius * 2, radius * 2, radius * 2),
    );
    for (const col of this.queryBuildings(position, radius)) {
      if (this._scratchBox.intersectsBox(col)) return true;
    }
    return false;
  }

  getNearestBuildingDistance(position: THREE.Vector3): number {
    let minDist = Infinity;
    for (const col of this.queryBuildings(position, 80)) {
      col.clampPoint(position, this._scratchPt);
      const d = position.distanceTo(this._scratchPt);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  // ── Private grid management ────────────────────────────────────────────────

  private _buildGrid(): void {
    this._grid = new BuildingGrid(this.colliders);
    console.log(`[CityMap] BuildingGrid ready — ${this.colliders.length} colliders, cell size 50 m`);
  }
}
