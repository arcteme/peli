#!/usr/bin/env node
/**
 * fetch-osm.mjs
 *
 * Downloads OpenStreetMap data for the Kerava play area via the Overpass API
 * and saves the raw response to data/kerava-osm-raw.json (gitignored).
 *
 * The query fetches:
 *   - All named nodes, ways and relations within the play-area bounding box
 *   - Includes amenities, shops, tourism, historic, railway and leisure features
 *
 * Usage
 *   node scripts/fetch-osm.mjs
 *
 * After running, execute:
 *   node scripts/strip-meta.mjs
 * to merge OSM data into public/kerava-pois.json.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync }        from 'node:fs';
import { resolve, dirname }  from 'node:path';
import { fileURLToPath }     from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = resolve(__dirname, '../data');

// ── Play-area geometry (EPSG:4326) ────────────────────────────────────────────
// Centre: Kerava railway station  60.403333°N, 25.105556°E
// Radius: 500 m  →  ~0.0045° lat, ~0.0065° lon at this latitude
const CENTER_LAT =  60.403333;
const CENTER_LON =  25.105556;
const RADIUS_DEG_LAT = 0.0055;
const RADIUS_DEG_LON = 0.0075;

const SOUTH = CENTER_LAT - RADIUS_DEG_LAT;
const NORTH = CENTER_LAT + RADIUS_DEG_LAT;
const WEST  = CENTER_LON - RADIUS_DEG_LON;
const EAST  = CENTER_LON + RADIUS_DEG_LON;

// Overpass API endpoint (public instance)
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// ── Query: nodes + ways with useful tags, with centre geometry for ways ────────
const QUERY = `
[out:json][timeout:30];
(
  node["name"](${SOUTH},${WEST},${NORTH},${EAST});
  node["amenity"](${SOUTH},${WEST},${NORTH},${EAST});
  node["shop"](${SOUTH},${WEST},${NORTH},${EAST});
  node["tourism"](${SOUTH},${WEST},${NORTH},${EAST});
  node["historic"](${SOUTH},${WEST},${NORTH},${EAST});
  node["railway"](${SOUTH},${WEST},${NORTH},${EAST});
  node["leisure"](${SOUTH},${WEST},${NORTH},${EAST});
  way["name"](${SOUTH},${WEST},${NORTH},${EAST});
  way["amenity"](${SOUTH},${WEST},${NORTH},${EAST});
  way["shop"](${SOUTH},${WEST},${NORTH},${EAST});
  way["tourism"](${SOUTH},${WEST},${NORTH},${EAST});
  way["historic"](${SOUTH},${WEST},${NORTH},${EAST});
  way["railway"](${SOUTH},${WEST},${NORTH},${EAST});
  way["leisure"](${SOUTH},${WEST},${NORTH},${EAST});
);
out center tags;
`.trim();

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function run() {
  await mkdir(DATA_DIR, { recursive: true });

  const outPath = resolve(DATA_DIR, 'kerava-osm-raw.json');

  console.log(`Querying Overpass API for bbox ${SOUTH.toFixed(4)},${WEST.toFixed(4)},${NORTH.toFixed(4)},${EAST.toFixed(4)} …`);
  console.log(`POST ${OVERPASS_URL}`);

  const response = await fetch(OVERPASS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `data=${encodeURIComponent(QUERY)}`,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`  ERROR: HTTP ${response.status}`);
    console.error(text.slice(0, 500));
    process.exit(1);
  }

  const data = await response.json();
  const count = data.elements?.length ?? 0;

  await writeFile(outPath, JSON.stringify(data, null, 2));
  console.log(`  data/kerava-osm-raw.json: ${count} elements`);
  console.log('\nRun "node scripts/strip-meta.mjs" to generate public/kerava-pois.json');
  console.log('Done ✓');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
