/**
 * APEX GP 3D — 240Hz Multi-Layer Formula 1 Simulator Physics Engine
 * Implements:
 * - 240Hz Tick-Rate with zero per-frame GC allocations
 * - Multi-Layer Tire Model (Surface Temp vs Core Carcass Temp) + Graining & Blistering
 * - Ground Effect (Venturi Floor Ride-Height sensitivity & high-speed Porpoising)
 * - Dirty Air (Wake Turbulence downforce loss & thermal penalty) + Slipstream drag cut
 * - 4-Mode ERS Management (NONE / MEDIUM / OVERTAKE / HOTLAP) + MGU-K & MGU-H recovery
 * - Carbon-Ceramic Brake Temperature Efficiency Window (400°C - 850°C)
 * - Dynamic Fuel Load (kg) & Weight Reduction lap by lap
 * - Off-Line Tire Marbles pickup, Aquaplaning in standing water puddles, Drying Line, Crosswind
 * - Granular Front Wing & Rear Diffuser damage + Puncture risk + FIA Track Limits Penalties
 */
import * as THREE from 'three';
import type {
  CarState,
  ERSMode,
  GameSettings,
  TeamConfig,
  TireCompoundId,
  TrackData,
  TrackQueryResult
} from '../core/types';
import {
  DIFFICULTY_PRESETS,
  ERS_MODE_SPECS,
  GAME_CONSTANTS,
  SETUP_PRESETS,
  TIRE_COMPOUNDS
} from '../core/config';

const GEAR_MAX_SPEEDS = [0, 26, 39, 51, 63, 74, 84, 94, 114];
const WHEELBASE_F = 1.66;
const WHEELBASE_R = 1.76;
const WHEELBASE = WHEELBASE_F + WHEELBASE_R;
const CG_HEIGHT = 0.29;
const YAW_INERTIA = 1140;

export interface SessionBestSectors {
  sectors: [number, number, number];
}

export function createCarState(params: {
  id: string;
  team: TeamConfig;
  number: number;
  code: string;
  isPlayer: boolean;
  gridSlot: number;
  track: TrackData;
  compound: TireCompoundId;
  settings: GameSettings;
  isQualifying?: boolean;
}): CarState {
  const { id, team, number, code, isPlayer, gridSlot, track, compound, settings, isQualifying = false } = params;
  const N = track.N;
  const startIdx = (track.startIndex - 3 - gridSlot * 3 + N) % N;
  const sample = track.samples[startIdx];
  const side = gridSlot % 2 === 0 ? -1 : 1;
  const lat = side * (track.config.trackWidth * 0.21);

  const pos = new THREE.Vector3(
    sample.pos.x + sample.right.x * lat,
    sample.asphaltY,
    sample.pos.z + sample.right.z * lat
  );
  const yaw = Math.atan2(sample.tangent.x, sample.tangent.z);
  const diff = DIFFICULTY_PRESETS[settings.difficulty];
  const initTemp = track.trackWetness > 0.4 ? 68 : 90;
  const initFuel = settings.mode === 'time_attack' || isQualifying ? 4.5 : settings.laps * 2.2 + 2.5;

  return {
    id,
    team,
    number,
    code,
    isPlayer,
    gridSlot,

    pos,
    prevPos: pos.clone(),
    vel: new THREE.Vector3(),
    yaw,
    prevYaw: yaw,
    roadPitch: 0,
    roadRoll: sample.camber,
    speed: 0,
    lateralSpeed: 0,
    longAccel: 0,
    latAccel: 0,
    yawRate: 0,
    gLong: 0,
    gLat: 0,

    rideHeightF: 28,
    rideHeightR: 34,
    porpoisingPhase: 0,

    throttleInput: 0,
    brakeInput: 0,
    steerInput: 0,
    drsInput: false,
    ersInput: false,
    ersMode: isQualifying || settings.mode === 'time_attack' ? 'hotlap' : 'medium',
    shiftUpReq: false,
    shiftDownReq: false,

    gear: 1,
    rpm: 4800,
    shiftCutTimer: 0,
    fuelKg: initFuel,
    ersEnergy: GAME_CONSTANTS.ERS_MAX,
    ersActive: false,
    ersHarvesting: false,
    drsAvailable: false,
    drsActive: false,
    slipstream: 0,
    dirtyAir: 0,
    shiftFlameTimer: 0,
    justShifted: false,
    justDownshifted: false,

    compound,
    tireWear: 100,
    tireSurfaceTemp: initTemp,
    tireCoreTemp: initTemp,
    tireTemp: initTemp,
    graining: 0,
    blistering: 0,
    marblePickup: 0,
    aquaplaning: 0,
    brakeTemp: 380,
    wingDamage: 0,
    diffuserDamage: 0,
    puncture: false,
    inPit: false,
    pitTimer: 0,
    pitStopsCount: 0,
    usedCompounds: new Set<TireCompoundId>([compound]),

    trackLimitWarnings: 0,
    timePenaltySec: 0,
    offTrackTimer: 0,

    splineIndex: startIdx,
    onTrack: true,
    onCurb: false,
    offTrack: false,
    inTunnel: false,
    wrongWay: false,
    slipRatio: 0,
    frontLockup: 0,
    wallImpact: 0,
    carImpact: 0,

    _tInfo: {
      index: startIdx,
      s: sample.s,
      t: sample.t,
      surfaceY: sample.asphaltY,
      tangentX: sample.tangent.x,
      tangentY: sample.tangent.y,
      tangentZ: sample.tangent.z,
      rightX: sample.right.x,
      rightZ: sample.right.z,
      curvature: sample.smoothCurvature,
      camber: sample.camber,
      isPuddle: sample.isPuddle,
      idealLateral: sample.idealLateral,
      aiTargetSpeed: sample.aiTargetSpeed,
      lateral: lat,
      onTrack: true,
      onCurb: false,
      offTrack: false,
      wallLimit: track.config.wallOffset - 1.35,
      isTunnel: false,
      isDrsZone: sample.isDrsZone,
      isPitZone: sample.isPitZone
    },

    lap: 1,
    maxLaps: isQualifying ? 1 : settings.mode === 'time_attack' ? 99 : settings.laps,
    lapStartTime: 0,
    currentLapTime: 0,
    bestLapTime: Infinity,
    lastLapTime: 0,
    currentSector: 0,
    sectorStartTime: 0,
    sectorTimes: [0, 0, 0],
    bestSectors: [Infinity, Infinity, Infinity],
    lastSectorStatus: ['none', 'none', 'none'],
    finished: false,
    finishTime: 0,
    raceDistance: -((gridSlot + 1) * 11),
    prevS: sample.s,
    passedHalfway: false,

    aiLaneOffset: lat,
    aiTargetLane: lat,
    aiSkill: (diff.skillMin + Math.random() * (diff.skillMax - diff.skillMin)) * (0.86 + ((settings.aiLevelNumber ?? 84) / 110) * 0.20),
    aiAggression: THREE.MathUtils.clamp((0.35 + Math.random() * 0.60) * ((settings.aiAggressionMult ?? 100) / 100), 0.15, 1.35),
    aiTireCare: 0.85 + Math.random() * 0.25,
    aiMistakeTimer: 0,
    aiReactionDelay: 0.06 + Math.random() * 0.20,
    aiStuckTimer: 0
  };
}

