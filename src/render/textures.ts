/**
 * APEX GP 3D — AAA Procedural PBR Texture & Environment Generator
 * Generates albedo, normal, and roughness maps for F1 liveries, carbon twill,
 * dry/wet asphalt, sand dunes, terrain, buildings, and per-circuit PMREM reflections.
 */
import * as THREE from 'three';
import type { TeamConfig, TrackConfig, WeatherType } from '../core/types';
import { markShared } from '../core/disposer';
import { fh6Assets } from './assetRegistry';

const cache = new Map<string, unknown>();

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  { repeatX = 1, repeatY = 1, srgb = true, anisotropy = 8 } = {}
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = repeatX > 1 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeatY > 1 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  if (repeatX > 1 || repeatY > 1) tex.repeat.set(repeatX, repeatY);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return markShared(tex);
}

/**
 * Converts a grayscale height canvas into a tangent-space Normal Map texture.
 */
function heightToNormalTexture(
  heightCanvas: HTMLCanvasElement,
  strength = 2.0,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const src = heightCanvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const { canvas, ctx } = makeCanvas(w, h);
  const dst = ctx.createImageData(w, h);
  const out = dst.data;

  const sample = (x: number, y: number) => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    return src[(wy * w + wx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * strength;
      const dz = 1.0;
      const invLen = 1 / Math.hypot(dx, dy, dz);
      const idx = (y * w + x) * 4;
      out[idx] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
      out[idx + 1] = Math.round((-dy * invLen * 0.5 + 0.5) * 255);
      out[idx + 2] = Math.round((dz * invLen * 0.5 + 0.5) * 255);
      out[idx + 3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
  const tex = finalizeTexture(canvas, { repeatX, repeatY, srgb: false, anisotropy: 8 });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function getCarbonTexture(): THREE.CanvasTexture {
  if (cache.has('carbon')) return cache.get('carbon') as THREE.CanvasTexture;
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = '#101318';
  ctx.fillRect(0, 0, 256, 256);

  const step = 16;
  for (let y = 0; y < 256; y += step) {
    for (let x = 0; x < 256; x += step) {
      const diag = ((x + y) / step) % 2 === 0;
      const g = ctx.createLinearGradient(x, y, x + step, y + step);
      if (diag) {
        g.addColorStop(0, '#38404d');
        g.addColorStop(0.5, '#1b2028');
        g.addColorStop(1, '#0c0e12');
      } else {
        g.addColorStop(0, '#0c0e12');
        g.addColorStop(0.5, '#2b323d');
        g.addColorStop(1, '#12161c');
      }
      ctx.fillStyle = g;
      ctx.fillRect(x, y, step - 1, step - 1);
    }
  }
  const tex = finalizeTexture(canvas, { repeatX: 10, repeatY: 10, srgb: true, anisotropy: 16 });
  cache.set('carbon', tex);
  return tex;
}

export function getCarbonNormalTexture(): THREE.CanvasTexture {
  if (cache.has('carbon_normal')) return cache.get('carbon_normal') as THREE.CanvasTexture;
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);
  const step = 16;
  for (let y = 0; y < 256; y += step) {
    for (let x = 0; x < 256; x += step) {
      const diag = ((x + y) / step) % 2 === 0;
      ctx.fillStyle = diag ? '#c8c8c8' : '#484848';
      ctx.fillRect(x + 1, y + 1, step - 2, step - 2);
    }
  }
  const normalTex = heightToNormalTexture(canvas, 2.2, 10, 10);
  cache.set('carbon_normal', normalTex);
  return normalTex;
}

export interface TeamTextureBundle {
  bodyTex: THREE.CanvasTexture;
  finTex: THREE.CanvasTexture;
  wingTex: THREE.CanvasTexture;
  tireSideTex: THREE.CanvasTexture;
}

export function getTeamTextures(team: TeamConfig, overrideNumber?: number | null, tireBandOverride?: string): TeamTextureBundle {
  const num = overrideNumber ?? team.number;
  const band = tireBandOverride ?? team.tireBandColor;
  const key = `team_${team.id}_${num}_${band}`;
  if (cache.has(key)) return cache.get(key) as TeamTextureBundle;

  const bundle: TeamTextureBundle = {
    bodyTex: createBodyLivery(team, num),
    finTex: createSharkFinLivery(team, num),
    wingTex: createRearWingTexture(team),
    tireSideTex: createTireSidewallTexture(band)
  };
  cache.set(key, bundle);
  return bundle;
}

function createBodyLivery(team: TeamConfig, num: number): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(1024, 1024);
  ctx.fillStyle = team.primaryColor;
  ctx.fillRect(0, 0, 1024, 1024);

  if (team.id === 'ferrari') {
    const grad = ctx.createLinearGradient(0, 0, 1024, 1024);
    grad.addColorStop(0, '#f20c0c');
    grad.addColorStop(0.5, '#d40000');
    grad.addColorStop(1, '#990000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 1024);

    ctx.fillStyle = '#111111';
    ctx.fillRect(462, 0, 100, 1024);
    ctx.fillStyle = '#ffd200';
    ctx.fillRect(450, 0, 14, 1024);
    ctx.fillRect(560, 0, 14, 1024);

    // Italian tricolor flanks
    const drawTri = (x: number) => {
      ctx.fillStyle = '#009246'; ctx.fillRect(x, 0, 16, 1024);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 16, 0, 16, 1024);
      ctx.fillStyle = '#ce2b37'; ctx.fillRect(x + 32, 0, 16, 1024);
    };
    drawTri(142);
    drawTri(834);

    drawShieldEmblem(ctx, 512, 235, 58, '#ffd200', '#111111');
    drawRaceNumber(ctx, String(num), 512, 415, 132, '#ffffff', '#111111');
    drawSideText(ctx, 'SCUDERIA', 260, 560, '#ffd200', 48);
    drawSideText(ctx, 'SCUDERIA', 764, 560, '#ffd200', 48);
  } else if (team.id === 'monster') {
    const grad = ctx.createLinearGradient(0, 0, 1024, 1024);
    grad.addColorStop(0, '#1a1f26');
    grad.addColorStop(0.5, '#0e1116');
    grad.addColorStop(1, '#080a0d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 1024);

    ctx.strokeStyle = 'rgba(57, 255, 20, 0.16)';
    ctx.lineWidth = 4;
    for (let i = -512; i < 1536; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 400, 1024);
      ctx.stroke();
    }
    ctx.fillStyle = '#39ff14';
    ctx.fillRect(120, 0, 18, 1024);
    ctx.fillRect(886, 0, 18, 1024);
    ctx.fillRect(498, 0, 28, 1024);

    drawMonsterClaw(ctx, 512, 240, 1.05);
    drawMonsterClaw(ctx, 275, 620, 0.85);
    drawMonsterClaw(ctx, 749, 620, 0.85);
    drawRaceNumber(ctx, String(num), 512, 445, 132, '#39ff14', '#000000');
  } else if (team.id === 'mcdonalds') {
    const grad = ctx.createLinearGradient(0, 0, 0, 1024);
    grad.addColorStop(0, '#e32b1d');
    grad.addColorStop(0.65, '#c91b10');
    grad.addColorStop(1, '#9e1108');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 1024);

    ctx.fillStyle = '#ffc72c';
    ctx.beginPath();
    ctx.moveTo(0, 560);
    ctx.quadraticCurveTo(256, 380, 512, 520);
    ctx.quadraticCurveTo(768, 380, 1024, 560);
    ctx.lineTo(1024, 650);
    ctx.quadraticCurveTo(768, 470, 512, 610);
    ctx.quadraticCurveTo(256, 470, 0, 650);
    ctx.closePath();
    ctx.fill();

    for (let y = 0; y < 1024; y += 36) {
      ctx.fillStyle = (y / 36) % 2 === 0 ? '#ffffff' : '#111111';
      ctx.fillRect(108, y, 22, 36);
      ctx.fillRect(894, y, 22, 36);
    }
    drawGoldenArches(ctx, 512, 235, 1.05);
    drawGoldenArches(ctx, 260, 740, 0.68);
    drawGoldenArches(ctx, 764, 740, 0.68);
    drawRaceNumber(ctx, String(num), 512, 425, 136, '#ffc72c', '#7a0c04');
  } else if (team.id === 'redbull') {
    ctx.fillStyle = '#0c1635';
    ctx.fillRect(0, 0, 1024, 1024);

    const noseGrad = ctx.createLinearGradient(0, 0, 0, 260);
    noseGrad.addColorStop(0, '#ffe01b');
    noseGrad.addColorStop(1, '#f4b800');
    ctx.fillStyle = noseGrad;
    ctx.fillRect(360, 0, 304, 240);

    ctx.fillStyle = '#e10600';
    ctx.beginPath();
    ctx.moveTo(360, 230);
    ctx.lineTo(664, 230);
    ctx.lineTo(750, 350);
    ctx.lineTo(274, 350);
    ctx.closePath();
    ctx.fill();

    drawSunburstBull(ctx, 260, 640, 1);
    drawSunburstBull(ctx, 764, 640, -1);

    ctx.fillStyle = '#ffd300';
    ctx.fillRect(120, 0, 14, 1024);
    ctx.fillRect(890, 0, 14, 1024);
    drawRaceNumber(ctx, String(num), 512, 445, 134, '#ffffff', '#e10600');
  } else if (team.id === 'mercedes') {
    const grad = ctx.createLinearGradient(0, 0, 0, 1024);
    grad.addColorStop(0, '#dce3ea');
    grad.addColorStop(0.45, '#b6c0ca');
    grad.addColorStop(0.65, '#252c36');
    grad.addColorStop(1, '#0e1217');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 1024);

    ctx.strokeStyle = '#00d2be';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(150, 0);
    ctx.bezierCurveTo(210, 350, 120, 680, 230, 1024);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(874, 0);
    ctx.bezierCurveTo(814, 350, 904, 680, 794, 1024);
    ctx.stroke();

    drawThreePointStar(ctx, 512, 215, 48, '#141920');
    drawRaceNumber(ctx, String(num), 512, 410, 130, '#00d2be', '#0f141a');
  }

  // Panel seams & cooling louvers
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 3;
  ctx.strokeRect(320, 40, 384, 944);
  ctx.fillStyle = 'rgba(8, 10, 14, 0.72)';
  for (let i = 0; i < 8; i++) {
    const gy = 540 + i * 24;
    ctx.fillRect(218, gy, 48, 8);
    ctx.fillRect(758, gy, 48, 8);
  }

  return finalizeTexture(canvas, { srgb: true });
}

