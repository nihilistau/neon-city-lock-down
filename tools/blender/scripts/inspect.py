# Inspect a model: objects (name, type, verts, tris, materials), armatures
# (bone counts), actions (frame ranges), world-space bounds and total tris.
# args: {"in": "<path>"}
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ in tools/blender/scripts/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from _common import args, bounds, emit, import_any, mesh_objects, reset_scene, tris_of  # noqa: E402

a = args()
reset_scene()
import_any(a["in"])

objects = []
total = 0
for o in bpy.context.scene.objects:
    rec = {"name": o.name, "type": o.type}
    if o.type == "MESH":
        t = tris_of(o)
        total += t
        rec.update(verts=len(o.data.vertices), tris=t,
                   materials=[s.material.name for s in o.material_slots if s.material])
    objects.append(rec)

emit({
    "file": a["in"],
    "objects": objects,
    "armatures": [{"name": o.name, "bones": len(o.data.bones)}
                  for o in bpy.context.scene.objects if o.type == "ARMATURE"],
    "actions": [{"name": act.name, "frames": [act.frame_range[0], act.frame_range[1]]}
                for act in bpy.data.actions],
    "bounds": bounds(mesh_objects()),
    "tris": total,
})
