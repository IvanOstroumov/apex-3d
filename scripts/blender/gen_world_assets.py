"""
Headless Blender 4.0.2 Generator — Next-Gen World Vehicles, Botanical Foliage & Displaced Cliffs (.glb)
Produces:
  - public/assets/models/gt_safety_car_raw.glb      (Catmull-Clark Subsurf Widebody GT Supercar + 'scLightbar')
  - public/assets/models/tv_helicopter_h135_raw.glb (Catmull-Clark Subsurf H135 TV Helicopter + 'heliRotor')
  - public/assets/models/scenery_nature_raw.glb     (Voronoi/Musgrave Displaced Cliffs, Botanical Trees, 3D Grass & Ferns)
"""
import math
import os
import random
import bpy
import bmesh
from mathutils import Vector, Matrix

OUT_DIR = "/home/antigravity/f1-apex-3d-fh6/public/assets/models"
os.makedirs(OUT_DIR, exist_ok=True)


def P(x: float, y: float, z: float) -> Vector:
    return Vector((x, -z, y))


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def get_mat(name: str, base=(0.8, 0.8, 0.8, 1.0), metal=0.0, rough=0.5, emissive=None):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = base
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough
        if emissive and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*emissive, 1.0)
            bsdf.inputs["Emission Strength"].default_value = 3.0
    return m


def make_mesh_obj(name: str, bm: bmesh.types.BMesh, mat, parent=None, smooth=True, subsurf=0, bevel_w=0.0):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    if bevel_w > 0:
        bev = obj.modifiers.new(name="Bevel", type="BEVEL")
        bev.width = bevel_w
        bev.segments = 2
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(32)
    if subsurf > 0:
        sub = obj.modifiers.new(name="Subsurf", type="SUBSURF")
        sub.levels = subsurf
        sub.render_levels = subsurf
    return obj


