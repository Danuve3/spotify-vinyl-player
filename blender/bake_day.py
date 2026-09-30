"""Bakes the daytime lightmaps (arch_day.png, furn_day.png) for the room.

Run inside Blender with turntable.blend open (Text Editor > Run Script, or via
the MCP: exec(open(path).read())). The lamp is switched off and the glass wall
lets in daylight instead of the night: the bake-only backdrop outside becomes
a bright sky and the window's area light becomes soft daylight. The night
setup is restored afterwards. Progress goes to bake_day.log next to this file;
each object gets `lightmap_day_scale` for the export. Then run
`npm run lightmaps` and re-export room.glb (export.py).
"""
import os
import time

import bpy
import numpy as np

HERE = os.path.dirname(bpy.data.filepath)
OUT = os.path.normpath(os.path.join(HERE, "..", "public", "models", "lightmaps"))
LOG = os.path.join(HERE, "bake_day.log")
SAMPLES = {"arch": 128, "furn": 128}


def log(msg):
    with open(LOG, "a") as f:
        f.write(msg + "\n")


def emission_input(mat):
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    return bsdf, bsdf.inputs["Emission Strength"], bsdf.inputs["Emission Color"]


def daylight():
    """Switches the scene to daylight; returns a function that undoes it."""
    undo = []
    lamp = bpy.data.objects["Lamp_Light"]
    undo.append(lambda v=lamp.hide_render: setattr(lamp, "hide_render", v))
    lamp.hide_render = True
    for name in ("Bulb", "Lamp_Shade"):
        _, strength, _ = emission_input(bpy.data.materials[name])
        undo.append(lambda s=strength, v=strength.default_value: setattr(s, "default_value", v))
        strength.default_value = 0

    # Outside: a bright, slightly blue sky filling the glass wall
    backdrop = bpy.data.materials["Night_Backdrop"]
    bsdf, strength, colour = emission_input(backdrop)
    links = [(l.from_socket, l.to_socket) for l in backdrop.node_tree.links if l.to_socket == colour]
    for l in list(backdrop.node_tree.links):
        if l.to_socket == colour:
            backdrop.node_tree.links.remove(l)

    def restore_backdrop(v=strength.default_value, c=tuple(colour.default_value)):
        strength.default_value = v
        colour.default_value = c
        for a, b in links:
            backdrop.node_tree.links.new(a, b)

    undo.append(restore_backdrop)
    strength.default_value = 6.0
    colour.default_value = (0.78, 0.86, 1.0, 1.0)

    # The window's area light: daylight instead of moonlight
    win = bpy.data.objects["Moon_Light"].data
    undo.append(lambda e=win.energy, c=tuple(win.color): (setattr(win, "energy", e), setattr(win, "color", c)))
    win.energy = 450
    win.color = (1.0, 0.98, 0.95)

    return lambda: [u() for u in reversed(undo)]


def bake(group):
    sc = bpy.context.scene
    objs = [o for o in bpy.data.objects if o.get("lightmap") == f"{group}.png"]
    image = bpy.data.images[f"LM_{group}"]
    # The bake goes into the LM_BAKE image node of every material
    for o in objs:
        for slot in o.material_slots:
            nodes = slot.material.node_tree.nodes
            node = nodes.get("LM_BAKE")
            if node:
                nodes.active = node
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    sc.cycles.samples = SAMPLES[group]
    log(f"{group}_day bake start ({len(objs)} objects, {SAMPLES[group]} spp)")
    t = time.time()
    bpy.ops.object.bake(
        type="DIFFUSE",
        pass_filter={"DIRECT", "INDIRECT"},
        uv_layer="Lightmap",
        use_clear=True,
        margin=sc.render.bake.margin,
    )
    px = np.array(image.pixels[:], dtype=np.float32).reshape(image.size[1], image.size[0], 4)[..., :3]
    lit = px[px.sum(axis=2) > 0]
    scale = float(np.percentile(lit.max(axis=1), 99.9))
    norm = np.clip(px / scale, 0, 1)
    srgb = np.where(norm <= 0.0031308, 12.92 * norm, 1.055 * np.power(norm, 1 / 2.4) - 0.055)
    out = bpy.data.images.new(f"{group}_day_out", image.size[0], image.size[1], alpha=False)
    out.colorspace_settings.name = "Non-Color"  # values are already sRGB-encoded
    rgba = np.concatenate([srgb, np.ones(srgb.shape[:2] + (1,), np.float32)], axis=2)
    out.pixels[:] = rgba.ravel()
    out.filepath_raw = os.path.join(OUT, f"{group}_day.png")
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    for o in objs:
        o["lightmap_day_scale"] = scale
    log(f"{group}_day done {time.time() - t:.0f}s scale {scale:.4f}")


open(LOG, "w").close()
undo = daylight()
try:
    for g in ("arch", "furn"):
        bake(g)
finally:
    undo()
bpy.ops.wm.save_mainfile()
log("saved")