function pacejkaLateral(slipAngle: number, mu: number, fz: number): number {
  const B = 8.9;
  const C = 1.40;
  return -mu * fz * Math.sin(C * Math.atan(B * slipAngle));
}

export function cycleERSMode(car: CarState): ERSMode {
  const order: ERSMode[] = ['none', 'medium', 'overtake', 'hotlap'];
  const next = order[(order.indexOf(car.ersMode) + 1) % order.length];
  car.ersMode = next;
  return next;
}

export function triggerPitStop(car: CarState, newCompound?: TireCompoundId): boolean {
  if (car.inPit || !car._tInfo.isPitZone || Math.abs(car.speed) > 52) return false;
  car.inPit = true;
  car.pitTimer = 2.4;
  if (newCompound) {
    car.compound = newCompound;
    car.usedCompounds.add(newCompound);
  }
  return true;
}

export function stepCarPhysics(
  car: CarState,
  track: TrackData,
  allCars: CarState[],
  raceActive: boolean,
  raceClock: number,
  settings: GameSettings,
  sessionBest: SessionBestSectors,
  vscActive: boolean,
  dt: number
): TrackQueryResult {
  car.prevPos.copy(car.pos);
  car.prevYaw = car.yaw;
  car.justShifted = false;
  car.justDownshifted = false;
  car.wallImpact = 0;
  car.carImpact = 0;
  if (car.shiftFlameTimer > 0) car.shiftFlameTimer = Math.max(0, car.shiftFlameTimer - dt);
  if (car.shiftCutTimer > 0) car.shiftCutTimer = Math.max(0, car.shiftCutTimer - dt);

  const p = car.team.physics;
  const baseSetup = SETUP_PRESETS[car.isPlayer ? settings.setupPreset : 'balanced'];
  // Apply custom millimeter setup sliders for player car (Front/Rear Wing, Brake Bias/Pressure, Diff, Susp, Ride Height, Tire PSI)
  const avgWingLoad = (settings.customWingLoad + (settings.customRearWingLoad ?? settings.customWingLoad)) * 0.5;
  const effWingMult = car.isPlayer
    ? baseSetup.wingMult * (0.84 + (avgWingLoad / 50) * 0.32)
    : baseSetup.wingMult;
  const customAeroShift = car.isPlayer
    ? ((settings.customWingLoad - (settings.customRearWingLoad ?? settings.customWingLoad)) / 50) * 0.035
    : 0;
  const effBrakeBias = car.isPlayer
    ? THREE.MathUtils.clamp(settings.customBrakeBias / 100, 0.50, 0.66)
    : baseSetup.brakeBias;
  const effBrakePress = car.isPlayer
    ? THREE.MathUtils.clamp((settings.customBrakePressure ?? 100) / 100, 0.70, 1.15)
    : 1.0;
  const effSuspStiff = car.isPlayer
    ? baseSetup.suspStiffness * (0.78 + (settings.customSuspStiff / 20) * 0.44)
    : baseSetup.suspStiffness;
  const baseRideMm = car.isPlayer ? (settings.customRideHeightMm ?? 28) : 28;
  const psiOffset = car.isPlayer ? ((settings.customTirePressurePsi ?? 22.5) - 22.5) : 0;
  // Dynamic mass includes remaining fuel load (Item 11)!
  const mass = p.mass + car.fuelKg;

  const tInfo = track.queryTrack(car.pos, car.splineIndex, car._tInfo);
  car.splineIndex = tInfo.index;
  car.inTunnel = tInfo.isTunnel;
  car.roadRoll += (tInfo.camber - car.roadRoll) * Math.min(1, dt * 15);

  if (!raceActive) {
    car.vel.set(0, 0, 0);
    car.pos.y = tInfo.surfaceY;
    car.speed = 0;
    car.lateralSpeed = 0;
    car.yawRate = 0;
    car.gear = 1;
    car.drsActive = false;
    car.drsAvailable = false;
    car.ersActive = false;
    car.ersHarvesting = false;
    const targetRpm = 4800 + car.throttleInput * 9600;
    car.rpm += (targetRpm - car.rpm) * Math.min(1, dt * 12);
    return tInfo;
  }

  // Pit-stop stationary service
  if (car.inPit) {
    car.pitTimer -= dt;
    car.vel.multiplyScalar(Math.exp(-9 * dt));
    car.speed = car.vel.length();
    car.pos.y = tInfo.surfaceY;
    car.rpm += (5200 - car.rpm) * Math.min(1, dt * 10);
    if (car.pitTimer <= 0) {
      car.inPit = false;
      car.pitStopsCount++;
      car.tireWear = 100;
      const freshTemp = track.trackWetness > 0.4 ? 72 : 92;
      car.tireSurfaceTemp = freshTemp;
      car.tireCoreTemp = freshTemp;
      car.tireTemp = freshTemp;
      car.graining = 0;
      car.blistering = 0;
      car.marblePickup = 0;
      car.wingDamage = 0;
      car.diffuserDamage = 0;
      car.puncture = false;
    }
    return tInfo;
  }

  const sinY = Math.sin(car.yaw);
  const cosY = Math.cos(car.yaw);
  const fwdX = sinY;
  const fwdZ = cosY;
  const rightX = -cosY;
  const rightZ = sinY;

  let vFwd = car.vel.x * fwdX + car.vel.z * fwdZ;
  let vLat = car.vel.x * rightX + car.vel.z * rightZ;
  const absV = Math.abs(vFwd);

  car.onTrack = tInfo.onTrack;
  car.onCurb = tInfo.onCurb;
  car.offTrack = tInfo.offTrack;

  // FIA Track Limits Warning & Penalty System (respects trackLimitsStrictness setting!)
  if (car.offTrack && vFwd > 25 && settings.trackLimitsStrictness !== 'off') {
    const strictThreshold = settings.trackLimitsStrictness === 'strict' ? 0.78 : 1.35;
    car.offTrackTimer += dt;
    if (car.offTrackTimer > strictThreshold) {
      car.offTrackTimer = -2.0;
      car.trackLimitWarnings++;
      if (car.trackLimitWarnings % 3 === 0 && settings.mode !== 'time_attack') {
        car.timePenaltySec += 3;
      }
    }
  } else {
    car.offTrackTimer = Math.max(0, car.offTrackTimer - dt);
  }

  // 1. SLIPSTREAM & DIRTY AIR WAKE TURBULENCE (Items 4 & 5)
  let slipTarget = 0;
  let dirtyTarget = 0;
  if (vFwd > 26) {
    for (let i = 0; i < allCars.length; i++) {
      const other = allCars[i];
      if (other === car || other.inPit) continue;
      const dx = other.pos.x - car.pos.x;
      const dz = other.pos.z - car.pos.z;
      const along = dx * fwdX + dz * fwdZ;
      if (along > GAME_CONSTANTS.SLIPSTREAM_MIN_DIST && along < GAME_CONSTANTS.SLIPSTREAM_MAX_DIST) {
        const latDiff = Math.abs(dx * rightX + dz * rightZ);
        if (latDiff < GAME_CONSTANTS.SLIPSTREAM_LAT_WINDOW) {
          const prox = 1 - (along - GAME_CONSTANTS.SLIPSTREAM_MIN_DIST) /
            (GAME_CONSTANTS.SLIPSTREAM_MAX_DIST - GAME_CONSTANTS.SLIPSTREAM_MIN_DIST);
          if (prox > slipTarget) slipTarget = prox;
          if (along < 26 && prox > dirtyTarget) dirtyTarget = prox;
        }
      }
    }
  }
  car.slipstream += (slipTarget - car.slipstream) * Math.min(1, dt * 5.0);
  car.dirtyAir += (dirtyTarget - car.dirtyAir) * Math.min(1, dt * 6.0);

  // 2. DRS & ACTIVE AERO 2026 (Item 7)
  const isStraightEnough = tInfo.isDrsZone || Math.abs(tInfo.curvature) < 0.058;
  car.drsAvailable = isStraightEnough
    && vFwd > GAME_CONSTANTS.DRS_MIN_SPEED
    && car.brakeInput < 0.05
    && Math.abs(car.steerInput) < GAME_CONSTANTS.DRS_MAX_STEER
    && !car.offTrack
    && track.trackWetness < 0.35
    && !vscActive;
  car.drsActive = car.drsAvailable && car.drsInput && car.throttleInput > 0.2;

  // 3. 4-MODE HYBRID ERS MANAGEMENT + MANUAL OVERTAKE OVERRIDE (Item 6)
  car.ersHarvesting = car.brakeInput > 0.15 && vFwd > 14;
  const modeSpec = ERS_MODE_SPECS[car.ersMode];
  const wantsDeploy = (car.ersInput || (modeSpec.powerMult > 0 && car.throttleInput > 0.68))
    && vFwd > 12 && car.ersEnergy > 1 && !car.offTrack && !vscActive;
  const effPowerMult = car.ersInput ? Math.max(1.0, modeSpec.powerMult) : modeSpec.powerMult;
  const effDrainMult = car.ersInput ? Math.max(1.0, modeSpec.drainMult) : modeSpec.drainMult;

  if (wantsDeploy) {
    car.ersActive = true;
    car.ersEnergy = Math.max(0, car.ersEnergy - GAME_CONSTANTS.ERS_DEPLOY_RATE * effDrainMult * dt);
  } else {
    car.ersActive = false;
  }
  const brakeHarvest = car.ersHarvesting ? car.brakeInput * GAME_CONSTANTS.ERS_HARVEST_BRAKE * modeSpec.harvestMult : 0;
  const mguhHarvest = car.throttleInput > 0.55 && vFwd > 42 ? GAME_CONSTANTS.ERS_HARVEST_MGUH * modeSpec.harvestMult : 0.6;
  car.ersEnergy = Math.min(GAME_CONSTANTS.ERS_MAX, car.ersEnergy + (brakeHarvest + mguhHarvest) * dt);

  // Burn fuel proportionally to throttle & fuelBurnMult setting (Item 11)
  if (car.throttleInput > 0.05 && settings.mode !== 'time_attack') {
    const fuelMult = (settings.fuelBurnMult ?? 100) / 100;
    car.fuelKg = Math.max(0.2, car.fuelKg - car.throttleInput * 0.024 * fuelMult * dt);
  }

  // 4. GROUND EFFECT RIDE HEIGHT, PORPOISING, WIND & GRANULAR AERO (Items 3, 4, 13, 23)
  const speedRatio = THREE.MathUtils.clamp(vFwd / 92, 0, 1.15);
  const compMm = speedRatio * speedRatio * 15 / effSuspStiff;
  const pitchMm = THREE.MathUtils.clamp(car.longAccel * 0.16, -6, 6);
  car.rideHeightF = Math.max(11, baseRideMm - compMm - pitchMm);
  car.rideHeightR = Math.max(13, (baseRideMm + 6) - compMm * 1.1 + pitchMm);

  // Porpoising oscillation when Venturi floor stalls near ground at >270 km/h (Item 3)
  let groundEffectMult = 1.0 + Math.sin(THREE.MathUtils.clamp((35 - car.rideHeightR) / 22, 0, 1) * Math.PI * 0.5) * 0.10;
  if (vFwd > 75 && !car.drsActive && car.rideHeightR < 17.5) {
    car.porpoisingPhase += dt * 36;
    groundEffectMult -= Math.abs(Math.sin(car.porpoisingPhase)) * 0.09;
  }

  // Directional Wind relative airspeed (Item 23)
  const windAlong = track.windSpeedMS * Math.cos(car.yaw - track.windDirRad);
  const airSpeed = vFwd + windAlong * 0.35;
  const qDyn = 0.5 * GAME_CONSTANTS.AIR_DENSITY * airSpeed * airSpeed;

  const effCdA = p.cdA * effWingMult
    * (car.drsActive ? 1 - p.drsDragCut : 1.0)
    * (1 - car.slipstream * 0.21)
    * (1 + car.wingDamage * 0.08 + car.diffuserDamage * 0.06);
  const fAeroDrag = qDyn * effCdA * Math.sign(vFwd);

  // Dirty air cuts downforce up to 16% in corners!
  const dirtyAirLoss = 1 - car.dirtyAir * 0.16;
  const rearDrsTrim = car.drsActive ? 0.86 : 1.0;
  const wingHealth = 1 - car.wingDamage * 0.30;
  const floorHealth = (1 - car.diffuserDamage * 0.26) * groundEffectMult;
  const totalDownforce = qDyn * p.clA * effWingMult * dirtyAirLoss;
  const aeroBal = THREE.MathUtils.clamp(p.aeroBalance + baseSetup.aeroBalOffset + customAeroShift, 0.36, 0.56);
  const fDownFront = totalDownforce * aeroBal * wingHealth;
  const fDownRear = totalDownforce * (1 - aeroBal) * rearDrsTrim * floorHealth;

  // 5. VERTICAL LOADS + LONGITUDINAL WEIGHT TRANSFER
  const staticWeight = mass * GAME_CONSTANTS.GRAVITY;
  const staticFront = staticWeight * (WHEELBASE_R / WHEELBASE);
  const staticRear = staticWeight * (WHEELBASE_F / WHEELBASE);
  const safeLongAccel = THREE.MathUtils.clamp(car.longAccel, -45, 25);
  const longTransfer = THREE.MathUtils.clamp((mass * safeLongAccel * CG_HEIGHT) / WHEELBASE, -3400, 3400);
  const fzFront = Math.max(1200, staticFront + fDownFront - longTransfer);
  const fzRear = Math.max(1400, staticRear + fDownRear + longTransfer);

  // 6. MULTI-LAYER TIRE MODEL (SURFACE VS CORE TEMP), GRAINING, BLISTERING, MARBLES & AQUAPLANING (Items 1, 2, 17-22)
  const comp = TIRE_COMPOUNDS[car.compound];
  const distFromIdeal = Math.abs(tInfo.lateral - tInfo.idealLateral);
  const onDryGroove = distFromIdeal < 2.3;
  const localWetness = Math.max(0, track.trackWetness * (onDryGroove ? 1 - track.dryingLineGrip * 0.45 : 1.0));
  const baseCompoundGrip = THREE.MathUtils.lerp(comp.dryGrip, comp.wetGrip, localWetness);

  // Off-line Marble Pickup when driving > 4.2m outside ideal racing line (Item 18)
  if (!car.offTrack && distFromIdeal > 4.2 && absV > 20) {
    car.marblePickup = Math.min(1, car.marblePickup + dt * 0.35);
  } else if (absV > 15) {
    car.marblePickup = Math.max(0, car.marblePickup - dt * 0.42);
  }

  // Aquaplaning in standing water puddles when on slicks or worn tires in rain (Item 21)
  if (tInfo.isPuddle && localWetness > 0.45 && absV > 42) {
    const aquaRisk = (car.compound === 'soft' || car.compound === 'medium' || car.compound === 'hard') ? 0.65 : 0.18;
    car.aquaplaning = THREE.MathUtils.clamp(aquaRisk * (absV / 80), 0, 0.75);
  } else {
    car.aquaplaning = Math.max(0, car.aquaplaning - dt * 3.0);
  }

  // Multi-layer Tire Temperatures: Surface heats/cools fast, Core carcass heats/cools slowly (modulated by Tire Pressure PSI!)
  const tireWork = (Math.abs(car.gLat) * 1.35 + car.slipRatio * 3.8 + car.frontLockup * 2.8) * (absV / 72);
  const ambientSurface = track.trackTempC + 28 - localWetness * 18 + car.dirtyAir * 6 + psiOffset * 2.2;
  const targetSurfaceTemp = ambientSurface + tireWork * (32 + psiOffset * 1.5);
  car.tireSurfaceTemp += (targetSurfaceTemp - car.tireSurfaceTemp) * Math.min(1, dt * 1.8);
  car.tireCoreTemp += (car.tireSurfaceTemp - car.tireCoreTemp) * Math.min(1, dt * 0.25);
  car.tireSurfaceTemp = THREE.MathUtils.clamp(car.tireSurfaceTemp, 35, 140);
  car.tireCoreTemp = THREE.MathUtils.clamp(car.tireCoreTemp, 38, 132);
  car.tireTemp = car.tireSurfaceTemp * 0.6 + car.tireCoreTemp * 0.4;

  if (car.tireSurfaceTemp < comp.optTempMin - 6 && car.slipRatio > 0.35) {
    car.graining = Math.min(1, car.graining + dt * 0.04);
  } else if (car.tireSurfaceTemp >= comp.optTempMin) {
    car.graining = Math.max(0, car.graining - dt * 0.02);
  }
  if (car.tireCoreTemp > comp.optTempMax + 8) {
    car.blistering = Math.min(1, car.blistering + dt * 0.035);
  }

  let thermalMult = 1.0;
  if (car.tireTemp < comp.optTempMin) {
    thermalMult = Math.max(0.84, 1 - (comp.optTempMin - car.tireTemp) * 0.0042);
  } else if (car.tireTemp > comp.optTempMax) {
    thermalMult = Math.max(0.82, 1 - (car.tireTemp - comp.optTempMax) * 0.0065);
  }

  const wearMult = car.tireWear > 25
    ? 0.88 + 0.12 * ((car.tireWear - 25) / 75)
    : 0.70 + 0.18 * (car.tireWear / 25);
  const damageGripPenalty = (1 - car.graining * 0.06 - car.blistering * 0.08 - car.marblePickup * 0.09 - car.aquaplaning * 0.35)
    * (car.puncture ? 0.55 : 1.0);
  const realRoadBonus = 1 + track.rubberEvolution * 0.025;
  // Progressive off-track depth transition prevents instant snap-spin when clipping grass for 0.5s
  const halfTrackW = track.config.trackWidth * 0.5;
  const offTrackDepth = car.offTrack ? Math.max(0, Math.abs(tInfo.lateral) - (halfTrackW + 1.15)) : 0;
  const offTrackSeverity = car.offTrack ? THREE.MathUtils.clamp(0.22 + offTrackDepth / 3.2, 0.22, 1.0) : 0;
  const surfaceMuMult = car.offTrack ? (0.88 - 0.22 * offTrackSeverity) : car.onCurb ? 0.93 : 1.0;
  const mu = p.mechGrip * baseCompoundGrip * thermalMult * wearMult * damageGripPenalty * realRoadBonus * surfaceMuMult;

  if (absV > 10 && settings.mode !== 'time_attack') {
    const userWearScale = (settings.tireWearMult ?? 100) / 100;
    const careMult = car.isPlayer ? userWearScale : userWearScale / car.aiTireCare;
    const wearPerSec = (comp.wearRate / 65) * (0.45 + tireWork * 0.85) * (car.offTrack ? 1.8 : 1.0) * careMult;
    car.tireWear = Math.max(3, car.tireWear - wearPerSec * dt);
    if (car.tireWear < 9 && !car.puncture && Math.random() < 0.0004) {
      car.puncture = true;
    }
  }

  // Carbon-Ceramic Brake Temperature & Efficiency Window (400°C..850°C) (Item 9)
  let effBrakeInput = car.brakeInput;
  // Optional Braking Assist for player approaching sharp corners
  if (car.isPlayer && settings.brakeAssist && settings.brakeAssist !== 'off' && vFwd > tInfo.aiTargetSpeed + 4) {
    const assistGain = settings.brakeAssist === 'high' ? 0.75 : 0.38;
    const autoBrake = THREE.MathUtils.clamp(((vFwd - tInfo.aiTargetSpeed) / 18) * assistGain, 0, assistGain);
    effBrakeInput = Math.max(effBrakeInput, autoBrake);
  }

  const brakeHeatTarget = 260 + car.dirtyAir * 45 + effBrakeInput * Math.min(1, absV / 40) * 760;
  const brakeRate = brakeHeatTarget > car.brakeTemp ? 3.2 : 0.75 * (1 - car.dirtyAir * 0.15);
  car.brakeTemp += (brakeHeatTarget - car.brakeTemp) * Math.min(1, dt * brakeRate);
  const brakeEff = (car.brakeTemp < 310 ? 0.90 : car.brakeTemp > 920 ? 0.88 : 1.0) * effBrakePress;

  // 7. POWERTRAIN, CLUTCH BITE-POINT LAUNCH CONTROL, SEAMLESS SHIFT CUT, VSC LIMITER, GEAR REV-LIMITER & CARBON BRAKES
  let fxEngine = 0;
  let rearSpinExcess = 0;
  const vscMaxSpeed = vscActive ? 54 : 115;
  const activeGear = Math.max(1, Math.min(8, car.gear));
  const gearMaxSpeed = car.gear === -1 ? 18 : GEAR_MAX_SPEEDS[activeGear];

  if (car.throttleInput > 0.01 && vFwd >= -0.5 && car.shiftCutTimer <= 0 && vFwd < vscMaxSpeed) {
    const ersKW = car.ersActive ? p.ersPowerKW * effPowerMult : 0;
    const totalPowerWatts = (p.icePowerKW + ersKW) * 1000;
    let launchBiteMult = 1.0;
    if (raceClock < 1.6 && vFwd < 26) {
      if (car.rpm >= 9200 && car.rpm <= 12200) {
        launchBiteMult = 1.14;
      } else if (car.throttleInput > 0.92 && car.rpm > 12800 && settings.tractionControl === 'off') {
        launchBiteMult = 0.86;
        rearSpinExcess = 0.65;
      }
    }
    const offTrackTorqueMult = car.offTrack ? (0.82 - 0.18 * offTrackSeverity) : 1.0;
    // Physical 15,000 RPM Gear Ratio Rev-Limiter: in 1st gear (~95 km/h), torque cuts off at the redline!
    const revLimiterMult = car.gear > 0
      ? THREE.MathUtils.clamp((gearMaxSpeed * 1.02 - vFwd) / (gearMaxSpeed * 0.06), 0, 1)
      : 1.0;
    const gearTorqueCap = (car.gear <= 1 ? 13200 : car.gear === 2 ? 13900 : 14300) * launchBiteMult * offTrackTorqueMult;
    const rawDriveForce = Math.min(gearTorqueCap, totalPowerWatts / Math.max(14.0, vFwd));
    fxEngine = car.throttleInput * rawDriveForce * revLimiterMult;
  }

  // Mechanical engine over-rev compression braking if player downshifts into a lower gear above its max speed
  if (car.gear > 0 && vFwd > gearMaxSpeed * 1.03) {
    fxEngine -= Math.min(18500, (vFwd - gearMaxSpeed * 1.03) * 1650);
  }

  let fxBrakeFront = 0;
  let fxBrakeRear = 0;
  let frontLockupAmt = 0;
  if (effBrakeInput > 0.01) {
    if (vFwd > 1.0) {
      const totalBrakeCmd = effBrakeInput * p.maxBrakeForce * brakeEff;
      fxBrakeFront = totalBrakeCmd * effBrakeBias;
      fxBrakeRear = totalBrakeCmd * (1 - effBrakeBias);
    } else {
      fxEngine = -effBrakeInput * 6500;
    }
  }

  // Off-track turf/gravel resistance + lateral slide tire scrub resistance (sliding ALWAYS bleeds speed!)
  const slideSpeedLoss = Math.abs(vLat) > 1.2 ? Math.abs(vLat) * (car.offTrack ? 280 : 145) * Math.sign(vFwd || 1) : 0;
  const offTrackDragLin = 26 + offTrackSeverity * 235;
  const offTrackDragConst = 220 + offTrackSeverity * 1650;
  const rollingRes = vFwd * offTrackDragLin + Math.sign(vFwd) * offTrackDragConst + slideSpeedLoss;
  const fwdDotTangent = fwdX * tInfo.tangentX + fwdZ * tInfo.tangentZ;
  const fSlope = -mass * GAME_CONSTANTS.GRAVITY * tInfo.tangentY * fwdDotTangent;

  // 8. PACEJKA SLIP-ANGLE CORNERING, HIGH-SPEED DOWNFORCE PLANTEDNESS & INSTANT COUNTER-STEER AUTHORITY
  let shapedSteer = car.steerInput;
  if (car.isPlayer) {
    const dz = (settings.steerDeadzone ?? 3) / 100;
    const absS = Math.abs(shapedSteer);
    if (absS < dz) {
      shapedSteer = 0;
    } else {
      const normS = (absS - dz) / Math.max(0.01, 1 - dz);
      const gamma = (settings.steerLinearity ?? 130) / 100;
      const sens = (settings.steerSensitivity ?? 100) / 100;
      shapedSteer = Math.sign(shapedSteer) * THREE.MathUtils.clamp(Math.pow(normS, gamma) * sens, 0, 1.15);
    }
  }
  const maxSteerRad = THREE.MathUtils.lerp(0.30, 0.092, THREE.MathUtils.clamp(absV / 90, 0, 1));
  const steerAngle = shapedSteer * maxSteerRad;

  let fyFront = 0;
  let fyRear = 0;

  if (absV > 1.2 || Math.abs(vLat) > 1.2) {
    const vSafe = Math.max(8.0, Math.hypot(vFwd, vLat));
    const dirSign = vFwd >= -0.5 ? 1 : -1;
    const vLeft = -vLat;

    // Wider 405mm F1 rear Pirelli slicks + high-speed ground-effect diffuser stability
    const rearStabilityMult = 1.18 + 0.10 * speedRatio;
    // Counter-steer authority: when steering opposite to an active slide or direction change, front tires bite immediately!
    const bodySlip = Math.atan2(vLeft, vSafe);
    const isCounterSteering = shapedSteer * vLat > 0 || shapedSteer * car.yawRate < -0.05;
    const effectiveSlipF = isCounterSteering ? bodySlip * 0.22 : bodySlip * 0.62;
    const alphaF = effectiveSlipF + Math.atan2(car.yawRate * WHEELBASE_F, vSafe) - steerAngle * dirSign;
    const alphaR = Math.atan2(vLeft - car.yawRate * WHEELBASE_R, vSafe);

    const maxGripF = mu * fzFront;
    const maxGripR = mu * rearStabilityMult * fzRear;

    const useAbs = !car.isPlayer || settings.abs;
    if (fxBrakeFront > maxGripF * 0.93) {
      if (useAbs) {
        fxBrakeFront = maxGripF * 0.91;
        frontLockupAmt = 0.08;
      } else {
        frontLockupAmt = THREE.MathUtils.clamp((fxBrakeFront - maxGripF * 0.93) / (maxGripF * 0.45), 0, 1);
        fxBrakeFront = maxGripF * 0.93;
      }
    }
    const availLatF = Math.sqrt(Math.max(0.32, 1 - Math.pow(fxBrakeFront / (maxGripF + 1), 2)));
    const fyLeftFront = pacejkaLateral(alphaF, mu * availLatF, fzFront);

    const fxRearCmd = fxEngine - fxBrakeRear;
    const tcLevel = !car.isPlayer ? 'med' : settings.tractionControl;
    const tcLimit = tcLevel === 'full' ? 0.84 : tcLevel === 'med' ? 0.90 : 0.96;
    const rearLongFrac = Math.abs(fxRearCmd) / (maxGripR + 1);
    let effFxRear = fxRearCmd;
    if (rearLongFrac > tcLimit) {
      if (tcLevel !== 'off' && fxRearCmd > 0) {
        effFxRear = maxGripR * tcLimit;
        rearSpinExcess = tcLevel === 'full' ? 0.05 : 0.18;
      } else {
        rearSpinExcess = THREE.MathUtils.clamp((rearLongFrac - tcLimit) * 1.4, 0, 1);
        effFxRear = Math.sign(fxRearCmd) * maxGripR * (car.offTrack ? 0.78 : 0.91);
      }
    }
    // High-speed F1 downforce & wider rear slicks keep rear lateral authority >= 0.80..0.90 under throttle!
    const minLatR = car.offTrack ? 0.72 : (tcLevel === 'full' ? 0.92 : tcLevel === 'med' ? 0.88 : 0.78);
    const availLatR = Math.max(minLatR, Math.sqrt(Math.max(0.5, 1 - Math.pow(effFxRear / (maxGripR * 1.25 + 1), 2))));
    const fyLeftRear = pacejkaLateral(alphaR, mu * rearStabilityMult * availLatR, fzRear);

    if (vFwd >= 0) {
      if (fxEngine > 0) fxEngine = Math.max(0, effFxRear);
      else fxBrakeRear = Math.max(0, -effFxRear);
    }

    const fCamber = mass * GAME_CONSTANTS.GRAVITY * Math.sin(tInfo.camber);
    fyFront = -fyLeftFront + fCamber * 0.5;
    fyRear = -fyLeftRear + fCamber * 0.5;

    // On-Throttle & Off-Throttle Differential Locking + Strong Self-Aligning Aero/Pneumatic Trail Stability
    const diffLock = car.isPlayer
      ? (car.throttleInput > 0.25 ? (settings.customDiffOnThrottle ?? 72) : (settings.customDiffOffThrottle ?? 60)) / 70
      : 1.0;
    const yawTorque = fyLeftFront * WHEELBASE_F - fyLeftRear * WHEELBASE_R;
    const selfAlignTorque = -vLat * (car.offTrack ? 420 : 480 + speedRatio * 220);
    const counterSteerDamp = isCounterSteering ? 1.45 : 1.0;
    const yawDamp = -car.yawRate * (1120 + absV * 50 + (car.offTrack ? 420 : 0)) * diffLock * counterSteerDamp;
    const yawAccel = (yawTorque + selfAlignTorque + yawDamp) / YAW_INERTIA;

    const maxYawRate = car.offTrack ? 1.65 : 2.15;
    car.yawRate = THREE.MathUtils.clamp(car.yawRate + yawAccel * dt, -maxYawRate, maxYawRate);
    const dYaw = car.yawRate * dt;
    car.yaw += dYaw;

    // Exact orthogonal 2D rotation of velocity into the new car heading (strictly conserves kinetic energy!)
    const cosD = Math.cos(dYaw);
    const sinD = Math.sin(dYaw);
    const rotFwd = vFwd * cosD - vLat * sinD;
    const rotLat = vLat * cosD + vFwd * sinD;
    vFwd = rotFwd;
    vLat = rotLat;

    const aLat = (fyFront + fyRear) / mass;
    vLat += aLat * dt;
    // Lateral grip increases with speed (aerodynamic downforce plants the car on rails at high speed!)
    const latScrubDamp = (car.offTrack ? 4.2 + offTrackSeverity * 2.2 : 3.6 + speedRatio * 1.8) + (absV < 14 ? 4.0 : 0);
    vLat *= Math.exp(-latScrubDamp * dt);

    car.latAccel = aLat;
    car.slipRatio = THREE.MathUtils.clamp(Math.max(Math.abs(alphaR) * 2.8, rearSpinExcess, frontLockupAmt), 0, 1);
    car.frontLockup = frontLockupAmt;
  } else {
    vLat *= Math.exp(-14 * dt);
    car.yawRate = steerAngle * vFwd * 0.48;
    car.yaw += car.yawRate * dt;
    car.latAccel = 0;
    car.slipRatio = 0;
    car.frontLockup = 0;
  }

  const fxNet = fxEngine - fxBrakeFront - fxBrakeRear - fAeroDrag - rollingRes + fSlope;
  const aLong = fxNet / mass;
  const prevFwd = vFwd;
  vFwd += aLong * dt;
  if (prevFwd > 0 && vFwd < 0 && effBrakeInput > 0.05 && car.throttleInput < 0.05) vFwd = 0;
  const maxAllowedFwd = car.offTrack ? Math.max(42, 86 - offTrackSeverity * 24) : 108;
  if (car.offTrack && vFwd > maxAllowedFwd) {
    vFwd -= (vFwd - maxAllowedFwd) * Math.min(1, dt * 3.8);
  }
  vFwd = THREE.MathUtils.clamp(vFwd, -18, 108);
  vLat = THREE.MathUtils.clamp(vLat, -18, 18);

  const newSin = Math.sin(car.yaw);
  const newCos = Math.cos(car.yaw);
  car.vel.x = newSin * vFwd + -newCos * vLat;
  car.vel.z = newCos * vFwd + newSin * vLat;

  car.pos.x += car.vel.x * dt;
  car.pos.z += car.vel.z * dt;

  car.speed = vFwd;
  car.lateralSpeed = vLat;
  car.longAccel = THREE.MathUtils.clamp(aLong, -55, 30);
  car.gLong = car.longAccel / GAME_CONSTANTS.GRAVITY;
  car.gLat = THREE.MathUtils.clamp(car.latAccel / GAME_CONSTANTS.GRAVITY, -6.5, 6.5);

  // 9. EXACT ASPHALT LOCK & SMOOTH TECPRO BARRIER COLLISION
  const postInfo = track.queryTrack(car.pos, car.splineIndex, car._tInfo);
  car.splineIndex = postInfo.index;
  car.pos.y = postInfo.surfaceY;

  const postFwdDot = newSin * postInfo.tangentX + newCos * postInfo.tangentZ;
  const targetRoadPitch = -Math.asin(THREE.MathUtils.clamp(postInfo.tangentY * postFwdDot, -0.45, 0.45));
  car.roadPitch += (targetRoadPitch - car.roadPitch) * Math.min(1, dt * 18);
  car.wrongWay = Math.abs(vFwd) > 4 && postFwdDot < -0.35;

  if (Math.abs(postInfo.lateral) > postInfo.wallLimit) {
    const sign = Math.sign(postInfo.lateral);
    const excess = Math.abs(postInfo.lateral) - postInfo.wallLimit;
    car.pos.x -= postInfo.rightX * (sign * excess);
    car.pos.z -= postInfo.rightZ * (sign * excess);

    const vn = car.vel.x * postInfo.rightX + car.vel.z * postInfo.rightZ;
    if (vn * sign > 0) {
      const impact = Math.min(1, Math.abs(vn) / 20);
      car.wallImpact = impact;
      const dmgScale = (settings.damageMult ?? 100) / 100;
      if (impact > 0.35 && settings.mode !== 'time_attack' && dmgScale > 0) {
        if (postFwdDot >= 0) {
          car.wingDamage = Math.min(0.85, car.wingDamage + (impact - 0.30) * 0.25 * dmgScale);
        } else {
          car.diffuserDamage = Math.min(0.75, car.diffuserDamage + (impact - 0.30) * 0.22 * dmgScale);
        }
      }
      const bounce = -(1 + 0.18) * vn;
      car.vel.x += postInfo.rightX * bounce;
      car.vel.z += postInfo.rightZ * bounce;
      car.vel.multiplyScalar(0.88);
      car.yawRate *= 0.35;
      const trackYaw = Math.atan2(postInfo.tangentX, postInfo.tangentZ);
      let yawErr = trackYaw - car.yaw;
      while (yawErr > Math.PI) yawErr -= Math.PI * 2;
      while (yawErr < -Math.PI) yawErr += Math.PI * 2;
      car.yaw += yawErr * 0.14;
      car.speed = car.vel.x * Math.sin(car.yaw) + car.vel.z * Math.cos(car.yaw);
    }
  }

  // 10. 8-SPEED GEARBOX WITH SEAMLESS SHIFT CUT
  updateGearbox(car, settings.manualGearbox && car.isPlayer, dt);

  // 11. LAP, 3-SECTOR TIMING & REAL-ROAD EVOLUTION
  updateRaceProgress(car, postInfo, track, raceClock, sessionBest);

  return postInfo;
}

