"""Crop painted textures out of a style mockup capture (Blender's Python ships numpy).

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/crop_textures.py -- <capture.jpg> <out_dir>

Coordinates are screen pixels (top-left origin) of assets/mockups/style-a-target-capture.jpg,
the ChatGPT style-A mockup shown in the image viewer.
"""
import os
import sys

import bpy
import numpy as np

src, out = sys.argv[sys.argv.index("--") + 1:][:2]
img = bpy.data.images.load(src)
W, H = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[::-1]  # top-down rows


def crop(x0, y0, x1, y1):
    return px[y0:y1, x0:x1].copy()


def save(arr, name):
    h, w = arr.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=True)
    im.pixels[:] = np.ascontiguousarray(arr[::-1]).ravel()
    im.filepath_raw = os.path.join(out, name)
    im.file_format = "PNG"
    im.save()
    print(f"SAVED {name} {w}x{h}")


def detail(arr):
    """Keep only the painted brightness variation: grey around 0.8 (the material boosts it back)."""
    lum = arr[..., :3] @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    d = np.clip(0.8 + (lum - lum.mean()) * 0.8, 0.0, 1.0)  # halved: full contrast read as crumpled foil
    res = np.ones_like(arr)
    res[..., 0] = res[..., 1] = res[..., 2] = d
    return res


def resize(arr, size):
    """Nearest-neighbour resample to size x size (cells are small; this is just to unify)."""
    h, w = arr.shape[:2]
    ys = (np.arange(size) * h / size).astype(int)
    xs = (np.arange(size) * w / size).astype(int)
    return arr[ys][:, xs]


# (the painted ice-cliff crops were dropped 2026-11-01: the shaft walls are 3D now, src/backdrop3d.ts)

# mean colour of each sampled cell interior, for matching the in-game palette
for name, (x0, y0, x1, y1) in {"blue": (524, 910, 574, 960), "teal": (467, 595, 517, 645),
                                "yellow": (350, 597, 398, 642), "pink": (525, 657, 570, 702)}.items():
    c = crop(x0, y0, x1, y1)[..., :3].reshape(-1, 3).mean(axis=0)
    # 8-bit image pixels come back in the file's sRGB encoding, so no conversion is needed
    print("COLOR", name, "#" + "".join(f"{int(round(v * 255)):02x}" for v in c))

# 2x2 atlas of cell interiors (blue, teal, yellow, pink) as brightness detail
cells = [
    crop(524, 910, 574, 960),
    crop(467, 595, 517, 645),
    crop(350, 597, 398, 642),
    crop(525, 657, 570, 702),
]
S = 64
tiles = [resize(detail(c), S) for c in cells]
atlas = np.ones((S * 2, S * 2, 4), dtype=np.float32)
atlas[:S, :S], atlas[:S, S:], atlas[S:, :S], atlas[S:, S:] = tiles
save(atlas, "block-detail.png")

# the X block as drawn in the mockup
save(crop(462, 350, 512, 400), "xblock.png")
