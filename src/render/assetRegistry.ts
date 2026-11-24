/**
 * APEX GP 3D — Forza Horizon 6 Next-Gen Asset Registry
 * Preloads & caches:
 *  1. Real 32-bit Photographed CC0 .HDR Skies (Poly Haven / Three.js) -> Hybrid Automotive PMREM Probes
 *  2. Real Photogrammetry-Scanned CC0 PBR Material Packs (Albedo + NormalGL + Packed ORM)
 *  3. Meshopt-Compressed Headless Blender 4.0.2 Subdivided .GLB 3D Assets (LOD0/LOD1 F1 Cars, GT Safety Car, H135 Heli, Cliffs & 3D Grass)
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { markShared } from '../core/disposer';

export interface ScannedPBRPack {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  orm: THREE.Texture; // R = Ambient Occlusion, G = Roughness, B = Metalness
}

export type PBRMaterialKey = 'asphalt' | 'grass' | 'rock' | 'stonewall' | 'bark' | 'sand';
export type HDRIKey = 'monza' | 'alpine' | 'desert' | 'city' | 'studio';

export interface PremergedF1LodTemplate {
  byMat: Record<string, THREE.BufferGeometry>;
  haloGeo: THREE.BufferGeometry | null;
  frontWingByMat: Record<string, THREE.BufferGeometry>;
  drsFlapGeo: THREE.BufferGeometry | null;
  steerWheelByMat: Record<string, THREE.BufferGeometry>;
  wheels: Record<'FL' | 'FR' | 'RL' | 'RR', {
    tireGeo: THREE.BufferGeometry;
    rimGeo: THREE.BufferGeometry;
    sideGeo: THREE.BufferGeometry;
    discGeo: THREE.BufferGeometry;
  }>;
}

export interface PremergedSafetyCarTemplate {
  byMat: Record<string, THREE.BufferGeometry>;
  lightbarGeo: THREE.BufferGeometry | null;
}

export interface PremergedHelicopterTemplate {
  byMat: Record<string, THREE.BufferGeometry>;
  rotorGeo: THREE.BufferGeometry | null;
  rotorPos: THREE.Vector3;
}

/**
 * Converts Meshopt / KHR_mesh_quantization Int16/Uint16/Int8 attributes into clean IEEE-754 Float32Arrays
 * BEFORE any `.applyMatrix4()` or `mergeGeometries()` call so Three.js never truncates sub-meter floats into integers!
 */
function dequantizeToFloat32(raw: THREE.BufferGeometry, keepColor = false): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const posAttr = raw.getAttribute('position');
  const count = posAttr.count;

  const posArr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    posArr[i * 3] = posAttr.getX(i);
    posArr[i * 3 + 1] = posAttr.getY(i);
    posArr[i * 3 + 2] = posAttr.getZ(i);
  }
  out.setAttribute('position', new THREE.BufferAttribute(posArr, 3));

  const normAttr = raw.getAttribute('normal');
  if (normAttr) {
    const normArr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      normArr[i * 3] = normAttr.getX(i);
      normArr[i * 3 + 1] = normAttr.getY(i);
      normArr[i * 3 + 2] = normAttr.getZ(i);
    }
    out.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
  }

  const uvAttr = raw.getAttribute('uv');
  const uvArr = new Float32Array(count * 2);
  if (uvAttr) {
    for (let i = 0; i < count; i++) {
      uvArr[i * 2] = uvAttr.getX(i);
      uvArr[i * 2 + 1] = uvAttr.getY(i);
    }
  }
  out.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));

  if (keepColor) {
    const colAttr = raw.getAttribute('color');
    const colArr = new Float32Array(count * 3);
    if (colAttr) {
      for (let i = 0; i < count; i++) {
        colArr[i * 3] = colAttr.getX(i);
        colArr[i * 3 + 1] = colAttr.getY(i);
        colArr[i * 3 + 2] = colAttr.getZ(i);
      }
    } else {
      colArr.fill(1.0);
    }
    out.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  }

  if (raw.index) {
    const idxAttr = raw.index;
    const idxArr = new Uint32Array(idxAttr.count);
    for (let i = 0; i < idxAttr.count; i++) idxArr[i] = idxAttr.getX(i);
    out.setIndex(new THREE.BufferAttribute(idxArr, 1));
  } else {
    const idxArr = new Uint32Array(count);
    for (let i = 0; i < count; i++) idxArr[i] = i;
    out.setIndex(new THREE.BufferAttribute(idxArr, 1));
  }

  if (!normAttr) out.computeVertexNormals();
  return out;
}

