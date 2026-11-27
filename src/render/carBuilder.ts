/**
 * APEX GP 3D — Ultra-Realistic CAD-Grade High-Poly Formula 1 Hero Car Builder
 * - Catmull-Rom 44x36 Bicubic-Smooth Lofted Monocoque, Droop Nose, Coke-Bottle Engine Cover & Undercut Downwash Sidepods
 * - True 3D Cambered NACA Airfoil Wings (Spoon Rear Mainplane, Bi-Plane Beam Wing, Mobile DRS Flap, 4-Element Front Wing)
 * - Swept Curved 3D Rear Wing Endplates with Integrated Glowing Red LED Taillight Strips & 15-Diode FIA Rain Light
 * - Sculpted Twin-Tunnel Venturi Diffuser + Central Triple Inconel Exhaust (Main Pipe + Dual Wastegates) + Additive Pink-Purple Plasma Plume
 * - 56-Segment Lathe Pirelli 18" Slicks, Sculpted BBS Aero Wheel Covers, Curved Over-Wheel Wake Deflectors & Aero-Blade Wishbones
 * - Zero extra draw calls: all static parts merged by PBR material!
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarState, LiveryStyleType, PaintFinishType, TeamConfig } from '../core/types';
import { ERS_MODE_SPECS } from '../core/config';
import { getCarbonNormalTexture, getCarbonTexture, getTeamTextures } from './textures';
import { markShared } from '../core/disposer';
import { fh6Assets, type PremergedF1LodTemplate } from './assetRegistry';

export interface F1CarVisual {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  haloMesh: THREE.Mesh;
  frontWingGroup: THREE.Group;
  frontWheelPivots: THREE.Group[];
  spinWheels: Array<{ mesh: THREE.Group; radius: number; side: number }>;
  drsFlapGroup: THREE.Group;
  steerWheelGroup: THREE.Group;
  oledCanvas: HTMLCanvasElement | null;
  oledCtx: CanvasRenderingContext2D | null;
  oledTex: THREE.CanvasTexture | null;
  brakeDiscMat: THREE.MeshStandardMaterial;
  rainLightMat: THREE.MeshStandardMaterial;
  exhaustFlameMat: THREE.MeshBasicMaterial;
  exhaustCone: THREE.Mesh;
  sidewallMat: THREE.MeshStandardMaterial;
  wheelBlurMat: THREE.MeshBasicMaterial;
  policeLightbarGroup?: THREE.Group;
  policeRedMat?: THREE.MeshStandardMaterial;
  policeBlueMat?: THREE.MeshStandardMaterial;
  infectionAuraMesh?: THREE.Mesh;
  lastOledUpdate: number;
}

export interface LoftSlice {
  z: number;
  wBottom: number;
  wTop: number;
  yBottom: number;
  yTop: number;
  wMidScale?: number;
}

function normalizeForMerge(rawGeo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = rawGeo.index ? rawGeo.toNonIndexed() : rawGeo.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const count = g.attributes.position.count;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  for (const key of Object.keys(g.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'uv' && key !== 'color') {
      g.deleteAttribute(key);
    }
  }
  return g;
}

function paintVertexColor(rawGeo: THREE.BufferGeometry, hexColor: string): THREE.BufferGeometry {
  if (!rawGeo.attributes.normal) rawGeo.computeVertexNormals();
  const g = normalizeForMerge(rawGeo);
  const count = g.attributes.position.count;
  const col = new THREE.Color(hexColor);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function mergeGroup(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = geos.map((g) => {
    if (!g.attributes.normal) g.computeVertexNormals();
    return normalizeForMerge(g);
  });
  const merged = mergeGeometries(norm, false);
  for (const g of norm) g.dispose();
  if (!merged) throw new Error('Failed to merge car geometries');
  return merged;
}

/**
 * Cylindrical-Wrap UV Projection so stripes & sponsor decals wrap cleanly over both top surfaces AND vertical side flanks!
 */
