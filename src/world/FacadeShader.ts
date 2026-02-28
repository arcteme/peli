/**
 * FacadeShader.ts
 *
 * Procedural window-grid facade system for building walls.
 * Uses MeshPhongMaterial + onBeforeCompile to inject world-space UV projection
 * and a per-window hash-based lighting shader — no pre-baked UV attributes needed.
 *
 * Window appearance:
 *   Day   : blue-grey sky reflection on dark glass; ~12 % randomly lit (blinds open)
 *   Night : dark glass with ~65 % of windows showing warm yellow interior light
 *
 * Public API:
 *   FacadeMaterials         – Record<BuildingCategory, MeshPhongMaterial>
 *   setTimeOfDay(h)         – update all materials' time uniform (0–24)
 *   setFacadeTexture(c, t)  – assign a tileable facade texture to one category
 */

import * as THREE from 'three';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BuildingCategory =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'civic'
  | 'unknown';

// ── Shared uniform for time-of-day (all materials share one ref) ──────────────

const _timeRef: { value: number } = { value: 12.0 };

/** Update the time-of-day for all facade materials (hour, 0–24). */
export function setTimeOfDay(hours: number): void {
  _timeRef.value = hours;
}

// ── GLSL helpers injected into every facade material ──────────────────────────

const GLSL_COMMON_INJECT = /* glsl */`
varying vec3 vFacadeWorldPos;
varying vec3 vFaceExt;       // .x = face horizontal span (m), .y = faceMaxY, .z = faceMinY
uniform float timeOfDay;

float facadeHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 facadeWindowUV(vec3 worldPos) {
  const float SPACING      = 3.2;
  const float FLOOR_HEIGHT = 3.1;

  vec3 wNormal = normalize(cross(dFdx(worldPos), dFdy(worldPos)));
  vec3 absN    = abs(wNormal);

  float uRaw = (absN.x > absN.z) ? worldPos.z : worldPos.x;
  return vec2(uRaw / SPACING, (worldPos.y - vFaceExt.z) / FLOOR_HEIGHT);
}

/**
 * Compute the window overlay.
 * Suppression is cell-based (whole grid cell must be in the valid zone)
 * so windows never appear partial at top or bottom.
 *
 * Valid zone: skip floor 0 (ground floor) and the topmost floor cell.
 *   floorCell 0           → ground floor, no windows
 *   floorCell >= topFloor → top band, no windows
 * Narrow faces (faceWidth < MIN_FACE_WIDTH) get no windows at all.
 */
vec4 facadeWindowOverlay(vec3 worldPos) {
  const float FLOOR_HEIGHT    = 3.1;
  const float MIN_FACE_WIDTH  = 7.0;
  const float MARGIN_H        = 0.22;
  const float MARGIN_V        = 0.24;

  float faceWidth = vFaceExt.x;
  float faceMaxY  = vFaceExt.y;
  float faceMinY  = vFaceExt.z;

  // Narrow face — no windows
  if (faceWidth < MIN_FACE_WIDTH) return vec4(0.0);

  float faceHeight = faceMaxY - faceMinY;
  float totalFloors = faceHeight / FLOOR_HEIGHT;

  // Fewer than 2 floors of wall height → no room for windowed floors
  if (totalFloors < 2.0) return vec4(0.0);

  vec2 uv       = facadeWindowUV(worldPos);  // uv.y = 0 at faceMinY
  vec2 cell     = floor(uv);

  // Cell-level suppression: reject ground floor (cell 0) and top floor (cell >= totalFloors-1)
  if (cell.y < 1.0)                        return vec4(0.0); // ground floor
  if (cell.y >= (totalFloors - 1.0))       return vec4(0.0); // top floor band

  vec2  f    = fract(uv);

  float wx = smoothstep(MARGIN_H,       MARGIN_H       + 0.06, f.x)
           * smoothstep(1.0 - MARGIN_H, 1.0 - MARGIN_H - 0.06, f.x);
  float wy = smoothstep(MARGIN_V,       MARGIN_V       + 0.06, f.y)
           * smoothstep(1.0 - MARGIN_V, 1.0 - MARGIN_V - 0.06, f.y);
  float mask = wx * wy;

  float rnd     = facadeHash(cell);
  bool  isNight = (timeOfDay < 6.5 || timeOfDay > 20.5);
  float litFrac = isNight ? 0.65 : 0.12;
  float lit     = step(1.0 - litFrac, rnd);

  vec3 dayDark    = vec3(0.22, 0.35, 0.52);
  vec3 dayBright  = vec3(0.75, 0.82, 0.90);
  vec3 nightDark  = vec3(0.03, 0.03, 0.06);
  vec3 nightLight = vec3(0.98, 0.86, 0.52);

  vec3 winColour = isNight
    ? mix(nightDark, nightLight, lit)
    : mix(dayDark,   dayBright,  lit);

  return vec4(winColour, mask);
}
`;

