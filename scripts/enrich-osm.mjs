#!/usr/bin/env node
/**
 * enrich-osm.mjs
 *
 * Fetches OSM building footprints for the Kerava play area, spatially joins
 * them to NLS CityGML buildings, and upserts enrichment entries into
 * data/kerava-enriched.json.
 *
 * Enrichment adds to each matched NLS building:
 *   osm.tags.building          – OSM building type  (apartments, retail, …)
 *   osm.tags["building:colour"]– hex wall colour     (#E7E0D0)
 *   osm.tags["roof:colour"]    – hex roof colour
 *   osm.tags["roof:shape"]     – flat / gabled / hipped / …
 *   osm.tags["building:levels"]– number of storeys
 *   osm.tags.height            – OSM height string   ("50")
 *   osm.tags.name              – building name
 *   osm.tags["addr:street"]    – street address
 *   osm.tags["addr:housenumber"]
 *   osm.match                  – match quality stats {centroidDist, iou}
 *
 * Existing manual entries (notes, spawnPoints, public, publicOverrides) are
 * never overwritten — only the `osm` sub-object is replaced.
 *
 * Usage
 *   node scripts/enrich-osm.mjs
 *
 * Prerequisite: data/kerava-meta-full.json (run npm run preprocess-gml first)
 * After running: node scripts/strip-meta.mjs  to push changes to public/
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync }                  from 'node:fs';
import { resolve, dirname }            from 'node:path';
import { fileURLToPath }               from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = resolve(__dirname, '../data');

// ── Play-area centre (WGS84 + EPSG:3067) ─────────────────────────────────────

const CENTER_LAT = 60.403333;   // degrees N
const CENTER_LON = 25.105556;   // degrees E
const CENTER_LAT_RAD = CENTER_LAT * Math.PI / 180;

// Metres per degree at this latitude
const M_PER_DEG_LAT = 6378137 * Math.PI / 180;                   // ≈ 111 319 m/°
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(CENTER_LAT_RAD); // ≈  54 971 m/°

// Bbox with a comfortable margin (500 m radius + 100 m buffer)
const MARGIN_LAT = 0.0055;
const MARGIN_LON = 0.0075;
const SOUTH = CENTER_LAT - MARGIN_LAT;
const NORTH = CENTER_LAT + MARGIN_LAT;
const WEST  = CENTER_LON - MARGIN_LON;
const EAST  = CENTER_LON + MARGIN_LON;

// ── OSM tags to harvest ───────────────────────────────────────────────────────

const HARVEST_TAGS = [
  'building',
  'building:colour',
  'building:levels',
  'roof:colour',
  'roof:shape',
  'height',
  'name',
  'name:fi',
  'addr:street',
  'addr:housenumber',
  'addr:city',
  'amenity',
  'shop',
  'office',
];

// ── OSM building type → game category ────────────────────────────────────────

const OSM_CATEGORY = {
  // residential
  apartments: 'residential', residential: 'residential',
  house: 'residential', detached: 'residential',
  semidetached_house: 'residential', terrace: 'residential',
  bungalow: 'residential', dormitory: 'residential',

  // commercial
  commercial: 'commercial', retail: 'commercial',
  supermarket: 'commercial', office: 'commercial',
  hotel: 'commercial', kiosk: 'commercial',
  mall: 'commercial', bank: 'commercial',

  // civic
  public: 'civic', civic: 'civic',
  school: 'civic', university: 'civic',
  college: 'civic', hospital: 'civic',
  church: 'civic', cathedral: 'civic',
  chapel: 'civic', government: 'civic',
  train_station: 'civic', transportation: 'civic',
  fire_station: 'civic', library: 'civic',
  community_centre: 'civic',

  // industrial
  industrial: 'industrial', warehouse: 'industrial',
  factory: 'industrial', garage: 'industrial',
  garages: 'industrial', shed: 'industrial',
  service: 'industrial', storage_tank: 'industrial',
};

// ── Overpass fetch ────────────────────────────────────────────────────────────

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const QUERY = `
[out:json][timeout:60];
(
  way["building"](${SOUTH},${WEST},${NORTH},${EAST});
);
out tags geom;
`.trim();

async function fetchOsmBuildings() {
  console.log(`Querying Overpass API for building ways in bbox …`);
  const res = await fetch(OVERPASS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `data=${encodeURIComponent(QUERY)}`,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Overpass HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  await writeFile(resolve(DATA_DIR, 'kerava-osm-buildings.json'), JSON.stringify(data, null, 2));
  console.log(`  data/kerava-osm-buildings.json: ${data.elements?.length ?? 0} ways`);
  return data.elements ?? [];
}

// ── Coordinate conversion: WGS84 → scene-space XZ ────────────────────────────

/** {lat, lon} → {x, z} in scene-space metres */
function wgs84ToScene(lat, lon) {
  return {
    x:  (lon - CENTER_LON) * M_PER_DEG_LON,
    z: -(lat - CENTER_LAT) * M_PER_DEG_LAT,
  };
}

