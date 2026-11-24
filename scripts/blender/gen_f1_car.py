"""
Headless Blender 4.0.2 Generator — CAD-Grade Subdivided Formula 1 Hero Car (.glb)
Produces:
  - public/assets/models/f1_hero_lod0.glb (Catmull-Clark Subsurf levels=2 + Bevel, ~65k-85k tris)
  - public/assets/models/f1_ai_lod1.glb   (Optimized AI LOD1 levels=1, ~16k tris)

Coordinate mapping helper `P(x, y, z)` maps Three.js (x=left, y=up, z=forward)
to Blender (x, -z, y) so glTF +Y-up export lands at exact Three.js coordinates!
"""
import math
import os
import bpy
import bmesh
from mathutils import Vector, Matrix

OUT_DIR = "/home/antigravity/f1-apex-3d-fh6/public/assets/models"
os.makedirs(OUT_DIR, exist_ok=True)


def P(x: float, y: float, z: float) -> Vector:
    return Vector((x, -z, y))


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def get_mat(name: str, base=(0.8, 0.1, 0.1, 1.0), metal=0.3, rough=0.2, emissive=None):
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
        if emissive:
            if "Emission Color" in bsdf.inputs:
                bsdf.inputs["Emission Color"].default_value = (*emissive, 1.0)
                bsdf.inputs["Emission Strength"].default_value = 3.0
    return m


def make_mesh_obj(name: str, bm: bmesh.types.BMesh, mat, parent=None, smooth=True, subsurf=0, bevel_w=0.0):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    if bevel_w > 0 and bpy.context.scene.get("is_hero", True):
        bev = obj.modifiers.new(name="Bevel", type="BEVEL")
        bev.width = bevel_w
        bev.segments = 2
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(32)
    if subsurf > 0:
        sub = obj.modifiers.new(name="Subsurf", type="SUBSURF")
        sub.levels = subsurf
        sub.render_levels = subsurf
        sub.quality = 3
    return obj


def apply_body_uvs(obj, half_w=0.96, z_min=-2.28, z_max=2.86):
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv_layer = mesh.uv_layers.active.data
    z_span = z_max - z_min
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            v = mesh.vertices[vi]
            # Convert Blender (x, y_bl, z_bl) back to Three.js (x, y=z_bl, z=-y_bl)
            tx = v.co.x
            ty = v.co.z
            tz = -v.co.y
            nx = v.normal.x
            wrap_x = tx + (1.0 if (tx or nx) >= 0 else -1.0) * max(0.0, ty - 0.35) * 0.28 * abs(nx)
            u = max(0.02, min(0.98, 0.5 - wrap_x / (half_w * 2.0)))
            vv = max(0.01, min(0.99, (tz - z_min) / z_span))
            uv_layer[li].uv = (u, vv)


def build_loft_bmesh(slices, ring_pts=32, offset_x=0.0):
    """Builds a clean quad-grid lofted hull ready for Catmull-Clark Subdivision Surface!"""
    bm = bmesh.new()
    rings = []
    for z, wb, wt, yb, yt, bulge in slices:
        cy = 0.5 * (yb + yt)
        ry = max(0.008, 0.5 * (yt - yb))
        wmax = max(wb, wt) * bulge
        ring = []
        for j in range(ring_pts):
            th = (j / ring_pts) * math.pi * 2.0
            ct = math.cos(th)
            st = math.sin(th)
            wh = (wmax + (wt - wmax) * (abs(ct) ** 0.85)) if ct >= 0 else (wmax + (wb - wmax) * (abs(ct) ** 0.75))
            sx = offset_x + math.copysign(abs(st) ** 0.88, st) * wh
            sy = cy + math.copysign(abs(ct) ** 0.90, ct) * ry
            ring.append(bm.verts.new(P(sx, sy, z)))
        rings.append(ring)

    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for j in range(ring_pts):
            jn = (j + 1) % ring_pts
            # Outward quad winding
            bm.faces.new((r0[j], r1[j], r1[jn], r0[jn]))

    # Clean quad/fan caps
    sb = slices[0]
    cb = bm.verts.new(P(offset_x, 0.5 * (sb[3] + sb[4]), sb[0] - 0.012))
    for j in range(ring_pts):
        jn = (j + 1) % ring_pts
        bm.faces.new((cb, rings[0][j], rings[0][jn]))

    sf = slices[-1]
    cf = bm.verts.new(P(offset_x, 0.5 * (sf[3] + sf[4]), sf[0] + 0.015))
    for j in range(ring_pts):
        jn = (j + 1) % ring_pts
        bm.faces.new((cf, rings[-1][jn], rings[-1][j]))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def build_airfoil_bmesh(span, chord, thick, angle_rad=0.0, spoon_dip=0.0, sweep_z=0.0, dihedral=0.0, span_segs=24, prof_segs=18, offset=(0, 0, 0)):
    bm = bmesh.new()
    ox, oy, oz = offset
    prof = []
    ca, sa = math.cos(angle_rad), math.sin(angle_rad)
    for k in range(prof_segs):
        a = (k / prof_segs) * math.pi * 2.0
        xc = 0.5 * (1.0 - math.cos(a))
        upper = k < prof_segs / 2
        yt = 5.0 * thick * (0.2969 * math.sqrt(max(1e-4, xc)) - 0.1260 * xc - 0.3516 * xc**2 + 0.2843 * xc**3 - 0.1015 * xc**4)
        camber = -math.sin(xc * math.pi) * thick * 0.38
        ly = camber + (yt if upper else -yt)
        lz = (0.5 - xc) * chord
        prof.append((ly * ca - lz * sa, ly * sa + lz * ca))

    rings = []
    uv_coords = []
    for i in range(span_segs + 1):
        sf = i / span_segs
        x = (sf - 0.5) * span
        alat = abs(sf - 0.5) * 2.0
        cscale = 1.0 - (alat ** 3.0) * 0.12
        y_off = -spoon_dip * (max(0.0, math.cos(alat * math.pi * 0.5)) ** 1.6) + dihedral * (alat ** 2.2)
        z_off = -sweep_z * (alat ** 1.5)
        ring = []
        for k, (py, pz) in enumerate(prof):
            ring.append(bm.verts.new(P(ox + x, oy + py * cscale + y_off, oz + pz * cscale + z_off)))
        rings.append(ring)
        uv_coords.append(sf)

    uv_layer = bm.loops.layers.uv.new("UVMap")
    for i in range(span_segs):
        r0, r1 = rings[i], rings[i + 1]
        for k in range(prof_segs):
            kn = (k + 1) % prof_segs
            f = bm.faces.new((r0[k], r1[k], r1[kn], r0[kn]))
            for loop, (u, v) in zip(f.loops, [(uv_coords[i], k/prof_segs), (uv_coords[i+1], k/prof_segs), (uv_coords[i+1], (k+1)/prof_segs), (uv_coords[i], (k+1)/prof_segs)]):
                loop[uv_layer].uv = (u, v)

    # Wingtip caps
    lc = bm.verts.new(P(ox - span * 0.5, oy + dihedral, oz - sweep_z))
    rc = bm.verts.new(P(ox + span * 0.5, oy + dihedral, oz - sweep_z))
    for k in range(prof_segs):
        kn = (k + 1) % prof_segs
        bm.faces.new((lc, rings[0][kn], rings[0][k]))
        bm.faces.new((rc, rings[-1][k], rings[-1][kn]))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def add_tube_curve(name, pts_3js, radius, mat, parent, bevel_res=8, res_u=16, scale_x_around=None):
    curve = bpy.data.curves.new(name=name, type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = res_u
    curve.bevel_depth = radius
    curve.bevel_resolution = bevel_res
    spline = curve.splines.new("CATMULL_ROM" if hasattr(curve.splines, "CATMULL_ROM") else "NURBS")
    # Use Bezier/Poly or NURBS cleanly:
    curve.splines.remove(spline)
    sp = curve.splines.new("NURBS")
    sp.points.add(len(pts_3js) - 1)
    for idx, (x, y, z) in enumerate(pts_3js):
        co = P(x, y, z)
        sp.points[idx].co = (co.x, co.y, co.z, 1.0)
    sp.use_endpoint_u = True
    sp.order_u = min(4, len(pts_3js))

    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    # Convert curve to mesh so modifiers & glTF export cleanly
    deps = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(deps)
    mesh = bpy.data.meshes.new_from_object(eval_obj)
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.curves.remove(curve)

    if scale_x_around is not None:
        cx, sx = scale_x_around
        for v in mesh.vertices:
            v.co.x = cx + (v.co.x - cx) * sx
        mesh.update()

    for poly in mesh.polygons:
        poly.use_smooth = True
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    m_obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(m_obj)
    if mat:
        m_obj.data.materials.append(mat)
    if parent:
        m_obj.parent = parent
    return m_obj


def add_strut(name, p1, p2, chord, thick, mat, parent, segs=12):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=0.5, radius2=0.5, depth=1.0)
    v1 = P(*p1)
    v2 = P(*p2)
    diff = v2 - v1
    length = diff.length
    mid = (v1 + v2) * 0.5
    # Scale cylinder (along local Z in Blender) so thickness & chord match aero blade
    for v in bm.verts:
        v.co.x *= thick * 2.0
        v.co.y *= chord * 2.0
        v.co.z *= length
    z_axis = Vector((0, 0, 1))
    rot = z_axis.rotation_difference(diff.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(mid) @ rot, verts=bm.verts)
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for l in f.loops:
            l[uv_layer].uv = (0.5, 0.5)
    return make_mesh_obj(name, bm, mat, parent=parent, smooth=True)