function createSharkFinLivery(team: TeamConfig, num: number): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 256);
  ctx.fillStyle = team.primaryColor;
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = team.secondaryColor;
  ctx.beginPath();
  ctx.moveTo(0, 200);
  ctx.lineTo(512, 130);
  ctx.lineTo(512, 172);
  ctx.lineTo(0, 242);
  ctx.closePath();
  ctx.fill();

  if (team.id === 'monster') drawMonsterClaw(ctx, 130, 120, 0.65);
  else if (team.id === 'mcdonalds') drawGoldenArches(ctx, 125, 118, 0.62);
  else if (team.id === 'redbull') drawSunburstBull(ctx, 135, 115, 0.65);
  else if (team.id === 'ferrari') drawShieldEmblem(ctx, 120, 115, 42, '#ffd200', '#111111');
  else if (team.id === 'mercedes') drawThreePointStar(ctx, 125, 118, 42, '#00d2be');

  ctx.font = 'italic 900 112px Impact, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#000000';
  ctx.strokeText(String(num), 345, 122);
  ctx.fillStyle = team.id === 'monster' ? '#39ff14' : '#ffffff';
  ctx.fillText(String(num), 345, 122);

  return finalizeTexture(canvas, { srgb: true });
}

function createRearWingTexture(team: TeamConfig): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 160);
  ctx.fillStyle = team.id === 'mercedes' ? '#0d1117' : team.primaryColor;
  ctx.fillRect(0, 0, 512, 160);

  ctx.fillStyle = team.secondaryColor;
  ctx.fillRect(0, 0, 512, 14);
  ctx.fillRect(0, 146, 512, 14);

  ctx.font = '900 62px "Segoe UI", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = team.id === 'redbull' || team.id === 'mcdonalds' ? '#ffd300'
    : team.id === 'monster' ? '#39ff14'
    : team.id === 'mercedes' ? '#00d2be'
    : '#ffffff';
  ctx.fillText(team.shortName, 256, 84);

  return finalizeTexture(canvas, { srgb: true });
}

