/**
 * APEX GP 3D — Unified Keyboard, Controller & Sim-Racing Hardware Input Manager
 * Supports:
 * - Multi-Device Gamepad API & WebHID Sim-Racing Wheels (Logitech G29/G923, Thrustmaster, Fanatec, Moza)
 * - Analog Steering Wheel, 3-Pedal Set (Throttle, Load-Cell Brake, Clutch) with Deadzone, Linearity & Axis Inversion
 * - 3 Shifter Modes: Steering Wheel Paddles, Sequential Stick, and 7-Speed + R H-Pattern Shifter
 * - Interactive One-Click Axis Auto-Detection & Live Hardware Telemetry Bars
 */
import type { CarState, GameSettings } from '../core/types';

export type CalibrateTarget = 'steer' | 'throttle' | 'brake' | 'clutch';

export class InputManager {
  public keys = new Set<string>();
  public gamepadConnected = false;
  public gamepadName = '';

  // Live normalized telemetry for the Sim-Racing Hardware Calibration UI & HUD Pedals
  public liveSteer = 0;     // -1..1
  public liveThrottle = 0;  // 0..1
  public liveBrake = 0;     // 0..1
  public liveClutch = 0;    // 0..1
  public liveGearLabel = 'N';

  private prevButtons: boolean[] = [];
  private calibratingTarget: CalibrateTarget | null = null;
  private baselineAxes: number[] = [];
  private onCalibrated?: (target: CalibrateTarget, axisIdx: number, inverted: boolean) => void;

  private onCameraCycle?: () => void;
  private onPause?: () => void;
  private onReset?: () => void;
  private onPit?: () => void;
  private onReplay?: () => void;
  private onErsMode?: () => void;
  private onHaloToggle?: () => void;
  private onSirenToggle?: () => void;
  private onRadioQuery?: (topic: 1 | 2 | 3) => void;

