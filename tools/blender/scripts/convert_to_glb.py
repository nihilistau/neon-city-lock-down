# Convert any supported model to GLB (Y-up, modifiers applied, animations kept).
# --lod <ratio> adds a Decimate (collapse) modifier to every mesh, so one source
# yields a LOD chain; --apply-scale bakes object scale into the mesh first.
# args: {"in": "<path>", "out": "<file.glb>", "lod"?: 0..1, "apply_scale"?: bool}
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ in tools/blender/scripts/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from _common import args, emit, import_any, mesh_objects, reset_scene, tris_of  # noqa: E402

a = args()
out = a["out"]
lod = a.get("lod")
reset_scene()
import_any(a["in"])
meshes = mesh_objects()

if a.get("apply_scale") and meshes:
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # transform_apply refuses multi-user mesh data; give each object its own.
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

if lod is not None:
    ratio = float(lod)
    if not 0 < ratio <= 1:
        raise ValueError("--lod must be in (0, 1], got %r" % lod)
    for o in meshes:
        m = o.modifiers.new(name="LOD", type="DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = ratio

os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
has_anims = len(bpy.data.actions) > 0
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_animations=has_anims,
)

emit({
    "out": out,
    "bytes": os.path.getsize(out),
    "tris": sum(tris_of(o) for o in meshes),
    "lod": lod,
    "animations": has_anims,
})