export function createTireSidewallTexture(bandColor: string): THREE.CanvasTexture {
  const key = `tire_side_${bandColor}`;
  if (cache.has(key)) return cache.get(key) as THREE.CanvasTexture;

  const { canvas, ctx } = makeCanvas(512, 512);
  const cx = 256, cy = 256;
  ctx.fillStyle = '#17191d';
  ctx.fillRect(0, 0, 512, 512);

  for (let r = 248; r > 120; r -= 6) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = r % 12 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.20)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, 198, 0, Math.PI * 2);
  ctx.strokeStyle = bandColor;
  ctx.lineWidth = 17;
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);
  for (let a = 0; a < 2; a++) {
    ctx.save();
    ctx.rotate(a * Math.PI);
    ctx.fillStyle = '#17191d';
    ctx.fillRect(-78, -214, 156, 36);
    ctx.font = '900 26px "Segoe UI", sans-serif';
    ctx.fillStyle = bandColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P ZERO', 0, -197);
    ctx.restore();
  }
  ctx.restore();

  const tex = finalizeTexture(canvas, { srgb: true });
  cache.set(key, tex);
  return tex;
}

/* ---------- Vector Livery Helpers ---------- */

function drawRaceNumber(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, stroke: string) {
  ctx.save();
  ctx.font = `italic 900 ${size}px Impact, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawSideText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.font = `900 ${size}px "Segoe UI", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawShieldEmblem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-r * 0.72, -r * 0.85);
  ctx.lineTo(r * 0.72, -r * 0.85);
  ctx.lineTo(r * 0.72, r * 0.1);
  ctx.quadraticCurveTo(r * 0.65, r * 0.8, 0, r * 1.0);
  ctx.quadraticCurveTo(-r * 0.65, r * 0.8, -r * 0.72, r * 0.1);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.arc(0, -r * 0.15, r * 0.22, 0, Math.PI * 2);
  ctx.moveTo(-r * 0.25, r * 0.45);
  ctx.lineTo(0, -r * 0.28);
  ctx.lineTo(r * 0.28, r * 0.42);
  ctx.lineTo(0, r * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMonsterClaw(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#39ff14';
  ctx.shadowColor = '#39ff14';
  ctx.shadowBlur = 14;
  const offsets = [-40, 0, 40];
  offsets.forEach((ox, idx) => {
    const h = idx === 1 ? 150 : 126;
    ctx.beginPath();
    ctx.moveTo(ox - 12, -h * 0.55);
    ctx.quadraticCurveTo(ox + 10, -h * 0.45, ox + 11, -h * 0.1);
    ctx.quadraticCurveTo(ox + 8, h * 0.3, ox - 4, h * 0.58);
    ctx.quadraticCurveTo(ox - 2, h * 0.15, ox - 8, -h * 0.25);
    ctx.lineTo(ox - 22, -h * 0.48);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
}

function drawGoldenArches(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = '#ffc72c';
  ctx.lineWidth = 22;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-64, 52);
  ctx.bezierCurveTo(-60, -76, -8, -76, 0, 26);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 26);
  ctx.bezierCurveTo(8, -76, 60, -76, 64, 52);
  ctx.stroke();
  ctx.restore();
}

function drawSunburstBull(ctx: CanvasRenderingContext2D, x: number, y: number, dir = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.fillStyle = '#ffd300';
  ctx.beginPath();
  ctx.arc(0, 0, 56, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e10600';
  ctx.beginPath();
  ctx.moveTo(-68, 12);
  ctx.quadraticCurveTo(-20, -34, 34, -22);
  ctx.lineTo(64, -36);
  ctx.lineTo(48, -6);
  ctx.lineTo(68, 18);
  ctx.lineTo(14, 16);
  ctx.quadraticCurveTo(-18, 36, -68, 12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawThreePointStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, r * 0.09);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a - 0.22) * r * 0.22, Math.sin(a - 0.22) * r * 0.22);
    ctx.lineTo(Math.cos(a) * r * 0.94, Math.sin(a) * r * 0.94);
    ctx.lineTo(Math.cos(a + 0.22) * r * 0.22, Math.sin(a + 0.22) * r * 0.22);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/* ==========================================================================
   AAA TRACK PBR TEXTURES (ALBEDO + NORMAL + ROUGHNESS)
   ========================================================================== */

export function getAsphaltPBR(theme: string, weather: WeatherType = 'dry') {
  const key = `asphalt_pbr_v3_${theme}_${weather}`;
  if (cache.has(key)) {
    return cache.get(key) as {
      map: THREE.CanvasTexture;
      normalMap: THREE.CanvasTexture;
      roughnessMap: THREE.CanvasTexture;
    };
  }

  const isWet = weather === 'rain' || theme === 'city';
  const { canvas, ctx } = makeCanvas(512, 512);
  const { canvas: hCanvas, ctx: hCtx } = makeCanvas(256, 256);

  // Fine isotropic micro-aggregate tarmac tile (tiled 16x across road width x 900x along road length!)
  // Macro features (white lines, rubber racing groove, tar cracks) are evaluated analytically per-pixel in GLSL!
  const base = theme === 'city' ? '#161a22' : theme === 'desert' ? '#232227' : '#24282f';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);

  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, 256, 256);

  // Ultra-fine 1px-2px mineral aggregate (at 16x repeat across 14m road, 1px = 1.7 millimeters — razor sharp!)
  for (let i = 0; i < 36000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 24 + Math.floor(Math.random() * 48);
    ctx.fillStyle = `rgba(${v},${v + 1},${v + 4},0.35)`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  for (let i = 0; i < 8000; i++) {
    const v = 88 + Math.floor(Math.random() * 46);
    ctx.fillStyle = `rgba(${v},${v},${v + 4},0.18)`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1, 1);
  }
  for (let i = 0; i < 16000; i++) {
    const v = 78 + Math.floor(Math.random() * 100);
    hCtx.fillStyle = `rgb(${v},${v},${v})`;
    hCtx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }

  const { canvas: rCanvas, ctx: rCtx } = makeCanvas(256, 256);
  const baseRough = weather === 'rain' ? 54 : theme === 'city' ? 78 : 192;
  rCtx.fillStyle = `rgb(${baseRough},${baseRough},${baseRough})`;
  rCtx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 9000; i++) {
    const v = Math.max(24, Math.min(242, baseRough + (Math.random() - 0.5) * 48));
    rCtx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
    rCtx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }

  const map = finalizeTexture(canvas, { repeatX: 16, repeatY: 850, srgb: true, anisotropy: 16 });
  const normalMap = heightToNormalTexture(hCanvas, isWet ? 0.65 : 1.15, 16, 850);
  const roughnessMap = finalizeTexture(rCanvas, { repeatX: 16, repeatY: 850, srgb: false, anisotropy: 16 });

  const bundle = { map, normalMap, roughnessMap };
  cache.set(key, bundle);
  return bundle;
}

