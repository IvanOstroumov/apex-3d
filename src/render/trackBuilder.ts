/**
 * APEX GP 3D — Next-Gen AAA Procedural Circuit, GLSL Physical Sky, Chevron Racing Line & Scenery Builder
 * - Pacchetto 1: Custom GLSL Rayleigh/Mie Atmospheric Sky Dome Shader (with dynamic Time-of-Day progression!),
 *   Dashed 3D Chevron Racing Line (no more solid green carpet!), Pit-Wall Engineer Canopy & Grandstand Trusses
 * - Pacchetto 2: Instanced Braking/DRS Boards & Merged Static Track Props (saves ~70 draw calls!)
 * - Pacchetto 3: Physical 3D GT Safety Car with HDR Flashing Roof Strobe Lightbar!
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrackConfig, TrackData, TrackQueryResult, TrackSample, WeatherType, QualityPreset } from '../core/types';
import { QUALITY_CONFIG } from '../core/config';
import {
  getAsphaltPBR,
  getCatchFenceTexture,
  getCurbTexture,
  getCheckeredTexture,
  getSponsorBoardTexture,
  getBuildingTexture,
  getCrowdTexture,
  getTerrainPBR,
  getTrackSignTexture,
  getPineBranchAlphaTexture,
  getDeciduousLeafAlphaTexture,
  getCarbonTexture,
  getCarbonNormalTexture,
  createTrackEnvMap
} from './textures';
import { buildSmoothLoftedHull, type LoftSlice } from './carBuilder';
import { fh6Assets } from './assetRegistry';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const ASPHALT_Y_OFFSET = 0.04;

export function buildTrack(
  trackCfg: TrackConfig,
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  weather: WeatherType = 'dry',
  quality: QualityPreset = 'high',
  reverseTrack = false
): TrackData {
  const group = new THREE.Group();
  const qCfg = QUALITY_CONFIG[quality];
  const renderWeather: 'dry' | 'overcast' | 'rain' = weather === 'dynamic' ? 'overcast' : weather;

  // 1. Smooth closed 3D Catmull-Rom spline (supports Reverse Layout)
  const ptsSource = reverseTrack ? [...trackCfg.points].reverse() : trackCfg.points;
  const drsZonesSource: [number, number][] = reverseTrack
    ? trackCfg.drsZones.map(([a, b]) => [Math.max(0.01, 1 - b), Math.min(0.99, 1 - a)] as [number, number])
    : trackCfg.drsZones;

  const ctrlPts = ptsSource.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(ctrlPts, true, 'centripetal', 0.5);
  const N = trackCfg.samples || 720;

  const rawPoints = curve.getSpacedPoints(N);
  const samples: TrackSample[] = [];
  let totalLength = 0;

  for (let i = 0; i < N; i++) {
    const pos = rawPoints[i].clone();
    const prev = rawPoints[(i - 1 + N) % N];
    const next = rawPoints[(i + 1) % N];

    if (i > 0) totalLength += pos.distanceTo(rawPoints[i - 1]);

    const tangent = new THREE.Vector3().subVectors(next, prev).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, WORLD_UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, tangent).normalize();

    const t = i / N;
    let isDrsZone = false;
    for (const [zStart, zEnd] of drsZonesSource) {
      if (t >= zStart && t <= zEnd) {
        isDrsZone = true;
        break;
      }
    }

    const isPitZone = t >= 0.95 || t <= 0.06;
    const bumpOffset = Math.sin(i * 0.85) * 0.004 + Math.cos(i * 2.1) * 0.003;
    const isPuddle = i % 115 >= 4 && i % 115 <= 9 && !isDrsZone;

    samples.push({
      index: i,
      t,
      s: totalLength,
      pos,
      tangent,
      right,
      up,
      asphaltY: pos.y + up.y * ASPHALT_Y_OFFSET,
      curvature: 0,
      smoothCurvature: 0,
      camber: 0,
      bumpOffset,
      isPuddle,
      idealLateral: 0,
      aiTargetSpeed: 92,
      isTunnel: trackCfg.tunnelRange ? t >= trackCfg.tunnelRange[0] && t <= trackCfg.tunnelRange[1] : false,
      isDrsZone,
      isPitZone
    });
  }
  totalLength += rawPoints[0].distanceTo(rawPoints[N - 1]);
  const avgSegLen = totalLength / N;

  const halfW = trackCfg.trackWidth * 0.5;
  for (let i = 0; i < N; i++) {
    const prevT = samples[(i - 4 + N) % N].tangent;
    const nextT = samples[(i + 4) % N].tangent;
    samples[i].curvature = prevT.x * nextT.z - prevT.z * nextT.x;
  }

  const weatherMult = weather === 'rain' ? 0.74 : weather === 'dynamic' ? 0.88 : 1.0;
  const maxBrakeDecel = 22.0 * weatherMult;

  for (let i = 0; i < N; i++) {
    let sumC = 0;
    for (let k = -7; k <= 7; k++) {
      sumC += samples[(i + k + N) % N].curvature;
    }
    const avgC = sumC / 15;
    samples[i].smoothCurvature = avgC;
    samples[i].camber = THREE.MathUtils.clamp(-avgC * 0.14, -0.055, 0.055);
    samples[i].idealLateral = THREE.MathUtils.clamp(avgC * 22, -halfW * 0.56, halfW * 0.56);

    const prevT = samples[(i - 4 + N) % N].tangent;
    const nextT = samples[(i + 4) % N].tangent;
    const dot = THREE.MathUtils.clamp(prevT.x * nextT.x + prevT.z * nextT.z, -1, 1);
    const dTheta = Math.acos(dot);
    const kappa = dTheta / Math.max(1.0, avgSegLen * 8);

    const aLat = (14.5 + (kappa < 0.010 ? 11.5 : 2.0)) * weatherMult;
    const vCorner = kappa > 0.0015 ? Math.sqrt(aLat / kappa) : 95;
    samples[i].aiTargetSpeed = THREE.MathUtils.clamp(vCorner, 19, 94);
  }

  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = samples[(i + 1) % N];
      const vMaxEntry = Math.sqrt(next.aiTargetSpeed * next.aiTargetSpeed + 2 * maxBrakeDecel * avgSegLen);
      if (vMaxEntry < samples[i].aiTargetSpeed) {
        samples[i].aiTargetSpeed = vMaxEntry;
      }
    }
  }

  // ---------- 2. CUSTOM GLSL RAYLEIGH/MIE ATMOSPHERIC SKY SHADER & LIGHTING ----------
  const envMap = createTrackEnvMap(renderer, trackCfg, renderWeather);
  scene.environment = envMap;

  const { skyMesh, skyUniforms } = buildPhysicalSkyDome(trackCfg, renderWeather);
  group.add(skyMesh);

  const fogHex = renderWeather === 'rain' && trackCfg.theme !== 'city' ? '#516070' : trackCfg.fogColor;
  const fogDens = renderWeather === 'rain' ? trackCfg.fogDensity * 1.45 : trackCfg.fogDensity;
  scene.fog = new THREE.FogExp2(fogHex, fogDens);
  scene.background = new THREE.Color(fogHex);

  const sunIntensity = renderWeather === 'rain' ? trackCfg.sunIntensity * 0.48
    : renderWeather === 'overcast' ? trackCfg.sunIntensity * 0.72
    : trackCfg.sunIntensity;

  // Dual-Cascade Shadow Rig: Wide Valley Cascade (280m) + Texel-Snapped Hero Close Cascade (32m = 1.5cm/px!)
  const dirLight = new THREE.DirectionalLight(trackCfg.sunColor, sunIntensity * (qCfg.shadows ? 0.58 : 1.0));
  dirLight.position.set(...trackCfg.sunPos);
  dirLight.castShadow = qCfg.shadows;
  dirLight.shadow.mapSize.set(qCfg.shadowMapSize, qCfg.shadowMapSize);
  dirLight.shadow.camera.near = 10;
  dirLight.shadow.camera.far = 900;
  const dCam = 140;
  dirLight.shadow.camera.left = -dCam;
  dirLight.shadow.camera.right = dCam;
  dirLight.shadow.camera.top = dCam;
  dirLight.shadow.camera.bottom = -dCam;
  dirLight.shadow.camera.updateProjectionMatrix();
  dirLight.shadow.bias = -0.00038;
  group.add(dirLight);
  group.add(dirLight.target);

  let heroShadowLight: THREE.DirectionalLight | undefined;
  if (qCfg.shadows) {
    heroShadowLight = new THREE.DirectionalLight(trackCfg.sunColor, sunIntensity * 0.44);
    heroShadowLight.position.set(...trackCfg.sunPos);
    heroShadowLight.castShadow = true;
    heroShadowLight.shadow.mapSize.set(2048, 2048);
    heroShadowLight.shadow.camera.near = 20;
    heroShadowLight.shadow.camera.far = 850;
    const hCam = 16; // 32m x 32m hero shadow box => 1.5 cm shadow texels!
    heroShadowLight.shadow.camera.left = -hCam;
    heroShadowLight.shadow.camera.right = hCam;
    heroShadowLight.shadow.camera.top = hCam;
    heroShadowLight.shadow.camera.bottom = -hCam;
    heroShadowLight.shadow.camera.updateProjectionMatrix();
    heroShadowLight.shadow.bias = -0.00016;
    group.add(heroShadowLight);
    group.add(heroShadowLight.target);
  }

  group.add(new THREE.HemisphereLight(trackCfg.hemiSky, trackCfg.hemiGround, trackCfg.hemiIntensity));
  group.add(new THREE.AmbientLight('#ffffff', trackCfg.ambientIntensity));

  // ---------- 3. FIXED-WINDING RIBBON MESH HELPER ----------
  function buildRibbon(
    offsetLeft: number,
    offsetRight: number,
    yOffsetFn: number | ((s: TrackSample, side: number) => number),
    uScale: number,
    vRepeat: number,
    material: THREE.Material,
    receiveShadow = true
  ): THREE.Mesh {
    const positions = new Float32Array((N + 1) * 6);
    const normals = new Float32Array((N + 1) * 6);
    const uvs = new Float32Array((N + 1) * 4);
    const indices = new Uint32Array(N * 6);

    for (let i = 0; i <= N; i++) {
      const s = samples[i % N];
      const yL = typeof yOffsetFn === 'function' ? yOffsetFn(s, -1) : yOffsetFn;
      const yR = typeof yOffsetFn === 'function' ? yOffsetFn(s, 1) : yOffsetFn;

      const lx = s.pos.x + s.right.x * offsetLeft + s.up.x * yL;
      const ly = s.pos.y + s.right.y * offsetLeft + s.up.y * yL;
      const lz = s.pos.z + s.right.z * offsetLeft + s.up.z * yL;

      const rx = s.pos.x + s.right.x * offsetRight + s.up.x * yR;
      const ry = s.pos.y + s.right.y * offsetRight + s.up.y * yR;
      const rz = s.pos.z + s.right.z * offsetRight + s.up.z * yR;

      const p6 = i * 6;
      positions[p6] = lx; positions[p6 + 1] = ly; positions[p6 + 2] = lz;
      positions[p6 + 3] = rx; positions[p6 + 4] = ry; positions[p6 + 5] = rz;

      normals[p6] = s.up.x; normals[p6 + 1] = s.up.y; normals[p6 + 2] = s.up.z;
      normals[p6 + 3] = s.up.x; normals[p6 + 4] = s.up.y; normals[p6 + 5] = s.up.z;

      const v = (i / N) * vRepeat;
      const u4 = i * 4;
      uvs[u4] = 0; uvs[u4 + 1] = v; uvs[u4 + 2] = uScale; uvs[u4 + 3] = v;

      if (i < N) {
        const a = i * 2;
        const i6 = i * 6;
        indices[i6] = a; indices[i6 + 1] = a + 1; indices[i6 + 2] = a + 2;
        indices[i6 + 3] = a + 1; indices[i6 + 4] = a + 3; indices[i6 + 5] = a + 2;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = receiveShadow;
    return mesh;
  }

  // ---------- 4. 2K PHOTOGRAMMETRY-SCANNED ASPHALT PBR + ANALYTICAL RACING GROOVE & WET PUDDLES ----------
  const asphaltPBR = getAsphaltPBR(trackCfg.theme, renderWeather);
  const scannedAsphalt = fh6Assets.pbr.get('asphalt');
  const isWetRoad = renderWeather === 'rain' || weather === 'dynamic';
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: scannedAsphalt ? scannedAsphalt.albedo : asphaltPBR.map,
    normalMap: scannedAsphalt ? scannedAsphalt.normal : asphaltPBR.normalMap,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: scannedAsphalt ? scannedAsphalt.orm : asphaltPBR.roughnessMap,
    roughness: renderWeather === 'rain' ? 0.28 : 0.78,
    metalness: renderWeather === 'rain' ? 0.36 : 0.10,
    envMapIntensity: renderWeather === 'rain' || trackCfg.theme === 'city' ? 2.15 : 1.05
  });

  // World-space 2K scanned Asphalt031 stochastic blend + rubbered groove + markings + specular wet puddles!
  asphaltMat.onBeforeCompile = (shader) => {
    shader.uniforms.uScanAsphalt = { value: scannedAsphalt ? scannedAsphalt.albedo : asphaltPBR.map };
    shader.uniforms.uHasScanAsphalt = { value: scannedAsphalt ? 1.0 : 0.0 };
    shader.uniforms.uWetRoad = { value: renderWeather === 'rain' ? 0.88 : isWetRoad ? 0.32 : 0.0 };

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       varying vec2 vRawRoadUv;
       varying vec3 vRoadWorldPos;`
    ).replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
       vRawRoadUv = uv;
       vRoadWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
    ).replace(
      '#include <normalmap_pars_vertex>',
      `#include <normalmap_pars_vertex>`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform sampler2D uScanAsphalt;
       uniform float uHasScanAsphalt;
       uniform float uWetRoad;
       varying vec2 vRawRoadUv;
       varying vec3 vRoadWorldPos;
       float roadHash(vec2 p) {
         return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
       }
       float roadNoise(vec2 p) {
         vec2 i = floor(p);
         vec2 f = fract(p);
         f = f * f * (3.0 - 2.0 * f);
         return mix(
           mix(roadHash(i), roadHash(i + vec2(1.0, 0.0)), f.x),
           mix(roadHash(i + vec2(0.0, 1.0)), roadHash(i + vec2(1.0, 1.0)), f.x),
           f.y
         );
       }`
    ).replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       float uLat = vRawRoadUv.x;
       // Dual-scale world-space 2K photogrammetry asphalt sample (zero stretching along curves!)
       if (uHasScanAsphalt > 0.5) {
         vec3 scanFine = texture2D(uScanAsphalt, vRoadWorldPos.xz * 0.34).rgb;
         vec3 scanMid  = texture2D(uScanAsphalt, vRoadWorldPos.xz * 0.11 + vec2(0.37, 0.61)).rgb;
         diffuseColor.rgb = mix(scanFine, scanMid, 0.38) * 0.44;
       }
       float micro1 = roadNoise(vRoadWorldPos.xz * 22.0);
       float micro2 = roadNoise(vRoadWorldPos.xz * 78.0);
       float macroPatch = roadNoise(vRoadWorldPos.xz * 0.14);
       float crackWave = abs(roadNoise(vRoadWorldPos.xz * 1.65 + vec2(micro1 * 0.35)) - 0.5);
       float microCrack = 1.0 - smoothstep(0.0, 0.022, crackWave) * 0.42;
       diffuseColor.rgb *= (0.78 + micro1 * 0.16 + micro2 * 0.12 + macroPatch * 0.14) * microCrack;

       // Dual polished rubbered-in tire tracks (Real-Road groove), outer marbles & central bitumen tar seam
       float grooveL = exp(-pow((uLat - 0.28) * 6.2, 2.0));
       float grooveR = exp(-pow((uLat - 0.72) * 6.2, 2.0));
       float rubberGroove = clamp(grooveL + grooveR, 0.0, 1.0);
       float tarSeam = exp(-pow((uLat - 0.50) * 145.0, 2.0));
       float outerDust = smoothstep(0.38, 0.48, abs(uLat - 0.5)) * (0.5 + 0.5 * micro2);
       diffuseColor.rgb *= (1.0 - rubberGroove * 0.36 - tarSeam * 0.40 - outerDust * 0.14);

       // Wet-asphalt darkening in mirror-puddle depressions
       float puddleField = smoothstep(0.56, 0.76, roadNoise(vRoadWorldPos.xz * 0.085)) * uWetRoad;
       diffuseColor.rgb *= (1.0 - puddleField * 0.42);

       // Razor-sharp analytical white edge lines + weathered Forza Horizon dashed center lane marking!
       float leftLine = smoothstep(0.016, 0.019, uLat) * (1.0 - smoothstep(0.036, 0.039, uLat));
       float rightLine = smoothstep(0.961, 0.964, uLat) * (1.0 - smoothstep(0.981, 0.984, uLat));
       float centerBand = smoothstep(0.494, 0.496, uLat) * (1.0 - smoothstep(0.504, 0.506, uLat));
       float centerDash = smoothstep(0.15, 0.22, sin(vRawRoadUv.y * 540.0));
       float whiteLine = max(max(leftLine, rightLine), centerBand * centerDash * 0.78);
       float tireScuff = (0.72 + 0.28 * micro1) * (1.0 - rubberGroove * 0.28);
       diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.64, 0.68) * tireScuff, whiteLine * 0.92);`
    ).replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
       float uLatR = vRawRoadUv.x;
       float rGroove = clamp(exp(-pow((uLatR - 0.28) * 6.2, 2.0)) + exp(-pow((uLatR - 0.72) * 6.2, 2.0)), 0.0, 1.0);
       float puddleSpec = smoothstep(0.56, 0.76, roadNoise(vRoadWorldPos.xz * 0.085)) * uWetRoad;
       roughnessFactor = mix(roughnessFactor * (1.0 - rGroove * 0.48), 0.045, puddleSpec * 0.92);`
    );
  };
  group.add(buildRibbon(-halfW, halfW, ASPHALT_Y_OFFSET, 1, totalLength / 8.0, asphaltMat, true));

  // ---------- 5. 3D RAISED BICOLORE SERRATED CURBS + TIRE SKID WEATHERING SHADER ----------
  const curbTex = getCurbTexture(trackCfg.curbColors);
  const curbMat = new THREE.MeshStandardMaterial({
    map: curbTex,
    roughness: 0.62,
    metalness: 0.06,
    envMapIntensity: 0.85
  });
  curbMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       varying vec2 vCurbUv;
       varying vec3 vCurbWorldPos;`
    ).replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
       vCurbUv = uv;
       vCurbWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying vec2 vCurbUv;
       varying vec3 vCurbWorldPos;
       float curbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
    ).replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       float cGrain = curbHash(floor(vCurbWorldPos.xz * 45.0));
       // Darken excessive brightness & add black rubber tire scuff marks along inner curb edge
       float edgeDist = min(vCurbUv.x, 1.0 - vCurbUv.x);
       float rubberScuff = smoothstep(0.45, 0.0, edgeDist) * (0.45 + 0.55 * curbHash(floor(vCurbWorldPos.xz * 6.0)));
       diffuseColor.rgb *= (0.72 + cGrain * 0.14) * (1.0 - rubberScuff * 0.48);`
    );
  };
  const curbWidth = 1.45;
  group.add(buildRibbon(-(halfW + curbWidth), -halfW, (_, side) => (side === -1 ? 0.012 : 0.068), 1, totalLength / 4.0, curbMat, true));
  group.add(buildRibbon(halfW, halfW + curbWidth, (_, side) => (side === 1 ? 0.012 : 0.068), 1, totalLength / 4.0, curbMat, true));

  // ---------- 6. PHOTOGRAMMETRY-SCANNED GRASS004 / SAND / TRIPLANAR CLIFF ROCK030 TERRAIN SHADER ----------
  const runoffPBR = getTerrainPBR(trackCfg.theme);
  const scanGrass = fh6Assets.pbr.get(trackCfg.theme === 'desert' ? 'sand' : 'grass');
  const scanRock = fh6Assets.pbr.get('rock');
  const applyWorldGrassShader = (mat: THREE.MeshStandardMaterial, isApron: boolean) => {
    if (trackCfg.theme === 'city') return;
    const isDesert = trackCfg.theme === 'desert';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uScanGround = { value: scanGrass ? scanGrass.albedo : runoffPBR.map };
      shader.uniforms.uScanRock = { value: scanRock ? scanRock.albedo : runoffPBR.map };
      shader.uniforms.uHasScans = { value: scanGrass && scanRock ? 1.0 : 0.0 };

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vGrassWorldPos;
         varying vec3 vGrassWorldNorm;
         varying vec2 vGrassUv;`
      ).replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
         vGrassUv = uv;
         vGrassWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
         vGrassWorldNorm = normalize(mat3(modelMatrix) * normal);`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uScanGround;
         uniform sampler2D uScanRock;
         uniform float uHasScans;
         varying vec3 vGrassWorldPos;
         varying vec3 vGrassWorldNorm;
         varying vec2 vGrassUv;
         float gHash(vec2 p) {
           return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
         }
         float gNoise(vec2 p) {
           vec2 i = floor(p);
           vec2 f = fract(p);
           f = f * f * (3.0 - 2.0 * f);
           return mix(
             mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x),
             mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x),
             f.y
           );
         }`
      ).replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         vec2 wp = vGrassWorldPos.xz;
         float nMacro = gNoise(wp * 0.045);
         float nMid = gNoise(wp * 0.38);
         float nFine = gNoise(wp * 18.0);
         vec3 scanA = texture2D(uScanGround, wp * 0.22).rgb;
         vec3 scanB = texture2D(uScanGround, wp * 0.075 + vec2(0.41, 0.19)).rgb;
         vec3 scanCol = mix(scanA, scanB, 0.42);
         ${isDesert ? `
           vec3 sandDark = vec3(0.24, 0.14, 0.06);
           vec3 sandLight = vec3(0.46, 0.29, 0.14);
           float ripple = sin(wp.x * 1.4 + sin(wp.y * 0.7) * 2.0) * 0.5 + 0.5;
           vec3 col = mix(sandDark, sandLight, nMacro * 0.55 + ripple * 0.25 + nFine * 0.20);
           if (uHasScans > 0.5) col = mix(col, scanCol * vec3(1.08, 0.88, 0.66), 0.68);
           diffuseColor.rgb = col;
         ` : `
           // Forza Horizon 6 Photogrammetry Meadow Grass + Slope-Blended Craggy Cliff Rock!
           vec3 grassDeep = vec3(0.015, 0.036, 0.009);
           vec3 grassLush = vec3(0.032, 0.070, 0.016);
           vec3 grassSun  = vec3(0.072, 0.108, 0.026);
           vec3 soilCol   = vec3(0.044, 0.032, 0.018);
           float mowStripe = smoothstep(-0.25, 0.25, sin((wp.x * 0.7 + wp.y * 0.7) * 0.42));
           vec3 col = mix(grassDeep, grassLush, nMacro * 0.68 + mowStripe * 0.22);
           col = mix(col, grassSun, nMid * 0.46);
           if (uHasScans > 0.5) {
             // Multiply real scanned Grass004 blade texture detail while preserving rich Forza emerald tone
             col = mix(col, scanCol * vec3(0.32, 0.44, 0.24) * (0.72 + nMacro * 0.52), 0.72);
             // Triplanar-like slope & altitude rock cliff blend on hillsides!
             float slope = 1.0 - clamp(vGrassWorldNorm.y, 0.0, 1.0);
             float rockMask = smoothstep(0.16, 0.42, slope + max(0.0, vGrassWorldPos.y - 18.0) * 0.006);
             if (rockMask > 0.01) {
               vec3 rockSample = texture2D(uScanRock, wp * 0.09 + vGrassWorldPos.xy * 0.05).rgb * 0.52;
               col = mix(col, rockSample, rockMask);
             }
           }
           col = mix(col, soilCol, smoothstep(0.66, 0.90, nMid) * 0.34);
           ${isApron ? `
             float edgeMin = min(vGrassUv.x, 1.0 - vGrassUv.x);
             float gravelWear = exp(-pow(edgeMin * 7.5, 2.0));
             col = mix(col, soilCol * (0.75 + nFine * 0.45), gravelWear * 0.56);
             float edgeAO = smoothstep(0.0, 0.12, edgeMin);
             col *= (0.58 + 0.42 * edgeAO);
           ` : ''}
           diffuseColor.rgb = col;
         `}`
      );
    };
  };

  const runoffMat = new THREE.MeshStandardMaterial({
    map: scanGrass ? scanGrass.albedo : runoffPBR.map,
    normalMap: scanGrass ? scanGrass.normal : runoffPBR.normalMap,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: scanGrass ? scanGrass.orm : undefined,
    roughness: 0.92,
    metalness: 0.02
  });
  applyWorldGrassShader(runoffMat, true);
  const wallOff = trackCfg.wallOffset;
  group.add(buildRibbon(-wallOff, -(halfW + curbWidth), -0.012, 1, totalLength / 6.0, runoffMat, true));
  group.add(buildRibbon(halfW + curbWidth, wallOff, -0.012, 1, totalLength / 6.0, runoffMat, true));

  // ---------- 7. DASHED 3D CHEVRON HOLOGRAM RACING LINE (PACCHETTO 1) ----------
  const racingLineMesh = buildChevronRacingLineMesh(samples, N, totalLength);
  group.add(racingLineMesh);

  // ---------- 8. VOLUMETRIC 3D PHOTOGRAMMETRY DRY-STONE WALLS + WOODEN FENCES + STEEL STANCHIONS ----------
  const sponsorTex = getSponsorBoardTexture();
  const scanStoneWall = fh6Assets.pbr.get('stonewall');
  const isCountryTheme = trackCfg.theme === 'monza' || trackCfg.theme === 'alpine';
  const barrierMat = new THREE.MeshStandardMaterial({
    map: sponsorTex,
    normalMap: isCountryTheme && scanStoneWall ? scanStoneWall.normal : undefined,
    normalScale: new THREE.Vector2(1.25, 1.25),
    roughness: isCountryTheme ? 0.82 : 0.48,
    metalness: isCountryTheme ? 0.06 : 0.22,
    envMapIntensity: isCountryTheme ? 0.90 : 1.1
  });

  if (isCountryTheme) {
    // Blend real photogrammetry-scanned Yorkshire/Lake-District mossy dry-stone masonry + weathered pit concrete!
    barrierMat.onBeforeCompile = (shader) => {
      shader.uniforms.uStoneWallScan = { value: scanStoneWall ? scanStoneWall.albedo : sponsorTex };
      shader.uniforms.uHasStoneScan = { value: scanStoneWall ? 1.0 : 0.0 };
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWallWorldPos;
         varying vec2 vWallUv;`
      ).replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
         vWallUv = uv;
         vWallWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uStoneWallScan;
         uniform float uHasStoneScan;
         varying vec3 vWallWorldPos;
         varying vec2 vWallUv;
         float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
      ).replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         float tProg = fract(vWallUv.x);
         float countryMask = smoothstep(0.06, 0.11, tProg) * (1.0 - smoothstep(0.89, 0.94, tProg));
         float copingMask = smoothstep(0.80, 0.86, vWallUv.y);
         float stoneMix = clamp(max(countryMask, copingMask), 0.0, 1.0);
         vec2 stoneUv = vec2((vWallWorldPos.x + vWallWorldPos.z) * 0.48, vWallWorldPos.y * 0.72);
         vec3 stoneCol = uHasStoneScan > 0.5
           ? texture2D(uStoneWallScan, stoneUv).rgb * 0.56
           : vec3(0.22, 0.21, 0.19);
         float moss = smoothstep(0.38, 0.0, vWallUv.y);
         stoneCol = mix(stoneCol, vec3(0.05, 0.10, 0.035), moss * 0.55);
         // Weather pit-straight concrete jersey wall so bright white sponsor backgrounds look like painted concrete
         diffuseColor.rgb *= (0.48 + 0.18 * stoneCol.r) * (0.68 + 0.32 * smoothstep(0.0, 0.25, vWallUv.y));
         if (stoneMix > 0.01) {
           diffuseColor.rgb = mix(diffuseColor.rgb, stoneCol, stoneMix);
         }`
      );
    };
  }

  const fenceTex = getCatchFenceTexture();
  const fenceMat = new THREE.MeshStandardMaterial({
    map: fenceTex,
    transparent: true,
    alphaTest: 0.08,
    roughness: 0.45,
    metalness: 0.65,
    side: THREE.DoubleSide
  });

  const stanchionTransforms: THREE.Matrix4[] = [];
  const woodenFenceTransforms: THREE.Matrix4[] = [];
  const wallDummy = new THREE.Object3D();

  function buildWallAndFence(latOffset: number, height = 1.18): void {
    const outSign = Math.sign(latOffset);
    // 3 separate smooth-shaded faces (Front face, Rounded Coping Cap, Back face) => 6 vertices per station
    const vertsPerRing = 6;
    const positions = new Float32Array((N + 1) * vertsPerRing * 3);
    const uvs = new Float32Array((N + 1) * vertsPerRing * 2);
    const indices: number[] = [];

    const fencePos = new Float32Array((N + 1) * 6);
    const fenceUvs = new Float32Array((N + 1) * 4);
    const fenceIndices = new Uint32Array(N * 6);
    const fenceHeight = 2.35;
    const inwardOverhang = -outSign * 0.42;

    const rawPts: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const s = samples[i];
      const sameSide = (latOffset > 0 && s.smoothCurvature > 0.12) || (latOffset < 0 && s.smoothCurvature < -0.12);
      const shrink = sameSide ? Math.min(2.6, Math.abs(s.smoothCurvature) * 8) : 0;
      const effOff = outSign * Math.max(halfW + curbWidth + 1.8, Math.abs(latOffset) - shrink);
      rawPts.push(new THREE.Vector3(
        s.pos.x + s.right.x * effOff,
        s.pos.y,
        s.pos.z + s.right.z * effOff
      ));
    }

    for (let i = 0; i <= N; i++) {
      const s = samples[i % N];
      const pPrev = rawPts[(i - 1 + N) % N];
      const pCurr = rawPts[i % N];
      const pNext = rawPts[(i + 1) % N];
      const bx = (pPrev.x + pCurr.x * 2 + pNext.x) * 0.25;
      const by = pCurr.y;
      const bz = (pPrev.z + pCurr.z * 2 + pNext.z) * 0.25;

      const rx = s.right.x * outSign;
      const rz = s.right.z * outSign;

      // 6 profile points: [0: front-base, 1: front-top, 2: coping-inner, 3: coping-peak, 4: coping-outer, 5: back-base]
      const profLat = [0.0, 0.08, 0.05, 0.27, 0.49, 0.56];
      const profY = [by - 0.14, by + height - 0.10, by + height - 0.08, by + height + 0.07, by + height - 0.08, by - 0.14];
      const profV = [0.0, 0.84, 0.86, 0.94, 0.86, 0.0];
      const u = latOffset > 0 ? 1 - i / N : i / N;

      for (let k = 0; k < vertsPerRing; k++) {
        const idx3 = (i * vertsPerRing + k) * 3;
        positions[idx3] = bx + rx * profLat[k];
        positions[idx3 + 1] = profY[k];
        positions[idx3 + 2] = bz + rz * profLat[k];

        const idx2 = (i * vertsPerRing + k) * 2;
        uvs[idx2] = u;
        uvs[idx2 + 1] = profV[k];
      }

      if (i < N) {
        const r0 = i * vertsPerRing;
        const r1 = (i + 1) * vertsPerRing;
        for (let k = 0; k < vertsPerRing - 1; k++) {
          const a = r0 + k;
          const b = r0 + k + 1;
          const c = r1 + k;
          const d = r1 + k + 1;
          if (outSign > 0) {
            indices.push(a, c, b, b, c, d);
          } else {
            indices.push(a, b, c, b, d, c);
          }
        }
      }

      // Upper 3D FIA Catch Fence anchored on coping ridge with inward safety overhang
      const p6 = i * 6;
      const cxBase = bx + rx * 0.27;
      const czBase = bz + rz * 0.27;
      fencePos[p6] = cxBase;
      fencePos[p6 + 1] = by + height + 0.04;
      fencePos[p6 + 2] = czBase;
      fencePos[p6 + 3] = cxBase + s.right.x * inwardOverhang;
      fencePos[p6 + 4] = by + height + fenceHeight;
      fencePos[p6 + 5] = czBase + s.right.z * inwardOverhang;

      const u4 = i * 4;
      const fu = (i / N) * 110;
      fenceUvs[u4] = fu; fenceUvs[u4 + 1] = 0; fenceUvs[u4 + 2] = fu; fenceUvs[u4 + 3] = 1;

      if (i < N) {
        const a = i * 2;
        const i6 = i * 6;
        fenceIndices[i6] = a; fenceIndices[i6 + 1] = a + 2; fenceIndices[i6 + 2] = a + 1;
        fenceIndices[i6 + 3] = a + 1; fenceIndices[i6 + 4] = a + 2; fenceIndices[i6 + 5] = a + 3;

        const yaw = Math.atan2(s.tangent.x, s.tangent.z);
        // Every 6 stations: real 3D Steel Catch-Fence Stanchion Post
        if (i % 6 === 0 && !s.isTunnel) {
          wallDummy.position.set(cxBase, by + height, czBase);
          wallDummy.rotation.set(0, yaw + (outSign > 0 ? 0 : Math.PI), 0);
          wallDummy.scale.set(1, 1, 1);
          wallDummy.updateMatrix();
          stanchionTransforms.push(wallDummy.matrix.clone());
        }

        // Every 5 stations along scenic countryside stretches: 3D Split-Oak Wooden Post-and-Rail Fence!
        if (isCountryTheme && i % 5 === 0 && !s.isPitZone && !s.isTunnel && i > 42 && i < N - 36) {
          wallDummy.position.set(bx + rx * 1.38, by - 0.05, bz + rz * 1.38);
          wallDummy.rotation.set(0, yaw, 0);
          wallDummy.scale.set(1, 1, 1);
          wallDummy.updateMatrix();
          woodenFenceTransforms.push(wallDummy.matrix.clone());
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, barrierMat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);

    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(fencePos, 3));
    fGeo.setAttribute('uv', new THREE.BufferAttribute(fenceUvs, 2));
    fGeo.setIndex(new THREE.BufferAttribute(fenceIndices, 1));
    fGeo.computeVertexNormals();
    const fm = new THREE.Mesh(fGeo, fenceMat);
    group.add(fm);
  }
  buildWallAndFence(-wallOff, 1.18);
  buildWallAndFence(wallOff, 1.18);

  // Instanced 3D Galvanized Steel Catch-Fence Stanchions (curved C-section posts + baseplate)
  if (stanchionTransforms.length > 0) {
    const stParts: THREE.BufferGeometry[] = [];
    const basePlate = new THREE.BoxGeometry(0.22, 0.06, 0.24);
    basePlate.translate(0, 0.03, 0);
    stParts.push(basePlate);
    const vPost = new THREE.CylinderGeometry(0.048, 0.058, 1.72, 7);
    vPost.translate(0, 0.88, 0);
    stParts.push(vPost);
    const overhangArm = new THREE.CylinderGeometry(0.042, 0.048, 0.82, 7);
    overhangArm.rotateZ(0.54);
    overhangArm.translate(-0.20, 2.05, 0);
    stParts.push(overhangArm);
    const stGeo = mergeGeometries(stParts, false)!;
    stParts.forEach((g) => g.dispose());
    const stMat = new THREE.MeshStandardMaterial({ color: '#586270', metalness: 0.78, roughness: 0.32 });
    const stInst = new THREE.InstancedMesh(stGeo, stMat, stanchionTransforms.length);
    stanchionTransforms.forEach((mat4, idx) => stInst.setMatrixAt(idx, mat4));
    group.add(stInst);
  }

  // Instanced 3D Countryside Split-Oak Wooden Post-and-Rail Fences (Forza Horizon 4 British/Parkland Timber Fence!)
  if (woodenFenceTransforms.length > 0) {
    const wfParts: THREE.BufferGeometry[] = [];
    for (const zOff of [-1.65, 1.65]) {
      const post = new THREE.BoxGeometry(0.14, 1.32, 0.14);
      post.translate(0, 0.60, zOff);
      wfParts.push(post);
      const postCap = new THREE.ConeGeometry(0.105, 0.09, 4);
      postCap.rotateY(Math.PI * 0.25);
      postCap.translate(0, 1.30, zOff);
      wfParts.push(postCap);
    }
    for (const yRail of [0.42, 0.78, 1.12]) {
      const rail = new THREE.BoxGeometry(0.065, 0.11, 3.55);
      rail.translate(-0.06, yRail, 0);
      wfParts.push(rail);
    }
    const wfGeo = mergeGeometries(wfParts, false)!;
    wfParts.forEach((g) => g.dispose());
    const wfMat = new THREE.MeshStandardMaterial({ color: '#4f3a27', roughness: 0.92, metalness: 0.02 });
    const wfInst = new THREE.InstancedMesh(wfGeo, wfMat, woodenFenceTransforms.length);
    wfInst.castShadow = true;
    wfInst.receiveShadow = true;
    woodenFenceTransforms.forEach((mat4, idx) => wfInst.setMatrixAt(idx, mat4));
    group.add(wfInst);
  }

  if (trackCfg.theme === 'alpine' || trackCfg.theme === 'city') {
    const skirtMat = new THREE.MeshStandardMaterial({
      color: trackCfg.theme === 'alpine' ? '#525860' : '#232833',
      roughness: 0.9,
      side: THREE.DoubleSide
    });
    const buildSkirt = (latOffset: number) => {
      const positions = new Float32Array((N + 1) * 6);
      const indices = new Uint32Array(N * 6);
      for (let i = 0; i <= N; i++) {
        const s = samples[i % N];
        const tx = s.pos.x + s.right.x * latOffset;
        const ty = s.pos.y;
        const tz = s.pos.z + s.right.z * latOffset;
        const p6 = i * 6;
        positions[p6] = tx; positions[p6 + 1] = ty - 0.08; positions[p6 + 2] = tz;
        positions[p6 + 3] = tx; positions[p6 + 4] = -6; positions[p6 + 5] = tz;
        if (i < N) {
          const a = i * 2;
          const i6 = i * 6;
          indices[i6] = a; indices[i6 + 1] = a + 1; indices[i6 + 2] = a + 2;
          indices[i6 + 3] = a + 1; indices[i6 + 4] = a + 3; indices[i6 + 5] = a + 2;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, skirtMat);
    };
    group.add(buildSkirt(-wallOff - 0.1));
    group.add(buildSkirt(wallOff + 0.1));
  }

  // ---------- 9. START/FINISH LINE, MERGED 10-CAR GRID & 5-LIGHT GANTRY ----------
  const startIndex = 28;
  const startSample = samples[startIndex];
  const startYaw = Math.atan2(startSample.tangent.x, startSample.tangent.z);

  const finishPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(trackCfg.trackWidth - 0.6, 3.2),
    new THREE.MeshStandardMaterial({ map: getCheckeredTexture(), roughness: 0.72 })
  );
  finishPlane.rotation.x = -Math.PI / 2;
  finishPlane.rotation.z = -startYaw;
  finishPlane.position.set(startSample.pos.x, startSample.asphaltY + 0.014, startSample.pos.z);
  group.add(finishPlane);

  const gridParts: THREE.BufferGeometry[] = [];
  for (let g = 0; g < 10; g++) {
    const idx = (startIndex - 3 - g * 3 + N) % N;
    const gs = samples[idx];
    const side = g % 2 === 0 ? -1 : 1;
    const lat = side * (halfW * 0.42);
    const gx = gs.pos.x + gs.right.x * lat;
    const gy = gs.asphaltY + 0.013;
    const gz = gs.pos.z + gs.right.z * lat;
    const gYaw = Math.atan2(gs.tangent.x, gs.tangent.z);

    const fb = new THREE.PlaneGeometry(2.4, 0.24);
    fb.rotateX(-Math.PI / 2);
    fb.translate(0, 0, 1.6);
    fb.rotateY(gYaw);
    fb.translate(gx, gy, gz);
    gridParts.push(fb);

    for (const sx of [-1.1, 1.1]) {
      const sb = new THREE.PlaneGeometry(0.18, 2.2);
      sb.rotateX(-Math.PI / 2);
      sb.translate(sx, 0, 0.6);
      sb.rotateY(gYaw);
      sb.translate(gx, gy, gz);
      gridParts.push(sb);
    }
  }
  const mergedGridGeo = mergeGeometries(gridParts, false);
  gridParts.forEach((g) => g.dispose());
  if (mergedGridGeo) {
    group.add(new THREE.Mesh(mergedGridGeo, new THREE.MeshBasicMaterial({ color: '#f4f7fb' })));
  }

  // Architectural 3D Tubular Steel Space-Frame Start Gantry (open Warren truss instead of a flat red box!)
  const gantryLights: THREE.MeshStandardMaterial[] = [];
  const gantry = new THREE.Group();
  gantry.position.copy(startSample.pos);
  gantry.rotation.y = startYaw;

  const pillarMat = new THREE.MeshStandardMaterial({ color: '#222832', metalness: 0.78, roughness: 0.28, envMapIntensity: 1.4 });
  const span = wallOff * 2 + 2.4;
  const gantryStructParts: THREE.BufferGeometry[] = [];
  const upAxis = new THREE.Vector3(0, 1, 0);
  const addTrussStrut = (p1: THREE.Vector3, p2: THREE.Vector3, r = 0.08) => {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const cyl = new THREE.CylinderGeometry(r, r, len, 6);
    cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(upAxis, dir.normalize()));
    cyl.translate((p1.x + p2.x) * 0.5, (p1.y + p2.y) * 0.5, (p1.z + p2.z) * 0.5);
    gantryStructParts.push(cyl);
  };

  // Left & Right Lattice Support Towers
  for (const side of [-1, 1]) {
    const tx = side * (wallOff + 0.9);
    for (const dz of [-0.65, 0.65]) {
      for (const dx of [-0.45, 0.45]) {
        const col = new THREE.CylinderGeometry(0.11, 0.13, 11.4, 8);
        col.translate(tx + dx, 5.7, dz);
        gantryStructParts.push(col);
      }
      for (let h = 0.5; h < 10.5; h += 2.5) {
        addTrussStrut(new THREE.Vector3(tx - 0.45, h, dz), new THREE.Vector3(tx + 0.45, h + 2.5, dz), 0.055);
        addTrussStrut(new THREE.Vector3(tx + 0.45, h, dz), new THREE.Vector3(tx - 0.45, h + 2.5, dz), 0.055);
      }
    }
  }

  // Overhead 3D Open Space-Frame Truss Chords & Diagonal Web Members
  const halfSpan = span * 0.5;
  for (const yChord of [9.6, 11.2]) {
    for (const zChord of [-0.65, 0.65]) {
      const chord = new THREE.CylinderGeometry(0.095, 0.095, span, 8);
      chord.rotateZ(Math.PI / 2);
      chord.translate(0, yChord, zChord);
      gantryStructParts.push(chord);
    }
  }
  const trussStep = 2.4;
  for (let x = -halfSpan + 0.8; x < halfSpan - 0.8; x += trussStep) {
    const xNext = Math.min(halfSpan - 0.6, x + trussStep);
    for (const zChord of [-0.65, 0.65]) {
      addTrussStrut(new THREE.Vector3(x, 9.6, zChord), new THREE.Vector3((x + xNext) * 0.5, 11.2, zChord), 0.06);
      addTrussStrut(new THREE.Vector3((x + xNext) * 0.5, 11.2, zChord), new THREE.Vector3(xNext, 9.6, zChord), 0.06);
    }
    addTrussStrut(new THREE.Vector3(x, 9.6, -0.65), new THREE.Vector3(x, 9.6, 0.65), 0.055);
    addTrussStrut(new THREE.Vector3(x, 11.2, -0.65), new THREE.Vector3(x, 11.2, 0.65), 0.055);
  }

  // Sleek Central FIA Carbon Timing Board & 5 Start Light Pods
  const timingBoard = new THREE.BoxGeometry(13.2, 1.15, 0.35);
  timingBoard.translate(0, 10.4, -0.68);
  gantryStructParts.push(timingBoard);

  for (let i = 0; i < 5; i++) {
    const xPos = (2 - i) * 2.1;
    const pod = new THREE.BoxGeometry(0.78, 1.35, 0.45);
    pod.translate(xPos, 8.75, -0.55);
    gantryStructParts.push(pod);

    const bulbMat = new THREE.MeshStandardMaterial({
      color: '#1e0808',
      emissive: '#ff0000',
      emissiveIntensity: 0.0,
      toneMapped: false
    });
    const bTop = new THREE.SphereGeometry(0.21, 10, 8);
    bTop.translate(xPos, 9.05, -0.78);
    const bBot = new THREE.SphereGeometry(0.21, 10, 8);
    bBot.translate(xPos, 8.45, -0.78);
    const mergedBulb = mergeGeometries([bTop, bBot], false)!;
    bTop.dispose(); bBot.dispose();
    gantry.add(new THREE.Mesh(mergedBulb, bulbMat));
    gantryLights.push(bulbMat);
  }
  const mergedGantryStruct = mergeGeometries(gantryStructParts, false)!;
  gantryStructParts.forEach((g) => g.dispose());
  const gantryMesh = new THREE.Mesh(mergedGantryStruct, pillarMat);
  gantryMesh.castShadow = true;
  gantry.add(gantryMesh);

  // Subtle Rolex / FIA Dark Green & Gold Timing Header Strip
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(12.8, 0.24, 0.40),
    new THREE.MeshStandardMaterial({ color: '#0b3822', metalness: 0.5, roughness: 0.25 })
  );
  banner.position.set(0, 10.95, -0.68);
  gantry.add(banner);
  group.add(gantry);

  // ---------- 10. INSTANCED BRAKING BOARDS & DRS MARKERS (4 DRAW CALLS TOTAL!) ----------
  addTracksideSignsInstanced(group, samples, N, wallOff, trackCfg, drsZonesSource);

  // ---------- 11. PBR ROLLING PARKLAND TERRAIN WITH WORLD-SPACE GRASS SHADER ----------
  const terrainPBR = getTerrainPBR(trackCfg.theme);
  const groundGeo = new THREE.PlaneGeometry(2600, 2600, 120, 120);
  groundGeo.rotateX(-Math.PI / 2);

  if (trackCfg.theme !== 'city') {
    const gPos = groundGeo.attributes.position;
    for (let v = 0; v < gPos.count; v++) {
      const gx = gPos.getX(v);
      const gz = gPos.getZ(v);

      let minD2 = Infinity;
      let nearestY = 0;
      for (let i = 0; i < N; i += 6) {
        const sp = samples[i].pos;
        const dx = gx - sp.x;
        const dz = gz - sp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD2) {
          minD2 = d2;
          nearestY = sp.y;
        }
      }
      const dist = Math.sqrt(minD2);
      // Wide flat paddock/grandstand clearance around the track so hills never poke up behind the Pit Building!
      const clearance = wallOff + (trackCfg.theme === 'monza' ? 85 : 32);
      if (dist < clearance) {
        gPos.setY(v, nearestY - 0.38);
      } else {
        const blend = Math.min(1, (dist - clearance) / 160);
        const smoothBlend = blend * blend * (3 - 2 * blend);
        let hill = 0;
        if (trackCfg.theme === 'desert') {
          hill = (Math.sin(gx * 0.009) * Math.cos(gz * 0.011) * 18 + Math.sin(gx * 0.021 + gz * 0.015) * 7 + 10) * smoothBlend;
        } else if (trackCfg.theme === 'alpine') {
          const ridge = Math.pow(Math.min(1, (dist - clearance) / 260), 1.45) * 95;
          hill = nearestY * (1 - smoothBlend * 0.35) + ridge + (Math.sin(gx * 0.014) * Math.cos(gz * 0.015) * 22) * smoothBlend;
        } else {
          // Gentle natural Parco di Monza parkland undulation (0..7m) with distant outer foothills beyond 520m radius
          const radialOut = Math.max(0, Math.hypot(gx, gz) - 520);
          const outerFoothill = Math.pow(Math.min(1, radialOut / 480), 1.5) * 28;
          hill = outerFoothill + (Math.sin(gx * 0.0075) * Math.cos(gz * 0.0085) * 4.5 + Math.sin(gx * 0.018 - gz * 0.015) * 2.0) * smoothBlend;
        }
        gPos.setY(v, hill - 0.38);
      }
    }
    groundGeo.computeVertexNormals();
  } else {
    groundGeo.translate(0, -0.38, 0);
  }

  const groundMat = new THREE.MeshStandardMaterial({
    map: scanGrass ? scanGrass.albedo : terrainPBR.map,
    normalMap: scanGrass ? scanGrass.normal : terrainPBR.normalMap,
    normalScale: new THREE.Vector2(1.05, 1.05),
    roughnessMap: scanGrass ? scanGrass.orm : undefined,
    roughness: 0.92,
    metalness: 0.02
  });
  applyWorldGrassShader(groundMat, false);
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.receiveShadow = true;
  group.add(groundMesh);

  // ---------- 12. ARCHITECTURAL GRANDSTANDS, PIT GARAGES, PIT-WALL CANOPY, SAFETY CAR & HELICOPTER ----------
  addGrandstandsAndPitBuilding(group, samples, N, wallOff, trackCfg);
  const pitCrewGroup = buildPitCrewTeam();
  group.add(pitCrewGroup);
  const helicopterGroup = buildTVHelicopter();
  group.add(helicopterGroup);

  const safetyCarGroup = buildSafetyCar();
  safetyCarGroup.visible = true;
  const scStart = samples[(startIndex + 6) % N];
  const scStandbyLat = Math.min(wallOff - 2.2, halfW + curbWidth + 2.2);
  const scStandbyPos = new THREE.Vector3(
    scStart.pos.x + scStart.right.x * scStandbyLat,
    scStart.asphaltY,
    scStart.pos.z + scStart.right.z * scStandbyLat
  );
  const scStandbyYaw = Math.atan2(scStart.tangent.x, scStart.tangent.z) - 0.14;
  safetyCarGroup.position.copy(scStandbyPos);
  safetyCarGroup.rotation.y = scStandbyYaw;
  safetyCarGroup.userData.standbyPos = scStandbyPos;
  safetyCarGroup.userData.standbyYaw = scStandbyYaw;
  group.add(safetyCarGroup);

  if (trackCfg.theme === 'monza') {
    addTreesInstancedAAA(group, samples, N, wallOff, halfW + curbWidth, 'deciduous', Math.round(1280 * qCfg.treeMult));
    addAlpineMountainRange(group, false);
  } else if (trackCfg.theme === 'alpine') {
    addTreesInstancedAAA(group, samples, N, wallOff, halfW + curbWidth, 'pine', Math.round(1220 * qCfg.treeMult));
    addAlpineMountainRange(group, true);
  } else if (trackCfg.theme === 'desert') {
    addDesertTowersAndFloodlights(group, samples, N, wallOff);
  } else if (trackCfg.theme === 'city') {
    addNightCitySceneryOptimized(group, samples, N, wallOff, trackCfg);
  }

  // ---------- 13. POOLED PERSISTENT SKIDMARKS ----------
  const MAX_SKIDS = 900;
  const skidGeo = new THREE.PlaneGeometry(0.42, 1.35);
  skidGeo.rotateX(-Math.PI / 2);
  const skidMat = new THREE.MeshBasicMaterial({
    color: '#0a0b0d',
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2
  });
  const skidMesh = new THREE.InstancedMesh(skidGeo, skidMat, MAX_SKIDS);
  skidMesh.frustumCulled = false;
  const skidDummy = new THREE.Object3D();
  skidDummy.position.set(0, -9999, 0);
  skidDummy.updateMatrix();
  for (let i = 0; i < MAX_SKIDS; i++) skidMesh.setMatrixAt(i, skidDummy.matrix);
  skidMesh.instanceMatrix.needsUpdate = true;
  group.add(skidMesh);

  let skidCursor = 0;
  function addSkidmark(x: number, y: number, z: number, yaw: number, intensity: number): void {
    skidDummy.position.set(x, y + 0.018, z);
    skidDummy.rotation.set(0, yaw, 0);
    const s = 0.8 + intensity * 0.45;
    skidDummy.scale.set(s, 1, 1.15);
    skidDummy.updateMatrix();
    skidMesh.setMatrixAt(skidCursor, skidDummy.matrix);
    skidCursor = (skidCursor + 1) % MAX_SKIDS;
    skidMesh.instanceMatrix.needsUpdate = true;
  }

  scene.add(group);

  // ---------- 14. EXACT ZERO-GC TRACK QUERY ----------
  const segTangentScratch = new THREE.Vector3();

  function queryTrack(worldPos: THREE.Vector3, hintIndex = 0, out: TrackQueryResult | null = null): TrackQueryResult {
    let bestIdx = ((hintIndex % N) + N) % N;
    let bestDistSq = Infinity;

    const windowRadius = 26;
    for (let k = -windowRadius; k <= windowRadius; k++) {
      const idx = (bestIdx + k + N) % N;
      const p = samples[idx].pos;
      const dx = worldPos.x - p.x;
      const dz = worldPos.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestIdx = idx;
      }
    }

    if (bestDistSq > 1800) {
      for (let i = 0; i < N; i += 3) {
        const p = samples[i].pos;
        const dx = worldPos.x - p.x;
        const dz = worldPos.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = i;
        }
      }
    }

    const prevIdx = (bestIdx - 1 + N) % N;
    const nextIdx = (bestIdx + 1) % N;
    const pPrev = samples[prevIdx].pos;
    const pCurr = samples[bestIdx].pos;
    const pNext = samples[nextIdx].pos;

    const abX = pNext.x - pCurr.x;
    const abZ = pNext.z - pCurr.z;
    const abLenSq = abX * abX + abZ * abZ || 1;
    const fracFwd = ((worldPos.x - pCurr.x) * abX + (worldPos.z - pCurr.z) * abZ) / abLenSq;

    let sA: TrackSample, sB: TrackSample, frac: number;
    if (fracFwd >= 0) {
      sA = samples[bestIdx];
      sB = samples[nextIdx];
      frac = Math.min(1, fracFwd);
    } else {
      const paX = pCurr.x - pPrev.x;
      const paZ = pCurr.z - pPrev.z;
      const paLenSq = paX * paX + paZ * paZ || 1;
      sA = samples[prevIdx];
      sB = samples[bestIdx];
      frac = THREE.MathUtils.clamp(((worldPos.x - pPrev.x) * paX + (worldPos.z - pPrev.z) * paZ) / paLenSq, 0, 1);
    }

    const ix = sA.pos.x + (sB.pos.x - sA.pos.x) * frac;
    const iz = sA.pos.z + (sB.pos.z - sA.pos.z) * frac;
    const exactAsphaltY = sA.asphaltY + (sB.asphaltY - sA.asphaltY) * frac + sA.bumpOffset;

    const rx = sA.right.x + (sB.right.x - sA.right.x) * frac;
    const rz = sA.right.z + (sB.right.z - sA.right.z) * frac;
    const rLen = Math.hypot(rx, rz) || 1;
    const rightX = rx / rLen;
    const rightZ = rz / rLen;

    segTangentScratch.set(
      sB.pos.x - sA.pos.x,
      sB.asphaltY - sA.asphaltY,
      sB.pos.z - sA.pos.z
    ).normalize();

    const ox = worldPos.x - ix;
    const oz = worldPos.z - iz;
    const lateral = ox * rightX + oz * rightZ;
    const absLat = Math.abs(lateral);

    let surfaceY = exactAsphaltY;
    if (absLat > halfW && absLat <= halfW + curbWidth) {
      const curbFrac = (absLat - halfW) / curbWidth;
      surfaceY = exactAsphaltY + (1 - curbFrac) * 0.04;
    } else if (absLat > halfW + curbWidth) {
      surfaceY = exactAsphaltY - 0.045;
    }

    const segDist = Math.hypot(sB.pos.x - sA.pos.x, sB.pos.z - sA.pos.z);
    const sProgress = (sA.s + frac * segDist + totalLength) % totalLength;

    const res: TrackQueryResult = out || {
      index: 0, s: 0, t: 0,
      surfaceY: 0,
      tangentX: 0, tangentY: 0, tangentZ: 1,
      rightX: 1, rightZ: 0,
      curvature: 0, camber: 0, isPuddle: false, idealLateral: 0, aiTargetSpeed: 90, lateral: 0,
      onTrack: true, onCurb: false, offTrack: false,
      wallLimit: wallOff - 1.35,
      isTunnel: false, isDrsZone: false, isPitZone: false
    };

    res.index = sA.index;
    res.s = sProgress;
    res.t = sProgress / totalLength;
    res.surfaceY = surfaceY;
    res.tangentX = segTangentScratch.x;
    res.tangentY = segTangentScratch.y;
    res.tangentZ = segTangentScratch.z;
    res.rightX = rightX;
    res.rightZ = rightZ;
    res.curvature = sA.smoothCurvature;
    res.camber = sA.camber;
    res.isPuddle = sA.isPuddle;
    res.idealLateral = sA.idealLateral;
    res.aiTargetSpeed = sA.aiTargetSpeed + (sB.aiTargetSpeed - sA.aiTargetSpeed) * frac;
    res.lateral = lateral;
    res.onTrack = absLat <= halfW;
    res.onCurb = absLat > halfW && absLat <= halfW + curbWidth;
    res.offTrack = absLat > halfW + curbWidth;
    res.wallLimit = wallOff - 1.35;
    res.isTunnel = sA.isTunnel;
    res.isDrsZone = sA.isDrsZone;
    res.isPitZone = sA.isPitZone;
    return res;
  }

  const initWetness = weather === 'rain' ? 0.85 : weather === 'dynamic' ? 0.25 : 0.0;
  const initTrackTemp = trackCfg.theme === 'desert' ? 42 : trackCfg.theme === 'city' ? 24 : weather === 'rain' ? 21 : 34;

  return {
    group,
    config: trackCfg,
    samples,
    N,
    totalLength,
    startIndex,
    startS: samples[startIndex].s,
    dirLight,
    heroShadowLight,
    gantryLights,
    racingLineMesh,
    pitCrewGroup,
    helicopterGroup,
    safetyCarGroup,
    skyUniforms,
    envMap,
    trackWetness: initWetness,
    dryingLineGrip: 1 - initWetness * 0.6,
    rubberEvolution: 0,
    trackTempC: initTrackTemp,
    windSpeedMS: trackCfg.theme === 'desert' ? 6.5 : 3.2,
    windDirRad: 0.75,
    queryTrack,
    addSkidmark
  };
}

/**
 * Forza Horizon 6 Hybrid Real 32-Bit Poly Haven .HDR + Rayleigh/Mie Atmospheric Sky Dome Shader
 * Blends real photographed 2K HDR clouds & golden-hour horizon scatter with dynamic solar disc & night stars!
 */