  constructor(callbacks: {
    onCameraCycle?: () => void;
    onPause?: () => void;
    onReset?: () => void;
    onPit?: () => void;
    onReplay?: () => void;
    onErsMode?: () => void;
    onHaloToggle?: () => void;
    onSirenToggle?: () => void;
    onRadioQuery?: (topic: 1 | 2 | 3) => void;
  } = {}) {
    this.onCameraCycle = callbacks.onCameraCycle;
    this.onPause = callbacks.onPause;
    this.onReset = callbacks.onReset;
    this.onPit = callbacks.onPit;
    this.onReplay = callbacks.onReplay;
    this.onErsMode = callbacks.onErsMode;
    this.onHaloToggle = callbacks.onHaloToggle;
    this.onSirenToggle = callbacks.onSirenToggle;
    this.onRadioQuery = callbacks.onRadioQuery;

    window.addEventListener('keydown', (e) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.code === 'Escape') (document.activeElement as HTMLElement)?.blur();
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (!this.keys.has(e.code)) {
        this.keys.add(e.code);
        if (e.code === 'KeyC') this.onCameraCycle?.();
        else if (e.code === 'Escape') this.onPause?.();
        else if (e.code === 'KeyR') this.onReset?.();
        else if (e.code === 'KeyP') this.onPit?.();
        else if (e.code === 'KeyV') this.onReplay?.();
        else if (e.code === 'KeyB') this.onErsMode?.();
        else if (e.code === 'KeyH') this.onHaloToggle?.();
        else if (e.code === 'KeyG') this.onSirenToggle?.();
        else if (e.code === 'Digit1') this.onRadioQuery?.(1);
        else if (e.code === 'Digit2') this.onRadioQuery?.(2);
        else if (e.code === 'Digit3') this.onRadioQuery?.(3);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadConnected = true;
      this.gamepadName = e.gamepad.id;
    });
    window.addEventListener('gamepaddisconnected', () => {
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
      this.gamepadConnected = pads.length > 0;
      this.gamepadName = pads[0]?.id || '';
    });
  }

  public async requestWebHIDWheel(): Promise<string> {
    const navHid = (navigator as unknown as { hid?: { requestDevice: (opts: { filters: unknown[] }) => Promise<Array<{ productName?: string }>> } }).hid;
    if (!navHid) {
      return this.gamepadName || 'Gamepad API Standard Ready';
    }
    try {
      const devices = await navHid.requestDevice({ filters: [] });
      if (devices && devices.length > 0) {
        const name = devices[0].productName || 'Sim-Racing Wheel HID';
        this.gamepadConnected = true;
        this.gamepadName = name;
        return name;
      }
    } catch {
      // User cancelled WebHID dialog
    }
    return this.gamepadName || 'Gamepad / Wheel Active';
  }

  public startAxisCalibration(
    target: CalibrateTarget,
    onDone: (target: CalibrateTarget, axisIdx: number, inverted: boolean) => void
  ): void {
    this.calibratingTarget = target;
    this.onCalibrated = onDone;
    const gp = this._getPrimaryGamepad();
    this.baselineAxes = gp ? [...gp.axes] : [];
  }

  private _getPrimaryGamepad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (p && p.connected) return p;
    }
    return null;
  }

  private _shapeAxis(val: number, deadzonePct: number, linearityPct: number): number {
    const dz = Math.min(0.45, Math.max(0, deadzonePct / 100));
    const abs = Math.abs(val);
    if (abs <= dz) return 0;
    const norm = (abs - dz) / Math.max(1e-4, 1 - dz);
    const gamma = Math.max(0.4, Math.min(3.0, linearityPct / 100));
    return Math.sign(val) * Math.pow(Math.min(1, norm), gamma);
  }

  private _shapePedal(raw: number, deadzonePct: number, linearityPct: number, invert: boolean): number {
    // Normalize either [0..1] or [-1..1] pedal axis to [0..1]
    let v = raw;
    if (v < -0.05) {
      v = (v + 1) * 0.5;
    }
    if (invert) v = 1 - v;
    v = Math.max(0, Math.min(1, v));
    const dz = Math.min(0.35, Math.max(0, deadzonePct / 100));
    if (v <= dz) return 0;
    const norm = (v - dz) / Math.max(1e-4, 1 - dz);
    const gamma = Math.max(0.4, Math.min(3.0, linearityPct / 100));
    return Math.pow(Math.min(1, norm), gamma);
  }

  applyToPlayer(player: CarState, dt: number, settings?: GameSettings): void {
    const up = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const down = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const clutchKey = this.keys.has('KeyZ') || this.keys.has('ControlLeft');

    let targetThrottle = up ? 1 : 0;
    let targetBrake = down ? 1 : 0;
    let targetClutch = clutchKey ? 1 : 0;
    let targetSteer = (left ? 1 : 0) - (right ? 1 : 0);
    let drs = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    let ers = this.keys.has('Space');

    if (this.keys.has('KeyE')) {
      player.shiftUpReq = true;
      this.keys.delete('KeyE');
    }
    if (this.keys.has('KeyQ')) {
      player.shiftDownReq = true;
      this.keys.delete('KeyQ');
    }

    const shifterMode = settings?.shifterMode || 'paddles';
    if (shifterMode === 'h_pattern') {
      // Allow Numpad1..7 or Numpad0 (Neutral) / NumpadDecimal (Reverse) as keyboard H-Shifter test
      const hKeys: Array<[string, number]> = [
        ['Numpad1', 1], ['Numpad2', 2], ['Numpad3', 3], ['Numpad4', 4],
        ['Numpad5', 5], ['Numpad6', 6], ['Numpad7', 7], ['Numpad8', 8],
        ['Numpad0', 0], ['NumpadDecimal', -1]
      ];
      for (const [kCode, gNum] of hKeys) {
        if (this.keys.has(kCode)) {
          player.directGearReq = gNum;
          break;
        }
      }
    }

    const gp = this._getPrimaryGamepad();
    if (gp) {
      this.gamepadConnected = true;
      this.gamepadName = gp.id;

      // Check interactive axis calibration listener
      if (this.calibratingTarget) {
        for (let a = 0; a < gp.axes.length; a++) {
          const base = this.baselineAxes[a] ?? 0;
          const diff = (gp.axes[a] ?? 0) - base;
          if (Math.abs(diff) > 0.42) {
            const inv = diff < 0;
            const doneTarget = this.calibratingTarget;
            this.calibratingTarget = null;
            this.onCalibrated?.(doneTarget, a, inv);
            break;
          }
        }
      }

      const steerIdx = settings?.steerAxisIndex ?? 0;
      const throttleIdx = settings?.throttleAxisIndex ?? 2;
      const brakeIdx = settings?.brakeAxisIndex ?? 5;
      const clutchIdx = settings?.clutchAxisIndex ?? 1;

      const steerDz = settings?.steerDeadzone ?? 3;
      const steerLin = settings?.steerLinearity ?? 130;
      const steerSens = (settings?.steerSensitivity ?? 100) / 100;
      const wheelRotFactor = 900 / Math.max(180, settings?.wheelRotationDeg ?? 900);
      const pedalDz = settings?.pedalDeadzone ?? 3;
      const throtLin = settings?.throttleLinearity ?? 100;
      const brakeLin = settings?.brakeLinearity ?? 115;

      // 1. Analog Steering Wheel / Thumbstick
      let rawSteerAxis = -(gp.axes[steerIdx] ?? 0);
      if (settings?.invertSteerAxis) rawSteerAxis = -rawSteerAxis;
      const shapedSteer = Math.max(
        -1,
        Math.min(1, this._shapeAxis(rawSteerAxis, steerDz, steerLin) * steerSens * wheelRotFactor)
      );

      // 2. Analog Pedals (supports both gamepad triggers buttons[7]/[6] and dedicated USB pedal axes)
      const rtButton = gp.buttons[7]?.value ?? 0;
      const ltButton = gp.buttons[6]?.value ?? 0;

      let axisThrottle = 0;
      if (gp.axes.length > throttleIdx && Math.abs(gp.axes[throttleIdx]) > 0.05) {
        axisThrottle = this._shapePedal(gp.axes[throttleIdx], pedalDz, throtLin, Boolean(settings?.invertThrottleAxis));
      }
      let axisBrake = 0;
      if (gp.axes.length > brakeIdx && Math.abs(gp.axes[brakeIdx]) > 0.05) {
        axisBrake = this._shapePedal(gp.axes[brakeIdx], pedalDz, brakeLin, Boolean(settings?.invertBrakeAxis));
      }
      let axisClutch = 0;
      if (gp.axes.length > clutchIdx && Math.abs(gp.axes[clutchIdx]) > 0.08 && clutchIdx !== steerIdx) {
        axisClutch = this._shapePedal(gp.axes[clutchIdx], pedalDz, 100, Boolean(settings?.invertClutchAxis));
      }

      const gpThrottle = Math.max(this._shapePedal(rtButton, pedalDz, throtLin, false), axisThrottle);
      const gpBrake = Math.max(this._shapePedal(ltButton, pedalDz, brakeLin, false), axisBrake);

      if (gpThrottle > 0.02 || gpBrake > 0.02 || Math.abs(shapedSteer) > 0.02 || axisClutch > 0.02) {
        targetThrottle = Math.max(targetThrottle, gpThrottle);
        targetBrake = Math.max(targetBrake, gpBrake);
        targetClutch = Math.max(targetClutch, axisClutch);
        if (Math.abs(shapedSteer) > 0.02) targetSteer = shapedSteer;
      }

      if (gp.buttons[0]?.pressed) ers = true;
      if (gp.buttons[3]?.pressed) drs = true;

      const pressedNow = (idx: number) => Boolean(gp.buttons[idx]?.pressed && !this.prevButtons[idx]);

      // 3. Shifter Handling: Paddles, Sequential Stick, or H-Pattern Gate (buttons 12..19)
      if (shifterMode === 'h_pattern') {
        let hGearFound: number | null = null;
        // Standard Logitech/Thrustmaster H-Shifter buttons 12..18 = Gears 1..7, button 19 or 11 = Reverse
        for (let g = 1; g <= 7; g++) {
          const bIdx = 11 + g;
          if (gp.buttons[bIdx]?.pressed) {
            hGearFound = g;
            break;
          }
        }
        if (gp.buttons[19]?.pressed) hGearFound = -1;
        if (hGearFound !== null) {
          player.directGearReq = hGearFound;
        }
        // Still allow paddle override if user clicks paddles
        if (pressedNow(5)) player.shiftUpReq = true;
        if (pressedNow(4)) player.shiftDownReq = true;
      } else if (shifterMode === 'sequential') {
        if (pressedNow(5) || pressedNow(12)) player.shiftUpReq = true;
        if (pressedNow(4) || pressedNow(13)) player.shiftDownReq = true;
      } else {
        if (pressedNow(5)) player.shiftUpReq = true;
        if (pressedNow(4)) player.shiftDownReq = true;
      }

      if (pressedNow(1)) this.onCameraCycle?.();
      if (pressedNow(9)) this.onPause?.();
      if (pressedNow(2)) this.onPit?.();
      if (pressedNow(8)) this.onErsMode?.();
      if (pressedNow(10)) this.onSirenToggle?.();

      this.prevButtons = gp.buttons.map((b) => b.pressed);
    }

    player.throttleInput += (targetThrottle - player.throttleInput) * Math.min(1, dt * 14);
    player.brakeInput += (targetBrake - player.brakeInput) * Math.min(1, dt * 15);
    player.clutchInput = (player.clutchInput ?? 0) + (targetClutch - (player.clutchInput ?? 0)) * Math.min(1, dt * 16);

    const steerSpeed = targetSteer === 0 ? 14.0 : 9.5;
    player.steerInput += (targetSteer - player.steerInput) * Math.min(1, dt * steerSpeed);
    player.drsInput = drs;
    player.ersInput = ers;

    // Update live calibration telemetry
    this.liveSteer = player.steerInput;
    this.liveThrottle = player.throttleInput;
    this.liveBrake = player.brakeInput;
    this.liveClutch = player.clutchInput ?? 0;
    this.liveGearLabel = player.gear === -1 ? 'R' : player.gear === 0 ? 'N' : String(player.gear);
  }

  rumble(strong: number, weak: number, durationMs = 70): void {
    const gp = this._getPrimaryGamepad() as Gamepad & {
      vibrationActuator?: { playEffect: (t: string, o: Record<string, number>) => void };
    };
    if (gp?.vibrationActuator?.playEffect) {
      try {
        gp.vibrationActuator.playEffect('dual-rumble', {
          duration: durationMs,
          strongMagnitude: Math.min(1, Math.max(0, strong)),
          weakMagnitude: Math.min(1, Math.max(0, weak))
        });
      } catch {
        // Ignore unsupported browser rumble
      }
    }
  }
}