/** Convert an OSM way geometry array [{lat,lon}] → [[x,z], …] scene-space */
function wayToScenePolygon(geometry) {
  // geometry is closed (first === last node) — drop the duplicate
  const pts = geometry.map(({ lat, lon }) => {
    const { x, z } = wgs84ToScene(lat, lon);
    return [x, z];
  });
  if (pts.length > 1) {
    const last = pts[pts.length - 1];
    const first = pts[0];
    if (Math.abs(last[0] - first[0]) < 1e-6 && Math.abs(last[1] - first[1]) < 1e-6) {
      pts.pop();
    }
  }
  return pts;
}

/** Extract XZ polygon from NLS floorCorners [[x,y,z], …] */
function nlsToScenePolygon(floorCorners) {
  return floorCorners.map(([x, , z]) => [x, z]);
}

// ── 2-D polygon geometry helpers ─────────────────────────────────────────────

/** Signed area (positive = CCW in XZ plane) */
function signedArea(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i][0] * pts[j][1];
    a -= pts[j][0] * pts[i][1];
  }
  return a * 0.5;
}

/** Shoelace signed area — positive for CCW */
function polygonArea(pts) {
  return Math.abs(signedArea(pts));
}

/** Ensure polygon is CCW; reverse in-place if CW */
function ensureCCW(pts) {
  if (signedArea(pts) < 0) pts.reverse();
  return pts;
}

/** Centroid of polygon [[x,z], …] */
function polygonCentroid(pts) {
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  return [cx / pts.length, cz / pts.length];
}

/**
 * Sutherland–Hodgman polygon clipping.
 * Clips `subjectPolygon` against each edge of `clipPolygon`.
 * Both are [[x,z], …].  Returns clipped polygon (may be empty).
 */
function sutherlandHodgman(subjectPolygon, clipPolygon) {
  if (subjectPolygon.length === 0) return [];
  let output = subjectPolygon.slice();
  const n = clipPolygon.length;

  for (let i = 0; i < n; i++) {
    if (output.length === 0) return [];
    const input    = output;
    output         = [];
    const edgeA    = clipPolygon[i];
    const edgeB    = clipPolygon[(i + 1) % n];
    const edgeDX   = edgeB[0] - edgeA[0];
    const edgeDZ   = edgeB[1] - edgeA[1];

    // "inside" = cross product (edge × point) > 0  (left of directed edge)
    const inside = ([px, pz]) =>
      edgeDX * (pz - edgeA[1]) - edgeDZ * (px - edgeA[0]) >= 0;

    const intersect = ([ax, az], [bx, bz]) => {
      const dx = bx - ax, dz = bz - az;
      const denom = edgeDX * dz - edgeDZ * dx;
      if (Math.abs(denom) < 1e-10) return [ax, az]; // parallel
      const t = (edgeDX * (az - edgeA[1]) - edgeDZ * (ax - edgeA[0])) / denom;
      return [ax + t * dx, az + t * dz];
    };

    for (let j = 0; j < input.length; j++) {
      const curr = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const currIn = inside(curr);
      const prevIn = inside(prev);
      if (currIn) {
        if (!prevIn) output.push(intersect(prev, curr));
        output.push(curr);
      } else if (prevIn) {
        output.push(intersect(prev, curr));
      }
    }
  }
  return output;
}