function updateGearbox(car: CarState, isManual: boolean, dt: number) {
  const prevGear = car.gear;
  const absSpd = Math.abs(car.speed);

  if (isManual) {
    if (car.shiftUpReq) {
      car.gear = Math.min(8, Math.max(1, car.gear + 1));
      car.shiftUpReq = false;
    } else if (car.shiftDownReq) {
      car.gear = car.speed < 2 ? -1 : Math.max(1, car.gear - 1);
      car.shiftDownReq = false;
    }
  } else {
    if (car.speed < -0.6) car.gear = -1;
    else if (absSpd < 0.7 && car.throttleInput < 0.05) car.gear = 0;
    else {
      let g = 1;
      for (let i = 1; i <= 8; i++) {
        if (car.speed <= GEAR_MAX_SPEEDS[i]) { g = i; break; }
        g = 8;
      }
      car.gear = g;
    }
  }

  if (car.gear !== prevGear && car.gear > 0 && prevGear > 0 && car.speed > 18) {
    if (car.gear > prevGear) {
      car.justShifted = true;
      car.shiftFlameTimer = 0.11;
      car.shiftCutTimer = 0.038; // 38ms realistic seamless shift cut!
    } else {
      car.justDownshifted = true;
    }
  }

  if (car.gear <= 0) {
    const rev = car.gear === -1 ? 5200 + absSpd * 260 : 4200 + car.throttleInput * 7500;
    car.rpm += (rev - car.rpm) * Math.min(1, dt * 12);
  } else {
    const minG = GEAR_MAX_SPEEDS[car.gear - 1] * 0.74;
    const maxG = GEAR_MAX_SPEEDS[car.gear];
    const ratio = THREE.MathUtils.clamp((car.speed - minG) / Math.max(1, maxG - minG), 0, 1.05);
    const targetRpm = 6200 + ratio * 8700;
    car.rpm += (targetRpm - car.rpm) * Math.min(1, dt * 18);
  }
  car.rpm = THREE.MathUtils.clamp(car.rpm, 4000, 15000);
}

