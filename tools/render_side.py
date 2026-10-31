"""Render the Tripo puppy from the side as a flat-cartoon sprite (Dead Cells-style 3D→2D route).

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/render_side.py -- <model.glb> <out.png> [yaw_deg=90]

Orthographic camera, emission-only (unlit) colours posterised by the compositor-free trick of
flat emission, plus a Freestyle ink outline, transparent background.
"""
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
yaw = float(argv[2]) if len(argv) > 2 else 90.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]

# Flat look: route each material's base colour texture straight to an Emission shader.
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if not bsdf or not out:
        continue
    src_link = bsdf.inputs["Base Color"].links
    emit = nt.nodes.new("ShaderNodeEmission")
    if src_link:
        nt.links.new(src_link[0].from_socket, emit.inputs["Color"])
    else:
        emit.inputs["Color"].default_value = bsdf.inputs["Base Color"].default_value
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])

# Bounds of the whole model.
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
center = (lo + hi) / 2
size = max(hi - lo)

sc = bpy.context.scene
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = "ORTHO"
cam.data.ortho_scale = size * 1.1
r = size * 3
a = math.radians(yaw)
# glTF import is Y-up converted to Blender Z-up; the model faces -Y. Yaw 90 = viewed from its right side.
cam.location = center + Vector((math.sin(a) * r, -math.cos(a) * r, 0))
direction = center - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

sc.render.engine = "BLENDER_EEVEE"
sc.render.film_transparent = True
sc.render.resolution_x = 512
sc.render.resolution_y = 512
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w")
sc.world = w
w.color = (0, 0, 0)

# ink outline
sc.render.use_freestyle = True
sc.render.line_thickness_mode = "ABSOLUTE"
sc.render.line_thickness = 3.0
ls = sc.view_layers[0].freestyle_settings.linesets.new("ink")
ls.select_by_visibility = True
ls.select_silhouette = True
ls.select_border = True
ls.select_crease = False
ls.linestyle.color = (0.106, 0.133, 0.22)

sc.render.filepath = dst
bpy.ops.render.render(write_still=True)
print("RENDERED", dst)
