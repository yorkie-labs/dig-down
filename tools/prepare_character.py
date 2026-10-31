"""Prepare a Tripo character GLB for the game.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/prepare_character.py -- \
      <input.glb> <output.glb> [target_tris] [texture_size]

Steps: import, merge meshes, decimate to a triangle budget, put the feet at the origin
facing +Z (three.js forward), scale to 1 unit tall, shrink textures, export GLB.
"""
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
target_tris = int(argv[2]) if len(argv) > 2 else 12000
tex_size = int(argv[3]) if len(argv) > 3 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    sys.exit("no mesh in " + src)

# Join everything into one mesh with transforms applied.
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
# Unparent (Tripo nests the mesh under an empty) while keeping the world transform.
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def tri_count(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


def protect_uv_seams(o):
    """Vertex group weighting UV-island boundary vertices 0, so collapse leaves them alone.

    Collapsing a seam vertex merges loops from different UV islands and smears the
    texture across the seam (white flecks all over the model).
    """
    mesh = o.data
    uv = mesh.uv_layers.active
    if uv is None:
        return None
    first = {}
    seam = set()
    for loop in mesh.loops:
        co = tuple(round(c, 5) for c in uv.data[loop.index].uv)
        v = loop.vertex_index
        if v not in first:
            first[v] = co
        elif first[v] != co:
            seam.add(v)
    group = o.vertex_groups.new(name="decimate_free")
    free = [v.index for v in mesh.vertices if v.index not in seam]
    group.add(free, 1.0, "REPLACE")
    return group.name, len(seam)


def weld(o):
    """Merge coincident vertices. The glTF importer splits vertices along UV seams, so each
    UV island arrives as a separate piece; decimating those open edges tears gaps between
    islands. Blender keeps UVs per loop, so welding preserves the texture mapping."""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(o.data)
    bm.free()


weld(obj)
before = tri_count(obj)
seams = 0
if before > target_tris:
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.ratio = target_tris / before
    protected = protect_uv_seams(obj)
    if protected:
        mod.vertex_group, seams = protected
    bpy.ops.object.modifier_apply(modifier=mod.name)
after = tri_count(obj)

# Feet on the origin, centred in x/z, 1 unit tall.
corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
height = hi.z - lo.z  # Blender is Z-up; the glTF exporter converts to Y-up
obj.location -= Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
bpy.ops.object.transform_apply(location=True)
s = 1.0 / height
obj.scale = (s, s, s)
bpy.ops.object.transform_apply(scale=True)

# Remove the now-empty parents left over from the import.
for o in list(bpy.context.scene.objects):
    if o.type == "EMPTY":
        bpy.data.objects.remove(o)

# Shrink textures for the web.
for img in bpy.data.images:
    if img.size[0] > tex_size or img.size[1] > tex_size:
        img.scale(tex_size, tex_size)
    img.pack()

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_image_format="JPEG",
)
print(f"PREPARED {src} -> {dst}: tris {before} -> {after} (seam verts kept {seams}), height {height:.3f} -> 1.0, tex<= {tex_size}")