export function getCatchFenceTexture(): THREE.CanvasTexture {
  if (cache.has('catch_fence')) return cache.get('catch_fence') as THREE.CanvasTexture;
  const { canvas, ctx } = makeCanvas(256, 128);
  ctx.clearRect(0, 0, 256, 128);

  // Diagonal steel wire diamond mesh
  ctx.strokeStyle = 'rgba(180, 192, 208, 0.32)';
  ctx.lineWidth = 1.2;
  for (let i = -128; i < 384; i += 12) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 128, 128);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + 128, 0);
    ctx.lineTo(i, 128);
    ctx.stroke();
  }

  // Horizontal high-tensile FIA steel catch cables
  ctx.fillStyle = 'rgba(70, 80, 96, 0.85)';
  for (const y of [4, 28, 56, 84, 112, 124]) {
    ctx.fillRect(0, y, 256, 2.5);
  }

  // Vertical steel fence stanchion posts
  ctx.fillStyle = '#262d38';
  ctx.fillRect(0, 0, 10, 128);
  ctx.fillRect(124, 0, 10, 128);
  ctx.fillStyle = '#4a5568';
  ctx.fillRect(2, 0, 3, 128);
  ctx.fillRect(126, 0, 3, 128);

  const tex = finalizeTexture(canvas, { repeatX: 1, repeatY: 1, srgb: true, anisotropy: 16 });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  cache.set('catch_fence', tex);
  return tex;
}

export function getTrackSignTexture(label = '100', isDrs = false): THREE.CanvasTexture {
  const key = `sign_${label}_${isDrs}`;
  if (cache.has(key)) return cache.get(key) as THREE.CanvasTexture;

  const { canvas, ctx } = makeCanvas(256, 128);
  if (isDrs) {
    ctx.fillStyle = '#0a0f16';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 246, 118);
    ctx.font = '900 72px "Segoe UI", Impact, sans-serif';
    ctx.fillStyle = '#00ff88';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DRS', 128, 68);
  } else {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#e10600';
    ctx.fillRect(0, 0, 256, 16);
    ctx.fillRect(0, 112, 256, 16);
    ctx.font = '900 76px "Segoe UI", Impact, sans-serif';
    ctx.fillStyle = '#111318';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 68);
  }
  const tex = finalizeTexture(canvas, { srgb: true });
  cache.set(key, tex);
  return tex;
}

export function getCurbTexture(colors: [string, string] = ['#d91616', '#f2f4f8']): THREE.CanvasTexture {
  const key = `curb_v2_${colors.join('_')}`;
  if (cache.has(key)) return cache.get(key) as THREE.CanvasTexture;

  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = colors[1];
  ctx.fillRect(0, 128, 256, 128);

  // 3D serrated concrete step shading & drainage grooves
  const stepGrad1 = ctx.createLinearGradient(0, 0, 0, 128);
  stepGrad1.addColorStop(0, 'rgba(0,0,0,0.34)');
  stepGrad1.addColorStop(0.12, 'rgba(255,255,255,0.16)');
  stepGrad1.addColorStop(0.88, 'rgba(0,0,0,0.06)');
  stepGrad1.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = stepGrad1;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillRect(0, 128, 256, 128);

  // Longitudinal tire rubber skid marks along inner apex edge of curb
  const rubber = ctx.createLinearGradient(0, 0, 256, 0);
  rubber.addColorStop(0, 'rgba(12,14,18,0.48)');
  rubber.addColorStop(0.45, 'rgba(12,14,18,0.22)');
  rubber.addColorStop(1, 'rgba(12,14,18,0.04)');
  ctx.fillStyle = rubber;
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 4, 2);
  }

  const tex = finalizeTexture(canvas, { repeatX: 1, repeatY: 1, srgb: true, anisotropy: 16 });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  cache.set(key, tex);
  return tex;
}

export function getCheckeredTexture(): THREE.CanvasTexture {
  if (cache.has('checkered')) return cache.get('checkered') as THREE.CanvasTexture;
  const { canvas, ctx } = makeCanvas(512, 128);
  const cols = 16, rows = 4;
  const cw = 512 / cols, ch = 128 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f8fafc' : '#111318';
      ctx.fillRect(c * cw, r * ch, cw, ch);
    }
  }
  const tex = finalizeTexture(canvas, { srgb: true });
  cache.set('checkered', tex);
  return tex;
}

