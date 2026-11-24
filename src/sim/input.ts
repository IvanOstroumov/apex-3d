/**
 * APEX GP 3D — Unified Keyboard & HTML5 Gamepad Input Manager
 * Supports ERS mode cycling (B), Halo toggle (H), Interactive Radio commands (1/2/3),
 * Manual Gearbox paddles (Q/E or LB/RB), and dual-motor haptic rumble.
 */
import type { CarState } from '../core/types';

export class InputManager {
  public keys = new Set<string>();
  public gamepadConnected = false;
  public gamepadName = '';

  private prevButtons: boolean[] = [];
  private onCameraCycle?: () => void;
  private onPause?: () => void;
  private onReset?: () => void;
  private onPit?: () => void;
  private onReplay?: () => void;
  private onErsMode?: () => void;
  private onHaloToggle?: () => void;
  private onRadioQuery?: (topic: 1 | 2 | 3) => void;

  constructor(callbacks: {
    onCameraCycle?: () => void;
    onPause?: () => void;
    onReset?: () => void;
    onPit?: () => void;
    onReplay?: () => void;
    onErsMode?: () => void;
    onHaloToggle?: () => void;
    onRadioQuery?: (topic: 1 | 2 | 3) => void;
  } = {}) {
    this.onCameraCycle = callbacks.onCameraCycle;
    this.onPause = callbacks.onPause;
    this.onReset = callbacks.onReset;
    this.onPit = callbacks.onPit;
    this.onReplay = callbacks.onReplay;
    this.onErsMode = callbacks.onErsMode;
    this.onHaloToggle = callbacks.onHaloToggle;
    this.onRadioQuery = callbacks.onRadioQuery;

    window.addEventListener('keydown', (e) => {
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
      this.gamepadConnected = false;
      this.gamepadName = '';
    });
  }

  applyToPlayer(player: CarState, dt: number): void {
    const up = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const down = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');

    let targetThrottle = up ? 1 : 0;
    let targetBrake = down ? 1 : 0;
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

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads[0];
    if (gp) {
      this.gamepadConnected = true;
      const deadzone = 0.08;
      const rawStick = Math.abs(gp.axes[0] || 0) > deadzone ? -(gp.axes[0] || 0) : 0;
      const rt = gp.buttons[7]?.value ?? 0;
      const lt = gp.buttons[6]?.value ?? 0;

      if (rt > 0.04 || lt > 0.04 || Math.abs(rawStick) > 0.04) {
        targetThrottle = Math.max(targetThrottle, rt);
        targetBrake = Math.max(targetBrake, lt);
        if (Math.abs(rawStick) > 0.04) targetSteer = rawStick;
      }

      if (gp.buttons[0]?.pressed) ers = true;
      if (gp.buttons[3]?.pressed) drs = true;

      const pressedNow = (idx: number) => Boolean(gp.buttons[idx]?.pressed && !this.prevButtons[idx]);
      if (pressedNow(5)) player.shiftUpReq = true;
      if (pressedNow(4)) player.shiftDownReq = true;
      if (pressedNow(1)) this.onCameraCycle?.();
      if (pressedNow(9)) this.onPause?.();
      if (pressedNow(2)) this.onPit?.();
      if (pressedNow(8)) this.onErsMode?.();

      this.prevButtons = gp.buttons.map((b) => b.pressed);
    }

    player.throttleInput += (targetThrottle - player.throttleInput) * Math.min(1, dt * 12);
    player.brakeInput += (targetBrake - player.brakeInput) * Math.min(1, dt * 13);
    const steerSpeed = targetSteer === 0 ? 14.0 : 8.5;
    player.steerInput += (targetSteer - player.steerInput) * Math.min(1, dt * steerSpeed);
    player.drsInput = drs;
    player.ersInput = ers;
  }

  rumble(strong: number, weak: number, durationMs = 70): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads[0] as Gamepad & { vibrationActuator?: { playEffect: (t: string, o: Record<string, number>) => void } };
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
