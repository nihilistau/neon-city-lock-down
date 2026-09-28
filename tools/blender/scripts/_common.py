# Shared helpers for the headless Blender scripts (run through tools/blender/run.mjs).
# Every script: read the JSON args after `--`, start from an EMPTY scene (the
# factory startup's cube/camera/light would pollute counts and bounds), import
# by extension, and print exactly one `@@RESULT <json>` line for the runner.
import json
import os
import sys

import bpy
from mathutils import Vector


def args():
    argv = sys.argv
    if "--" not in argv:
        return {}
    rest = argv[argv.index("--") + 1:]
    return json.loads(rest[0]) if rest else {}


def emit(result):
    sys.stdout.write("@@RESULT " + json.dumps(result) + "\n")
    sys.stdout.flush()


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_any(path):
    """Load a model into the current scene by extension. A .blend replaces it."""
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".blend":
        bpy.ops.wm.open_mainfile(filepath=path)
    else:
        raise ValueError("unsupported model type: " + ext)


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def tris_of(obj):
    """Triangles after modifiers (so a Decimate counts)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    mesh = ev.to_mesh()
    try:
        mesh.calc_loop_triangles()
        return len(mesh.loop_triangles)
    finally:
        ev.to_mesh_clear()


def bounds(objs):
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    if lo[0] == float("inf"):
        return {"min": [0, 0, 0], "max": [0, 0, 0]}
    return {"min": [round(v, 5) for v in lo], "max": [round(v, 5) for v in hi]}