export function getSponsorBoardTexture(): THREE.CanvasTexture {
  if (cache.has('sponsors_v4')) return cache.get('sponsors_v4') as THREE.CanvasTexture;
  const { canvas, ctx } = makeCanvas(1024, 128);

  let seed = 771239;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Base dark mortar / shadow recess for Forza Horizon 4 Rustic Dry-Stone Wall & Weathered Guardrail
  ctx.fillStyle = '#181a1c';
  ctx.fillRect(0, 0, 1024, 128);

  // 1. Hand-laid Rustic Dry-Stone Wall courses (irregular fieldstones, moss & top coping stones)
  const rows = [
    { y: 6, h: 22 },
    { y: 31, h: 28 },
    { y: 62, h: 30 },
    { y: 95, h: 29 }
  ];
  for (const r of rows) {
    let x = 0;
    while (x < 1024) {
      const sw = 24 + Math.floor(rand() * 38);
      const sh = r.h - 2 + Math.floor((rand() - 0.5) * 3);
      const baseTone = 72 + Math.floor(rand() * 44);
      const warmShift = Math.floor((rand() - 0.4) * 14);
      const rCol = baseTone + warmShift;
      const gCol = baseTone + Math.floor(warmShift * 0.6);
      const bCol = baseTone - Math.floor(warmShift * 0.5);

      const sg = ctx.createLinearGradient(x, r.y, x, r.y + sh);
      sg.addColorStop(0.0, `rgb(${Math.min(255, rCol + 24)}, ${Math.min(255, gCol + 24)}, ${Math.min(255, bCol + 22)})`);
      sg.addColorStop(0.65, `rgb(${rCol}, ${gCol}, ${bCol})`);
      sg.addColorStop(1.0, `rgb(${Math.max(15, rCol - 28)}, ${Math.max(15, gCol - 28)}, ${Math.max(15, bCol - 26)})`);
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.roundRect(x + 1.5, r.y + (rand() - 0.5) * 1.5, Math.min(sw - 3, 1024 - x - 2), sh, 4);
      ctx.fill();

      // Subtle lichen / moss patch on ~30% of stones
      if (rand() < 0.32) {
        ctx.fillStyle = `rgba(54, 78, 38, ${0.22 + rand() * 0.25})`;
        ctx.fillRect(x + 4, r.y + sh * 0.4, sw * 0.55, sh * 0.5);
      }
      x += sw;
    }
  }

  // 2. Weathered Galvanized W-Beam Steel Guardrail ribbon mounted along mid-height + Vertical Oak Timber Posts
  const railGrad = ctx.createLinearGradient(0, 38, 0, 82);
  railGrad.addColorStop(0.0, 'rgba(38, 44, 50, 0.88)');
  railGrad.addColorStop(0.25, 'rgba(124, 134, 145, 0.85)');
  railGrad.addColorStop(0.50, 'rgba(58, 65, 74, 0.88)');
  railGrad.addColorStop(0.75, 'rgba(116, 125, 136, 0.85)');
  railGrad.addColorStop(1.0, 'rgba(30, 35, 42, 0.90)');
  ctx.fillStyle = railGrad;
  ctx.fillRect(0, 40, 1024, 42);

  // Vertical Weathered Oak / Steel Fence Posts every 64px
  for (let px = 12; px < 1024; px += 64) {
    ctx.fillStyle = '#2d241b';
    ctx.fillRect(px, 2, 10, 126);
    ctx.fillStyle = '#47392b';
    ctx.fillRect(px + 1, 2, 3, 126);
  }

  // Bottom soil & moss Ambient Occlusion strip
  const botAO = ctx.createLinearGradient(0, 96, 0, 128);
  botAO.addColorStop(0, 'rgba(12, 16, 10, 0.0)');
  botAO.addColorStop(1, 'rgba(10, 14, 8, 0.68)');
  ctx.fillStyle = botAO;
  ctx.fillRect(0, 96, 1024, 32);

  const tex = finalizeTexture(canvas, { repeatX: 48, repeatY: 1, srgb: true, anisotropy: 16 });
  tex.wrapS = THREE.RepeatWrapping;
  cache.set('sponsors_v4', tex);
  return tex;
}

export function getBuildingTexture(neonTint = '#00e5ff'): THREE.CanvasTexture {
  const key = `building_${neonTint}`;
  if (cache.has(key)) return cache.get(key) as THREE.CanvasTexture;

  const { canvas, ctx } = makeCanvas(256, 512);
  ctx.fillStyle = '#090d18';
  ctx.fillRect(0, 0, 256, 512);

  ctx.fillStyle = '#11182c';
  for (let x = 0; x < 256; x += 32) {
    ctx.fillRect(x, 0, 3, 512);
  }

  for (let y = 18; y < 496; y += 20) {
    const floorLit = Math.random() > 0.25;
    for (let x = 10; x < 246; x += 22) {
      if (floorLit && Math.random() > 0.35) {
        const colors = ['#ffe599', '#bfe8ff', '#ffffff', neonTint, '#ff90cc'];
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        ctx.globalAlpha = 0.4 + Math.random() * 0.6;
        ctx.fillRect(x, y, 14, 10);
      } else {
        ctx.fillStyle = '#13192b';
        ctx.globalAlpha = 1;
        ctx.fillRect(x, y, 14, 10);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = neonTint;
  ctx.fillRect(0, 2, 256, 8);
  ctx.fillRect(0, 248, 256, 4);

  const tex = finalizeTexture(canvas, { srgb: true });
  cache.set(key, tex);
  return tex;
}

export function getCrowdTexture(): THREE.CanvasTexture {
  if (cache.has('crowd_v3')) return cache.get('crowd_v3') as THREE.CanvasTexture;
  const { canvas, ctx } = makeCanvas(512, 256);
  // Deep shaded stadium interior (no bright 8-bit Lego pixels!)
  const bgGrad = ctx.createLinearGradient(0, 0, 0, 256);
  bgGrad.addColorStop(0, '#0f131a');
  bgGrad.addColorStop(1, '#1e2430');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 512, 256);

  // Concrete stadium steps, glass safety balustrades & muted atmospheric crowd silhouettes
  const mutedPalette = ['#3b4252', '#4c566a', '#881c1c', '#2e3440', '#5e81ac', '#a3be8c', '#d08770', '#c0c8d8'];
  for (let row = 0; row < 14; row++) {
    const y = row * 18 + 6;
    // Deep shadow under each concrete seating tier
    ctx.fillStyle = '#090c10';
    ctx.fillRect(0, y + 11, 512, 7);
    ctx.fillStyle = '#2c3340';
    ctx.fillRect(0, y + 9, 512, 2);

    for (let col = 0; col < 72; col++) {
      if (Math.random() < 0.22) continue;
      const x = col * 7 + (row % 2) * 3;
      ctx.fillStyle = mutedPalette[Math.floor(Math.random() * mutedPalette.length)];
      ctx.globalAlpha = 0.45 + (row / 14) * 0.35;
      ctx.beginPath();
      ctx.arc(x + 2, y + 5, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1.0;
  // Vertical concrete stadium aisles
  ctx.fillStyle = 'rgba(20, 24, 32, 0.85)';
  for (const ax of [120, 256, 392]) {
    ctx.fillRect(ax - 8, 0, 16, 256);
  }
  const tex = finalizeTexture(canvas, { repeatX: 3, repeatY: 1, srgb: true, anisotropy: 16 });
  tex.wrapS = THREE.RepeatWrapping;
  cache.set('crowd_v3', tex);
  return tex;
}

/**
 * Photorealistic procedural terrain albedo + normal map (mowed grass stripes, organic desert ripples, city concrete).
 */
export function getTerrainPBR(theme: string) {
  const key = `terrain_pbr_v2_${theme}`;
  if (cache.has(key)) {
    return cache.get(key) as { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture };
  }

  const { canvas, ctx } = makeCanvas(512, 512);
  const { canvas: hCanvas, ctx: hCtx } = makeCanvas(256, 256);

  if (theme === 'desert') {
    ctx.fillStyle = '#c8844c';
    ctx.fillRect(0, 0, 512, 512);
    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, 256, 256);

    const img = ctx.getImageData(0, 0, 512, 512);
    const d = img.data;
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const wave = Math.sin(x * 0.049 + Math.sin(y * 0.0245) * 2.2) * 0.5 + 0.5;
        const fine = (Math.random() - 0.5) * 14;
        const i = (y * 512 + x) * 4;
        d[i] = Math.min(255, Math.max(0, 188 + wave * 28 + fine));
        d[i + 1] = Math.min(255, Math.max(0, 122 + wave * 22 + fine));
        d[i + 2] = Math.min(255, Math.max(0, 68 + wave * 14 + fine));
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const hImg = hCtx.getImageData(0, 0, 256, 256);
    const hd = hImg.data;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const w = Math.sin(x * 0.098 + Math.sin(y * 0.049) * 2.2) * 55 + 128 + (Math.random() - 0.5) * 18;
        const i = (y * 256 + x) * 4;
        hd[i] = hd[i + 1] = hd[i + 2] = Math.max(0, Math.min(255, w));
        hd[i + 3] = 255;
      }
    }
    hCtx.putImageData(hImg, 0, 0);
  } else if (theme === 'city') {
    ctx.fillStyle = '#11141e';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 512; i += 64) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }
    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, 256, 256);
  } else {
    // Photorealistic mowed motorsport grass with diagonal stadium stripes & lush micro-blades!
    const baseGrass = theme === 'alpine' ? '#2c4a27' : '#2d5222';
    ctx.fillStyle = baseGrass;
    ctx.fillRect(0, 0, 512, 512);

    // Subtle mowed lawn stripes
    for (let y = 0; y < 512; y += 64) {
      ctx.fillStyle = (y / 64) % 2 === 0 ? 'rgba(130, 185, 85, 0.11)' : 'rgba(12, 28, 10, 0.12)';
      ctx.fillRect(0, y, 512, 32);
    }

    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 18000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = Math.random();
      ctx.fillStyle = r > 0.62 ? 'rgba(112, 165, 72, 0.26)' : r > 0.25 ? 'rgba(22, 48, 18, 0.28)' : 'rgba(85, 72, 48, 0.16)';
      ctx.fillRect(x, y, 3, 4);
    }
    for (let i = 0; i < 9000; i++) {
      const v = 75 + Math.floor(Math.random() * 105);
      hCtx.fillStyle = `rgb(${v},${v},${v})`;
      hCtx.fillRect(Math.random() * 256, Math.random() * 256, 2, 3);
    }
  }

  const map = finalizeTexture(canvas, { repeatX: 52, repeatY: 52, srgb: true, anisotropy: 16 });
  const normalMap = heightToNormalTexture(hCanvas, theme === 'desert' ? 1.9 : 1.4, 52, 52);
  const bundle = { map, normalMap };
  cache.set(key, bundle);
  return bundle;
}

