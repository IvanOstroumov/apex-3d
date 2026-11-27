import type * as THREE from 'three';

export type WeatherType = 'dry' | 'overcast' | 'rain' | 'dynamic';
export type TimeOfDayType = 'day' | 'sunset' | 'night';
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
export type GameMode =
  | 'quick_race'
  | 'weekend'
  | 'championship'
  | 'time_attack'
  | 'track_day'
  | 'knockout'
  | 'team_race'
  | 'cops_robbers'
  | 'infection';
export type TireCompoundId = 'soft' | 'medium' | 'hard' | 'inter' | 'wet';
export type DifficultyId = 'rookie' | 'pro' | 'ace' | 'legend';
export type CameraMode = 'CHASE' | 'T-CAM' | 'COCKPIT' | 'NOSE';
export type ERSMode = 'none' | 'medium' | 'overtake' | 'hotlap';
export type SetupPresetId = 'balanced' | 'low_drag' | 'high_downforce' | 'anti_understeer' | 'anti_oversteer';
export type RaceFlag = 'GREEN' | 'YELLOW' | 'VSC' | 'BLUE';
export type ShifterMode = 'paddles' | 'sequential' | 'h_pattern';
export type PaintFinishType = 'default' | 'metallic' | 'matte' | 'pearl' | 'chrome';
export type LiveryStyleType = 'stock' | 'stripes' | 'carbon_hood' | 'apex_pro';
export type VehicleModelId =
  | 'f1_gp'
  | 'audi_r8'
  | 'porsche_911_gt3'
  | 'ferrari_488'
  | 'lambo_huracan'
  | 'nissan_gtr'
  | 'bmw_m4'
  | 'mclaren_720s'
  | 'amg_gt'
  | 'corvette_c8'
  | 'mustang_gt500'
  | 'bugatti_chiron'
  | 'koenigsegg_jesko';

export type EngineToneType =
  | 'ferrari'
  | 'honda'
  | 'mercedes'
  | 'monster'
  | 'custom'
  | 'v10_screamer'
  | 'v8_biturbo'
  | 'flat6_boxer'
  | 'v8_supercharged'
  | 'w16_quadturbo'
  | 'i6_turbo';

export interface SetupPresetSpec {
  id: SetupPresetId;
  label: string;
  desc: string;
  wingMult: number;      // Scales ClA and CdA
  aeroBalOffset: number; // Shifts front aero balance
  brakeBias: number;     // Front brake distribution (0.54..0.62)
  suspStiffness: number; // Ride height & responsiveness multiplier
}

export interface TeamPhysicsSpec {
  mass: number;
  drivetrain?: 'RWD' | 'AWD';
  maxRpm?: number;
  gearSpeedMult?: number;
  icePowerKW: number;
  ersPowerKW: number;
  cdA: number;
  drsDragCut: number;
  clA: number;
  mechGrip: number;
  maxBrakeForce: number;
  aeroBalance: number;
  puTone: EngineToneType;
}

export interface TeamConfig {
  id: string;
  name: string;
  shortName: string;
  code: string;
  aiCode: string;
  number: number;
  aiNumber: number;
  tagline: string;
  vehicleCategory?: 'f1' | 'supercar' | 'hypercar' | 'sport' | 'muscle';
  vehicleModelId?: VehicleModelId;
  drivetrainLabel?: 'RWD' | 'AWD';
  powerHP?: number;
  topSpeedKmh?: number;
  bodyStyle?: 'f1' | 'mid_wedge' | 'gt_coupe' | 'hyper_fin' | 'muscle_fastback';
  wingStyle?: 'swan_gt3' | 'active_hyper' | 'ducktail' | 'low_drag';
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  tireBandColor: string;
  rimColor: string;
  rimAccent?: string;
  helmetColor: string;
  clearcoat: number;
  metalness: number;
  roughness: number;
  uiStats: { speed: number; accel: number; grip: number; aero: number };
  physics: TeamPhysicsSpec;
}

