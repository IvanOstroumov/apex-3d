/**
 * APEX GP 3D — Next-Gen Multi-Emitter GPU Particle & Atmospheric VFX Engine
 * Features:
 * - Per-particle dynamic scale growth (`aScale`), ground-plane specular bounce & 3D curl turbulence
 * - 4 Procedural HD Particle Textures (Volumetric FBM Cloud, HDR Spark Core, Carbon/Grass Shard, Plasma Flame)
 * - HDR Titanium Skid-Block Sparks with blackbody thermal cooling & asphalt bouncing
 * - Volumetric Pirelli Tire Lockup/Drift Smoke, Off-Track Grass Blades, Dirt Clods & Desert Sand Plumes
 * - Car-to-Car & Barrier Carbon-Fiber Shards + Paint Splinters + Contact Spark Showers
 * - Glowing Carbon-Ceramic Brake Rotor Embers, High-G Wingtip Condensation Vortices & Wet Rooster-Tail Spray
 */
import * as THREE from 'three';
import type { CarState, TrackData, WeatherType } from '../core/types';
import type { CarCollisionEvent } from '../sim/physics';

function createSparkEmberTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,245,210,0.95)');
  g.addColorStop(0.55, 'rgba(255,180,60,0.45)');
  g.addColorStop(1, 'rgba(255,90,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function createVolumetricCloudTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);

  // Multi-lobe billowy volumetric puff
  const lobes = [
    [64, 64, 54, 0.52],
    [48, 54, 38, 0.36],
    [80, 58, 36, 0.34],
    [56, 78, 36, 0.32],
    [74, 74, 34, 0.30]
  ];
  for (const [cx, cy, rad, alpha] of lobes) {
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.48, `rgba(245,248,255,${alpha * 0.62})`);
    g.addColorStop(0.82, `rgba(225,232,245,${alpha * 0.18})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

function createDebrisShardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);

  // Crisp angular carbon/grass/clod flake with soft anti-aliased edge
  ctx.save();
  ctx.translate(32, 32);
  ctx.beginPath();
  ctx.moveTo(-18, -10);
  ctx.lineTo(6, -20);
  ctx.lineTo(22, -4);
  ctx.lineTo(14, 18);
  ctx.lineTo(-12, 16);
  ctx.closePath();
  const g = ctx.createRadialGradient(-4, -4, 2, 0, 0, 24);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.7, 'rgba(230,235,240,0.92)');
  g.addColorStop(1, 'rgba(180,190,200,0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  return new THREE.CanvasTexture(c);
}

class ParticlePool {
  max: number;
  cursor = 0;
  positions: Float32Array;
  colors: Float32Array;
  scales: Float32Array;
  initScale: Float32Array;
  endScale: Float32Array;
  velX: Float32Array;
  velY: Float32Array;
  velZ: Float32Array;
  groundY: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  baseR: Float32Array;
  baseG: Float32Array;
  baseB: Float32Array;
  points: THREE.Points;

  constructor(
    maxCount: number,
    tex: THREE.CanvasTexture,
    {
      size = 1.0,
      blending = THREE.AdditiveBlending as THREE.Blending,
      depthWrite = false,
      hdr = false,
      opacity = 0.92
    }: {
      size?: number;
      blending?: THREE.Blending;
      depthWrite?: boolean;
      hdr?: boolean;
      opacity?: number;
    } = {}
  ) {
    this.max = maxCount;
    this.positions = new Float32Array(maxCount * 3);
    this.colors = new Float32Array(maxCount * 3);
    this.scales = new Float32Array(maxCount);
    this.initScale = new Float32Array(maxCount);
    this.endScale = new Float32Array(maxCount);
    this.velX = new Float32Array(maxCount);
    this.velY = new Float32Array(maxCount);
    this.velZ = new Float32Array(maxCount);
    this.groundY = new Float32Array(maxCount);
    this.life = new Float32Array(maxCount);
    this.maxLife = new Float32Array(maxCount);
    this.baseR = new Float32Array(maxCount);
    this.baseG = new Float32Array(maxCount);
    this.baseB = new Float32Array(maxCount);

    for (let i = 0; i < maxCount; i++) {
      this.positions[i * 3 + 1] = -9999;
      this.scales[i] = 1.0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aScale', new THREE.BufferAttribute(this.scales, 1));

    const mat = new THREE.PointsMaterial({
      size,
      map: tex,
      vertexColors: true,
      transparent: true,
      opacity,
      blending,
      depthWrite,
      sizeAttenuation: true,
      toneMapped: !hdr
    });

    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('uniform float size;', 'uniform float size;\nattribute float aScale;')
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aScale;');
    };

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    r: number,
    g: number,
    b: number,
    lifeSec: number,
    startScale = 1.0,
    finalScale = 1.0,
    floorY = -9999
  ) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.velX[i] = vx;
    this.velY[i] = vy;
    this.velZ[i] = vz;
    this.groundY[i] = floorY;
    this.life[i] = lifeSec;
    this.maxLife[i] = lifeSec;
    this.initScale[i] = startScale;
    this.endScale[i] = finalScale;
    this.scales[i] = startScale;
    this.baseR[i] = r;
    this.baseG[i] = g;
    this.baseB[i] = b;
    this.colors[i * 3] = r;
    this.colors[i * 3 + 1] = g;
    this.colors[i * 3 + 2] = b;
  }

  update(
    dt: number,
    gravity = -12,
    drag = 1.5,
    opts: { bounceRestitution?: number; turbulence?: number; thermalCool?: boolean } = {}
  ) {
    const pos = this.positions;
    const col = this.colors;
    const scl = this.scales;
    const damp = Math.max(0, 1 - drag * dt);
    const bounce = opts.bounceRestitution ?? 0;
    const turb = opts.turbulence ?? 0;
    const thermal = opts.thermalCool ?? false;

    for (let i = 0; i < this.max; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const nl = l - dt;
      this.life[i] = nl;
      if (nl <= 0) {
        pos[i * 3 + 1] = -9999;
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
        scl[i] = 0;
        continue;
      }

      const ageFrac = 1 - nl / this.maxLife[i];
      scl[i] = this.initScale[i] + (this.endScale[i] - this.initScale[i]) * ageFrac;

      this.velX[i] *= damp;
      this.velY[i] = this.velY[i] * damp + gravity * dt;
      this.velZ[i] *= damp;

      if (turb > 0) {
        const phase = i * 1.37 + nl * 7.5;
        this.velX[i] += Math.sin(phase) * turb * dt;
        this.velZ[i] += Math.cos(phase * 0.83) * turb * dt;
      }

      let nx = pos[i * 3] + this.velX[i] * dt;
      let ny = pos[i * 3 + 1] + this.velY[i] * dt;
      let nz = pos[i * 3 + 2] + this.velZ[i] * dt;

      // Specular asphalt ground bounce for sparks, grass clods, and carbon shards!
      const gy = this.groundY[i];
      if (bounce > 0 && ny < gy + 0.03 && this.velY[i] < 0) {
        ny = gy + 0.03;
        this.velY[i] = -this.velY[i] * bounce;
        this.velX[i] *= 0.82;
        this.velZ[i] *= 0.82;
      }

      pos[i * 3] = nx;
      pos[i * 3 + 1] = ny;
      pos[i * 3 + 2] = nz;

      const fade = Math.sin((1 - ageFrac) * Math.PI * 0.5);
      if (thermal) {
        // Blackbody cooling: white-gold -> hot orange -> deep red ember
        col[i * 3] = this.baseR[i] * fade;
        col[i * 3 + 1] = this.baseG[i] * fade * Math.max(0.2, 1 - ageFrac * 0.72);
        col[i * 3 + 2] = this.baseB[i] * fade * Math.max(0.05, 1 - ageFrac * 1.35);
      } else {
        col[i * 3] = this.baseR[i] * fade;
        col[i * 3 + 1] = this.baseG[i] * fade;
        col[i * 3 + 2] = this.baseB[i] * fade;
      }
    }

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.aScale.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

export class VFXManager {
  private group = new THREE.Group();
  private sparkTex: THREE.CanvasTexture;
  private cloudTex: THREE.CanvasTexture;
  private shardTex: THREE.CanvasTexture;

  private sparks: ParticlePool;
  private smoke: ParticlePool;
  private debris: ParticlePool;
  private flames: ParticlePool;
  private vortex: ParticlePool;
  private rainPoints: THREE.Points | null = null;
  private rainPositions: Float32Array | null = null;

  private _backDir = new THREE.Vector3();
  private _wheelPos = new THREE.Vector3();
  private _tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, weather: WeatherType) {
    this.sparkTex = createSparkEmberTexture();
    this.cloudTex = createVolumetricCloudTexture();
    this.shardTex = createDebrisShardTexture();

    this.sparks = new ParticlePool(1800, this.sparkTex, {
      size: 0.48,
      blending: THREE.AdditiveBlending,
      hdr: true,
      opacity: 0.96
    });
    this.smoke = new ParticlePool(1500, this.cloudTex, {
      size: 1.75,
      blending: THREE.NormalBlending,
      opacity: 0.66
    });
    this.debris = new ParticlePool(1300, this.shardTex, {
      size: 0.34,
      blending: THREE.NormalBlending,
      opacity: 0.94
    });
    this.flames = new ParticlePool(650, this.sparkTex, {
      size: 0.46,
      blending: THREE.AdditiveBlending,
      hdr: true,
      opacity: 0.95
    });
    this.vortex = new ParticlePool(850, this.cloudTex, {
      size: 0.55,
      blending: THREE.AdditiveBlending,
      opacity: 0.38
    });

    this.group.add(
      this.sparks.points,
      this.smoke.points,
      this.debris.points,
      this.flames.points,
      this.vortex.points
    );

    if (weather === 'rain') {
      const rainCount = 1200;
      this.rainPositions = new Float32Array(rainCount * 3);
      for (let i = 0; i < rainCount; i++) {
        this.rainPositions[i * 3] = (Math.random() - 0.5) * 90;
        this.rainPositions[i * 3 + 1] = Math.random() * 40;
        this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 90;
      }
      const rGeo = new THREE.BufferGeometry();
      rGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
      const rMat = new THREE.PointsMaterial({
        color: '#c4def8',
        size: 0.24,
        transparent: true,
        opacity: 0.58,
        depthWrite: false
      });
      this.rainPoints = new THREE.Points(rGeo, rMat);
      this.rainPoints.frustumCulled = false;
      this.group.add(this.rainPoints);
    }

    scene.add(this.group);
  }

  emitSparks(pos: THREE.Vector3, backDir: THREE.Vector3, count = 6, speed = 18) {
    for (let i = 0; i < count; i++) {
      const hot = Math.random();
      this.sparks.spawn(
        pos.x + (Math.random() - 0.5) * 0.52,
        pos.y + 0.08 + Math.random() * 0.08,
        pos.z + (Math.random() - 0.5) * 0.52,
        backDir.x * (speed * (0.65 + Math.random() * 0.55)) + (Math.random() - 0.5) * 5.2,
        1.8 + Math.random() * 5.4,
        backDir.z * (speed * (0.65 + Math.random() * 0.55)) + (Math.random() - 0.5) * 5.2,
        2.8 + hot * 0.8,
        1.55 + hot * 0.9,
        0.38 + hot * 0.6,
        0.26 + Math.random() * 0.34,
        0.8 + Math.random() * 0.5,
        0.25,
        pos.y
      );
    }
  }

  emitCollisionBurst(pos: THREE.Vector3, intensity = 1) {
    const sparkCount = Math.floor(20 + intensity * 32);
    for (let i = 0; i < sparkCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (5 + Math.random() * 16) * intensity;
      this.sparks.spawn(
        pos.x + (Math.random() - 0.5) * 0.3,
        pos.y + 0.25,
        pos.z + (Math.random() - 0.5) * 0.3,
        Math.cos(a) * spd,
        2.5 + Math.random() * 8.5,
        Math.sin(a) * spd,
        3.1,
        1.7 + Math.random() * 0.7,
        0.45,
        0.32 + Math.random() * 0.38,
        1.1,
        0.2,
        pos.y - 0.2
      );
    }

    // Carbon-fiber aero splinters & shock dust puff
    const shardCount = Math.floor(10 + intensity * 18);
    for (let i = 0; i < shardCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (3 + Math.random() * 11) * intensity;
      const shade = 0.14 + Math.random() * 0.16;
      this.debris.spawn(
        pos.x + (Math.random() - 0.5) * 0.4,
        pos.y + 0.32,
        pos.z + (Math.random() - 0.5) * 0.4,
        Math.cos(a) * spd,
        3.2 + Math.random() * 6.5,
        Math.sin(a) * spd,
        shade,
        shade,
        shade + 0.03,
        0.55 + Math.random() * 0.45,
        0.75 + Math.random() * 0.65,
        0.45,
        pos.y - 0.25
      );
    }

    for (let i = 0; i < 5; i++) {
      this.smoke.spawn(
        pos.x + (Math.random() - 0.5) * 0.5,
        pos.y + 0.3,
        pos.z + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 3.5,
        1.2 + Math.random() * 1.8,
        (Math.random() - 0.5) * 3.5,
        0.78,
        0.80,
        0.84,
        0.45 + Math.random() * 0.35,
        0.65,
        2.35
      );
    }
  }

  /**
   * Specialized VFX for Car-to-Car Collisions (Wheel-to-wheel rub vs Rear-End wing shatter vs Side Slam)
   */
  emitCarCollisionVFX(ev: CarCollisionEvent) {
    this.emitCollisionBurst(ev.pos, ev.intensity);
    if (ev.type === 'rear_end' || ev.intensity > 0.35) {
      // Team-painted carbon bodywork splinters flying off the front wing / endplate!
      const c = this._tmpColor.set(ev.primaryColor || '#e10600');
      const count = Math.floor(8 + ev.intensity * 14);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = 4 + Math.random() * 10;
        const isPainted = i % 2 === 0;
        this.debris.spawn(
          ev.pos.x + (Math.random() - 0.5) * 0.35,
          ev.pos.y + 0.15,
          ev.pos.z + (Math.random() - 0.5) * 0.35,
          Math.cos(a) * spd + ev.normal.x * 4,
          3.5 + Math.random() * 6.0,
          Math.sin(a) * spd + ev.normal.z * 4,
          isPainted ? c.r : 0.16,
          isPainted ? c.g : 0.17,
          isPainted ? c.b : 0.19,
          0.62 + Math.random() * 0.45,
          0.9 + Math.random() * 0.5,
          0.5,
          ev.pos.y - 0.32
        );
      }
    }
  }

  emitTireSmoke(pos: THREE.Vector3, backDir: THREE.Vector3, isOffTrack = false, theme = 'monza', isRainSpray = false, intensity = 1.0) {
    let r = 0.88, g = 0.90, b = 0.94;
    if (isRainSpray) {
      r = 0.76; g = 0.84; b = 0.93;
    } else if (isOffTrack) {
      if (theme === 'desert') { r = 0.88; g = 0.67; b = 0.42; }
      else if (theme === 'alpine') { r = 0.52; g = 0.46; b = 0.38; }
      else { r = 0.56; g = 0.49; b = 0.37; }
    }
    const startScl = isRainSpray ? 0.55 : 0.48 + intensity * 0.25;
    const endScl = isRainSpray ? 2.45 : isOffTrack ? 2.65 : 2.25 + intensity * 0.85;
    this.smoke.spawn(
      pos.x + (Math.random() - 0.5) * 0.32,
      pos.y + 0.16,
      pos.z + (Math.random() - 0.5) * 0.32,
      backDir.x * (2.5 + Math.random() * 3.0) + (Math.random() - 0.5) * 2.4,
      (isRainSpray ? 2.2 : 1.0) + Math.random() * 1.5,
      backDir.z * (2.5 + Math.random() * 3.0) + (Math.random() - 0.5) * 2.4,
      r, g, b,
      isRainSpray ? 0.34 + Math.random() * 0.25 : 0.52 + Math.random() * 0.38,
      startScl,
      endScl
    );
  }

  /**
   * Emits torn grass blades, dirt clods, and gravel stones kicked up by off-track tires!
   */
  emitOffTrackClods(pos: THREE.Vector3, backDir: THREE.Vector3, theme: string, carSpeed: number) {
    const count = carSpeed > 45 ? 3 : 2;
    const kickSpd = Math.min(18, carSpeed * 0.28);
    for (let i = 0; i < count; i++) {
      const isGrass = theme !== 'desert' && theme !== 'city' && Math.random() < 0.58;
      let r: number, g: number, b: number;
      if (isGrass) {
        r = 0.22 + Math.random() * 0.12;
        g = 0.46 + Math.random() * 0.18;
        b = 0.14 + Math.random() * 0.08;
      } else if (theme === 'desert') {
        r = 0.82 + Math.random() * 0.10;
        g = 0.60 + Math.random() * 0.10;
        b = 0.34 + Math.random() * 0.08;
      } else {
        // Dark earth / gravel clod
        r = 0.34 + Math.random() * 0.10;
        g = 0.27 + Math.random() * 0.08;
        b = 0.19 + Math.random() * 0.06;
      }

      this.debris.spawn(
        pos.x + (Math.random() - 0.5) * 0.32,
        pos.y + 0.12,
        pos.z + (Math.random() - 0.5) * 0.32,
        backDir.x * kickSpd + (Math.random() - 0.5) * 3.8,
        2.4 + Math.random() * 4.8,
        backDir.z * kickSpd + (Math.random() - 0.5) * 3.8,
        r, g, b,
        0.38 + Math.random() * 0.32,
        0.65 + Math.random() * 0.55,
        0.35,
        pos.y
      );
    }
  }

  updateForCars(cars: CarState[], track: TrackData, weather: WeatherType, focusPos: THREE.Vector3, dt: number) {
    const backDir = this._backDir;
    const wheelPos = this._wheelPos;
    const theme = track.config.theme;

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const sinY = Math.sin(car.yaw);
      const cosY = Math.cos(car.yaw);
      const rightX = -cosY;
      const rightZ = sinY;
      backDir.set(-sinY, 0, -cosY);
      const absSpd = Math.abs(car.speed);

      // 1. Titanium underfloor plank sparks (> 225 km/h compression, porpoising, or curb strikes)
      if (car.speed > 60 && !car.offTrack) {
        const lowFloor = car.rideHeightR < 17.5 ? 0.35 : 0;
        const sparkChance = car.onCurb ? 0.92 : (car.speed > 76 ? 0.52 + lowFloor : 0.22);
        if (Math.random() < sparkChance) {
          wheelPos.set(car.pos.x - sinY * 0.85, car.pos.y, car.pos.z - cosY * 0.85);
          this.emitSparks(wheelPos, backDir, car.onCurb ? 6 : 3, car.speed * 0.25);
        }
      }

      // 2. Curb strike dust puffs when riding sausage curbs at speed
      if (car.onCurb && absSpd > 32 && Math.random() < 0.45) {
        const curbSide = car._tInfo.lateral >= 0 ? 0.95 : -0.95;
        wheelPos.set(car.pos.x + rightX * curbSide, car.pos.y, car.pos.z + rightZ * curbSide);
        this.emitTireSmoke(wheelPos, backDir, false, theme, false, 0.55);
      }

      // 3. Wall impact sparks & carbon shards
      if (car.wallImpact > 0.14) {
        this.emitCollisionBurst(car.pos, car.wallImpact);
      }

      // 4. Front lockup smoke + glowing carbon-brake rotor dust embers + persistent asphalt skidmarks!
      if (car.frontLockup > 0.18 && absSpd > 12 && !car.offTrack) {
        for (const side of [-0.94, 0.94]) {
          const wx = car.pos.x + sinY * 1.72 + rightX * side;
          const wz = car.pos.z + cosY * 1.72 + rightZ * side;
          track.addSkidmark(wx, car.pos.y, wz, car.yaw, car.frontLockup);
          if (Math.random() < 0.82) {
            wheelPos.set(wx, car.pos.y, wz);
            this.emitTireSmoke(wheelPos, backDir, false, theme, false, car.frontLockup);
          }
        }
      }

      // Glowing incandescent carbon-brake dust under heavy braking zones (> 640°C)
      if (car.brakeInput > 0.65 && car.brakeTemp > 620 && absSpd > 28 && Math.random() < 0.65) {
        for (const side of [-0.92, 0.92]) {
          const wx = car.pos.x + sinY * 1.68 + rightX * side;
          const wz = car.pos.z + cosY * 1.68 + rightZ * side;
          this.sparks.spawn(
            wx, car.pos.y + 0.28, wz,
            backDir.x * (absSpd * 0.18) + (Math.random() - 0.5) * 2.2,
            0.6 + Math.random() * 1.8,
            backDir.z * (absSpd * 0.18) + (Math.random() - 0.5) * 2.2,
            2.4, 0.72, 0.12,
            0.16 + Math.random() * 0.16,
            0.55, 0.15, car.pos.y
          );
        }
      }

      // 5. Rear wheelspin / drift / launch burnout smoke + Off-Track Grass Blades, Dirt Clods & Dust Plumes!
      const isDrifting = Math.abs(car.lateralSpeed) > 3.2 && absSpd > 14;
      if ((car.slipRatio > 0.36 && absSpd > 8) || isDrifting || (car.offTrack && absSpd > 10)) {
        for (const side of [-0.96, 0.96]) {
          const wx = car.pos.x - sinY * 1.70 + rightX * side;
          const wz = car.pos.z - cosY * 1.70 + rightZ * side;
          if (!car.offTrack && (car.slipRatio > 0.42 || isDrifting)) {
            track.addSkidmark(wx, car.pos.y, wz, car.yaw, Math.max(car.slipRatio, 0.55));
          }
          wheelPos.set(wx, car.pos.y, wz);
          if (Math.random() < 0.78) {
            this.emitTireSmoke(wheelPos, backDir, car.offTrack, theme, false, Math.max(car.slipRatio, 0.7));
          }
          if (car.offTrack && Math.random() < 0.75) {
            this.emitOffTrackClods(wheelPos, backDir, theme, absSpd);
          }
        }
        // Front tires also kick up grass/dirt when steering off-track
        if (car.offTrack && absSpd > 18 && Math.random() < 0.55) {
          for (const side of [-0.94, 0.94]) {
            wheelPos.set(car.pos.x + sinY * 1.70 + rightX * side, car.pos.y, car.pos.z + cosY * 1.70 + rightZ * side);
            this.emitOffTrackClods(wheelPos, backDir, theme, absSpd * 0.8);
          }
        }
      }

      // 6. High-G Cornering Tire Marble Shedding & Aero Rear-Wingtip Condensation Vortices!
      if (!car.offTrack && absSpd > 58) {
        if (Math.abs(car.gLat) > 2.6 && Math.random() < 0.35) {
          // Shed hot rubber marble from loaded outer rear tire
          const outerSide = car.gLat > 0 ? 0.96 : -0.96;
          this.debris.spawn(
            car.pos.x - sinY * 1.75 + rightX * outerSide,
            car.pos.y + 0.14,
            car.pos.z - cosY * 1.75 + rightZ * outerSide,
            backDir.x * (absSpd * 0.22) + (Math.random() - 0.5) * 2.5,
            1.2 + Math.random() * 2.2,
            backDir.z * (absSpd * 0.22) + (Math.random() - 0.5) * 2.5,
            0.12, 0.12, 0.14,
            0.45 + Math.random() * 0.25,
            0.45, 0.35, car.pos.y
          );
        }

        // Wingtip pressure-drop condensation vortex trails (> 250 km/h or humid/high-G)
        if ((absSpd > 70 || weather === 'rain') && !car.drsActive && Math.random() < 0.68) {
          for (const tipSide of [-0.52, 0.52]) {
            this.vortex.spawn(
              car.pos.x - sinY * 2.38 + rightX * tipSide,
              car.pos.y + 0.88,
              car.pos.z - cosY * 2.38 + rightZ * tipSide,
              backDir.x * (absSpd * 0.15),
              0.15 + (Math.random() - 0.5) * 0.3,
              backDir.z * (absSpd * 0.15),
              0.85, 0.92, 1.0,
              0.14 + Math.random() * 0.08,
              0.38, 1.15
            );
          }
        }
      }

      // 7. Dense Wet Weather Rooster-Tail Water Spray & Diffuser Plume!
      if (weather === 'rain' && car.speed > 22 && !car.inTunnel) {
        if (Math.random() < 0.82) {
          for (const side of [-0.92, 0.92]) {
            wheelPos.set(car.pos.x - sinY * 2.1 + rightX * side, car.pos.y + 0.18, car.pos.z - cosY * 2.1 + rightZ * side);
            this.emitTireSmoke(wheelPos, backDir, false, theme, true, 1.1);
          }
          // Central Venturi diffuser upwash rooster-tail plume
          wheelPos.set(car.pos.x - sinY * 2.45, car.pos.y + 0.32, car.pos.z - cosY * 2.45);
          this.emitTireSmoke(wheelPos, backDir, false, theme, true, 1.35);
        }
      }

      // 8. HDR Violet-Cyan-Gold Backfire Afterburner Plume from Central Triple Exhaust!
      const isOverrunPop = car.rpm > 10200 && car.throttleInput < 0.25 && Math.random() < 0.52;
      const isHighRpmFlame = car.rpm > 11300 && Math.random() < 0.72;
      if (car.justShifted || car.justDownshifted || car.shiftFlameTimer > 0 || isOverrunPop || isHighRpmFlame) {
        const burstCount = car.justShifted || car.justDownshifted ? 12 : 4;
        const exhX = car.pos.x - sinY * 2.34;
        const exhY = car.pos.y + 0.37;
        const exhZ = car.pos.z - cosY * 2.34;
        for (let k = 0; k < burstCount; k++) {
          const pipeIdx = k % 3;
          const offLat = pipeIdx === 0 ? 0 : (pipeIdx === 1 ? -0.055 : 0.055);
          const offY = pipeIdx === 0 ? 0.015 : -0.022;
          const jetSpd = car.speed * 0.35 + 12 + Math.random() * 10;
          const isCore = k % 2 === 0;
          this.flames.spawn(
            exhX + rightX * offLat + (Math.random() - 0.5) * 0.03,
            exhY + offY + (Math.random() - 0.5) * 0.03,
            exhZ + rightZ * offLat + (Math.random() - 0.5) * 0.03,
            -sinY * jetSpd + (Math.random() - 0.5) * 1.4,
            (Math.random() - 0.3) * 0.9,
            -cosY * jetSpd + (Math.random() - 0.5) * 1.4,
            isCore ? 2.9 : 2.4,
            isCore ? 1.55 : 0.35,
            isCore ? 3.2 : 1.95,
            0.07 + Math.random() * 0.08,
            0.95,
            0.25
          );
        }
      }
    }

    // Update falling rain volume centered on player
    if (this.rainPoints && this.rainPositions) {
      const rp = this.rainPositions;
      for (let i = 0; i < rp.length; i += 3) {
        rp[i + 1] -= 44 * dt;
        if (rp[i + 1] < focusPos.y - 2) {
          rp[i] = focusPos.x + (Math.random() - 0.5) * 90;
          rp[i + 1] = focusPos.y + 22 + Math.random() * 22;
          rp[i + 2] = focusPos.z + (Math.random() - 0.5) * 90;
        }
      }
      this.rainPoints.geometry.attributes.position.needsUpdate = true;
    }

    this.sparks.update(dt, -17.5, 1.35, { bounceRestitution: 0.48, thermalCool: true });
    this.smoke.update(dt, 1.35, 2.1, { turbulence: 3.2 });
    this.debris.update(dt, -16.0, 1.1, { bounceRestitution: 0.38 });
    this.flames.update(dt, 0.9, 3.8);
    this.vortex.update(dt, 0.4, 2.8, { turbulence: 1.5 });
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.sparks.dispose();
    this.smoke.dispose();
    this.debris.dispose();
    this.flames.dispose();
    this.vortex.dispose();
    this.sparkTex.dispose();
    this.cloudTex.dispose();
    this.shardTex.dispose();
    if (this.rainPoints) {
      this.rainPoints.geometry.dispose();
      (this.rainPoints.material as THREE.Material).dispose();
    }
  }
}