function buildPhysicalSkyDome(trackCfg: TrackConfig, weather: 'dry' | 'overcast' | 'rain') {
  const isNight = trackCfg.theme === 'city';
  const topHex = weather === 'rain' && !isNight ? '#1b2430' : trackCfg.skyTop;
  const horHex = weather === 'rain' && !isNight ? '#506072' : trackCfg.skyHorizon;
  const hdrTex = fh6Assets.hdriEquirect.get(trackCfg.theme) || null;

  const skyUniforms = {
    uSunDir: { value: new THREE.Vector3(...trackCfg.sunPos).normalize() },
    uSkyTop: { value: new THREE.Color(topHex) },
    uSkyHorizon: { value: new THREE.Color(horHex) },
    uSunColor: { value: new THREE.Color(trackCfg.sunColor) },
    uNightFactor: { value: isNight ? 1.0 : 0.0 },
    uHdrSky: { value: hdrTex },
    uHasHdrSky: { value: hdrTex && !isNight ? 1.0 : 0.0 },
    uWeatherDim: { value: weather === 'rain' ? 0.36 : weather === 'overcast' ? 0.68 : 1.0 }
  };

  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldDir;
      uniform vec3 uSunDir;
      uniform vec3 uSkyTop;
      uniform vec3 uSkyHorizon;
      uniform vec3 uSunColor;
      uniform float uNightFactor;
      uniform sampler2D uHdrSky;
      uniform float uHasHdrSky;
      uniform float uWeatherDim;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float hash2(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
          mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      float fbmClouds(vec2 p) {
        float v = 0.0;
        float a = 0.52;
        mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
        for (int i = 0; i < 4; i++) {
          v += a * noise2(p);
          p = rot * p * 2.05;
          a *= 0.48;
        }
        return v;
      }

      void main() {
        vec3 d = normalize(vWorldDir);
        float elev = clamp(d.y, 0.0, 1.0);
        vec3 sDir = normalize(uSunDir);
        float sunDot = max(0.0, dot(d, sDir));

        vec3 col = mix(uSkyHorizon, uSkyTop, pow(elev, 0.50));
        float horizonGlow = pow(1.0 - elev, 4.5);
        col = mix(col, mix(uSkyHorizon, uSunColor, 0.32), horizonGlow * 0.45 * (1.0 - uNightFactor));

        if (uHasHdrSky > 0.5 && uNightFactor < 0.75) {
          // Sample REAL 32-Bit Photographed Poly Haven Equirectangular Sky!
          float phi = atan(d.z, d.x);
          float theta = asin(clamp(d.y, -1.0, 1.0));
          vec2 eqUv = vec2(phi * 0.15915494 + 0.5, theta * 0.31830988 + 0.5);
          vec3 hdrCol = clamp(texture2D(uHdrSky, eqUv).rgb * 0.88 * uWeatherDim, vec3(0.0), vec3(7.5));
          // Smoothly ground below-horizon pixels into atmospheric horizon mist
          float aboveHor = smoothstep(-0.02, 0.06, d.y);
          col = mix(col, hdrCol, aboveHor * 0.90);
        } else if (d.y > 0.02 && uNightFactor < 0.75) {
          vec2 cloudUv = d.xz / (d.y + 0.16);
          float cDensity = fbmClouds(cloudUv * 1.25);
          float cDetail = fbmClouds(cloudUv * 3.1 + vec2(1.7, -0.9));
          float cloudMask = smoothstep(0.41, 0.71, cDensity * 0.76 + cDetail * 0.24);
          float horizonFade = smoothstep(0.02, 0.20, d.y);
          vec3 cloudShadowCol = mix(uSkyTop * 0.55, vec3(0.36, 0.43, 0.52), 0.52);
          vec3 cloudLightCol = mix(vec3(0.98, 0.99, 1.0), uSunColor, 0.25) * (1.12 + pow(sunDot, 4.0) * 0.85);
          float lightGrad = smoothstep(0.38, 0.74, cDetail + sunDot * 0.28 + d.y * 0.15);
          vec3 cloudCol = mix(cloudShadowCol, cloudLightCol, lightGrad);
          col = mix(col, cloudCol, cloudMask * horizonFade * 0.86);
        }

        // Mie Solar Halo & HDR Sun Disc aligned with directional shadow sun!
        float mieHalo = pow(sunDot, 10.0) * 0.38 * (1.0 - uNightFactor * 0.8);
        float sunDisc = smoothstep(0.9982, 0.9995, sunDot) * 2.4 * (1.0 - uNightFactor);
        col += uSunColor * (mieHalo + sunDisc);

        if (uNightFactor > 0.15 && d.y > 0.06) {
          float s = hash(floor(d * 340.0));
          if (s > 0.9955) {
            col += vec3(smoothstep(0.9955, 0.999, s) * 1.6 * uNightFactor * smoothstep(0.06, 0.25, d.y));
          }
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });

  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1650, 40, 24), skyMat);
  return { skyMesh, skyUniforms };
}

