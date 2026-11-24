/**
 * APEX GP 3D — Warm, Balanced Multi-Harmonic V6 Turbo-Hybrid Web Audio Engine
 * - Comfortable default master gain (0.15) with live Master Volume slider support
 * - Warm V6 exhaust resonator (triangle fundamental + filtered harmonic + sub-bass + pink-noise exhaust breath)
 * - 3D Stereo Spatial Rival Audio with smooth Doppler shift
 * - Debounced deep carbon-chassis impact thud & soft rubber scrub
 */
import type { CarState } from '../core/types';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private duckGain!: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private tunnelDelay!: DelayNode;
  private tunnelWet!: GainNode;
  private oscMain!: OscillatorNode;
  private oscHarm!: OscillatorNode;
  private oscSub!: OscillatorNode;
  private oscTurbo!: OscillatorNode;
  private turboGain!: GainNode;

  // 3D Spatial Rival Car Synth + Stereo Panner (Doppler)
  private rivalOsc!: OscillatorNode;
  private rivalFilter!: BiquadFilterNode;
  private rivalGain!: GainNode;
  private rivalPan!: StereoPannerNode;

  private screechFilter!: BiquadFilterNode;
  private screechGain!: GainNode;
  private rumbleGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private noiseBuffer!: AudioBuffer;

  public muted = false;
  public initialized = false;
  private userVolumePct = 75;
  private lastImpactTime = 0;

  init(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this._calcMasterGain();
    this.masterGain.connect(this.ctx.destination);

    // Radio ducking bus
    this.duckGain = this.ctx.createGain();
    this.duckGain.gain.value = 1.0;
    this.duckGain.connect(this.masterGain);

    // 1. Warm Player V6 Turbo-Hybrid Exhaust Synth (no harsh piercing distortion)
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 480;
    this.engineFilter.Q.value = 1.25;

    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this._makeWarmSaturationCurve(6);
    shaper.oversample = '2x';

    this.tunnelDelay = this.ctx.createDelay(0.25);
    this.tunnelDelay.delayTime.value = 0.055;
    this.tunnelWet = this.ctx.createGain();
    this.tunnelWet.gain.value = 0;

    this.oscMain = this.ctx.createOscillator();
    this.oscMain.type = 'triangle';
    this.oscMain.frequency.value = 95;

    this.oscHarm = this.ctx.createOscillator();
    this.oscHarm.type = 'sawtooth';
    this.oscHarm.frequency.value = 190;

    this.oscSub = this.ctx.createOscillator();
    this.oscSub.type = 'sine';
    this.oscSub.frequency.value = 47.5;

    this.oscTurbo = this.ctx.createOscillator();
    this.oscTurbo.type = 'triangle';
    this.oscTurbo.frequency.value = 620;

    const gMain = this.ctx.createGain(); gMain.gain.value = 0.46;
    const gHarm = this.ctx.createGain(); gHarm.gain.value = 0.14;
    const gSub = this.ctx.createGain(); gSub.gain.value = 0.42;
    this.turboGain = this.ctx.createGain(); this.turboGain.gain.value = 0;

    this.oscMain.connect(gMain).connect(shaper);
    this.oscHarm.connect(gHarm).connect(shaper);
    this.oscSub.connect(gSub).connect(shaper);
    shaper.connect(this.engineFilter).connect(this.engineGain);
    this.engineGain.connect(this.duckGain);
    this.engineGain.connect(this.tunnelDelay).connect(this.tunnelWet).connect(this.duckGain);

    const turboFilter = this.ctx.createBiquadFilter();
    turboFilter.type = 'bandpass';
    turboFilter.frequency.value = 820;
    turboFilter.Q.value = 1.5;
    this.oscTurbo.connect(turboFilter).connect(this.turboGain).connect(this.duckGain);

    this.oscMain.start();
    this.oscHarm.start();
    this.oscSub.start();
    this.oscTurbo.start();

    // 2. 3D Spatial Rival Engine + Doppler Stereo Panner
    this.rivalOsc = this.ctx.createOscillator();
    this.rivalOsc.type = 'triangle';
    this.rivalOsc.frequency.value = 140;
    this.rivalFilter = this.ctx.createBiquadFilter();
    this.rivalFilter.type = 'lowpass';
    this.rivalFilter.frequency.value = 480;
    this.rivalFilter.Q.value = 1.1;
    this.rivalGain = this.ctx.createGain();
    this.rivalGain.gain.value = 0;
    this.rivalPan = this.ctx.createStereoPanner();
    this.rivalOsc.connect(this.rivalFilter).connect(this.rivalGain).connect(this.rivalPan).connect(this.duckGain);
    this.rivalOsc.start();

    // 3. Pink-tinted noise channels (Soft tire rubber scrub, Curb/Grass rumble, Aero wind)
    this.noiseBuffer = this._createPinkNoiseBuffer(2.0);

    const screechSrc = this.ctx.createBufferSource();
    screechSrc.buffer = this.noiseBuffer;
    screechSrc.loop = true;
    this.screechFilter = this.ctx.createBiquadFilter();
    this.screechFilter.type = 'bandpass';
    this.screechFilter.frequency.value = 640;
    this.screechFilter.Q.value = 2.1;
    this.screechGain = this.ctx.createGain();
    this.screechGain.gain.value = 0;
    screechSrc.connect(this.screechFilter).connect(this.screechGain).connect(this.duckGain);
    screechSrc.start();

    const rumbleSrc = this.ctx.createBufferSource();
    rumbleSrc.buffer = this.noiseBuffer;
    rumbleSrc.loop = true;
    const rumbleFilter = this.ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 165;
    this.rumbleGain = this.ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumbleSrc.connect(rumbleFilter).connect(this.rumbleGain).connect(this.duckGain);
    rumbleSrc.start();

    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = this.noiseBuffer;
    windSrc.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.9;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.duckGain);
    windSrc.start();

    this.initialized = true;
  }

  private _calcMasterGain(): number {
    return 0.16 * Math.max(0, Math.min(1.5, this.userVolumePct / 85));
  }

  public setMasterVolume(pct: number): void {
    this.userVolumePct = pct;
    if (this.masterGain && this.ctx && !this.muted) {
      this.masterGain.gain.setTargetAtTime(this._calcMasterGain(), this.ctx.currentTime, 0.04);
    }
  }

  private _makeWarmSaturationCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 256;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * (1 + amount * 0.15));
    }
    return curve;
  }

  private _createPinkNoiseBuffer(seconds: number): AudioBuffer {
    const sr = this.ctx!.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx!.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    }
    return buf;
  }

  setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(mute ? 0 : this._calcMasterGain(), this.ctx.currentTime, 0.04);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  stopEngine(): void {
    if (!this.initialized || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0, now, 0.08);
    this.turboGain.gain.setTargetAtTime(0, now, 0.08);
    this.rivalGain.gain.setTargetAtTime(0, now, 0.06);
    this.screechGain.gain.setTargetAtTime(0, now, 0.06);
    this.rumbleGain.gain.setTargetAtTime(0, now, 0.06);
    this.windGain.gain.setTargetAtTime(0, now, 0.06);
  }

  update(car: CarState, allCars: CarState[] = []): void {
    if (!this.initialized || !this.ctx || this.muted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const now = this.ctx.currentTime;
    const rpmNorm = Math.max(0, Math.min(1, (car.rpm - 4000) / 11000));
    const speedNorm = Math.min(1, Math.abs(car.speed) / 98);

    const pu = car.team.physics.puTone;
    const pitchMult = pu === 'ferrari' ? 1.04 : pu === 'honda' ? 0.94 : pu === 'monster' ? 1.01 : 0.98;
    const harmRatio = pu === 'honda' ? 1.50 : 2.0;

    // Warm realistic V6 fundamental frequency range (72 Hz at idle -> 240 Hz at 15,000 RPM)
    const baseFreq = (72 + rpmNorm * 168) * pitchMult;
    this.oscMain.frequency.setTargetAtTime(baseFreq, now, 0.025);
    this.oscHarm.frequency.setTargetAtTime(baseFreq * harmRatio, now, 0.025);
    this.oscSub.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.025);

    const cutoff = 320 + rpmNorm * 920 + car.throttleInput * 360;
    this.engineFilter.frequency.setTargetAtTime(cutoff, now, 0.035);
    this.engineGain.gain.setTargetAtTime(0.11 + car.throttleInput * 0.10 + rpmNorm * 0.07, now, 0.035);

    this.tunnelWet.gain.setTargetAtTime(car.inTunnel ? 0.24 : 0.0, now, 0.08);

    const turboFreq = 540 + rpmNorm * 680 + (car.ersActive ? 120 : 0);
    this.oscTurbo.frequency.setTargetAtTime(turboFreq, now, 0.04);
    const turboVol = (car.ersActive ? 0.018 : 0.008 * car.throttleInput) * (0.3 + rpmNorm * 0.7);
    this.turboGain.gain.setTargetAtTime(turboVol, now, 0.05);

    // 3D Spatial Rival Engine & Doppler Shift
    let closestDist = 24;
    let closestRival: CarState | null = null;
    for (let i = 0; i < allCars.length; i++) {
      const other = allCars[i];
      if (other === car) continue;
      const d = Math.hypot(other.pos.x - car.pos.x, other.pos.z - car.pos.z);
      if (d < closestDist) {
        closestDist = d;
        closestRival = other;
      }
    }
    if (closestRival) {
      const dx = closestRival.pos.x - car.pos.x;
      const dz = closestRival.pos.z - car.pos.z;
      const rightX = -Math.cos(car.yaw);
      const rightZ = Math.sin(car.yaw);
      const pan = Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / Math.max(2, closestDist)));
      const relVel = ((car.vel.x - closestRival.vel.x) * dx + (car.vel.z - closestRival.vel.z) * dz) / Math.max(1, closestDist);
      const doppler = Math.max(0.80, Math.min(1.24, 1 + relVel / 343));
      const rRpmNorm = Math.max(0, Math.min(1, (closestRival.rpm - 4000) / 11000));
      const rFreq = (74 + rRpmNorm * 162) * doppler;

      this.rivalOsc.frequency.setTargetAtTime(rFreq, now, 0.035);
      this.rivalFilter.frequency.setTargetAtTime(rFreq * 2.2, now, 0.04);
      this.rivalPan.pan.setTargetAtTime(pan, now, 0.04);
      const proxVol = Math.pow(1 - closestDist / 24, 1.6) * 0.085;
      this.rivalGain.gain.setTargetAtTime(proxVol, now, 0.04);
    } else {
      this.rivalGain.gain.setTargetAtTime(0, now, 0.06);
    }

    if (car.justShifted) this.playShiftPop(false);
    if (car.justDownshifted) this.playShiftPop(true);

    const maxSlip = Math.max(car.slipRatio, car.frontLockup || 0);
    const screechAmt = !car.offTrack && Math.abs(car.speed) > 12 && maxSlip > 0.36
      ? Math.min(0.11, (maxSlip - 0.34) * 0.18)
      : 0;
    this.screechGain.gain.setTargetAtTime(screechAmt, now, 0.045);
    this.screechFilter.frequency.setTargetAtTime(540 + speedNorm * 220, now, 0.05);

    const rumbleAmt = (car.offTrack || car.onCurb) && Math.abs(car.speed) > 6
      ? (car.offTrack ? 0.16 : 0.09) * Math.min(1, Math.abs(car.speed) / 35)
      : 0;
    this.rumbleGain.gain.setTargetAtTime(rumbleAmt, now, 0.05);

    const windVol = speedNorm * speedNorm * (0.065 + car.slipstream * 0.03);
    this.windGain.gain.setTargetAtTime(windVol, now, 0.06);
    this.windFilter.frequency.setTargetAtTime(320 + speedNorm * 480, now, 0.06);
  }

  playShiftPop(isDownshift = false): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isDownshift ? 155 : 115, now);
    osc.frequency.exponentialRampToValueAtTime(isDownshift ? 72 : 38, now + 0.065);
    g.gain.setValueAtTime(isDownshift ? 0.09 : 0.13, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.075);
  }

  playStartBeep(isGo = false): void {
    if (!this.initialized) this.init();
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isGo ? 780 : 440, now);
    const dur = isGo ? 0.32 : 0.14;
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(isGo ? 0.20 : 0.14, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  playRadioChime(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.duckGain.gain.setTargetAtTime(0.65, now, 0.05);
    this.duckGain.gain.setTargetAtTime(1.0, now + 2.2, 0.25);

    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(i === 0 ? 880 : 1120, now + i * 0.07);
      g.gain.setValueAtTime(0.07, now + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.055);
      osc.connect(g).connect(this.masterGain);
      osc.start(now + i * 0.07);
      osc.stop(now + i * 0.07 + 0.06);
    }
  }

  playImpact(intensity = 0.6): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastImpactTime < 0.12) return;
    this.lastImpactTime = now;

    const vol = Math.min(0.28, 0.08 + intensity * 0.22);

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.14);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 520;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.45, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    src.connect(flt).connect(ng).connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.12);
  }
}