// Emissive glow for lit night windows (injected after emissivemap_fragment)
// Three.js MeshPhongMaterial uses `totalEmissiveRadiance` at this point.
const GLSL_EMISSIVE_INJECT = /* glsl */`
{
  bool _isNight = (timeOfDay < 6.5 || timeOfDay > 20.5);
  if (_isNight) {
    const float FLOOR_HEIGHT   = 3.1;
    const float MIN_FACE_WIDTH = 7.0;

    float faceWidth  = vFaceExt.x;
    float faceMaxY   = vFaceExt.y;
    float faceMinY   = vFaceExt.z;
    float totalFloors = (faceMaxY - faceMinY) / FLOOR_HEIGHT;

    if (faceWidth >= MIN_FACE_WIDTH && totalFloors >= 2.0) {
      vec2  wuv  = facadeWindowUV(vFacadeWorldPos);  // uv.y relative to faceMinY
      vec2  cell = floor(wuv);

      if (cell.y >= 1.0 && cell.y < (totalFloors - 1.0)) {
        vec2  f    = fract(wuv);
        const float MARGIN_H = 0.22;
        const float MARGIN_V = 0.24;
        float wx = smoothstep(MARGIN_H,       MARGIN_H       + 0.06, f.x)
                 * smoothstep(1.0 - MARGIN_H, 1.0 - MARGIN_H - 0.06, f.x);
        float wy = smoothstep(MARGIN_V,       MARGIN_V       + 0.06, f.y)
                 * smoothstep(1.0 - MARGIN_V, 1.0 - MARGIN_V - 0.06, f.y);

        float rnd = facadeHash(cell);
        float lit = step(0.35, rnd);

        totalEmissiveRadiance += wx * wy * lit * vec3(0.92, 0.72, 0.28) * 0.55;
      }
    }
  }
}
`;

// Blend window overlay into diffuseColor after map_fragment sampling
const GLSL_DIFFUSE_INJECT = /* glsl */`
{
  vec4 winOverlay = facadeWindowOverlay(vFacadeWorldPos);
  diffuseColor.rgb = mix(diffuseColor.rgb, winOverlay.rgb, winOverlay.a * 0.82);
}
`;

// ── Material factory ──────────────────────────────────────────────────────────

function makeFacadeMaterial(
  wallColor: number,
  label: string,
): THREE.MeshPhongMaterial {
  const mat = new THREE.MeshPhongMaterial({
    color:        0xffffff,   // vertex colours supply the actual base; white = neutral multiplier
    shininess:    6,
    side:         THREE.DoubleSide,
    vertexColors: true,
  });

  // Unique cache key so each category compiles its own shader program
  mat.customProgramCacheKey = () => `facade-${label}`;

  mat.onBeforeCompile = (shader) => {
    // Bind shared time uniform
    shader.uniforms['timeOfDay'] = _timeRef;

    // ── Vertex shader: compute world position, pass face extent ──────────
    shader.vertexShader = shader.vertexShader
      // Declare custom varyings alongside Three.js built-ins
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aFaceExt;       // .x faceWidth, .y faceMaxY, .z faceMinY
varying vec3 vFacadeWorldPos;
varying vec3 vFaceExt;`,
      )
      // Compute world-space position and face extent in begin_vertex
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFacadeWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
vFaceExt = aFaceExt;`,
      );

    // ── Fragment shader: window grid ──────────────────────────────────────
    shader.fragmentShader = shader.fragmentShader
      // 1. Inject common helpers and varying declarations
      .replace(
        '#include <common>',
        `#include <common>\n${GLSL_COMMON_INJECT}`,
      )
      // 2. After vertex colour (color_fragment) applies the per-building OSM colour,
      //    composite the procedural window grid on top.
      //    (No facade textures — they would require UV coords the wall mesh lacks.)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${GLSL_DIFFUSE_INJECT}`,
      )
      // 3. Add emissive glow for lit windows at night
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n${GLSL_EMISSIVE_INJECT}`,
      );
  };

  return mat;
}

// ── Exported material palette ─────────────────────────────────────────────────

export const FacadeMaterials: Record<BuildingCategory, THREE.MeshPhongMaterial> = {
  residential: makeFacadeMaterial(0xd4cdc4, 'residential'), // cream plaster
  commercial:  makeFacadeMaterial(0xa8a89a, 'commercial'),  // concrete grey
  industrial:  makeFacadeMaterial(0x8a8880, 'industrial'),  // metal grey
  civic:       makeFacadeMaterial(0xc8b89a, 'civic'),       // warm stone
  unknown:     makeFacadeMaterial(0xc0b8b0, 'unknown'),     // neutral fallback
};

/**
 * Assign a tileable facade texture to one category.
 * Call this from CityMap after loading textures with THREE.TextureLoader.
 */
export function setFacadeTexture(
  category: BuildingCategory,
  tex: THREE.Texture,
): void {
  const mat = FacadeMaterials[category];
  mat.map = tex;
  mat.needsUpdate = true;
}