/**
 * Forza Horizon 4 Style Glowing Cyan-Blue Double-Chevron Racing Line Projected on Tarmac
 */
let cachedChevronTex: THREE.CanvasTexture | null = null;
function getChevronLineTexture(): THREE.CanvasTexture {
  if (cachedChevronTex) return cachedChevronTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);

  // Soft outer glow + crisp Forza Horizon chevron arrow
  for (const pass of [
    { inset: 10, thickness: 28, alpha: 0.32 },
    { inset: 16, thickness: 18, alpha: 0.92 }
  ]) {
    ctx.beginPath();
    ctx.moveTo(pass.inset, 88);
    ctx.lineTo(64, 24);
    ctx.lineTo(128 - pass.inset, 88);
    ctx.lineTo(128 - pass.inset - pass.thickness * 0.7, 88 + pass.thickness * 0.65);
    ctx.lineTo(64, 24 + pass.thickness * 1.15);
    ctx.lineTo(pass.inset + pass.thickness * 0.7, 88 + pass.thickness * 0.65);
    ctx.closePath();
    ctx.fillStyle = `rgba(255, 255, 255, ${pass.alpha})`;
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  cachedChevronTex = tex;
  return tex;
}

function buildChevronRacingLineMesh(samples: TrackSample[], N: number, totalLength: number): THREE.Mesh {
  const positions = new Float32Array((N + 1) * 6);
  const colors = new Float32Array((N + 1) * 6);
  const uvs = new Float32Array((N + 1) * 4);
  const indices = new Uint32Array(N * 6);
  const lineHalfW = 0.62;
  const col = new THREE.Color();
  const vRepeats = Math.round(totalLength / 3.2);

  for (let i = 0; i <= N; i++) {
    const s = samples[i % N];
    const next = samples[(i + 6) % N];
    const decel = s.aiTargetSpeed - next.aiTargetSpeed;

    // Forza Horizon 4 palette: glowing cyan-blue (#38b6ff) on full-throttle, amber (#ff9d1a) on lift, red-orange (#ff2a18) on hard braking
    if (decel > 6.0) col.set('#ff2e1a');
    else if (decel > 1.8 || s.aiTargetSpeed < 58) col.set('#ff9e18');
    else col.set('#38b6ff');

    const cx = s.pos.x + s.right.x * s.idealLateral;
    const cz = s.pos.z + s.right.z * s.idealLateral;
    const cy = s.asphaltY + 0.004;

    const p6 = i * 6;
    positions[p6] = cx - s.right.x * lineHalfW;
    positions[p6 + 1] = cy;
    positions[p6 + 2] = cz - s.right.z * lineHalfW;
    positions[p6 + 3] = cx + s.right.x * lineHalfW;
    positions[p6 + 4] = cy;
    positions[p6 + 5] = cz + s.right.z * lineHalfW;

    colors[p6] = col.r; colors[p6 + 1] = col.g; colors[p6 + 2] = col.b;
    colors[p6 + 3] = col.r; colors[p6 + 4] = col.g; colors[p6 + 5] = col.b;

    const v = (i / N) * vRepeats;
    const u4 = i * 4;
    uvs[u4] = 0; uvs[u4 + 1] = v; uvs[u4 + 2] = 1; uvs[u4 + 3] = v;

    if (i < N) {
      const a = i * 2;
      const i6 = i * 6;
      indices[i6] = a; indices[i6 + 1] = a + 1; indices[i6 + 2] = a + 2;
      indices[i6 + 3] = a + 1; indices[i6 + 4] = a + 3; indices[i6 + 5] = a + 2;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  const mat = new THREE.MeshBasicMaterial({
    map: getChevronLineTexture(),
    vertexColors: true,
    transparent: true,
    opacity: 0.54,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}

function normTrackGeo(rawGeo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = rawGeo.index ? rawGeo.toNonIndexed() : rawGeo.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const count = g.attributes.position.count;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  for (const key of Object.keys(g.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'uv') {
      g.deleteAttribute(key);
    }
  }
  rawGeo.dispose();
  return g;
}

function buildTaperedTubeGeo(
  points: THREE.Vector3[],
  rStart: number,
  rEnd: number,
  tubularSegs = 14,
  radialSegs = 8
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(tubularSegs, false);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= tubularSegs; i++) {
    const t = i / tubularSegs;
    const pt = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    // Root flare boost near t = 0
    const rootFlare = t < 0.16 ? Math.pow(1 - t / 0.16, 2) * rStart * 0.38 : 0;
    const r = THREE.MathUtils.lerp(rStart, rEnd, Math.pow(t, 0.85)) + rootFlare;

    for (let j = 0; j <= radialSegs; j++) {
      const theta = (j / radialSegs) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      // Slight organic bark fluting near base
      const flute = 1.0 + (1.0 - t) * 0.08 * Math.sin(theta * 5.0 + t * 8.0);
      const rx = (N.x * cosT + B.x * sinT) * r * flute;
      const ry = (N.y * cosT + B.y * sinT) * r * flute;
      const rz = (N.z * cosT + B.z * sinT) * r * flute;
      positions.push(pt.x + rx, pt.y + ry, pt.z + rz);
      uvs.push(j / radialSegs, t * 4.0);
    }
  }

  const ring = radialSegs + 1;
  for (let i = 0; i < tubularSegs; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      const c = (i + 1) * ring + (j + 1);
      const d = i * ring + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Ultra-Realistic CAD-Sculpted Aston Martin Vantage / AMG GT FIA Safety Car
 * Smooth Catmull-Rom widebody hull, teardrop coupe glasshouse, swan-neck GT wing, splitter/diffuser, quad exhausts & forged wheels!
 */
function buildSafetyCar(): THREE.Group {
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: '#006b54',
    metalness: 0.80,
    roughness: 0.14,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    iridescence: 0.08,
    envMapIntensity: 1.95
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    map: getCarbonTexture(),
    normalMap: getCarbonNormalTexture(),
    color: '#181c24',
    metalness: 0.35,
    roughness: 0.38
  });
  const chromeMat = new THREE.MeshStandardMaterial({ color: '#d8e0ea', metalness: 0.95, roughness: 0.10 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#070f18',
    metalness: 0.94,
    roughness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    envMapIntensity: 2.1
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: '#121419', roughness: 0.76, metalness: 0.06 });

  if (fh6Assets.safetyCarPremerged) {
    const sc = new THREE.Group();
    const tpl = fh6Assets.safetyCarPremerged;
    const strobeMat = new THREE.MeshStandardMaterial({
      color: '#ff9900',
      emissive: '#ff6a00',
      emissiveIntensity: 3.6,
      toneMapped: false
    });
    const hlMat = new THREE.MeshBasicMaterial({ color: '#eef6ff', toneMapped: false });
    const tlMat = new THREE.MeshBasicMaterial({ color: '#ff1408', toneMapped: false });

    const plateCanvas = document.createElement('canvas');
    plateCanvas.width = 256;
    plateCanvas.height = 64;
    const pCtx = plateCanvas.getContext('2d')!;
    pCtx.fillStyle = '#f2be1a';
    pCtx.fillRect(0, 0, 256, 64);
    pCtx.strokeStyle = '#181a1f';
    pCtx.lineWidth = 5;
    pCtx.strokeRect(3, 3, 250, 58);
    pCtx.fillStyle = '#111318';
    pCtx.font = '900 36px system-ui, sans-serif';
    pCtx.textAlign = 'center';
    pCtx.textBaseline = 'middle';
    pCtx.fillText('HORIZON', 128, 34);
    const plateTex = new THREE.CanvasTexture(plateCanvas);
    plateTex.colorSpace = THREE.SRGBColorSpace;
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.32 });

    const scMatMap: Record<string, THREE.Material> = {
      SC_Body_Paint: bodyMat,
      SC_Cabin_Glass: glassMat,
      SC_Carbon: carbonMat,
      SC_Chrome: chromeMat,
      SC_Tire: tireMat,
      SC_Headlight: hlMat,
      SC_Taillight: tlMat,
      SC_Plate: plateMat,
    };

    for (const [mName, geo] of Object.entries(tpl.byMat)) {
      if (mName === 'SC_Plate') continue;
      const mesh = new THREE.Mesh(geo, scMatMap[mName] || carbonMat);
      mesh.castShadow = mName === 'SC_Body_Paint' || mName === 'SC_Cabin_Glass' || mName === 'SC_Carbon' || mName === 'SC_Tire';
      mesh.receiveShadow = true;
      sc.add(mesh);
    }
    const rearPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.118), plateMat);
    rearPlate.rotation.y = Math.PI;
    rearPlate.position.set(0, 0.485, -2.316);
    sc.add(rearPlate);
    if (tpl.lightbarGeo) {
      const lb = new THREE.Mesh(tpl.lightbarGeo, strobeMat);
      lb.name = 'scLightbar';
      sc.add(lb);
    }
    return sc;
  }

  const sc = new THREE.Group();

  // 1. Smooth Catmull-Rom Widebody GT Chassis Hull (Fallback)
  const bodySlices: LoftSlice[] = [
    { z: -2.26, wBottom: 0.84, wTop: 0.78, yBottom: 0.22, yTop: 0.78, wMidScale: 1.05 },
    { z: -1.85, wBottom: 0.98, wTop: 0.88, yBottom: 0.16, yTop: 0.86, wMidScale: 1.08 },
    { z: -1.25, wBottom: 1.01, wTop: 0.90, yBottom: 0.14, yTop: 0.88, wMidScale: 1.08 },
    { z: -0.40, wBottom: 0.95, wTop: 0.86, yBottom: 0.13, yTop: 0.86, wMidScale: 1.06 },
    { z: 0.45,  wBottom: 0.96, wTop: 0.86, yBottom: 0.13, yTop: 0.84, wMidScale: 1.07 },
    { z: 1.35,  wBottom: 1.00, wTop: 0.88, yBottom: 0.14, yTop: 0.78, wMidScale: 1.08 },
    { z: 1.98,  wBottom: 0.92, wTop: 0.80, yBottom: 0.15, yTop: 0.66, wMidScale: 1.06 },
    { z: 2.28,  wBottom: 0.76, wTop: 0.62, yBottom: 0.16, yTop: 0.50, wMidScale: 1.04 }
  ];
  const bodyParts: THREE.BufferGeometry[] = [normTrackGeo(buildSmoothLoftedHull(bodySlices, 36, 28))];
  for (const sx of [-1, 1]) {
    const mirror = new THREE.SphereGeometry(0.09, 10, 8);
    mirror.scale(1.3, 0.72, 1.5);
    mirror.translate(sx * 0.98, 0.90, 0.46);
    bodyParts.push(normTrackGeo(mirror));
  }
  const bodyMesh = new THREE.Mesh(mergeGeometries(bodyParts, false)!, bodyMat);
  bodyParts.forEach((g) => g.dispose());
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  sc.add(bodyMesh);

  // 2. Sculpted Teardrop Fastback Glasshouse Cabin
  const cabinSlices: LoftSlice[] = [
    { z: -1.62, wBottom: 0.68, wTop: 0.52, yBottom: 0.82, yTop: 0.92, wMidScale: 1.03 },
    { z: -0.95, wBottom: 0.80, wTop: 0.64, yBottom: 0.84, yTop: 1.22, wMidScale: 1.05 },
    { z: -0.15, wBottom: 0.82, wTop: 0.68, yBottom: 0.84, yTop: 1.26, wMidScale: 1.05 },
    { z: 0.52,  wBottom: 0.80, wTop: 0.66, yBottom: 0.82, yTop: 1.08, wMidScale: 1.04 },
    { z: 0.88,  wBottom: 0.74, wTop: 0.62, yBottom: 0.80, yTop: 0.86, wMidScale: 1.02 }
  ];
  const cabinGeo = buildSmoothLoftedHull(cabinSlices, 30, 18);
  const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
  cabinMesh.castShadow = true;
  sc.add(cabinMesh);

  // 3. Carbon Aero Splitter, Side Skirts, Rear Venturi Diffuser, Grille & Swan-Neck GT Rear Wing
  const carbonParts: THREE.BufferGeometry[] = [];
  const frontSplitter = new THREE.BoxGeometry(1.96, 0.045, 0.52);
  frontSplitter.translate(0, 0.12, 2.08);
  carbonParts.push(normTrackGeo(frontSplitter));

  const grille = new THREE.BoxGeometry(1.24, 0.24, 0.08);
  grille.translate(0, 0.34, 2.27);
  carbonParts.push(normTrackGeo(grille));

  for (const sx of [-1, 1]) {
    const skirt = new THREE.BoxGeometry(0.12, 0.055, 2.45);
    skirt.translate(sx * 0.98, 0.13, 0.0);
    carbonParts.push(normTrackGeo(skirt));

    const pylon = new THREE.BoxGeometry(0.04, 0.28, 0.22);
    pylon.rotateX(-0.24);
    pylon.translate(sx * 0.44, 0.96, -2.02);
    carbonParts.push(normTrackGeo(pylon));

    const endplate = new THREE.BoxGeometry(0.025, 0.20, 0.34);
    endplate.translate(sx * 0.86, 1.10, -2.10);
    carbonParts.push(normTrackGeo(endplate));
  }

  const gtWing = new THREE.BoxGeometry(1.72, 0.038, 0.28);
  gtWing.rotateX(0.14);
  gtWing.translate(0, 1.10, -2.10);
  carbonParts.push(normTrackGeo(gtWing));

  const rearFascia = new THREE.BoxGeometry(1.56, 0.34, 0.10);
  rearFascia.translate(0, 0.48, -2.23);
  carbonParts.push(normTrackGeo(rearFascia));

  const rearDiffuser = new THREE.BoxGeometry(1.68, 0.20, 0.34);
  rearDiffuser.translate(0, 0.22, -2.18);
  carbonParts.push(normTrackGeo(rearDiffuser));
  for (let d = -3; d <= 3; d++) {
    if (d === 0) continue;
    const fin = new THREE.BoxGeometry(0.02, 0.16, 0.36);
    fin.translate(d * 0.20, 0.19, -2.20);
    carbonParts.push(normTrackGeo(fin));
  }

  const lightBridge = new THREE.BoxGeometry(1.18, 0.04, 0.22);
  lightBridge.translate(0, 1.27, -0.15);
  carbonParts.push(normTrackGeo(lightBridge));

  const mergedCarbon = mergeGeometries(carbonParts, false)!;
  carbonParts.forEach((g) => g.dispose());
  sc.add(new THREE.Mesh(mergedCarbon, carbonMat));

  // 4. Quad Chrome Exhausts & Grille Slats + Forged Multi-Spoke Alloy Rims
  const chromeParts: THREE.BufferGeometry[] = [];
  for (const ex of [-0.62, -0.49, 0.49, 0.62]) {
    const pipe = new THREE.CylinderGeometry(0.048, 0.048, 0.18, 12);
    pipe.rotateX(Math.PI * 0.5);
    pipe.translate(ex, 0.22, -2.28);
    chromeParts.push(normTrackGeo(pipe));
  }
  for (let g = -4; g <= 4; g++) {
    const slat = new THREE.BoxGeometry(0.016, 0.20, 0.09);
    slat.translate(g * 0.13, 0.34, 2.28);
    chromeParts.push(normTrackGeo(slat));
  }

  // 4 Forged 10-Spoke GT Wheels & Tires
  const tireParts: THREE.BufferGeometry[] = [];
  const wheelProfile = [
    new THREE.Vector2(0.24, -0.14),
    new THREE.Vector2(0.345, -0.13),
    new THREE.Vector2(0.355, -0.09),
    new THREE.Vector2(0.355, 0.09),
    new THREE.Vector2(0.345, 0.13),
    new THREE.Vector2(0.24, 0.14)
  ];
  const baseTireLathe = new THREE.LatheGeometry(wheelProfile, 28);
  baseTireLathe.rotateZ(Math.PI * 0.5);

  for (const [wx, wz] of [[-0.93, 1.38], [0.93, 1.38], [-0.95, -1.38], [0.95, -1.38]]) {
    const tClone = baseTireLathe.clone();
    tClone.translate(wx, 0.355, wz);
    tireParts.push(normTrackGeo(tClone));

    const rimBarrel = new THREE.CylinderGeometry(0.245, 0.245, 0.24, 20);
    rimBarrel.rotateZ(Math.PI * 0.5);
    rimBarrel.translate(wx, 0.355, wz);
    chromeParts.push(normTrackGeo(rimBarrel));

    const outX = wx + Math.sign(wx) * 0.125;
    for (let sp = 0; sp < 5; sp++) {
      const spoke = new THREE.BoxGeometry(0.022, 0.46, 0.036);
      spoke.rotateX((sp / 5) * Math.PI);
      spoke.translate(outX, 0.355, wz);
      chromeParts.push(normTrackGeo(spoke));
    }
  }
  baseTireLathe.dispose();

  const mergedTires = mergeGeometries(tireParts, false)!;
  tireParts.forEach((g) => g.dispose());
  sc.add(new THREE.Mesh(mergedTires, tireMat));

  const mergedChrome = mergeGeometries(chromeParts, false)!;
  chromeParts.forEach((g) => g.dispose());
  sc.add(new THREE.Mesh(mergedChrome, chromeMat));

  // 5. HDR Flashing FIA Roof Strobe Lightbar (Preserves name 'scLightbar')
  const strobeMat = new THREE.MeshStandardMaterial({
    color: '#ff9900',
    emissive: '#ff6a00',
    emissiveIntensity: 3.5,
    toneMapped: false
  });
  const lbParts: THREE.BufferGeometry[] = [];
  for (const sx of [-0.36, 0.36]) {
    const pod = new THREE.CapsuleGeometry(0.055, 0.36, 6, 12);
    pod.rotateZ(Math.PI * 0.5);
    pod.scale(1, 0.85, 1.4);
    pod.translate(sx, 1.31, -0.15);
    lbParts.push(normTrackGeo(pod));
  }
  const lightbar = new THREE.Mesh(mergeGeometries(lbParts, false)!, strobeMat);
  lbParts.forEach((g) => g.dispose());
  lightbar.name = 'scLightbar';
  sc.add(lightbar);

  // 6. Swept LED Projector Headlights, Aston Blade LED Taillight & UK Yellow "HORIZON" Rear Plate!
  const hlMat = new THREE.MeshBasicMaterial({ color: '#eef6ff', toneMapped: false });
  const tlMat = new THREE.MeshBasicMaterial({ color: '#ff1408', toneMapped: false });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.24, 4, 8), hlMat);
    hl.rotation.set(0.25, sx * 0.38, Math.PI * 0.5 - sx * 0.15);
    hl.position.set(sx * 0.72, 0.54, 2.08);
    sc.add(hl);
  }
  const tailBlade = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.045, 0.06), tlMat);
  tailBlade.position.set(0, 0.70, -2.27);
  sc.add(tailBlade);

  const plateCanvas = document.createElement('canvas');
  plateCanvas.width = 256;
  plateCanvas.height = 64;
  const pCtx = plateCanvas.getContext('2d')!;
  pCtx.fillStyle = '#f2be1a';
  pCtx.fillRect(0, 0, 256, 64);
  pCtx.strokeStyle = '#181a1f';
  pCtx.lineWidth = 5;
  pCtx.strokeRect(3, 3, 250, 58);
  pCtx.fillStyle = '#111318';
  pCtx.font = '900 36px system-ui, sans-serif';
  pCtx.textAlign = 'center';
  pCtx.textBaseline = 'middle';
  pCtx.fillText('HORIZON', 128, 34);
  const plateTex = new THREE.CanvasTexture(plateCanvas);
  plateTex.colorSpace = THREE.SRGBColorSpace;
  const rearPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.50, 0.115), new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.35 }));
  rearPlate.rotation.y = Math.PI;
  rearPlate.position.set(0, 0.48, -2.285);
  sc.add(rearPlate);

  return sc;
}