class FH6AssetRegistry {
  public loaded = false;
  public hdriEquirect = new Map<HDRIKey, THREE.DataTexture>();
  public pmremProbes = new Map<string, THREE.Texture>();
  public pbr = new Map<PBRMaterialKey, ScannedPBRPack>();

  public f1Lod0: PremergedF1LodTemplate | null = null;
  public f1Lod1: PremergedF1LodTemplate | null = null;
  public safetyCarGltf: THREE.Group | null = null;
  public safetyCarPremerged: PremergedSafetyCarTemplate | null = null;
  public helicopterGltf: THREE.Group | null = null;
  public helicopterPremerged: PremergedHelicopterTemplate | null = null;
  public cliffBoulderA: THREE.BufferGeometry | null = null;
  public cliffBoulderB: THREE.BufferGeometry | null = null;
  public wildGrassClump: THREE.BufferGeometry | null = null;

  private _loadPromise: Promise<void> | null = null;

  public preloadAll(renderer: THREE.WebGLRenderer): Promise<void> {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = this._doPreload(renderer);
    return this._loadPromise;
  }

  private async _doPreload(renderer: THREE.WebGLRenderer): Promise<void> {
    const maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    const texLoader = new THREE.TextureLoader();
    const rgbeLoader = new RGBELoader();
    const gltfLoader = new GLTFLoader();
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);

    const loadTex = (url: string, srgb: boolean): Promise<THREE.Texture> =>
      new Promise((resolve, reject) => {
        texLoader.load(
          url,
          (t) => {
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            t.anisotropy = maxAniso;
            t.needsUpdate = true;
            resolve(markShared(t));
          },
          undefined,
          reject
        );
      });

    const loadHdr = (url: string): Promise<THREE.DataTexture> =>
      new Promise((resolve, reject) => {
        rgbeLoader.load(
          url,
          (tex) => {
            tex.mapping = THREE.EquirectangularReflectionMapping;
            resolve(markShared(tex));
          },
          undefined,
          reject
        );
      });

    const loadGlb = (url: string): Promise<GLTF> =>
      new Promise((resolve, reject) => {
        gltfLoader.load(url, resolve, undefined, reject);
      });

    const pbrKeys: PBRMaterialKey[] = ['asphalt', 'grass', 'rock', 'stonewall', 'bark', 'sand'];
    const hdriSpecs: Array<[HDRIKey, string]> = [
      ['studio', '/assets/hdri/studio_automotive_2k.hdr'],
      ['monza', '/assets/hdri/monza_golden_2k.hdr'],
      ['alpine', '/assets/hdri/alpine_peaks_2k.hdr'],
      ['desert', '/assets/hdri/desert_sunset_2k.hdr'],
      ['city', '/assets/hdri/night_sky_1k.hdr'],
    ];