function updateRaceProgress(
  car: CarState,
  tInfo: TrackQueryResult,
  track: TrackData,
  raceClock: number,
  sessionBest: SessionBestSectors
) {
  const L = track.totalLength;
  let ds = tInfo.s - car.prevS;
  if (ds < -L * 0.5) ds += L;
  if (ds > L * 0.5) ds -= L;
  car.prevS = tInfo.s;
  car.raceDistance += ds;

  const relS = (tInfo.s - track.startS + L) % L;
  const relFrac = relS / L;

  if (!car.finished && car.raceDistance > 20) {
    const newSec = relFrac < 0.333 ? 0 : relFrac < 0.666 ? 1 : 2;
    if (newSec === 1 && car.currentSector === 0) {
      recordSector(car, 0, raceClock, sessionBest);
      car.currentSector = 1;
    } else if (newSec === 2 && car.currentSector === 1) {
      recordSector(car, 1, raceClock, sessionBest);
      car.currentSector = 2;
    }
  }

  if (relFrac > 0.42 && relFrac < 0.68) car.passedHalfway = true;

  if (!car.finished && car.passedHalfway && relFrac < 0.14 && ds > 0) {
    car.passedHalfway = false;
    const lapDur = raceClock - car.lapStartTime;
    if (lapDur > 8) {
      if (car.currentSector === 2) recordSector(car, 2, raceClock, sessionBest);
      car.currentSector = 0;
      car.sectorStartTime = raceClock;

      car.lastLapTime = lapDur;
      if (lapDur < car.bestLapTime) car.bestLapTime = lapDur;
      car.lapStartTime = raceClock;

      // Real-Road rubber evolution increases slightly as cars complete laps (Item 17)
      track.rubberEvolution = Math.min(1.0, track.rubberEvolution + 0.03);

      if (car.lap >= car.maxLaps) {
        car.finished = true;
        car.finishTime = raceClock + car.timePenaltySec;
      } else {
        car.lap += 1;
      }
    }
  }

  if (!car.finished) {
    car.currentLapTime = Math.max(0, raceClock - car.lapStartTime);
  }
}

