"""
generate-facade-textures.py
============================
Generates placeholder tileable facade textures for the building window shader.

Replace these with AI-generated images for better quality.

Suggested AI prompts (DALL-E 3 / Stable Diffusion sdxl):
  residential:
    "seamless tileable apartment building wall texture, pale cream painted plaster,
     subtle color variation, no windows, flat miniature diorama style, 512x512"
  commercial:
    "seamless tileable commercial building facade, light gray concrete panels,
     subtle surface variation, no windows, miniature model style, 512x512"
  industrial:
    "seamless tileable industrial corrugated metal wall texture, dark steel grey,
     horizontal ridges, no windows, flat colors, 512x512"
  civic:
    "seamless tileable brick wall texture, warm sandy-red brick, regular mortar
     lines, clean, miniature diorama style, 512x512"

Usage:
  python scripts/generate-facade-textures.py
Output:
  public/textures/facade-{residential,commercial,industrial,civic}.webp
"""

import random
import os
from PIL import Image, ImageDraw, ImageFilter

SIZE = 512
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures')
os.makedirs(OUT_DIR, exist_ok=True)


def add_noise(img, amount=6):
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            n = random.randint(-amount, amount)
            r, g, b = px[x, y]
            px[x, y] = (max(0, min(255, r + n)),
                        max(0, min(255, g + n)),
                        max(0, min(255, b + n)))
    return img


def make_plaster(base_rgb, noise=8):
    """Cream plaster — flat base with subtle tonal streaks."""
    img = Image.new('RGB', (SIZE, SIZE), base_rgb)
    draw = ImageDraw.Draw(img)
    br, bg, bb = base_rgb
    for _ in range(60):
        y = random.randint(0, SIZE)
        h = random.randint(1, 3)
        dy = random.randint(-5, 5)
        col = (max(0, min(255, br + dy)),
               max(0, min(255, bg + dy)),
               max(0, min(255, bb + dy)))
        draw.rectangle([0, y, SIZE, y + h], fill=col)
    img = img.filter(ImageFilter.GaussianBlur(1))
    return add_noise(img, noise)


def make_concrete(base_rgb):
    """Concrete panels — faint horizontal joints."""
    img = Image.new('RGB', (SIZE, SIZE), base_rgb)
    draw = ImageDraw.Draw(img)
    br, bg, bb = base_rgb
    panel_h = 64
    for row in range(SIZE // panel_h + 1):
        y = row * panel_h
        joint = (max(0, br - 12), max(0, bg - 12), max(0, bb - 12))
        draw.line([(0, y), (SIZE, y)], fill=joint, width=2)
        tone = random.randint(-5, 5)
        fill = (max(0, min(255, br + tone)),
                max(0, min(255, bg + tone)),
                max(0, min(255, bb + tone)))
        if y + panel_h - 2 < SIZE:
            draw.rectangle([0, y + 2, SIZE, y + panel_h - 2], fill=fill)
    img = img.filter(ImageFilter.GaussianBlur(0.7))
    return add_noise(img, 5)


def make_corrugated(base_rgb):
    """Corrugated metal — vertical ridges with highlight/shadow."""
    img = Image.new('RGB', (SIZE, SIZE), base_rgb)
    draw = ImageDraw.Draw(img)
    br, bg, bb = base_rgb
    ridge_w = 16
    for col in range(SIZE // ridge_w + 1):
        x = col * ridge_w
        hl = (min(255, br + 20), min(255, bg + 20), min(255, bb + 20))
        sh = (max(0, br - 15),   max(0, bg - 15),   max(0, bb - 15))
        draw.line([(x, 0), (x, SIZE)], fill=hl, width=2)
        draw.line([(x + ridge_w // 2, 0), (x + ridge_w // 2, SIZE)],
                  fill=sh, width=1)
    img = img.filter(ImageFilter.GaussianBlur(0.5))
    return add_noise(img, 4)


def make_brick(base_rgb):
    """Brick — regular rows with light mortar lines."""
    mortar_col = (200, 185, 168)
    img = Image.new('RGB', (SIZE, SIZE), mortar_col)
    draw = ImageDraw.Draw(img)
    br, bg, bb = base_rgb
    bh, bw = 16, 48
    mortar = 3
    for row in range(SIZE // bh + 2):
        offset = (bw // 2) if row % 2 else 0
        for col in range(-1, SIZE // bw + 2):
            x0 = col * bw + offset
            y0 = row * bh
            x1 = x0 + bw - mortar
            y1 = y0 + bh - mortar
            tone = random.randint(-8, 8)
            colour = (max(0, min(255, br + tone)),
                      max(0, min(255, bg + tone)),
                      max(0, min(255, bb + tone)))
            draw.rectangle([x0, y0, x1, y1], fill=colour)
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    return add_noise(img, 5)


def main():
    random.seed(42)
    specs = {
        'facade-residential': make_plaster((212, 205, 196)),
        'facade-commercial':  make_concrete((168, 168, 154)),
        'facade-industrial':  make_corrugated((138, 136, 128)),
        'facade-civic':       make_brick((188, 148, 110)),
    }
    for name, img in specs.items():
        path = os.path.join(OUT_DIR, f'{name}.webp')
        img.save(path, 'WEBP', quality=88)
        print(f'  {path}  ({img.width}x{img.height})')
    print('Done.')


if __name__ == '__main__':
    main()
