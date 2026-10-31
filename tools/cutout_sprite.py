"""Cut a character out of a plain light background and crop it, for use as a sprite.

Run with Blender's Python (it ships numpy):
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/cutout_sprite.py -- \
      <input.png> <output.png> [max_height=512] [tolerance=40]

Only background connected to the image border is removed, so white details inside the
character (eye shines, shoelaces) survive.
"""
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
max_h = int(argv[2]) if len(argv) > 2 else 512
tol = float(argv[3]) if len(argv) > 3 else 40.0

img = bpy.data.images.load(src)
w, h = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)  # bottom-up rows, 0..1
rgb = px[..., :3] * 255

# "Background-like": close to the corner colour (the plain backdrop).
corners = np.array([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]])
bg = np.median(corners, axis=0)
dist = np.linalg.norm(rgb - bg, axis=-1)
candidate = dist < tol

# Grow from the border through candidate pixels (geodesic reconstruction).
reached = np.zeros_like(candidate)
reached[0, :] = candidate[0, :]
reached[-1, :] = candidate[-1, :]
reached[:, 0] = candidate[:, 0]
reached[:, -1] = candidate[:, -1]
while True:
    grown = reached.copy()
    grown[1:, :] |= reached[:-1, :]
    grown[:-1, :] |= reached[1:, :]
    grown[:, 1:] |= reached[:, :-1]
    grown[:, :-1] |= reached[:, 1:]
    grown &= candidate
    if (grown == reached).all():
        break
    reached = grown

alpha = np.where(reached, 0.0, 1.0).astype(np.float32)
# Soften the rim: foreground pixels touching the background fade by how background-like they are.
edge = np.zeros_like(reached)
edge[1:, :] |= reached[:-1, :]
edge[:-1, :] |= reached[1:, :]
edge[:, 1:] |= reached[:, :-1]
edge[:, :-1] |= reached[:, 1:]
edge &= ~reached
alpha[edge] = np.clip(dist[edge] / (tol * 2), 0.35, 1.0)
px[..., 3] = alpha

# Crop to the character with a little padding.
ys, xs = np.nonzero(alpha > 0.5)
pad = 8
y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad + 1)
x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad + 1)
crop = np.ascontiguousarray(px[y0:y1, x0:x1])
ch, cw = crop.shape[:2]

out = bpy.data.images.new("sprite", cw, ch, alpha=True)
out.pixels[:] = crop.ravel()
if ch > max_h:
    out.scale(round(cw * max_h / ch), max_h)
out.filepath_raw = dst
out.file_format = "PNG"
out.save()
print(f"CUTOUT {src} -> {dst}: {cw}x{ch} -> {out.size[0]}x{out.size[1]}, bg={bg.round()}, removed={reached.mean():.0%}")
