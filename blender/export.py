"""Export the scene to the GLB files the web app loads.

Run inside Blender (Text Editor > Run Script, or via the MCP) with
turntable.blend open. Writes to ../public/models next to this file.
"""
import os
import bpy

HERE = os.path.dirname(bpy.data.filepath)
OUT = os.path.normpath(os.path.join(HERE, "..", "public", "models"))

# Runtime-only helpers and bake-only light sources that must not ship
EXCLUDE = {"Preview", "Viewer", "Preview_Fill", "Night_Backdrop"}


def export(collection_name, filename, draco=True):
    col = bpy.data.collections[collection_name]
    bpy.ops.object.select_all(action="DESELECT")
    for o in col.all_objects:
        if o.name not in EXCLUDE:
            o.hide_set(False)
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, filename),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_extras=True,  # carries the lightmap file/scale per object
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_jpeg_quality=85,
        export_lights=False,
        export_cameras=False,
        export_animations=False,
        export_draco_mesh_compression_enable=draco,
        export_draco_mesh_compression_level=6,
        export_yup=True,
    )
    print("exported", filename, os.path.getsize(os.path.join(OUT, filename)) // 1024, "KB")


os.makedirs(OUT, exist_ok=True)
export("Room", "room.glb")
export("Turntable", "turntable.glb")
# The record set stays uncompressed: its UVs drive the generated groove textures
export("Records", "record.glb", draco=False)
