# Render a 512x512 PNG preview: camera framed on the model's bounds, a key /
# fill / rim light rig, EEVEE — or Workbench when EEVEE cannot start headless
# (no GPU context on a build box).
# args: {"in": "<path>", "out": "<file.png>"}
import math
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ in tools/blender/scripts/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
from _common import args, bounds, emit, import_any, mesh_objects, reset_scene  # noqa: E402

SIZE = 512
a = args()
out = os.path.abspath(a["out"])
reset_scene()
import_any(a["in"])
scene = bpy.context.scene

b = bounds(mesh_objects())
lo, hi = Vector(b["min"]), Vector(b["max"])
center = (lo + hi) / 2
radius = max((hi - lo).length / 2, 1e-3)

# Camera: a 3/4 view from the front-right, far enough that the bounding sphere fits.
cam_data = bpy.data.cameras.new("PreviewCam")
cam_data.lens = 50
cam = bpy.data.objects.new("PreviewCam", cam_data)
scene.collection.objects.link(cam)
fov = cam_data.angle
direction = Vector((1.0, -1.2, 0.8)).normalized()
cam.location = center + direction * (radius / math.sin(fov / 2) * 1.1)
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
cam_data.clip_start = radius * 0.01
cam_data.clip_end = radius * 100
scene.camera = cam


def light(name, kind, energy, offset):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ob = bpy.data.objects.new(name, ld)
    ob.location = center + Vector(offset) * radius * 3
    ob.rotation_euler = (center - ob.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(ob)


light("Key", "SUN", 3.0, (1.0, -1.0, 1.2))
light("Fill", "SUN", 1.0, (-1.2, -0.6, 0.4))
light("Rim", "SUN", 2.0, (0.0, 1.4, 1.0))

world = bpy.data.worlds.new("PreviewWorld")
world.color = (0.05, 0.05, 0.07)
scene.world = world

scene.render.resolution_x = SIZE
scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = out
os.makedirs(os.path.dirname(out), exist_ok=True)

engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
used = None
for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH"):
    if engine not in engines:
        continue
    try:
        scene.render.engine = engine
        bpy.ops.render.render(write_still=True)
        if os.path.isfile(out):
            used = engine
            break
    except Exception as err:  # EEVEE without a GPU context: try the next engine
        sys.stderr.write("preview: %s failed (%s)\n" % (engine, err))
if used is None:
    raise RuntimeError("no render engine produced " + out)

emit({"out": out, "engine": used, "size": SIZE, "bytes": os.path.getsize(out)})