/**
 * Articulated 3D FIA Pit-Stop Crew Mechanics with Pneumatic Wheel Guns & Quick-Lift Carbon Jacks
 */
function buildPitCrewTeam(): THREE.Group {
  const crew = new THREE.Group();
  crew.visible = false;
  const suitMat = new THREE.MeshStandardMaterial({ color: '#c91414', roughness: 0.64, metalness: 0.04 });
  const darkGearMat = new THREE.MeshStandardMaterial({ color: '#151922', roughness: 0.42, metalness: 0.55 });
  const helmMat = new THREE.MeshPhysicalMaterial({ color: '#101520', metalness: 0.75, roughness: 0.16, clearcoat: 1.0 });
  const visorMat = new THREE.MeshStandardMaterial({ color: '#ffb800', metalness: 0.95, roughness: 0.08 });
  const metalMat = new THREE.MeshStandardMaterial({ color: '#aeb8c6', metalness: 0.88, roughness: 0.22 });

  const specs = [
    { x: -1.42, z: 1.68, yaw: Math.PI * 0.5, role: 'gunner' },
    { x: 1.42,  z: 1.68, yaw: -Math.PI * 0.5, role: 'gunner' },
    { x: -1.42, z: -1.68, yaw: Math.PI * 0.5, role: 'gunner' },
    { x: 1.42,  z: -1.68, yaw: -Math.PI * 0.5, role: 'gunner' },
    { x: 0,     z: 3.32, yaw: Math.PI, role: 'jack' },
    { x: 0,     z: -3.22, yaw: 0, role: 'jack' }
  ] as const;

  for (const sp of specs) {
    const m = new THREE.Group();
    m.position.set(sp.x, 0, sp.z);
    m.rotation.y = sp.yaw;

    const isGunner = sp.role === 'gunner';
    const crouch = isGunner ? 0.24 : 0.0;

    const suitParts: THREE.BufferGeometry[] = [];
    const gearParts: THREE.BufferGeometry[] = [];

    // Athletic wide-stance legs + protective carbon kneepads + FIA boots
    for (const sx of [-0.15, 0.15]) {
      const thigh = new THREE.CapsuleGeometry(0.080, 0.34, 4, 8);
      thigh.rotateX(isGunner ? 0.55 : 0.12);
      thigh.translate(sx, 0.62 - crouch * 0.6, isGunner ? -0.06 : 0);
      suitParts.push(normTrackGeo(thigh));

      const kneePad = new THREE.BoxGeometry(0.14, 0.13, 0.14);
      kneePad.translate(sx, 0.45 - crouch * 0.42, isGunner ? 0.08 : 0.04);
      gearParts.push(normTrackGeo(kneePad));

      const shin = new THREE.CapsuleGeometry(0.070, 0.34, 4, 8);
      shin.rotateX(isGunner ? -0.30 : -0.05);
      shin.translate(sx, 0.28 - crouch * 0.2, isGunner ? 0.04 : 0);
      suitParts.push(normTrackGeo(shin));

      const boot = new THREE.BoxGeometry(0.13, 0.10, 0.24);
      boot.translate(sx, 0.05, 0.06);
      gearParts.push(normTrackGeo(boot));
    }

    // Sculpted Fireproof Nomex Torso + FIA Waist Belt, Harness Straps & HANS Collar!
    const torso = new THREE.CapsuleGeometry(0.175, 0.42, 6, 12);
    torso.scale(1.16, 1.0, 0.78);
    torso.rotateX(isGunner ? 0.34 : 0.14);
    torso.translate(0, 1.08 - crouch, isGunner ? 0.04 : 0);
    suitParts.push(normTrackGeo(torso));

    const belt = new THREE.CylinderGeometry(0.19, 0.19, 0.09, 14);
    belt.scale(1.12, 1.0, 0.80);
    belt.translate(0, 0.84 - crouch * 0.85, isGunner ? -0.02 : 0);
    gearParts.push(normTrackGeo(belt));

    const hansCollar = new THREE.TorusGeometry(0.13, 0.036, 8, 16);
    hansCollar.rotateX(Math.PI * 0.5 + (isGunner ? 0.25 : 0.1));
    hansCollar.translate(0, 1.32 - crouch, isGunner ? 0.10 : 0.03);
    gearParts.push(normTrackGeo(hansCollar));

    // Articulated Upper & Forearms + Shoulder Epaulets reaching cleanly toward tool
    for (const sx of [-0.23, 0.23]) {
      const shoulderPad = new THREE.BoxGeometry(0.12, 0.055, 0.16);
      shoulderPad.translate(sx * 0.92, 1.29 - crouch, isGunner ? 0.09 : 0.02);
      gearParts.push(normTrackGeo(shoulderPad));

      const upperArm = new THREE.CapsuleGeometry(0.058, 0.25, 4, 8);
      upperArm.rotateX(0.68);
      upperArm.rotateZ(-sx * 0.32);
      upperArm.translate(sx, 1.15 - crouch, 0.16);
      suitParts.push(normTrackGeo(upperArm));

      const foreArm = new THREE.CapsuleGeometry(0.050, 0.24, 4, 8);
      foreArm.rotateX(1.22);
      foreArm.rotateY(sx * 0.44);
      foreArm.translate(sx * 0.68, 1.02 - crouch, 0.37);
      suitParts.push(normTrackGeo(foreArm));

      const glove = new THREE.SphereGeometry(0.058, 8, 6);
      glove.translate(sx * 0.42, 0.96 - crouch, 0.51);
      gearParts.push(normTrackGeo(glove));
    }

    const suitMesh = new THREE.Mesh(mergeGeometries(suitParts, false)!, suitMat);
    suitParts.forEach((g) => g.dispose());
    suitMesh.castShadow = true;
    m.add(suitMesh);

    // Full-Face Aero Helmet + Gold Visor
    const headY = 1.48 - crouch;
    const headZ = isGunner ? 0.14 : 0.05;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.165, 14, 12), helmMat);
    helmet.scale.set(0.95, 1.02, 1.12);
    helmet.position.set(0, headY, headZ);
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.158, 0.158, 0.09, 12, 1, false, -0.9, 1.8), visorMat);
    visor.position.set(0, headY + 0.01, headZ + 0.02);
    m.add(helmet, visor);

    // 3D Pneumatic Paoli Wheel Gun OR 3D Quick-Lift Carbon Jack
    const metalParts: THREE.BufferGeometry[] = [];
    if (isGunner) {
      const gunBody = new THREE.CylinderGeometry(0.062, 0.068, 0.28, 10);
      gunBody.rotateX(Math.PI * 0.5);
      gunBody.translate(0, 0.94 - crouch, 0.58);
      gearParts.push(normTrackGeo(gunBody));

      const socket = new THREE.CylinderGeometry(0.042, 0.048, 0.18, 10);
      socket.rotateX(Math.PI * 0.5);
      socket.translate(0, 0.94 - crouch, 0.78);
      metalParts.push(normTrackGeo(socket));

      const grip = new THREE.CylinderGeometry(0.028, 0.032, 0.16, 8);
      grip.translate(0, 0.84 - crouch, 0.54);
      gearParts.push(normTrackGeo(grip));
    } else {
      // 3D Tubular Quick-Lift Pit Jack
      for (const sx of [-0.14, 0.14]) {
        const handleTube = new THREE.CylinderGeometry(0.022, 0.024, 1.18, 8);
        handleTube.rotateX(-0.68);
        handleTube.translate(sx, 0.56, 0.85);
        metalParts.push(normTrackGeo(handleTube));
      }
      const crossBar = new THREE.CylinderGeometry(0.022, 0.022, 0.32, 8);
      crossBar.rotateZ(Math.PI * 0.5);
      crossBar.translate(0, 0.98, 0.48);
      gearParts.push(normTrackGeo(crossBar));

      const cradle = new THREE.BoxGeometry(0.38, 0.06, 0.48);
      cradle.translate(0, 0.06, 1.32);
      gearParts.push(normTrackGeo(cradle));
    }

    m.add(new THREE.Mesh(mergeGeometries(gearParts, false)!, darkGearMat));
    gearParts.forEach((g) => g.dispose());
    if (metalParts.length) {
      m.add(new THREE.Mesh(mergeGeometries(metalParts, false)!, metalMat));
      metalParts.forEach((g) => g.dispose());
    }

    crew.add(m);
  }
  return crew;
}

/**
 * Sculpted 3D Airbus H135 / Eurocopter EC135 FIA TV Broadcast Helicopter
 * Lofted fuselage, panoramic canopy, landing skids, shrouded Fenestron tail-fan, 4-blade rotor & nose Cineflex 4K gimbal!
 */
function buildTVHelicopter(): THREE.Group {
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: '#162030',
    metalness: 0.74,
    roughness: 0.20,
    clearcoat: 0.95
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#07111d',
    metalness: 0.95,
    roughness: 0.05,
    clearcoat: 1.0
  });
  const metalMat = new THREE.MeshStandardMaterial({ color: '#788496', metalness: 0.85, roughness: 0.28 });
  const accentMat = new THREE.MeshBasicMaterial({ color: '#ff2216', toneMapped: false });

  if (fh6Assets.helicopterPremerged) {
    const heli = new THREE.Group();
    const tpl = fh6Assets.helicopterPremerged;
    const hMatMap: Record<string, THREE.Material> = {
      Heli_Body: bodyMat,
      Heli_Glass: glassMat,
      Heli_Accent: accentMat,
      Heli_Beacon: accentMat,
      Heli_Dark: metalMat,
    };
    for (const [mName, geo] of Object.entries(tpl.byMat)) {
      heli.add(new THREE.Mesh(geo, hMatMap[mName] || metalMat));
    }
    const rotorNode = new THREE.Group();
    rotorNode.name = 'heliRotor';
    rotorNode.position.copy(tpl.rotorPos);
    if (tpl.rotorGeo) {
      rotorNode.add(new THREE.Mesh(tpl.rotorGeo, metalMat));
    }
    const blurDisc = new THREE.Mesh(
      new THREE.CircleGeometry(4.4, 24),
      new THREE.MeshBasicMaterial({ color: '#c8d6e8', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
    );
    blurDisc.rotation.x = -Math.PI / 2;
    rotorNode.add(blurDisc);
    heli.add(rotorNode);
    heli.position.set(0, 78, 0);
    return heli;
  }

  const heli = new THREE.Group();

  // 1. Sculpted Aerodynamic Fuselage + Twin Turboshaft Engine Cowling
  const fuseSlices: LoftSlice[] = [
    { z: -2.65, wBottom: 0.32, wTop: 0.28, yBottom: 0.15, yTop: 0.85, wMidScale: 1.04 },
    { z: -1.60, wBottom: 0.78, wTop: 0.68, yBottom: -0.45, yTop: 1.38, wMidScale: 1.08 },
    { z: -0.35, wBottom: 1.05, wTop: 0.88, yBottom: -0.68, yTop: 1.48, wMidScale: 1.10 },
    { z: 0.95,  wBottom: 1.02, wTop: 0.82, yBottom: -0.66, yTop: 1.22, wMidScale: 1.08 },
    { z: 2.05,  wBottom: 0.74, wTop: 0.56, yBottom: -0.52, yTop: 0.58, wMidScale: 1.06 },
    { z: 2.68,  wBottom: 0.34, wTop: 0.24, yBottom: -0.34, yTop: 0.08, wMidScale: 1.02 }
  ];
  const bodyParts: THREE.BufferGeometry[] = [normTrackGeo(buildSmoothLoftedHull(fuseSlices, 28, 22))];

  // Tapered Tailboom + Horizontal Stabilizer + Shrouded Fenestron Tail-Fan Ring + Dorsal Fin
  const tailBoom = new THREE.CylinderGeometry(0.18, 0.34, 4.6, 12);
  tailBoom.rotateX(Math.PI * 0.5);
  tailBoom.translate(0, 0.52, -4.65);
  bodyParts.push(normTrackGeo(tailBoom));

  const hStab = new THREE.BoxGeometry(2.35, 0.06, 0.42);
  hStab.translate(0, 0.54, -5.65);
  bodyParts.push(normTrackGeo(hStab));

  const fenestronShroud = new THREE.TorusGeometry(0.56, 0.12, 10, 20);
  fenestronShroud.rotateY(Math.PI * 0.5);
  fenestronShroud.translate(0, 0.62, -6.95);
  bodyParts.push(normTrackGeo(fenestronShroud));

  const vFin = new THREE.BoxGeometry(0.10, 1.45, 0.68);
  vFin.rotateX(-0.28);
  vFin.translate(0, 1.55, -7.08);
  bodyParts.push(normTrackGeo(vFin));

  heli.add(new THREE.Mesh(mergeGeometries(bodyParts, false)!, bodyMat));
  bodyParts.forEach((g) => g.dispose());

  // 2. Curved Panoramic Cockpit Glass Bubble
  const canopySlices: LoftSlice[] = [
    { z: 0.15, wBottom: 0.92, wTop: 0.78, yBottom: -0.10, yTop: 1.24, wMidScale: 1.06 },
    { z: 1.25, wBottom: 0.88, wTop: 0.72, yBottom: -0.25, yTop: 0.98, wMidScale: 1.06 },
    { z: 2.35, wBottom: 0.54, wTop: 0.42, yBottom: -0.32, yTop: 0.34, wMidScale: 1.04 }
  ];
  heli.add(new THREE.Mesh(buildSmoothLoftedHull(canopySlices, 24, 14), glassMat));

  // 3. Tubular Landing Skids + Rotor Mast + Nose Cineflex 4K TV Camera Gimbal
  const skidParts: THREE.BufferGeometry[] = [];
  for (const sx of [-0.95, 0.95]) {
    const skid = new THREE.CylinderGeometry(0.055, 0.055, 3.6, 8);
    skid.rotateX(Math.PI * 0.5);
    skid.translate(sx, -1.18, 0.35);
    skidParts.push(normTrackGeo(skid));

    for (const sz of [-0.65, 1.15]) {
      const leg = new THREE.CylinderGeometry(0.045, 0.045, 0.72, 8);
      leg.rotateZ(sx > 0 ? 0.36 : -0.36);
      leg.translate(sx * 0.82, -0.88, sz);
      skidParts.push(normTrackGeo(leg));
    }
  }
  const mast = new THREE.CylinderGeometry(0.11, 0.14, 0.52, 10);
  mast.translate(0, 1.68, -0.15);
  skidParts.push(normTrackGeo(mast));

  // Cineflex Nose Camera Gimbal Turret
  const gimArm = new THREE.CylinderGeometry(0.05, 0.06, 0.35, 8);
  gimArm.translate(0, -0.58, 2.48);
  skidParts.push(normTrackGeo(gimArm));
  const gimBall = new THREE.SphereGeometry(0.24, 12, 10);
  gimBall.translate(0, -0.80, 2.55);
  skidParts.push(normTrackGeo(gimBall));

  heli.add(new THREE.Mesh(mergeGeometries(skidParts, false)!, metalMat));
  skidParts.forEach((g) => g.dispose());

  // 4. 4-Blade Main Rotor Hub + Motion-Blur Disc (Preserves 'heliRotor' name)
  const rotorGroup = new THREE.Group();
  rotorGroup.position.set(0, 1.92, -0.15);
  rotorGroup.name = 'heliRotor';

  const bladeParts: THREE.BufferGeometry[] = [];
  const hub = new THREE.CylinderGeometry(0.26, 0.22, 0.14, 12);
  bladeParts.push(normTrackGeo(hub));
  for (let b = 0; b < 4; b++) {
    const blade = new THREE.BoxGeometry(4.8, 0.035, 0.24);
    blade.translate(2.5, 0, 0);
    blade.rotateY((b / 4) * Math.PI * 2);
    bladeParts.push(normTrackGeo(blade));
  }
  rotorGroup.add(new THREE.Mesh(mergeGeometries(bladeParts, false)!, metalMat));
  bladeParts.forEach((g) => g.dispose());

  const blurDisc = new THREE.Mesh(
    new THREE.CircleGeometry(5.1, 28),
    new THREE.MeshBasicMaterial({ color: '#c8d4e4', transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })
  );
  blurDisc.rotation.x = -Math.PI * 0.5;
  rotorGroup.add(blurDisc);

  const strobeBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), accentMat);
  strobeBeacon.position.set(0, 2.24, -7.18);
  heli.add(rotorGroup, strobeBeacon);

  heli.position.set(0, 78, 0);
  return heli;
}

