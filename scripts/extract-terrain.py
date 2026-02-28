"""
extract-terrain.py  —  Kerava LiDAR terrain extractor
======================================================
Reads  src/world/L4143F.tif  (NLS LiDAR, ETRS-TM35FIN / N2000, 2 m resolution)
Writes public/kerava-terrain.bin  (551×551 Float32 heights in scene units)

Binary format (matches CityMap._applyTerrain):
  [COLS: Uint32][ROWS: Uint32]  (8-byte header)
  Float32[COLS × ROWS]          (row-major, row 0 = north edge of scene)

Coordinate mapping (same as process-gml.mjs):
  scene_x =  E − 395631          (East  → +X)
  scene_z = -(N − 6697831)       (North → −Z)
  scene_y =  elevation − BASE_ELEV

Grid layout (terrainHeightAt in CityMap.ts expects this exact mapping):
  cell (col, row): scene_x = −550 + col×2,  scene_z = −550 + row×2
  So E = 395631 + (−550 + col×2),  N = 6697831 − (−550 + row×2)

Run:
  pip install rasterio numpy
  python scripts/extract-terrain.py
"""

from pathlib import Path
import sys
import struct
import numpy as np

try:
    import rasterio
    from rasterio.transform import rowcol
except ImportError:
    sys.exit("ERROR: rasterio not installed. Run:  pip install rasterio numpy")

# ── Constants ──────────────────────────────────────────────────────────────────

import math

ROOT       = Path(__file__).parent.parent
TIFF_PATH  = ROOT / "src" / "world" / "L4143F.tif"
OUT_PATH   = ROOT / "public" / "kerava-terrain.bin"

CENTER_E   = 395631   # scene origin in ETRS-TM35FIN Easting
CENTER_N   = 6697831  # scene origin in ETRS-TM35FIN Northing
BASE_ELEV  = 30.0     # N2000 metres subtracted from all elevations (same as process-gml.mjs)

HALF       = 550      # terrain mesh half-extent in metres
COLS       = 551      # grid width  (HALF*2 / 2m + 1 = 551)
ROWS       = 551      # grid height
CELL       = 2.0      # metres per cell — matches LiDAR resolution

# The terrain mesh now sits at scene-space identity (rotation.x=-π/2 only, no
# scale/offset/rotZ).  Vertex (col, row) represents scene point:
#   scene_x = -HALF + col * CELL
#   scene_z = -HALF + row * CELL
# which maps to ETRS-TM35FIN:
#   E = CENTER_E + scene_x
#   N = CENTER_N - scene_z  (North → -Z in scene)

# ── Open raster ───────────────────────────────────────────────────────────────

print(f"Opening: {TIFF_PATH}")
if not TIFF_PATH.exists():
    sys.exit(f"ERROR: {TIFF_PATH} not found — make sure src/world/L4143F.tif is present.")

with rasterio.open(TIFF_PATH) as src:
    print(f"  CRS    : {src.crs}")
    print(f"  Shape  : {src.height} × {src.width} px")
    print(f"  Bounds : {src.bounds}")
    print(f"  NoData : {src.nodata}")
    print(f"  Bands  : {src.count}")

    band = 1  # elevation is always band 1 in NLS DSM/DTM tiffs
    nodata = src.nodata

    # Build sample coordinates: scene-space vertex positions → ETRS-TM35FIN
    col_idx = np.arange(COLS, dtype=np.float64)
    row_idx = np.arange(ROWS, dtype=np.float64)

    scene_x = -HALF + col_idx * CELL          # (COLS,)
    scene_z = -HALF + row_idx * CELL          # (ROWS,)

    E_coords = CENTER_E + scene_x             # (COLS,) — Easting
    N_coords = CENTER_N - scene_z             # (ROWS,) — Northing (scene_z = -(N-CENTER_N))

    # Sample the raster at all (E, N) pairs.
    # rasterio.sample() takes an iterable of (x, y) = (E, N) for EPSG:3067.
    E_grid, N_grid = np.meshgrid(E_coords, N_coords)  # both (ROWS, COLS)
    pts = list(zip(E_grid.ravel().tolist(), N_grid.ravel().tolist()))

    print(f"Sampling {COLS}×{ROWS} = {len(pts):,} points…  (this may take a moment)")
    raw = list(src.sample(pts, indexes=band))

# ── Process elevations ────────────────────────────────────────────────────────

elevations = np.array(raw, dtype=np.float64).reshape(ROWS, COLS)

# Replace NoData (water / outside raster extent) with 0 scene height
if nodata is not None:
    elevations[elevations == nodata] = BASE_ELEV  # → scene height 0
else:
    # Typical NLS NoData sentinel values
    elevations[elevations < -9000] = BASE_ELEV
    elevations[elevations > 9000]  = BASE_ELEV

# Convert N2000 metres → scene Y (same shift as process-gml.mjs)
# L4143F.tif is Korkeusmalli 2 m (KM2) — a true ground DTM, buildings/trees
# already classified out.  No erosion needed; just a light 3×3 Gaussian smooth
# to remove single-pixel LiDAR measurement noise.
from scipy.ndimage import gaussian_filter
heights = (elevations - BASE_ELEV).astype(np.float32)
heights = gaussian_filter(heights, sigma=0.8).astype(np.float32)  # sub-cell smooth only

print(f"Height range: {heights.min():.2f} … {heights.max():.2f} m (scene units)")
# Scene origin (0,0) = Kerava station; grid centre col=275, row=275
print(f"Scene origin (0,0) height: {heights[ROWS//2, COLS//2]:.2f} m  (Kerava station, expect ~10–15 m)")

# ── Write binary ──────────────────────────────────────────────────────────────

OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
header = struct.pack('<II', COLS, ROWS)
with open(OUT_PATH, 'wb') as f:
    f.write(header)
    f.write(heights.ravel().tobytes())

size_kb = OUT_PATH.stat().st_size / 1024
print(f"Written: {OUT_PATH}  ({size_kb:.1f} KB, expected ~1213 KB)")
print("Done. Reload the game to see updated terrain.")