def build_wheel_unit(prefix: str, radius: float, width: float, side: int, lod_sub: int, root, mats):
    """Builds a spinning Tire+Rim mesh + Sidewall Band mesh + static Brake Caliper/Rotor mesh centered at (0,0,0)."""
    half_w = width * 0.5
    rim_r = radius * 0.59
    seg_spin = 64 if lod_sub >= 2 else 32
    prof_steps = 24 if lod_sub >= 2 else 14

    # 1. Lathe Pirelli 18" Slick Tire + Forged Magnesium Barrel + Sculpted 10-Spoke BBS Dish
    bm_tire = bmesh.new()
    prof = []
    for i in range(prof_steps + 1):
        t = (i / prof_steps) * 2.0 - 1.0
        at = abs(t)
        if at < 0.70:
            u = at / 0.70
            r = radius - u * u * 0.008
            x = t * half_w * 0.94
        else:
            u = min(1.0, max(0.0, (at - 0.70) / 0.30))
            arc = max(0.0, math.cos(u * math.pi * 0.5))
            r = rim_r + (radius - 0.008 - rim_r) * (arc ** 0.62)
            x = math.copysign(half_w * 0.66 + math.sin(u * math.pi * 0.5) * (half_w * 0.32), t)
        prof.append((x, r))

    rings = []
    for x, r in prof:
        ring = []
        for s in range(seg_spin):
            ang = (s / seg_spin) * math.pi * 2.0
            ring.append(bm_tire.verts.new(P(x, math.cos(ang) * r, math.sin(ang) * r)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for s in range(seg_spin):
            sn = (s + 1) % seg_spin
            bm_tire.faces.new((r0[s], r1[s], r1[sn], r0[sn]))

    # 1A. Lathe Pirelli 18" Slick Tire (Matte Vulcanized Rubber `Tire_Rubber`)
    bmesh.ops.recalc_face_normals(bm_tire, faces=bm_tire.faces)
    uv_t = bm_tire.loops.layers.uv.new("UVMap")
    for f in bm_tire.faces:
        for l in f.loops:
            l[uv_t].uv = (0.5, 0.5)
    make_mesh_obj(f"Wheel_Tire_{prefix}", bm_tire, mats["Tire_Rubber"], parent=root, smooth=True)

    # 1B. Forged Magnesium BBS 18" Rim + Aero Dish + 10 Machined Ribs + Center-Lock Nut (`Rim_Alloy`)
    bm_rim = bmesh.new()
    dish_prof = [
        (side * half_w * 0.86, 0.038),
        (side * half_w * 0.82, rim_r * 0.50),
        (side * half_w * 0.89, rim_r * 0.88),
        (side * half_w * 0.93, rim_r * 1.00),
        (-side * half_w * 0.86, rim_r * 0.98),
    ]
    d_rings = []
    for x, r in dish_prof:
        ring = [
            bm_rim.verts.new(P(x, math.cos(s / seg_spin * math.pi * 2) * r, math.sin(s / seg_spin * math.pi * 2) * r))
            for s in range(seg_spin)
        ]
        d_rings.append(ring)
    for i in range(len(d_rings) - 1):
        for s in range(seg_spin):
            sn = (s + 1) % seg_spin
            verts = (
                (d_rings[i][s], d_rings[i + 1][s], d_rings[i + 1][sn], d_rings[i][sn])
                if side > 0
                else (d_rings[i][s], d_rings[i][sn], d_rings[i + 1][sn], d_rings[i + 1][s])
            )
            bm_rim.faces.new(verts)

    # 10 Machined Forged Spokes
    for sp in range(10):
        ang = (sp / 10.0) * math.pi * 2.0
        b_sp = bmesh.new()
        bmesh.ops.create_cube(b_sp, size=1.0)
        for v in b_sp.verts:
            lx = side * half_w * 0.88 + v.co.x * 0.020
            ly = (0.36 + v.co.y * 0.44) * rim_r
            lz = v.co.z * 0.018
            ry = ly * math.cos(ang) - lz * math.sin(ang)
            rz = ly * math.sin(ang) + lz * math.cos(ang)
            v.co = P(lx, ry, rz)
        for f in b_sp.faces:
            bm_rim.faces.new([bm_rim.verts.new(v.co) for v in f.verts])
        b_sp.free()

    # Center-lock nut
    b_nut = bmesh.new()
    bmesh.ops.create_cone(b_nut, cap_ends=True, cap_tris=False, segments=12, radius1=0.050, radius2=0.032, depth=0.056)
    for v in b_nut.verts:
        nx = side * (half_w * 0.90 + v.co.z * 0.55)
        v.co = P(nx, v.co.x, v.co.y)
    for f in b_nut.faces:
        bm_rim.faces.new([bm_rim.verts.new(v.co) for v in f.verts])
    b_nut.free()

    bmesh.ops.recalc_face_normals(bm_rim, faces=bm_rim.faces)
    uv_r = bm_rim.loops.layers.uv.new("UVMap")
    for f in bm_rim.faces:
        for l in f.loops:
            l[uv_r].uv = (0.5, 0.5)
    make_mesh_obj(f"Wheel_Rim_{prefix}", bm_rim, mats["Rim_Alloy"], parent=root, smooth=True)

    # 2. Pirelli Colored Sidewall Ring Decals (un-mirrored polar UVs on both +X and -X outer sidewalls!)
    bm_side = bmesh.new()
    uv_s = bm_side.loops.layers.uv.new("UVMap")
    r_in, r_out = rim_r + 0.010, radius - 0.024
    for end in (-1, 1):
        ring_in = []
        ring_out = []
        x_pl = end * half_w * 0.992
        for s in range(seg_spin):
            ang = (s / seg_spin) * math.pi * 2.0
            ring_in.append(bm_side.verts.new(P(x_pl, math.cos(ang) * r_in, math.sin(ang) * r_in)))
            ring_out.append(bm_side.verts.new(P(x_pl, math.cos(ang) * r_out, math.sin(ang) * r_out)))
        for s in range(seg_spin):
            sn = (s + 1) % seg_spin
            verts = (
                (ring_in[s], ring_out[s], ring_out[sn], ring_in[sn])
                if end > 0
                else (ring_in[s], ring_in[sn], ring_out[sn], ring_out[s])
            )
            f = bm_side.faces.new(verts)
            for l in f.loops:
                ty = l.vert.co.z / r_out
                tz = -l.vert.co.y / r_out
                l[uv_s].uv = (0.5 - end * tz * 0.46, 0.5 + ty * 0.46)
    make_mesh_obj(f"Wheel_Side_{prefix}", bm_side, mats["Tire_Side"], parent=root, smooth=True)

    # 3. Ventilated Carbon-Ceramic Brake Rotor + 6-Piston Brembo Caliper
    bm_disc = bmesh.new()
    for r_d, w_d, a_span in [(radius * 0.50, 0.048, math.pi * 2.0), (radius * 0.54, 0.088, 1.15)]:
        segs_d = 28 if a_span > 4 else 10
        r_f = []
        r_b = []
        for s in range(segs_d + 1):
            ang = -0.55 + (s / segs_d) * a_span
            cy, cz = math.cos(ang) * r_d, math.sin(ang) * r_d
            r_f.append(bm_disc.verts.new(P(-side * width * 0.18 - w_d * 0.5, cy, cz)))
            r_b.append(bm_disc.verts.new(P(-side * width * 0.18 + w_d * 0.5, cy, cz)))
        for s in range(segs_d):
            bm_disc.faces.new((r_f[s], r_b[s], r_b[s + 1], r_f[s + 1]))
    bmesh.ops.recalc_face_normals(bm_disc, faces=bm_disc.faces)
    uv_d = bm_disc.loops.layers.uv.new("UVMap")
    for f in bm_disc.faces:
        for l in f.loops:
            l[uv_d].uv = (0.5, 0.5)
    make_mesh_obj(f"Wheel_Disc_{prefix}", bm_disc, mats["Brake_Disc"], parent=root, smooth=True)


def generate_f1_glb(out_filename: str, subsurf_lvl: int):
    clear_scene()
    bpy.context.scene["is_hero"] = (subsurf_lvl >= 2)
    # Every material slot has distinct PBR constants so glTF exporters/optimizers NEVER merge slots!
    mats = {
        "Paint_Body": get_mat("Paint_Body", (0.86, 0.04, 0.04, 1), 0.38, 0.12),
        "Paint_Solid": get_mat("Paint_Solid", (0.82, 0.05, 0.05, 1), 0.36, 0.14),
        "Paint_Accent": get_mat("Paint_Accent", (1.0, 0.82, 0.0, 1), 0.45, 0.15),
        "Fin_Decal": get_mat("Fin_Decal", (0.79, 0.06, 0.06, 1), 0.34, 0.16),
        "Carbon_Weave": get_mat("Carbon_Weave", (0.10, 0.12, 0.15, 1), 0.28, 0.42),
        "Titanium_Exhaust": get_mat("Titanium_Exhaust", (0.55, 0.49, 0.44, 1), 0.92, 0.22),
        "Mirror_Glass": get_mat("Mirror_Glass", (0.92, 0.96, 1.0, 1), 1.0, 0.02),
        "Dark_Cavity": get_mat("Dark_Cavity", (0.02, 0.03, 0.04, 1), 0.18, 0.78),
        "Taillight_LED": get_mat("Taillight_LED", (1.0, 0.06, 0.02, 1), 0.1, 0.2, emissive=(1.0, 0.08, 0.02)),
        "Helmet_Shell": get_mat("Helmet_Shell", (0.90, 0.10, 0.10, 1), 0.42, 0.10),
        "Visor_Iridium": get_mat("Visor_Iridium", (0.02, 0.06, 0.12, 1), 0.96, 0.02),
        "Tire_Rubber": get_mat("Tire_Rubber", (0.09, 0.10, 0.12, 1), 0.05, 0.74),
        "Rim_Alloy": get_mat("Rim_Alloy", (0.44, 0.48, 0.54, 1), 0.88, 0.24),
        "Tire_Side": get_mat("Tire_Side", (0.96, 0.96, 0.96, 1), 0.10, 0.46),
        "Brake_Disc": get_mat("Brake_Disc", (0.32, 0.35, 0.40, 1), 0.84, 0.34),
    }

    root = bpy.data.objects.new("F1_Car_Root", None)
    bpy.context.collection.objects.link(root)

    body_grp = bpy.data.objects.new("Body_Group", None)
    bpy.context.collection.objects.link(body_grp)
    body_grp.parent = root

    ring_n = 36 if subsurf_lvl >= 2 else 24

    # 1. Subsurf Catmull-Clark Monocoque + Droop Nose + Coke-Bottle Engine Cover
    chassis_bm = build_loft_bmesh([
        (-2.28, 0.085, 0.055, 0.19,  0.41, 1.02),
        (-1.85, 0.16,  0.11,  0.10,  0.56, 1.05),
        (-1.35, 0.27,  0.18,  0.055, 0.76, 1.08),
        (-0.82, 0.36,  0.24,  0.048, 0.91, 1.08),
        (-0.34, 0.40,  0.30,  0.048, 0.96, 1.06),
        ( 0.06, 0.41,  0.35,  0.048, 0.64, 1.05),
        ( 0.68, 0.36,  0.33,  0.052, 0.62, 1.04),
        ( 1.38, 0.28,  0.24,  0.080, 0.53, 1.04),
        ( 2.08, 0.18,  0.14,  0.095, 0.35, 1.03),
        ( 2.62, 0.11,  0.08,  0.085, 0.20, 1.02),
        ( 2.86, 0.05,  0.035, 0.088, 0.145, 1.00),
    ], ring_pts=ring_n)
    chassis_obj = make_mesh_obj("Chassis_Monocoque", chassis_bm, mats["Paint_Body"], parent=body_grp, subsurf=subsurf_lvl)

    # 2. Subsurf High-Undercut Downwash Sidepods + Carbon Inlet Lips + Louvers + Swan-Neck Mirrors + Wheel Brows
    sp_slices = [
        (-1.96, 0.08, 0.05, 0.058, 0.27, 1.04),
        (-1.42, 0.24, 0.16, 0.048, 0.44, 1.10),
        (-0.75, 0.42, 0.33, 0.048, 0.58, 1.12),
        (-0.05, 0.46, 0.39, 0.050, 0.61, 1.10),
        ( 0.48, 0.42, 0.39, 0.085, 0.60, 1.08),
        ( 0.78, 0.26, 0.36, 0.22,  0.58, 1.04),
    ]
    for side in (-1, 1):
        sp_bm = build_loft_bmesh(sp_slices, ring_pts=ring_n - 6, offset_x=side * 0.44)
        sp_obj = make_mesh_obj(f"Sidepod_{side}", sp_bm, mats["Paint_Body"], parent=body_grp, subsurf=max(1, subsurf_lvl - 1))

        # Radiator carbon lip + dark radiator core
        add_tube_curve(f"Inlet_Lip_{side}", [
            (side * 0.30, 0.57, 0.78),
            (side * 0.72, 0.56, 0.75),
            (side * 0.74, 0.35, 0.68),
            (side * 0.32, 0.33, 0.72),
            (side * 0.30, 0.57, 0.78),
        ], 0.018, mats["Carbon_Weave"], body_grp)

        # Nose FOM camera winglet
        cam_bm = build_airfoil_bmesh(0.15, 0.11, 0.22, 0.05, span_segs=6, prof_segs=12, offset=(side * 0.21, 0.31, 1.98))
        make_mesh_obj(f"FOM_Cam_{side}", cam_bm, mats["Carbon_Weave"], parent=body_grp, bevel_w=0.002)

        # 5 Beveled Cooling Gill Louvers
        for g in range(5):
            gill_bm = build_airfoil_bmesh(0.14, 0.045, 0.18, 0.38, span_segs=5, prof_segs=10, offset=(side * (0.44 - g * 0.025), 0.56 - g * 0.018, -0.25 - g * 0.16))
            make_mesh_obj(f"Gill_{side}_{g}", gill_bm, mats["Dark_Cavity"], parent=body_grp)

        # Swan-neck mirror stalk + Subsurf mirror pod + reflective glass
        add_tube_curve(f"Mirror_Stalk_{side}", [(side * 0.34, 0.62, 0.48), (side * 0.48, 0.68, 0.47), (side * 0.58, 0.68, 0.45)], 0.011, mats["Carbon_Weave"], body_grp)
        mp_bm = build_loft_bmesh([(0.39, 0.068, 0.062, 0.655, 0.705, 1.04), (0.46, 0.072, 0.066, 0.652, 0.708, 1.05), (0.53, 0.025, 0.020, 0.668, 0.692, 1.02)], ring_pts=16, offset_x=side * 0.59)
        make_mesh_obj(f"Mirror_Pod_{side}", mp_bm, mats["Paint_Solid"], parent=body_grp, subsurf=1)
        bm_ml = bmesh.new()
        uv_ml = bm_ml.loops.layers.uv.new("UVMap")
        ml_pts = [(side * 0.59 + math.cos(k / 12.0 * math.pi * 2) * 0.056, 0.68 + math.sin(k / 12.0 * math.pi * 2) * 0.021, 0.386) for k in range(12)]
        f_ml = bm_ml.faces.new([bm_ml.verts.new(P(x, y, z)) for x, y, z in reversed(ml_pts)])
        for l in f_ml.loops:
            l[uv_ml].uv = (0.5, 0.5)
        make_mesh_obj(f"Mirror_Lens_{side}", bm_ml, mats["Mirror_Glass"], parent=body_grp)

        # Over-wheel curved aero wake deflector ("Wheel Brow")
        add_tube_curve(f"Wheel_Brow_{side}", [
            (side * 0.77, 0.48, 1.44),
            (side * 0.78, 0.66, 1.56),
            (side * 0.79, 0.715, 1.72),
            (side * 0.80, 0.675, 1.88),
        ], 0.026, mats["Carbon_Weave"], body_grp, scale_x_around=(side * 0.785, 2.1))

        # Floor edge vortex skirt
        add_tube_curve(f"Floor_Skirt_{side}", [(side * 0.955, 0.052, 0.62), (side * 0.965, 0.058, -0.25), (side * 0.950, 0.052, -1.25)], 0.016, mats["Paint_Accent"], body_grp)

    # 3. Ground-Effect Carbon Venturi Floor + Twin-Arch Rear Diffuser + Strakes
    bm_floor = bmesh.new()
    fl_pts = [
        (-0.42, 1.18), (-0.82, 0.96), (-0.96, 0.68), (-0.96, -1.32),
        (-0.78, -1.78), (-0.62, -2.14), (0.62, -2.14), (0.78, -1.78),
        (0.96, -1.32), (0.96, 0.68), (0.82, 0.96), (0.42, 1.18)
    ]
    bot_v = [bm_floor.verts.new(P(x, 0.038, z)) for x, z in fl_pts]
    top_v = [bm_floor.verts.new(P(x, 0.068, z)) for x, z in fl_pts]
    bm_floor.faces.new(list(reversed(bot_v)))
    bm_floor.faces.new(top_v)
    for i in range(len(fl_pts)):
        inext = (i + 1) % len(fl_pts)
        bm_floor.faces.new((bot_v[i], bot_v[inext], top_v[inext], top_v[i]))
    bmesh.ops.recalc_face_normals(bm_floor, faces=bm_floor.faces)
    uv_fl = bm_floor.loops.layers.uv.new("UVMap")
    for f in bm_floor.faces:
        for l in f.loops:
            l[uv_fl].uv = (l.vert.co.x * 0.5 + 0.5, -l.vert.co.y * 0.25 + 0.5)
    make_mesh_obj("Venturi_Floor", bm_floor, mats["Carbon_Weave"], parent=body_grp, bevel_w=0.005)

    # Diffuser gurney + 6 tucked Venturi strakes + central crash keel
    dg_bm = build_airfoil_bmesh(1.18, 0.08, 0.18, -0.35, spoon_dip=-0.025, span_segs=18, offset=(0, 0.255, -2.32))
    make_mesh_obj("Diffuser_Gurney", dg_bm, mats["Carbon_Weave"], parent=body_grp, bevel_w=0.002)

    for idx_s, sx in enumerate((-0.55, -0.35, -0.16, 0.16, 0.35, 0.55)):
        bm_st = bmesh.new()
        pts_st = [(0.052, -2.32), (0.052, -1.86), (0.15, -1.86), (0.215, -2.32)]
        vl = [bm_st.verts.new(P(sx - 0.006, y, z)) for y, z in pts_st]
        vr = [bm_st.verts.new(P(sx + 0.006, y, z)) for y, z in pts_st]
        bm_st.faces.new(list(reversed(vl)))
        bm_st.faces.new(vr)
        for i in range(4):
            inext = (i + 1) % 4
            bm_st.faces.new((vl[i], vl[inext], vr[inext], vr[i]))
        bmesh.ops.recalc_face_normals(bm_st, faces=bm_st.faces)
        uv_st = bm_st.loops.layers.uv.new("UVMap")
        for f in bm_st.faces:
            for l in f.loops:
                l[uv_st].uv = (0.5, 0.5)
        make_mesh_obj(f"Diffuser_Strake_{idx_s}", bm_st, mats["Carbon_Weave"], parent=body_grp, bevel_w=0.002)

    keel_bm = build_loft_bmesh([(-2.35, 0.046, 0.042, 0.12, 0.29, 1.02), (-2.05, 0.065, 0.058, 0.10, 0.32, 1.02), (-1.75, 0.095, 0.085, 0.09, 0.35, 1.02)], ring_pts=14)
    make_mesh_obj("Crash_Keel", keel_bm, mats["Carbon_Weave"], parent=body_grp, subsurf=1)

    # 4. Central Triple Inconel Exhaust (Main Turbo Pipe + Dual Wastegates)
    for idx_p, (px, py, pz, ro, ri, plen) in enumerate([(0, 0.385, -2.24, 0.062, 0.052, 0.32), (-0.068, 0.342, -2.22, 0.028, 0.021, 0.26), (0.068, 0.342, -2.22, 0.028, 0.021, 0.26)]):
        bm_ex = bmesh.new()
        segs_e = 28
        ro_f = [bm_ex.verts.new(P(px + math.cos(a)*ro*1.05, py + math.sin(a)*ro*1.05, pz + plen*0.5)) for a in [k/segs_e*math.pi*2 for k in range(segs_e)]]
        ro_b = [bm_ex.verts.new(P(px + math.cos(a)*ro, py + math.sin(a)*ro, pz - plen*0.5)) for a in [k/segs_e*math.pi*2 for k in range(segs_e)]]
        ri_b = [bm_ex.verts.new(P(px + math.cos(a)*ri, py + math.sin(a)*ri, pz - plen*0.5)) for a in [k/segs_e*math.pi*2 for k in range(segs_e)]]
        ri_in = [bm_ex.verts.new(P(px + math.cos(a)*ri, py + math.sin(a)*ri, pz - plen*0.1)) for a in [k/segs_e*math.pi*2 for k in range(segs_e)]]
        for k in range(segs_e):
            kn = (k + 1) % segs_e
            bm_ex.faces.new((ro_b[k], ro_f[k], ro_f[kn], ro_b[kn]))
            bm_ex.faces.new((ri_b[k], ro_b[k], ro_b[kn], ri_b[kn]))
            bm_ex.faces.new((ri_in[k], ri_b[k], ri_b[kn], ri_in[kn]))
        bmesh.ops.recalc_face_normals(bm_ex, faces=bm_ex.faces)
        uv_e = bm_ex.loops.layers.uv.new("UVMap")
        for f in bm_ex.faces:
            for l in f.loops:
                l[uv_e].uv = (0.5, 0.5)
        make_mesh_obj(f"Exhaust_Pipe_{idx_p}", bm_ex, mats["Titanium_Exhaust"], parent=body_grp, bevel_w=0.002)

    # 5. Roll-Hoop Airbox, T-Cam, Dorsal Shark Fin & Fin Decal Planes
    ab_bm = build_loft_bmesh([(-0.58, 0.13, 0.08, 0.80, 0.96, 1.04), (-0.28, 0.18, 0.14, 0.82, 1.00, 1.05), (-0.09, 0.15, 0.12, 0.84, 0.99, 1.03)], ring_pts=20)
    make_mesh_obj("RollHoop_Airbox", ab_bm, mats["Paint_Solid"], parent=body_grp, subsurf=1)
    add_strut("TCam_Stem", (0, 0.98, -0.24), (0, 1.08, -0.26), 0.065, 0.015, mats["Carbon_Weave"], body_grp)
    tc_bm = build_airfoil_bmesh(0.32, 0.062, 0.024, span_segs=10, offset=(0, 1.09, -0.26))
    make_mesh_obj("TCam_Bar", tc_bm, mats["Paint_Accent"], parent=body_grp, bevel_w=0.002)

    # Beveled Shark Fin + Left/Right Fin Decal UVs
    bm_fin = bmesh.new()
    fin_pts = [(0.51, -0.40), (0.57, -1.96), (0.85, -1.88), (0.98, -0.54), (0.95, -0.40)]
    fl_v = [bm_fin.verts.new(P(-0.009, y, z)) for y, z in fin_pts]
    fr_v = [bm_fin.verts.new(P(0.009, y, z)) for y, z in fin_pts]
    bm_fin.faces.new(list(reversed(fl_v)))
    bm_fin.faces.new(fr_v)
    for i in range(len(fin_pts)):
        inext = (i + 1) % len(fin_pts)
        bm_fin.faces.new((fl_v[i], fl_v[inext], fr_v[inext], fr_v[i]))
    bmesh.ops.recalc_face_normals(bm_fin, faces=bm_fin.faces)
    uv_fn = bm_fin.loops.layers.uv.new("UVMap")
    for f in bm_fin.faces:
        for l in f.loops:
            l[uv_fn].uv = (0.5, 0.5)
    make_mesh_obj("Shark_Fin", bm_fin, mats["Paint_Solid"], parent=body_grp, bevel_w=0.003)

    bm_fdec = bmesh.new()
    uv_fd = bm_fdec.loops.layers.uv.new("UVMap")
    for side in (-1, 1):
        quad = [
            (side * 0.016, 0.56, -0.48, 0.0, 0.0),
            (side * 0.016, 0.56, -1.84, 1.0, 0.0),
            (side * 0.016, 0.90, -1.84, 1.0, 1.0),
            (side * 0.016, 0.90, -0.48, 0.0, 1.0),
        ]
        if side < 0:
            quad = [quad[1], quad[0], quad[3], quad[2]]
        vs = [bm_fdec.verts.new(P(x, y, z)) for x, y, z, _, _ in quad]
        f = bm_fdec.faces.new(vs)
        for l, (_, _, _, u, v) in zip(f.loops, quad):
            l[uv_fd].uv = (u, v)
    make_mesh_obj("Shark_Fin_Decal", bm_fdec, mats["Fin_Decal"], parent=body_grp)

    # 6. Cockpit Recess, HANS Headrest, Titanium Halo (`Halo_Mesh`), Driver Helmet & Iridium Visor
    add_tube_curve("Cockpit_Headrest", [(-0.21, 0.67, 0.28), (-0.22, 0.69, -0.08), (0.0, 0.71, -0.15), (0.22, 0.69, -0.08), (0.21, 0.67, 0.28)], 0.038, mats["Dark_Cavity"], body_grp)

    # Halo separate named object (`Halo_Mesh`) for virtual-halo toggle
    halo_a = add_tube_curve("Halo_Hoop", [(-0.29, 0.66, -0.05), (-0.32, 0.85, 0.24), (-0.18, 0.91, 0.58), (0.0, 0.91, 0.72), (0.18, 0.91, 0.58), (0.32, 0.85, 0.24), (0.29, 0.66, -0.05)], 0.027, mats["Carbon_Weave"], None, res_u=24)
    halo_b = add_tube_curve("Halo_Pillar", [(0, 0.59, 0.85), (0, 0.76, 0.77), (0, 0.91, 0.71)], 0.022, mats["Carbon_Weave"], None, res_u=12)
    bm_halo = bmesh.new()
    bm_halo.from_mesh(halo_a.data)
    bm_halo.from_mesh(halo_b.data)
    bpy.data.objects.remove(halo_a, do_unlink=True)
    bpy.data.objects.remove(halo_b, do_unlink=True)
    make_mesh_obj("Halo_Mesh", bm_halo, mats["Carbon_Weave"], parent=body_grp, smooth=True)

    # Sculpted Aero Driver Helmet + Visor
    bm_helm = bmesh.new()
    bmesh.ops.create_uvsphere(bm_helm, u_segments=28, v_segments=20, radius=0.155)
    for v in bm_helm.verts:
        v.co = P(v.co.x * 0.94, 0.81 + v.co.z * 1.0, 0.10 - v.co.y * 1.18)
    uv_h = bm_helm.loops.layers.uv.new("UVMap")
    for f in bm_helm.faces:
        for l in f.loops:
            l[uv_h].uv = (0.5, 0.5)
    make_mesh_obj("Driver_Helmet", bm_helm, mats["Helmet_Shell"], parent=body_grp, smooth=True)

    bm_vis = bmesh.new()
    for vi in range(10):
        vf0 = 0.28 + (vi / 10.0) * 0.30
        vf1 = 0.28 + ((vi + 1) / 10.0) * 0.30
        for ui in range(18):
            uf0 = -0.36 + (ui / 18.0) * 0.72
            uf1 = -0.36 + ((ui + 1) / 18.0) * 0.72
            quad = []
            for uf, vf in [(uf0, vf0), (uf1, vf0), (uf1, vf1), (uf0, vf1)]:
                ph = vf * math.pi
                th = uf * math.pi
                sx = math.sin(ph) * math.sin(th) * 0.160 * 0.95
                sy = math.cos(ph) * 0.160 + 0.81
                sz = math.sin(ph) * math.cos(th) * 0.160 * 1.20 + 0.10
                quad.append(bm_vis.verts.new(P(sx, sy, sz)))
            bm_vis.faces.new(quad)
    bmesh.ops.recalc_face_normals(bm_vis, faces=bm_vis.faces)
    uv_v = bm_vis.loops.layers.uv.new("UVMap")
    for f in bm_vis.faces:
        for l in f.loops:
            l[uv_v].uv = (0.5, 0.5)
    make_mesh_obj("Driver_Visor", bm_vis, mats["Visor_Iridium"], parent=body_grp, smooth=True)

    # 7. Swan-Neck Rear Wing Mainplane, Bi-Plane Beam Wings, Curved Endplates & Glowing Red LED Strips!
    for px in (-0.085, 0.085):
        add_tube_curve(f"Swan_Pylon_{px}", [(px, 0.40, -2.06), (px, 0.68, -2.16), (px, 0.92, -2.19), (px, 0.955, -2.23), (px, 0.86, -2.25)], 0.021, mats["Carbon_Weave"], body_grp, scale_x_around=(px, 0.30))

    make_mesh_obj("Beam_Lower", build_airfoil_bmesh(1.02, 0.19, 0.14, 0.16, spoon_dip=0.015, span_segs=20, offset=(0, 0.42, -2.24)), mats["Carbon_Weave"], parent=body_grp, bevel_w=0.002)
    make_mesh_obj("Beam_Upper", build_airfoil_bmesh(1.06, 0.15, 0.13, 0.30, spoon_dip=0.012, span_segs=20, offset=(0, 0.485, -2.31)), mats["Carbon_Weave"], parent=body_grp, bevel_w=0.002)
    make_mesh_obj("Rear_Mainplane", build_airfoil_bmesh(1.22, 0.30, 0.15, 0.12, spoon_dip=0.038, sweep_z=0.05, dihedral=-0.015, span_segs=28, offset=(0, 0.85, -2.23)), mats["Carbon_Weave"], parent=body_grp, bevel_w=0.002)

    for side in (-1, 1):
        bm_ep = bmesh.new()
        ep_rings = []
        for i in range(21):
            t = i / 20.0
            y = 0.38 + t * 0.65
            s_flare = math.sin(min(1.0, t * 1.18) * math.pi * 0.5)
            top_roll = (((t - 0.86) / 0.14) ** 2) * 0.028 if t > 0.86 else 0.0
            xc = side * (0.51 + s_flare * 0.112 - top_roll)
            zf = -2.07 - ((1.0 - t) ** 1.6) * 0.08
            zb = -2.41 + ((((t - 0.76) / 0.24) ** 1.8) * 0.13 if t > 0.76 else 0.0)
            clen = zf - zb
            zmid = 0.5 * (zf + zb)
            ht = 0.012 * (1.0 - abs(t - 0.5) * 0.25)
            ring = [bm_ep.verts.new(P(xc + math.sin(k / 12.0 * math.pi * 2) * ht, y, zmid + math.cos(k / 12.0 * math.pi * 2) * clen * 0.5)) for k in range(12)]
            ep_rings.append(ring)
        for i in range(20):
            for k in range(12):
                kn = (k + 1) % 12
                bm_ep.faces.new((ep_rings[i][k], ep_rings[i+1][k], ep_rings[i+1][kn], ep_rings[i][kn]))
        bmesh.ops.recalc_face_normals(bm_ep, faces=bm_ep.faces)
        uv_ep = bm_ep.loops.layers.uv.new("UVMap")
        for f in bm_ep.faces:
            for l in f.loops:
                l[uv_ep].uv = (0.5, 0.5)
        make_mesh_obj(f"Rear_Endplate_{side}", bm_ep, mats["Paint_Solid"], parent=body_grp, subsurf=1)

        add_tube_curve(f"LED_Tail_{side}", [(side * 0.545, 0.50, -2.412), (side * 0.608, 0.70, -2.415), (side * 0.618, 0.88, -2.405)], 0.011, mats["Taillight_LED"], body_grp)

    # Central 15-Diode FIA Rain Light
    add_tube_curve("FIA_Rain_Light", [(0, 0.16, -2.355), (0, 0.25, -2.355)], 0.022, mats["Taillight_LED"], body_grp)

    # 8. Aero-Blade Double-Wishbone Suspension
    for side in (-1, 1):
        fhub = (side * 0.82, 0.324, 1.72)
        add_strut(f"Susp_FU1_{side}", (side * 0.20, 0.44, 1.94), (fhub[0], fhub[1] + 0.085, fhub[2] + 0.04), 0.052, 0.012, mats["Carbon_Weave"], body_grp)
        add_strut(f"Susp_FU2_{side}", (side * 0.24, 0.43, 1.48), (fhub[0], fhub[1] + 0.085, fhub[2] - 0.04), 0.052, 0.012, mats["Carbon_Weave"], body_grp)
        add_strut(f"Susp_FL1_{side}", (side * 0.20, 0.16, 1.90), (fhub[0], fhub[1] - 0.085, fhub[2] + 0.04), 0.052, 0.012, mats["Carbon_Weave"], body_grp)
        add_strut(f"Susp_FL2_{side}", (side * 0.24, 0.16, 1.46), (fhub[0], fhub[1] - 0.085, fhub[2] - 0.04), 0.052, 0.012, mats["Carbon_Weave"], body_grp)
        add_strut(f"Susp_FPush_{side}", (side * 0.22, 0.50, 1.66), (fhub[0], fhub[1] - 0.06, fhub[2]), 0.028, 0.011, mats["Carbon_Weave"], body_grp)

        rhub = (side * 0.80, 0.344, -1.70)
        add_strut(f"Susp_RU1_{side}", (side * 0.15, 0.42, -1.48), (rhub[0], rhub[1] + 0.09, rhub[2] + 0.04), 0.056, 0.013, mats["Carbon_Weave"], body_grp)
        add_strut(f"Susp_RU2_{side}", (side * 0.11, 0.39, -1.96), (rhub[0], rhub[1] + 0.09, rhub[2] - 0.04), 0.056, 0.013, mats["Carbon_Weave"], body_grp)
        add_strut(f"Susp_RL1_{side}", (side * 0.15, 0.15, -1.50), (rhub[0], rhub[1] - 0.09, rhub[2] + 0.04), 0.056, 0.013, mats["Carbon_Weave"], body_grp)
        add_strut(f"Susp_RL2_{side}", (side * 0.10, 0.15, -1.94), (rhub[0], rhub[1] - 0.09, rhub[2] - 0.04), 0.056, 0.013, mats["Carbon_Weave"], body_grp)
        add_strut(f"Susp_RAxle_{side}", (side * 0.12, 0.31, -1.70), rhub, 0.032, 0.032, mats["Carbon_Weave"], body_grp)
        add_strut(f"Susp_RPull_{side}", (side * 0.13, 0.17, -1.66), (rhub[0], rhub[1] + 0.08, rhub[2]), 0.026, 0.011, mats["Carbon_Weave"], body_grp)

    # 9. Deformable 4-Element Airfoil Front Wing (`Front_Wing_Group` at local origin, placed at (0, 0.068, 2.52))
    fw_grp = bpy.data.objects.new("Front_Wing_Group", None)
    bpy.context.collection.objects.link(fw_grp)
    fw_grp.parent = body_grp
    fw_grp.location = P(0, 0.068, 2.52)

    make_mesh_obj("FW_Main", build_airfoil_bmesh(1.94, 0.26, 0.14, 0.06, spoon_dip=0.024, sweep_z=0.10, dihedral=0.02, span_segs=28), mats["Carbon_Weave"], parent=fw_grp, bevel_w=0.002)
    for idx_fl, (fy, fz, fc, fa, mat_k) in enumerate([(0.042, -0.08, 0.17, 0.18, "Paint_Solid"), (0.088, -0.16, 0.14, 0.30, "Paint_Solid"), (0.136, -0.23, 0.11, 0.42, "Carbon_Weave")]):
        make_mesh_obj(f"FW_Flap_{idx_fl}", build_airfoil_bmesh(1.90, fc, 0.13, fa, spoon_dip=0.018, sweep_z=0.11, dihedral=0.025, span_segs=24, offset=(0, fy, fz)), mats[mat_k], parent=fw_grp, bevel_w=0.002)

    for side in (-1, 1):
        add_tube_curve(f"FW_Endplate_{side}", [(side * 0.95, 0.01, -0.10), (side * 0.98, 0.09, -0.12), (side * 0.99, 0.22, -0.15), (side * 0.96, 0.31, -0.20)], 0.078, mats["Paint_Solid"], fw_grp, scale_x_around=(side * 0.97, 0.16))
        make_mesh_obj(f"FW_Dive_{side}", build_airfoil_bmesh(0.075, 0.22, 0.16, 0.24, span_segs=5, offset=(side * 1.01, 0.15, -0.12)), mats["Carbon_Weave"], parent=fw_grp)
        add_strut(f"FW_Pylon_{side}", (side * 0.085, 0.01, 0.02), (side * 0.075, 0.13, 0.06), 0.16, 0.014, mats["Carbon_Weave"], fw_grp)

    # 10. Mobile DRS Flap (`DRS_Flap_Group` at (0, 0.955, -2.35))
    drs_grp = bpy.data.objects.new("DRS_Flap_Group", None)
    bpy.context.collection.objects.link(drs_grp)
    drs_grp.parent = body_grp
    drs_grp.location = P(0, 0.955, -2.35)
    make_mesh_obj("DRS_Airfoil", build_airfoil_bmesh(1.18, 0.22, 0.13, 0.44, spoon_dip=0.022, sweep_z=0.04, span_segs=24, offset=(0, 0.015, 0.03)), mats["Paint_Solid"], parent=drs_grp, bevel_w=0.002)

    # 11. Butterfly Steering Wheel + Driver Gloves (`Steer_Wheel_Group` at (0, 0.67, 0.54))
    sw_grp = bpy.data.objects.new("Steer_Wheel_Group", None)
    bpy.context.collection.objects.link(sw_grp)
    sw_grp.parent = body_grp
    sw_grp.location = P(0, 0.67, 0.54)

    bm_sw = bmesh.new()
    bmesh.ops.create_cube(bm_sw, size=1.0)
    for v in bm_sw.verts:
        v.co = P(v.co.x * 0.188, v.co.z * 0.100, v.co.y * 0.022)
    uv_sw = bm_sw.loops.layers.uv.new("UVMap")
    for f in bm_sw.faces:
        for l in f.loops:
            l[uv_sw].uv = (0.5, 0.5)
    make_mesh_obj("SW_Chassis", bm_sw, mats["Carbon_Weave"], parent=sw_grp, bevel_w=0.004)
    for side in (-1, 1):
        add_tube_curve(f"SW_Grip_{side}", [(side * 0.114, -0.05, -0.004), (side * 0.114, 0.05, -0.004)], 0.018, mats["Carbon_Weave"], sw_grp)
        add_tube_curve(f"Driver_Arm_{side}", [(side * 0.145, -0.06, -0.28), (side * 0.125, -0.02, -0.10), (side * 0.116, -0.004, -0.01)], 0.028, mats["Paint_Accent"], sw_grp)

    # 12. 4 Wheel Assemblies (built at origin for clean cloning/pivoting in Three.js!)
    wheels_holder = bpy.data.objects.new("Wheels_Templates", None)
    bpy.context.collection.objects.link(wheels_holder)
    wheels_holder.parent = root
    build_wheel_unit("FL", 0.345, 0.35, 1, subsurf_lvl, wheels_holder, mats)
    build_wheel_unit("FR", 0.345, 0.35, -1, subsurf_lvl, wheels_holder, mats)
    build_wheel_unit("RL", 0.365, 0.46, 1, subsurf_lvl, wheels_holder, mats)
    build_wheel_unit("RR", 0.365, 0.46, -1, subsurf_lvl, wheels_holder, mats)

    # Apply Subsurf/Bevel modifiers on Paint_Body meshes BEFORE computing cylindrical UVs so UVs are silky smooth!
    deps = bpy.context.evaluated_depsgraph_get()
    for obj in list(bpy.data.objects):
        if obj.type == "MESH" and obj.modifiers:
            bpy.context.view_layer.objects.active = obj
            for mod in list(obj.modifiers):
                bpy.ops.object.modifier_apply(modifier=mod.name)

    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.data.materials and obj.data.materials[0].name == "Paint_Body":
            apply_body_uvs(obj)

    total_tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
    out_path = os.path.join(OUT_DIR, out_filename)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=True,
        export_colors=True,
        export_materials="EXPORT",
    )
    print(f"[BLENDER F1] Exported {out_filename}: {total_tris} triangles -> {os.path.getsize(out_path)//1024} KB")


generate_f1_glb("f1_hero_lod0_raw.glb", subsurf_lvl=2)
generate_f1_glb("f1_ai_lod1_raw.glb", subsurf_lvl=0)
