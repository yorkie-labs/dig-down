"""Cut a front-view character sprite into cutout-rig parts (Blender's Python ships numpy).

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/rig_cut.py -- <sprite.png> <out_prefix>

Writes <out_prefix>-{head,body,armL,armR,legL,legR}.png, each on the full original canvas so
the parts line up when stacked; the game rotates them about the pivots in RIG_PIVOTS (src/main3d.ts).
Region numbers are for public/sprites/puppy-flat.png (301x512, top-left origin).
"""
import sys

import bpy
import numpy as np

src, prefix = sys.argv[sys.argv.index("--") + 1:][:2]
img = bpy.data.images.load(src)
W, H = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[::-1]  # top-down
ys, xs = np.mgrid[0:H, 0:W]

NECK, HIP, MID = 222, 352, 150
OVERLAP = 6  # the body keeps a few rows under the head/over the legs so rotations show no gap
arm_band = (ys > 250) & (ys < HIP)
tail = (xs > 221) & (xs < 253) & (ys > 336) & (ys < 402)  # stays with the body (it wags with it)
parts = {
    "head": ys < NECK,
    "armL": arm_band & (xs < 72),
    "armR": arm_band & (xs > 229) & ~tail,
    "legL": (ys >= HIP) & (xs < MID),
    "legR": (ys >= HIP) & (xs >= MID) & ~tail,
}
taken = np.zeros((H, W), bool)
for m in parts.values():
    taken |= m
parts["body"] = ~taken | ((ys >= NECK - OVERLAP) & (ys < NECK)) | ((ys >= HIP) & (ys < HIP + OVERLAP))

for name, mask in parts.items():
    out = px.copy()
    out[..., 3] *= mask
    im = bpy.data.images.new(name, W, H, alpha=True)
    im.pixels[:] = np.ascontiguousarray(out[::-1]).ravel()
    im.filepath_raw = f"{prefix}-{name}.png"
    im.file_format = "PNG"
    im.save()
    print(f"PART {name} pixels={int((out[..., 3] > 0.5).sum())}")