function applySculptedBodyUVs(geometry: THREE.BufferGeometry, halfWidth = 0.96, zMin = -2.28, zMax = 2.82): void {
  const pos = geometry.attributes.position;
  const norm = geometry.attributes.normal;
  const uvs = new Float32Array(pos.count * 2);
  const zSpan = zMax - zMin;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = norm ? norm.getX(i) : 0;
    // Blend lateral X with vertical Y wrap on steep side flanks to eliminate vertical texture smearing
    const wrapX = x + Math.sign(x || nx) * Math.max(0, y - 0.35) * 0.28 * Math.abs(nx);
    const u = THREE.MathUtils.clamp(0.5 - wrapX / (halfWidth * 2), 0.02, 0.98);
    const v = THREE.MathUtils.clamp((z - zMin) / zSpan, 0.01, 0.99);
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

function catmullRom1D(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * CAD-Grade Catmull-Rom Bicubic Smooth Lofted Hull (44 circumferential pts x 36 smooth longitudinal stations)
 * Eliminates all polygonal creases and faceted boxes!
 */
export function buildSmoothLoftedHull(controlSlices: LoftSlice[], ringPts = 44, zSteps = 36): THREE.BufferGeometry {
  const slices: LoftSlice[] = [];
  const nCtrl = controlSlices.length;
  for (let s = 0; s <= zSteps; s++) {
    const u = (s / zSteps) * (nCtrl - 1);
    const idx = Math.min(nCtrl - 2, Math.floor(u));
    const frac = u - idx;
    const s0 = controlSlices[Math.max(0, idx - 1)];
    const s1 = controlSlices[idx];
    const s2 = controlSlices[Math.min(nCtrl - 1, idx + 1)];
    const s3 = controlSlices[Math.min(nCtrl - 1, idx + 2)];

    slices.push({
      z: catmullRom1D(s0.z, s1.z, s2.z, s3.z, frac),
      wBottom: Math.max(0.015, catmullRom1D(s0.wBottom, s1.wBottom, s2.wBottom, s3.wBottom, frac)),
      wTop: Math.max(0.012, catmullRom1D(s0.wTop, s1.wTop, s2.wTop, s3.wTop, frac)),
      yBottom: catmullRom1D(s0.yBottom, s1.yBottom, s2.yBottom, s3.yBottom, frac),
      yTop: catmullRom1D(s0.yTop, s1.yTop, s2.yTop, s3.yTop, frac),
      wMidScale: catmullRom1D(s0.wMidScale ?? 1.06, s1.wMidScale ?? 1.06, s2.wMidScale ?? 1.06, s3.wMidScale ?? 1.06, frac)
    });
  }

  const positions: number[] = [];
  const indices: number[] = [];

  for (const s of slices) {
    const cy = (s.yBottom + s.yTop) * 0.5;
    const ry = Math.max(0.008, (s.yTop - s.yBottom) * 0.5);
    const midBulge = s.wMidScale ?? 1.06;
    for (let j = 0; j < ringPts; j++) {
      const theta = (j / ringPts) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const wMax = Math.max(s.wBottom, s.wTop) * midBulge;
      const wHalf = cosT >= 0
        ? THREE.MathUtils.lerp(wMax, s.wTop, Math.pow(cosT, 0.85))
        : THREE.MathUtils.lerp(wMax, s.wBottom, Math.pow(-cosT, 0.75));
      const sx = Math.sign(sinT) * Math.pow(Math.abs(sinT), 0.88) * wHalf;
      const sy = cy + Math.sign(cosT) * Math.pow(Math.abs(cosT), 0.90) * ry;
      positions.push(sx, sy, s.z);
    }
  }

  for (let i = 0; i < slices.length - 1; i++) {
    const a0 = i * ringPts;
    const b0 = (i + 1) * ringPts;
    for (let j = 0; j < ringPts; j++) {
      const jNext = (j + 1) % ringPts;
      const v0 = a0 + j;
      const v1 = a0 + jNext;
      const v2 = b0 + jNext;
      const v3 = b0 + j;
      indices.push(v0, v3, v2, v0, v2, v1);
    }
  }

  const fCenter = positions.length / 3;
  const sf = slices[slices.length - 1];
  positions.push(0, (sf.yBottom + sf.yTop) * 0.5, sf.z + 0.015);
  const fRing = (slices.length - 1) * ringPts;
  for (let j = 0; j < ringPts; j++) {
    indices.push(fCenter, fRing + ((j + 1) % ringPts), fRing + j);
  }

  const bCenter = positions.length / 3;
  const sb = slices[0];
  positions.push(0, (sb.yBottom + sb.yTop) * 0.5, sb.z - 0.01);
  for (let j = 0; j < ringPts; j++) {
    indices.push(bCenter, j, (j + 1) % ringPts);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates a True 3D Cambered NACA Airfoil Wing Span with Rounded Leading Edge, Razor Trailing Edge,
 * Central Spoon-Wing Downforce Dip & Backward Sweep (Replaces flat BoxGeometry planks!)
 */
function buildAirfoilWingGeo(opts: {
  span: number;
  chord: number;
  thickness: number;
  angleRad?: number;
  spoonDip?: number;
  sweepZ?: number;
  tipDihedral?: number;
  spanSegs?: number;
}): THREE.BufferGeometry {
  const {
    span,
    chord,
    thickness,
    angleRad = 0,
    spoonDip = 0,
    sweepZ = 0,
    tipDihedral = 0,
    spanSegs = 28
  } = opts;

  // 18-point closed cambered NACA airfoil profile (u=0 at leading edge z=+0.5, u=1 at trailing edge z=-0.5)
  const profSegs = 18;
  const profile: Array<[number, number]> = [];
  for (let k = 0; k < profSegs; k++) {
    const a = (k / profSegs) * Math.PI * 2;
    // Cosine-clustered chord coordinate x_c in [0..1] from leading edge (0) to trailing edge (1)
    const xc = 0.5 * (1 - Math.cos(a));
    const isUpper = k < profSegs / 2;
    // NACA 4-digit thickness distribution
    const yt = 5 * thickness * (0.2969 * Math.sqrt(Math.max(0.0001, xc)) - 0.1260 * xc - 0.3516 * xc * xc + 0.2843 * xc * xc * xc - 0.1015 * xc * xc * xc * xc);
    // Inverted motorsport downforce camber (suction on underside!)
    const camberY = -Math.sin(xc * Math.PI) * thickness * 0.38;
    const localY = camberY + (isUpper ? yt : -yt);
    const localZ = (0.5 - xc) * chord;
    // Rotate by angle of attack
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    profile.push([
      localY * cosA - localZ * sinA,
      localY * sinA + localZ * cosA
    ]);
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= spanSegs; i++) {
    const sFrac = i / spanSegs; // 0..1 from left (-span/2) to right (+span/2)
    const x = (sFrac - 0.5) * span;
    const absLat = Math.abs(sFrac - 0.5) * 2; // 0 at center, 1 at tips
    const chordScale = 1.0 - Math.pow(absLat, 3.0) * 0.12;
    const yOff = -spoonDip * Math.pow(Math.max(0, Math.cos(absLat * Math.PI * 0.5)), 1.6) + tipDihedral * Math.pow(absLat, 2.2);
    const zOff = -sweepZ * Math.pow(absLat, 1.5);

    for (let k = 0; k < profSegs; k++) {
      const [py, pz] = profile[k];
      positions.push(x, py * chordScale + yOff, pz * chordScale + zOff);
      uvs.push(sFrac, k / profSegs);
    }
  }

  for (let i = 0; i < spanSegs; i++) {
    const r0 = i * profSegs;
    const r1 = (i + 1) * profSegs;
    for (let k = 0; k < profSegs; k++) {
      const kNext = (k + 1) % profSegs;
      indices.push(r0 + k, r1 + k, r1 + kNext, r0 + k, r1 + kNext, r0 + kNext);
    }
  }

  // Cap left & right wingtips
  const leftCenter = positions.length / 3;
  positions.push(-span * 0.5, tipDihedral, -sweepZ);
  uvs.push(0, 0.5);
  for (let k = 0; k < profSegs; k++) {
    indices.push(leftCenter, (k + 1) % profSegs, k);
  }

  const rightCenter = positions.length / 3;
  positions.push(span * 0.5, tipDihedral, -sweepZ);
  uvs.push(1, 0.5);
  const lastRing = spanSegs * profSegs;
  for (let k = 0; k < profSegs; k++) {
    indices.push(rightCenter, lastRing + k, lastRing + ((k + 1) % profSegs));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates an Aero-Blade Elliptical Carbon Wishbone / Suspension Strut
 */
function buildAeroStrut(p1: THREE.Vector3, p2: THREE.Vector3, chord = 0.046, thick = 0.013): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  const cyl = new THREE.CylinderGeometry(1, 1, len, 12);
  cyl.scale(thick, 1, chord);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  cyl.applyQuaternion(quat);
  cyl.translate((p1.x + p2.x) * 0.5, (p1.y + p2.y) * 0.5, (p1.z + p2.z) * 0.5);
  cyl.computeVertexNormals();
  return cyl;
}

/**
 * Soft Radial/Axial Pink-Purple Plasma Plume Texture (Replaces hard geometric ConeGeometry!)
 */
let cachedPlasmaTex: THREE.CanvasTexture | null = null;
function getExhaustPlasmaTexture(): THREE.CanvasTexture {
  if (cachedPlasmaTex) return cachedPlasmaTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 256);

  // Soft volumetric plasma jet from nozzle (y=248) to tail (y=8) with shock diamonds
  for (let y = 8; y < 250; y++) {
    const t = 1.0 - (y - 8) / 242; // 0 at nozzle, 1 at tip
    const halfW = (1.0 - Math.pow(t, 1.35)) * 54 * (0.85 + 0.15 * Math.sin(t * 22.0));
    const alpha = Math.pow(1.0 - t, 1.45) * (0.78 + 0.22 * Math.cos(t * 18.0));
    if (halfW < 1) continue;
    const grad = ctx.createLinearGradient(64 - halfW, y, 64 + halfW, y);
    grad.addColorStop(0.0, 'rgba(180, 20, 255, 0)');
    grad.addColorStop(0.28, `rgba(255, 38, 195, ${(alpha * 0.65).toFixed(3)})`);
    grad.addColorStop(0.50, `rgba(255, 215, 255, ${Math.min(1, alpha * 1.15).toFixed(3)})`);
    grad.addColorStop(0.72, `rgba(255, 38, 195, ${(alpha * 0.65).toFixed(3)})`);
    grad.addColorStop(1.0, 'rgba(180, 20, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(64 - halfW, y, halfW * 2, 2);
  }

  const tex = markShared(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedPlasmaTex = tex;
  return tex;
}

/**
 * Builds the 3-Star Crossed Additive Plasma Plume + Rear Nozzle Halo Geometry
 */
function buildExhaustPlasmaGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // 3 crossed longitudinal jet planes for 360° volumetric afterburner plume
  for (let k = 0; k < 3; k++) {
    const p = new THREE.PlaneGeometry(0.24, 0.78);
    p.rotateX(Math.PI / 2);
    p.rotateZ((k / 3) * Math.PI);
    p.translate(0, 0, -0.36);
    parts.push(p.toNonIndexed());
    p.dispose();
  }
  return markShared(mergeGeometries(parts, false)!);
}

interface SharedCarAssets {
  carbonMat: THREE.MeshStandardMaterial;
  darkMat: THREE.MeshStandardMaterial;
  titaniumExhaustMat: THREE.MeshStandardMaterial;
  mirrorGlassMat: THREE.MeshStandardMaterial;
  wheelVertexColorMat: THREE.MeshStandardMaterial;
  tireRubberMat: THREE.MeshStandardMaterial;
  rimAlloyMat: THREE.MeshStandardMaterial;
  visorMat: THREE.MeshPhysicalMaterial;
  contactShadowMat: THREE.MeshBasicMaterial;
  contactShadowGeo: THREE.PlaneGeometry;
  frontBlurGeo: THREE.RingGeometry;
  rearBlurGeo: THREE.RingGeometry;
  plasmaPlumeGeo: THREE.BufferGeometry;
  wheelGeos: Record<string, {
    tireRimGeo: THREE.BufferGeometry;
    sideGeo: THREE.BufferGeometry;
    discGeo: THREE.BufferGeometry;
  }>;
  sharedCarbonGeo: THREE.BufferGeometry;
  sharedTitaniumGeo: THREE.BufferGeometry;
  sharedMirrorGlassGeo: THREE.BufferGeometry;
  sharedTaillightGeo: THREE.BufferGeometry;
  sharedHaloGeo: THREE.BufferGeometry;
  sharedFinDecalGeo: THREE.BufferGeometry;
  sharedDarkGeo: THREE.BufferGeometry;
  sharedPaintHullGeo: THREE.BufferGeometry;
  sharedSolidPaintGeo: THREE.BufferGeometry;
  sharedAccentGeo: THREE.BufferGeometry;
  sharedFrontWingCarbonGeo: THREE.BufferGeometry;
  sharedFrontWingPaintGeo: THREE.BufferGeometry;
  sharedDrsFlapGeo: THREE.BufferGeometry;
  sharedSteerWheelGeo: THREE.BufferGeometry;
  sharedDriverGlovesGeo: THREE.BufferGeometry;
}

let sharedAssets: SharedCarAssets | null = null;

/**
 * Ultra-Realistic 56-Segment Lathe Pirelli 18" Slick Tire + Sculpted BBS Aero Wheel Cover + 6-Piston Brembo Brake Assembly!
 */
function buildWheelGeometries(radius: number, width: number, side: number) {
  const coloredParts: THREE.BufferGeometry[] = [];
  const halfW = width * 0.5;
  const rimR = radius * 0.59;

  // 1. Seamless 56-Segment Lathe Pirelli Slick Tire Profile (crowned tread + smooth rounded shoulders + concave sidewall!)
  const lathePts: THREE.Vector2[] = [];
  const profileSteps = 22;
  for (let i = 0; i <= profileSteps; i++) {
    const t = (i / profileSteps) * 2 - 1; // -1 (inner bead) to +1 (outer bead)
    const absT = Math.abs(t);
    let r: number;
    let y: number;
    if (absT < 0.70) {
      // Slightly crowned slick contact tread
      const u = absT / 0.70;
      r = radius - u * u * 0.008;
      y = t * (halfW * 0.94 / 0.70) * 0.70;
    } else {
      // Smooth rounded shoulder curving down to the 18-inch rim bead flange
      const u = Math.min(1, Math.max(0, (absT - 0.70) / 0.30));
      const shoulderArc = Math.max(0, Math.cos(u * Math.PI * 0.5));
      r = rimR + (radius - 0.008 - rimR) * Math.pow(shoulderArc, 0.62);
      y = Math.sign(t) * (halfW * 0.66 + Math.sin(u * Math.PI * 0.5) * (halfW * 0.32));
    }
    lathePts.push(new THREE.Vector2(r, y));
  }

  const tireLathe = new THREE.LatheGeometry(lathePts, 56);
  tireLathe.rotateZ(Math.PI / 2);
  tireLathe.computeVertexNormals();
  const tNonIdx = normalizeForMerge(tireLathe);
  tireLathe.dispose();

  const tPos = tNonIdx.attributes.position;
  const tCols = new Float32Array(tPos.count * 3);
  const cCenter = new THREE.Color('#282d36');
  const cWearGroove = new THREE.Color('#1f232a');
  const cShoulder = new THREE.Color('#15181e');
  const cTmp = new THREE.Color();
  for (let i = 0; i < tPos.count; i++) {
    const vx = tPos.getX(i);
    const vy = tPos.getY(i);
    const vz = tPos.getZ(i);
    const rad = Math.hypot(vy, vz);
    const xFrac = Math.min(1, Math.abs(vx) / (halfW * 0.92));
    if (rad < radius - 0.022) {
      cTmp.copy(cShoulder);
    } else {
      const wearBand = Math.exp(-Math.pow((xFrac - 0.42) * 4.5, 2));
      cTmp.copy(cCenter).lerp(cWearGroove, wearBand * 0.65).lerp(cShoulder, Math.pow(xFrac, 3.0));
    }
    tCols[i * 3] = cTmp.r;
    tCols[i * 3 + 1] = cTmp.g;
    tCols[i * 3 + 2] = cTmp.b;
  }
  tNonIdx.setAttribute('color', new THREE.BufferAttribute(tCols, 3));
  coloredParts.push(tNonIdx);

  // 2. Forged Magnesium Inner Barrel + Sculpted 18-Inch BBS Carbon Aero Wheel Cover!
  const barrel = new THREE.CylinderGeometry(rimR, rimR, width * 0.88, 36);
  barrel.rotateZ(Math.PI / 2);
  coloredParts.push(paintVertexColor(barrel, '#141820'));
  barrel.dispose();

  // Outer Machined Aluminum Rim Lip Flange
  const rimLip = new THREE.TorusGeometry(rimR + 0.004, 0.012, 12, 44);
  rimLip.rotateY(Math.PI / 2);
  rimLip.translate(side * (halfW * 0.93), 0, 0);
  coloredParts.push(paintVertexColor(rimLip, '#586375'));
  rimLip.dispose();

  // Sculpted Conical Dish BBS Aero Cover
  const coverPts = [
    new THREE.Vector2(0.045, 0.018),
    new THREE.Vector2(rimR * 0.48, -0.016),
    new THREE.Vector2(rimR * 0.88, 0.012),
    new THREE.Vector2(rimR * 0.99, 0.004)
  ];
  const aeroDish = new THREE.LatheGeometry(coverPts, 40);
  aeroDish.rotateZ(side > 0 ? -Math.PI / 2 : Math.PI / 2);
  aeroDish.translate(side * (halfW * 0.90), 0, 0);
  coloredParts.push(paintVertexColor(aeroDish, '#1d222c'));
  aeroDish.dispose();

  // 10 Fine Machined BBS Structural Ribs + Anodized Center-Lock Wheel Nut
  const outerX = side * (halfW * 0.915);
  for (let s = 0; s < 10; s++) {
    const ang = (s / 10) * Math.PI * 2;
    const rib = new THREE.BoxGeometry(0.012, rimR * 0.44, 0.014);
    rib.rotateX(ang);
    rib.translate(outerX, Math.cos(ang) * rimR * 0.68, Math.sin(ang) * rimR * 0.68);
    coloredParts.push(paintVertexColor(rib, '#3a4456'));
    rib.dispose();
  }

  const nut = new THREE.CylinderGeometry(0.032, 0.052, 0.058, 12);
  nut.rotateZ(side > 0 ? -Math.PI / 2 : Math.PI / 2);
  nut.translate(side * (halfW * 0.94), 0, 0);
  coloredParts.push(paintVertexColor(nut, side > 0 ? '#e10600' : '#0066ff'));
  nut.dispose();

  const tireRimGeo = markShared(mergeGeometries(coloredParts, false)!);
  coloredParts.forEach((g) => g.dispose());

  // Pirelli Colored Sidewall Ring Decal Discs
  const sideParts: THREE.BufferGeometry[] = [];
  for (const end of [-1, 1]) {
    const ring = new THREE.RingGeometry(rimR + 0.012, radius - 0.022, 44);
    ring.rotateY(end > 0 ? Math.PI / 2 : -Math.PI / 2);
    ring.translate(end * (halfW * 0.965), 0, 0);
    sideParts.push(ring);
  }
  const sideGeo = markShared(mergeGroup(sideParts));
  sideParts.forEach((g) => g.dispose());

  // Ventilated Carbon-Ceramic Brake Rotor + Sculpted 6-Piston Brembo Caliper
  const discParts: THREE.BufferGeometry[] = [];
  const rotor = new THREE.CylinderGeometry(radius * 0.50, radius * 0.50, 0.048, 32);
  rotor.rotateZ(Math.PI / 2);
  rotor.translate(-side * (width * 0.18), 0, 0);
  discParts.push(rotor);

  const caliper = new THREE.CylinderGeometry(radius * 0.53, radius * 0.53, 0.082, 16, 1, false, -0.45, 0.90);
  caliper.rotateZ(Math.PI / 2);
  caliper.translate(-side * (width * 0.18), 0, 0);
  discParts.push(caliper);

  const discGeo = markShared(mergeGroup(discParts));
  discParts.forEach((g) => g.dispose());

  return { tireRimGeo, sideGeo, discGeo };
}

function getSharedCarAssets(): SharedCarAssets {
  if (sharedAssets) return sharedAssets;

  const carbonTex = getCarbonTexture();
  const carbonNormalTex = getCarbonNormalTexture();

  // 5-Zone Ambient Occlusion Contact Shadow (Deep Venturi Floor Plank AO + 4 Dark Tire Contact Patches!)
  const sCanvas = document.createElement('canvas');
  sCanvas.width = 256;
  sCanvas.height = 512;
  const sCtx = sCanvas.getContext('2d')!;
  sCtx.clearRect(0, 0, 256, 512);

  const outerGrad = sCtx.createRadialGradient(128, 256, 18, 128, 256, 124);
  outerGrad.addColorStop(0, 'rgba(0,0,0,0.94)');
  outerGrad.addColorStop(0.58, 'rgba(0,0,0,0.72)');
  outerGrad.addColorStop(0.85, 'rgba(0,0,0,0.28)');
  outerGrad.addColorStop(1, 'rgba(0,0,0,0)');
  sCtx.fillStyle = outerGrad;
  sCtx.fillRect(0, 0, 256, 512);

  sCtx.fillStyle = 'rgba(0,0,0,0.82)';
  sCtx.beginPath();
  sCtx.roundRect(52, 80, 152, 350, 38);
  sCtx.fill();

  const drawTireAO = (cx: number, cy: number, rx: number, ry: number) => {
    const tg = sCtx.createRadialGradient(cx, cy, 4, cx, cy, ry);
    tg.addColorStop(0, 'rgba(0,0,0,0.98)');
    tg.addColorStop(0.62, 'rgba(0,0,0,0.76)');
    tg.addColorStop(1, 'rgba(0,0,0,0)');
    sCtx.fillStyle = tg;
    sCtx.beginPath();
    sCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    sCtx.fill();
  };
  drawTireAO(36, 106, 27, 40);
  drawTireAO(220, 106, 27, 40);
  drawTireAO(34, 406, 32, 44);
  drawTireAO(222, 406, 32, 44);

  const shadowTex = markShared(new THREE.CanvasTexture(sCanvas));

  const paintParts: THREE.BufferGeometry[] = [];
  const solidPaintParts: THREE.BufferGeometry[] = [];
  const carbonParts: THREE.BufferGeometry[] = [];
  const titaniumParts: THREE.BufferGeometry[] = [];
  const mirrorGlassParts: THREE.BufferGeometry[] = [];
  const taillightParts: THREE.BufferGeometry[] = [];
  const darkParts: THREE.BufferGeometry[] = [];
  const accentParts: THREE.BufferGeometry[] = [];

  // 1. CAD-Grade Catmull-Rom Monocoque, Tapered Coke-Bottle Engine Cover & Droop Nosecone (44x36 smooth sculpt!)
  const chassisGeo = buildSmoothLoftedHull([
    { z: -2.28, wBottom: 0.085, wTop: 0.055, yBottom: 0.19,  yTop: 0.41, wMidScale: 1.02 },
    { z: -1.85, wBottom: 0.16,  wTop: 0.11,  yBottom: 0.10,  yTop: 0.56, wMidScale: 1.05 },
    { z: -1.35, wBottom: 0.27,  wTop: 0.18,  yBottom: 0.055, yTop: 0.76, wMidScale: 1.08 },
    { z: -0.82, wBottom: 0.36,  wTop: 0.24,  yBottom: 0.048, yTop: 0.91, wMidScale: 1.08 },
    { z: -0.34, wBottom: 0.40,  wTop: 0.30,  yBottom: 0.048, yTop: 0.96, wMidScale: 1.06 },
    { z: 0.06,  wBottom: 0.41,  wTop: 0.35,  yBottom: 0.048, yTop: 0.64, wMidScale: 1.05 },
    { z: 0.68,  wBottom: 0.36,  wTop: 0.33,  yBottom: 0.052, yTop: 0.62, wMidScale: 1.04 },
    { z: 1.38,  wBottom: 0.28,  wTop: 0.24,  yBottom: 0.080, yTop: 0.53, wMidScale: 1.04 },
    { z: 2.08,  wBottom: 0.18,  wTop: 0.14,  yBottom: 0.095, yTop: 0.35, wMidScale: 1.03 },
    { z: 2.62,  wBottom: 0.11,  wTop: 0.08,  yBottom: 0.085, yTop: 0.20, wMidScale: 1.02 },
    { z: 2.86,  wBottom: 0.05,  wTop: 0.035, yBottom: 0.088, yTop: 0.145, wMidScale: 1.0 }
  ], 44, 38);
  applySculptedBodyUVs(chassisGeo, 0.96, -2.28, 2.86);
  paintParts.push(chassisGeo);

  // Nose FOM Aero Camera Pods & Pitot Sensor Mast
  for (const side of [-1, 1]) {
    const camWing = buildAirfoilWingGeo({ span: 0.15, chord: 0.11, thickness: 0.22, angleRad: 0.05, spanSegs: 8 });
    camWing.translate(side * 0.21, 0.31, 1.98);
    carbonParts.push(camWing);
  }
  const pitotMast = new THREE.CylinderGeometry(0.006, 0.010, 0.09, 8);
  pitotMast.translate(0, 0.63, 0.92);
  titaniumParts.push(pitotMast);

  // 2. Sculpted High-Undercut Downwash Sidepods + Rounded Carbon Inlet Lip + 3D Cooling Gill Louvers!
  const spSlices: LoftSlice[] = [
    { z: -1.96, wBottom: 0.08, wTop: 0.05, yBottom: 0.058, yTop: 0.27, wMidScale: 1.04 },
    { z: -1.42, wBottom: 0.24, wTop: 0.16, yBottom: 0.048, yTop: 0.44, wMidScale: 1.10 },
    { z: -0.75, wBottom: 0.42, wTop: 0.33, yBottom: 0.048, yTop: 0.58, wMidScale: 1.12 },
    { z: -0.05, wBottom: 0.46, wTop: 0.39, yBottom: 0.050, yTop: 0.61, wMidScale: 1.10 },
    { z: 0.48,  wBottom: 0.42, wTop: 0.39, yBottom: 0.085, yTop: 0.60, wMidScale: 1.08 },
    { z: 0.78,  wBottom: 0.26, wTop: 0.36, yBottom: 0.22,  yTop: 0.58, wMidScale: 1.04 }
  ];
  for (const side of [-1, 1]) {
    const sp = buildSmoothLoftedHull(spSlices, 36, 28);
    sp.translate(side * 0.44, 0, 0);
    applySculptedBodyUVs(sp, 0.96, -2.28, 2.86);
    paintParts.push(sp);

    // Sculpted Curved Carbon Radiator Inlet Lip (TubeGeometry ring) + Deep Recessed Radiator Core
    const lipCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.30, 0.57, 0.78),
      new THREE.Vector3(side * 0.72, 0.56, 0.75),
      new THREE.Vector3(side * 0.74, 0.35, 0.68),
      new THREE.Vector3(side * 0.32, 0.33, 0.72)
    ], true);
    const lipGeo = new THREE.TubeGeometry(lipCurve, 28, 0.018, 10, true);
    carbonParts.push(lipGeo);

    const radCore = new THREE.PlaneGeometry(0.38, 0.21);
    radCore.rotateY(side * -0.12);
    radCore.translate(side * 0.52, 0.45, 0.72);
    darkParts.push(radCore);

    // 5 Sculpted 3D Cooling Gill Louvers along Engine Cover Shoulder
    for (let g = 0; g < 5; g++) {
      const gill = buildAirfoilWingGeo({ span: 0.14, chord: 0.045, thickness: 0.18, angleRad: 0.38, spanSegs: 6 });
      gill.rotateZ(side * -0.45);
      gill.translate(side * (0.44 - g * 0.025), 0.56 - g * 0.018, -0.25 - g * 0.16);
      darkParts.push(gill);
    }

    // Aerodynamic Swan-Neck Wing Mirror Housing + Reflective Glass Lens!
    const mirrorStalk = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.34, 0.62, 0.48),
      new THREE.Vector3(side * 0.48, 0.68, 0.47),
      new THREE.Vector3(side * 0.58, 0.68, 0.45)
    ]);
    carbonParts.push(new THREE.TubeGeometry(mirrorStalk, 12, 0.011, 8, false));

    const mirrorPod = buildSmoothLoftedHull([
      { z: 0.39, wBottom: 0.068, wTop: 0.062, yBottom: 0.655, yTop: 0.705 },
      { z: 0.46, wBottom: 0.072, wTop: 0.066, yBottom: 0.652, yTop: 0.708 },
      { z: 0.53, wBottom: 0.025, wTop: 0.020, yBottom: 0.668, yTop: 0.692 }
    ], 20, 10);
    mirrorPod.translate(side * 0.59, 0, 0);
    solidPaintParts.push(mirrorPod);

    const mirrorLens = new THREE.CircleGeometry(0.032, 16);
    mirrorLens.scale(1.85, 0.72, 1);
    mirrorLens.rotateY(Math.PI);
    mirrorLens.translate(side * 0.59, 0.68, 0.386);
    mirrorGlassParts.push(mirrorLens);

    // Sculpted Crescent 3D Over-Wheel Aero Wake Deflector ("Wheel Brow" hugging front tire arc — NO floating brick!)
    const browCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.77, 0.48, 1.44),
      new THREE.Vector3(side * 0.78, 0.66, 1.56),
      new THREE.Vector3(side * 0.79, 0.715, 1.72),
      new THREE.Vector3(side * 0.80, 0.675, 1.88)
    ]);
    const browTube = new THREE.TubeGeometry(browCurve, 22, 0.028, 10, false);
    const bPos = browTube.attributes.position;
    for (let bi = 0; bi < bPos.count; bi++) {
      // Flatten vertical thickness slightly around curve height while expanding lateral blade width
      const bx = bPos.getX(bi);
      bPos.setX(bi, side * 0.785 + (bx - side * 0.785) * 2.1);
    }
    browTube.computeVertexNormals();
    carbonParts.push(browTube);

    // Inner Front & Rear Carbon Brake Cooling Duct Scoops
    const fBrakeScoop = new THREE.CylinderGeometry(0.11, 0.13, 0.12, 18, 1, false, 0, Math.PI);
    fBrakeScoop.rotateZ(Math.PI / 2);
    fBrakeScoop.translate(side * 0.75, 0.324, 1.72);
    carbonParts.push(fBrakeScoop);

    const rBrakeScoop = new THREE.CylinderGeometry(0.12, 0.14, 0.14, 18, 1, false, 0, Math.PI);
    rBrakeScoop.rotateZ(Math.PI / 2);
    rBrakeScoop.translate(side * 0.74, 0.344, -1.70);
    carbonParts.push(rBrakeScoop);
  }

  // 3. Ground-Effect Carbon Venturi Floor, Edge Vortex Tunnels & Sculpted Twin-Arch Rear Diffuser!
  const floorShape = new THREE.Shape();
  floorShape.moveTo(-0.42, 1.18);
  floorShape.bezierCurveTo(-0.78, 1.05, -0.96, 0.86, -0.96, 0.68);
  floorShape.lineTo(-0.96, -1.32);
  floorShape.bezierCurveTo(-0.94, -1.62, -0.70, -1.88, -0.62, -2.14);
  floorShape.lineTo(0.62, -2.14);
  floorShape.bezierCurveTo(0.70, -1.88, 0.94, -1.62, 0.96, -1.32);
  floorShape.lineTo(0.96, 0.68);
  floorShape.bezierCurveTo(0.96, 0.86, 0.78, 1.05, 0.42, 1.18);
  floorShape.closePath();

  const floorGeo = new THREE.ExtrudeGeometry(floorShape, {
    depth: 0.026,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.012,
    bevelSegments: 3
  });
  floorGeo.rotateX(Math.PI / 2);
  floorGeo.translate(0, 0.062, 0);
  carbonParts.push(floorGeo);

  // Floor-Edge Rolled Vortex Winglet Skirts
  for (const side of [-1, 1]) {
    const skirtCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.955, 0.052, 0.62),
      new THREE.Vector3(side * 0.965, 0.058, -0.25),
      new THREE.Vector3(side * 0.950, 0.052, -1.25)
    ]);
    accentParts.push(new THREE.TubeGeometry(skirtCurve, 20, 0.016, 8, false));
  }

  // Sculpted Arched Twin-Tunnel Venturi Diffuser Roof & Curved Strakes (OPEN hollow tunnels from behind — no flat box!)
  for (const side of [-1, 1]) {
    // Arched Venturi expansion tunnel roof shell
    const tunnelRoof = new THREE.CylinderGeometry(0.26, 0.20, 0.56, 20, 4, true, -Math.PI * 0.46, Math.PI * 0.92);
    tunnelRoof.scale(1.05, 1.0, 0.68);
    tunnelRoof.rotateX(Math.PI / 2 - 0.22);
    tunnelRoof.translate(side * 0.30, 0.14, -2.08);
    carbonParts.push(tunnelRoof);

    // Deep dark shadow throat inside each Venturi tunnel so rear view looks deep & aerodynamic
    const throat = new THREE.CircleGeometry(0.23, 18, 0, Math.PI);
    throat.scale(1.05, 0.68, 1);
    throat.rotateY(Math.PI);
    throat.translate(side * 0.30, 0.075, -1.86);
    darkParts.push(throat);
  }

  // Upper Diffuser Gurney Flap Lip & 6 Curved Carbon Venturi Strakes
  const diffGurney = buildAirfoilWingGeo({ span: 1.18, chord: 0.08, thickness: 0.18, angleRad: -0.35, spoonDip: -0.025, spanSegs: 20 });
  diffGurney.translate(0, 0.255, -2.32);
  carbonParts.push(diffGurney);

  for (const sx of [-0.55, -0.35, -0.16, 0.16, 0.35, 0.55]) {
    const strakeShape = new THREE.Shape();
    strakeShape.moveTo(0, 0.052);
    strakeShape.lineTo(0.46, 0.052);
    strakeShape.lineTo(0.46, 0.15);
    strakeShape.quadraticCurveTo(0.18, 0.19, 0, 0.215);
    strakeShape.closePath();
    const strake = new THREE.ExtrudeGeometry(strakeShape, { depth: 0.010, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 });
    strake.rotateY(-Math.PI / 2);
    strake.translate(sx + 0.005, 0, -2.32);
    carbonParts.push(strake);
  }

  // Central Rear Carbon Crash-Structure Keel
  const crashKeel = buildSmoothLoftedHull([
    { z: -2.35, wBottom: 0.046, wTop: 0.042, yBottom: 0.12, yTop: 0.29 },
    { z: -2.05, wBottom: 0.065, wTop: 0.058, yBottom: 0.10, yTop: 0.32 },
    { z: -1.75, wBottom: 0.095, wTop: 0.085, yBottom: 0.09, yTop: 0.35 }
  ], 18, 10);
  carbonParts.push(crashKeel);

  // 4. CENTRAL TRIPLE INCONEL EXHAUST CLUSTER (Hollow Main Tailpipe + Dual Angled Wastegate Tailpipes!)
  const addHollowPipe = (x: number, y: number, z: number, rOuter: number, rInner: number, len: number) => {
    const outer = new THREE.CylinderGeometry(rOuter, rOuter * 1.06, len, 28, 1, true);
    outer.rotateX(Math.PI / 2);
    outer.translate(x, y, z);
    titaniumParts.push(outer);

    const lip = new THREE.TorusGeometry((rOuter + rInner) * 0.5, (rOuter - rInner) * 0.5, 10, 28);
    lip.translate(x, y, z - len * 0.5);
    titaniumParts.push(lip);

    const bore = new THREE.CircleGeometry(rInner, 24);
    bore.rotateY(Math.PI);
    bore.translate(x, y, z - len * 0.46);
    darkParts.push(bore);
  };
  // Central Main Turbo Exhaust + Left & Right Wastegate Pipes (Central Triple Exhaust!)
  addHollowPipe(0, 0.385, -2.24, 0.062, 0.053, 0.32);
  addHollowPipe(-0.068, 0.342, -2.22, 0.028, 0.022, 0.26);
  addHollowPipe(0.068, 0.342, -2.22, 0.028, 0.022, 0.26);

  // 5. Sculpted Roll-Hoop Airbox, T-Cam Winglet & Beveled Dorsal Shark Fin
  const airbox = buildSmoothLoftedHull([
    { z: -0.58, wBottom: 0.13, wTop: 0.08, yBottom: 0.80, yTop: 0.96 },
    { z: -0.28, wBottom: 0.18, wTop: 0.14, yBottom: 0.82, yTop: 1.00 },
    { z: -0.09, wBottom: 0.15, wTop: 0.12, yBottom: 0.84, yTop: 0.99 }
  ], 26, 12);
  solidPaintParts.push(airbox);

  const airIntakeLip = new THREE.TorusGeometry(0.095, 0.016, 10, 24);
  airIntakeLip.scale(1.12, 0.92, 1.0);
  airIntakeLip.translate(0, 0.92, -0.09);
  carbonParts.push(airIntakeLip);

  const airHole = new THREE.CircleGeometry(0.092, 20);
  airHole.scale(1.1, 0.9, 1.0);
  airHole.translate(0, 0.92, -0.092);
  darkParts.push(airHole);

  const tStem = buildAeroStrut(new THREE.Vector3(0, 0.99, -0.24), new THREE.Vector3(0, 1.13, -0.26), 0.07, 0.016);
  carbonParts.push(tStem);
  const tCamWing = buildAirfoilWingGeo({ span: 0.34, chord: 0.068, thickness: 0.22, spanSegs: 12 });
  tCamWing.translate(0, 1.145, -0.26);
  accentParts.push(tCamWing);

  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(1.56, 0.06);
  finShape.quadraticCurveTo(1.58, 0.22, 1.48, 0.34);
  finShape.quadraticCurveTo(0.75, 0.42, 0.14, 0.47);
  finShape.lineTo(0, 0.44);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.018,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 3
  });
  finGeo.rotateY(Math.PI / 2);
  finGeo.translate(-0.009, 0.51, -0.40);
  solidPaintParts.push(finGeo);

  const finL = new THREE.PlaneGeometry(1.36, 0.34);
  finL.rotateY(Math.PI / 2);
  finL.translate(0.017, 0.73, -1.16);
  const finR = new THREE.PlaneGeometry(1.36, 0.34);
  finR.rotateY(-Math.PI / 2);
  finR.translate(-0.017, 0.73, -1.16);
  const sharedFinDecalGeo = markShared(mergeGroup([finL, finR]));
  finL.dispose();
  finR.dispose();

  // 6. Sculpted Cockpit Coaming, Contoured Carbon Headrest, Shoulders & Titanium Halo
  const recess = new THREE.CylinderGeometry(0.24, 0.22, 0.82, 20);
  recess.rotateX(Math.PI / 2);
  recess.scale(1.0, 0.45, 1.0);
  recess.translate(0, 0.58, 0.26);
  darkParts.push(recess);

  const hrCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.21, 0.67, 0.28),
    new THREE.Vector3(-0.22, 0.69, -0.08),
    new THREE.Vector3(0.0, 0.71, -0.15),
    new THREE.Vector3(0.22, 0.69, -0.08),
    new THREE.Vector3(0.21, 0.67, 0.28)
  ]);
  darkParts.push(new THREE.TubeGeometry(hrCurve, 28, 0.038, 10, false));

  const shoulders = new THREE.CapsuleGeometry(0.145, 0.19, 10, 16);
  shoulders.rotateZ(Math.PI / 2);
  shoulders.translate(0, 0.64, 0.08);
  solidPaintParts.push(shoulders);

  const haloCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.29, 0.66, -0.05),
    new THREE.Vector3(-0.32, 0.85, 0.24),
    new THREE.Vector3(-0.18, 0.91, 0.58),
    new THREE.Vector3(0.0, 0.91, 0.72),
    new THREE.Vector3(0.18, 0.91, 0.58),
    new THREE.Vector3(0.32, 0.85, 0.24),
    new THREE.Vector3(0.29, 0.66, -0.05)
  ]);
  const haloHoop = new THREE.TubeGeometry(haloCurve, 40, 0.028, 14, false);
  const haloPillarCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.59, 0.85),
    new THREE.Vector3(0, 0.76, 0.77),
    new THREE.Vector3(0, 0.91, 0.71)
  ]);
  const haloPillar = new THREE.TubeGeometry(haloPillarCurve, 12, 0.022, 12, false);
  const sharedHaloGeo = markShared(mergeGroup([haloHoop, haloPillar]));
  haloHoop.dispose();
  haloPillar.dispose();

  // 7. Deformable 4-Element Cambered 3D Airfoil Front Wing + Swept Curved 3D Endplates!
  const fwCarbonParts: THREE.BufferGeometry[] = [];
  const fwPaintParts: THREE.BufferGeometry[] = [];

  fwCarbonParts.push(buildAirfoilWingGeo({
    span: 1.94,
    chord: 0.26,
    thickness: 0.14,
    angleRad: 0.06,
    spoonDip: 0.024,
    sweepZ: 0.10,
    tipDihedral: 0.02,
    spanSegs: 34
  }));

  const flapSpecs = [
    { y: 0.042, z: -0.08, chord: 0.17, angle: 0.18, paint: true },
    { y: 0.088, z: -0.16, chord: 0.14, angle: 0.30, paint: true },
    { y: 0.136, z: -0.23, chord: 0.11, angle: 0.42, paint: false }
  ];
  for (const fs of flapSpecs) {
    const flap = buildAirfoilWingGeo({
      span: 1.90,
      chord: fs.chord,
      thickness: 0.13,
      angleRad: fs.angle,
      spoonDip: 0.018,
      sweepZ: 0.11,
      tipDihedral: 0.025,
      spanSegs: 30
    });
    flap.translate(0, fs.y, fs.z);
    if (fs.paint) fwPaintParts.push(flap);
    else fwCarbonParts.push(flap);
  }

  for (const side of [-1, 1]) {
    // Smoothly Swept-Up Curved 3D Front Wing Endplate (replaces flat vertical planks!)
    const fwEpCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.95, 0.01, -0.10),
      new THREE.Vector3(side * 0.98, 0.09, -0.12),
      new THREE.Vector3(side * 0.99, 0.22, -0.15),
      new THREE.Vector3(side * 0.96, 0.31, -0.20)
    ]);
    const fwEpTube = new THREE.TubeGeometry(fwEpCurve, 20, 0.085, 10, false);
    fwEpTube.scale(0.16, 1.0, 1.85);
    fwEpTube.translate(side * (0.97 - 0.97 * 0.16), 0, 0);
    fwPaintParts.push(fwEpTube);

    // S-Curved Outer Carbon Diveplane Canard
    const dive = buildAirfoilWingGeo({ span: 0.075, chord: 0.22, thickness: 0.16, angleRad: 0.24, spanSegs: 6 });
    dive.translate(side * 1.01, 0.15, -0.12);
    fwCarbonParts.push(dive);

    // Twin Sculpted Nose-to-Mainplane Carbon Pylons
    const pylon = buildAeroStrut(
      new THREE.Vector3(side * 0.085, 0.01, 0.02),
      new THREE.Vector3(side * 0.075, 0.13, 0.06),
      0.16,
      0.014
    );
    fwCarbonParts.push(pylon);
  }
  const sharedFrontWingCarbonGeo = markShared(mergeGroup(fwCarbonParts));
  const sharedFrontWingPaintGeo = markShared(mergeGroup(fwPaintParts));
  [...fwCarbonParts, ...fwPaintParts].forEach((g) => g.dispose());

  // 8. TRUE 3D CAMBERED SWAN-NECK REAR WING, BI-PLANE BEAM WING, CURVED ENDPLATES & GLOWING RED LED TAILLIGHTS!
  // Twin Curved Swan-Neck Gooseneck Pylons arching OVER the rear mainplane!
  for (const px of [-0.085, 0.085]) {
    const swanCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(px, 0.40, -2.06),
      new THREE.Vector3(px, 0.68, -2.16),
      new THREE.Vector3(px, 0.92, -2.19),
      new THREE.Vector3(px, 0.955, -2.23),
      new THREE.Vector3(px, 0.86, -2.25)
    ]);
    const swanTube = new THREE.TubeGeometry(swanCurve, 28, 0.022, 12, false);
    const sPos = swanTube.attributes.position;
    for (let si = 0; si < sPos.count; si++) {
      // Compress lateral X around px into a thin 10mm carbon aero-blade pylon!
      sPos.setX(si, px + (sPos.getX(si) - px) * 0.28);
    }
    swanTube.computeVertexNormals();
    carbonParts.push(swanTube);
  }

  // Teardrop Carbon Central DRS Actuator Pod
  const drsPod = buildSmoothLoftedHull([
    { z: -2.35, wBottom: 0.018, wTop: 0.015, yBottom: 0.89, yTop: 1.00 },
    { z: -2.24, wBottom: 0.028, wTop: 0.024, yBottom: 0.87, yTop: 1.03 },
    { z: -2.12, wBottom: 0.012, wTop: 0.010, yBottom: 0.91, yTop: 0.98 }
  ], 18, 10);
  carbonParts.push(drsPod);

  // Lower Bi-Plane Carbon Beam Wings (2 cambered 3D airfoil elements!)
  const beamLower = buildAirfoilWingGeo({ span: 1.02, chord: 0.19, thickness: 0.14, angleRad: 0.16, spoonDip: 0.015, spanSegs: 22 });
  beamLower.translate(0, 0.42, -2.24);
  carbonParts.push(beamLower);

  const beamUpper = buildAirfoilWingGeo({ span: 1.06, chord: 0.15, thickness: 0.13, angleRad: 0.30, spoonDip: 0.012, spanSegs: 22 });
  beamUpper.translate(0, 0.485, -2.31);
  carbonParts.push(beamUpper);

  // Upper Spoon-Shaped Exposed Carbon Rear Wing Mainplane (Cambered 3D Airfoil!)
  const rwMain = buildAirfoilWingGeo({
    span: 1.22,
    chord: 0.30,
    thickness: 0.15,
    angleRad: 0.12,
    spoonDip: 0.038,
    sweepZ: 0.05,
    tipDihedral: -0.015,
    spanSegs: 32
  });
  rwMain.translate(0, 0.85, -2.23);
  carbonParts.push(rwMain);

  // Sculpted 3D Mobile Upper DRS Airfoil Flap (replaces flat BoxGeometry!)
  const sharedDrsFlapGeo = markShared(buildAirfoilWingGeo({
    span: 1.18,
    chord: 0.22,
    thickness: 0.13,
    angleRad: 0.44,
    spoonDip: 0.022,
    sweepZ: 0.04,
    spanSegs: 28
  }));

  // Sculpted Swept 3D Curved Rear Wing Endplates + Integrated Glowing Red LED Taillight Strips!
  for (const side of [-1, 1]) {
    // Build smooth 3D curved endplate ribbon tapering inward from upper wingtip (x=±0.615, y=1.01) to beam-wing tip (x=±0.51, y=0.39)
    const epStations = 20;
    const epChordPts = 10;
    const epPos: number[] = [];
    const epIdx: number[] = [];
    for (let i = 0; i <= epStations; i++) {
      const t = i / epStations; // 0 = bottom at beam wing, 1 = top rolled tip
      const y = 0.38 + t * 0.65;
      // Smooth S-curve outward flare from 0.51m at beam wing to 0.618m at mainplane, rolling slightly inward at very top!
      const sFlare = Math.sin(Math.min(1, t * 1.18) * Math.PI * 0.5);
      const topRoll = t > 0.86 ? Math.pow((t - 0.86) / 0.14, 2) * 0.028 : 0;
      const xCenter = side * (0.51 + sFlare * 0.112 - topRoll);
      // Curved leading & trailing edge sweep (cutout at upper-rear like 2024-2026 F1!)
      const zFront = -2.07 - Math.pow(1 - t, 1.6) * 0.08;
      const zBack = -2.41 + (t > 0.76 ? Math.pow((t - 0.76) / 0.24, 1.8) * 0.13 : 0);
      const chordLen = zFront - zBack;
      const zMid = (zFront + zBack) * 0.5;
      const halfThick = 0.011 * (1.0 - Math.abs(t - 0.5) * 0.25);

      for (let k = 0; k < epChordPts; k++) {
        const a = (k / epChordPts) * Math.PI * 2;
        const cz = zMid + Math.cos(a) * (chordLen * 0.5);
        const cx = xCenter + Math.sin(a) * halfThick;
        epPos.push(cx, y, cz);
      }
    }
    for (let i = 0; i < epStations; i++) {
      const r0 = i * epChordPts;
      const r1 = (i + 1) * epChordPts;
      for (let k = 0; k < epChordPts; k++) {
        const kNext = (k + 1) % epChordPts;
        if (side > 0) {
          epIdx.push(r0 + k, r1 + k, r1 + kNext, r0 + k, r1 + kNext, r0 + kNext);
        } else {
          epIdx.push(r0 + k, r1 + kNext, r1 + k, r0 + k, r0 + kNext, r1 + kNext);
        }
      }
    }
    const epGeo = new THREE.BufferGeometry();
    epGeo.setAttribute('position', new THREE.Float32BufferAttribute(epPos, 3));
    epGeo.setIndex(epIdx);
    epGeo.computeVertexNormals();
    solidPaintParts.push(epGeo);

    // Glowing Red LED Rear Endplate Taillight Strip along trailing edge! (Triggers HDR Bloom!)
    const ledCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.545, 0.50, -2.412),
      new THREE.Vector3(side * 0.608, 0.70, -2.415),
      new THREE.Vector3(side * 0.618, 0.88, -2.405)
    ]);
    taillightParts.push(new THREE.TubeGeometry(ledCurve, 14, 0.010, 8, false));
  }

  // Central 15-Diode FIA Red Rain-Light Cluster on Rear Crash Keel
  const rainCluster = new THREE.CapsuleGeometry(0.024, 0.095, 8, 12);
  rainCluster.translate(0, 0.205, -2.355);
  taillightParts.push(rainCluster);

  // 9. Aero-Blade Carbon Double-Wishbone Suspension, Push-Rods, Pull-Rods & Driveshafts
  for (const side of [-1, 1]) {
    const fHub = new THREE.Vector3(side * 0.82, 0.324, 1.72);
    carbonParts.push(buildAeroStrut(new THREE.Vector3(side * 0.20, 0.44, 1.94), fHub.clone().add(new THREE.Vector3(0, 0.085, 0.04)), 0.052, 0.012));
    carbonParts.push(buildAeroStrut(new THREE.Vector3(side * 0.24, 0.43, 1.48), fHub.clone().add(new THREE.Vector3(0, 0.085, -0.04)), 0.052, 0.012));
    carbonParts.push(buildAeroStrut(new THREE.Vector3(side * 0.20, 0.16, 1.90), fHub.clone().add(new THREE.Vector3(0, -0.085, 0.04)), 0.052, 0.012));
    carbonParts.push(buildAeroStrut(new THREE.Vector3(side * 0.24, 0.16, 1.46), fHub.clone().add(new THREE.Vector3(0, -0.085, -0.04)), 0.052, 0.012));
    // Front Push-Rod
    carbonParts.push(buildAeroStrut(new THREE.Vector3(side * 0.22, 0.50, 1.66), fHub.clone().add(new THREE.Vector3(0, -0.06, 0)), 0.028, 0.011));

    // Rear Suspension anchored cleanly to narrow coke-bottle gearbox casing (x=±0.14) -> wheel upright (x=±0.80)
    const rHub = new THREE.Vector3(side * 0.80, 0.344, -1.70);
    carbonParts.push(buildAeroStrut(new THREE.Vector3(side * 0.15, 0.42, -1.48), rHub.clone().add(new THREE.Vector3(0, 0.09, 0.04)), 0.056, 0.013));
    carbonParts.push(buildAeroStrut(new THREE.Vector3(side * 0.11, 0.39, -1.96), rHub.clone().add(new THREE.Vector3(0, 0.09, -0.04)), 0.056, 0.013));
    carbonParts.push(buildAeroStrut(new THREE.Vector3(side * 0.15, 0.15, -1.50), rHub.clone().add(new THREE.Vector3(0, -0.09, 0.04)), 0.056, 0.013));
    carbonParts.push(buildAeroStrut(new THREE.Vector3(side * 0.10, 0.15, -1.94), rHub.clone().add(new THREE.Vector3(0, -0.09, -0.04)), 0.056, 0.013));
    // Carbon Driveshaft + Pull-Rod
    carbonParts.push(buildAeroStrut(new THREE.Vector3(side * 0.12, 0.31, -1.70), rHub.clone(), 0.032, 0.032));
    carbonParts.push(buildAeroStrut(new THREE.Vector3(side * 0.13, 0.17, -1.66), rHub.clone().add(new THREE.Vector3(0, 0.08, 0)), 0.026, 0.011));
  }

  // 10. Sculpted Carbon Butterfly F1 Steering Wheel + Rotary Encoders + Articulated Driver Gloves!
  const swParts: THREE.BufferGeometry[] = [];
  const swPlate = new THREE.BoxGeometry(0.185, 0.098, 0.022);
  swParts.push(swPlate);
  const topBrow = new THREE.CapsuleGeometry(0.014, 0.15, 8, 12);
  topBrow.rotateZ(Math.PI / 2);
  topBrow.translate(0, 0.056, 0.002);
  swParts.push(topBrow);

  // 3 Front Rotary Differential/ERS Dials
  for (const dx of [-0.048, 0, 0.048]) {
    const dial = new THREE.CylinderGeometry(0.011, 0.011, 0.012, 12);
    dial.rotateX(Math.PI / 2);
    dial.translate(dx, -0.032, -0.014);
    swParts.push(dial);
  }

  for (const side of [-1, 1]) {
    const grip = new THREE.CapsuleGeometry(0.018, 0.092, 10, 14);
    grip.translate(side * 0.114, -0.004, -0.004);
    swParts.push(grip);

    const guardTop = new THREE.CapsuleGeometry(0.009, 0.042, 6, 10);
    guardTop.rotateZ(Math.PI / 2);
    guardTop.translate(side * 0.092, 0.050, 0);
    swParts.push(guardTop);

    const guardBot = new THREE.CapsuleGeometry(0.009, 0.042, 6, 10);
    guardBot.rotateZ(Math.PI / 2);
    guardBot.translate(side * 0.092, -0.052, 0);
    swParts.push(guardBot);

    const paddle = new THREE.BoxGeometry(0.034, 0.058, 0.006);
    paddle.translate(side * 0.096, 0.006, 0.022);
    swParts.push(paddle);
  }
  const sharedSteerWheelGeo = markShared(mergeGroup(swParts));
  swParts.forEach((g) => g.dispose());

  const gloveParts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const palm = new THREE.SphereGeometry(0.027, 14, 12);
    palm.scale(0.88, 1.16, 1.12);
    palm.translate(side * 0.116, -0.004, -0.012);
    gloveParts.push(palm);

    // Sculpted wrapped thumb & fingers gripping the steering wheel handles
    for (let f = 0; f < 4; f++) {
      const finger = new THREE.CapsuleGeometry(0.0065, 0.022, 6, 8);
      finger.rotateZ(Math.PI / 2);
      finger.translate(side * 0.114, 0.020 - f * 0.015, 0.010);
      gloveParts.push(finger);
    }

    const forearm = new THREE.CapsuleGeometry(0.030, 0.25, 10, 14);
    forearm.rotateX(Math.PI / 2 - 0.18);
    forearm.rotateY(side * -0.18);
    forearm.translate(side * 0.136, -0.036, -0.15);
    gloveParts.push(forearm);
  }
  const sharedDriverGlovesGeo = markShared(mergeGroup(gloveParts));
  gloveParts.forEach((g) => g.dispose());

  const sharedPaintHullGeo = markShared(mergeGroup(paintParts));
  const sharedSolidPaintGeo = markShared(mergeGroup(solidPaintParts));
  const sharedCarbonGeo = markShared(mergeGroup(carbonParts));
  const sharedTitaniumGeo = markShared(mergeGroup(titaniumParts));
  const sharedMirrorGlassGeo = markShared(mergeGroup(mirrorGlassParts));
  const sharedTaillightGeo = markShared(mergeGroup(taillightParts));
  const sharedDarkGeo = markShared(mergeGroup(darkParts));
  const sharedAccentGeo = markShared(mergeGroup(accentParts));

  [
    ...paintParts,
    ...solidPaintParts,
    ...carbonParts,
    ...titaniumParts,
    ...mirrorGlassParts,
    ...taillightParts,
    ...darkParts,
    ...accentParts
  ].forEach((g) => g.dispose());

  sharedAssets = {
    // Exposed Carbon Fiber with weave micro-texture & realistic higher satin-matte roughness (per Forza spec!)
    carbonMat: markShared(new THREE.MeshStandardMaterial({
      map: carbonTex,
      normalMap: carbonNormalTex,
      normalScale: new THREE.Vector2(1.05, 1.05),
      color: '#1b1f26',
      metalness: 0.28,
      roughness: 0.44,
      envMapIntensity: 1.35
    })),
    titaniumExhaustMat: markShared(new THREE.MeshStandardMaterial({
      color: '#8c7d70',
      metalness: 0.92,
      roughness: 0.22,
      envMapIntensity: 1.85
    })),
    mirrorGlassMat: markShared(new THREE.MeshStandardMaterial({
      color: '#eef6ff',
      metalness: 1.0,
      roughness: 0.02,
      envMapIntensity: 2.2
    })),
    darkMat: markShared(new THREE.MeshStandardMaterial({
      color: '#06080b',
      metalness: 0.18,
      roughness: 0.78
    })),
    wheelVertexColorMat: markShared(new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.34,
      metalness: 0.22,
      envMapIntensity: 1.65
    })),
    tireRubberMat: markShared(new THREE.MeshStandardMaterial({
      color: '#191c22',
      roughness: 0.72,
      metalness: 0.06,
      envMapIntensity: 0.90
    })),
    rimAlloyMat: markShared(new THREE.MeshStandardMaterial({
      color: '#5c6676',
      metalness: 0.88,
      roughness: 0.22,
      envMapIntensity: 1.85
    })),
    visorMat: markShared(new THREE.MeshPhysicalMaterial({
      color: '#060f1e',
      metalness: 0.96,
      roughness: 0.02,
      clearcoat: 1.0,
      envMapIntensity: 2.1
    })),
    contactShadowMat: markShared(new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false
    })),
    contactShadowGeo: markShared(new THREE.PlaneGeometry(2.65, 5.85)),
    frontBlurGeo: markShared(new THREE.RingGeometry(0.052, 0.345 * 0.57, 32)),
    rearBlurGeo: markShared(new THREE.RingGeometry(0.052, 0.365 * 0.57, 32)),
    plasmaPlumeGeo: buildExhaustPlasmaGeo(),
    wheelGeos: {
      FL: buildWheelGeometries(0.345, 0.35, 1),
      FR: buildWheelGeometries(0.345, 0.35, -1),
      RL: buildWheelGeometries(0.365, 0.46, 1),
      RR: buildWheelGeometries(0.365, 0.46, -1)
    },
    sharedCarbonGeo,
    sharedTitaniumGeo,
    sharedMirrorGlassGeo,
    sharedTaillightGeo,
    sharedHaloGeo,
    sharedFinDecalGeo,
    sharedDarkGeo,
    sharedPaintHullGeo,
    sharedSolidPaintGeo,
    sharedAccentGeo,
    sharedFrontWingCarbonGeo,
    sharedFrontWingPaintGeo,
    sharedDrsFlapGeo,
    sharedSteerWheelGeo,
    sharedDriverGlovesGeo
  };

  return sharedAssets;
}