def build_loft_bmesh(slices, ring_pts=32, offset_x=0.0):
    bm = bmesh.new()
    rings = []
    for z, wb, wt, yb, yt, bulge in slices:
        cy = 0.5 * (yb + yt)
        ry = max(0.008, 0.5 * (yt - yb))
        wmax = max(wb, wt) * bulge
        ring = []
        for j in range(ring_pts):
            th = (j / ring_pts) * math.pi * 2.0
            ct, st = math.cos(th), math.sin(th)
            wh = (wmax + (wt - wmax) * (abs(ct) ** 0.85)) if ct >= 0 else (wmax + (wb - wmax) * (abs(ct) ** 0.75))
            sx = offset_x + math.copysign(abs(st) ** 0.86, st) * wh
            sy = cy + math.copysign(abs(ct) ** 0.88, ct) * ry
            ring.append(bm.verts.new(P(sx, sy, z)))
        rings.append(ring)

    uv_l = bm.loops.layers.uv.new("UVMap")
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for j in range(ring_pts):
            jn = (j + 1) % ring_pts
            f = bm.faces.new((r0[j], r1[j], r1[jn], r0[jn]))
            for l in f.loops:
                l[uv_l].uv = (j / ring_pts, i / max(1, len(rings) - 1))

    sb, sf = slices[0], slices[-1]
    cb = bm.verts.new(P(offset_x, 0.5 * (sb[3] + sb[4]), sb[0] - 0.012))
    cf = bm.verts.new(P(offset_x, 0.5 * (sf[3] + sf[4]), sf[0] + 0.012))
    for j in range(ring_pts):
        jn = (j + 1) % ring_pts
        bm.faces.new((cb, rings[0][j], rings[0][jn]))
        bm.faces.new((cf, rings[-1][jn], rings[-1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def add_box(name, cx, cy, cz, sx, sy, sz, mat, parent, rot_x=0.0, bevel_w=0.006):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    rx = Matrix.Rotation(rot_x, 4, "X")
    for v in bm.verts:
        p = Vector((v.co.x * sx, v.co.z * sy, v.co.y * sz))
        if rot_x != 0.0:
            # Rotate in Three.js (Y,Z) plane
            ny = p.y * math.cos(rot_x) - p.z * math.sin(rot_x)
            nz = p.y * math.sin(rot_x) + p.z * math.cos(rot_x)
            p.y, p.z = ny, nz
        v.co = P(cx + p.x, cy + p.y, cz + p.z)
    uv_l = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for l in f.loops:
            l[uv_l].uv = (0.5, 0.5)
    return make_mesh_obj(name, bm, mat, parent=parent, bevel_w=bevel_w)


# ==============================================================================
# 1. WIDEBODY GT SAFETY CAR (Catmull-Clark Subsurf Aston Vantage / Senna Aero)
# ==============================================================================
def build_gt_safety_car():
    clear_scene()
    m_paint = get_mat("SC_Body_Paint", (0.0, 0.35, 0.31, 1), 0.78, 0.14)
    m_glass = get_mat("SC_Cabin_Glass", (0.03, 0.06, 0.10, 1), 0.94, 0.05)
    m_carbon = get_mat("SC_Carbon", (0.08, 0.09, 0.12, 1), 0.35, 0.38)
    m_chrome = get_mat("SC_Chrome", (0.85, 0.88, 0.92, 1), 0.95, 0.12)
    m_tire = get_mat("SC_Tire", (0.07, 0.08, 0.10, 1), 0.06, 0.76)
    m_strobe = get_mat("SC_Strobe", (1.0, 0.60, 0.0, 1), 0.1, 0.2, emissive=(1.0, 0.45, 0.0))
    m_hl = get_mat("SC_Headlight", (0.94, 0.97, 1.0, 1), 0.0, 0.1, emissive=(0.95, 0.98, 1.0))
    m_tl = get_mat("SC_Taillight", (1.0, 0.06, 0.02, 1), 0.0, 0.1, emissive=(1.0, 0.06, 0.02))
    m_plate = get_mat("SC_Plate", (0.95, 0.75, 0.10, 1), 0.1, 0.35)

    root = bpy.data.objects.new("GT_Safety_Car", None)
    bpy.context.collection.objects.link(root)

    # Subsurf Widebody GT Body (Crisp Kamm-tail boundary rings eliminate rear Subsurf pinching!)
    body_bm = build_loft_bmesh([
        (-2.27, 0.85, 0.78, 0.24, 0.76, 1.03),
        (-2.21, 0.88, 0.80, 0.22, 0.78, 1.04),
        (-1.82, 0.99, 0.88, 0.16, 0.85, 1.07),
        (-1.28, 1.01, 0.89, 0.14, 0.86, 1.08),
        (-0.42, 0.94, 0.85, 0.13, 0.84, 1.05),
        ( 0.45, 0.95, 0.85, 0.13, 0.82, 1.06),
        ( 1.36, 1.00, 0.87, 0.14, 0.76, 1.08),
        ( 1.98, 0.91, 0.79, 0.15, 0.62, 1.05),
        ( 2.24, 0.78, 0.64, 0.16, 0.48, 1.03),
        ( 2.29, 0.74, 0.60, 0.17, 0.46, 1.02),
    ], ring_pts=36)
    make_mesh_obj("SC_Chassis", body_bm, m_paint, parent=root, subsurf=2)

    # Low-Slung Fastback GT Coupe Glasshouse + Side Mirrors
    cab_bm = build_loft_bmesh([
        (-1.68, 0.62, 0.48, 0.80, 0.86, 1.02),
        (-1.55, 0.66, 0.52, 0.81, 0.92, 1.03),
        (-0.92, 0.76, 0.61, 0.82, 1.17, 1.04),
        (-0.18, 0.78, 0.64, 0.82, 1.21, 1.04),
        ( 0.48, 0.76, 0.62, 0.80, 1.04, 1.03),
        ( 0.86, 0.70, 0.58, 0.78, 0.84, 1.02),
    ], ring_pts=30)
    make_mesh_obj("SC_Cabin", cab_bm, m_glass, parent=root, subsurf=2)

    # Splitter, Grille, Skirts, Swan-Neck GT Wing, Full-Width Rear Kamm Fascia & Venturi Diffuser
    add_box("SC_Splitter", 0, 0.12, 2.08, 1.96, 0.045, 0.52, m_carbon, root, bevel_w=0.008)
    add_box("SC_Grille", 0, 0.34, 2.28, 1.26, 0.24, 0.08, m_carbon, root, bevel_w=0.008)
    add_box("SC_Rear_Fascia", 0, 0.49, -2.24, 1.66, 0.38, 0.12, m_carbon, root, bevel_w=0.012)
    add_box("SC_Diffuser", 0, 0.22, -2.18, 1.72, 0.20, 0.34, m_carbon, root, bevel_w=0.008)
    add_box("SC_GT_Wing", 0, 1.10, -2.10, 1.78, 0.038, 0.30, m_carbon, root, rot_x=0.14, bevel_w=0.006)
    add_box("SC_Light_Bridge", 0, 1.23, -0.16, 1.14, 0.036, 0.20, m_carbon, root, bevel_w=0.005)

    for sx in (-1, 1):
        add_box(f"SC_Skirt_{sx}", sx * 0.98, 0.13, 0.0, 0.12, 0.055, 2.45, m_carbon, root, bevel_w=0.006)
        add_box(f"SC_Pylon_{sx}", sx * 0.44, 0.95, -2.02, 0.038, 0.28, 0.22, m_carbon, root, rot_x=-0.24, bevel_w=0.004)
        add_box(f"SC_Endplate_{sx}", sx * 0.89, 1.10, -2.10, 0.025, 0.21, 0.36, m_carbon, root, bevel_w=0.004)
        add_box(f"SC_Headlight_{sx}", sx * 0.72, 0.53, 2.13, 0.26, 0.062, 0.14, m_hl, root, bevel_w=0.01)
        add_box(f"SC_Mirror_{sx}", sx * 0.97, 0.88, 0.44, 0.15, 0.08, 0.18, m_paint, root, bevel_w=0.02)
        # Front Bumper Carbon Aero Dive-Planes / Canards + V8 Hood Heat Extractor Louvers
        add_box(f"SC_Canard_Upper_{sx}", sx * 0.92, 0.32, 2.14, 0.16, 0.018, 0.24, m_carbon, root, rot_x=0.22, bevel_w=0.003)
        add_box(f"SC_Canard_Lower_{sx}", sx * 0.94, 0.22, 2.18, 0.18, 0.018, 0.26, m_carbon, root, rot_x=0.18, bevel_w=0.003)
        add_box(f"SC_Hood_Vent_{sx}", sx * 0.38, 0.76, 1.32, 0.24, 0.024, 0.44, m_carbon, root, rot_x=0.08, bevel_w=0.004)

    for d in (-3, -2, -1, 1, 2, 3):
        add_box(f"SC_Diff_Fin_{d}", d * 0.20, 0.19, -2.20, 0.022, 0.16, 0.36, m_carbon, root, bevel_w=0.003)

    add_box("SC_Tail_Blade", 0, 0.69, -2.295, 1.62, 0.044, 0.06, m_tl, root, bevel_w=0.008)

    # Rear UK Yellow "HORIZON" License Plate Quad facing -Z (left=-0.26 -> u=0.0, right=+0.26 -> u=1.0 when viewed from behind!)
    bm_pl = bmesh.new()
    uv_pl = bm_pl.loops.layers.uv.new("UVMap")
    p_quad = [
        ( 0.26, 0.43, -2.312, 1.0, 0.0),
        (-0.26, 0.43, -2.312, 0.0, 0.0),
        (-0.26, 0.545, -2.312, 0.0, 1.0),
        ( 0.26, 0.545, -2.312, 1.0, 1.0),
    ]
    p_vs = [bm_pl.verts.new(P(x, y, z)) for x, y, z, _, _ in p_quad]
    f_pl = bm_pl.faces.new(p_vs)
    for l, (_, _, _, u, v) in zip(f_pl.loops, p_quad):
        l[uv_pl].uv = (u, v)
    make_mesh_obj("SC_Horizon_Plate", bm_pl, m_plate, parent=root, smooth=False)

    # Preserved `scLightbar` node name for main.ts strobe flashing!
    bm_lb = bmesh.new()
    for sx in (-0.36, 0.36):
        b_pod = bmesh.new()
        bmesh.ops.create_uvsphere(b_pod, u_segments=20, v_segments=12, radius=1.0)
        for v in b_pod.verts:
            v.co = P(sx + v.co.x * 0.24, 1.275 + v.co.z * 0.048, -0.16 + v.co.y * 0.10)
        for f in b_pod.faces:
            bm_lb.faces.new([bm_lb.verts.new(v.co) for v in f.verts])
        b_pod.free()
    make_mesh_obj("scLightbar", bm_lb, m_strobe, parent=root, smooth=True)

    # Quad Chrome Exhausts + 4 Forged 10-Spoke Concave GT Wheels + Internal Brake Rotors
    for idx_e, ex in enumerate((-0.62, -0.49, 0.49, 0.62)):
        bm_p = bmesh.new()
        segs = 20
        rf = [bm_p.verts.new(P(ex + math.cos(a)*0.048, 0.22 + math.sin(a)*0.048, -2.18)) for a in [k/segs*math.pi*2 for k in range(segs)]]
        rb = [bm_p.verts.new(P(ex + math.cos(a)*0.048, 0.22 + math.sin(a)*0.048, -2.36)) for a in [k/segs*math.pi*2 for k in range(segs)]]
        for k in range(segs):
            kn = (k + 1) % segs
            bm_p.faces.new((rb[k], rf[k], rf[kn], rb[kn]))
        bmesh.ops.recalc_face_normals(bm_p, faces=bm_p.faces)
        make_mesh_obj(f"SC_Exhaust_{idx_e}", bm_p, m_chrome, parent=root)

    for idx_w, (wx, wz) in enumerate([(-0.94, 1.38), (0.94, 1.38), (-0.96, -1.38), (0.96, -1.38)]):
        bm_wt = bmesh.new()
        prof = [(-0.14, 0.24), (-0.13, 0.345), (-0.09, 0.356), (0.09, 0.356), (0.13, 0.345), (0.14, 0.24)]
        segs = 40
        rings = [[bm_wt.verts.new(P(wx + ox, 0.356 + math.cos(s/segs*math.pi*2)*r, wz + math.sin(s/segs*math.pi*2)*r)) for s in range(segs)] for ox, r in prof]
        for i in range(len(rings) - 1):
            for s in range(segs):
                sn = (s + 1) % segs
                bm_wt.faces.new((rings[i][s], rings[i+1][s], rings[i+1][sn], rings[i][sn]))
        bmesh.ops.recalc_face_normals(bm_wt, faces=bm_wt.faces)
        make_mesh_obj(f"SC_Tire_{idx_w}", bm_wt, m_tire, parent=root)

        # Internal Ventilated Brake Rotor
        bm_bd = bmesh.new()
        d_segs = 28
        rf_d = [bm_bd.verts.new(P(wx + math.copysign(0.08, wx), 0.356 + math.cos(s/d_segs*math.pi*2)*0.20, wz + math.sin(s/d_segs*math.pi*2)*0.20)) for s in range(d_segs)]
        rb_d = [bm_bd.verts.new(P(wx + math.copysign(0.04, wx), 0.356 + math.cos(s/d_segs*math.pi*2)*0.20, wz + math.sin(s/d_segs*math.pi*2)*0.20)) for s in range(d_segs)]
        for s in range(d_segs):
            sn = (s + 1) % d_segs
            bm_bd.faces.new((rf_d[s], rb_d[s], rb_d[sn], rf_d[sn]))
        bmesh.ops.recalc_face_normals(bm_bd, faces=bm_bd.faces)
        make_mesh_obj(f"SC_BrakeDisc_{idx_w}", bm_bd, m_carbon, parent=root)

        out_x = wx + math.copysign(0.128, wx)
        for sp in range(10):
            ang = (sp / 10.0) * math.pi
            bm_sp = bmesh.new()
            bmesh.ops.create_cube(bm_sp, size=1.0)
            for v in bm_sp.verts:
                ly = v.co.z * 0.47
                lz = v.co.y * 0.024
                ry = ly * math.cos(ang) - lz * math.sin(ang)
                rz = ly * math.sin(ang) + lz * math.cos(ang)
                v.co = P(out_x + v.co.x * 0.024, 0.356 + ry, wz + rz)
            make_mesh_obj(f"SC_Spoke_{idx_w}_{sp}", bm_sp, m_chrome, parent=root)

    out_p = os.path.join(OUT_DIR, "gt_safety_car_raw.glb")
    bpy.ops.export_scene.gltf(filepath=out_p, export_format="GLB", export_yup=True, export_apply=True, export_materials="EXPORT")
    print(f"[BLENDER SC] Exported gt_safety_car_raw.glb ({os.path.getsize(out_p)//1024} KB)")


# ==============================================================================
# 2. TV HELICOPTER H135 (Catmull-Clark Subsurf + Preserved 'heliRotor' Group)
# ==============================================================================
def build_tv_helicopter():
    clear_scene()
    m_body = get_mat("Heli_Body", (0.11, 0.14, 0.20, 1), 0.72, 0.20)
    m_acc = get_mat("Heli_Accent", (0.88, 0.05, 0.02, 1), 0.45, 0.24)
    m_glass = get_mat("Heli_Glass", (0.04, 0.09, 0.16, 1), 0.92, 0.05)
    m_dark = get_mat("Heli_Dark", (0.08, 0.09, 0.12, 1), 0.55, 0.42)
    m_beacon = get_mat("Heli_Beacon", (1.0, 0.15, 0.05, 1), 0.0, 0.2, emissive=(1.0, 0.12, 0.04))

    root = bpy.data.objects.new("TV_Helicopter_H135", None)
    bpy.context.collection.objects.link(root)

    fuse_bm = build_loft_bmesh([
        (-2.25, 0.26, 0.22, 0.15,  0.65, 1.03),
        (-1.20, 0.72, 0.58, -0.45, 1.08, 1.08),
        ( 0.15, 0.88, 0.74, -0.62, 1.12, 1.10),
        ( 1.35, 0.82, 0.68, -0.58, 0.82, 1.08),
        ( 2.25, 0.52, 0.40, -0.42, 0.28, 1.05),
        ( 2.68, 0.20, 0.14, -0.26, 0.02, 1.02),
    ], ring_pts=34)
    make_mesh_obj("Heli_Fuselage", fuse_bm, m_body, parent=root, subsurf=2)

    can_bm = build_loft_bmesh([
        (0.20, 0.78, 0.66, 0.10, 1.08, 1.06),
        (1.30, 0.76, 0.62, -0.25, 0.82, 1.06),
        (2.35, 0.46, 0.34, -0.35, 0.24, 1.04),
    ], ring_pts=28)
    make_mesh_obj("Heli_Canopy", can_bm, m_glass, parent=root, subsurf=2)

    add_box("Heli_Tailboom", 0, 0.48, -3.95, 0.30, 0.32, 3.80, m_body, root, bevel_w=0.06)
    add_box("Heli_HStab", 0, 0.48, -4.60, 2.15, 0.06, 0.36, m_acc, root, bevel_w=0.01)
    add_box("Heli_VFin", 0, 1.18, -5.75, 0.12, 1.35, 0.68, m_acc, root, bevel_w=0.02)
    # Fenestron Shrouded Tail Rotor Ring & Hub + Endplate Winglets
    add_box("Heli_HStab_EndL", -1.08, 0.50, -4.60, 0.04, 0.38, 0.34, m_acc, root, bevel_w=0.008)
    add_box("Heli_HStab_EndR",  1.08, 0.50, -4.60, 0.04, 0.38, 0.34, m_acc, root, bevel_w=0.008)
    bm_fen = bmesh.new()
    bmesh.ops.create_cone(bm_fen, cap_ends=True, cap_tris=False, segments=24, radius1=0.42, radius2=0.42, depth=0.18)
    for v in bm_fen.verts:
        v.co = P(v.co.z, 0.82 + v.co.x, -5.65 + v.co.y)
    make_mesh_obj("Heli_Fenestron_Hub", bm_fen, m_dark, parent=root)

    for sx in (-0.82, 0.82):
        add_box(f"Heli_Skid_{sx}", sx, -1.16, 0.35, 0.08, 0.08, 3.35, m_dark, root, bevel_w=0.02)
        add_box(f"Heli_Step_{sx}", sx * 0.92, -0.92, 0.55, 0.12, 0.03, 0.85, m_dark, root, bevel_w=0.006)
        add_box(f"Heli_StrutF_{sx}", sx * 0.82, -0.84, 1.10, 0.07, 0.65, 0.07, m_dark, root)
        add_box(f"Heli_StrutR_{sx}", sx * 0.82, -0.84, -0.55, 0.07, 0.65, 0.07, m_dark, root)

    bm_cam = bmesh.new()
    bmesh.ops.create_uvsphere(bm_cam, u_segments=18, v_segments=14, radius=0.24)
    for v in bm_cam.verts:
        v.co = P(v.co.x, -0.58 + v.co.z, 2.48 + v.co.y)
    make_mesh_obj("Heli_Cineflex", bm_cam, m_dark, parent=root)

    bm_bc = bmesh.new()
    bmesh.ops.create_uvsphere(bm_bc, u_segments=14, v_segments=10, radius=0.11)
    for v in bm_bc.verts:
        v.co = P(v.co.x, 1.22 + v.co.z, -0.45 + v.co.y)
    make_mesh_obj("Heli_Strobe", bm_bc, m_beacon, parent=root)

    rotor_grp = bpy.data.objects.new("heliRotor", None)
    bpy.context.collection.objects.link(rotor_grp)
    rotor_grp.parent = root
    rotor_grp.location = P(0, 1.48, 0.15)
    # Rotor Mast & Swashplate Hub Cap
    bm_hub = bmesh.new()
    bmesh.ops.create_cone(bm_hub, cap_ends=True, cap_tris=False, segments=20, radius1=0.28, radius2=0.16, depth=0.32)
    for v in bm_hub.verts:
        v.co = P(v.co.x, -0.10 + v.co.z, v.co.y)
    make_mesh_obj("Rotor_Swashplate_Hub", bm_hub, m_dark, parent=rotor_grp)

    for b in range(4):
        ang = (b / 4.0) * math.pi * 2.0
        bm_bl = bmesh.new()
        bmesh.ops.create_cube(bm_bl, size=1.0)
        for v in bm_bl.verts:
            lx = (0.5 + v.co.x) * 4.3
            ly = v.co.z * 0.025
            lz = v.co.y * 0.24
            rx = lx * math.cos(ang) - lz * math.sin(ang)
            rz = lx * math.sin(ang) + lz * math.cos(ang)
            v.co = P(rx, ly, rz)
        make_mesh_obj(f"Rotor_Blade_{b}", bm_bl, m_dark, parent=rotor_grp)

    out_p = os.path.join(OUT_DIR, "tv_helicopter_h135_raw.glb")
    bpy.ops.export_scene.gltf(filepath=out_p, export_format="GLB", export_yup=True, export_apply=True, export_materials="EXPORT")
    print(f"[BLENDER HELI] Exported tv_helicopter_h135_raw.glb ({os.path.getsize(out_p)//1024} KB)")


# ==============================================================================
# 3. BOTANICAL NATURE & PHOTOGRAMMETRY-STYLE DISPLACED CLIFFS (`scenery_nature_raw.glb`)
# ==============================================================================
def build_scenery_nature():
    clear_scene()
    m_rock = get_mat("Mat_Cliff_Rock", (0.45, 0.44, 0.42, 1), 0.05, 0.88)
    m_grass = get_mat("Mat_Wild_Grass", (0.25, 0.45, 0.16, 1), 0.0, 0.72)

    for idx_b, (name, seed_off, sx, sy, sz) in enumerate([
        ("Cliff_Boulder_A", 1.7, 7.5, 5.2, 6.4),
        ("Cliff_Boulder_B", 8.3, 5.4, 8.6, 5.0),
    ]):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
        uv_l = bm.loops.layers.uv.new("UVMap")

        for v in bm.verts:
            nx, ny, nz = v.co.x, v.co.z, -v.co.y
            strata = math.sin(ny * 7.5 + math.sin(nx * 3.2 + seed_off) * 1.4) * 0.14
            crag1 = math.sin(nx * 4.1 + seed_off) * math.cos(nz * 3.9 - seed_off) * 0.22
            crag2 = abs(math.sin((nx * 8.3 + ny * 6.7 + nz * 7.9) + seed_off)) * 0.12
            micro = math.sin(nx * 17.0 - ny * 14.0 + nz * 19.0) * 0.035
            base_flat = 0.55 if ny < -0.35 else 1.0
            disp = 1.0 + strata + crag1 - crag2 + micro
            fx = nx * sx * disp
            fy = max(-0.4, (ny + 0.55) * sy * disp * base_flat)
            fz = nz * sz * disp
            v.co = P(fx, fy, fz)

        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for f in bm.faces:
            n = f.normal
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            for l in f.loops:
                co = l.vert.co
                if az >= ax and az >= ay:
                    l[uv_l].uv = (co.x * 0.18, co.y * 0.18)
                elif ax >= ay:
                    l[uv_l].uv = (co.y * 0.18, co.z * 0.18)
                else:
                    l[uv_l].uv = (co.x * 0.18, co.z * 0.18)

        make_mesh_obj(name, bm, m_rock, smooth=True)

    # 26 curved tapered 4-segment 3D blades in a 1.4m patch
    bm_gr = bmesh.new()
    uv_gr = bm_gr.loops.layers.uv.new("UVMap")
    rng = random.Random(4242)
    for b in range(26):
        bx = (rng.random() - 0.5) * 1.38
        bz = (rng.random() - 0.5) * 1.38
        yaw = rng.random() * math.pi * 2.0
        lean = 0.22 + rng.random() * 0.42
        h = 0.34 + rng.random() * 0.46
        w0 = 0.038 + rng.random() * 0.024
        dx, dz = math.cos(yaw), math.sin(yaw)
        px, pz = -dz, dx
        segs_g = 4
        pts_l = []
        pts_r = []
        for s in range(segs_g + 1):
            t = s / segs_g
            w = w0 * (1.0 - t * 0.88)
            arc = (t ** 1.65) * lean * h
            cx = bx + dx * arc
            cz = bz + dz * arc
            cy = h * (t - (t ** 2.6) * 0.16)
            pts_l.append((t, bm_gr.verts.new(P(cx - px * w, cy, cz - pz * w))))
            pts_r.append((t, bm_gr.verts.new(P(cx + px * w, cy, cz + pz * w))))
        for s in range(segs_g):
            t0, vl0 = pts_l[s]
            _, vr0 = pts_r[s]
            t1, vl1 = pts_l[s + 1]
            _, vr1 = pts_r[s + 1]
            f = bm_gr.faces.new((vl0, vr0, vr1, vl1))
            for l, tv in zip(f.loops, [t0, t0, t1, t1]):
                l[uv_gr].uv = (0.5, tv)
    bmesh.ops.recalc_face_normals(bm_gr, faces=bm_gr.faces)
    make_mesh_obj("Wild_Grass_Clump", bm_gr, m_grass, smooth=True)

    out_p = os.path.join(OUT_DIR, "scenery_nature_raw.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_p,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_colors=True,
        export_materials="EXPORT",
    )
    print(f"[BLENDER NATURE] Exported scenery_nature_raw.glb ({os.path.getsize(out_p)//1024} KB)")


build_gt_safety_car()
build_tv_helicopter()
build_scenery_nature()