export function createSkyTexture(trackCfg: TrackConfig, weather: WeatherType = 'dry'): THREE.CanvasTexture {
  const key = `sky_v2_${trackCfg.id}_${weather}`;
  if (cache.has(key)) return cache.get(key) as THREE.CanvasTexture;

  const { canvas, ctx } = makeCanvas(1024, 512);
  const grad = ctx.createLinearGradient(0, 0, 0, 512);

  if (weather === 'rain' && trackCfg.theme !== 'city') {
    grad.addColorStop(0.0, '#182230');
    grad.addColorStop(0.45, '#4c5e73');
    grad.addColorStop(0.50, '#8ba0b8');
    grad.addColorStop(0.54, '#242a34');
    grad.addColorStop(1.0, '#12151a');
  } else if (weather === 'overcast' && trackCfg.theme !== 'city') {
    grad.addColorStop(0.0, '#2e4663');
    grad.addColorStop(0.46, '#8ea8c4');
    grad.addColorStop(0.50, '#d8e6f5');
    grad.addColorStop(0.54, '#2a3328');
    grad.addColorStop(1.0, '#141816');
  } else {
    grad.addColorStop(0.0, trackCfg.skyTop);
    grad.addColorStop(0.45, trackCfg.skyHorizon);
    grad.addColorStop(0.50, '#fffdf6'); // Bright atmospheric horizon band for realistic Fresnel reflections!
    grad.addColorStop(0.53, trackCfg.groundColor);
    grad.addColorStop(1.0, '#12151a');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);

  if (trackCfg.theme === 'city') {
    for (let i = 0; i < 650; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.7})`;
      ctx.beginPath();
      ctx.arc(Math.random() * 1024, Math.random() * 210, Math.random() * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // High-contrast neon city reflections for car clearcoat!
    const neonCols = ['#00f0ff', '#ff007f', '#ffe066', '#9d4edd'];
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = neonCols[i % neonCols.length];
      ctx.fillRect(i * 42 + 10, 210 + (i % 3) * 14, 26, 12);
    }
  } else {
    // High-luminance Solar Disc on ALL daytime circuits so car paint & asphalt reflect the sun!
    const sunGrad = ctx.createRadialGradient(280, 185, 6, 280, 185, 160);
    sunGrad.addColorStop(0, '#ffffff');
    sunGrad.addColorStop(0.18, '#fff7cc');
    sunGrad.addColorStop(0.48, 'rgba(255, 210, 120, 0.42)');
    sunGrad.addColorStop(1, 'rgba(255, 180, 90, 0)');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(280, 185, 160, 0, Math.PI * 2);
    ctx.fill();

    const cloudCount = weather === 'dry' ? 48 : 85;
    const cloudAlpha = weather === 'rain' ? 0.25 : weather === 'overcast' ? 0.50 : 0.72;
    for (let i = 0; i < cloudCount; i++) {
      const cx = Math.random() * 1024;
      const cy = 45 + Math.random() * 175;
      const rx = 45 + Math.random() * 95;
      const ry = 12 + Math.random() * 24;
      const cg = ctx.createRadialGradient(cx, cy, 4, cx, cy, rx);
      const col = weather === 'rain' ? '130,144,162' : '255,255,255';
      cg.addColorStop(0, `rgba(${col},${cloudAlpha})`);
      cg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = finalizeTexture(canvas, { srgb: true });
  tex.mapping = THREE.EquirectangularReflectionMapping;
  cache.set(key, tex);
  return tex;
}

/**
 * Generates a studio PBR PMREM environment map for the Showroom.
 */
export function createStudioEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (fh6Assets.pmremProbes.has('studio')) {
    return fh6Assets.pmremProbes.get('studio')!;
  }
  if (cache.has('env_studio_v2')) return cache.get('env_studio_v2') as THREE.Texture;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();

  const { canvas, ctx } = makeCanvas(256, 128);
  const dg = ctx.createLinearGradient(0, 0, 0, 128);
  dg.addColorStop(0.0, '#121b2c');
  dg.addColorStop(0.42, '#4a6896');
  dg.addColorStop(0.50, '#ffffff');
  dg.addColorStop(0.56, '#141a26');
  dg.addColorStop(1.0, '#05070b');
  ctx.fillStyle = dg;
  ctx.fillRect(0, 0, 256, 128);

  const domeTex = new THREE.CanvasTexture(canvas);
  domeTex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(40, 24, 16),
    new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide })
  );
  envScene.add(dome);

  const stripMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  for (let i = -2; i <= 2; i++) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(24, 2.0), stripMat);
    strip.position.set(0, 10, i * 4.2);
    strip.rotation.x = Math.PI / 2;
    envScene.add(strip);
  }
  const leftPanel = new THREE.Mesh(new THREE.PlaneGeometry(28, 8), new THREE.MeshBasicMaterial({ color: '#8ad4ff' }));
  leftPanel.position.set(-15, 4.5, 0);
  leftPanel.rotation.y = Math.PI / 2;
  envScene.add(leftPanel);

  const rightPanel = new THREE.Mesh(new THREE.PlaneGeometry(28, 8), new THREE.MeshBasicMaterial({ color: '#ffe2b0' }));
  rightPanel.position.set(15, 4.5, 0);
  rightPanel.rotation.y = -Math.PI / 2;
  envScene.add(rightPanel);

  const rt = pmrem.fromScene(envScene, 0.015);
  domeTex.dispose();
  pmrem.dispose();
  const envTex = markShared(rt.texture);
  cache.set('env_studio_v2', envTex);
  return envTex;
}

/**
 * Generates a high-contrast circuit-specific PMREM reflection map using real 32-bit Poly Haven .HDR skies
 * + grounded road bounce + passing forest treeline silhouettes for razor-sharp Forza Horizon clear-coat reflections!
 */
export function createTrackEnvMap(
  renderer: THREE.WebGLRenderer,
  trackCfg: TrackConfig,
  weather: WeatherType
): THREE.Texture {
  if (fh6Assets.loaded) {
    const hdrProbe = fh6Assets.getOrBuildTrackProbe(renderer, trackCfg.theme, weather, trackCfg.sunPos);
    if (hdrProbe) return hdrProbe;
  }
  const key = `env_v3_${trackCfg.id}_${weather}`;
  if (cache.has(key)) return cache.get(key) as THREE.Texture;

  const skyTex = createSkyTexture(trackCfg, weather);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 20),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })
  );
  envScene.add(dome);

  // Dark tarmac & grass ground bounce hemisphere so lower car body reflects dark road instead of sky!
  const groundDisc = new THREE.Mesh(
    new THREE.CircleGeometry(48, 32),
    new THREE.MeshBasicMaterial({ color: trackCfg.theme === 'desert' ? '#3a2616' : '#14181d' })
  );
  groundDisc.rotation.x = -Math.PI / 2;
  groundDisc.position.y = -2.2;
  envScene.add(groundDisc);

  // 360° Horizon Forest Treeline Silhouettes inside PMREM so Car Clear-Coat Paint reflects passing trees & sky!
  if (trackCfg.theme === 'monza' || trackCfg.theme === 'alpine') {
    const treeSilMat = new THREE.MeshBasicMaterial({ color: '#142214', side: THREE.DoubleSide });
    const sunTreeMat = new THREE.MeshBasicMaterial({ color: '#2f4522', side: THREE.DoubleSide });
    const sunVec = new THREE.Vector3(...trackCfg.sunPos).normalize();
    for (let i = 0; i < 42; i++) {
      const ang = (i / 42) * Math.PI * 2;
      // Leave open sky corridor forward & backward along the road axis so clearcoat shows dramatic tree-to-sky contrast!
      if (Math.abs(Math.cos(ang)) > 0.88) continue;
      const h = 8 + (i % 5) * 3.2;
      const r = 34;
      const tx = Math.sin(ang) * r;
      const tz = Math.cos(ang) * r;
      const towardSun = (tx * sunVec.x + tz * sunVec.z) > 0;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(3.6, h, 7), towardSun ? sunTreeMat : treeSilMat);
      cone.position.set(tx, h * 0.42 - 1.8, tz);
      envScene.add(cone);
    }
  }

  // High-luminance 3D solar disc & warm horizon glow card for razor-sharp automotive specular highlights
  const sunDir = new THREE.Vector3(...trackCfg.sunPos).normalize().multiplyScalar(38);
  const sunCard = new THREE.Mesh(
    new THREE.SphereGeometry(trackCfg.theme === 'city' ? 2.5 : 4.6, 16, 12),
    new THREE.MeshBasicMaterial({ color: trackCfg.theme === 'city' ? '#00f0ff' : '#fff6dc' })
  );
  sunCard.position.copy(sunDir);
  envScene.add(sunCard);

  const rt = pmrem.fromScene(envScene, 0.010);
  pmrem.dispose();
  const envTex = markShared(rt.texture);
  cache.set(key, envTex);
  return envTex;
}

/**
 * 1024x1024 Botanical Scots Pine / Douglas Fir Single Overhanging Bough-Fan Texture (Ultra-Realistic 3D Tree Model)
 * Radiates from branch base (512, 990) into forked woody boughs & thousands of crisp individual pine needles.
 * Mapped onto 36 real 3D arched/drooping bough meshes arranged in a phyllotaxis spiral around a 3D trunk!
 */
export function getPineBranchAlphaTexture(): THREE.CanvasTexture {
  const key = 'pine_bough_fan_1k_v4';
  if (cache.has(key)) return cache.get(key) as THREE.CanvasTexture;

  const { canvas, ctx } = makeCanvas(1024, 1024);
  ctx.clearRect(0, 0, 1024, 1024);

  let seed = 918273;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Main woody branch stem emerging from trunk attachment at bottom center (512, 1005)
  const drawNeedleShoot = (x1: number, y1: number, x2: number, y2: number, width: number, needleScale: number) => {
    ctx.strokeStyle = 'rgba(68, 49, 34, 0.95)';
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const dx = x2 - x1;
    const dy = y2 - y1;
    const shootAng = Math.atan2(dy, dx);
    const len = Math.hypot(dx, dy);
    const steps = Math.max(8, Math.floor(len / 9));

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const bx = x1 + dx * t;
      const by = y1 + dy * t;
      // Fan of 10 fine crisp 1K pine needles at each node
      for (let n = 0; n < 10; n++) {
        const side = n % 2 === 0 ? 1 : -1;
        const spread = 0.28 + rand() * 0.85;
        const nAng = shootAng + side * spread + (rand() - 0.5) * 0.22;
        const nLen = (24 + rand() * 34) * needleScale * (0.65 + (1.0 - t * 0.35) * 0.45);
        const lum = Math.floor(128 + t * 48 + rand() * 56);
        const rCol = Math.floor(lum * (0.66 + rand() * 0.08));
        const gCol = lum;
        const bCol = Math.floor(lum * (0.50 + rand() * 0.08));

        ctx.strokeStyle = `rgba(${rCol}, ${gCol}, ${bCol}, 0.96)`;
        ctx.lineWidth = 1.9 + rand() * 1.2;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(nAng) * nLen, by + Math.sin(nAng) * nLen);
        ctx.stroke();
      }
    }
  };

  // 7 diverging primary bough ribs fanning from (512, 1000) toward upper arc
  const mainAngles = [-Math.PI * 0.74, -Math.PI * 0.64, -Math.PI * 0.56, -Math.PI * 0.50, -Math.PI * 0.44, -Math.PI * 0.36, -Math.PI * 0.26];
  for (const baseAng of mainAngles) {
    const ang = baseAng + (rand() - 0.5) * 0.06;
    const rLen = (680 + rand() * 210) * (1.0 - Math.abs(ang + Math.PI * 0.5) * 0.32);
    const ex = 512 + Math.cos(ang) * rLen;
    const ey = 995 + Math.sin(ang) * rLen;
    drawNeedleShoot(512, 995, ex, ey, 6.5, 1.0);

    // Forked secondary lateral sub-shoots along each bough rib
    for (let sub = 1; sub <= 5; sub++) {
      const f = 0.24 + (sub / 6) * 0.64;
      const sx = 512 + (ex - 512) * f;
      const sy = 995 + (ey - 995) * f;
      for (const side of [-1, 1]) {
        const subAng = ang + side * (0.42 + rand() * 0.24);
        const subLen = (150 + rand() * 115) * (1.0 - f * 0.42);
        drawNeedleShoot(sx, sy, sx + Math.cos(subAng) * subLen, sy + Math.sin(subAng) * subLen, 3.2, 0.86);
      }
    }
  }

  const tex = finalizeTexture(canvas, { srgb: true, anisotropy: 16 });
  cache.set(key, tex);
  return tex;
}

/**
 * 1024x1024 Botanical Deciduous Birch / Oak / Maple Branch-Spray Texture (Ultra-Realistic 3D Tree Model)
 * Renders forked woody branches and hundreds of pointed/serrated individual leaves with midrib veins.
 */
export function getDeciduousLeafAlphaTexture(): THREE.CanvasTexture {
  const key = 'deciduous_leaf_alpha_1k_v2';
  if (cache.has(key)) return cache.get(key) as THREE.CanvasTexture;

  const { canvas, ctx } = makeCanvas(1024, 1024);
  ctx.clearRect(0, 0, 1024, 1024);

  let seed = 445566;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const cx = 512;
  const cy = 512;

  for (let b = 0; b < 14; b++) {
    const ang = (b / 14) * Math.PI * 2 + (rand() - 0.5) * 0.30;
    const len = 290 + rand() * 145;
    const mx = cx + Math.cos(ang) * (len * 0.52) + (rand() - 0.5) * 44;
    const my = cy + Math.sin(ang) * (len * 0.52) + (rand() - 0.5) * 44;
    const ex = cx + Math.cos(ang) * len;
    const ey = cy + Math.sin(ang) * len;

    ctx.strokeStyle = 'rgba(66, 50, 35, 0.94)';
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(mx, my, ex, ey);
    ctx.stroke();

    // Paint crisp pointed ovate leaves along twigs with natural sky gaps
    const numLeaves = 46;
    for (let l = 0; l < numLeaves; l++) {
      const t = 0.16 + rand() * 0.86;
      const lx = cx + Math.cos(ang) * (len * t) + (rand() - 0.5) * 108;
      const ly = cy + Math.sin(ang) * (len * t) + (rand() - 0.5) * 108;
      const lAng = rand() * Math.PI * 2;
      const lw = 15 + rand() * 16;
      const lh = 8.5 + rand() * 9.5;

      const lum = Math.floor(142 + rand() * 104);
      const rCol = Math.floor(lum * (0.74 + rand() * 0.16));
      const gCol = lum;
      const bCol = Math.floor(lum * (0.50 + rand() * 0.12));

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(lAng);
      ctx.fillStyle = `rgba(${rCol}, ${gCol}, ${bCol}, 0.97)`;
      ctx.beginPath();
      ctx.moveTo(-lw, 0);
      ctx.quadraticCurveTo(-lw * 0.2, -lh, lw, 0);
      ctx.quadraticCurveTo(-lw * 0.2, lh, -lw, 0);
      ctx.closePath();
      ctx.fill();

      // Subtle central leaf vein
      ctx.strokeStyle = `rgba(${Math.min(255, rCol + 22)}, ${Math.min(255, gCol + 22)}, ${Math.min(255, bCol + 15)}, 0.55)`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-lw * 0.8, 0);
      ctx.lineTo(lw * 0.75, 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  const tex = finalizeTexture(canvas, { srgb: true, anisotropy: 16 });
  cache.set(key, tex);
  return tex;
}

