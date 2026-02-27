"""
crop-aerial.py  —  Kerava aerial texture preprocessor
======================================================
Reads  scripts/kerava-source.png  (or .jpg)
Writes public/kerava-aerial.jpg   (2048×2048, SRGB)

Automatic detection:
  • Blue centre dot  → crop centre (= Kerava station, game origin)
  • Orange ruler at bottom → pixel scale (m/px)

Target output: 1100 × 1100 m centred on the station, scaled to 2048×2048 px.
"""

from pathlib import Path
import sys
import numpy as np
from PIL import Image, ImageFilter

# ── 1. Locate source image ──────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
CANDIDATES = [
    ROOT / "scripts" / "kerava-source.png",
    ROOT / "scripts" / "kerava-source.jpg",
    ROOT / "scripts" / "kerava-source.jpeg",
]
src_path = next((p for p in CANDIDATES if p.exists()), None)
if src_path is None:
    sys.exit("ERROR: Save the aerial screenshot as  scripts/kerava-source.png  then re-run.")

print(f"Source: {src_path}")
img = Image.open(src_path).convert("RGB")
arr = np.array(img)
H, W = arr.shape[:2]
print(f"Image size: {W} × {H} px")

# ── 2. Detect orange ruler (bottom 15 % of image) ──────────────────────────
# Orange: R > 200, G 80–170, B < 80
bot = arr[int(H * 0.85):, :, :]
orange_mask = (
    (bot[:, :, 0] > 200) &
    (bot[:, :, 1] > 80)  & (bot[:, :, 1] < 180) &
    (bot[:, :, 2] < 80)
)
orange_cols = np.where(orange_mask.any(axis=0))[0]
if len(orange_cols) < 20:
    sys.exit("ERROR: Could not detect orange ruler. Check that the bottom of the image has the orange scale bar.")

ruler_px_left  = int(orange_cols.min())
ruler_px_right = int(orange_cols.max())
ruler_px_len   = ruler_px_right - ruler_px_left
RULER_METRES   = 500.0          # ruler represents ~500 m
m_per_px       = RULER_METRES / ruler_px_len
print(f"Ruler: x={ruler_px_left}–{ruler_px_right}  ({ruler_px_len} px = {RULER_METRES} m)")
print(f"Scale: {m_per_px:.4f} m/px  ({1/m_per_px:.2f} px/m)")

# ── 3. Detect blue centre dot ───────────────────────────────────────────────
# Blue dot: R < 120, G < 120, B > 160, and B is clearly dominant
blue_mask = (
    (arr[:, :, 0] < 120) &
    (arr[:, :, 1] < 130) &
    (arr[:, :, 2] > 160) &
    (arr[:, :, 2].astype(int) - arr[:, :, 0].astype(int) > 60)
)
blue_ys, blue_xs = np.where(blue_mask)
if len(blue_xs) < 5:
    sys.exit("ERROR: Could not detect blue centre dot. Make sure the blue station marker is visible.")

cx = int(blue_xs.mean())
cy = int(blue_ys.mean())
print(f"Blue dot centre: ({cx}, {cy})")

# ── 4. Compute crop box for 1100 × 1100 m ──────────────────────────────────
TARGET_METRES = 1100           # full game terrain size
half_px = int(round((TARGET_METRES / 2) / m_per_px))
print(f"Half-size: {half_px} px  ({half_px * m_per_px:.1f} m)")

x0, y0 = cx - half_px, cy - half_px
x1, y1 = cx + half_px, cy + half_px

# Clamp to image bounds, track padding needed
pad_left   = max(0, -x0);  x0 = max(0, x0)
pad_top    = max(0, -y0);  y0 = max(0, y0)
pad_right  = max(0, x1 - W); x1 = min(W, x1)
pad_bottom = max(0, y1 - H); y1 = min(H, y1)

print(f"Crop: ({x0},{y0}) → ({x1},{y1}), padding L{pad_left} T{pad_top} R{pad_right} B{pad_bottom}")

# ── 5. Crop, pad with edge colour where image doesn't reach ─────────────────
GROUND_COLOUR = (158, 144, 112)   # matches MAT_GROUND #9e9070

crop = img.crop((x0, y0, x1, y1))
total_w = pad_left + crop.width  + pad_right
total_h = pad_top  + crop.height + pad_bottom

if pad_left or pad_top or pad_right or pad_bottom:
    canvas = Image.new("RGB", (total_w, total_h), GROUND_COLOUR)
    canvas.paste(crop, (pad_left, pad_top))
    crop = canvas
    print(f"Padded to {total_w} × {total_h} px")

# ── 6. Slight brightness lift so Lambert shading doesn't crush colours ───────
# Lift shadows by blending 15 % white into the image
lifted = Image.blend(crop, Image.new("RGB", crop.size, (255,255,255)), 0.08)

# ── 7. Resize to 2048 × 2048 (power-of-two GPU texture) ────────────────────
OUT_SIZE = 2048
out = lifted.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)

# ── 8. Save ──────────────────────────────────────────────────────────────────
out_path = ROOT / "public" / "kerava-aerial.jpg"
out.save(out_path, "JPEG", quality=82, optimize=True)
size_kb = out_path.stat().st_size // 1024
print(f"Saved: {out_path}  ({OUT_SIZE}×{OUT_SIZE} px, {size_kb} KB)")
print("Done ✓")
