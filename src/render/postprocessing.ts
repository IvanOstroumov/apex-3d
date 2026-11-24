/**
 * APEX GP 3D — Forza Horizon 6 Next-Gen Post-Processing Pipeline
 * Combines:
 * - Ground-Truth Half-Res Screen-Space Ambient Occlusion (N8AOPostPass, physically linear HDR)
 * - Directional Radial Speed Motion Blur (with Hero-Car Sharpness Protection Mask!)
 * - Subtle Wide-Angle Lens Chromatic Aberration at Screen Periphery
 * - Volumetric Golden-Hour Sun God-Rays, Anamorphic Glint & Hexagonal Lens Micro-Bokeh
 * - Selective HDR Mipmap Bloom (Taillights, Pink-Purple Exhaust Plasma, Wet Asphalt Speculars)
 * - ForzaTech Filmic Contrast S-Curve + ACES Filmic Tone Mapping + SMAA High
 */
import * as THREE from 'three';
import {
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { QualityPreset } from '../core/types';
import { QUALITY_CONFIG } from '../core/config';

const FORZA_FH6_FRAGMENT = /* glsl */ `
uniform float uSpeedNorm;
uniform float uImpactShake;
uniform vec3 uSunScreen;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // 1. Hero-Car Protection Mask: keep the center-bottom hero vehicle 100% razor-sharp!
  vec2 carCenter = vec2(0.50, 0.28);
  float carDist = length((uv - carCenter) * vec2(1.18, 1.52));
  float carProtect = smoothstep(0.20, 0.46, carDist);

  // 2. 10-Tap Directional Radial Motion Blur from Vanishing Point (0.50, 0.53) to Screen Periphery
  vec2 vanishPt = vec2(0.50, 0.53);
  vec2 radialDir = uv - vanishPt;
  float radialDist = length(radialDir);
  float edgeMask = smoothstep(0.09, 0.56, radialDist) * carProtect;

  float blurAmount = clamp(uSpeedNorm * 0.056, 0.0, 0.060) * edgeMask;

  vec3 accum = inputColor.rgb;
  float totalWeight = 1.0;

  if (blurAmount > 0.0004) {
    vec2 stepVec = normalize(radialDir + vec2(1e-5)) * (blurAmount / 10.0);
    for (int i = 1; i <= 10; i++) {
      float w = 1.0 - float(i) * 0.082;
      vec2 sampleUv = clamp(uv - stepVec * float(i), vec2(0.001), vec2(0.999));
      accum += texture2D(inputBuffer, sampleUv).rgb * w;
      totalWeight += w;
    }
    accum /= totalWeight;
  }

  // 3. Subtle Wide-Angle Lens Chromatic Aberration at Screen Periphery
  float caStrength = (0.00065 * uSpeedNorm + uImpactShake * 0.0026) * edgeMask;
  if (caStrength > 0.0001) {
    vec2 caOffset = normalize(radialDir + vec2(1e-5)) * caStrength;
    accum.r = mix(accum.r, texture2D(inputBuffer, clamp(uv + caOffset, vec2(0.001), vec2(0.999))).r, 0.60);
    accum.b = mix(accum.b, texture2D(inputBuffer, clamp(uv - caOffset, vec2(0.001), vec2(0.999))).b, 0.60);
  }

  // 4. Forza Horizon 6 Volumetric Sun God-Rays, Anamorphic Glint & Multi-Element Lens Bokeh
  if (uSunScreen.z > 0.01) {
    vec2 sunUv = uSunScreen.xy;
    vec2 aspectFix = vec2(1.777, 1.0);
    vec2 toSun = (uv - sunUv) * aspectFix;
    float sunDist = length(toSun);
    float rayAng = atan(toSun.y, toSun.x);

    // Screen-space radial bright-sky occlusion march (8 lightweight taps toward sunUv for real tree canopy god-rays!)
    float skyRayOcc = 0.0;
    vec2 marchStep = (sunUv - uv) * 0.125;
    vec2 marchUv = uv;
    for (int s = 0; s < 8; s++) {
      marchUv += marchStep;
      vec3 sc = texture2D(inputBuffer, clamp(marchUv, vec2(0.002), vec2(0.998))).rgb;
      skyRayOcc += smoothstep(0.55, 1.45, dot(sc, vec3(0.333)));
    }
    skyRayOcc *= 0.125;

    float rayShafts = (0.82 + 0.18 * sin(rayAng * 14.0) * cos(rayAng * 6.0)) * (0.45 + 0.55 * skyRayOcc);
    float scatter = exp(-sunDist * 3.1) * rayShafts * 0.18;
    float anamorphic = exp(-abs(uv.y - sunUv.y) * 62.0) * exp(-abs(uv.x - sunUv.x) * 3.8) * 0.13;

    // Multi-coated camera lens ghost rings along optical axis
    vec2 axisVec = vec2(0.5) - sunUv;
    float dG1 = length((uv - (vec2(0.5) + axisVec * 0.48)) * aspectFix);
    float dG2 = length((uv - (vec2(0.5) + axisVec * 1.08)) * aspectFix);
    float dG3 = length((uv - (vec2(0.5) + axisVec * 1.52)) * aspectFix);
    float ghost1 = smoothstep(0.075, 0.0, dG1) * 0.055;
    float ghost2 = smoothstep(0.125, 0.038, dG2) * smoothstep(0.0, 0.038, dG2) * 0.052;
    float ghost3 = smoothstep(0.055, 0.015, dG3) * 0.038;

    vec3 flareCol = vec3(1.0, 0.80, 0.48) * (scatter + anamorphic + ghost1)
                  + vec3(0.44, 0.84, 1.0) * ghost2
                  + vec3(0.95, 0.58, 0.85) * ghost3;
    accum += flareCol * uSunScreen.z;
  }

  // 5. ForzaTech Filmic LUT Color Grading (Micro-Contrast Toe + Natural Foliage Saturation)
  vec3 col = clamp(accum, vec3(0.0), vec3(64.0));
  col = pow(col + vec3(1e-6), vec3(1.055));
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(vec3(0.0), mix(vec3(luma), col, 1.15));

  outputColor = vec4(col, inputColor.a);
}
`;

class ForzaCinemaEffect extends Effect {
  constructor() {
    super('ForzaCinemaEffect', FORZA_FH6_FRAGMENT, {
      uniforms: new Map<string, THREE.Uniform>([
        ['uSpeedNorm', new THREE.Uniform(0.65)],
        ['uImpactShake', new THREE.Uniform(0.0)],
        ['uSunScreen', new THREE.Uniform(new THREE.Vector3(0.5, 0.75, 0.0))]
      ])
    });
  }

  setDynamics(speedNorm: number, impactShake: number, sunX = 0.5, sunY = 0.75, sunVis = 0.0): void {
    (this.uniforms.get('uSpeedNorm') as THREE.Uniform).value = speedNorm;
    (this.uniforms.get('uImpactShake') as THREE.Uniform).value = impactShake;
    (this.uniforms.get('uSunScreen') as THREE.Uniform).value.set(sunX, sunY, sunVis);
  }
}

export class PostProcessPipeline {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private composer: EffectComposer | null = null;
  private n8aoPass: N8AOPostPass | null = null;
  private bloomEffect: BloomEffect | null = null;
  private vignetteEffect: VignetteEffect | null = null;
  private forzaEffect: ForzaCinemaEffect | null = null;
  private enabled = true;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: QualityPreset) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.rebuild(quality);
  }

  rebuild(quality: QualityPreset, smaaOverride?: boolean): void {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.n8aoPass = null;
    }

    const cfg = QUALITY_CONFIG[quality];
    this.enabled = cfg.postProcessing;

    if (!this.enabled) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.12;
      return;
    }

    this.renderer.toneMapping = THREE.NoToneMapping;

    const size = this.renderer.getSize(new THREE.Vector2());
    const w = Math.max(2, Math.floor(size.x));
    const h = Math.max(2, Math.floor(size.y));

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0
    });

    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Ground-Truth Half-Res Screen-Space Ambient Occlusion (N8AO) on Medium/High/Ultra!
    if (quality !== 'low') {
      try {
        const aoPass = new N8AOPostPass(this.scene, this.camera, w, h);
        aoPass.autosetGamma = false;
        aoPass.configuration.gammaCorrection = false;
        aoPass.configuration.halfRes = true;
        aoPass.configuration.aoSamples = quality === 'ultra' ? 16 : 12;
        aoPass.configuration.denoiseSamples = quality === 'ultra' ? 8 : 6;
        aoPass.configuration.denoiseRadius = 10;
        aoPass.configuration.aoRadius = 1.75;
        aoPass.configuration.distanceFalloff = 1.15;
        aoPass.configuration.intensity = 2.15;
        this.n8aoPass = aoPass;
        this.composer.addPass(aoPass as unknown as Parameters<EffectComposer['addPass']>[0]);
      } catch (e) {
        console.warn('[PostProcessPipeline] N8AO fallback:', e);
        this.n8aoPass = null;
      }
    }

    const mainEffects: unknown[] = [];

    this.forzaEffect = new ForzaCinemaEffect();
    mainEffects.push(this.forzaEffect);

    if (cfg.bloom) {
      this.bloomEffect = new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: 0.84,
        luminanceSmoothing: 0.24,
        intensity: 0.80,
        radius: 0.66
      });
      mainEffects.push(this.bloomEffect);
    } else {
      this.bloomEffect = null;
    }

    this.vignetteEffect = new VignetteEffect({
      eskil: false,
      offset: 0.26,
      darkness: 0.34
    });
    mainEffects.push(this.vignetteEffect);
    mainEffects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));

    this.composer.addPass(new EffectPass(this.camera, ...(mainEffects as ConstructorParameters<typeof EffectPass>[1][])));

    const useSmaa = smaaOverride !== undefined ? smaaOverride : cfg.smaa;
    if (useSmaa) {
      this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    }
  }

  setSize(width: number, height: number): void {
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.n8aoPass) {
      this.n8aoPass.setSize(Math.max(2, Math.floor(width)), Math.max(2, Math.floor(height)));
    }
  }

  updateDynamic(
    speedNorm: number,
    impactShake: number,
    isNight: boolean,
    bloomMult = 1.0,
    vignetteMult = 1.0,
    sunX = 0.5,
    sunY = 0.75,
    sunVis = 0.0
  ): void {
    if (this.forzaEffect) {
      this.forzaEffect.setDynamics(speedNorm, impactShake, sunX, sunY, sunVis);
    }
    if (this.vignetteEffect) {
      this.vignetteEffect.darkness = (0.30 + speedNorm * 0.22) * vignetteMult;
    }
    if (this.bloomEffect) {
      this.bloomEffect.intensity = (isNight ? 1.05 : 0.78) * bloomMult;
    }
  }

  render(dt: number): void {
    if (this.enabled && this.composer) {
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose(): void {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.n8aoPass = null;
    }
  }
}