    try {
      const [pbrResults, hdriResults, glbResults] = await Promise.all([
        Promise.all(
          pbrKeys.map(async (k) => {
            const [albedo, normal, orm] = await Promise.all([
              loadTex(`/assets/pbr/${k}/albedo.jpg`, true),
              loadTex(`/assets/pbr/${k}/normal.jpg`, false),
              loadTex(`/assets/pbr/${k}/orm.jpg`, false),
            ]);
            return [k, { albedo, normal, orm }] as const;
          })
        ),
        Promise.all(
          hdriSpecs.map(async ([k, url]) => {
            const hdr = await loadHdr(url);
            return [k, hdr] as const;
          })
        ),
        Promise.all([
          loadGlb('/assets/models/f1_hero_lod0.glb'),
          loadGlb('/assets/models/f1_ai_lod1.glb'),
          loadGlb('/assets/models/gt_safety_car.glb'),
          loadGlb('/assets/models/tv_helicopter_h135.glb'),
          loadGlb('/assets/models/scenery_nature.glb'),
        ]),
      ]);

      for (const [k, pack] of pbrResults) this.pbr.set(k, pack);
      for (const [k, hdr] of hdriResults) this.hdriEquirect.set(k, hdr);

      // Build Studio Automotive PMREM directly from real Poly Haven studio_small_09_2k.hdr!
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      const studioHdr = this.hdriEquirect.get('studio');
      if (studioHdr) {
        const rt = pmrem.fromEquirectangular(studioHdr);
        this.pmremProbes.set('studio', markShared(rt.texture));
      }
      pmrem.dispose();

      // Extract & pre-merge Blender 4.0 Subsurf .GLB models in clean Float32 for ultra-low draw calls!
      const [f1HeroGlb, f1AiGlb, scGlb, heliGlb, natureGlb] = glbResults;
      this.f1Lod0 = this._extractF1Template(f1HeroGlb.scene);
      this.f1Lod1 = this._extractF1Template(f1AiGlb.scene);
      this.safetyCarGltf = scGlb.scene;
      this.safetyCarPremerged = this._extractSafetyCar(scGlb.scene);
      this.helicopterGltf = heliGlb.scene;
      this.helicopterPremerged = this._extractHelicopter(heliGlb.scene);

      natureGlb.scene.updateMatrixWorld(true);
      natureGlb.scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const g = dequantizeToFloat32(obj.geometry, false);
        g.applyMatrix4(obj.matrixWorld);
        g.computeVertexNormals();
        if (obj.name.startsWith('Cliff_Boulder_A')) {
          this.cliffBoulderA = markShared(g);
        } else if (obj.name.startsWith('Cliff_Boulder_B')) {
          this.cliffBoulderB = markShared(g);
        } else if (obj.name.startsWith('Wild_Grass_Clump')) {
          // Bake upward-bent botanical normals + lush root-to-tip Ambient Occlusion vertex colors!
          const pos = g.attributes.position;
          const norm = g.attributes.normal;
          const cols = new Float32Array(pos.count * 3);
          const cRoot = new THREE.Color('#13240c');
          const cTip = new THREE.Color('#6a9638');
          const tmp = new THREE.Color();
          for (let i = 0; i < pos.count; i++) {
            const vy = pos.getY(i);
            const t = THREE.MathUtils.clamp(vy / 0.62, 0, 1);
            tmp.copy(cRoot).lerp(cTip, Math.pow(t, 0.72));
            cols[i * 3] = tmp.r;
            cols[i * 3 + 1] = tmp.g;
            cols[i * 3 + 2] = tmp.b;
            // Upward hemispherical normal so grass blades catch golden-hour sun cleanly from both sides
            const nx = norm.getX(i) * 0.25;
            const nz = norm.getZ(i) * 0.25;
            const len = Math.hypot(nx, 0.92, nz) || 1;
            norm.setXYZ(i, nx / len, 0.92 / len, nz / len);
          }
          g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
          this.wildGrassClump = markShared(g);
        }
      });

      this.loaded = true;
    } catch (err) {
      console.warn('[FH6AssetRegistry] Partial asset preload warning:', err);
    }
  }

  /**
   * Builds a ForzaTech-style Hybrid Automotive Reflection Probe combining the REAL 32-bit Poly Haven .HDR sky
   * in the upper hemisphere with grounded tarmac bounce & passing forest treeline silhouettes on the flanks!
   */
  public getOrBuildTrackProbe(
    renderer: THREE.WebGLRenderer,
    theme: 'monza' | 'alpine' | 'desert' | 'city',
    weather: string,
    sunPos: [number, number, number]
  ): THREE.Texture | null {
    const key = `fh6_probe_${theme}_${weather}`;
    if (this.pmremProbes.has(key)) return this.pmremProbes.get(key)!;
    const hdr = this.hdriEquirect.get(theme);
    if (!hdr) return null;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();

    const skyTint = weather === 'rain' ? new THREE.Color(0.45, 0.50, 0.58)
      : weather === 'overcast' ? new THREE.Color(0.72, 0.76, 0.82)
      : new THREE.Color(1.0, 1.0, 1.0);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(60, 40, 24),
      new THREE.MeshBasicMaterial({ map: hdr, color: skyTint, side: THREE.BackSide, toneMapped: false })
    );
    envScene.add(dome);

    const groundDisc = new THREE.Mesh(
      new THREE.CircleGeometry(58, 36),
      new THREE.MeshBasicMaterial({ color: theme === 'desert' ? '#2c1d12' : '#101318' })
    );
    groundDisc.rotation.x = -Math.PI / 2;
    groundDisc.position.y = -2.0;
    envScene.add(groundDisc);

    if (theme === 'monza' || theme === 'alpine') {
      const darkPine = new THREE.MeshBasicMaterial({ color: '#101d10', side: THREE.DoubleSide });
      const litPine = new THREE.MeshBasicMaterial({ color: '#2b401e', side: THREE.DoubleSide });
      const sunVec = new THREE.Vector3(...sunPos).normalize();
      for (let i = 0; i < 40; i++) {
        const ang = (i / 40) * Math.PI * 2;
        if (Math.abs(Math.cos(ang)) > 0.86) continue;
        const h = 9 + (i % 5) * 3.4;
        const tx = Math.sin(ang) * 38;
        const tz = Math.cos(ang) * 38;
        const lit = tx * sunVec.x + tz * sunVec.z > 0;
        const tree = new THREE.Mesh(new THREE.ConeGeometry(3.8, h, 8), lit ? litPine : darkPine);
        tree.position.set(tx, h * 0.42 - 1.8, tz);
        envScene.add(tree);
      }
    } else if (theme === 'city') {
      const cols = ['#00f0ff', '#ff007f', '#ffe066', '#9d4edd'];
      for (let i = 0; i < 20; i++) {
        const ang = (i / 20) * Math.PI * 2;
        const strip = new THREE.Mesh(
          new THREE.PlaneGeometry(4.5, 14),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i % cols.length]).multiplyScalar(2.4), side: THREE.DoubleSide, toneMapped: false })
        );
        strip.position.set(Math.sin(ang) * 36, 5, Math.cos(ang) * 36);
        strip.lookAt(0, 5, 0);
        envScene.add(strip);
      }
    }

    if (theme !== 'city' && weather !== 'rain') {
      const sunDir = new THREE.Vector3(...sunPos).normalize().multiplyScalar(46);
      const sunSphere = new THREE.Mesh(
        new THREE.SphereGeometry(3.2, 16, 12),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(8.0, 6.8, 4.8), toneMapped: false })
      );
      sunSphere.position.copy(sunDir);
      envScene.add(sunSphere);
    }

    const rt = pmrem.fromScene(envScene, 0.008);
    pmrem.dispose();
    const out = markShared(rt.texture);
    this.pmremProbes.set(key, out);
    return out;
  }

  private _mergeMap(buckets: Record<string, THREE.BufferGeometry[]>): Record<string, THREE.BufferGeometry> {
    const out: Record<string, THREE.BufferGeometry> = {};
    for (const [matName, list] of Object.entries(buckets)) {
      if (!list.length) continue;
      const merged = list.length === 1 ? list[0].clone() : mergeGeometries(list, false);
      if (merged) out[matName] = markShared(merged);
    }
    return out;
  }

  private _extractF1Template(root: THREE.Object3D): PremergedF1LodTemplate {
    root.updateMatrixWorld(true);
    const bodyBuckets: Record<string, THREE.BufferGeometry[]> = {};
    const fwBuckets: Record<string, THREE.BufferGeometry[]> = {};
    const swBuckets: Record<string, THREE.BufferGeometry[]> = {};
    let haloGeo: THREE.BufferGeometry | null = null;
    let drsFlapGeo: THREE.BufferGeometry | null = null;
    const wheels: Record<string, {
      tireGeo?: THREE.BufferGeometry;
      rimGeo?: THREE.BufferGeometry;
      sideGeo?: THREE.BufferGeometry;
      discGeo?: THREE.BufferGeometry;
    }> = { FL: {}, FR: {}, RL: {}, RR: {} };

    const fwNode = root.getObjectByName('Front_Wing_Group');
    const drsNode = root.getObjectByName('DRS_Flap_Group');
    const swNode = root.getObjectByName('Steer_Wheel_Group');
    const wheelsNode = root.getObjectByName('Wheels_Templates');

    const fwInv = fwNode ? fwNode.matrixWorld.clone().invert() : new THREE.Matrix4();
    const drsInv = drsNode ? drsNode.matrixWorld.clone().invert() : new THREE.Matrix4();
    const swInv = swNode ? swNode.matrixWorld.clone().invert() : new THREE.Matrix4();
    const wheelsInv = wheelsNode ? wheelsNode.matrixWorld.clone().invert() : new THREE.Matrix4();

    const isDescendant = (child: THREE.Object3D, ancestor: THREE.Object3D | undefined): boolean => {
      if (!ancestor) return false;
      let cur: THREE.Object3D | null = child;
      while (cur) {
        if (cur === ancestor) return true;
        cur = cur.parent;
      }
      return false;
    };

    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      const matName = mat?.name || 'Carbon_Weave';

      if (isDescendant(obj, wheelsNode)) {
        const wm = wheelsInv.clone().multiply(obj.matrixWorld);
        for (const k of ['FL', 'FR', 'RL', 'RR'] as const) {
          if (obj.name.startsWith(`Wheel_Tire_${k}`)) {
            wheels[k].tireGeo = markShared(dequantizeToFloat32(obj.geometry).applyMatrix4(wm));
          } else if (obj.name.startsWith(`Wheel_Rim_${k}`)) {
            wheels[k].rimGeo = markShared(dequantizeToFloat32(obj.geometry).applyMatrix4(wm));
          } else if (obj.name.startsWith(`Wheel_Side_${k}`)) {
            wheels[k].sideGeo = markShared(dequantizeToFloat32(obj.geometry).applyMatrix4(wm));
          } else if (obj.name.startsWith(`Wheel_Disc_${k}`)) {
            wheels[k].discGeo = markShared(dequantizeToFloat32(obj.geometry).applyMatrix4(wm));
          }
        }
        return;
      }

      if (obj.name.startsWith('Halo_Mesh')) {
        haloGeo = markShared(dequantizeToFloat32(obj.geometry).applyMatrix4(obj.matrixWorld));
        return;
      }

      if (isDescendant(obj, fwNode)) {
        const m = fwInv.clone().multiply(obj.matrixWorld);
        (fwBuckets[matName] ??= []).push(dequantizeToFloat32(obj.geometry).applyMatrix4(m));
        return;
      }

      if (isDescendant(obj, drsNode)) {
        const m = drsInv.clone().multiply(obj.matrixWorld);
        drsFlapGeo = markShared(dequantizeToFloat32(obj.geometry).applyMatrix4(m));
        return;
      }

      if (isDescendant(obj, swNode)) {
        const m = swInv.clone().multiply(obj.matrixWorld);
        (swBuckets[matName] ??= []).push(dequantizeToFloat32(obj.geometry).applyMatrix4(m));
        return;
      }

      (bodyBuckets[matName] ??= []).push(dequantizeToFloat32(obj.geometry).applyMatrix4(obj.matrixWorld));
    });

    const byMat = this._mergeMap(bodyBuckets);
    const frontWingByMat = this._mergeMap(fwBuckets);
    const steerWheelByMat = this._mergeMap(swBuckets);

    for (const list of [...Object.values(bodyBuckets), ...Object.values(fwBuckets), ...Object.values(swBuckets)]) {
      list.forEach((g) => g.dispose());
    }

    return {
      byMat,
      haloGeo,
      frontWingByMat,
      drsFlapGeo,
      steerWheelByMat,
      wheels: wheels as PremergedF1LodTemplate['wheels'],
    };
  }

  private _extractSafetyCar(root: THREE.Object3D): PremergedSafetyCarTemplate {
    root.updateMatrixWorld(true);
    const buckets: Record<string, THREE.BufferGeometry[]> = {};
    let lightbarGeo: THREE.BufferGeometry | null = null;

    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      const matName = mat?.name || 'SC_Carbon';
      const g = dequantizeToFloat32(obj.geometry).applyMatrix4(obj.matrixWorld);
      if (obj.name === 'scLightbar' || matName === 'SC_Strobe') {
        lightbarGeo = markShared(g);
      } else {
        (buckets[matName] ??= []).push(g);
      }
    });

    const byMat = this._mergeMap(buckets);
    for (const list of Object.values(buckets)) list.forEach((g) => g.dispose());
    return { byMat, lightbarGeo };
  }

  private _extractHelicopter(root: THREE.Object3D): PremergedHelicopterTemplate {
    root.updateMatrixWorld(true);
    const buckets: Record<string, THREE.BufferGeometry[]> = {};
    const rotorParts: THREE.BufferGeometry[] = [];
    const rotorNode = root.getObjectByName('heliRotor');
    const rotorPos = new THREE.Vector3(0, 1.48, 0.15);
    const rotorInv = new THREE.Matrix4();
    if (rotorNode) {
      rotorPos.setFromMatrixPosition(rotorNode.matrixWorld);
      rotorInv.copy(rotorNode.matrixWorld).invert();
    }

    const isRotorChild = (child: THREE.Object3D): boolean => {
      if (!rotorNode) return false;
      let cur: THREE.Object3D | null = child;
      while (cur) {
        if (cur === rotorNode) return true;
        cur = cur.parent;
      }
      return false;
    };

    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      const matName = mat?.name || 'Heli_Dark';
      if (isRotorChild(obj)) {
        const m = rotorInv.clone().multiply(obj.matrixWorld);
        rotorParts.push(dequantizeToFloat32(obj.geometry).applyMatrix4(m));
      } else {
        (buckets[matName] ??= []).push(dequantizeToFloat32(obj.geometry).applyMatrix4(obj.matrixWorld));
      }
    });

    const byMat = this._mergeMap(buckets);
    const rotorGeo = rotorParts.length ? markShared(mergeGeometries(rotorParts, false)!) : null;
    for (const list of Object.values(buckets)) list.forEach((g) => g.dispose());
    rotorParts.forEach((g) => g.dispose());
    return { byMat, rotorGeo, rotorPos };
  }
}