let cachedWheelBlurTex: THREE.CanvasTexture | null = null;
function getWheelSpinBlurTexture(): THREE.CanvasTexture {
  if (cachedWheelBlurTex) return cachedWheelBlurTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  const cx = 128, cy = 128;
  // Concentric high-speed motion-blurred forged spoke streaks
  for (let r = 24; r < 122; r += 2) {
    const f = (r - 24) / 98;
    const lum = Math.round(38 + Math.sin(f * Math.PI) * 52 + Math.cos(f * 26) * 10);
    ctx.strokeStyle = `rgba(${lum}, ${lum + 6}, ${lum + 14}, ${0.55 + 0.30 * Math.sin(f * Math.PI)})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const spec = ctx.createLinearGradient(0, 0, 256, 256);
  spec.addColorStop(0.0, 'rgba(210, 230, 255, 0.22)');
  spec.addColorStop(0.5, 'rgba(20, 26, 36, 0.04)');
  spec.addColorStop(1.0, 'rgba(180, 205, 240, 0.18)');
  ctx.fillStyle = spec;
  ctx.beginPath();
  ctx.arc(cx, cy, 122, 0, Math.PI * 2);
  ctx.fill();

  const tex = markShared(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedWheelBlurTex = tex;
  return tex;
}

export interface BuildCarOptions {
  overrideNumber?: number | null;
  tireBandColor?: string;
  isPlayer?: boolean;
  isGhost?: boolean;
  forceHeroLod?: boolean;
  customPaintColor?: string;
  customPaintFinish?: PaintFinishType;
  customLiveryStyle?: LiveryStyleType;
  customRimColor?: string;
}

export function buildF1Car(
  baseTeam: TeamConfig,
  options: BuildCarOptions = {}
): F1CarVisual {
  const {
    overrideNumber = null,
    tireBandColor,
    isPlayer = false,
    isGhost = false,
    forceHeroLod = false,
    customPaintColor = '',
    customPaintFinish = 'default',
    customLiveryStyle = 'stock',
    customRimColor = ''
  } = options;

  // Apply custom paint color & finish overrides without mutating global config
  const team: TeamConfig = {
    ...baseTeam,
    primaryColor: customPaintColor && customPaintColor.startsWith('#') ? customPaintColor : baseTeam.primaryColor,
    metalness: customPaintFinish === 'chrome' ? 0.98
      : customPaintFinish === 'metallic' ? 0.78
      : customPaintFinish === 'matte' ? 0.22
      : customPaintFinish === 'pearl' ? 0.52
      : baseTeam.metalness,
    roughness: customPaintFinish === 'chrome' ? 0.04
      : customPaintFinish === 'metallic' ? 0.14
      : customPaintFinish === 'matte' ? 0.62
      : customPaintFinish === 'pearl' ? 0.08
      : baseTeam.roughness,
    clearcoat: customPaintFinish === 'matte' ? 0.04 : 1.0
  };

  const isRoadSupercar = Boolean(team.vehicleCategory && team.vehicleCategory !== 'f1');

  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const shared = getSharedCarAssets();
  const { bodyTex, finTex, wingTex, tireSideTex } = getTeamTextures(team, overrideNumber, tireBandColor);

  const ghostMat = isGhost
    ? new THREE.MeshBasicMaterial({
        color: '#00f0ff',
        transparent: true,
        opacity: 0.28,
        depthWrite: false
      })
    : null;

  const paintMat = ghostMat || new THREE.MeshPhysicalMaterial({
    map: bodyTex,
    metalness: team.metalness,
    roughness: Math.max(0.04, team.roughness * (customPaintFinish === 'matte' ? 1.0 : 0.62)),
    clearcoat: team.clearcoat,
    clearcoatRoughness: customPaintFinish === 'matte' ? 0.45 : 0.02,
    iridescence: customPaintFinish === 'pearl' ? 0.35 : 0.08,
    iridescenceIOR: 1.38,
    reflectivity: 1.0,
    envMapIntensity: 2.05
  });

  const solidPaintMat = ghostMat || new THREE.MeshPhysicalMaterial({
    color: team.primaryColor,
    metalness: team.metalness,
    roughness: Math.max(0.04, team.roughness * (customPaintFinish === 'matte' ? 1.0 : 0.62)),
    clearcoat: team.clearcoat,
    clearcoatRoughness: customPaintFinish === 'matte' ? 0.45 : 0.02,
    iridescence: customPaintFinish === 'pearl' ? 0.35 : 0.08,
    iridescenceIOR: 1.38,
    reflectivity: 1.0,
    envMapIntensity: 2.05
  });

  const accentMat = ghostMat || new THREE.MeshPhysicalMaterial({
    color: team.secondaryColor,
    metalness: 0.48,
    roughness: 0.13,
    clearcoat: 0.98,
    envMapIntensity: 1.85
  });

  const rearWingMat = ghostMat || new THREE.MeshPhysicalMaterial({
    map: wingTex,
    metalness: 0.34,
    roughness: 0.15,
    clearcoat: 0.96,
    envMapIntensity: 1.85
  });

  const finMat = ghostMat || new THREE.MeshPhysicalMaterial({
    map: finTex,
    metalness: Math.max(0.38, team.metalness),
    roughness: Math.max(0.055, team.roughness * 0.68),
    clearcoat: 0.98,
    envMapIntensity: 1.95
  });

  const helmetMat = ghostMat || new THREE.MeshPhysicalMaterial({
    color: team.helmetColor,
    metalness: 0.46,
    roughness: 0.09,
    clearcoat: 1.0,
    envMapIntensity: 1.95
  });

  const rainLightMat = new THREE.MeshStandardMaterial({
    color: '#ff1200',
    emissive: '#ff1a08',
    emissiveIntensity: isGhost ? 0 : 3.5,
    roughness: 0.2,
    toneMapped: false
  });

  const useGlb = Boolean(fh6Assets.f1Lod0 && fh6Assets.f1Lod1);
  const heroHeroic = isPlayer || forceHeroLod;

  const matLookup: Record<string, THREE.Material> = {
    Paint_Body: paintMat,
    Paint_Solid: solidPaintMat,
    Paint_Accent: accentMat,
    Fin_Decal: finMat,
    Carbon_Weave: ghostMat || shared.carbonMat,
    Titanium_Exhaust: ghostMat || shared.titaniumExhaustMat,
    Mirror_Glass: ghostMat || shared.mirrorGlassMat,
    Dark_Cavity: ghostMat || shared.darkMat,
    Taillight_LED: ghostMat || rainLightMat,
    Helmet_Shell: helmetMat,
    Visor_Iridium: ghostMat || shared.visorMat,
  };

  const buildBodyFromGlb = (tpl: PremergedF1LodTemplate): THREE.Group => {
    const grp = new THREE.Group();
    for (const [slot, geo] of Object.entries(tpl.byMat)) {
      if (isGhost && (slot === 'Mirror_Glass' || slot === 'Visor_Iridium')) continue;
      const m = new THREE.Mesh(geo, matLookup[slot] || (ghostMat || shared.carbonMat));
      const casts = !isGhost && (slot === 'Paint_Body' || slot === 'Paint_Solid' || slot === 'Carbon_Weave');
      m.castShadow = casts;
      m.receiveShadow = !isGhost;
      grp.add(m);
    }
    return grp;
  };

  let haloMesh: THREE.Mesh;
  const frontWingGroup = new THREE.Group();
  frontWingGroup.position.set(0, 0.068, 2.52);
  const steerWheelGroup = new THREE.Group();
  steerWheelGroup.position.set(0, 0.67, 0.54);
  steerWheelGroup.rotation.x = -0.28;
  const drsFlapGroup = new THREE.Group();
  drsFlapGroup.position.set(0, 0.955, -2.35);

  if (isRoadSupercar) {
    // =========================================================================
    // CLOSED-COCKPIT 3D SUPERCAR / HYPERCAR / GT / MUSCLE CAR BUILDER
    // =========================================================================
    haloMesh = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), ghostMat || shared.carbonMat);
    haloMesh.visible = false;
    bodyGroup.add(haloMesh);

    const cabinGlassMat = ghostMat || new THREE.MeshPhysicalMaterial({
      color: '#0b1320',
      metalness: 0.15,
      roughness: 0.05,
      transmission: 0.45,
      transparent: true,
      opacity: 0.42,
      envMapIntensity: 2.2
    });
    const headlightMat = ghostMat || new THREE.MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#dff4ff',
      emissiveIntensity: 3.2,
      toneMapped: false
    });

    if (fh6Assets.safetyCarPremerged) {
      const scGroup = new THREE.Group();
      // Proportion morphing per body style (Hypercar low & wide, Muscle tall & long, Mid-wedge sleek)
      if (team.bodyStyle === 'hyper_fin') {
        scGroup.scale.set(1.04, 0.92, 1.04);
      } else if (team.bodyStyle === 'mid_wedge') {
        scGroup.scale.set(1.02, 0.95, 1.01);
      } else if (team.bodyStyle === 'muscle_fastback') {
        scGroup.scale.set(1.00, 1.04, 1.03);
      }
      const scMatMap: Record<string, THREE.Material> = {
        SC_Body_Paint: solidPaintMat,
        SC_Cabin_Glass: cabinGlassMat,
        SC_Carbon: ghostMat || shared.carbonMat,
        SC_Chrome: ghostMat || shared.titaniumExhaustMat,
        SC_Headlight: headlightMat,
        SC_Taillight: rainLightMat,
      };
      for (const [mName, geo] of Object.entries(fh6Assets.safetyCarPremerged.byMat)) {
        if (mName === 'SC_Tire' || mName === 'SC_Plate') continue;
        const mesh = new THREE.Mesh(geo, scMatMap[mName] || (ghostMat || shared.carbonMat));
        mesh.castShadow = !isGhost && (mName === 'SC_Body_Paint' || mName === 'SC_Cabin_Glass' || mName === 'SC_Carbon');
        mesh.receiveShadow = !isGhost;
        scGroup.add(mesh);
      }
      bodyGroup.add(scGroup);
    } else {
      // Fallback procedural closed-cockpit supercar hull if before async .glb preload
      const hullMesh = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.62, 4.45), solidPaintMat);
      hullMesh.position.set(0, 0.44, 0);
      hullMesh.castShadow = !isGhost;
      bodyGroup.add(hullMesh);
      const cabinMesh = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.44, 2.05), cabinGlassMat);
      cabinMesh.position.set(0, 0.92, -0.15);
      bodyGroup.add(cabinMesh);
    }

    // Vehicle-Specific 3D Aero & Body Styling Kit
    if (team.bodyStyle === 'hyper_fin') {
      // Dorsal LMP1 Shark Fin + Roof Intake Scoop (Bugatti Chiron, Koenigsegg Jesko, Huracán STO)
      const dorsalFin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 1.48), ghostMat || shared.carbonMat);
      dorsalFin.position.set(0, 1.08, -1.25);
      bodyGroup.add(dorsalFin);
      const roofScoop = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.62), accentMat);
      roofScoop.position.set(0, 1.24, -0.25);
      bodyGroup.add(roofScoop);
    } else if (team.bodyStyle === 'muscle_fastback') {
      // Supercharger Power-Dome Hood Bulge (Mustang Shelby GT500)
      const powerDome = new THREE.Mesh(
        new THREE.BoxGeometry(0.86, 0.12, 1.28),
        customLiveryStyle === 'carbon_hood' ? (ghostMat || shared.carbonMat) : solidPaintMat
      );
      powerDome.position.set(0, 0.78, 1.24);
      bodyGroup.add(powerDome);
    } else if (team.bodyStyle === 'mid_wedge') {
      // Mid-Engine Sideblades (Audi R8 V10, Ferrari 488 Pista, McLaren 720S, Corvette C8 Z06)
      for (const sx of [-0.97, 0.97]) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.48, 0.78), ghostMat || shared.carbonMat);
        blade.position.set(sx, 0.56, -0.45);
        bodyGroup.add(blade);
      }
    }

    // Custom Livery Options (Twin Racing Stripes, Carbon Hood, or Apex Pro Accents)
    if (customLiveryStyle === 'stripes' || team.id === 'mustang_gt500' || team.id === 'ferrari_488') {
      for (const sx of [-0.17, 0.17]) {
        const stripeHood = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.015, 1.45), accentMat);
        stripeHood.position.set(sx, 0.79, 1.30);
        stripeHood.rotation.x = 0.09;
        bodyGroup.add(stripeHood);
      }
    } else if (customLiveryStyle === 'carbon_hood') {
      const carbonHood = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.02, 1.38), ghostMat || shared.carbonMat);
      carbonHood.position.set(0, 0.78, 1.30);
      carbonHood.rotation.x = 0.08;
      bodyGroup.add(carbonHood);
    }

    // Active Rear DRS / Airbrake Wing on drsFlapGroup
    drsFlapGroup.position.set(0, 1.12, -2.10);
    const gtWingMesh = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.04, 0.32), ghostMat || shared.carbonMat);
    drsFlapGroup.add(gtWingMesh);
    bodyGroup.add(drsFlapGroup);

    // Front Splitter on frontWingGroup (for damage droop visualization)
    frontWingGroup.position.set(0, 0.14, 2.12);
    const frontLip = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.045, 0.36), accentMat);
    frontWingGroup.add(frontLip);
    bodyGroup.add(frontWingGroup);

    // Cockpit Interior Dashboard, A-Pillars, Panoramic Rearview Mirror & Round GT Steering Wheel
    steerWheelGroup.position.set(0, 0.72, 0.38);
    const gtRim = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.022, 12, 28), ghostMat || shared.carbonMat);
    steerWheelGroup.add(gtRim);
    const gtSpoke = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 0.02), accentMat);
    steerWheelGroup.add(gtSpoke);

    if (!isGhost) {
      const mirrorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.085, 0.03), shared.carbonMat);
      mirrorFrame.position.set(0, 1.06, 0.36);
      bodyGroup.add(mirrorFrame);
      const mirrorGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.068), shared.mirrorGlassMat);
      mirrorGlass.position.set(0, 1.06, 0.342);
      mirrorGlass.rotation.y = Math.PI;
      bodyGroup.add(mirrorGlass);
    }
  } else if (useGlb) {
    const lod0 = fh6Assets.f1Lod0!;
    const lod1 = fh6Assets.f1Lod1!;
    if (heroHeroic || isGhost) {
      bodyGroup.add(buildBodyFromGlb(heroHeroic ? lod0 : lod1));
    } else {
      const bodyLod = new THREE.LOD();
      bodyLod.addLevel(buildBodyFromGlb(lod0), 0);
      bodyLod.addLevel(buildBodyFromGlb(lod1), 22);
      bodyGroup.add(bodyLod);
    }

    const activeTpl = heroHeroic ? lod0 : lod1;
    haloMesh = new THREE.Mesh(activeTpl.haloGeo || shared.sharedHaloGeo, ghostMat || shared.carbonMat);
    haloMesh.castShadow = !isGhost;
    bodyGroup.add(haloMesh);

    for (const [slot, geo] of Object.entries(activeTpl.frontWingByMat)) {
      const fwm = new THREE.Mesh(geo, matLookup[slot] || (ghostMat || shared.carbonMat));
      fwm.castShadow = !isGhost;
      frontWingGroup.add(fwm);
    }
    bodyGroup.add(frontWingGroup);

    for (const [slot, geo] of Object.entries(activeTpl.steerWheelByMat)) {
      steerWheelGroup.add(new THREE.Mesh(geo, matLookup[slot] || (ghostMat || shared.carbonMat)));
    }

    const drsFlapMesh = new THREE.Mesh(activeTpl.drsFlapGeo || shared.sharedDrsFlapGeo, solidPaintMat);
    const drsDecal = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.18), rearWingMat);
    drsDecal.position.set(0, 0.037, 0.03);
    drsDecal.rotation.x = -Math.PI / 2 + 0.44;
    drsDecal.rotation.z = Math.PI;
    drsFlapMesh.add(drsDecal);
    drsFlapGroup.add(drsFlapMesh);
    bodyGroup.add(drsFlapGroup);
  } else {
    // Graceful synchronous fallback before async .glb preload completes
    const paintMesh = new THREE.Mesh(shared.sharedPaintHullGeo, paintMat);
    paintMesh.castShadow = !isGhost;
    paintMesh.receiveShadow = !isGhost;
    bodyGroup.add(paintMesh);

    const solidMesh = new THREE.Mesh(shared.sharedSolidPaintGeo, solidPaintMat);
    solidMesh.castShadow = !isGhost;
    solidMesh.receiveShadow = !isGhost;
    bodyGroup.add(solidMesh);

    const carbonMesh = new THREE.Mesh(shared.sharedCarbonGeo, ghostMat || shared.carbonMat);
    carbonMesh.castShadow = !isGhost;
    carbonMesh.receiveShadow = !isGhost;
    bodyGroup.add(carbonMesh);

    bodyGroup.add(new THREE.Mesh(shared.sharedTitaniumGeo, ghostMat || shared.titaniumExhaustMat));
    if (!isGhost) bodyGroup.add(new THREE.Mesh(shared.sharedMirrorGlassGeo, shared.mirrorGlassMat));

    haloMesh = new THREE.Mesh(shared.sharedHaloGeo, ghostMat || shared.carbonMat);
    haloMesh.castShadow = !isGhost;
    bodyGroup.add(haloMesh);

    frontWingGroup.add(
      new THREE.Mesh(shared.sharedFrontWingCarbonGeo, ghostMat || shared.carbonMat),
      new THREE.Mesh(shared.sharedFrontWingPaintGeo, solidPaintMat)
    );
    bodyGroup.add(frontWingGroup);

    bodyGroup.add(new THREE.Mesh(shared.sharedDarkGeo, ghostMat || shared.darkMat));
    bodyGroup.add(new THREE.Mesh(shared.sharedAccentGeo, accentMat));
    bodyGroup.add(new THREE.Mesh(shared.sharedFinDecalGeo, finMat));

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.155, 28, 20), helmetMat);
    helmet.scale.set(0.94, 1.0, 1.18);
    helmet.position.set(0, 0.81, 0.10);
    bodyGroup.add(helmet);
    if (!isGhost) {
      const visor = new THREE.Mesh(
        new THREE.SphereGeometry(0.159, 24, 14, -Math.PI * 0.36, Math.PI * 0.72, Math.PI * 0.32, Math.PI * 0.28),
        shared.visorMat
      );
      visor.scale.set(0.94, 1.0, 1.19);
      visor.position.copy(helmet.position);
      visor.rotation.y = Math.PI / 2;
      bodyGroup.add(visor);
    }

    steerWheelGroup.add(new THREE.Mesh(shared.sharedSteerWheelGeo, ghostMat || shared.carbonMat));
    if (!isGhost) steerWheelGroup.add(new THREE.Mesh(shared.sharedDriverGlovesGeo, accentMat));

    const drsFlapMesh = new THREE.Mesh(shared.sharedDrsFlapGeo, solidPaintMat);
    drsFlapMesh.position.set(0, 0.015, 0.03);
    const drsDecal = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.18), rearWingMat);
    drsDecal.position.set(0, 0.022, 0.0);
    drsDecal.rotation.x = -Math.PI / 2 + 0.44;
    drsDecal.rotation.z = Math.PI;
    drsFlapMesh.add(drsDecal);
    drsFlapGroup.add(drsFlapMesh);
    bodyGroup.add(drsFlapGroup);

    bodyGroup.add(new THREE.Mesh(shared.sharedTaillightGeo, rainLightMat));
  }

  let oledCanvas: HTMLCanvasElement | null = null;
  let oledCtx: CanvasRenderingContext2D | null = null;
  let oledTex: THREE.CanvasTexture | null = null;
  if (isPlayer && !isGhost) {
    oledCanvas = document.createElement('canvas');
    oledCanvas.width = 256;
    oledCanvas.height = 128;
    oledCtx = oledCanvas.getContext('2d');
    oledTex = new THREE.CanvasTexture(oledCanvas);
    oledTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.072),
      new THREE.MeshBasicMaterial({ map: oledTex })
    );
    screen.position.set(0, 0.006, -0.014);
    screen.rotation.y = Math.PI;
    steerWheelGroup.add(screen);
  }
  bodyGroup.add(steerWheelGroup);

  // Police Red/Blue Strobe Lightbar for Cops & Robbers Mode (hidden unless state.copsRole === 'COP')
  let policeLightbarGroup: THREE.Group | undefined;
  let policeRedMat: THREE.MeshStandardMaterial | undefined;
  let policeBlueMat: THREE.MeshStandardMaterial | undefined;
  let infectionAuraMesh: THREE.Mesh | undefined;

  if (!isGhost) {
    policeLightbarGroup = new THREE.Group();
    policeLightbarGroup.position.set(0, isRoadSupercar ? 1.27 : 1.13, isRoadSupercar ? -0.16 : -0.26);
    policeLightbarGroup.visible = false;

    policeRedMat = new THREE.MeshStandardMaterial({
      color: '#ff1122',
      emissive: '#ff0818',
      emissiveIntensity: 3.5,
      toneMapped: false
    });
    policeBlueMat = new THREE.MeshStandardMaterial({
      color: '#0066ff',
      emissive: '#0088ff',
      emissiveIntensity: 0.4,
      toneMapped: false
    });
    const podGeo = new THREE.BoxGeometry(0.46, 0.075, 0.16);
    const redPod = new THREE.Mesh(podGeo, policeRedMat);
    redPod.position.x = -0.26;
    const bluePod = new THREE.Mesh(podGeo, policeBlueMat);
    bluePod.position.x = 0.26;
    policeLightbarGroup.add(redPod, bluePod);
    bodyGroup.add(policeLightbarGroup);

    // Toxic Neon-Green Underglow Aura for Infection / Virus Mode (hidden unless state.infected === true)
    const auraGeo = new THREE.RingGeometry(1.15, 2.35, 36);
    const auraMat = new THREE.MeshBasicMaterial({
      color: '#39ff14',
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    infectionAuraMesh = new THREE.Mesh(auraGeo, auraMat);
    infectionAuraMesh.rotation.x = -Math.PI / 2;
    infectionAuraMesh.position.set(0, 0.035, 0);
    infectionAuraMesh.visible = false;
    root.add(infectionAuraMesh);
  }

  // Soft Volumetric Additive Pink-Purple Plasma Backfire Plume
  const exhaustFlameMat = new THREE.MeshBasicMaterial({
    map: getExhaustPlasmaTexture(),
    color: '#ffffff',
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const exhaustCone = new THREE.Mesh(shared.plasmaPlumeGeo, exhaustFlameMat);
  exhaustCone.position.set(0, 0.382, -2.38);
  exhaustCone.visible = false;
  bodyGroup.add(exhaustCone);

  const sidewallMat = new THREE.MeshStandardMaterial({
    map: tireSideTex,
    roughness: 0.46,
    metalness: 0.12
  });
  const brakeDiscMat = new THREE.MeshStandardMaterial({
    color: '#525864',
    emissive: '#ff3b00',
    emissiveIntensity: 0.0,
    metalness: 0.84,
    roughness: 0.34,
    toneMapped: false
  });
  const wheelBlurMat = new THREE.MeshBasicMaterial({
    map: getWheelSpinBlurTexture(),
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const customRimMat = (!isGhost && (customRimColor || team.rimAccent))
    ? new THREE.MeshStandardMaterial({
        color: customRimColor || team.rimAccent || team.rimColor || '#9aa3b2',
        metalness: 0.88,
        roughness: 0.22
      })
    : null;

  const frontWheelPivots: THREE.Group[] = [];
  const spinWheels: Array<{ mesh: THREE.Group; radius: number; side: number }> = [];

  const wheelDefs = isRoadSupercar
    ? [
        { key: 'FL' as const, x: 0.90, y: 0.34, z: 1.38, r: 0.345, w: 0.31, front: true, side: 1 },
        { key: 'FR' as const, x: -0.90, y: 0.34, z: 1.38, r: 0.345, w: 0.31, front: true, side: -1 },
        { key: 'RL' as const, x: 0.92, y: 0.35, z: -1.38, r: 0.360, w: 0.36, front: false, side: 1 },
        { key: 'RR' as const, x: -0.92, y: 0.35, z: -1.38, r: 0.360, w: 0.36, front: false, side: -1 }
      ]
    : [
        { key: 'FL' as const, x: 0.94, y: 0.324, z: 1.72, r: 0.345, w: 0.35, front: true, side: 1 },
        { key: 'FR' as const, x: -0.94, y: 0.324, z: 1.72, r: 0.345, w: 0.35, front: true, side: -1 },
        { key: 'RL' as const, x: 0.96, y: 0.344, z: -1.70, r: 0.365, w: 0.46, front: false, side: 1 },
        { key: 'RR' as const, x: -0.96, y: 0.344, z: -1.70, r: 0.365, w: 0.46, front: false, side: -1 }
      ];

  const glbWheelSet = useGlb ? (heroHeroic ? fh6Assets.f1Lod0!.wheels : fh6Assets.f1Lod1!.wheels) : null;

  for (const wd of wheelDefs) {
    const pivot = new THREE.Group();
    pivot.position.set(wd.x, wd.y, wd.z);
    const spinGroup = new THREE.Group();
    pivot.add(spinGroup);

    const gw = glbWheelSet?.[wd.key];
    const fb = shared.wheelGeos[wd.key];

    if (gw?.tireGeo && gw?.rimGeo) {
      const tireMesh = new THREE.Mesh(gw.tireGeo, ghostMat || shared.tireRubberMat);
      tireMesh.castShadow = !isGhost;
      tireMesh.receiveShadow = !isGhost;
      spinGroup.add(tireMesh);

      const rimMesh = new THREE.Mesh(gw.rimGeo, ghostMat || customRimMat || shared.rimAlloyMat);
      rimMesh.castShadow = !isGhost;
      spinGroup.add(rimMesh);
    } else {
      const tireRimMesh = new THREE.Mesh(fb.tireRimGeo, ghostMat || shared.wheelVertexColorMat);
      tireRimMesh.castShadow = !isGhost;
      spinGroup.add(tireRimMesh);
    }

    if (!isGhost) {
      spinGroup.add(new THREE.Mesh(gw?.sideGeo || fb.sideGeo, sidewallMat));
      pivot.add(new THREE.Mesh(gw?.discGeo || fb.discGeo, brakeDiscMat));

      const blurDisc = new THREE.Mesh(wd.front ? shared.frontBlurGeo : shared.rearBlurGeo, wheelBlurMat);
      blurDisc.rotation.y = wd.side > 0 ? Math.PI / 2 : -Math.PI / 2;
      blurDisc.position.x = wd.side * (wd.w * 0.468);
      spinGroup.add(blurDisc);
    }

    root.add(pivot);
    spinWheels.push({ mesh: spinGroup, radius: wd.r, side: wd.side });
    if (wd.front) frontWheelPivots.push(pivot);
  }

  if (!isGhost) {
    const contactShadow = new THREE.Mesh(shared.contactShadowGeo, shared.contactShadowMat);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(0, 0.011, 0.01);
    contactShadow.renderOrder = 2;
    root.add(contactShadow);
  }

  return {
    root,
    bodyGroup,
    haloMesh,
    frontWingGroup,
    frontWheelPivots,
    spinWheels,
    drsFlapGroup,
    steerWheelGroup,
    oledCanvas,
    oledCtx,
    oledTex,
    brakeDiscMat,
    rainLightMat,
    exhaustFlameMat,
    exhaustCone,
    sidewallMat,
    wheelBlurMat,
    policeLightbarGroup,
    policeRedMat,
    policeBlueMat,
    infectionAuraMesh,
    lastOledUpdate: 0
  };
}

export function updateCarVisuals(carVis: F1CarVisual, state: CarState, dt: number, nowMs: number): void {
  // 1. Wheel spin + Visual Tire Sidewall Flex + High-Speed Rotational Motion Blur!
  const absSpeed = Math.abs(state.speed);
  const dist = state.speed * dt;
  const latLoadFlex = THREE.MathUtils.clamp(state.gLat * 0.015, -0.055, 0.055);
  for (const w of carVis.spinWheels) {
    w.mesh.rotation.x += dist / w.radius;
    const loadSign = w.side * state.gLat > 0 ? 1 : -0.4;
    const squash = THREE.MathUtils.clamp(Math.abs(state.gLat) * 0.012 * loadSign, -0.02, 0.04);
    w.mesh.scale.set(1 + squash * 0.8, 1 - squash, 1);
    w.mesh.rotation.z = latLoadFlex * 0.35;
  }
  carVis.wheelBlurMat.opacity = THREE.MathUtils.clamp((absSpeed - 21) / 30, 0, 0.68);

  // 2. Front steering + Butterfly Steering Wheel & 3D Driver Hands rotation
  const targetSteer = state.steerInput * 0.42;
  for (const p of carVis.frontWheelPivots) {
    p.rotation.y += (targetSteer - p.rotation.y) * Math.min(1, dt * 16);
  }
  carVis.steerWheelGroup.rotation.z = -state.steerInput * 0.65;

  // 3. Mobile DRS Flap + Aeroelastic Wing Flex
  const aeroFlex = !state.drsActive && state.speed > 65 ? -((state.speed - 65) / 40) * 0.08 : 0;
  const targetDrsRot = state.drsActive ? -0.44 : aeroFlex;
  carVis.drsFlapGroup.rotation.x += (targetDrsRot - carVis.drsFlapGroup.rotation.x) * Math.min(1, dt * 14);

  // 4. Visual 3D Front Wing Damage Droop & Vibration
  const baseFwY = carVis.frontWingGroup.position.z < 2.3 ? 0.14 : 0.068;
  if (state.wingDamage > 0.12) {
    const jitter = Math.sin(nowMs * 0.05) * state.wingDamage * 0.025 * Math.min(1, Math.abs(state.speed) / 40);
    carVis.frontWingGroup.rotation.z = state.wingDamage * 0.18 + jitter;
    carVis.frontWingGroup.rotation.x = state.wingDamage * 0.12;
    carVis.frontWingGroup.position.y = baseFwY - state.wingDamage * 0.032;
  } else {
    carVis.frontWingGroup.rotation.set(0, 0, 0);
    carVis.frontWingGroup.position.y = baseFwY;
  }

  // 5. Sprung chassis suspension squat, dive, roll & ground-effect porpoising
  const downforceSquat = -Math.min(0.022, state.speed * state.speed * 0.0000032);
  const porpoiseY = state.speed > 76 && !state.drsActive ? Math.sin(state.porpoisingPhase) * 0.006 : 0;
  const clampedLong = THREE.MathUtils.clamp(state.longAccel, -55, 35);
  const clampedLat = THREE.MathUtils.clamp(state.latAccel, -50, 50);
  const targetPitch = THREE.MathUtils.clamp(-clampedLong * 0.00075, -0.028, 0.030);
  const targetRoll = THREE.MathUtils.clamp(-clampedLat * 0.00095, -0.036, 0.036);
  carVis.bodyGroup.rotation.x += (targetPitch - carVis.bodyGroup.rotation.x) * Math.min(1, dt * 12);
  carVis.bodyGroup.rotation.z += (targetRoll - carVis.bodyGroup.rotation.z) * Math.min(1, dt * 12);

  const rumble = (state.onCurb || state.offTrack) && Math.abs(state.speed) > 10
    ? Math.sin(nowMs * 0.065) * 0.009
    : 0;
  carVis.bodyGroup.position.y = downforceSquat + rumble + porpoiseY;

  // 6. HDR Carbon-Ceramic Brake Glow + Volumetric Pink-Purple Exhaust Backfire Plume + Red LED Taillight Boost!
  const brakeHeat = THREE.MathUtils.clamp((state.brakeTemp - 420) / 480, 0, 1) * 3.4;
  carVis.brakeDiscMat.emissiveIntensity += (brakeHeat - carVis.brakeDiscMat.emissiveIntensity) * Math.min(1, dt * 8);

  const maxRpm = state.team.physics.maxRpm ?? 15000;
  const highRpmBurst = state.rpm > maxRpm * 0.78 ? 0.62 + Math.sin(nowMs * 0.09) * 0.25 : 0;
  if (state.shiftFlameTimer > 0 || highRpmBurst > 0) {
    const shiftIntensity = state.shiftFlameTimer > 0 ? 0.96 * (state.shiftFlameTimer / 0.11) : highRpmBurst;
    carVis.exhaustFlameMat.opacity = shiftIntensity;
    carVis.exhaustCone.visible = true;
    carVis.exhaustCone.rotation.z = nowMs * 0.02;
    carVis.exhaustCone.scale.set(0.92 + Math.random() * 0.24, 0.92 + Math.random() * 0.24, 0.80 + Math.random() * 0.50);
  } else {
    carVis.exhaustFlameMat.opacity = 0;
    carVis.exhaustCone.visible = false;
  }

  // Police Lightbar Red/Blue Alternating Strobe (Cops & Robbers Mode) & Toxic Neon Underglow (Infection Mode)
  if (carVis.policeLightbarGroup) {
    const isCop = state.copsRole === 'COP';
    carVis.policeLightbarGroup.visible = isCop;
    if (isCop && carVis.policeRedMat && carVis.policeBlueMat) {
      const phase = Math.floor(nowMs / 105) % 2 === 0;
      carVis.policeRedMat.emissiveIntensity = phase ? 4.8 : 0.3;
      carVis.policeBlueMat.emissiveIntensity = phase ? 0.3 : 4.8;
    }
  }
  if (carVis.infectionAuraMesh) {
    const isInfected = Boolean(state.infected);
    carVis.infectionAuraMesh.visible = isInfected;
    if (isInfected) {
      const s = 1.0 + Math.sin(nowMs * 0.008) * 0.12;
      carVis.infectionAuraMesh.scale.set(s, s, 1);
    }
  }

  // Glowing Red Taillights brighten under braking & pulse when harvesting ERS!
  const brakeLightBoost = state.brakeInput > 0.08 ? 4.4 : 2.5;
  const blink = (state.ersHarvesting || state.inPit) ? (Math.floor(nowMs / 110) % 2 === 0 ? 4.2 : 1.4) : brakeLightBoost;
  carVis.rainLightMat.emissiveIntensity = blink;

  // 7. Live Cockpit OLED Steering Wheel Screen (~15 Hz for player)
  if (carVis.oledCtx && carVis.oledTex && nowMs - carVis.lastOledUpdate > 66) {
    carVis.lastOledUpdate = nowMs;
    const ctx = carVis.oledCtx;
    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, 256, 128);

    const rpmFrac = THREE.MathUtils.clamp((state.rpm - 5500) / 9300, 0, 1);
    const lit = Math.round(rpmFrac * 15);
    for (let i = 0; i < 15; i++) {
      ctx.fillStyle = i < lit ? (i < 5 ? '#00ff66' : i < 10 ? '#ff2222' : '#00ccff') : '#1c2230';
      ctx.fillRect(8 + i * 16, 6, 12, 11);
    }

    ctx.font = '900 54px Consolas, monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const gStr = state.gear === -1 ? 'R' : state.gear === 0 ? 'N' : String(state.gear);
    ctx.fillText(gStr, 128, 56);

    ctx.font = '700 20px Consolas, monospace';
    ctx.fillStyle = '#00e5ff';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(Math.abs(state.speed) * 3.6)}`, 10, 50);
    ctx.font = '700 13px Consolas, monospace';
    ctx.fillStyle = '#93a0b8';
    ctx.fillText(`${state.fuelKg.toFixed(1)}kg`, 10, 74);

    const ersSpec = ERS_MODE_SPECS[state.ersMode];
    ctx.font = '700 19px Consolas, monospace';
    ctx.fillStyle = state.drsActive ? '#00ff88' : ersSpec.color;
    ctx.textAlign = 'right';
    ctx.fillText(state.drsActive ? 'DRS' : `${Math.round(state.ersEnergy)}%`, 246, 50);
    ctx.font = '700 12px Consolas, monospace';
    ctx.fillText(ersSpec.label.slice(0, 6), 246, 74);

    ctx.font = '700 12px Consolas, monospace';
    ctx.fillStyle = '#ffd13b';
    ctx.textAlign = 'center';
    ctx.fillText(`S:${Math.round(state.tireSurfaceTemp)}° C:${Math.round(state.tireCoreTemp)}° • BB:${Math.round(((state as CarState & { brakeBias?: number }).brakeBias ?? 0.57) * 100)}%`, 128, 112);

    carVis.oledTex.needsUpdate = true;
  }
}