/**
 * Instanced Braking Boards & DRS Signs with Beveled Aluminum Frames & Twin 3D Galvanized Support Posts
 */
function addTracksideSignsInstanced(
  group: THREE.Group,
  samples: TrackSample[],
  N: number,
  wallOff: number,
  trackCfg: TrackConfig,
  drsZones: [number, number][]
) {
  const boardGeo = new THREE.BoxGeometry(1.88, 0.94, 0.08);
  const mat150 = new THREE.MeshStandardMaterial({ map: getTrackSignTexture('150', false), roughness: 0.42 });
  const mat100 = new THREE.MeshStandardMaterial({ map: getTrackSignTexture('100', false), roughness: 0.42 });
  const mat50 = new THREE.MeshStandardMaterial({ map: getTrackSignTexture('50', false), roughness: 0.42 });
  const matDrs = new THREE.MeshStandardMaterial({
    map: getTrackSignTexture('DRS', true),
    emissive: '#00cc66',
    emissiveIntensity: 0.85,
    roughness: 0.38
  });

  // Shared 3D Beveled Casing + Twin Ground-Anchored Tubular Steel Support Posts
  const frameParts: THREE.BufferGeometry[] = [];
  const backFrame = new THREE.BoxGeometry(1.98, 1.04, 0.06);
  backFrame.translate(0, 0, -0.04);
  frameParts.push(normTrackGeo(backFrame));
  for (const px of [-0.68, 0.68]) {
    const post = new THREE.CylinderGeometry(0.048, 0.055, 2.55, 8);
    post.translate(px, -1.18, -0.08);
    frameParts.push(normTrackGeo(post));
  }
  const signFrameGeo = mergeGeometries(frameParts, false)!;
  frameParts.forEach((g) => g.dispose());
  const signFrameMat = new THREE.MeshStandardMaterial({ color: '#39424e', metalness: 0.80, roughness: 0.30 });

  const t150: THREE.Matrix4[] = [];
  const t100: THREE.Matrix4[] = [];
  const t50: THREE.Matrix4[] = [];
  const allSignFrames: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();

  let lastBrakeZoneIdx = -80;
  for (let i = 30; i < N - 20; i++) {
    if (i - lastBrakeZoneIdx < 70) continue;
    const c = Math.abs(samples[i].smoothCurvature);
    const cPrev = Math.abs(samples[(i - 22 + N) % N].smoothCurvature);
    if (c > 0.15 && cPrev < 0.08) {
      lastBrakeZoneIdx = i;
      const side = samples[i].smoothCurvature > 0 ? -1 : 1;
      for (const o of [{ back: 36, arr: t150 }, { back: 24, arr: t100 }, { back: 12, arr: t50 }]) {
        const idx = (i - o.back + N) % N;
        const s = samples[idx];
        if (s.isTunnel) continue;
        dummy.position.set(
          s.pos.x + s.right.x * (side * (wallOff + 0.65)),
          s.asphaltY + 2.05,
          s.pos.z + s.right.z * (side * (wallOff + 0.65))
        );
        dummy.rotation.set(0, Math.atan2(s.tangent.x, s.tangent.z), 0);
        dummy.updateMatrix();
        const mClone = dummy.matrix.clone();
        o.arr.push(mClone);
        allSignFrames.push(mClone);
      }
    }
  }

  for (const [arr, mat] of [[t150, mat150], [t100, mat100], [t50, mat50]] as const) {
    if (arr.length === 0) continue;
    const inst = new THREE.InstancedMesh(boardGeo, mat, arr.length);
    inst.castShadow = true;
    arr.forEach((m, idx) => inst.setMatrixAt(idx, m));
    group.add(inst);
  }

  const tDrs: THREE.Matrix4[] = [];
  const drsLineParts: THREE.BufferGeometry[] = [];
  for (const [zStart] of drsZones) {
    const idx = Math.floor(zStart * N) % N;
    const s = samples[idx];
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);

    const lineGeo = new THREE.PlaneGeometry(trackCfg.trackWidth - 0.8, 0.35);
    lineGeo.rotateX(-Math.PI / 2);
    lineGeo.rotateY(yaw);
    lineGeo.translate(s.pos.x, s.asphaltY + 0.012, s.pos.z);
    drsLineParts.push(lineGeo);

    for (const side of [-1, 1]) {
      dummy.position.set(
        s.pos.x + s.right.x * (side * (wallOff + 0.65)),
        s.asphaltY + 2.15,
        s.pos.z + s.right.z * (side * (wallOff + 0.65))
      );
      dummy.rotation.set(0, yaw, 0);
      dummy.updateMatrix();
      const mClone = dummy.matrix.clone();
      tDrs.push(mClone);
      allSignFrames.push(mClone);
    }
  }
  if (drsLineParts.length) {
    const mergedLines = mergeGeometries(drsLineParts, false);
    drsLineParts.forEach((g) => g.dispose());
    if (mergedLines) {
      group.add(
        new THREE.Mesh(
          mergedLines,
          new THREE.MeshBasicMaterial({ color: '#dce2ea', transparent: true, opacity: 0.72, depthWrite: false })
        )
      );
    }
  }
  if (tDrs.length) {
    const instDrs = new THREE.InstancedMesh(boardGeo, matDrs, tDrs.length);
    instDrs.castShadow = true;
    tDrs.forEach((m, idx) => instDrs.setMatrixAt(idx, m));
    group.add(instDrs);
  }
  if (allSignFrames.length) {
    const instFrames = new THREE.InstancedMesh(signFrameGeo, signFrameMat, allSignFrames.length);
    instFrames.castShadow = true;
    allSignFrames.forEach((m, idx) => instFrames.setMatrixAt(idx, m));
    group.add(instFrames);
  }
}

/**
 * Architectural Grandstands with Real 9-Step 3D Concrete Terraces, Cantilevered Roof Trusses, Pit Complex & Engineer Canopy
 */
function addGrandstandsAndPitBuilding(
  group: THREE.Group,
  samples: TrackSample[],
  N: number,
  wallOff: number,
  trackCfg: TrackConfig
) {
  const crowdTex = getCrowdTexture();
  const crowdMat = new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.86, metalness: 0.05 });
  const structMat = new THREE.MeshStandardMaterial({
    color: trackCfg.theme === 'city' ? '#1a202c' : '#7c8594',
    metalness: 0.45,
    roughness: 0.52
  });
  const darkCladdingMat = new THREE.MeshStandardMaterial({
    color: '#1e242d',
    metalness: 0.68,
    roughness: 0.34
  });
  const trussMat = new THREE.MeshStandardMaterial({ color: '#181d26', metalness: 0.82, roughness: 0.28 });
  const roofMat = new THREE.MeshStandardMaterial({
    color: trackCfg.theme === 'desert' ? '#e5dfd5' : '#cdd5e0',
    metalness: 0.35,
    roughness: 0.42
  });
  const roofTrimMat = new THREE.MeshStandardMaterial({
    color: trackCfg.theme === 'monza' ? '#c81018' : '#1b222c',
    metalness: 0.65,
    roughness: 0.30
  });

  // 8 Full-Scale Grandstands at iconic spectator zones (Tribuna Centrale, Prima Variante, Roggia, Lesmo, Ascari, Parabolica)
  const spots = [
    { idx: 18, side: -1, len: 82 },
    { idx: Math.floor(N * 0.09), side: -1, len: 64 },
    { idx: Math.floor(N * 0.16), side: 1, len: 58 },
    { idx: Math.floor(N * 0.34), side: -1, len: 54 },
    { idx: Math.floor(N * 0.46), side: 1, len: 52 },
    { idx: Math.floor(N * 0.64), side: -1, len: 62 },
    { idx: Math.floor(N * 0.78), side: 1, len: 56 },
    { idx: Math.floor(N * 0.90), side: -1, len: 68 }
  ];

  for (const sp of spots) {
    const s = samples[sp.idx % N];
    if (s.isTunnel) continue;
    const gs = new THREE.Group();
    const dist = wallOff + 12.5;
    gs.position.set(
      s.pos.x + s.right.x * (sp.side * dist),
      s.pos.y,
      s.pos.z + s.right.z * (sp.side * dist)
    );
    gs.lookAt(s.pos.x, s.pos.y, s.pos.z);

    // Concrete seating understructure + sculpted raked side wing walls + front glass/steel safety balustrade
    const concreteBase = new THREE.Mesh(new THREE.BoxGeometry(sp.len + 0.8, 2.0, 10.8), structMat);
    concreteBase.position.set(0, 1.0, -1.8);
    gs.add(concreteBase);

    for (const sideX of [-1, 1]) {
      const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.45, 8.8, 10.6), darkCladdingMat);
      sideWall.position.set(sideX * (sp.len * 0.5 + 0.2), 4.4, -1.8);
      gs.add(sideWall);
    }

    const frontBalustrade = new THREE.Mesh(new THREE.BoxGeometry(sp.len + 0.8, 1.05, 0.32), roofTrimMat);
    frontBalustrade.position.set(0, 2.35, 3.45);
    gs.add(frontBalustrade);

    // 9 Real 3D Stepped Stadium Seating Terraces (Replaces single flat tilted plank!)
    const nSteps = 9;
    const stepGeos: THREE.BufferGeometry[] = [];
    for (let st = 0; st < nSteps; st++) {
      const frac = st / (nSteps - 1);
      const stepY = 2.15 + st * 0.68;
      const stepZ = 2.85 - st * 1.02;
      const bench = new THREE.BoxGeometry(sp.len - 0.1, 0.66, 1.06);
      // Map UVs cleanly across the stepped terraces
      const uvAttr = bench.attributes.uv;
      for (let u = 0; u < uvAttr.count; u++) {
        uvAttr.setY(u, THREE.MathUtils.clamp(frac + uvAttr.getY(u) / nSteps, 0.01, 0.99));
      }
      bench.translate(0, stepY, stepZ);
      stepGeos.push(normTrackGeo(bench));
    }
    const mergedTiers = new THREE.Mesh(mergeGeometries(stepGeos, false)!, crowdMat);
    stepGeos.forEach((g) => g.dispose());
    mergedTiers.receiveShadow = true;
    mergedTiers.castShadow = true;
    gs.add(mergedTiers);

    const backWall = new THREE.Mesh(new THREE.BoxGeometry(sp.len + 1, 11.6, 1.4), darkCladdingMat);
    backWall.position.set(0, 5.8, -6.9);
    backWall.castShadow = true;
    gs.add(backWall);

    // Architectural Steel Roof Cantilever Pillars, Curved Tapered Beams & Space-Frame Cross-Bracing
    const trussParts: THREE.BufferGeometry[] = [];
    const nCols = 7;
    for (let k = 0; k < nCols; k++) {
      const xPos = -sp.len * 0.46 + (k / (nCols - 1)) * (sp.len * 0.92);
      const col = new THREE.CylinderGeometry(0.22, 0.26, 11.6, 10);
      col.translate(xPos, 5.8, -5.9);
      trussParts.push(normTrackGeo(col));

      const mainRib = new THREE.BoxGeometry(0.26, 0.42, 13.8);
      mainRib.rotateX(0.05);
      mainRib.translate(xPos, 11.35, -1.0);
      trussParts.push(normTrackGeo(mainRib));

      // Diagonal cantilever tension & compression struts
      const diag = new THREE.CylinderGeometry(0.11, 0.11, 5.6, 8);
      diag.rotateX(0.74);
      diag.translate(xPos, 9.45, -4.0);
      trussParts.push(normTrackGeo(diag));

      // Under-roof PA speaker / floodlight pod
      const lightPod = new THREE.BoxGeometry(0.55, 0.28, 0.42);
      lightPod.translate(xPos, 10.92, 4.8);
      trussParts.push(normTrackGeo(lightPod));
    }
    // Longitudinal purlins tying the roof frame together
    for (const zPurlin of [-4.5, -0.5, 3.8]) {
      const purlin = new THREE.CylinderGeometry(0.085, 0.085, sp.len + 1.8, 8);
      purlin.rotateZ(Math.PI * 0.5);
      purlin.translate(0, 11.25 + zPurlin * 0.04, zPurlin);
      trussParts.push(normTrackGeo(purlin));
    }
    const mergedTruss = mergeGeometries(trussParts, false)!;
    trussParts.forEach((g) => g.dispose());
    gs.add(new THREE.Mesh(mergedTruss, trussMat));

    const roof = new THREE.Mesh(new THREE.BoxGeometry(sp.len + 2.6, 0.36, 14.0), roofMat);
    roof.position.set(0, 11.68, -1.1);
    roof.rotation.x = 0.05;
    roof.castShadow = true;
    gs.add(roof);

    const fascia = new THREE.Mesh(new THREE.BoxGeometry(sp.len + 2.8, 0.52, 0.42), roofTrimMat);
    fascia.position.set(0, 11.32, 5.75);
    gs.add(fascia);

    group.add(gs);
  }

  // Modern FIA Paddock Club & Pit Lane Garage Complex (Architectural Brushed Steel, Dark Tinted Glass & Recessed Bays)
  const pitSample = samples[26];
  if (!pitSample.isTunnel) {
    const pitGroup = new THREE.Group();
    const dist = wallOff + 11.0;
    pitGroup.position.set(
      pitSample.pos.x + pitSample.right.x * dist,
      pitSample.pos.y,
      pitSample.pos.z + pitSample.right.z * dist
    );
    pitGroup.lookAt(pitSample.pos.x, pitSample.pos.y, pitSample.pos.z);

    // Main 2-story Paddock Hospitality Building in architectural anthracite & brushed aluminum
    const mainBox = new THREE.Mesh(new THREE.BoxGeometry(78, 9.2, 11.5), darkCladdingMat);
    mainBox.position.set(0, 4.6, -4.5);
    mainBox.castShadow = true;
    pitGroup.add(mainBox);

    // Horizontal architectural concrete floor slabs & upper VIP terrace overhang
    const midSlab = new THREE.Mesh(new THREE.BoxGeometry(79.4, 0.65, 12.8), structMat);
    midSlab.position.set(0, 4.65, -4.0);
    pitGroup.add(midSlab);

    const roofSlab = new THREE.Mesh(new THREE.BoxGeometry(80.8, 0.72, 14.2), roofMat);
    roofSlab.position.set(0, 9.4, -3.8);
    roofSlab.castShadow = true;
    pitGroup.add(roofSlab);

    const roofFascia = new THREE.Mesh(new THREE.BoxGeometry(81.0, 0.55, 0.48), roofTrimMat);
    roofFascia.position.set(0, 9.4, 3.15);
    pitGroup.add(roofFascia);

    // Reflective Dark Tinted VIP Curtain-Wall Glass with Vertical Steel Mullions & Balcony Railings
    const vipGlass = new THREE.Mesh(
      new THREE.BoxGeometry(76.4, 3.6, 0.35),
      new THREE.MeshPhysicalMaterial({
        color: '#08131f',
        metalness: 0.92,
        roughness: 0.08,
        clearcoat: 1.0,
        clearcoatRoughness: 0.06
      })
    );
    vipGlass.position.set(0, 6.9, 1.25);
    pitGroup.add(vipGlass);

    const mullionParts: THREE.BufferGeometry[] = [];
    for (let m = -36; m <= 36; m += 3.6) {
      const mul = new THREE.BoxGeometry(0.16, 3.8, 0.52);
      mul.translate(m, 6.9, 1.28);
      mullionParts.push(normTrackGeo(mul));
    }
    const mergedMullions = mergeGeometries(mullionParts, false)!;
    mullionParts.forEach((g) => g.dispose());
    pitGroup.add(new THREE.Mesh(mergedMullions, trussMat));

    // 6 Realistic Recessed Dark Garage Bays with Warm Interior Tungsten Work Lights & Articulated Overhead Pit Booms
    const garageInteriorMat = new THREE.MeshStandardMaterial({
      color: '#090c12',
      roughness: 0.75,
      metalness: 0.25
    });
    const warmCeilingLightMat = new THREE.MeshStandardMaterial({
      color: '#fff4e0',
      emissive: '#ffcf86',
      emissiveIntensity: 0.85,
      roughness: 0.3
    });

    for (let b = 0; b < 6; b++) {
      const bx = (b - 2.5) * 12.2;
      const bayRecess = new THREE.Mesh(new THREE.BoxGeometry(9.8, 4.1, 0.6), garageInteriorMat);
      bayRecess.position.set(bx, 2.05, 1.15);
      pitGroup.add(bayRecess);

      const lightStrip = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.28, 0.68), warmCeilingLightMat);
      lightStrip.position.set(bx, 3.85, 1.18);
      pitGroup.add(lightStrip);

      // Articulated Twin Overhead Pit-Stop Pneumatic Boom Arms + Hanging Air Hoses
      const boomParts: THREE.BufferGeometry[] = [];
      for (const ox of [-1.6, 1.6]) {
        const arm = new THREE.CylinderGeometry(0.065, 0.085, 4.4, 8);
        arm.rotateX(Math.PI * 0.5);
        arm.translate(bx + ox, 4.22, 3.2);
        boomParts.push(normTrackGeo(arm));

        const hose = new THREE.CylinderGeometry(0.022, 0.022, 1.35, 6);
        hose.translate(bx + ox, 3.55, 5.15);
        boomParts.push(normTrackGeo(hose));
      }
      pitGroup.add(new THREE.Mesh(mergeGeometries(boomParts, false)!, trussMat));
      boomParts.forEach((g) => g.dispose());
    }

    // Sculpted 3D Pit-Wall Engineer Timing Pratendeck Canopy (tubular pillars + curved roof + multi-screen OLED bank)
    const pwParts: THREE.BufferGeometry[] = [];
    const pwRoof = new THREE.BoxGeometry(40.5, 0.18, 2.15);
    pwRoof.rotateX(-0.12);
    pwRoof.translate(0, 2.65, 9.15);
    pwParts.push(normTrackGeo(pwRoof));

    const pwDesk = new THREE.BoxGeometry(39.2, 0.92, 0.95);
    pwDesk.translate(0, 0.65, 9.25);
    pwParts.push(normTrackGeo(pwDesk));

    for (let p = -18; p <= 18; p += 6) {
      const post = new THREE.CylinderGeometry(0.075, 0.085, 2.65, 8);
      post.translate(p, 1.32, 9.85);
      pwParts.push(normTrackGeo(post));
    }
    // Roof GPS/Telemetry Antenna Array
    for (let a = -12; a <= 12; a += 8) {
      const mast = new THREE.CylinderGeometry(0.02, 0.03, 1.25, 6);
      mast.translate(a, 3.35, 9.2);
      pwParts.push(normTrackGeo(mast));
    }
    pitGroup.add(new THREE.Mesh(mergeGeometries(pwParts, false)!, trussMat));
    pwParts.forEach((g) => g.dispose());

    const pitMonitors = new THREE.Mesh(
      new THREE.BoxGeometry(37.5, 0.56, 0.12),
      new THREE.MeshStandardMaterial({
        color: '#081824',
        emissive: '#1e587c',
        emissiveIntensity: 0.65,
        roughness: 0.22
      })
    );
    pitMonitors.position.set(0, 1.48, 8.75);
    pitGroup.add(pitMonitors);

    group.add(pitGroup);
  }

  // 3. 4 Overhead F1 Championship Sponsor & Timing Truss Gantry Bridges across the circuit
  const bridgeFracs = [0.11, 0.31, 0.62, 0.83];
  const bannerMat = new THREE.MeshStandardMaterial({
    color: trackCfg.theme === 'monza' ? '#c81018' : '#0d1522',
    emissive: trackCfg.theme === 'city' ? '#004866' : '#2a0406',
    emissiveIntensity: 0.45,
    roughness: 0.32,
    metalness: 0.25
  });
  const spanW = wallOff * 2 + 2.5;
  for (const frac of bridgeFracs) {
    const bs = samples[Math.floor(N * frac) % N];
    if (bs.isTunnel) continue;
    const bg = new THREE.Group();
    bg.position.set(bs.pos.x, bs.asphaltY, bs.pos.z);
    const yaw = Math.atan2(bs.tangent.x, bs.tangent.z);
    bg.rotation.y = yaw;

    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.95, 7.6, 1.4), trussMat);
      leg.position.set(side * (wallOff + 0.8), 3.8, 0);
      leg.castShadow = true;
      bg.add(leg);
    }
    const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(spanW, 1.45, 1.35), bannerMat);
    crossBeam.position.set(0, 7.1, 0);
    crossBeam.castShadow = true;
    bg.add(crossBeam);

    const accentStripe = new THREE.Mesh(
      new THREE.BoxGeometry(spanW + 0.1, 0.22, 1.42),
      new THREE.MeshStandardMaterial({
        color: trackCfg.theme === 'monza' ? '#189e48' : '#00e5ff',
        emissive: trackCfg.theme === 'monza' ? '#0a451e' : '#0088aa',
        emissiveIntensity: 0.6
      })
    );
    accentStripe.position.set(0, 6.45, 0);
    bg.add(accentStripe);
    group.add(bg);
  }

  // 4. Giant Trackside LED Broadcast Jumbotron Towers opposite the main spectator zones
  const jumboMat = new THREE.MeshStandardMaterial({
    color: '#0c1c2c',
    emissive: '#144266',
    emissiveIntensity: 0.85,
    roughness: 0.18
  });
  for (const jFrac of [0.04, 0.17, 0.65, 0.91]) {
    const js = samples[Math.floor(N * jFrac) % N];
    if (js.isTunnel) continue;
    const jg = new THREE.Group();
    const jDist = wallOff + 7.5;
    jg.position.set(js.pos.x + js.right.x * jDist, js.asphaltY, js.pos.z + js.right.z * jDist);
    jg.lookAt(js.pos.x, js.asphaltY + 2.5, js.pos.z);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 7.5, 10), trussMat);
    mast.position.set(0, 3.75, 0);
    jg.add(mast);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(8.6, 4.8, 0.55), darkCladdingMat);
    frame.position.set(0, 7.6, 0);
    jg.add(frame);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(8.0, 4.3, 0.62), jumboMat);
    screen.position.set(0, 7.6, 0.04);
    jg.add(screen);
    group.add(jg);
  }

  // 5. FULL REAL-LIFE AUTODROMO NAZIONALE MONZA REPLICA (Based on SkySat, Google Earth 3D & Trackside Photos!)
  if (trackCfg.theme === 'monza') {
    addMonzaPhotorealisticWorld(group, samples, N, wallOff, trackCfg.trackWidth * 0.5);
  }
}

function createMonzaPirelliArchTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffd000';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#d80000';
  ctx.fillRect(110, 18, 292, 92);
  ctx.fillStyle = '#ffd000';
  ctx.font = '900 58px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PIRELLI', 256, 66);
  // Long red P-capital bar
  ctx.fillRect(138, 28, 120, 11);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function createItalianGPBarrierTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, 512, 64);
  // Italian Tricolore top & bottom pin-stripes
  ctx.fillStyle = '#009246';
  ctx.fillRect(0, 0, 170, 5);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(170, 0, 172, 5);
  ctx.fillStyle = '#ce2b37';
  ctx.fillRect(342, 0, 170, 5);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'italic 900 28px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('#ItalianGP', 135, 34);

  ctx.fillStyle = '#ffd000';
  ctx.font = 'italic 900 28px "Segoe UI", Arial, sans-serif';
  ctx.fillText('P ZERO', 385, 34);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(6, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addMonzaPhotorealisticWorld(
  group: THREE.Group,
  samples: TrackSample[],
  N: number,
  wallOff: number,
  halfW: number
): void {
  const weatheredConcreteMat = new THREE.MeshStandardMaterial({
    color: '#767b82',
    roughness: 0.88,
    metalness: 0.08
  });
  const emeraldRunoffMat = new THREE.MeshStandardMaterial({
    color: '#14a668',
    roughness: 0.65,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -1
  });
  const escapeAsphaltMat = new THREE.MeshStandardMaterial({
    color: '#2a2e35',
    roughness: 0.78,
    metalness: 0.08,
    polygonOffset: true,
    polygonOffsetFactor: -1
  });
  const lecaGravelMat = new THREE.MeshStandardMaterial({
    color: '#cbb99a',
    roughness: 0.95,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -1
  });
  const astroturfMat = new THREE.MeshStandardMaterial({
    color: '#16883c',
    roughness: 0.82,
    metalness: 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -2
  });

  // 1. White & Yellow F1 Starting Grid Boxes + Pit-Exit White Line along Rettilineo Principale (Photo: Autodromo-Nazionale-Monza-800x500-1.jpg)
  const gridPartsWhite: THREE.BufferGeometry[] = [];
  const gridPartsYellow: THREE.BufferGeometry[] = [];
  const startIdx = samples[0] ? 52 : 0;
  for (let slot = 0; slot < 20; slot++) {
    const idx = (startIdx - 2 - slot * 2 + N) % N;
    const s = samples[idx];
    const side = slot % 2 === 0 ? -1 : 1;
    const lat = side * (halfW * 0.42);
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);

    // White U-bracket lines
    const frontBar = new THREE.PlaneGeometry(2.3, 0.14);
    frontBar.rotateX(-Math.PI / 2);
    frontBar.rotateY(yaw);
    frontBar.translate(
      s.pos.x + s.right.x * lat + s.tangent.x * 1.8,
      s.asphaltY + 0.018,
      s.pos.z + s.right.z * lat + s.tangent.z * 1.8
    );
    gridPartsWhite.push(normTrackGeo(frontBar));

    for (const sideBr of [-1.1, 1.1]) {
      const leg = new THREE.PlaneGeometry(0.14, 1.4);
      leg.rotateX(-Math.PI / 2);
      leg.rotateY(yaw);
      leg.translate(
        s.pos.x + s.right.x * (lat + sideBr) + s.tangent.x * 1.1,
        s.asphaltY + 0.018,
        s.pos.z + s.right.z * (lat + sideBr) + s.tangent.z * 1.1
      );
      gridPartsWhite.push(normTrackGeo(leg));
    }

    // Yellow nose alignment line extending across the grid box
    const yellowLine = new THREE.PlaneGeometry(2.8, 0.14);
    yellowLine.rotateX(-Math.PI / 2);
    yellowLine.rotateY(yaw);
    yellowLine.translate(
      s.pos.x + s.right.x * (lat - side * 0.45) + s.tangent.x * 1.55,
      s.asphaltY + 0.02,
      s.pos.z + s.right.z * (lat - side * 0.45) + s.tangent.z * 1.55
    );
    gridPartsYellow.push(normTrackGeo(yellowLine));
  }

  // Long white Pit-Exit corridor line down the right side of the Main Straight
  for (let k = 0; k < 58; k++) {
    const s = samples[(startIdx - 18 + k + N) % N];
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    const pitLine = new THREE.PlaneGeometry(0.18, 4.2);
    pitLine.rotateX(-Math.PI / 2);
    pitLine.rotateY(yaw);
    pitLine.translate(
      s.pos.x + s.right.x * (halfW - 3.1),
      s.asphaltY + 0.016,
      s.pos.z + s.right.z * (halfW - 3.1)
    );
    gridPartsWhite.push(normTrackGeo(pitLine));
  }

  if (gridPartsWhite.length) {
    const mW = new THREE.Mesh(
      mergeGeometries(gridPartsWhite, false)!,
      new THREE.MeshBasicMaterial({ color: '#f2f5fa', polygonOffset: true, polygonOffsetFactor: -2 })
    );
    gridPartsWhite.forEach((g) => g.dispose());
    group.add(mW);
  }
  if (gridPartsYellow.length) {
    const mY = new THREE.Mesh(
      mergeGeometries(gridPartsYellow, false)!,
      new THREE.MeshBasicMaterial({ color: '#ffd000', polygonOffset: true, polygonOffsetFactor: -3 })
    );
    gridPartsYellow.forEach((g) => g.dispose());
    group.add(mY);
  }

  // 2. Iconic Bright Yellow & Red PIRELLI Gantry Bridges before Turn 1 Rettifilo & on Back Straight (Photo: 1657349836.avif)
  const pirelliTex = createMonzaPirelliArchTexture();
  const pirelliYellowMat = new THREE.MeshStandardMaterial({ color: '#ffd000', roughness: 0.35, metalness: 0.18 });
  const pirelliBannerMat = new THREE.MeshStandardMaterial({ map: pirelliTex, roughness: 0.35, metalness: 0.1 });
  const spanW = wallOff * 2 + 2.2;

  for (const pFrac of [0.105, 0.735]) {
    const ps = samples[Math.floor(N * pFrac) % N];
    const pg = new THREE.Group();
    pg.position.set(ps.pos.x, ps.asphaltY, ps.pos.z);
    pg.rotation.y = Math.atan2(ps.tangent.x, ps.tangent.z);

    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(2.1, 8.2, 1.8), pirelliYellowMat);
      pillar.position.set(side * (wallOff + 0.6), 4.1, 0);
      pillar.castShadow = true;
      pg.add(pillar);
    }
    const topArch = new THREE.Mesh(new THREE.BoxGeometry(spanW + 1.6, 2.3, 1.85), pirelliBannerMat);
    topArch.position.set(0, 7.6, 0);
    topArch.castShadow = true;
    pg.add(topArch);
    group.add(pg);
  }

  // Weathered concrete pedestrian overpass bridge across the Main Straight (Photo: image_6.png)
  const pedSample = samples[Math.floor(N * 0.068) % N];
  const pedGroup = new THREE.Group();
  pedGroup.position.set(pedSample.pos.x, pedSample.asphaltY, pedSample.pos.z);
  pedGroup.rotation.y = Math.atan2(pedSample.tangent.x, pedSample.tangent.z);
  for (const side of [-1, 1]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(2.4, 6.8, 2.6), weatheredConcreteMat);
    pier.position.set(side * (wallOff + 1.2), 3.4, 0);
    pier.castShadow = true;
    pedGroup.add(pier);
  }
  const pedDeck = new THREE.Mesh(new THREE.BoxGeometry(spanW + 3.0, 1.4, 2.4), weatheredConcreteMat);
  pedDeck.position.set(0, 6.4, 0);
  pedDeck.castShadow = true;
  pedGroup.add(pedDeck);
  group.add(pedGroup);

  // 3. Cylindrical / Octagonal Blue-Glass Race Control Tower on the Main Straight (Photos: image_6.png & Autodromo-Nazionale-Monza-800x500-1.jpg)
  const rcSample = samples[Math.floor(N * 0.078) % N];
  const rcTower = new THREE.Group();
  rcTower.position.set(
    rcSample.pos.x - rcSample.right.x * (wallOff + 2.8),
    rcSample.asphaltY,
    rcSample.pos.z - rcSample.right.z * (wallOff + 2.8)
  );
  const rcBase = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 5.2, 8), weatheredConcreteMat);
  rcBase.position.y = 2.6;
  rcTower.add(rcBase);
  const rcGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.1, 7.6, 12),
    new THREE.MeshPhysicalMaterial({ color: '#0c283d', metalness: 0.88, roughness: 0.12, clearcoat: 1.0 })
  );
  rcGlass.position.y = 8.8;
  rcGlass.castShadow = true;
  rcTower.add(rcGlass);
  for (let fl = 0; fl < 4; fl++) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 0.28, 12), weatheredConcreteMat);
    ring.position.y = 5.4 + fl * 2.3;
    rcTower.add(ring);
  }
  group.add(rcTower);

  // 4. Emerald-Turquoise Green Chicane Runoff Aprons + Escape Roads + Yellow/Black Sausage Curbs (Photos: image_3.png, image_4.png, 1657349836.avif)
  const sausageMat = new THREE.MeshStandardMaterial({ color: '#ff9900', roughness: 0.45, metalness: 0.1 });
  const chicaneSpecs = [
    { startFrac: 0.115, endFrac: 0.175, side: -1, width: 11.5 }, // Variante del Rettifilo (Turn 1-2)
    { startFrac: 0.305, endFrac: 0.365, side: 1, width: 10.5 },  // Variante della Roggia (Turn 4-5)
    { startFrac: 0.610, endFrac: 0.685, side: -1, width: 13.5 }  // Variante Ascari triangular emerald apron!
  ];
  for (const ch of chicaneSpecs) {
    const i0 = Math.floor(N * ch.startFrac);
    const i1 = Math.floor(N * ch.endFrac);
    const emeraldParts: THREE.BufferGeometry[] = [];
    const escapeParts: THREE.BufferGeometry[] = [];
    const sausageParts: THREE.BufferGeometry[] = [];

    for (let i = i0; i < i1; i++) {
      const s = samples[i % N];
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      // Bright emerald-green painted runoff triangle/strip
      const em = new THREE.PlaneGeometry(ch.width, 5.2);
      em.rotateX(-Math.PI / 2);
      em.rotateY(yaw);
      em.translate(
        s.pos.x + s.right.x * (ch.side * (halfW + ch.width * 0.48)),
        s.asphaltY + 0.014,
        s.pos.z + s.right.z * (ch.side * (halfW + ch.width * 0.48))
      );
      emeraldParts.push(normTrackGeo(em));

      // Dark asphalt escape road behind the emerald apron
      const esc = new THREE.PlaneGeometry(ch.width * 0.75, 5.2);
      esc.rotateX(-Math.PI / 2);
      esc.rotateY(yaw);
      esc.translate(
        s.pos.x + s.right.x * (-ch.side * (halfW + ch.width * 0.42)),
        s.asphaltY + 0.012,
        s.pos.z + s.right.z * (-ch.side * (halfW + ch.width * 0.42))
      );
      escapeParts.push(normTrackGeo(esc));

      // 3D Raised Yellow/Orange Sausage Curbs (dissuasori) at the chicane apexes
      if (i % 3 === 0) {
        const saus = new THREE.CylinderGeometry(0.18, 0.24, 2.8, 8);
        saus.rotateX(Math.PI / 2);
        saus.rotateY(yaw);
        saus.translate(
          s.pos.x + s.right.x * (ch.side * (halfW + 0.85)),
          s.asphaltY + 0.08,
          s.pos.z + s.right.z * (ch.side * (halfW + 0.85))
        );
        sausageParts.push(normTrackGeo(saus));
      }
    }

    if (emeraldParts.length) {
      group.add(new THREE.Mesh(mergeGeometries(emeraldParts, false)!, emeraldRunoffMat));
      emeraldParts.forEach((g) => g.dispose());
    }
    if (escapeParts.length) {
      group.add(new THREE.Mesh(mergeGeometries(escapeParts, false)!, escapeAsphaltMat));
      escapeParts.forEach((g) => g.dispose());
    }
    if (sausageParts.length) {
      group.add(new THREE.Mesh(mergeGeometries(sausageParts, false)!, sausageMat));
      sausageParts.forEach((g) => g.dispose());
    }
  }

  // 5. Crescent Beige Leca Gravel Traps + Green Astroturf Strips at Lesmo 1, Lesmo 2, Ascari & Parabolica (Photos: image_3.png, image_4.png, image_7.png, images.jpg)
  const gravelZones = [
    { startFrac: 0.125, endFrac: 0.165, side: -1, w: 8.5 }, // Turn 1 Rettifilo outer gravel
    { startFrac: 0.395, endFrac: 0.445, side: -1, w: 9.5 }, // Lesmo 1 outer gravel trap
    { startFrac: 0.465, endFrac: 0.515, side: -1, w: 9.5 }, // Lesmo 2 outer gravel trap
    { startFrac: 0.615, endFrac: 0.675, side: 1, w: 10.5 }, // Variante Ascari outer gravel trap
    { startFrac: 0.840, endFrac: 0.960, side: -1, w: 12.0 } // Curva Parabolica / Alboreto huge crescent gravel trap!
  ];
  const gravelParts: THREE.BufferGeometry[] = [];
  const astroParts: THREE.BufferGeometry[] = [];
  for (const gz of gravelZones) {
    const i0 = Math.floor(N * gz.startFrac);
    const i1 = Math.floor(N * gz.endFrac);
    for (let i = i0; i < i1; i++) {
      const s = samples[i % N];
      const yaw = Math.atan2(s.tangent.x, s.tangent.z);
      // Green Astroturf strip hugging the outer curb
      const ast = new THREE.PlaneGeometry(1.45, 4.8);
      ast.rotateX(-Math.PI / 2);
      ast.rotateY(yaw);
      ast.translate(
        s.pos.x + s.right.x * (gz.side * (halfW + 1.35)),
        s.asphaltY + 0.016,
        s.pos.z + s.right.z * (gz.side * (halfW + 1.35))
      );
      astroParts.push(normTrackGeo(ast));

      // Wide Beige Leca Gravel Trap outside the astroturf
      const grv = new THREE.PlaneGeometry(gz.w, 4.8);
      grv.rotateX(-Math.PI / 2);
      grv.rotateY(yaw);
      grv.translate(
        s.pos.x + s.right.x * (gz.side * (halfW + 2.1 + gz.w * 0.5)),
        s.asphaltY + 0.013,
        s.pos.z + s.right.z * (gz.side * (halfW + 2.1 + gz.w * 0.5))
      );
      gravelParts.push(normTrackGeo(grv));
    }
  }
  if (astroParts.length) {
    group.add(new THREE.Mesh(mergeGeometries(astroParts, false)!, astroturfMat));
    astroParts.forEach((g) => g.dispose());
  }
  if (gravelParts.length) {
    group.add(new THREE.Mesh(mergeGeometries(gravelParts, false)!, lecaGravelMat));
    gravelParts.forEach((g) => g.dispose());
  }

  // 6. Black #ItalianGP & P ZERO Barrier Boards + Turn 1 Giant Black/Yellow P ZERO Ground Banner (Photo: 1657349836.avif)
  const italianGpMat = new THREE.MeshStandardMaterial({ map: createItalianGPBarrierTexture(), roughness: 0.4 });
  for (const bZone of [
    { start: 0.11, end: 0.18, side: -1 },
    { start: 0.11, end: 0.17, side: 1 },
    { start: 0.61, end: 0.68, side: -1 },
    { start: 0.84, end: 0.94, side: -1 }
  ]) {
    const i0 = Math.floor(N * bZone.start);
    const i1 = Math.floor(N * bZone.end);
    for (let i = i0; i < i1; i += 4) {
      const s = samples[i % N];
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.15, 16.5), italianGpMat);
      board.position.set(
        s.pos.x + s.right.x * (bZone.side * (wallOff - 0.3)),
        s.asphaltY + 0.65,
        s.pos.z + s.right.z * (bZone.side * (wallOff - 0.3))
      );
      board.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);
      group.add(board);
    }
  }

  // Giant P ZERO Ground Banner on the inside grass of Turn 1 Rettifilo (Photo: 1657349836.avif)
  const t1Sample = samples[Math.floor(N * 0.122) % N];
  const pZeroGround = new THREE.Mesh(
    new THREE.PlaneGeometry(7.5, 22.0),
    new THREE.MeshStandardMaterial({ map: createItalianGPBarrierTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 })
  );
  pZeroGround.rotation.x = -Math.PI / 2;
  pZeroGround.rotation.z = -Math.atan2(t1Sample.tangent.x, t1Sample.tangent.z) + 0.35;
  pZeroGround.position.set(
    t1Sample.pos.x + t1Sample.right.x * (halfW + 6.2),
    t1Sample.asphaltY + 0.03,
    t1Sample.pos.z + t1Sample.right.z * (halfW + 6.2)
  );
  group.add(pZeroGround);

  // 7. Row of 4 Uncovered Stepped Metal "Jochen Rindt" Grandstands along the Back Straight before Parabolica (Photo: image_7.png)
  const openBleacherMat = new THREE.MeshStandardMaterial({ color: '#9aa3b0', roughness: 0.65, metalness: 0.35 });
  const scaffoldMat = new THREE.MeshStandardMaterial({ color: '#242a34', roughness: 0.5, metalness: 0.7 });
  for (let b = 0; b < 4; b++) {
    const bFrac = 0.755 + b * 0.022;
    const bs = samples[Math.floor(N * bFrac) % N];
    const bg = new THREE.Group();
    const bDist = wallOff + 10.5;
    bg.position.set(bs.pos.x - bs.right.x * bDist, bs.asphaltY, bs.pos.z - bs.right.z * bDist);
    bg.lookAt(bs.pos.x, bs.asphaltY, bs.pos.z);

    const base = new THREE.Mesh(new THREE.BoxGeometry(28, 3.8, 8.5), scaffoldMat);
    base.position.set(0, 1.9, -1.0);
    bg.add(base);
    const tier = new THREE.Mesh(new THREE.BoxGeometry(27.6, 1.2, 9.2), openBleacherMat);
    tier.position.set(0, 4.6, -1.0);
    tier.rotation.x = 0.36;
    tier.castShadow = true;
    bg.add(tier);
    group.add(bg);
  }

  // 8. FULL 1955 HISTORIC BANKED CONCRETE OVAL ("ANELLO ALTA VELOCITÀ / SOPRAELEVATA") (Photos: image_5.png, images_2.jpg, image_7.png)
  // Part A: North Banked Curve Viaduct crossing right OVER the Serraglio straight before Ascari (Photo: image_5.png)
  const serraglioSample = samples[Math.floor(N * 0.565) % N];
  const sopGroup = new THREE.Group();
  sopGroup.position.set(serraglioSample.pos.x, serraglioSample.asphaltY, serraglioSample.pos.z);
  sopGroup.rotation.y = Math.atan2(serraglioSample.tangent.x, serraglioSample.tangent.z) + 0.38;

  const bankedDeck = new THREE.Mesh(new THREE.BoxGeometry(210, 1.35, 14.8), weatheredConcreteMat);
  bankedDeck.position.set(0, 8.6, 0);
  bankedDeck.rotation.z = 0.32;
  bankedDeck.castShadow = true;
  bankedDeck.receiveShadow = true;
  sopGroup.add(bankedDeck);

  // Rusty vintage steel guardrails along top and bottom of the 1955 Sopraelevata deck
  const railMat = new THREE.MeshStandardMaterial({ color: '#4d433e', roughness: 0.78, metalness: 0.45 });
  for (const rz of [-7.1, 7.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(210, 0.85, 0.25), railMat);
    rail.position.set(0, 9.4, rz);
    rail.rotation.z = 0.32;
    sopGroup.add(rail);
  }

  for (const px of [-88, -70, -52, -35, -21, 21, 35, 52, 70, 88]) {
    const pierH = 8.4 + Math.sin(0.32) * px * 0.45;
    if (pierH > 2.2) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(1.45, pierH, 11.4), weatheredConcreteMat);
      pier.position.set(px, pierH * 0.5, 0);
      pier.castShadow = true;
      sopGroup.add(pier);
    }
  }
  group.add(sopGroup);

  // Part B: South Banked Curve of the 1955 Sopraelevata running inside/parallel to Curva Parabolica & Back Straight (Photos: image_7.png, images_2.jpg, images_3.jpg)
  const southOvalParts: THREE.BufferGeometry[] = [];
  for (let i = Math.floor(N * 0.72); i < Math.floor(N * 0.98); i += 2) {
    const s = samples[i % N];
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    const isCurve = i > Math.floor(N * 0.83);
    const bankTilt = isCurve ? 0.44 : 0.08;
    const innerDist = isCurve ? wallOff + 14.0 : wallOff + 18.0;
    const slab = new THREE.BoxGeometry(11.5, 0.9, 9.5);
    slab.rotateZ(-bankTilt);
    slab.rotateY(yaw);
    slab.translate(
      s.pos.x + s.right.x * innerDist,
      s.asphaltY + (isCurve ? 2.6 : 0.6),
      s.pos.z + s.right.z * innerDist
    );
    southOvalParts.push(normTrackGeo(slab));
  }
  if (southOvalParts.length) {
    const southOvalMesh = new THREE.Mesh(mergeGeometries(southOvalParts, false)!, weatheredConcreteMat);
    southOvalParts.forEach((g) => g.dispose());
    southOvalMesh.castShadow = true;
    southOvalMesh.receiveShadow = true;
    group.add(southOvalMesh);
  }

  // 9. Yellow Manitou Telehandler Cranes, White/Red FIA Medical Ambulances & Paddock Motorhome Trucks (Photos: 1657349836.avif, image_7.png, images_3.jpg)
  const craneYellowMat = new THREE.MeshStandardMaterial({ color: '#f59c00', roughness: 0.38, metalness: 0.25 });
  const darkMetalMat = new THREE.MeshStandardMaterial({ color: '#1b1f26', roughness: 0.5, metalness: 0.6 });
  const ambulanceWhiteMat = new THREE.MeshStandardMaterial({ color: '#f4f7fb', roughness: 0.3, metalness: 0.1 });
  const ambulanceRedMat = new THREE.MeshStandardMaterial({ color: '#e1121a', roughness: 0.35, metalness: 0.1 });

  // Place Manitou Telehandler Recovery Cranes & Ambulances behind Turn 1 Rettifilo, Roggia & Ascari barriers!
  for (const cFrac of [0.132, 0.152, 0.335, 0.642, 0.885]) {
    const cs = samples[Math.floor(N * cFrac) % N];
    const cg = new THREE.Group();
    const side = cFrac < 0.2 ? -1 : 1;
    cg.position.set(
      cs.pos.x + cs.right.x * (side * (wallOff + 4.5)),
      cs.asphaltY,
      cs.pos.z + cs.right.z * (side * (wallOff + 4.5))
    );
    cg.rotation.y = Math.atan2(cs.tangent.x, cs.tangent.z) + 0.4;

    // Telehandler Tractor Chassis + Raised Telescopic Boom Arm
    const tractorBody = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.65, 4.4), craneYellowMat);
    tractorBody.position.set(0, 1.1, 0);
    tractorBody.castShadow = true;
    cg.add(tractorBody);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.35, 1.8), darkMetalMat);
    cab.position.set(-0.45, 2.1, 0.2);
    cg.add(cab);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 7.2), craneYellowMat);
    boom.position.set(0.35, 3.2, 1.6);
    boom.rotation.x = 0.48;
    boom.castShadow = true;
    cg.add(boom);

    // FIA White/Red Medical Ambulance Van parked alongside the crane (Photo: 1657349836.avif)
    const amb = new THREE.Mesh(new THREE.BoxGeometry(2.25, 2.55, 5.6), ambulanceWhiteMat);
    amb.position.set(0, 1.35, -7.2);
    amb.castShadow = true;
    cg.add(amb);
    const ambStripe = new THREE.Mesh(new THREE.BoxGeometry(2.30, 0.45, 5.64), ambulanceRedMat);
    ambStripe.position.set(0, 1.35, -7.2);
    cg.add(ambStripe);

    group.add(cg);
  }

  // White Team Hospitality Trucks & Motorhomes in the Main Paddock & Parabolica Inner Karting Lot (Photos: image_7.png, images_3.jpg)
  const truckParts: THREE.BufferGeometry[] = [];
  const mainPaddockS = samples[Math.floor(N * 0.04) % N];
  const padYaw = Math.atan2(mainPaddockS.tangent.x, mainPaddockS.tangent.z);
  for (let row = 0; row < 2; row++) {
    for (let t = -5; t <= 5; t++) {
      const tr = new THREE.BoxGeometry(2.65, 3.85, 13.5);
      tr.rotateY(padYaw);
      const alongOff = t * 16.5;
      const latOff = wallOff + 28.0 + row * 11.0;
      tr.translate(
        mainPaddockS.pos.x + mainPaddockS.right.x * latOff + mainPaddockS.tangent.x * alongOff,
        mainPaddockS.asphaltY + 1.95,
        mainPaddockS.pos.z + mainPaddockS.right.z * latOff + mainPaddockS.tangent.z * alongOff
      );
      truckParts.push(normTrackGeo(tr));
    }
  }
  if (truckParts.length) {
    const trucksMesh = new THREE.Mesh(mergeGeometries(truckParts, false)!, ambulanceWhiteMat);
    truckParts.forEach((g) => g.dispose());
    trucksMesh.castShadow = true;
    group.add(trucksMesh);
  }
}