export const fh6Assets = new FH6AssetRegistry();

/**
 * Reusable GLSL Anti-Tiling Dual-Rotated Stochastic UV Sampler
 * Eliminates visible grid repetition on 2K scanned grass, rock, sand & asphalt!
 */
export const GLSL_STOCHASTIC_SAMPLE = /* glsl */ `
vec2 fh6Hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
vec4 sampleStochastic(sampler2D tex, vec2 uv) {
  vec2 iuv = floor(uv * 0.25);
  vec2 fuv = fract(uv * 0.25);
  vec2 w = smoothstep(0.15, 0.85, fuv);
  vec2 o00 = fh6Hash22(iuv);
  vec2 o10 = fh6Hash22(iuv + vec2(1.0, 0.0));
  vec2 o01 = fh6Hash22(iuv + vec2(0.0, 1.0));
  vec2 o11 = fh6Hash22(iuv + vec2(1.0, 1.0));
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  vec4 c00 = textureGrad(tex, uv + o00, dx, dy);
  vec4 c10 = textureGrad(tex, uv + o10, dx, dy);
  vec4 c01 = textureGrad(tex, uv + o01, dx, dy);
  vec4 c11 = textureGrad(tex, uv + o11, dx, dy);
  return mix(mix(c00, c10, w.x), mix(c01, c11, w.x), w.y);
}
`;
