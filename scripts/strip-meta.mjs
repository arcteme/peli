#!/usr/bin/env node
/**
 * strip-meta.mjs
 *
 * Reads the full metadata from data/kerava-meta-full.json and writes
 * two client-safe JSON files to public/:
 *
 *   public/kerava-meta.json   – only the fields the client engine actually needs
 *                               (buildingCount, wallGroups, buildings[].box/.category)
 *   public/kerava-pois.json   – selected OSM points of interest for display
 *                               (requires data/kerava-osm-raw.json)
 *
 * data/ is committed to the private git repo and may contain full NLS/OSM/enrichment
 * data. public/ contains only what is intentionally served to browser clients.
 *
 * Usage
 *   node scripts/strip-meta.mjs
 *
 * This script is run automatically as part of:
 *   npm run preprocess-gml   (after process-gml.mjs)
 *   npm run build            (before vite build)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync }                 from 'node:fs';
import { resolve, dirname }           from 'node:path';
import { fileURLToPath }              from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = resolve(__dirname, '../data');
const OUT_DIR   = resolve(__dirname, '../public');

// ── Fields allowed through to the client from the buildings array ─────────────

/**
 * Core fields copied verbatim from kerava-meta-full.json per building.
 * Additional enrichment-derived fields (wallColour, roofColour, etc.) are
 * merged below from kerava-enriched.json.
 */
const BUILDING_COPY_FIELDS = ['box', 'category', 'wallVertStart', 'wallVertCount', 'roofVertStart', 'roofVertCount'];

/** OSM building type → game category (mirrors enrich-osm.mjs) */
const OSM_CATEGORY = {
  apartments: 'residential', residential: 'residential',
  house: 'residential', detached: 'residential',
  semidetached_house: 'residential', terrace: 'residential',
  bungalow: 'residential', dormitory: 'residential',
  commercial: 'commercial', retail: 'commercial',
  supermarket: 'commercial', office: 'commercial',
  hotel: 'commercial', kiosk: 'commercial', mall: 'commercial', bank: 'commercial',
  public: 'civic', civic: 'civic',
  school: 'civic', university: 'civic', college: 'civic',
  hospital: 'civic', church: 'civic', cathedral: 'civic',
  chapel: 'civic', government: 'civic', train_station: 'civic',
  transportation: 'civic', fire_station: 'civic',
  library: 'civic', community_centre: 'civic',
  industrial: 'industrial', warehouse: 'industrial',
  factory: 'industrial', garage: 'industrial',
  garages: 'industrial', shed: 'industrial',
  service: 'industrial', storage_tank: 'industrial',
};

// ── OSM POI: tags that are safe/useful to expose to players ──────────────────

/**
 * OSM tags to include in public/kerava-pois.json.
 * All other OSM tags (user data, versions, changesets, etc.) are dropped.
 */
const OSM_POI_ALLOWED_TAGS = new Set([
  'name', 'name:fi', 'name:en', 'name:sv',
  'amenity', 'shop', 'tourism', 'historic',
  'railway', 'aeroway', 'leisure',
  'building',
]);

// ── strip-meta ────────────────────────────────────────────────────────────────

