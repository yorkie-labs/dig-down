"""Turn a short character video into game sprite frames (the Spriterrific approach, locally).

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/video_to_sheet.py -- \
      <video.mp4> <out_prefix> [frames=8] [start=0] [end=-1] [height=512] [tolerance=40]

Steps: decode the video with Blender's built-in ffmpeg (sequencer → PNG frames), pick `frames`
evenly spaced frames from [start, end), remove the plain background connected to the border
(same rule as tools/cutout_sprite.py; a #00ff00 green screen is chroma-keyed instead), crop every frame to ONE shared box anchored at the feet so
the character doesn't jitter, scale to `height`, and write <out_prefix>-NN.png plus a horizontal
sheet <out_prefix>-sheet.png and <out_prefix>.json (frame count, size, fps).
"""
import json
import os
import sys
import tempfile

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
src, prefix = argv[0], argv[1]
want = int(argv[2]) if len(argv) > 2 else 8
start = int(argv[3]) if len(argv) > 3 else 0
end = int(argv[4]) if len(argv) > 4 else -1
out_h = int(argv[5]) if len(argv) > 5 else 512
tol = float(argv[6]) if len(argv) > 6 else 40.0

# ---- 1. decode with the sequencer ----
scene = bpy.context.scene
scene.sequence_editor_create()
ed = scene.sequence_editor
coll = ed.strips if hasattr(ed, "strips") else ed.sequences  # Blender 5 renamed sequences -> strips
strip = coll.new_movie("clip", src, channel=1, frame_start=1)
w, h = strip.elements[0].orig_width, strip.elements[0].orig_height
total = strip.frame_final_duration
fps = strip.fps or 24
scene.render.resolution_x, scene.render.resolution_y = w, h
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "Standard"  # keep the video's colours (default AgX washes them out)
scene.frame_start, scene.frame_end = 1, total
tmp = tempfile.mkdtemp()
if end < 0 or end > total:
    end = total
picks = [start + round(i * (end - start) / want) for i in range(want)]
if os.environ.get("PICKS"):  # explicit frame list, e.g. PICKS=0,42,48 (frame 0 can be a size reference)
    picks = [int(v) for v in os.environ["PICKS"].split(",")]
paths = []
for i, f in enumerate(picks):
    scene.frame_set(f + 1)
    path = os.path.join(tmp, f"f{i:02d}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    paths.append(path)
print(f"DECODED {total} frames @ {fps:.2f}fps {w}x{h}; picked {picks}")


# ---- 2. background removal (border-connected flood) ----
def load(path):
    im = bpy.data.images.load(path)
    W, H = im.size
    px = np.array(im.pixels[:], dtype=np.float32).reshape(H, W, 4)[::-1].copy()
    bpy.data.images.remove(im)
    return px


def cutout(px):
    rgb = px[..., :3] * 255
    corners = np.array([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]])
    bg = np.median(corners, axis=0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    if bg[1] > bg[0] + 80 and bg[1] > bg[2] + 80:
        # green screen (anchor images are composited on #00ff00): key by "how much greener than
        # red/blue" so video compression noise doesn't matter, then soft edge + despill
        excess = g - np.maximum(r, b)
        px[..., 3] = np.clip((tol * 2 - excess) / tol, 0.0, 1.0)  # excess >= 2*tol → 0, <= tol → 1
        px[..., 1] = np.minimum(px[..., 1], np.maximum(px[..., 0], px[..., 2]) + 0.02)
        return px
    dist = np.linalg.norm(rgb - bg, axis=-1)
    cand = dist < tol
    reached = np.zeros_like(cand)
    reached[0, :], reached[-1, :], reached[:, 0], reached[:, -1] = cand[0, :], cand[-1, :], cand[:, 0], cand[:, -1]
    while True:
        g = reached.copy()
        g[1:, :] |= reached[:-1, :]
        g[:-1, :] |= reached[1:, :]
        g[:, 1:] |= reached[:, :-1]
        g[:, :-1] |= reached[:, 1:]
        g &= cand
        if (g == reached).all():
            break
        reached = g
    px[..., 3] = np.where(reached, 0.0, 1.0)
    return px


frames = [cutout(load(p)) for p in paths]

# ---- 3. one shared crop box, feet-anchored ----
ys0, ys1, xs0, xs1, feet_x = [], [], [], [], []
for px in frames:
    ys, xs = np.nonzero(px[..., 3] > 0.5)
    ys0.append(ys.min()); ys1.append(ys.max()); xs0.append(xs.min()); xs1.append(xs.max())
    bottom = ys >= ys.max() - 6  # the lowest few rows ≈ feet
    feet_x.append(xs[bottom].mean())
pad = 8
y0, y1 = max(0, min(ys0) - pad), min(h, max(ys1) + pad + 1)
x0, x1 = max(0, min(xs0) - pad), min(w, max(xs1) + pad + 1)
crop_h, crop_w = y1 - y0, x1 - x0
scale = out_h / crop_h
fw = round(crop_w * scale)

out = []
boxes = []
for i, px in enumerate(frames):
    c = np.ascontiguousarray(px[y0:y1, x0:x1])
    im = bpy.data.images.new(f"fr{i}", crop_w, crop_h, alpha=True)
    im.pixels[:] = np.ascontiguousarray(c[::-1]).ravel()
    im.scale(fw, out_h)
    small = np.array(im.pixels[:], dtype=np.float32).reshape(out_h, fw, 4)[::-1].copy()
    im.filepath_raw = f"{prefix}-{i:02d}.png"
    im.file_format = "PNG"
    im.save()
    out.append(small)
    # per-frame body box in output pixels (top-down y), plus the feet centre: lets the game anchor
    # the feet under the hero and match the body size of other sprites
    ys, xs = np.nonzero(small[..., 3] > 0.5)
    low = ys >= ys.max() - 6
    boxes.append([int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()), round(float(xs[low].mean()), 1)])

sheet = np.concatenate(out, axis=1)
sh = bpy.data.images.new("sheet", sheet.shape[1], out_h, alpha=True)
sh.pixels[:] = np.ascontiguousarray(sheet[::-1]).ravel()
sh.filepath_raw = f"{prefix}-sheet.png"
sh.file_format = "PNG"
sh.save()
jitter = float(np.std(feet_x))
meta = {"frames": len(out), "width": fw, "height": out_h, "fps": round(fps * len(out) / max(1, end - start), 2),
        "source": os.path.basename(src), "picked": picks, "feetJitterPx": round(jitter, 1), "boxes": boxes}
with open(f"{prefix}.json", "w") as fh:
    json.dump(meta, fh, indent=1)
print("SHEET", json.dumps(meta))