export interface TrackConfig {
  id: string;
  name: string;
  shortName: string;
  badge: string;
  description: string;
  environment: string;
  difficulty: string;
  laps: number;
  trackWidth: number;
  runoffWidth: number;
  wallOffset: number;
  theme: 'monza' | 'city' | 'desert' | 'alpine';
  skyTop: string;
  skyHorizon: string;
  fogColor: string;
  fogDensity: number;
  sunColor: string;
  sunIntensity: number;
  sunPos: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ambientIntensity: number;
  asphaltColor: string;
  asphaltRoughness: number;
  asphaltMetalness: number;
  groundColor: string;
  curbColors: [string, string];
  tunnelRange?: [number, number];
  drsZones: [number, number][];
  samples: number;
  points: [number, number, number][];
}

export interface TireCompoundSpec {
  id: TireCompoundId;
  name: string;
  short: string;
  color: string;
  dryGrip: number;
  wetGrip: number;
  wearRate: number;
  optTempMin: number;
  optTempMax: number;
}

export interface TrackSample {
  index: number;
  t: number;
  s: number;
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  asphaltY: number;
  curvature: number;
  smoothCurvature: number;
  camber: number;        // LiDAR corner banking angle (rad)
  bumpOffset: number;    // LiDAR micro-undulation height (m)
  isPuddle: boolean;     // Low-lying water puddle zone in rain
  idealLateral: number;
  aiTargetSpeed: number;
  isTunnel: boolean;
  isDrsZone: boolean;
  isPitZone: boolean;
}

export interface TrackQueryResult {
  index: number;
  s: number;
  t: number;
  surfaceY: number;
  tangentX: number;
  tangentY: number;
  tangentZ: number;
  rightX: number;
  rightZ: number;
  curvature: number;
  camber: number;
  isPuddle: boolean;
  idealLateral: number;
  aiTargetSpeed: number;
  lateral: number;
  onTrack: boolean;
  onCurb: boolean;
  offTrack: boolean;
  wallLimit: number;
  isTunnel: boolean;
  isDrsZone: boolean;
  isPitZone: boolean;
}

export interface TrackData {
  group: THREE.Group;
  config: TrackConfig;
  samples: TrackSample[];
  N: number;
  totalLength: number;
  startIndex: number;
  startS: number;
  dirLight: THREE.DirectionalLight;
  heroShadowLight?: THREE.DirectionalLight;
  gantryLights: THREE.MeshStandardMaterial[];
  racingLineMesh: THREE.Mesh;
  pitCrewGroup: THREE.Group;
  helicopterGroup: THREE.Group;
  safetyCarGroup: THREE.Group;
  skyUniforms: {
    uSunDir: { value: THREE.Vector3 };
    uSkyTop: { value: THREE.Color };
    uSkyHorizon: { value: THREE.Color };
    uSunColor: { value: THREE.Color };
    uNightFactor: { value: number };
  };
  envMap: THREE.Texture;
  trackWetness: number;
  dryingLineGrip: number;
  rubberEvolution: number;
  trackTempC: number;
  windSpeedMS: number;
  windDirRad: number;
  queryTrack: (worldPos: THREE.Vector3, hintIndex?: number, out?: TrackQueryResult | null) => TrackQueryResult;
  addSkidmark: (x: number, y: number, z: number, yaw: number, intensity: number) => void;
}

export interface GameSettings {
  // Core Session
  quality: QualityPreset;
  weather: WeatherType;
  difficulty: DifficultyId;
  mode: GameMode;
  compound: TireCompoundId;
  reverseTrack: boolean;
  laps: number;
  gridSize: number;

  // 1. Graphics & Photorealism Post-Processing
  resolutionScale: number;        // 50..175 (%)
  shadowQuality: 'off' | '1024' | '2048' | '4096';
  envReflectionIntensity: number; // 40..220 (%)
  bloomIntensity: number;         // 0..250 (%)
  exposure: number;               // 60..160 (%)
  smaaEnabled: boolean;
  vignetteIntensity: number;      // 0..100 (%)
  particleDensity: 'low' | 'high' | 'extreme';
  adaptiveFpsGovernor: boolean;