/** Intersection-over-union of two XZ polygons (handles any winding).
 *  NOTE: Sutherland–Hodgman requires a convex clip polygon. For concave
 *  footprints the area can overflow; we clamp the result to [0,1]. */
function polygonIoU(polyA, polyB) {
  if (polyA.length < 3 || polyB.length < 3) return 0;
  // Normalize both to CCW before clipping
  const a = ensureCCW(polyA.slice());
  const b = ensureCCW(polyB.slice());
  const clipped = sutherlandHodgman(a, b);
  if (clipped.length < 3) return 0;
  const interArea = polygonArea(clipped);
  if (interArea < 1e-6) return 0;
  const areaA  = polygonArea(a);
  const areaB  = polygonArea(b);
  const raw = interArea / (areaA + areaB - interArea);
  // Clamp: concave polygon artefacts can produce values outside [0,1]
  return Math.max(0, Math.min(1, raw));
}

// ── Spatial join ──────────────────────────────────────────────────────────────

/**
 * Match each NLS building to the best OSM way.
 * Returns Map<nlsId, {osmWay, centroidDist, iou}>
 */
function spatialJoin(nlsBuildings, osmWays) {
  // Pre-compute OSM polygons + bbox
  const osmPolys = osmWays.map(way => {
    if (!way.geometry?.length) return null;
    const poly = wayToScenePolygon(way.geometry);
    if (poly.length < 3) return null;
    const xs = poly.map(p => p[0]);
    const zs = poly.map(p => p[1]);
    const centroid = polygonCentroid(poly);
    return {
      way,
      poly,
      centroid,
      bbox: { minX: Math.min(...xs), maxX: Math.max(...xs),
              minZ: Math.min(...zs), maxZ: Math.max(...zs) },
    };
  }).filter(Boolean);

  const result = new Map();

  for (const bldg of nlsBuildings) {
    if (!bldg.floorCorners?.length) continue;
    const nlsPoly      = nlsToScenePolygon(bldg.floorCorners);
    if (nlsPoly.length < 3) continue;
    const nlsCentroid  = polygonCentroid(nlsPoly);
    const nlsBbox      = bldg.box; // {minX,maxX,minZ,maxZ,minY,maxY}

    // Stage 1: bbox pre-filter (generous 20 m padding)
    const PAD = 20;
    const candidates = osmPolys.filter(o =>
      o.bbox.maxX >= nlsBbox.minX - PAD && o.bbox.minX <= nlsBbox.maxX + PAD &&
      o.bbox.maxZ >= nlsBbox.minZ - PAD && o.bbox.minZ <= nlsBbox.maxZ + PAD
    );

    if (candidates.length === 0) continue;

    // Stage 2: centroid distance + IoU scoring
    let best = null;
    for (const cand of candidates) {
      const dx   = cand.centroid[0] - nlsCentroid[0];
      const dz   = cand.centroid[1] - nlsCentroid[1];
      const dist = Math.hypot(dx, dz);
      if (dist > 25) continue; // coarse reject
      const iou  = polygonIoU(nlsPoly, cand.poly);
      if (!best || iou > best.iou || (iou === best.iou && dist < best.centroidDist)) {
        best = { osmWay: cand.way, centroidDist: dist, iou };
      }
    }

    if (best && (best.iou > 0.1 || best.centroidDist < 15)) {
      result.set(bldg.id, best);
    }
  }

  return result;
}

// ── Enrich + upsert ───────────────────────────────────────────────────────────