/**
 * Ultra-Realistic 3D Botanical Scots Pine / Douglas Fir Canopy Builder (ZERO flat giant X-planes!)
 * Builds 40 real 3D arched, cupped, drooping pine bough-fans spiraling in phyllotaxis whorls around the 3D trunk,
 * with UV (0.5, 0) anchored directly at the trunk bark and fanning outward into 1K pine needles!
 */
function buildPineFrondCanopyGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const nBoughs = 28;
  for (let b = 0; b < nBoughs; b++) {
    const hFrac = b / (nBoughs - 1); // 0 at lower skirt (3.0m) -> 1 at upper spire (16.4m)
    const yAttach = 3.0 + hFrac * 13.4;

    // Conical Scots Pine / Douglas Fir profile: lush wide lower/mid boughs tapering cleanly to spire
    const profileWidth = Math.sin(Math.min(1, hFrac * 0.92 + 0.16) * Math.PI * 0.88);
    const boughLen = 1.45 + (1.0 - Math.pow(hFrac, 1.15)) * 3.55;
    const boughWidth = boughLen * (0.98 + profileWidth * 0.30);

    // Subdivided 3x3 bough mesh with local origin (0,0,0) at trunk attachment (u=0.5, v=0)
    const bough = new THREE.PlaneGeometry(boughWidth, boughLen, 3, 3);
    bough.translate(0, boughLen * 0.5, 0);

    const pos = bough.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const ly = pos.getY(i);
      const t = ly / boughLen;
      const uSym = lx / (boughWidth * 0.5);
      const archZ = Math.sin(t * Math.PI) * 0.26 - t * t * (0.56 * (1.0 - hFrac * 0.55)) - uSym * uSym * 0.16;
      pos.setZ(i, archZ);
    }

    const pitchOut = THREE.MathUtils.lerp(1.34, 0.44, Math.pow(hFrac, 0.9));
    bough.rotateX(pitchOut);
    bough.rotateZ(((b % 3) - 1) * 0.24);

    const azimuth = b * 2.3999632;
    bough.rotateY(azimuth);

    const trunkRadiusAtY = THREE.MathUtils.lerp(0.28, 0.05, hFrac);
    bough.translate(Math.sin(azimuth) * trunkRadiusAtY, yAttach, Math.cos(azimuth) * trunkRadiusAtY);
    bough.computeVertexNormals();
    parts.push(bough.toNonIndexed());
    bough.dispose();
  }

  for (let top = 0; top < 4; top++) {
    const crownShoot = new THREE.PlaneGeometry(1.55, 1.95, 2, 2);
    crownShoot.translate(0, 0.95, 0);
    crownShoot.rotateX(0.22);
    crownShoot.rotateY((top / 4) * Math.PI * 2 + 0.4);
    crownShoot.translate(0, 15.65, 0);
    crownShoot.computeVertexNormals();
    parts.push(crownShoot.toNonIndexed());
    crownShoot.dispose();
  }

  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());

  const mPos = merged.attributes.position;
  const mNorm = merged.attributes.normal;
  const cols = new Float32Array(mPos.count * 3);
  const cCoreShadow = new THREE.Color('#0f1f11');
  const cMidPine = new THREE.Color('#284729');
  const cTipSun = new THREE.Color('#5f8548');
  const tmp = new THREE.Color();
  const bentN = new THREE.Vector3();

  for (let i = 0; i < mPos.count; i++) {
    const vx = mPos.getX(i);
    const vy = mPos.getY(i);
    const vz = mPos.getZ(i);

    bentN.set(vx, (vy - 7.2) * 0.40 + 1.85, vz);
    if (bentN.lengthSq() < 0.01) bentN.set(0, 1, 0);
    else bentN.normalize();
    mNorm.setXYZ(i, bentN.x, bentN.y, bentN.z);

    const hFrac = THREE.MathUtils.clamp((vy - 2.6) / 14.5, 0, 1);
    const maxRAtH = THREE.MathUtils.lerp(4.6, 1.1, hFrac);
    const rFrac = THREE.MathUtils.clamp(Math.hypot(vx, vz) / maxRAtH, 0, 1);
    const light = THREE.MathUtils.clamp(hFrac * 0.46 + rFrac * 0.54, 0, 1);
    if (light < 0.5) tmp.copy(cCoreShadow).lerp(cMidPine, light * 2.0);
    else tmp.copy(cMidPine).lerp(cTipSun, (light - 0.5) * 2.0);
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return merged;
}

function buildDeciduousCardCanopyGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const centers = [
    { x: 0.0,  y: 6.3, z: 0.0,  s: 4.5 },
    { x: 2.05, y: 5.9, z: 1.05, s: 4.1 },
    { x: -1.95, y: 6.0, z: 1.15, s: 4.1 },
    { x: 0.45, y: 5.8, z: -2.05, s: 4.1 },
    { x: -0.95, y: 6.6, z: -1.55, s: 3.9 },
    { x: 1.55, y: 8.1, z: -0.75, s: 3.9 },
    { x: -1.45, y: 8.2, z: 0.45, s: 3.8 },
    { x: 0.05, y: 9.5, z: 0.15, s: 3.7 }
  ];

  let idx = 0;
  for (const c of centers) {
    for (let k = 0; k < 5; k++) {
      idx++;
      const card = new THREE.PlaneGeometry(c.s, c.s, 2, 2);
      const pos = card.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        // 3D hemispherical dome cupping so every leaf spray wraps volumetrically around the crown
        pos.setZ(i, -(vx * vx + vy * vy) * 0.105);
      }
      card.rotateX((k * 0.58) - 0.92 + Math.sin(idx * 1.7) * 0.24);
      card.rotateY(idx * 2.3999632);
      card.rotateZ(Math.cos(idx * 1.3) * 0.32);
      card.translate(
        c.x + Math.sin(idx * 3.1) * 0.45,
        c.y + Math.cos(idx * 2.3) * 0.40,
        c.z + Math.sin(idx * 1.9) * 0.45
      );
      card.computeVertexNormals();
      parts.push(card.toNonIndexed());
      card.dispose();
    }
  }

  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());

  const mPos = merged.attributes.position;
  const mNorm = merged.attributes.normal;
  const cols = new Float32Array(mPos.count * 3);
  const cShadow = new THREE.Color('#182811');
  const cMid = new THREE.Color('#406024');
  const cSun = new THREE.Color('#7ca342');
  const tmp = new THREE.Color();
  const bentN = new THREE.Vector3();

  for (let i = 0; i < mPos.count; i++) {
    const vx = mPos.getX(i);
    const vy = mPos.getY(i);
    const vz = mPos.getZ(i);

    bentN.set(vx, (vy - 6.1) * 0.85 + 1.25, vz).normalize();
    mNorm.setXYZ(i, bentN.x, bentN.y, bentN.z);

    const hFrac = THREE.MathUtils.clamp((vy - 3.8) / 7.8, 0, 1);
    const rFrac = THREE.MathUtils.clamp(Math.hypot(vx, vz) / 4.2, 0, 1);
    const light = THREE.MathUtils.clamp(hFrac * 0.54 + rFrac * 0.46, 0, 1);
    if (light < 0.5) tmp.copy(cShadow).lerp(cMid, light * 2.0);
    else tmp.copy(cMid).lerp(cSun, (light - 0.5) * 2.0);
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return merged;
}

/**
 * 3D Volumetric Roadside Fern / Bracken / Heather Rosette Shrub with Bent Hemispherical Normals
 */
function buildFernBushGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const nShells = 7;
  for (let k = 0; k < nShells; k++) {
    const card = new THREE.PlaneGeometry(2.5, 1.95, 3, 3);
    const pos = card.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      pos.setZ(i, -(vx * vx + vy * vy) * 0.14);
    }
    card.rotateX(0.42 + (k % 3) * 0.26);
    card.rotateY((k / nShells) * Math.PI * 2);
    card.translate(0, 0.84, 0);
    card.computeVertexNormals();
    parts.push(card.toNonIndexed());
    card.dispose();
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());

  const mPos = merged.attributes.position;
  const mNorm = merged.attributes.normal;
  const cols = new Float32Array(mPos.count * 3);
  const cBot = new THREE.Color('#14230e');
  const cTop = new THREE.Color('#5f7f30');
  const tmp = new THREE.Color();
  const bentN = new THREE.Vector3();

  for (let i = 0; i < mPos.count; i++) {
    const vx = mPos.getX(i);
    const vy = mPos.getY(i);
    const vz = mPos.getZ(i);
    bentN.set(vx, Math.max(0.25, vy + 0.55), vz).normalize();
    mNorm.setXYZ(i, bentN.x, bentN.y, bentN.z);

    const h = THREE.MathUtils.clamp(vy / 1.75, 0, 1);
    tmp.copy(cBot).lerp(cTop, h);
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return merged;
}

/**
 * Builds an Organic Curved 3D Tree Trunk with Flared Root Buttresses & Real 3D Woody Branches
 */
function buildBranchedTrunkGeo(isTallPine = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  if (isTallPine) {
    // Organic gently wind-curved Scots Pine trunk from root flare (-0.2m) to upper spire (15.8m)
    const trunkPts = [
      new THREE.Vector3(0.0, -0.2, 0.0),
      new THREE.Vector3(0.08, 3.8, -0.05),
      new THREE.Vector3(-0.06, 8.2, 0.09),
      new THREE.Vector3(0.04, 12.4, -0.04),
      new THREE.Vector3(0.0, 15.8, 0.0)
    ];
    parts.push(normTrackGeo(buildTaperedTubeGeo(trunkPts, 0.44, 0.055, 16, 9)));

    // 5 Flared 3D Root Buttresses anchoring trunk into forest soil
    for (let r = 0; r < 5; r++) {
      const ang = (r / 5) * Math.PI * 2 + 0.3;
      const rootPts = [
        new THREE.Vector3(Math.sin(ang) * 0.72, -0.18, Math.cos(ang) * 0.72),
        new THREE.Vector3(Math.sin(ang) * 0.36, 0.35, Math.cos(ang) * 0.36),
        new THREE.Vector3(Math.sin(ang) * 0.14, 1.15, Math.cos(ang) * 0.14)
      ];
      parts.push(normTrackGeo(buildTaperedTubeGeo(rootPts, 0.13, 0.05, 5, 6)));
    }

    // 16 Real 3D Gnarled Pine Branches radiating into the bough whorls!
    for (let b = 0; b < 16; b++) {
      const frac = b / 15;
      const yB = 3.2 + frac * 11.2;
      const ang = b * 2.3999632;
      const bLen = THREE.MathUtils.lerp(2.45, 0.85, frac);
      const droop = THREE.MathUtils.lerp(-0.38, 0.25, frac);
      const brPts = [
        new THREE.Vector3(0, yB, 0),
        new THREE.Vector3(Math.sin(ang) * bLen * 0.55, yB + 0.18, Math.cos(ang) * bLen * 0.55),
        new THREE.Vector3(Math.sin(ang) * bLen, yB + droop, Math.cos(ang) * bLen)
      ];
      parts.push(normTrackGeo(buildTaperedTubeGeo(brPts, THREE.MathUtils.lerp(0.11, 0.045, frac), 0.018, 5, 5)));
    }
  } else {
    // Organic curved Oak / Birch main trunk + 5 primary curved limbs + secondary forks
    const trunkPts = [
      new THREE.Vector3(0.0, -0.2, 0.0),
      new THREE.Vector3(0.10, 1.8, 0.06),
      new THREE.Vector3(-0.05, 3.8, -0.04),
      new THREE.Vector3(0.02, 5.6, 0.02)
    ];
    parts.push(normTrackGeo(buildTaperedTubeGeo(trunkPts, 0.48, 0.20, 10, 9)));

    for (let r = 0; r < 5; r++) {
      const ang = (r / 5) * Math.PI * 2;
      const rootPts = [
        new THREE.Vector3(Math.sin(ang) * 0.78, -0.18, Math.cos(ang) * 0.78),
        new THREE.Vector3(Math.sin(ang) * 0.38, 0.42, Math.cos(ang) * 0.38),
        new THREE.Vector3(Math.sin(ang) * 0.16, 1.25, Math.cos(ang) * 0.16)
      ];
      parts.push(normTrackGeo(buildTaperedTubeGeo(rootPts, 0.15, 0.06, 5, 6)));
    }

    const limbTargets = [
      { x: 2.05, y: 6.1, z: 1.05, sy: 3.9 },
      { x: -1.95, y: 6.2, z: 1.15, sy: 4.1 },
      { x: 0.45, y: 6.0, z: -2.05, sy: 3.8 },
      { x: 1.45, y: 8.1, z: -0.75, sy: 4.6 },
      { x: -1.35, y: 8.2, z: 0.45, sy: 4.8 },
      { x: 0.05, y: 9.2, z: 0.15, sy: 5.2 }
    ];
    for (const lt of limbTargets) {
      const lPts = [
        new THREE.Vector3(0, lt.sy, 0),
        new THREE.Vector3(lt.x * 0.55, (lt.sy + lt.y) * 0.5 + 0.28, lt.z * 0.55),
        new THREE.Vector3(lt.x, lt.y, lt.z)
      ];
      parts.push(normTrackGeo(buildTaperedTubeGeo(lPts, 0.17, 0.045, 7, 6)));
    }
  }

  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return merged;
}

/**
 * Adds a Forza Horizon 4 Scenic Shimmering Lake in the Distant Left Valley Horizon
 */
function addScenicHorizonLake(group: THREE.Group) {
  const lakeGeo = new THREE.CircleGeometry(210, 48);
  lakeGeo.rotateX(-Math.PI / 2);
  const lakeMat = new THREE.MeshPhysicalMaterial({
    color: '#193247',
    metalness: 0.90,
    roughness: 0.10,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 2.0
  });
  const lake = new THREE.Mesh(lakeGeo, lakeMat);
  lake.position.set(610, -1.8, 320);
  group.add(lake);
}

function addTreesInstancedAAA(
  group: THREE.Group,
  samples: TrackSample[],
  N: number,
  wallOff: number,
  vergeInnerOff: number,
  type: 'deciduous' | 'pine',
  count: number
) {
  addScenicHorizonLake(group);

  const pineRatio = type === 'pine' ? 0.80 : 0.62;
  const pineCount = Math.round(count * pineRatio);
  const decidCount = Math.max(40, count - pineCount);
  const bushCount = Math.round(count * 1.55);

  const pineTrunkGeo = buildBranchedTrunkGeo(true);
  const decidTrunkGeo = buildBranchedTrunkGeo(false);
  const scanBark = fh6Assets.pbr.get('bark');
  if (scanBark) {
    scanBark.albedo.repeat.set(2, 12);
    scanBark.normal.repeat.set(2, 12);
    scanBark.orm.repeat.set(2, 12);
  }
  const trunkMat = new THREE.MeshStandardMaterial({
    map: scanBark ? scanBark.albedo : undefined,
    normalMap: scanBark ? scanBark.normal : undefined,
    normalScale: new THREE.Vector2(1.3, 1.3),
    roughnessMap: scanBark ? scanBark.orm : undefined,
    color: scanBark ? '#8c7662' : '#3b2c1e',
    roughness: 0.94,
    metalness: 0.02
  });

  const aoGeo = new THREE.CircleGeometry(4.0, 12);
  aoGeo.rotateX(-Math.PI / 2);
  const aoMat = new THREE.MeshBasicMaterial({
    color: '#050a04',
    transparent: true,
    opacity: 0.45,
    depthWrite: false
  });

  // Bent Hemispherical Canopy Normals + Golden-Hour Subsurface Scattering Leaf Translucency!
  const keepBentNormalsAndSubsurface = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
       normal = normalize( vNormal );
       nonPerturbedNormal = normal;`
    ).replace(
      '#include <opaque_fragment>',
      `// Warm golden-hour sunlit subsurface translucency through thin leaves & pine needles
       vec3 viewToSun = normalize(vec3(0.65, 0.22, 0.48));
       float backLit = pow(clamp(dot(normalize(-vViewPosition), -viewToSun), 0.0, 1.0), 3.0);
       outgoingLight += diffuseColor.rgb * vec3(0.45, 0.58, 0.14) * backLit * 0.52;
       #include <opaque_fragment>`
    );
  };

  const pineCanopyGeo = buildPineFrondCanopyGeo();
  const pineMat = new THREE.MeshStandardMaterial({
    map: getPineBranchAlphaTexture(),
    alphaTest: 0.34,
    side: THREE.DoubleSide,
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.02
  });
  pineMat.onBeforeCompile = keepBentNormalsAndSubsurface;

  const decidCanopyGeo = buildDeciduousCardCanopyGeo();
  const decidMat = new THREE.MeshStandardMaterial({
    map: getDeciduousLeafAlphaTexture(),
    alphaTest: 0.36,
    side: THREE.DoubleSide,
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.02
  });
  decidMat.onBeforeCompile = keepBentNormalsAndSubsurface;

  const bushGeo = buildFernBushGeo();

  const pineTrunks = new THREE.InstancedMesh(pineTrunkGeo, trunkMat, pineCount);
  pineTrunks.castShadow = true;
  const pineCrowns = new THREE.InstancedMesh(pineCanopyGeo, pineMat, pineCount);
  pineCrowns.castShadow = true;

  const decidTrunks = new THREE.InstancedMesh(decidTrunkGeo, trunkMat, decidCount);
  decidTrunks.castShadow = true;
  const decidCrowns = new THREE.InstancedMesh(decidCanopyGeo, decidMat, decidCount);
  decidCrowns.castShadow = true;

  const aoDiscs = new THREE.InstancedMesh(aoGeo, aoMat, count);
  const bushes = new THREE.InstancedMesh(bushGeo, decidMat, bushCount);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let placedPine = 0;
  let placedDecid = 0;
  let placedTotal = 0;

  const buildingIdxs = [20, 26, Math.floor(N * 0.22), Math.floor(N * 0.54), Math.floor(N * 0.88)];

  for (let attempt = 0; attempt < count * 8 && placedTotal < count; attempt++) {
    const sIdx = Math.floor(Math.random() * N);
    const s = samples[sIdx];
    const side = Math.random() > 0.5 ? 1 : -1;
    const randBias = Math.pow(Math.random(), 1.55);
    const dist = wallOff + 3.2 + randBias * 140;

    let hitsBuilding = false;
    for (const bIdx of buildingIdxs) {
      const diff = Math.min(Math.abs(sIdx - bIdx), N - Math.abs(sIdx - bIdx));
      if (diff < 24 && dist < wallOff + 28) {
        hitsBuilding = true;
        break;
      }
    }
    if (hitsBuilding) continue;

    const px = s.pos.x + s.right.x * (side * dist);
    const pz = s.pos.z + s.right.z * (side * dist);

    let tooClose = false;
    const minClearSq = (wallOff + 2.8) * (wallOff + 2.8);
    for (let i = 0; i < N; i += 6) {
      const dx = px - samples[i].pos.x;
      const dz = pz - samples[i].pos.z;
      if (dx * dx + dz * dz < minClearSq) { tooClose = true; break; }
    }
    if (tooClose) continue;

    const wantPine = placedPine < pineCount && (placedDecid >= decidCount || Math.random() < pineRatio);
    const sc = wantPine ? (1.05 + Math.random() * 0.95) : (0.95 + Math.random() * 0.95);
    const py = s.pos.y;
    const rotY = Math.random() * Math.PI * 2;

    dummy.position.set(px, py + 0.05, pz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(sc, 1, sc);
    dummy.updateMatrix();
    aoDiscs.setMatrixAt(placedTotal, dummy.matrix);

    dummy.position.set(px, py, pz);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(sc, sc, sc);
    dummy.updateMatrix();

    if (wantPine) {
      pineTrunks.setMatrixAt(placedPine, dummy.matrix);
      pineCrowns.setMatrixAt(placedPine, dummy.matrix);
      color.setHSL(0.32 + (Math.random() - 0.5) * 0.06, 0.28 + Math.random() * 0.14, 0.72 + Math.random() * 0.22);
      pineCrowns.setColorAt(placedPine, color);
      placedPine++;
    } else {
      decidTrunks.setMatrixAt(placedDecid, dummy.matrix);
      decidCrowns.setMatrixAt(placedDecid, dummy.matrix);
      const isAutumn = Math.random() < 0.35;
      if (isAutumn) {
        color.setHSL(0.07 + Math.random() * 0.07, 0.65 + Math.random() * 0.20, 0.68 + Math.random() * 0.20);
      } else {
        color.setHSL(0.24 + (Math.random() - 0.5) * 0.07, 0.32 + Math.random() * 0.16, 0.72 + Math.random() * 0.22);
      }
      decidCrowns.setColorAt(placedDecid, color);
      placedDecid++;
    }
    placedTotal++;
  }

  let placedBushes = 0;
  for (let attempt = 0; attempt < bushCount * 4 && placedBushes < bushCount; attempt++) {
    const sIdx = Math.floor(Math.random() * N);
    const s = samples[sIdx];
    const side = Math.random() > 0.5 ? 1 : -1;
    const dist = wallOff + 1.2 + Math.pow(Math.random(), 1.8) * 55;
    const px = s.pos.x + s.right.x * (side * dist);
    const pz = s.pos.z + s.right.z * (side * dist);

    let tooClose = false;
    const minClearSq = (wallOff + 0.8) * (wallOff + 0.8);
    for (let i = 0; i < N; i += 8) {
      const dx = px - samples[i].pos.x;
      const dz = pz - samples[i].pos.z;
      if (dx * dx + dz * dz < minClearSq) { tooClose = true; break; }
    }
    if (tooClose) continue;

    const sc = 0.75 + Math.random() * 1.15;
    dummy.position.set(px, s.pos.y - 0.08, pz);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.set(sc, sc * (0.75 + Math.random() * 0.45), sc);
    dummy.updateMatrix();
    bushes.setMatrixAt(placedBushes, dummy.matrix);

    const isRussetBracken = Math.random() < 0.38;
    if (isRussetBracken) {
      color.setHSL(0.06 + Math.random() * 0.07, 0.62, 0.58 + Math.random() * 0.22);
    } else {
      color.setHSL(0.25 + (Math.random() - 0.5) * 0.07, 0.38, 0.64 + Math.random() * 0.24);
    }
    bushes.setColorAt(placedBushes, color);
    placedBushes++;
  }

  pineTrunks.count = placedPine;
  pineCrowns.count = placedPine;
  decidTrunks.count = placedDecid;
  decidCrowns.count = placedDecid;
  aoDiscs.count = placedTotal;
  bushes.count = placedBushes;
  group.add(aoDiscs, pineTrunks, pineCrowns, decidTrunks, decidCrowns, bushes);

  // ---------- FORZA HORIZON 6: 3,400 INSTANCED 3D ROADSIDE WILD-GRASS CLUMPS (1 DRAW CALL!) ----------
  if (fh6Assets.wildGrassClump) {
    const grassCount = Math.round(count * 3.8);
    const grassMat = new THREE.MeshStandardMaterial({
      color: '#3f6b24',
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.02,
      side: THREE.DoubleSide
    });
    const grassInst = new THREE.InstancedMesh(fh6Assets.wildGrassClump, grassMat, grassCount);
    grassInst.receiveShadow = true;
    let placedGrass = 0;
    const vergeSpan = Math.max(1.2, wallOff - vergeInnerOff - 1.1);
    for (let g = 0; g < grassCount * 2 && placedGrass < grassCount; g++) {
      const sIdx = Math.floor(Math.random() * N);
      const s = samples[sIdx];
      if (s.isPitZone || s.isTunnel) continue;
      const side = Math.random() > 0.5 ? 1 : -1;
      // 65% lush roadside grass tufts on the trackside verge (outside curb, before stone wall!), 35% behind wooden fence
      const onVerge = Math.random() < 0.65;
      const dist = onVerge
        ? vergeInnerOff + 0.65 + Math.random() * vergeSpan
        : wallOff + 1.0 + Math.random() * 14.0;
      const gx = s.pos.x + s.right.x * (side * dist);
      const gz = s.pos.z + s.right.z * (side * dist);

      const gScale = onVerge ? (0.48 + Math.random() * 0.42) : (0.75 + Math.random() * 0.65);
      dummy.position.set(gx, s.pos.y - 0.03, gz);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.set(gScale * 1.15, gScale, gScale * 1.15);
      dummy.updateMatrix();
      grassInst.setMatrixAt(placedGrass, dummy.matrix);

      color.setHSL(0.24 + (Math.random() - 0.5) * 0.07, 0.36 + Math.random() * 0.18, 0.52 + Math.random() * 0.26);
      grassInst.setColorAt(placedGrass, color);
      placedGrass++;
    }
    grassInst.count = placedGrass;
    group.add(grassInst);
  }

  // ---------- FORZA HORIZON 6: INSTANCED DISPLACED PHOTOGRAMMETRY CLIFF BOULDERS (2 DRAW CALLS!) ----------
  const scanRock = fh6Assets.pbr.get('rock');
  if (fh6Assets.cliffBoulderA && fh6Assets.cliffBoulderB) {
    const rockMat = new THREE.MeshStandardMaterial({
      map: scanRock ? scanRock.albedo : undefined,
      normalMap: scanRock ? scanRock.normal : undefined,
      normalScale: new THREE.Vector2(1.35, 1.35),
      roughnessMap: scanRock ? scanRock.orm : undefined,
      color: type === 'pine' ? '#8c949e' : '#7d7a72',
      roughness: 0.90,
      metalness: 0.04
    });
    const boulderTotal = type === 'pine' ? 54 : 28;
    const bInstA = new THREE.InstancedMesh(fh6Assets.cliffBoulderA, rockMat, boulderTotal);
    const bInstB = new THREE.InstancedMesh(fh6Assets.cliffBoulderB, rockMat, boulderTotal);
    bInstA.castShadow = true;
    bInstA.receiveShadow = true;
    bInstB.castShadow = true;
    bInstB.receiveShadow = true;
    let pA = 0, pB = 0;

    for (let b = 0; b < boulderTotal * 5 && (pA + pB) < boulderTotal * 1.4; b++) {
      const sIdx = Math.floor(Math.random() * N);
      const s = samples[sIdx];
      if (s.isPitZone || (sIdx < 45 || sIdx > N - 45)) continue;
      const side = Math.random() > 0.5 ? 1 : -1;
      const dist = wallOff + (type === 'pine' ? 14 : 28) + Math.random() * 95;
      const rx = s.pos.x + s.right.x * (side * dist);
      const rz = s.pos.z + s.right.z * (side * dist);

      let nearTrack = false;
      const clearSq = (wallOff + 10) * (wallOff + 10);
      for (let i = 0; i < N; i += 8) {
        const dx = rx - samples[i].pos.x;
        const dz = rz - samples[i].pos.z;
        if (dx * dx + dz * dz < clearSq) { nearTrack = true; break; }
      }
      if (nearTrack) continue;

      const sc = type === 'pine' ? (0.85 + Math.random() * 1.65) : (0.55 + Math.random() * 0.95);
      dummy.position.set(rx, s.pos.y - 0.6, rz);
      dummy.rotation.set((Math.random() - 0.5) * 0.18, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.18);
      dummy.scale.set(sc, sc * (0.75 + Math.random() * 0.55), sc);
      dummy.updateMatrix();
      if (b % 2 === 0 && pA < boulderTotal) {
        bInstA.setMatrixAt(pA++, dummy.matrix);
      } else if (pB < boulderTotal) {
        bInstB.setMatrixAt(pB++, dummy.matrix);
      }
    }
    bInstA.count = pA;
    bInstB.count = pB;
    group.add(bInstA, bInstB);
  }
}