  // 2. Camera & Cockpit
  fovOffset: number;              // -15..20 (deg)
  speedFovIntensity: number;      // 0..150 (%)
  seatHeightCm: number;           // -12..12 (cm)
  seatForeAftCm: number;          // -15..15 (cm)
  cameraPitchDeg: number;         // -8..8 (deg)
  cameraShakeIntensity: number;   // 0..150 (%)
  horizonRollIntensity: number;   // 0..100 (%)
  hideHalo: boolean;
  showProximityRadar: boolean;

  // 3. Car Engineering & Setup (10 Real F1 Parameters)
  setupPreset: SetupPresetId;
  customWingLoad: number;         // 1..50 (Front Wing)
  customRearWingLoad: number;     // 1..50 (Rear Wing)
  customBrakeBias: number;        // 50..66 (% front)
  customBrakePressure: number;    // 70..110 (%)
  customDiffOnThrottle: number;   // 50..100 (%)
  customDiffOffThrottle: number;  // 50..100 (%)
  customSuspStiff: number;        // 1..20
  customRideHeightMm: number;     // 18..42 (mm)
  customTirePressurePsi: number;  // 20..26 (PSI)

  // 4. Controls, FFB, Sim-Racing Wheel/Pedals/Shifter & Driving Assists
  steerSensitivity: number;       // 40..180 (%)
  steerLinearity: number;         // 100..250 (1.0..2.5 gamma)
  steerDeadzone: number;          // 0..25 (%)
  ffbRumbleIntensity: number;     // 0..150 (%)
  abs: boolean;
  tractionControl: 'off' | 'med' | 'full';
  manualGearbox: boolean;
  racingLine: boolean;
  brakeAssist: 'off' | 'low' | 'high';
  shifterMode?: ShifterMode;
  wheelRotationDeg?: number;      // 180..1080
  pedalDeadzone?: number;         // 0..20 (%)
  throttleLinearity?: number;     // 50..200 (%)
  brakeLinearity?: number;        // 50..250 (%)
  invertSteerAxis?: boolean;
  invertThrottleAxis?: boolean;
  invertBrakeAxis?: boolean;
  invertClutchAxis?: boolean;
  steerAxisIndex?: number;
  throttleAxisIndex?: number;
  brakeAxisIndex?: number;
  clutchAxisIndex?: number;
  showRearviewMirror?: boolean;

  // 5. Audio, AI, FIA Rules & Aesthetic/Tuning Customization
  masterVolume: number;           // 0..100 (%)
  engineVolume: number;           // 0..150 (%)
  sfxVolume: number;              // 0..150 (%)
  aiLevelNumber: number;          // 1..110 (Granular F1 AI scale)
  aiAggressionMult: number;       // 30..150 (%)
  damageMult: number;             // 0..200 (%)
  tireWearMult: number;           // 0..300 (%)
  fuelBurnMult: number;           // 0..200 (%)
  trackLimitsStrictness: 'off' | 'standard' | 'strict';
  timeOfDaySpeed: number;         // 0..15 (x)
  timeOfDay?: TimeOfDayType;      // 'day' | 'sunset' | 'night'
  damageEnabled?: boolean;
  gearRatioPreset?: 'short' | 'balanced' | 'long';
  customPaintColor?: string;
  customPaintFinish?: PaintFinishType;
  customLiveryStyle?: LiveryStyleType;
  customRimColor?: string;
}

export interface TelemetryTracePoint {
  frac: number;     // 0..1 lap distance fraction
  kmh: number;
  throttle: number; // 0..100
  brake: number;    // 0..100
  gear: number;
  gLat: number;
}

export interface CarState {
  id: string;
  team: TeamConfig;
  number: number;
  code: string;
  isPlayer: boolean;
  isRemotePlayer?: boolean;
  remotePeerId?: string;
  driverName?: string;
  gridSlot: number;

  // Transform & Velocity
  pos: THREE.Vector3;
  prevPos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  prevYaw: number;
  roadPitch: number;
  roadRoll: number;
  speed: number;
  lateralSpeed: number;
  longAccel: number;
  latAccel: number;
  yawRate: number;
  gLong: number;
  gLat: number;

