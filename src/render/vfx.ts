/**
 * APEX GP 3D — GPU-Friendly Pooled VFX & Dynamic Rain System
 * Renders HDR titanium sparks, tire smoke, wet rain spray, off-track dust,
 * collision bursts, exhaust overrun embers, and falling rain streaks with zero GC.
 */
import * as THREE from 'three';
import type { CarState, TrackData, WeatherType } from '../core/types';

function createSoftParticleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.82)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

class ParticlePool {
  max: number;
  cursor = 0;
  positions: Float32Array;
  colors: Float32Array;
  velX: Float32Array;
  velY: Float32Array;
  velZ: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  baseR: Float32Array;
  baseG: Float32Array;
  baseB: Float32Array;
  points: THREE.Points;

  constructor(
    maxCount: number,
    tex: THREE.CanvasTexture,
    { size = 1.0, blending = THREE.AdditiveBlending as THREE.Blending, depthWrite = false, hdr = false }: {
      size?: number;
      blending?: THREE.Blending;
      depthWrite?: boolean;
      hdr?: boolean;
    } = {}
  ) {
    this.max = maxCount;
    this.positions = new Float32Array(maxCount * 3);
    this.colors = new Float32Array(maxCount * 3);
    this.velX = new Float32Array(maxCount);
    this.velY = new Float32Array(maxCount);
    this.velZ = new Float32Array(maxCount);
    this.life = new Float32Array(maxCount);
    this.maxLife = new Float32Array(maxCount);
    this.baseR = new Float32Array(maxCount);
    this.baseG = new Float32Array(maxCount);
    this.baseB = new Float32Array(maxCount);

    for (let i = 0; i < maxCount; i++) this.positions[i * 3 + 1] = -9999;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    const mat = new THREE.PointsMaterial({
      size,
      map: tex,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending,
      depthWrite,
      sizeAttenuation: true,
      toneMapped: !hdr
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, lifeSec: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.velX[i] = vx;
    this.velY[i] = vy;
    this.velZ[i] = vz;
    this.life[i] = lifeSec;
    this.maxLife[i] = lifeSec;
    this.baseR[i] = r;
    this.baseG[i] = g;
    this.baseB[i] = b;
    this.colors[i * 3] = r;
    this.colors[i * 3 + 1] = g;
    this.colors[i * 3 + 2] = b;
  }

  update(dt: number, gravity = -12, drag = 1.5) {
    const pos = this.positions;
    const col = this.colors;
    const damp = Math.max(0, 1 - drag * dt);

    for (let i = 0; i < this.max; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const nl = l - dt;
      this.life[i] = nl;
      if (nl <= 0) {
        pos[i * 3 + 1] = -9999;
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
        continue;
      }
      this.velX[i] *= damp;
      this.velY[i] = this.velY[i] * damp + gravity * dt;
      this.velZ[i] *= damp;
      pos[i * 3] += this.velX[i] * dt;
      pos[i * 3 + 1] += this.velY[i] * dt;
      pos[i * 3 + 2] += this.velZ[i] * dt;
      const fade = nl / this.maxLife[i];
      col[i * 3] = this.baseR[i] * fade;
      col[i * 3 + 1] = this.baseG[i] * fade;
      col[i * 3 + 2] = this.baseB[i] * fade;
    }

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

export class VFXManager {
  private group = new THREE.Group();
  private sharedTex: THREE.CanvasTexture;
  private sparks: ParticlePool;
  private smoke: ParticlePool;
  private flames: ParticlePool;
  private rainPoints: THREE.Points | null = null;
  private rainPositions: Float32Array | null = null;

  private _backDir = new THREE.Vector3();
  private _wheelPos = new THREE.Vector3();

  constructor(scene: THREE.Scene, weather: WeatherType) {
    this.sharedTex = createSoftParticleTexture();
    this.sparks = new ParticlePool(750, this.sharedTex, { size: 0.52, blending: THREE.AdditiveBlending, hdr: true });
    this.smoke = new ParticlePool(550, this.sharedTex, { size: 1.85, blending: THREE.NormalBlending });
    this.flames = new ParticlePool(450, this.sharedTex, { size: 0.44, blending: THREE.AdditiveBlending, hdr: true });

    this.group.add(this.sparks.points, this.smoke.points, this.flames.points);

    if (weather === 'rain') {
      const rainCount = 900;
      this.rainPositions = new Float32Array(rainCount * 3);
      for (let i = 0; i < rainCount; i++) {
        this.rainPositions[i * 3] = (Math.random() - 0.5) * 90;
        this.rainPositions[i * 3 + 1] = Math.random() * 40;
        this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 90;
      }
      const rGeo = new THREE.BufferGeometry();
      rGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
      const rMat = new THREE.PointsMaterial({
        color: '#b8d4ee',
        size: 0.22,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
      });
      this.rainPoints = new THREE.Points(rGeo, rMat);
      this.rainPoints.frustumCulled = false;
      this.group.add(this.rainPoints);
    }

    scene.add(this.group);
  }

  emitSparks(pos: THREE.Vector3, backDir: THREE.Vector3, count = 4, speed = 16) {
    for (let i = 0; i < count; i++) {
      this.sparks.spawn(
        pos.x + (Math.random() - 0.5) * 0.55,
        pos.y + 0.14,
        pos.z + (Math.random() - 0.5) * 0.55,
        backDir.x * speed + (Math.random() - 0.5) * 4.5,
        1.4 + Math.random() * 4.5,
        backDir.z * speed + (Math.random() - 0.5) * 4.5,
        1.6, 0.9 + Math.random() * 0.5, 0.2,
        0.22 + Math.random() * 0.25
      );
    }
  }

  emitCollisionBurst(pos: THREE.Vector3, intensity = 1) {
    const count = Math.floor(14 + intensity * 22);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (4 + Math.random() * 14) * intensity;
      this.sparks.spawn(
        pos.x, pos.y + 0.35, pos.z,
        Math.cos(a) * spd, 3 + Math.random() * 7, Math.sin(a) * spd,
        1.8, 1.1 + Math.random() * 0.4, 0.25,
        0.28 + Math.random() * 0.32
      );
    }
  }

  emitTireSmoke(pos: THREE.Vector3, isOffTrack = false, theme = 'monza', isRainSpray = false) {
    let r = 0.85, g = 0.87, b = 0.90;
    if (isRainSpray) {
      r = 0.72; g = 0.80; b = 0.88;
    } else if (isOffTrack) {
      if (theme === 'desert') { r = 0.86; g = 0.62; b = 0.38; }
      else { r = 0.54; g = 0.47; b = 0.35; }
    }
    this.smoke.spawn(
      pos.x + (Math.random() - 0.5) * 0.35,
      pos.y + 0.22,
      pos.z + (Math.random() - 0.5) * 0.35,
      (Math.random() - 0.5) * 2.2,
      (isRainSpray ? 2.1 : 1.1) + Math.random() * 1.4,
      (Math.random() - 0.5) * 2.2,
      r, g, b,
      isRainSpray ? 0.28 + Math.random() * 0.22 : 0.42 + Math.random() * 0.32
    );
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

      // 1. Titanium floor sparks (> 234 km/h or on curbs)
      if (car.speed > 65 && !car.offTrack) {
        const sparkChance = car.onCurb ? 0.85 : car.speed > 78 ? 0.42 : 0.16;
        if (Math.random() < sparkChance) {
          wheelPos.set(car.pos.x - sinY * 0.9, car.pos.y, car.pos.z - cosY * 0.9);
          this.emitSparks(wheelPos, backDir, car.onCurb ? 4 : 2, car.speed * 0.22);
        }
      }

      // 2. Wall impact sparks
      if (car.wallImpact > 0.15) {
        this.emitCollisionBurst(car.pos, car.wallImpact);
      }

      // 3. Front lockup smoke + persistent asphalt skidmarks!
      if (car.frontLockup > 0.22 && Math.abs(car.speed) > 14 && !car.offTrack) {
        for (const side of [-0.94, 0.94]) {
          const wx = car.pos.x + sinY * 1.72 + rightX * side;
          const wz = car.pos.z + cosY * 1.72 + rightZ * side;
          track.addSkidmark(wx, car.pos.y, wz, car.yaw, car.frontLockup);
          if (Math.random() < 0.65) {
            wheelPos.set(wx, car.pos.y, wz);
            this.emitTireSmoke(wheelPos, false, theme, false);
          }
        }
      }

      // 4. Rear wheelspin / oversteer smoke + skidmarks, or off-track dust
      if ((car.slipRatio > 0.44 && Math.abs(car.speed) > 12) || (car.offTrack && Math.abs(car.speed) > 16)) {
        for (const side of [-0.96, 0.96]) {
          const wx = car.pos.x - sinY * 1.70 + rightX * side;
          const wz = car.pos.z - cosY * 1.70 + rightZ * side;
          if (!car.offTrack && car.slipRatio > 0.48) {
            track.addSkidmark(wx, car.pos.y, wz, car.yaw, car.slipRatio);
          }
          if (Math.random() < 0.55) {
            wheelPos.set(wx, car.pos.y, wz);
            this.emitTireSmoke(wheelPos, car.offTrack, theme, false);
          }
        }
      }

      // 5. Wet Weather Rooster-Tail Water Spray!
      if (weather === 'rain' && car.speed > 26 && !car.inTunnel) {
        if (Math.random() < 0.55) {
          for (const side of [-0.92, 0.92]) {
            wheelPos.set(car.pos.x - sinY * 2.1 + rightX * side, car.pos.y + 0.15, car.pos.z - cosY * 2.1 + rightZ * side);
            this.emitTireSmoke(wheelPos, false, theme, true);
          }
        }
      }

      // 6. Niagara-style HDR Pink-Purple / Violet-Magenta Backfire Particle Plume from Central Triple Exhaust!
      const isOverrunPop = car.rpm > 10200 && car.throttleInput < 0.25 && Math.random() < 0.45;
      const isHighRpmFlame = car.rpm > 11300 && Math.random() < 0.65;
      if (car.justShifted || car.shiftFlameTimer > 0 || isOverrunPop || isHighRpmFlame) {
        const burstCount = car.justShifted ? 10 : 3;
        const exhX = car.pos.x - sinY * 2.34;
        const exhY = car.pos.y + 0.37;
        const exhZ = car.pos.z - cosY * 2.34;
        for (let k = 0; k < burstCount; k++) {
          // Alternate between central main pipe and dual upper/side wastegate pipes (Central Triple Exhaust)
          const pipeIdx = k % 3;
          const offLat = pipeIdx === 0 ? 0 : (pipeIdx === 1 ? -0.055 : 0.055);
          const offY = pipeIdx === 0 ? 0.015 : -0.022;
          const jetSpd = car.speed * 0.35 + 11 + Math.random() * 9;
          const isCore = k % 2 === 0;
          this.flames.spawn(
            exhX + rightX * offLat + (Math.random() - 0.5) * 0.03,
            exhY + offY + (Math.random() - 0.5) * 0.03,
            exhZ + rightZ * offLat + (Math.random() - 0.5) * 0.03,
            -sinY * jetSpd + (Math.random() - 0.5) * 1.4,
            (Math.random() - 0.3) * 0.9,
            -cosY * jetSpd + (Math.random() - 0.5) * 1.4,
            isCore ? 2.8 : 2.35,
            isCore ? 1.45 : 0.24,
            isCore ? 3.1 : 1.85,
            0.065 + Math.random() * 0.075
          );
        }
      }
    }

    // Update falling rain volume centered on player
    if (this.rainPoints && this.rainPositions) {
      const rp = this.rainPositions;
      for (let i = 0; i < rp.length; i += 3) {
        rp[i + 1] -= 42 * dt;
        if (rp[i + 1] < focusPos.y - 2) {
          rp[i] = focusPos.x + (Math.random() - 0.5) * 90;
          rp[i + 1] = focusPos.y + 22 + Math.random() * 22;
          rp[i + 2] = focusPos.z + (Math.random() - 0.5) * 90;
        }
      }
      this.rainPoints.geometry.attributes.position.needsUpdate = true;
    }

    this.sparks.update(dt, -16, 1.4);
    this.smoke.update(dt, 1.2, 2.2);
    this.flames.update(dt, 0.8, 3.8);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.sparks.dispose();
    this.smoke.dispose();
    this.flames.dispose();
    this.sharedTex.dispose();
    if (this.rainPoints) {
      this.rainPoints.geometry.dispose();
      (this.rainPoints.material as THREE.Material).dispose();
    }
  }
}