function recordSector(car: CarState, secIdx: number, raceClock: number, sessionBest: SessionBestSectors) {
  const dur = raceClock - car.sectorStartTime;
  car.sectorStartTime = raceClock;
  if (dur <= 2) return;
  car.sectorTimes[secIdx] = dur;
  if (dur < sessionBest.sectors[secIdx]) {
    sessionBest.sectors[secIdx] = dur;
    car.bestSectors[secIdx] = Math.min(car.bestSectors[secIdx], dur);
    car.lastSectorStatus[secIdx] = 'purple';
  } else if (dur < car.bestSectors[secIdx]) {
    car.bestSectors[secIdx] = dur;
    car.lastSectorStatus[secIdx] = 'green';
  } else {
    car.lastSectorStatus[secIdx] = 'yellow';
  }
}

export interface CarCollisionEvent {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  intensity: number;
  type: 'wheel_rub' | 'rear_end' | 'side_slam';
  involvesPlayer: boolean;
  primaryColor: string;
}

export function resolveCarCollisions(cars: CarState[], damageScale = 1.0): CarCollisionEvent[] {
  const events: CarCollisionEvent[] = [];
  // Oriented Elliptical F1 Hull: 4.50m length (halfLen 2.25m) x 1.96m width (halfWid 0.98m)
  const HALF_LEN = 2.25;
  const HALF_WID = 0.98;
  const MAX_CENTER_DIST_SQ = (HALF_LEN * 2 + 0.4) ** 2;

  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      if (a.inPit || b.inPit) continue;

      const cdx = b.pos.x - a.pos.x;
      const cdz = b.pos.z - a.pos.z;
      const centerDistSq = cdx * cdx + cdz * cdz;
      if (centerDistSq > MAX_CENTER_DIST_SQ || centerDistSq < 0.0001) continue;

      // Average heading frame between the two cars for symmetric, non-snapping elliptical hull normal
      const aFwdX = Math.sin(a.yaw), aFwdZ = Math.cos(a.yaw);
      const bFwdX = Math.sin(b.yaw), bFwdZ = Math.cos(b.yaw);
      const aRightX = -aFwdZ, aRightZ = aFwdX;
      const bRightX = -bFwdZ, bRightZ = bFwdX;

      let mFwdX = aFwdX + bFwdX;
      let mFwdZ = aFwdZ + bFwdZ;
      const mLen = Math.hypot(mFwdX, mFwdZ);
      if (mLen > 0.01) {
        mFwdX /= mLen;
        mFwdZ /= mLen;
      } else {
        mFwdX = aFwdX;
        mFwdZ = aFwdZ;
      }
      const mRightX = -mFwdZ;
      const mRightZ = mFwdX;

      // Project center delta into oriented frame
      const along = cdx * mFwdX + cdz * mFwdZ;
      const lat = cdx * mRightX + cdz * mRightZ;

      const normAlong = along / (HALF_LEN * 2);
      const normLat = lat / (HALF_WID * 2);
      const ellipDistSq = normAlong * normAlong + normLat * normLat;
      if (ellipDistSq >= 1.0) continue;

      const ellipDist = Math.max(0.05, Math.sqrt(ellipDistSq));
      // Smooth continuous surface normal in world space
      const gradAlong = normAlong / (HALF_LEN * 2);
      const gradLat = normLat / (HALF_WID * 2);
      const gx = mFwdX * gradAlong + mRightX * gradLat;
      const gz = mFwdZ * gradAlong + mRightZ * gradLat;
      const gLen = Math.max(0.001, Math.hypot(gx, gz));
      const nx = gx / gLen;
      const nz = gz / gLen;

      // Physical overlap distance in meters along the contact normal
      const effRadius = 1.0 / gLen;
      const overlap = (1.0 - ellipDist) * effRadius;

      // Classify contact: rear-end (nose to diffuser) vs wheel-to-wheel side rub
      const aDotN = aFwdX * nx + aFwdZ * nz;
      const bDotN = bFwdX * nx + bFwdZ * nz;
      const isRearEnd = Math.abs(normAlong) > Math.abs(normLat) * 1.15;
      const isWheelRub = !isRearEnd && Math.abs(aDotN) < 0.55 && Math.abs(bDotN) < 0.55;
      const colType: CarCollisionEvent['type'] = isRearEnd ? 'rear_end' : isWheelRub ? 'wheel_rub' : 'side_slam';

      // Player car has heavy planted dominance (0.24 vs 0.76) so AI rivals get pushed away smoothly without shoving player off-track
      const shareA = a.isPlayer ? 0.24 : b.isPlayer ? 0.76 : 0.50;
      const shareB = 1 - shareA;
      const sep = overlap * 0.65;
      a.pos.x -= nx * sep * shareA;
      a.pos.z -= nz * sep * shareA;
      b.pos.x += nx * sep * shareB;
      b.pos.z += nz * sep * shareB;

      // Make AI rivals immediately yield lateral lane offset away from the contact!
      if (!a.isPlayer) {
        const pushLatA = -(nx * a._tInfo.rightX + nz * a._tInfo.rightZ);
        a.aiLaneOffset = THREE.MathUtils.clamp(a.aiLaneOffset + pushLatA * overlap * 0.9, -6.5, 6.5);
        a.aiTargetLane = a.aiLaneOffset;
      }
      if (!b.isPlayer) {
        const pushLatB = nx * b._tInfo.rightX + nz * b._tInfo.rightZ;
        b.aiLaneOffset = THREE.MathUtils.clamp(b.aiLaneOffset + pushLatB * overlap * 0.9, -6.5, 6.5);
        b.aiTargetLane = b.aiLaneOffset;
      }

      const rvx = b.vel.x - a.vel.x;
      const rvz = b.vel.z - a.vel.z;
      const relNorm = rvx * nx + rvz * nz;

      // Only apply velocity impulse if cars are actually moving toward each other (no 240Hz artificial bounce!)
      if (relNorm < -0.05) {
        const restitution = isWheelRub ? 0.12 : isRearEnd ? 0.22 : 0.25;
        const jImp = -(1 + restitution) * relNorm;

        // Light tangential scrub
        const tx = -nz;
        const tz = nx;
        const relTan = rvx * tx + rvz * tz;
        const jTan = THREE.MathUtils.clamp(-relTan * 0.15, -jImp * 0.12, jImp * 0.12);

        const ix = nx * jImp + tx * jTan;
        const iz = nz * jImp + tz * jTan;

        a.vel.x -= ix * shareA;
        a.vel.z -= iz * shareA;
        b.vel.x += ix * shareB;
        b.vel.z += iz * shareB;

        // Stabilize yaw rate on contact so collisions NEVER cause uncontrollable spin-outs
        a.yawRate *= a.isPlayer ? 0.78 : 0.85;
        b.yawRate *= b.isPlayer ? 0.78 : 0.85;

        // Sync forward & lateral speeds with post-collision velocity vector
        a.speed = a.vel.x * aFwdX + a.vel.z * aFwdZ;
        a.lateralSpeed = THREE.MathUtils.clamp(a.vel.x * aRightX + a.vel.z * aRightZ, -12, 12);
        b.speed = b.vel.x * bFwdX + b.vel.z * bFwdZ;
        b.lateralSpeed = THREE.MathUtils.clamp(b.vel.x * bRightX + b.vel.z * bRightZ, -12, 12);

        const intensity = THREE.MathUtils.clamp(Math.abs(relNorm) / 18, 0.05, 1.0);
        a.carImpact = Math.max(a.carImpact, intensity);
        b.carImpact = Math.max(b.carImpact, intensity);

        if (!a.isPlayer) a.aiMistakeTimer = Math.max(a.aiMistakeTimer, 0.35 * intensity);
        if (!b.isPlayer) b.aiMistakeTimer = Math.max(b.aiMistakeTimer, 0.35 * intensity);

        // Granular Nose / Front Wing & Rear Diffuser damage on hard collisions
        if (intensity > 0.36 && damageScale > 0 && isRearEnd) {
          const dmgAmt = (intensity - 0.32) * 0.18 * damageScale;
          if (aDotN > 0.5) a.wingDamage = Math.min(0.85, a.wingDamage + dmgAmt);
          else if (aDotN < -0.5) a.diffuserDamage = Math.min(0.75, a.diffuserDamage + dmgAmt * 0.8);
          if (bDotN < -0.5) b.wingDamage = Math.min(0.85, b.wingDamage + dmgAmt);
          else if (bDotN > 0.5) b.diffuserDamage = Math.min(0.75, b.diffuserDamage + dmgAmt * 0.8);
        }

        if (intensity > 0.16) {
          events.push({
            pos: new THREE.Vector3((a.pos.x + b.pos.x) * 0.5, (a.pos.y + b.pos.y) * 0.5 + 0.36, (a.pos.z + b.pos.z) * 0.5),
            normal: new THREE.Vector3(nx, 0.25, nz).normalize(),
            intensity,
            type: colType,
            involvesPlayer: a.isPlayer || b.isPlayer,
            primaryColor: a.isPlayer ? b.team.primaryColor : a.team.primaryColor
          });
        }
      }
    }
  }
  return events;
}

export function resetCarOnTrack(car: CarState, track: TrackData): void {
  const s = track.samples[car.splineIndex % track.N];
  car.pos.set(s.pos.x, s.asphaltY, s.pos.z);
  car.prevPos.copy(car.pos);
  car.vel.set(0, 0, 0);
  car.speed = 0;
  car.lateralSpeed = 0;
  car.yawRate = 0;
  car.yaw = Math.atan2(s.tangent.x, s.tangent.z);
  car.prevYaw = car.yaw;
  car.drsActive = false;
  car.ersActive = false;
  car.wrongWay = false;
  car.aiStuckTimer = 0;
}