async function run() {
  // ── Load NLS full metadata ────────────────────────────────────────────────
  const metaPath = resolve(DATA_DIR, 'kerava-meta-full.json');
  if (!existsSync(metaPath)) {
    console.error('ERROR: data/kerava-meta-full.json not found. Run npm run preprocess-gml first.');
    process.exit(1);
  }
  const { buildings } = JSON.parse(await readFile(metaPath, 'utf8'));
  console.log(`NLS buildings loaded: ${buildings.length}`);

  // ── Fetch (or reuse cached) OSM building ways ─────────────────────────────
  const osmBuildingsPath = resolve(DATA_DIR, 'kerava-osm-buildings.json');
  let osmElements;
  if (existsSync(osmBuildingsPath)) {
    console.log('  Using cached data/kerava-osm-buildings.json (delete to re-fetch)');
    osmElements = JSON.parse(await readFile(osmBuildingsPath, 'utf8')).elements ?? [];
  } else {
    osmElements = await fetchOsmBuildings();
  }

  const osmWays = osmElements.filter(el => el.type === 'way' && el.geometry?.length);
  console.log(`OSM building ways with geometry: ${osmWays.length}`);

  // ── Spatial join ──────────────────────────────────────────────────────────
  console.log('Running spatial join …');
  const matches = spatialJoin(buildings, osmWays);
  console.log(`  Matched: ${matches.size} / ${buildings.length} NLS buildings`);

  // Stats
  const matched = [...matches.values()];
  if (matched.length) {
    const meanIou  = matched.reduce((s, m) => s + m.iou, 0) / matched.length;
    const meanDist = matched.reduce((s, m) => s + m.centroidDist, 0) / matched.length;
    console.log(`  Mean IoU: ${meanIou.toFixed(3)}  Mean centroid dist: ${meanDist.toFixed(1)} m`);
    const withColour = matched.filter(m => m.osmWay.tags?.['building:colour']).length;
    console.log(`  With building:colour: ${withColour}`);
  }

  // ── Load existing enriched.json ───────────────────────────────────────────
  await mkdir(DATA_DIR, { recursive: true });
  const enrichedPath = resolve(DATA_DIR, 'kerava-enriched.json');
  let existing = { entries: [] };
  if (existsSync(enrichedPath)) {
    existing = JSON.parse(await readFile(enrichedPath, 'utf8'));
  }

  // Index existing entries by nlsId
  const byNlsId = new Map();
  for (const entry of existing.entries) {
    if (entry.nlsId) byNlsId.set(entry.nlsId, entry);
  }

  // ── Upsert matched entries ─────────────────────────────────────────────────
  let newCount = 0, updatedCount = 0;

  for (const [nlsId, { osmWay, centroidDist, iou }] of matches) {
    // Harvest tags
    const rawTags = osmWay.tags ?? {};
    const tags = {};
    for (const key of HARVEST_TAGS) {
      if (rawTags[key] !== undefined) tags[key] = rawTags[key];
    }

    // Derive game category from OSM building type
    const osmCat = OSM_CATEGORY[rawTags.building] ?? null;

    const osmBlock = {
      id:        osmWay.id,
      version:   osmWay.version,
      timestamp: osmWay.timestamp,
      tags,
      ...(osmCat ? { category: osmCat } : {}),
      match: {
        quality:      iou > 0.5 ? 'high' : iou > 0.1 ? 'medium' : 'low',
        centroidDist: Math.round(centroidDist * 10) / 10,
        iou:          Math.round(iou * 1000) / 1000,
      },
    };

    if (byNlsId.has(nlsId)) {
      // Update only the `osm` block — preserve all manual fields
      byNlsId.get(nlsId).osm = osmBlock;
      updatedCount++;
    } else {
      // New entry — create minimal skeleton
      const entry = { nlsId, osm: osmBlock };
      existing.entries.push(entry);
      byNlsId.set(nlsId, entry);
      newCount++;
    }
  }

  // Sort entries: matched first (have osm block), then by nlsId for stability
  existing.entries.sort((a, b) => {
    const aHas = a.osm ? 0 : 1;
    const bHas = b.osm ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    return (a.nlsId ?? '').localeCompare(b.nlsId ?? '');
  });

  await writeFile(enrichedPath, JSON.stringify(existing, null, 2));
  console.log(`  data/kerava-enriched.json: ${newCount} new, ${updatedCount} updated entries`);
  console.log('\nRun "node scripts/strip-meta.mjs" to push changes to public/');
  console.log('Done ✓');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