async function run() {
  console.log('strip-meta: reading data/kerava-meta-full.json …');

  const fullPath = resolve(DATA_DIR, 'kerava-meta-full.json');
  if (!existsSync(fullPath)) {
    console.error('  ERROR: data/kerava-meta-full.json not found.');
    console.error('  Run "npm run preprocess-gml" first.');
    process.exit(1);
  }

  const full = JSON.parse(await readFile(fullPath, 'utf8'));

  // ── Load enrichment index (keyed by nlsId) ────────────────────────────────
  const enrichPath = resolve(DATA_DIR, 'kerava-enriched.json');
  const enrichByNlsId = new Map();
  if (existsSync(enrichPath)) {
    const enriched = JSON.parse(await readFile(enrichPath, 'utf8'));
    for (const entry of enriched.entries ?? []) {
      if (entry.nlsId) enrichByNlsId.set(entry.nlsId, entry);
    }
    console.log(`  kerava-enriched.json: ${enrichByNlsId.size} entries loaded`);
  }

  // ── Strip buildings to public fields only ────────────────────────────────
  let enrichedCount = 0;
  const publicBuildings = full.buildings.map(b => {
    const out = {};
    for (const key of BUILDING_COPY_FIELDS) {
      if (key in b) out[key] = b[key];
    }

    // Merge enrichment data (publicOverrides win over auto-detected OSM values)
    const entry = enrichByNlsId.get(b.id);
    if (entry) {
      const osm = entry.osm ?? {};
      const ov  = entry.publicOverrides ?? {};

      // Category: publicOverrides > OSM-derived > geometry heuristic (already in out.category)
      const osmCat = osm.category ?? OSM_CATEGORY[osm.tags?.building] ?? null;
      if (ov.category)        out.category  = ov.category;
      else if (osmCat)        out.category  = osmCat;

      // Colours and roof — only emit if a value exists (null-free output)
      const wallColour = ov.wallColour  ?? osm.tags?.['building:colour'] ?? null;
      const roofColour = ov.roofColour  ?? osm.tags?.['roof:colour']     ?? null;
      const roofShape  = ov.roofShape   ?? osm.tags?.['roof:shape']      ?? null;
      const label      = ov.label       ?? osm.tags?.name                ?? osm.tags?.['name:fi'] ?? null;

      if (wallColour) out.wallColour = wallColour;
      if (roofColour) out.roofColour = roofColour;
      if (roofShape)  out.roofShape  = roofShape;
      if (label)      out.label      = label;

      enrichedCount++;
    }

    return out;
  });

  const withColour   = publicBuildings.filter(b => b.wallColour).length;
  const withRoof     = publicBuildings.filter(b => b.roofColour).length;
  const withShape    = publicBuildings.filter(b => b.roofShape).length;

  const publicMeta = {
    buildingCount: full.buildingCount,
    wallGroups:    full.wallGroups,
    buildings:     publicBuildings,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    resolve(OUT_DIR, 'kerava-meta.json'),
    JSON.stringify(publicMeta),
  );
  console.log(`  public/kerava-meta.json: ${publicBuildings.length} buildings`);
  console.log(`    enriched: ${enrichedCount}  wallColour: ${withColour}  roofColour: ${withRoof}  roofShape: ${withShape}`);

  // ── OSM POIs (optional — skip gracefully if raw data not present) ──────────
  const osmPath = resolve(DATA_DIR, 'kerava-osm-raw.json');
  if (!existsSync(osmPath)) {
    console.log('  data/kerava-osm-raw.json not found — skipping public/kerava-pois.json');
    console.log('  Run "npm run fetch-osm" to download OSM data.');
    console.log('Done ✓');
    return;
  }

  console.log('  reading data/kerava-osm-raw.json …');
  const osmRaw = JSON.parse(await readFile(osmPath, 'utf8'));

  // Merge developer enrichments into POIs (keyed by osmId)
  let poisEnrichments = {};
  if (existsSync(enrichPath)) {
    const enriched = JSON.parse(await readFile(enrichPath, 'utf8'));
    for (const entry of enriched.entries ?? []) {
      if (entry.osm?.id)  poisEnrichments[entry.osm.id]  = entry.public ?? {};
      if (entry.osmId)    poisEnrichments[entry.osmId]   = entry.public ?? {};
    }
  }

  const pois = [];
  for (const el of osmRaw.elements ?? []) {
    if (!el.tags) continue;

    // Only include nodes and ways that have at least one allowed tag
    const allowedTags = {};
    for (const [k, v] of Object.entries(el.tags)) {
      if (OSM_POI_ALLOWED_TAGS.has(k)) allowedTags[k] = v;
    }
    if (Object.keys(allowedTags).length === 0) continue;

    const poi = {
      id:   el.id,
      type: el.type,
      tags: allowedTags,
    };

    // Geometry: node has lat/lon directly; way has a center if Overpass returned it
    if (el.type === 'node') {
      poi.lat = el.lat;
      poi.lon = el.lon;
    } else if (el.center) {
      poi.lat = el.center.lat;
      poi.lon = el.center.lon;
    }

    // Merge public enrichment fields (if any)
    if (poisEnrichments[el.id]) {
      Object.assign(poi, poisEnrichments[el.id]);
    }

    pois.push(poi);
  }

  await writeFile(
    resolve(OUT_DIR, 'kerava-pois.json'),
    JSON.stringify({ pois }),
  );
  console.log(`  public/kerava-pois.json: ${pois.length} POIs`);
  console.log('Done ✓');
}

run();