function addAlpineMountainRange(group: THREE.Group, isHighAlpine = true) {
  const segsR = 240;
  const segsH = 28;
  const maxH = isHighAlpine ? 250 : 95;
  const geo = new THREE.CylinderGeometry(860, 1340, maxH, segsR, segsH, true);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cForest = new THREE.Color(isHighAlpine ? '#1d3024' : '#213628');
  const cRock = new THREE.Color(isHighAlpine ? '#485666' : '#465c6b');
  const cSnow = new THREE.Color(isHighAlpine ? '#dce8f5' : '#6e8ba0');
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const hNorm = (y + maxH * 0.5) / maxH;
    const angle = Math.atan2(z, x);

    const r1 = 1.0 - Math.abs(Math.sin(angle * 5.0 + 0.8));
    const r2 = 1.0 - Math.abs(Math.sin(angle * 13.0 - 1.4));
    const r3 = 1.0 - Math.abs(Math.cos(angle * 29.0 + 0.3));
    const r4 = Math.sin(angle * 57.0) * 0.5 + 0.5;
    const ridge = 0.22 + r1 * 0.42 + r2 * 0.24 + r3 * 0.12 + r4 * 0.05;

    const slopeProfile = Math.pow(hNorm, 1.25);
    const newY = Math.max(-14, slopeProfile * (maxH * 1.12) * ridge - 10);
    const crag = 1.0 + (Math.sin(angle * 19.0 + hNorm * 8.0) * 0.045 + Math.cos(angle * 43.0 - hNorm * 14.0) * 0.02);
    pos.setXYZ(i, x * crag, newY, z * crag);

    if (isHighAlpine) {
      if (newY > 135) tmp.copy(cRock).lerp(cSnow, Math.min(1, (newY - 135) / 50));
      else if (newY > 40) tmp.copy(cForest).lerp(cRock, Math.min(1, (newY - 40) / 55));
      else tmp.copy(cForest);
    } else {
      const hFrac = Math.min(1, Math.max(0, newY / 85));
      tmp.copy(cForest).lerp(cRock, hFrac * 0.7).lerp(cSnow, hFrac * hFrac * 0.5);
    }

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const scanRock = fh6Assets.pbr.get('rock');
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.02,
    side: THREE.DoubleSide
  });

  // Inject Scanned Rock030 Photogrammetry Crag Detail & Rayleigh Aerial Perspective Mist Shader!
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMtnRock = { value: scanRock ? scanRock.albedo : null };
    shader.uniforms.uHasMtnRock = { value: scanRock ? 1.0 : 0.0 };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vMtnWorldPos;`
    ).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vMtnWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform sampler2D uMtnRock;
       uniform float uHasMtnRock;
       varying vec3 vMtnWorldPos;
       float mtnHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
       float mtnNoise(vec2 p) {
         vec2 i = floor(p);
         vec2 f = fract(p);
         f = f * f * (3.0 - 2.0 * f);
         return mix(mix(mtnHash(i), mtnHash(i + vec2(1,0)), f.x),
                    mix(mtnHash(i + vec2(0,1)), mtnHash(i + vec2(1,1)), f.x), f.y);
       }`
    ).replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       float strata = mtnNoise(vec2(vMtnWorldPos.x * 0.025 + vMtnWorldPos.z * 0.025, vMtnWorldPos.y * 0.14));
       float fineCrag = mtnNoise(vMtnWorldPos.xz * 0.12);
       if (uHasMtnRock > 0.5) {
         vec3 rScan = texture2D(uMtnRock, vec2((vMtnWorldPos.x + vMtnWorldPos.z) * 0.018, vMtnWorldPos.y * 0.032)).rgb;
         diffuseColor.rgb *= mix(vec3(0.85), rScan * 1.65, 0.55);
       }
       diffuseColor.rgb *= (0.76 + strata * 0.30 + fineCrag * 0.16);
       float distKm = clamp((length(vMtnWorldPos.xz) - 650.0) / 700.0, 0.0, 1.0);
       float hazeFactor = clamp(0.40 + distKm * 0.38, 0.0, 0.80);
       vec3 horizonMistLinear = vec3(0.18, 0.29, 0.44);
       diffuseColor.rgb = mix(diffuseColor.rgb, horizonMistLinear, hazeFactor);`
    );
  };

  group.add(new THREE.Mesh(geo, mat));
}

function addDesertTowersAndFloodlights(group: THREE.Group, samples: TrackSample[], N: number, wallOff: number) {
  const towerBodyMat = new THREE.MeshPhysicalMaterial({
    color: '#1c1d2b',
    metalness: 0.78,
    roughness: 0.20,
    clearcoat: 0.85
  });
  const neonGlowMat = new THREE.MeshStandardMaterial({
    color: '#ff9440',
    emissive: '#ff6a1a',
    emissiveIntensity: 2.6,
    toneMapped: false
  });

  const towerSpots = [[0, 0], [-460, 120], [450, 140], [120, -480], [-160, 490]];
  towerSpots.forEach(([tx, tz], idx) => {
    const tg = new THREE.Group();
    const h = 82 + (idx % 3) * 32;
    tg.position.set(tx, -2, tz);

    // Sculpted Hyperbolic Architectural Tower Shaft (Yas Marina / Lusail Control Spire style)
    const lathePts: THREE.Vector2[] = [];
    for (let s = 0; s <= 12; s++) {
      const f = s / 12;
      const r = 11.5 * Math.pow(1 - f * 0.65, 1.35) + (f > 0.72 && f < 0.88 ? 3.2 * Math.sin(((f - 0.72) / 0.16) * Math.PI) : 0);
      lathePts.push(new THREE.Vector2(Math.max(1.8, r), f * h));
    }
    const shaft = new THREE.Mesh(new THREE.LatheGeometry(lathePts, 24), towerBodyMat);
    tg.add(shaft);

    for (let r = 0; r < 4; r++) {
      const f = 0.36 + r * 0.17;
      const rad = 11.5 * Math.pow(1 - f * 0.65, 1.35) + 0.65;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.42, 10, 28), neonGlowMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = h * f;
      tg.add(ring);
    }
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 2.2, 26, 12), neonGlowMat);
    spire.position.y = h + 13;
    tg.add(spire);
    group.add(tg);
  });

  // 3D Cantilevered Multi-Pod FIA Night-Race Floodlight Masts
  const count = Math.ceil(N / 36);
  const mastParts: THREE.BufferGeometry[] = [];
  const mainMast = new THREE.CylinderGeometry(0.24, 0.46, 20.5, 10);
  mainMast.translate(0, 10.25, 0);
  mastParts.push(normTrackGeo(mainMast));
  const cantArm = new THREE.CylinderGeometry(0.18, 0.24, 4.6, 8);
  cantArm.rotateX(0.62);
  cantArm.translate(0, 21.6, 1.35);
  mastParts.push(normTrackGeo(cantArm));
  const headFrame = new THREE.BoxGeometry(4.2, 1.45, 0.42);
  headFrame.rotateX(0.38);
  headFrame.translate(0, 22.8, 2.55);
  mastParts.push(normTrackGeo(headFrame));
  const mastGeo = mergeGeometries(mastParts, false)!;
  mastParts.forEach((g) => g.dispose());

  const lampParts: THREE.BufferGeometry[] = [];
  for (const ly of [-0.36, 0.36]) {
    for (const lx of [-1.35, 0, 1.35]) {
      const pod = new THREE.BoxGeometry(1.05, 0.48, 0.18);
      pod.translate(lx, ly, 0.22);
      pod.rotateX(0.38);
      pod.translate(0, 22.8, 2.55);
      lampParts.push(normTrackGeo(pod));
    }
  }
  const lampHeadGeo = mergeGeometries(lampParts, false)!;
  lampParts.forEach((g) => g.dispose());

  const poles = new THREE.InstancedMesh(
    mastGeo,
    new THREE.MeshStandardMaterial({ color: '#3b4352', metalness: 0.78, roughness: 0.32 }),
    count
  );
  const heads = new THREE.InstancedMesh(
    lampHeadGeo,
    new THREE.MeshBasicMaterial({ color: '#fff8e2', toneMapped: false }),
    count
  );
  const dummy = new THREE.Object3D();
  let k = 0;
  for (let i = 0; i < N && k < count; i += 36) {
    const s = samples[i];
    const side = k % 2 === 0 ? 1 : -1;
    const px = s.pos.x + s.right.x * (side * (wallOff + 4.5));
    const pz = s.pos.z + s.right.z * (side * (wallOff + 4.5));
    dummy.position.set(px, s.pos.y, pz);
    dummy.lookAt(s.pos.x, s.pos.y, s.pos.z);
    dummy.updateMatrix();
    poles.setMatrixAt(k, dummy.matrix);
    heads.setMatrixAt(k, dummy.matrix);
    k++;
  }
  poles.count = k;
  heads.count = k;
  group.add(poles, heads);
}

function addNightCitySceneryOptimized(
  group: THREE.Group,
  samples: TrackSample[],
  N: number,
  wallOff: number,
  trackCfg: TrackConfig
) {
  const neonColors = ['#00f0ff', '#ff007f', '#ffbe0b', '#9d4edd'];
  const bldgMats = neonColors.map((c) => new THREE.MeshStandardMaterial({
    map: getBuildingTexture(c),
    emissiveMap: getBuildingTexture(c),
    emissive: '#ffffff',
    emissiveIntensity: 1.15,
    roughness: 0.30,
    metalness: 0.52
  }));

  const buckets: Array<Array<{ x: number; y: number; z: number; w: number; h: number; d: number; yaw: number }>> = [[], [], [], []];
  const minClearSq = (wallOff + 10) * (wallOff + 10);

  for (let i = 0; i < N; i += 9) {
    const s = samples[i];
    if (s.isTunnel) continue;
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    for (const side of [-1, 1]) {
      const dist = wallOff + 14 + Math.random() * 24;
      const px = s.pos.x + s.right.x * (side * dist);
      const pz = s.pos.z + s.right.z * (side * dist);

      let conflict = false;
      for (let j = 0; j < N; j += 10) {
        const dx = px - samples[j].pos.x;
        const dz = pz - samples[j].pos.z;
        if (dx * dx + dz * dz < minClearSq) { conflict = true; break; }
      }
      if (conflict) continue;

      const w = 14 + Math.random() * 14;
      const d = 14 + Math.random() * 14;
      const h = 44 + Math.random() * 98;
      buckets[(i + (side > 0 ? 1 : 0)) % 4].push({ x: px, y: s.pos.y + h * 0.5 - 1, z: pz, w, h, d, yaw });
    }
  }

  // Sculpted 3-Tier Architectural Setback Skyscraper + Crown Penthouse + Spire (centered on [-0.5..+0.5] unit height)
  const towerParts: THREE.BufferGeometry[] = [];
  const podium = new THREE.BoxGeometry(1.06, 0.18, 1.06);
  podium.translate(0, -0.41, 0);
  towerParts.push(normTrackGeo(podium));

  const mainShaft = new THREE.BoxGeometry(0.94, 0.64, 0.94);
  mainShaft.translate(0, 0.0, 0);
  towerParts.push(normTrackGeo(mainShaft));

  const upperSetback = new THREE.BoxGeometry(0.74, 0.16, 0.74);
  upperSetback.translate(0, 0.40, 0);
  towerParts.push(normTrackGeo(upperSetback));

  const crownSpire = new THREE.CylinderGeometry(0.015, 0.045, 0.18, 6);
  crownSpire.translate(0, 0.56, 0);
  towerParts.push(normTrackGeo(crownSpire));

  const towerGeo = mergeGeometries(towerParts, false)!;
  towerParts.forEach((g) => g.dispose());

  const dummy = new THREE.Object3D();
  buckets.forEach((list, bIdx) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(towerGeo, bldgMats[bIdx], list.length);
    list.forEach((b, k) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      inst.setMatrixAt(k, dummy.matrix);
    });
    group.add(inst);
  });

  const buildNeonRail = (latOffset: number, colorHex: string) => {
    const positions = new Float32Array((N + 1) * 6);
    const indices = new Uint32Array(N * 6);
    for (let i = 0; i <= N; i++) {
      const s = samples[i % N];
      const bx = s.pos.x + s.right.x * latOffset;
      const by = s.pos.y + 1.24;
      const bz = s.pos.z + s.right.z * latOffset;
      const p6 = i * 6;
      positions[p6] = bx; positions[p6 + 1] = by; positions[p6 + 2] = bz;
      positions[p6 + 3] = bx; positions[p6 + 4] = by + 0.14; positions[p6 + 5] = bz;
      if (i < N) {
        const a = i * 2;
        const i6 = i * 6;
        indices[i6] = a; indices[i6 + 1] = a + 2; indices[i6 + 2] = a + 1;
        indices[i6 + 3] = a + 1; indices[i6 + 4] = a + 2; indices[i6 + 5] = a + 3;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide, toneMapped: false }));
  };
  group.add(buildNeonRail(-(wallOff - 0.14), '#00f0ff'));
  group.add(buildNeonRail(wallOff - 0.14, '#ff007f'));

  if (trackCfg.tunnelRange) {
    const tunnelIndices: number[] = [];
    for (let i = 0; i < N; i++) if (samples[i].isTunnel) tunnelIndices.push(i);
    if (tunnelIndices.length > 2) {
      const tH = 8.4;
      const tPos: number[] = [];
      const tIdx: number[] = [];
      for (let k = 0; k < tunnelIndices.length; k++) {
        const s = samples[tunnelIndices[k]];
        const lx = s.pos.x - s.right.x * (wallOff + 0.25);
        const lz = s.pos.z - s.right.z * (wallOff + 0.25);
        const rx = s.pos.x + s.right.x * (wallOff + 0.25);
        const rz = s.pos.z + s.right.z * (wallOff + 0.25);
        tPos.push(lx, s.pos.y - 0.2, lz, lx, s.pos.y + tH, lz, rx, s.pos.y + tH, rz, rx, s.pos.y - 0.2, rz);
        if (k < tunnelIndices.length - 1) {
          const a = k * 4, b = a + 4;
          tIdx.push(a, b, a + 1, a + 1, b, b + 1);
          tIdx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
          tIdx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
        }
      }
      const tunnelGeo = new THREE.BufferGeometry();
      tunnelGeo.setAttribute('position', new THREE.Float32BufferAttribute(tPos, 3));
      tunnelGeo.setIndex(tIdx);
      tunnelGeo.computeVertexNormals();
      group.add(new THREE.Mesh(tunnelGeo, new THREE.MeshStandardMaterial({
        color: '#111624', roughness: 0.42, metalness: 0.45, side: THREE.DoubleSide
      })));

      const ribIndices = tunnelIndices.filter((_, k) => k % 5 === 0);
      const ribGeo = new THREE.BoxGeometry(wallOff * 2 - 0.4, 0.30, 0.38);
      const cyanRibs = new THREE.InstancedMesh(ribGeo, new THREE.MeshBasicMaterial({ color: '#00f5ff', toneMapped: false }), ribIndices.length);
      const pinkRibs = new THREE.InstancedMesh(ribGeo, new THREE.MeshBasicMaterial({ color: '#ff2a85', toneMapped: false }), ribIndices.length);
      let cCount = 0, pCount = 0;
      ribIndices.forEach((idx, k) => {
        const s = samples[idx];
        dummy.position.set(s.pos.x, s.pos.y + tH - 0.32, s.pos.z);
        dummy.rotation.set(0, Math.atan2(s.tangent.x, s.tangent.z), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        if (k % 2 === 0) cyanRibs.setMatrixAt(cCount++, dummy.matrix);
        else pinkRibs.setMatrixAt(pCount++, dummy.matrix);
      });
      cyanRibs.count = cCount;
      pinkRibs.count = pCount;
      group.add(cyanRibs, pinkRibs);
    }
  }

  // Curved Highway Overhang Streetlamps
  const lampSamples = samples.filter((s, i) => i % 24 === 0 && !s.isTunnel);
  const poleParts: THREE.BufferGeometry[] = [];
  const vShaft = new THREE.CylinderGeometry(0.11, 0.19, 8.8, 8);
  vShaft.translate(0, 4.4, 0);
  poleParts.push(normTrackGeo(vShaft));
  const oArm = new THREE.CylinderGeometry(0.08, 0.11, 2.8, 8);
  oArm.rotateZ(-1.05);
  oArm.translate(1.15, 9.25, 0);
  poleParts.push(normTrackGeo(oArm));
  const lampHousing = new THREE.BoxGeometry(1.15, 0.14, 0.42);
  lampHousing.translate(2.35, 9.82, 0);
  poleParts.push(normTrackGeo(lampHousing));
  const streetPoleGeo = mergeGeometries(poleParts, false)!;
  poleParts.forEach((g) => g.dispose());

  const bulbGeo = new THREE.BoxGeometry(0.95, 0.08, 0.34);
  bulbGeo.translate(2.35, 9.74, 0);

  const lampPoles = new THREE.InstancedMesh(
    streetPoleGeo,
    new THREE.MeshStandardMaterial({ color: '#262e3d', metalness: 0.80, roughness: 0.28 }),
    lampSamples.length
  );
  const lampBulbs = new THREE.InstancedMesh(
    bulbGeo,
    new THREE.MeshBasicMaterial({ color: '#e4f8ff', toneMapped: false }),
    lampSamples.length
  );
  lampSamples.forEach((s, k) => {
    const px = s.pos.x - s.right.x * (wallOff + 0.9);
    const pz = s.pos.z - s.right.z * (wallOff + 0.9);
    dummy.position.set(px, s.pos.y, pz);
    dummy.rotation.set(0, Math.atan2(s.tangent.x, s.tangent.z), 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    lampPoles.setMatrixAt(k, dummy.matrix);
    lampBulbs.setMatrixAt(k, dummy.matrix);
  });
  group.add(lampPoles, lampBulbs);
}
