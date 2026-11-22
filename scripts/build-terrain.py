"""
Build the painted terrain texture for the map (run once; the output is committed).

Inputs (public domain, Natural Earth, https://www.naturalearthdata.com):
  NE1_50M_SR_W.tif   land cover with shaded relief            (naciscdn.org/naturalearth/50m/raster/NE1_50M_SR_W.zip)
  GRAY_50M_SR_OB.tif shaded relief including the ocean bottom (naciscdn.org/naturalearth/50m/raster/GRAY_50M_SR_OB.zip)
  src/data/generated/world.json  (the game's own projected coastlines, used as the land mask so edges match exactly)

Output: src/data/generated/terrain.webp, in the game's Natural Earth projection (4 px per map unit).

  python3 scripts/build-terrain.py <dir with the two .tif files> [out.webp]
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = None

SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/ne'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'src/data/generated/terrain.webp'
WORLD = 'src/data/generated/world.json'
# must match scripts/build-map.ts: geoNaturalEarth1().fitWidth(1000, Sphere)
SCALE, TX, TY = 182.78964407016804, 500.0, 259.9982544540716
PX = int(os.environ.get("TERRAIN_PX", "4"))  # texture pixels per map unit
W_MAP, H_MAP = 1000, 520
OW, OH = W_MAP * PX, H_MAP * PX


def find(name):
    for root, _dirs, files in os.walk(SRC):
        if name in files:
            return os.path.join(root, name)
    raise SystemExit(f'missing {name} under {SRC}')


def ne1_inverse(x, y):
    """Inverse Natural Earth 1 projection (same Newton iteration as d3-geo)."""
    phi = y.copy()
    for _ in range(25):
        p2 = phi * phi
        p4 = p2 * p2
        f = phi * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))) - y
        d = 1.007226 + p2 * (0.015085 * 3 + p4 * (-0.044475 * 7 + 0.028874 * 9 * p2 - 0.005916 * 11 * p4))
        phi = phi - f / d
    p2 = phi * phi
    lam = x / (0.8707 + p2 * (-0.131979 + p2 * (-0.013791 + p2 * p2 * p2 * (0.003971 - 0.001529 * p2))))
    return lam, phi


def sample(img, lon, lat):
    """Bilinear sample of an equirectangular array at lon/lat (degrees)."""
    h, w = img.shape[:2]
    fx = (lon + 180.0) / 360.0 * w - 0.5
    fy = (90.0 - lat) / 180.0 * h - 0.5
    x0 = np.floor(fx).astype(np.int64)
    y0 = np.floor(fy).astype(np.int64)
    tx = (fx - x0)[..., None] if img.ndim == 3 else fx - x0
    ty = (fy - y0)[..., None] if img.ndim == 3 else fy - y0
    x0c, x1c = np.mod(x0, w), np.mod(x0 + 1, w)
    y0c, y1c = np.clip(y0, 0, h - 1), np.clip(y0 + 1, 0, h - 1)
    a = img[y0c, x0c]; b = img[y0c, x1c]; c = img[y1c, x0c]; d = img[y1c, x1c]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def main():
    print('loading rasters ...')
    ne1 = Image.open(find('NE1_50M_SR_W.tif')).convert('RGB').resize((5400, 2700), Image.LANCZOS)
    gray = Image.open(find('GRAY_50M_SR_OB.tif')).convert('L').resize((5400, 2700), Image.LANCZOS)
    ne1 = np.asarray(ne1, dtype=np.float32) / 255.0
    gray = np.asarray(gray, dtype=np.float32) / 255.0

    print('reprojecting ...')
    jj, ii = np.mgrid[0:OH, 0:OW].astype(np.float64)
    mx = (ii + 0.5) / PX
    my = (jj + 0.5) / PX
    x = (mx - TX) / SCALE
    y = (TY - my) / SCALE
    lam, phi = ne1_inverse(x, y)
    inside = (np.abs(lam) <= np.pi + 1e-9) & (np.abs(phi) <= np.pi / 2 + 1e-9)
    lon = np.degrees(np.clip(lam, -np.pi, np.pi))
    lat = np.degrees(np.clip(phi, -np.pi / 2, np.pi / 2))
    land_rgb = sample(ne1, lon, lat).astype(np.float32)
    relief = sample(gray, lon, lat).astype(np.float32)

    print('rasterising the land mask ...')
    world = json.load(open(WORLD))
    SS = 2  # supersample the mask for smooth coasts
    mask_img = Image.new('L', (OW * SS, OH * SS), 0)
    dr = ImageDraw.Draw(mask_img)
    k = PX * SS / 10.0
    for c in world['countries']:
        for p in c['provinces']:
            for poly in p['poly']:
                for ri, ring in enumerate(poly):
                    pts = [(ring[i] * k, ring[i + 1] * k) for i in range(0, len(ring), 2)]
                    if len(pts) >= 3:
                        dr.polygon(pts, fill=255 if ri == 0 else 0)
    shelf_img = mask_img.resize((OW // 2, OH // 2), Image.BOX).filter(ImageFilter.GaussianBlur(9)).resize((OW, OH), Image.BILINEAR)
    land = np.asarray(mask_img.resize((OW, OH), Image.BOX), dtype=np.float32) / 255.0
    shelf = np.asarray(shelf_img, dtype=np.float32) / 255.0

    print('colouring ...')
    # land: Natural Earth colours, gently desaturated and warmed toward a painted-map palette
    lum = land_rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    warm = np.stack([lum * 1.06, lum * 0.98, lum * 0.84], axis=-1)
    land_col = land_rgb * 0.78 + warm * 0.22
    # richer, darker tones (Natural Earth is printed pale) and stronger relief so mountains read through country colours
    land_col = np.power(np.clip(land_col, 0, 1), 1.55)
    land_col *= (0.62 + 0.62 * relief)[..., None]
    land_col = np.clip(land_col * 1.02, 0, 1)

    # ocean: deep navy shaded by the sea-floor relief, lighter on the continental shelf
    deep = np.array([0.035, 0.085, 0.140], dtype=np.float32)
    mid = np.array([0.070, 0.150, 0.225], dtype=np.float32)
    shallow = np.array([0.135, 0.270, 0.345], dtype=np.float32)
    r = np.clip((relief - 0.35) / 0.5, 0, 1)[..., None]
    ocean = deep * (1 - r) + mid * r
    sh = np.clip(shelf * 1.6, 0, 1)[..., None] ** 1.4
    ocean = ocean * (1 - sh * 0.75) + shallow * sh * 0.75

    lm = land[..., None]
    rgb = ocean * (1 - lm) + land_col * lm
    alpha = inside.astype(np.float32)
    out = np.dstack([np.clip(rgb, 0, 1) * 255, alpha * 255]).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(OUT, 'WEBP', quality=80, method=6)
    print(f'wrote {OUT}: {OW}x{OH}, {os.path.getsize(OUT) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