  // Ground Effect & Suspension Ride Heights (mm)
  rideHeightF: number;
  rideHeightR: number;
  porpoisingPhase: number;

  // Controls
  throttleInput: number;
  brakeInput: number;
  clutchInput?: number;
  steerInput: number;
  drsInput: boolean;
  ersInput: boolean;
  ersMode: ERSMode;
  shiftUpReq: boolean;
  shiftDownReq: boolean;
  directGearReq?: number | null; // For H-Pattern Shifter (1..7 or -1 for Reverse, 0 for Neutral)

  // Powertrain, Fuel, Aero & Hybrid ERS
  gear: number;
  rpm: number;
  shiftCutTimer: number;
  fuelKg: number;
  ersEnergy: number;
  ersActive: boolean;
  ersHarvesting: boolean;
  drsAvailable: boolean;
  drsActive: boolean;
  slipstream: number;
  dirtyAir: number;
  shiftFlameTimer: number;
  justShifted: boolean;
  justDownshifted: boolean;

  // Multi-Layer Tires, Marbles, Brakes & Granular Damage
  compound: TireCompoundId;
  tireWear: number;         // 0..100
  tireSurfaceTemp: number;  // Fast outer tread temperature (C)
  tireCoreTemp: number;     // Bulk carcass temperature (C)
  tireTemp: number;         // Effective display temp (C)
  graining: number;         // 0..1 cold-sliding surface abrasion
  blistering: number;       // 0..1 overheated core blistering
  marblePickup: number;     // 0..1 off-line rubber debris pickup
  aquaplaning: number;      // 0..1 standing water hydroplaning
  brakeTemp: number;        // Carbon-ceramic disc temp (C)
  wingDamage: number;       // 0..1 front wing aero loss
  diffuserDamage: number;   // 0..1 rear floor aero loss
  puncture: boolean;
  inPit: boolean;
  pitTimer: number;
  pitStopsCount: number;
  usedCompounds: Set<TireCompoundId>;

  // FIA Rules & Penalties
  trackLimitWarnings: number;
  timePenaltySec: number;
  offTrackTimer: number;

  // Surface & Tire Telemetry
  splineIndex: number;
  onTrack: boolean;
  onCurb: boolean;
  offTrack: boolean;
  inTunnel: boolean;
  wrongWay: boolean;
  slipRatio: number;
  frontLockup: number;
  wallImpact: number;
  carImpact: number;
  _tInfo: TrackQueryResult;

  // Race Progress, Sectors & Timing
  lap: number;
  maxLaps: number;
  lapStartTime: number;
  currentLapTime: number;
  bestLapTime: number;
  lastLapTime: number;
  currentSector: number;
  sectorStartTime: number;
  sectorTimes: [number, number, number];
  bestSectors: [number, number, number];
  lastSectorStatus: ('none' | 'yellow' | 'green' | 'purple')[];
  finished: boolean;
  finishTime: number;
  raceDistance: number;
  prevS: number;
  passedHalfway: boolean;

  // Arcade & Special Game Mode State (Knockout, Team Race, Cops & Robbers, Infection)
  eliminated?: boolean;
  teamSquad?: 'RED' | 'BLUE';
  copsRole?: 'COP' | 'ROBBER';
  robberHealth?: number;     // 0..100 (%)
  robberArrested?: boolean;
  sirenActive?: boolean;
  infected?: boolean;
  survivalTimeSec?: number;

  // AI Driver Memory & Personality
  aiLaneOffset: number;
  aiTargetLane: number;
  aiSkill: number;
  aiAggression: number;
  aiTireCare: number;
  aiMistakeTimer: number;
  aiReactionDelay: number;
  aiStuckTimer: number;
}

export interface ReplaySample {
  time: number;
  cars: Array<{
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    speed: number;
    steer: number;
    drs: boolean;
    brake: number;
  }>;
}

export interface GhostPoint {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface DriverProfileStats {
  racesCompleted: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  safetyRating: number; // 0..100 (S/A/B/C/D license)
  skillRating: number;  // ELO-like 1000..2500
}
