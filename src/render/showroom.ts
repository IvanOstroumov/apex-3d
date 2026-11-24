/**
 * APEX GP 3D — AAA Interactive Garage Showroom
 * Features a real planar Reflector floor, studio softbox lighting,
 * mouse-drag orbit + scroll zoom, DRS/steering showcase, and ZERO GPU memory leaks.
 */
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { TeamConfig } from '../core/types';
import { buildF1Car, type F1CarVisual } from './carBuilder';
import { getCarbonTexture } from './textures';
import { disposeObject3D } from '../core/disposer';

export class ShowroomStage {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;

  public group = new THREE.Group();
  private turntable = new THREE.Group();
  private currentCarVis: F1CarVisual | null = null;
  private ledRingMat!: THREE.MeshStandardMaterial;
  private accentPoint!: THREE.PointLight;

  private orbitAngle = 0.62;
  private orbitPitch = 0.22;
  private orbitDist = 6.6;
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private drsShowcaseTimer = 0;
  private camTargetPos = new THREE.Vector3();

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;

    this.group.add(this.turntable);
    this._buildStage();
    this._bindPointer();
    scene.add(this.group);
  }

  private _buildStage(): void {
    const carbonTex = getCarbonTexture();

    // 1. Real-time Planar Mirror Reflector Floor + sleek dark glossy tint overlay
    const mirrorGeo = new THREE.CircleGeometry(34, 64);
    const reflector = new Reflector(mirrorGeo, {
      clipBias: 0.003,
      textureWidth: 512,
      textureHeight: 512,
      color: 0x384357
    });
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.y = -0.265;
    this.group.add(reflector);

    const floorOverlay = new THREE.Mesh(
      new THREE.CircleGeometry(34, 64),
      new THREE.MeshStandardMaterial({
        color: '#080b12',
        roughness: 0.16,
        metalness: 0.72,
        transparent: true,
        opacity: 0.68
      })
    );
    floorOverlay.rotation.x = -Math.PI / 2;
    floorOverlay.position.y = -0.258;
    floorOverlay.receiveShadow = true;
    this.group.add(floorOverlay);

    for (const r of [6.2, 11.2]) {
      const floorRing = new THREE.Mesh(
        new THREE.RingGeometry(r, r + 0.05, 64),
        new THREE.MeshBasicMaterial({ color: '#26344d', side: THREE.DoubleSide })
      );
      floorRing.rotation.x = -Math.PI / 2;
      floorRing.position.y = -0.24;
      this.group.add(floorRing);
    }

    // 2. Rotating Carbon Turntable
    const baseMat = new THREE.MeshStandardMaterial({
      map: carbonTex,
      color: '#1e242e',
      roughness: 0.34,
      metalness: 0.58
    });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(3.85, 4.12, 0.25, 64), baseMat);
    platform.position.y = -0.125;
    platform.receiveShadow = true;
    this.turntable.add(platform);

    // HDR Team-colored Neon Turntable Ring (triggers Selective Bloom!)
    this.ledRingMat = new THREE.MeshStandardMaterial({
      color: '#ff1e16',
      emissive: '#ff1e16',
      emissiveIntensity: 2.2,
      toneMapped: false
    });
    const ledRing = new THREE.Mesh(new THREE.TorusGeometry(3.92, 0.048, 12, 72), this.ledRingMat);
    ledRing.rotation.x = Math.PI / 2;
    ledRing.position.y = -0.02;
    this.turntable.add(ledRing);

    // Studio Softbox Light Strips overhead
    const softboxMat = new THREE.MeshBasicMaterial({ color: '#f2f7ff', toneMapped: false });
    for (let i = -1; i <= 1; i++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.08, 0.72), softboxMat);
      panel.position.set(0, 6.2, i * 2.2);
      this.group.add(panel);
    }

    // 3. Dramatic Studio 3-Point Lighting
    const keySpot = new THREE.SpotLight('#ffffff', 110, 34, Math.PI * 0.35, 0.48, 1.3);
    keySpot.position.set(4.8, 9.0, 5.2);
    keySpot.castShadow = true;
    keySpot.shadow.mapSize.set(1024, 1024);
    keySpot.shadow.bias = -0.0004;
    this.group.add(keySpot);
    this.group.add(keySpot.target);

    const rimCool = new THREE.DirectionalLight('#6eb8ff', 1.6);
    rimCool.position.set(-7, 4.5, -5);
    this.group.add(rimCool);

    const rimWarm = new THREE.DirectionalLight('#ffbe78', 1.2);
    rimWarm.position.set(7, 3.2, -4);
    this.group.add(rimWarm);

    this.accentPoint = new THREE.PointLight('#ff1e16', 5, 12, 1.8);
    this.accentPoint.position.set(0, 0.8, 3.6);
    this.group.add(this.accentPoint);

    this.group.add(new THREE.HemisphereLight('#b5d4ff', '#101420', 0.95));
  }

  private _bindPointer(): void {
    window.addEventListener('pointerdown', (e) => {
      if (!this.group.visible || e.target !== this.domElement) return;
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.isDragging || !this.group.visible) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.orbitAngle -= dx * 0.0085;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.0045, 0.08, 0.62);
    });
    window.addEventListener('pointerup', () => {
      this.isDragging = false;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.group.visible || e.target !== this.domElement) return;
      this.orbitDist = THREE.MathUtils.clamp(this.orbitDist + e.deltaY * 0.004, 4.5, 9.5);
    }, { passive: true });
  }

  setTeam(team: TeamConfig, tireBandColor?: string): void {
    if (this.currentCarVis) {
      this.turntable.remove(this.currentCarVis.root);
      disposeObject3D(this.currentCarVis.root); // ZERO GPU memory leak!
      this.currentCarVis = null;
    }

    this.currentCarVis = buildF1Car(team, { tireBandColor, isPlayer: false, forceHeroLod: true });
    this.turntable.add(this.currentCarVis.root);

    const glowColor = team.id === 'monster' ? '#39ff14'
      : team.id === 'mercedes' ? '#00d2be'
      : team.id === 'redbull' ? '#ffd300'
      : team.id === 'mcdonalds' ? '#ffc72c'
      : '#ff1e16';
    this.ledRingMat.color.set(glowColor);
    this.ledRingMat.emissive.set(glowColor);
    this.accentPoint.color.set(glowColor);
    this.drsShowcaseTimer = 1.6;
  }

  setVisible(visible: boolean, studioEnv?: THREE.Texture): void {
    this.group.visible = visible;
    if (visible) {
      this.scene.background = new THREE.Color('#070a12');
      this.scene.fog = new THREE.FogExp2('#070a12', 0.026);
      if (studioEnv) this.scene.environment = studioEnv;
    }
  }

  update(dt: number, nowMs: number): void {
    if (!this.group.visible) return;

    if (!this.isDragging) {
      this.turntable.rotation.y += dt * 0.30;
    }

    if (this.currentCarVis) {
      this.drsShowcaseTimer = Math.max(0, this.drsShowcaseTimer - dt);
      const drsTarget = this.drsShowcaseTimer > 0.4 ? -0.42 : 0;
      this.currentCarVis.drsFlapGroup.rotation.x +=
        (drsTarget - this.currentCarVis.drsFlapGroup.rotation.x) * Math.min(1, dt * 8);
      const steerDemo = Math.sin(nowMs * 0.0009) * 0.16;
      for (const p of this.currentCarVis.frontWheelPivots) {
        p.rotation.y = steerDemo;
      }
      this.currentCarVis.rainLightMat.emissiveIntensity = Math.sin(nowMs * 0.01) > 0 ? 2.8 : 0.4;
    }

    const camX = Math.sin(this.orbitAngle) * Math.cos(this.orbitPitch) * this.orbitDist;
    const camY = 0.80 + Math.sin(this.orbitPitch) * this.orbitDist;
    const camZ = Math.cos(this.orbitAngle) * Math.cos(this.orbitPitch) * this.orbitDist;
    this.camTargetPos.set(camX, camY, camZ);

    this.camera.position.lerp(this.camTargetPos, Math.min(1, dt * 7));
    this.camera.lookAt(0, 0.52, 0.12);
    this.camera.fov += (45 - this.camera.fov) * Math.min(1, dt * 6);
    this.camera.updateProjectionMatrix();
  }
}
