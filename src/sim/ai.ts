/**
 * APEX GP 3D — Simulator AI Driver Controller (Items 56-65)
 * - Uses backward-integrated physical braking profile (`aiTargetSpeed`)
 * - 360° spatial awareness, blue-flag yielding, slipstream ERS attack & inside defense
 * - Autonomous Pit-Stop strategy (worn tires, heavy wing damage, or rain tire crossover)
 * - Subtle human-like under-pressure apex variation without off-track loops
 */
import * as THREE from 'three';
import type { CarState, TireCompoundId, TrackData } from '../core/types';
import { resetCarOnTrack, triggerPitStop } from './physics';

export function updateAIDriver(
  car: CarState,
  track: TrackData,
  allCars: CarState[],
  raceActive: boolean,
  raceClock: number,
  dt: number
): void {
  if (!raceActive) {
    car.throttleInput = 0.48 + 0.20 * Math.sin(performance.now() * 0.008 + car.gridSlot);
    car.brakeInput = 1.0;
    car.steerInput = 0;
    car.drsInput = false;
    car.ersInput = false;
    return;
  }

  if (raceClock < car.aiReactionDelay) {
    car.throttleInput = 0.65;
    car.brakeInput = 0;
    car.steerInput = 0;
    car.drsInput = false;
    car.ersInput = false;
    return;
  }

  if (car.inPit) return;

  // Smart Unstuck Safety Net
  if (raceClock > 4 && (car.speed < 2.2 || car.wrongWay)) {
    car.aiStuckTimer += dt;
    if (car.aiStuckTimer > 1.8) {
      resetCarOnTrack(car, track);
      return;
    }
  } else {
    car.aiStuckTimer = Math.max(0, car.aiStuckTimer - dt * 2);
  }

  // Autonomous AI Pit-Stop Strategy (Item 59): pit if tires < 24%, wing damaged, or wet weather crossover
  if (car._tInfo.isPitZone && car.lap < car.maxLaps) {
    const isSlick = car.compound === 'soft' || car.compound === 'medium' || car.compound === 'hard';
    const needsRainTires = track.trackWetness > 0.55 && isSlick;
    const needsSlickTires = track.trackWetness < 0.22 && !isSlick;
    if (car.tireWear < 24 || car.wingDamage > 0.45 || car.puncture || needsRainTires || needsSlickTires) {
      const nextComp: TireCompoundId = track.trackWetness > 0.72 ? 'wet'
        : track.trackWetness > 0.38 ? 'inter'
        : 'medium';
      triggerPitStop(car, nextComp);
    }
  }

  const N = track.N;
  const halfW = track.config.trackWidth * 0.5;
  const maxSafeLat = halfW - 1.95;
  const idx = car.splineIndex;

  // 1. Read exact backward-integrated physical target speed ahead
  let minTargetSpeed = track.samples[idx].aiTargetSpeed;
  for (let k = 1; k <= 6; k++) {
    const v = track.samples[(idx + k) % N].aiTargetSpeed;
    if (v < minTargetSpeed) minTargetSpeed = v;
  }

  const teamMult = (car.team.physics.clA / 3.45) * 0.35 + (car.team.physics.mechGrip / 1.78) * 0.35 + 0.30;
  const wetAdjust = track.trackWetness > 0.35 ? 1 - track.trackWetness * 0.14 : 1.0;
  let targetSpeed = minTargetSpeed * teamMult * car.aiSkill * wetAdjust;
  if (car.offTrack) targetSpeed = Math.min(targetSpeed, 32);

  // 2. 360° Spatial Awareness, Overtaking, Defensive Line & Blue Flags (Items 56-65)
  const lookAheadIdx = (idx + 10) % N;
  let desiredLane = track.samples[lookAheadIdx].idealLateral;

  const sinY = Math.sin(car.yaw);
  const cosY = Math.cos(car.yaw);
  const fwdX = sinY, fwdZ = cosY;
  const rightX = -cosY, rightZ = sinY;

  let blockedAhead = false;
  let attackingAhead = false;
  let pressuredBehind = false;

  for (let i = 0; i < allCars.length; i++) {
    const other = allCars[i];
    if (other === car || other.inPit) continue;
    const dx = other.pos.x - car.pos.x;
    const dz = other.pos.z - car.pos.z;
    const along = dx * fwdX + dz * fwdZ;
    const latDiff = dx * rightX + dz * rightZ;

    // Car directly ahead -> Overtake!
    if (along > 2.2 && along < 28 && Math.abs(latDiff) < 2.9) {
      blockedAhead = true;
      attackingAhead = true;
      const roomRight = maxSafeLat - car._tInfo.lateral;
      const roomLeft = car._tInfo.lateral + maxSafeLat;
      const passDir = latDiff >= 0 ? (roomLeft > 3.2 ? -1 : 1) : (roomRight > 3.2 ? 1 : -1);
      desiredLane = THREE.MathUtils.clamp(other._tInfo.lateral + passDir * 3.6, -maxSafeLat, maxSafeLat);
      if (along < 7.5 && Math.abs(latDiff) < 2.0) {
        targetSpeed = Math.min(targetSpeed, Math.max(15, other.speed * 0.96));
      }
      break;
    }

    // Car closely behind -> Blue Flag yielding OR defensive inside line
    if (along < -2.5 && along > -22 && Math.abs(latDiff) < 3.2) {
      if (other.raceDistance - car.raceDistance > track.totalLength * 0.65) {
        // Blue Flag (Item 62): move cleanly off racing line to let leader lap
        desiredLane = THREE.MathUtils.clamp(-Math.sign(desiredLane || 1) * (maxSafeLat - 0.8), -maxSafeLat, maxSafeLat);
      } else {
        pressuredBehind = true;
      }
    }

    // Side-by-side wheel-to-wheel room ("leave-a-da-space!")
    if (Math.abs(along) <= 4.5 && Math.abs(latDiff) < 3.4) {
      const pushDir = latDiff >= 0 ? -1 : 1;
      desiredLane = THREE.MathUtils.clamp(car._tInfo.lateral + pushDir * 1.4, -maxSafeLat, maxSafeLat);
    }
  }

  // Subtle credible human-like apex variation when pressured under braking (Item 58)
  if (pressuredBehind && Math.abs(car._tInfo.curvature) > 0.12) {
    const pressureOffset = Math.sin(raceClock * 1.7 + car.number) * (1.08 - car.aiSkill) * 4.5;
    desiredLane = THREE.MathUtils.clamp(desiredLane + pressureOffset, -maxSafeLat, maxSafeLat);
  }

  if (car.offTrack) desiredLane = 0;

  car.aiTargetLane = THREE.MathUtils.clamp(desiredLane, -maxSafeLat, maxSafeLat);
  car.aiLaneOffset += (car.aiTargetLane - car.aiLaneOffset) * Math.min(1, dt * (blockedAhead ? 4.2 : 2.6));

  // 3. Pure-Pursuit Steering
  const lookSamples = Math.floor(THREE.MathUtils.clamp(5 + car.speed * 0.13, 5, 18));
  const targetSample = track.samples[(idx + lookSamples) % N];
  const tx = targetSample.pos.x + targetSample.right.x * car.aiLaneOffset;
  const tz = targetSample.pos.z + targetSample.right.z * car.aiLaneOffset;

  const desiredYaw = Math.atan2(tx - car.pos.x, tz - car.pos.z);
  let angleDiff = desiredYaw - car.yaw;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  const steerGain = THREE.MathUtils.lerp(2.6, 4.2, THREE.MathUtils.clamp(car.speed / 80, 0, 1));
  const targetSteer = THREE.MathUtils.clamp(angleDiff * steerGain, -1, 1);
  car.steerInput += (targetSteer - car.steerInput) * Math.min(1, dt * 18);

  // 4. Longitudinal Speed Control (never engages reverse gear)
  const speedErr = car.speed - targetSpeed;
  if (car.speed < 4.0) {
    car.throttleInput = 0.72;
    car.brakeInput = 0;
  } else if (speedErr > 1.5) {
    car.throttleInput = 0;
    car.brakeInput = THREE.MathUtils.clamp(speedErr / 13, 0.25, 0.94);
  } else if (speedErr > 0.2) {
    car.throttleInput = 0.20;
    car.brakeInput = 0;
  } else {
    const steerMod = car.speed < 44 ? Math.abs(car.steerInput) * 0.30 : 0;
    car.throttleInput = THREE.MathUtils.clamp(1.0 - steerMod, 0.58, 1.0);
    car.brakeInput = 0;
  }

  // 5. Tactical DRS & ERS Mode Management (Item 60)
  car.drsInput = car.drsAvailable && car.throttleInput > 0.7;
  if (car.ersEnergy < 18) car.ersMode = 'none';
  else if (attackingAhead || pressuredBehind) car.ersMode = 'overtake';
  else car.ersMode = 'medium';

  car.ersInput = !car.offTrack
    && car.throttleInput > 0.85
    && car.ersEnergy > 28
    && (attackingAhead || (car.speed > 36 && car.speed < 80 && Math.abs(car._tInfo.curvature) < 0.08));
}
