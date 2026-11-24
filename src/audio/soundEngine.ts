/**
 * APEX GP 3D — AAA Spatial & Manufacturer-Distinct Web Audio F1 Sound Engine (Items 36-45)
 * - Distinct Power Unit harmonics per manufacturer (Ferrari, Red Bull/Honda, Mercedes, Monster)
 * - 3D Stereo Spatial Rival Car Audio with Doppler Pitch Shift
 * - Tunnel & Street Canyon acoustic slapback resonance
 * - Dynamic Radio Audio Ducking
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

  // 3D Spatial Rival Car Synth + Stereo Panner (Doppler!)
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

  init(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.42;
    this.masterGain.connect(this.ctx.destination);

    // Radio ducking bus (lowers engine/ambient slightly when Race Engineer talks)
    this.duckGain = this.ctx.createGain();
    this.duckGain.gain.value = 1.0;
    this.duckGain.connect(this.masterGain);

    // 1. Player V6 Turbo-Hybrid Engine Synth
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 2.8;

    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this._makeDistortionCurve(32);
    shaper.oversample = '2x';

    this.tunnelDelay = this.ctx.createDelay(0.25);
    this.tunnelDelay.delayTime.value = 0.065;
    this.tunnelWet = this.ctx.createGain();
    this.tunnelWet.gain.value = 0;

    this.oscMain = this.ctx.createOscillator();
    this.oscMain.type = 'sawtooth';
    this.oscMain.frequency.value = 110;

    this.oscHarm = this.ctx.createOscillator();
    this.oscHarm.type = 'sawtooth';
    this.oscHarm.frequency.value = 220;

    this.oscSub = this.ctx.createOscillator();
    this.oscSub.type = 'triangle';
    this.oscSub.frequency.value = 55;

    this.oscTurbo = this.ctx.createOscillator();
    this.oscTurbo.type = 'sine';
    this.oscTurbo.frequency.value = 1600;

    const gMain = this.ctx.createGain(); gMain.gain.value = 0.45;
    const gHarm = this.ctx.createGain(); gHarm.gain.value = 0.30;
    const gSub = this.ctx.createGain(); gSub.gain.value = 0.36;
    this.turboGain = this.ctx.createGain(); this.turboGain.gain.value = 0;

    this.oscMain.connect(gMain).connect(shaper);
    this.oscHarm.connect(gHarm).connect(shaper);
    this.oscSub.connect(gSub).connect(shaper);
    shaper.connect(this.engineFilter).connect(this.engineGain);
    this.engineGain.connect(this.duckGain);
    this.engineGain.connect(this.tunnelDelay).connect(this.tunnelWet).connect(this.duckGain);
    this.oscTurbo.connect(this.turboGain).connect(this.duckGain);

    this.oscMain.start();
    this.oscHarm.start();
    this.oscSub.start();
    this.oscTurbo.start();

    // 2. 3D Spatial Rival Engine + Doppler Stereo Panner
    this.rivalOsc = this.ctx.createOscillator();
    this.rivalOsc.type = 'sawtooth';
    this.rivalOsc.frequency.value = 180;
    this.rivalFilter = this.ctx.createBiquadFilter();
    this.rivalFilter.type = 'bandpass';
    this.rivalFilter.frequency.value = 620;
    this.rivalFilter.Q.value = 1.6;
    this.rivalGain = this.ctx.createGain();
    this.rivalGain.gain.value = 0;
    this.rivalPan = this.ctx.createStereoPanner();
    this.rivalOsc.connect(this.rivalFilter).connect(this.rivalGain).connect(this.rivalPan).connect(this.duckGain);
    this.rivalOsc.start();

    // 3. Noise channels (Tire screech, Curb/Gravel rumble, Aero wind)
    this.noiseBuffer = this._createNoiseBuffer(2.0);

    const screechSrc = this.ctx.createBufferSource();
    screechSrc.buffer = this.noiseBuffer;
    screechSrc.loop = true;
    this.screechFilter = this.ctx.createBiquadFilter();
    this.screechFilter.type = 'bandpass';
    this.screechFilter.frequency.value = 1380;
    this.screechFilter.Q.value = 6.5;
    this.screechGain = this.ctx.createGain();
    this.screechGain.gain.value = 0;
    screechSrc.connect(this.screechFilter).connect(this.screechGain).connect(this.duckGain);
    screechSrc.start();

    const rumbleSrc = this.ctx.createBufferSource();
    rumbleSrc.buffer = this.noiseBuffer;
    rumbleSrc.loop = true;
    const rumbleFilter = this.ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 210;
    this.rumbleGain = this.ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumbleSrc.connect(rumbleFilter).connect(this.rumbleGain).connect(this.duckGain);
    rumbleSrc.start();

    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = this.noiseBuffer;
    windSrc.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 650;
    this.windFilter.Q.value = 1.2;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.duckGain);
    windSrc.start();

    this.initialized = true;
  }

  private _makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 256;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  private _createNoiseBuffer(seconds: number): AudioBuffer {
    const sr = this.ctx!.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx!.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(mute ? 0 : 0.42, this.ctx.currentTime, 0.04);
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

    // Manufacturer-specific Power Unit harmonic character (Item 36)
    const pu = car.team.physics.puTone;
    const pitchMult = pu === 'ferrari' ? 1.06 : pu === 'honda' ? 0.95 : pu === 'monster' ? 1.03 : 1.0;
    const harmRatio = pu === 'ferrari' ? 2.02 : pu === 'honda' ? 1.50 : 1.995;

    const baseFreq = (88 + rpmNorm * 295) * pitchMult;
    this.oscMain.frequency.setTargetAtTime(baseFreq, now, 0.022);
    this.oscHarm.frequency.setTargetAtTime(baseFreq * harmRatio, now, 0.022);
    this.oscSub.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.022);

    const cutoff = 540 + rpmNorm * 2700 + car.throttleInput * 950;
    this.engineFilter.frequency.setTargetAtTime(cutoff, now, 0.03);
    this.engineGain.gain.setTargetAtTime(0.14 + car.throttleInput * 0.14 + rpmNorm * 0.11, now, 0.03);

    this.tunnelWet.gain.setTargetAtTime(car.inTunnel ? 0.36 : 0.0, now, 0.08);

    const turboFreq = 1350 + rpmNorm * 2450 + (car.ersActive ? 450 : car.ersHarvesting ? -280 : 0);
    this.oscTurbo.frequency.setTargetAtTime(turboFreq, now, 0.03);
    const turboVol = (car.ersActive ? 0.055 : car.ersHarvesting ? 0.035 : 0.015 * car.throttleInput) * (0.4 + rpmNorm * 0.6);
    this.turboGain.gain.setTargetAtTime(turboVol, now, 0.04);

    // 3D Spatial Rival Engine & Doppler Shift (Item 37)
    let closestDist = 26;
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
      const doppler = Math.max(0.75, Math.min(1.32, 1 + relVel / 343));
      const rRpmNorm = Math.max(0, Math.min(1, (closestRival.rpm - 4000) / 11000));
      const rFreq = (92 + rRpmNorm * 280) * doppler;

      this.rivalOsc.frequency.setTargetAtTime(rFreq, now, 0.03);
      this.rivalFilter.frequency.setTargetAtTime(rFreq * 2.5, now, 0.04);
      this.rivalPan.pan.setTargetAtTime(pan, now, 0.04);
      const proxVol = Math.pow(1 - closestDist / 26, 1.5) * 0.16;
      this.rivalGain.gain.setTargetAtTime(proxVol, now, 0.04);
    } else {
      this.rivalGain.gain.setTargetAtTime(0, now, 0.06);
    }

    if (car.justShifted) this.playShiftPop(false);
    if (car.justDownshifted) this.playShiftPop(true);

    const maxSlip = Math.max(car.slipRatio, car.frontLockup || 0);
    const screechAmt = !car.offTrack && Math.abs(car.speed) > 10 && maxSlip > 0.30
      ? Math.min(0.24, (maxSlip - 0.28) * 0.36)
      : 0;
    this.screechGain.gain.setTargetAtTime(screechAmt, now, 0.04);
    this.screechFilter.frequency.setTargetAtTime(1250 + speedNorm * 450, now, 0.05);

    const rumbleAmt = (car.offTrack || car.onCurb) && Math.abs(car.speed) > 6
      ? (car.offTrack ? 0.26 : 0.14) * Math.min(1, Math.abs(car.speed) / 35)
      : 0;
    this.rumbleGain.gain.setTargetAtTime(rumbleAmt, now, 0.05);

    const windVol = speedNorm * speedNorm * (0.11 + car.slipstream * 0.05);
    this.windGain.gain.setTargetAtTime(windVol, now, 0.06);
    this.windFilter.frequency.setTargetAtTime(480 + speedNorm * 1100, now, 0.06);
  }

  playShiftPop(isDownshift = false): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = isDownshift ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(isDownshift ? 260 : 175, now);
    osc.frequency.exponentialRampToValueAtTime(isDownshift ? 110 : 45, now + 0.08);
    g.gain.setValueAtTime(isDownshift ? 0.14 : 0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.10);
  }

  playStartBeep(isGo = false): void {
    if (!this.initialized) this.init();
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = isGo ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(isGo ? 920 : 460, now);
    if (isGo) osc.frequency.exponentialRampToValueAtTime(1180, now + 0.22);
    const dur = isGo ? 0.42 : 0.18;
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(isGo ? 0.36 : 0.26, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  playRadioChime(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Dynamic audio ducking during radio call (Item 45)
    this.duckGain.gain.setTargetAtTime(0.58, now, 0.05);
    this.duckGain.gain.setTargetAtTime(1.0, now + 2.4, 0.25);

    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(i === 0 ? 1050 : 1380, now + i * 0.075);
      g.gain.setValueAtTime(0.11, now + i * 0.075);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.075 + 0.06);
      osc.connect(g).connect(this.masterGain);
      osc.start(now + i * 0.075);
      osc.stop(now + i * 0.075 + 0.065);
    }
  }

  playImpact(intensity = 0.6): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const vol = Math.min(0.55, 0.14 + intensity * 0.42);

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.16);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.value = 900;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.6, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    src.connect(flt).connect(ng).connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.15);
  }
}
