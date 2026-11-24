/**
 * APEX GP 3D — 240Hz AAA Main Game Engine & Orchestrator
 * Combines:
 * - 240Hz Multi-Layer Physics + Visual Interpolation @ 60+ FPS
 * - Selective HDR Bloom, SMAA, ACES Filmic & Adaptive 60 FPS DPR Governor
 * - Weekend GP (One-Shot Q3 Qualifying -> Starting Grid -> Grand Prix), Championship, Time Attack + Ghost
 * - Dynamic Weather evolution (Dry -> Rain -> Drying Line), FIA Flags & VSC, Pit-Crew & TV Helicopter
 * - Interactive Pit-Wall Radio (1/2/3), Post-Race Telemetry Analyzer & JSON Export, Driver License persistence
 */
import * as THREE from 'three';
import type {
  CarState,
  DriverProfileStats,
  GameMode,
  GameSettings,
  GhostPoint,
  QualityPreset,
  RaceFlag,
  ReplaySample,
  SetupPresetId,
  TelemetryTracePoint,
  TireCompoundId,
  TrackData,
  WeatherType,
  DifficultyId
} from './core/types';
import {
  CAMERA_MODES,
  DEFAULT_SETTINGS,
  ERS_MODE_SPECS,
  FIA_POINTS,
  GAME_CONSTANTS,
  QUALITY_CONFIG,
  TEAMS,
  TIRE_COMPOUNDS,
  TRACKS
} from './core/config';
import { disposeObject3D } from './core/disposer';
import { createStudioEnvMap, createTireSidewallTexture } from './render/textures';
import { fh6Assets } from './render/assetRegistry';
import { PostProcessPipeline } from './render/postprocessing';
import { buildF1Car, updateCarVisuals, type F1CarVisual } from './render/carBuilder';
import { buildTrack } from './render/trackBuilder';
import { VFXManager } from './render/vfx';
import { ShowroomStage } from './render/showroom';
import {
  createCarState,
  cycleERSMode,
  resetCarOnTrack,
  resolveCarCollisions,
  stepCarPhysics,
  triggerPitStop,
  type SessionBestSectors
} from './sim/physics';
import { updateAIDriver } from './sim/ai';
import { InputManager } from './sim/input';
import { SoundEngine } from './audio/soundEngine';
import { HUDController, formatTime } from './ui/hud';

const LICENSE_STORAGE_KEY = 'apex_gp_3d_driver_license_v2';

export class ApexGPGame {
  public mode: 'MENU' | 'RACE' = 'MENU';
  public paused = false;
  public selectedTeamIdx = 0;
  public selectedTrackIdx = 0;
  public cameraModeIdx = 0;
  public settings: GameSettings = { ...DEFAULT_SETTINGS };

  public renderer!: THREE.WebGLRenderer;
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public post!: PostProcessPipeline;
  public assetsReady!: Promise<void>;
  private studioEnv!: THREE.Texture;

  public track: TrackData | null = null;
  public cars: CarState[] = [];
  public carVisuals: F1CarVisual[] = [];
  public player: CarState | null = null;
  public playerVisual: F1CarVisual | null = null;
  private vfx: VFXManager | null = null;

  // Weekend Qualifying -> Grand Prix state
  public isQualifyingSession = false;
  public qualifiedGridSlot: number | null = null;

  // FIA Flags & VSC
  public raceFlag: RaceFlag = 'GREEN';
  private vscTimer = 0;

  // Time Attack Ghost Car & Telemetry Trace Recording
  private ghostVisual: F1CarVisual | null = null;
  private currentLapGhost: GhostPoint[] = [];
  private bestLapGhost: GhostPoint[] = [];
  private lastGhostRecordTime = 0;
  private currentLapTrace: TelemetryTracePoint[] = [];
  public bestLapTrace: TelemetryTracePoint[] = [];

  // Instant Replay Buffer (15s @ 30Hz)
  private replayBuffer: ReplaySample[] = [];
  private replayActive = false;
  private replayCursor = 0;
  private lastReplaySampleClock = 0;

  // Championship & Driver License Profile
  private champRound = 0;
  private champPoints: Record<string, number> = {};
  public driverStats: DriverProfileStats = this._loadDriverStats();

  // Race timing & F1 5-light start
  public raceActive = false;
  public raceClock = 0;
  public countdownTimer = 0;
  private countdownStage = 0;
  private finishShown = false;
  private prevPlayerLap = 1;
  private prevBestLap = Infinity;
  private sessionBest: SessionBestSectors = { sectors: [Infinity, Infinity, Infinity] };
  private impactShake = 0;

  // Camera scratch vectors
  private camPosSmooth = new THREE.Vector3();
  private camLookSmooth = new THREE.Vector3();
  private _camFwd = new THREE.Vector3();
  private _camRight = new THREE.Vector3();
  private _camDesiredPos = new THREE.Vector3();
  private _camDesiredLook = new THREE.Vector3();
  public cameraInitialized = false;

  // Loop & Adaptive 60 FPS Governor
  private lastFrameTime = performance.now();
  private accumulator = 0;
  public fpsSmooth = 60;
  private currentDpr = 1.5;
  private dprCheckTimer = 0;

  private audio = new SoundEngine();
  private hud = new HUDController();
  public input!: InputManager;
  private showroom!: ShowroomStage;

  constructor() {
    this._initRenderer();
    this.showroom = new ShowroomStage(this.scene, this.camera, this.renderer.domElement);
    this.input = new InputManager({
      onCameraCycle: () => { if (this.mode === 'RACE' && !this.paused) this.cycleCamera(); },
      onPause: () => { if (this.mode === 'RACE' && !this.finishShown) this.togglePause(); },
      onReset: () => {
        if (this.mode === 'RACE' && !this.paused && this.player && this.raceActive && !this.replayActive) {
          resetCarOnTrack(this.player, this.track!);
          this.hud.showBanner(this.hud.t().bannerCarReset, 1100);
        }
      },
      onPit: () => { this._requestPlayerPitStop(); },
      onReplay: () => { if (this.mode === 'RACE' && !this.paused && this.raceActive) this.toggleReplay(); },
      onErsMode: () => { this._cyclePlayerErsMode(); },
      onHaloToggle: () => { this._toggleVirtualHalo(); },
      onRadioQuery: (topic) => { this._handleRadioQuery(topic); }
    });

    this._setupUI();
    this._bindWindowEvents();

    this.hud.updateLicenseUI(this.driverStats);
    this.hud.applyLanguage(this.audio.muted, this.settings.mode);
    this.showroom.setTeam(TEAMS[this.selectedTeamIdx], TIRE_COMPOUNDS[this.settings.compound].color);
    this.showroom.setVisible(true, this.studioEnv);
    this.hud.showMenu();

    (window as unknown as { fh6Assets: typeof fh6Assets }).fh6Assets = fh6Assets;
    let loopStarted = false;
    const kickLoop = () => {
      if (loopStarted) return;
      loopStarted = true;
      this.lastFrameTime = performance.now();
      requestAnimationFrame((t) => this._loop(t));
    };
    this.assetsReady = fh6Assets.preloadAll(this.renderer).then(() => {
      this.studioEnv = createStudioEnvMap(this.renderer);
      if (this.mode === 'MENU') {
        this.showroom.setTeam(TEAMS[this.selectedTeamIdx], TIRE_COMPOUNDS[this.settings.compound].color);
        this.showroom.setVisible(true, this.studioEnv);
      }
      kickLoop();
    });
    window.setTimeout(kickLoop, 2500);
  }

  private _loadDriverStats(): DriverProfileStats {
    try {
      const raw = localStorage.getItem(LICENSE_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // Ignore storage error
    }
    return {
      racesCompleted: 0,
      wins: 0,
      podiums: 0,
      poles: 0,
      fastestLaps: 0,
      safetyRating: 94,
      skillRating: 1500
    };
  }

  private _saveDriverStats(): void {
    try {
      localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(this.driverStats));
    } catch {
      // Ignore storage error
    }
    this.hud.updateLicenseUI(this.driverStats);
  }

  private _initRenderer(): void {
    const container = document.getElementById('canvas-container')!;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance'
    });
    const qCfg = QUALITY_CONFIG[this.settings.quality];
    this.currentDpr = Math.min(window.devicePixelRatio || 1, qCfg.maxDpr);
    this.renderer.setPixelRatio(this.currentDpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = qCfg.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.studioEnv = createStudioEnvMap(this.renderer);
    this.scene.environment = this.studioEnv;

    this.camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.12, 2400);
    this.post = new PostProcessPipeline(this.renderer, this.scene, this.camera, this.settings.quality);
  }

  public _applyQualityPreset(quality: QualityPreset): void {
    this.settings.quality = quality;
    const qCfg = QUALITY_CONFIG[quality];
    this.currentDpr = Math.min(window.devicePixelRatio || 1, qCfg.maxDpr);
    this.renderer.setPixelRatio(this.currentDpr);
    this.renderer.shadowMap.enabled = qCfg.shadows;
    this.post.rebuild(quality);
    this.post.setSize(window.innerWidth, window.innerHeight);
  }

  private _setupUI(): void {
    this.hud.initMenu(
      TEAMS,
      TRACKS,
      this.selectedTeamIdx,
      this.selectedTrackIdx,
      (idx) => {
        this.selectedTeamIdx = idx;
        this.hud.updateSelectedTeamUI(TEAMS[idx], idx);
        this.showroom.setTeam(TEAMS[idx], TIRE_COMPOUNDS[this.settings.compound].color);
      },
      (idx) => {
        this.selectedTrackIdx = idx;
        this.hud.updateSelectedTrackUI(TRACKS[idx], idx);
      }
    );

    document.querySelectorAll('#compound-pills .pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const comp = (btn as HTMLElement).dataset.compound as TireCompoundId;
        this.settings.compound = comp;
        document.querySelectorAll('#compound-pills .pill-btn').forEach((b) => b.classList.toggle('active', b === btn));
        this.showroom.setTeam(TEAMS[this.selectedTeamIdx], TIRE_COMPOUNDS[comp].color);
      });
    });

    document.querySelectorAll('#mode-tabs .mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = (btn as HTMLElement).dataset.mode as GameMode;
        this.settings.mode = m;
        document.querySelectorAll('#mode-tabs .mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
        const tr = this.hud.t();
        const laps = TRACKS[this.selectedTrackIdx].laps;
        document.getElementById('meta-laps')!.textContent = m === 'weekend' ? tr.lapsWeekend : m === 'time_attack' ? tr.lapsFree : `${laps} ${tr.lapsUnit}`;
      });
    });

    const optSetup = document.getElementById('opt-setup') as HTMLSelectElement;
    const optWingSlider = document.getElementById('opt-wing-slider') as HTMLInputElement;
    const optBiasSlider = document.getElementById('opt-bias-slider') as HTMLInputElement;
    const optSuspSlider = document.getElementById('opt-susp-slider') as HTMLInputElement;
    const valWingSlider = document.getElementById('val-wing-slider')!;
    const valBiasSlider = document.getElementById('val-bias-slider')!;
    const valSuspSlider = document.getElementById('val-susp-slider')!;

    const syncSlidersUI = (wing: number, bias: number, susp: number) => {
      this.settings.customWingLoad = wing;
      this.settings.customBrakeBias = bias;
      this.settings.customSuspStiff = susp;
      optWingSlider.value = String(wing);
      optBiasSlider.value = String(bias);
      optSuspSlider.value = String(susp);
      valWingSlider.textContent = String(wing);
      valBiasSlider.textContent = `${bias}%`;
      valSuspSlider.textContent = String(susp);
    };

    optSetup.addEventListener('change', () => {
      const preset = optSetup.value as SetupPresetId;
      this.settings.setupPreset = preset;
      if (preset === 'low_drag') syncSlidersUI(11, 56, 12);
      else if (preset === 'high_downforce') syncSlidersUI(43, 58, 9);
      else if (preset === 'anti_understeer') syncSlidersUI(32, 55, 9);
      else if (preset === 'anti_oversteer') syncSlidersUI(28, 60, 11);
      else syncSlidersUI(25, 57, 10);
    });
    optWingSlider.addEventListener('input', () => {
      this.settings.customWingLoad = Number(optWingSlider.value);
      valWingSlider.textContent = optWingSlider.value;
    });
    optBiasSlider.addEventListener('input', () => {
      this.settings.customBrakeBias = Number(optBiasSlider.value);
      valBiasSlider.textContent = `${optBiasSlider.value}%`;
    });
    optSuspSlider.addEventListener('input', () => {
      this.settings.customSuspStiff = Number(optSuspSlider.value);
      valSuspSlider.textContent = optSuspSlider.value;
    });

    const optAbs = document.getElementById('opt-abs') as HTMLInputElement;
    const optLine = document.getElementById('opt-line') as HTMLInputElement;
    const optManual = document.getElementById('opt-manual') as HTMLInputElement;
    const optReverse = document.getElementById('opt-reverse') as HTMLInputElement;
    const optTc = document.getElementById('opt-tc') as HTMLSelectElement;
    const optWeather = document.getElementById('opt-weather') as HTMLSelectElement;
    const optDiff = document.getElementById('opt-difficulty') as HTMLSelectElement;
    const optQual = document.getElementById('opt-quality') as HTMLSelectElement;

    optAbs.addEventListener('change', () => { this.settings.abs = optAbs.checked; });
    optLine.addEventListener('change', () => { this.settings.racingLine = optLine.checked; });
    optManual.addEventListener('change', () => { this.settings.manualGearbox = optManual.checked; });
    optReverse.addEventListener('change', () => { this.settings.reverseTrack = optReverse.checked; });
    optTc.addEventListener('change', () => { this.settings.tractionControl = optTc.value as 'off' | 'med' | 'full'; });
    optWeather.addEventListener('change', () => {
      this.settings.weather = optWeather.value as WeatherType;
      if (this.settings.weather === 'rain' && !['inter', 'wet'].includes(this.settings.compound)) {
        this.settings.compound = 'inter';
        document.querySelectorAll('#compound-pills .pill-btn').forEach((b) =>
          b.classList.toggle('active', (b as HTMLElement).dataset.compound === 'inter')
        );
        this.showroom.setTeam(TEAMS[this.selectedTeamIdx], TIRE_COMPOUNDS.inter.color);
      }
    });
    optDiff.addEventListener('change', () => { this.settings.difficulty = optDiff.value as DifficultyId; });
    optQual.addEventListener('change', () => { this._applyQualityPreset(optQual.value as QualityPreset); });

    document.getElementById('btn-start-race')!.addEventListener('click', () => {
      this.audio.init();
      this.qualifiedGridSlot = null;
      this.isQualifyingSession = this.settings.mode === 'weekend';
      if (this.settings.mode === 'championship') {
        this.champRound = 0;
        this.champPoints = {};
        this.selectedTrackIdx = 0;
      }
      this.startRace();
    });

    const toggleAudio = () => {
      this.audio.init();
      const muted = this.audio.toggleMute();
      const tr = this.hud.t();
      document.getElementById('btn-mute-menu')!.textContent = muted ? tr.audioOff : tr.audioOn;
      document.getElementById('btn-hud-mute')!.textContent = muted ? '🔇' : '🔊';
    };
    document.getElementById('btn-mute-menu')!.addEventListener('click', toggleAudio);
    document.getElementById('btn-hud-mute')!.addEventListener('click', toggleAudio);

    const switchLang = () => {
      this.hud.toggleLanguage(this.audio.muted, this.settings.mode);
    };
    document.getElementById('btn-lang-toggle')?.addEventListener('click', switchLang);
    document.getElementById('btn-wiki-lang')?.addEventListener('click', switchLang);

    // Interactive F1 Wiki / Academy Modal bindings
    document.getElementById('btn-open-wiki-menu')?.addEventListener('click', () => this.openWikiModal(true));
    document.getElementById('btn-open-wiki-hud')?.addEventListener('click', () => this.openWikiModal(true));
    document.getElementById('btn-open-wiki-pause')?.addEventListener('click', () => {
      document.getElementById('pause-modal')?.classList.add('hidden');
      this.openWikiModal(true);
    });
    document.getElementById('btn-close-wiki-top')?.addEventListener('click', () => {
      this.openWikiModal(false);
      if (this.mode === 'RACE' && this.paused) {
        this.paused = false;
        this.hud.setPaused(false);
      }
    });

    document.getElementById('btn-hud-radio1')!.addEventListener('click', () => this._handleRadioQuery(1));
    document.getElementById('btn-hud-radio2')!.addEventListener('click', () => this._handleRadioQuery(2));
    document.getElementById('btn-hud-ers')!.addEventListener('click', () => this._cyclePlayerErsMode());
    document.getElementById('btn-hud-cam')!.addEventListener('click', () => this.cycleCamera());
    document.getElementById('btn-hud-replay')!.addEventListener('click', () => this.toggleReplay());
    document.getElementById('btn-hud-pause')!.addEventListener('click', () => this.togglePause());

    document.getElementById('btn-resume')!.addEventListener('click', () => this.togglePause(false));
    document.getElementById('btn-restart')!.addEventListener('click', () => this.startRace());
    document.getElementById('btn-back-menu')!.addEventListener('click', () => this.returnToShowroom());
    document.getElementById('btn-finish-replay')!.addEventListener('click', () => this.startRace());
    document.getElementById('btn-finish-menu')!.addEventListener('click', () => this.returnToShowroom());
    document.getElementById('btn-finish-next')!.addEventListener('click', () => {
      if (this.isQualifyingSession) {
        this.isQualifyingSession = false;
        this.startRace();
      } else if (this.settings.mode === 'championship') {
        this.champRound++;
        this.selectedTrackIdx = this.champRound % TRACKS.length;
        this.startRace();
      }
    });

    document.getElementById('btn-export-json')!.addEventListener('click', () => this._exportTelemetryJSON());
    this._setupProSettingsModal(syncSlidersUI);
  }

  public openWikiModal(open = true): void {
    this.hud.openWikiModal(open);
    if (open && this.mode === 'RACE' && !this.paused) {
      this.paused = true;
      this.audio.stopEngine();
    }
  }

  public openSettingsModal(open = true): void {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.classList.toggle('hidden', !open);
    if (open && this.mode === 'RACE' && !this.paused) {
      this.paused = true;
      this.audio.stopEngine();
    }
  }

  private _setupProSettingsModal(syncSlidersUI: (w: number, b: number, s: number) => void): void {
    document.getElementById('btn-open-settings-menu')?.addEventListener('click', () => this.openSettingsModal(true));
    document.getElementById('btn-open-settings-hud')?.addEventListener('click', () => this.openSettingsModal(true));
    document.getElementById('btn-open-settings-pause')?.addEventListener('click', () => {
      document.getElementById('pause-modal')?.classList.add('hidden');
      this.openSettingsModal(true);
    });
    const closeFn = () => {
      this.openSettingsModal(false);
      if (this.mode === 'RACE' && this.paused) {
        this.paused = false;
        this.hud.setPaused(false);
      }
    };
    document.getElementById('btn-close-settings')?.addEventListener('click', closeFn);
    document.getElementById('btn-close-settings-top')?.addEventListener('click', closeFn);

    // Tab switching
    document.querySelectorAll('#settings-tabs .set-tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        const target = (tabBtn as HTMLElement).dataset.tab!;
        document.querySelectorAll('#settings-tabs .set-tab').forEach((b) => b.classList.toggle('active', b === tabBtn));
        ['gfx', 'cam', 'eng', 'ctrl', 'fia'].forEach((id) => {
          const pane = document.getElementById(`set-pane-${id}`);
          if (pane) {
            pane.classList.toggle('hidden', id !== target);
            pane.classList.toggle('active', id === target);
          }
        });
      });
    });

    const bindRange = (id: string, lblId: string, fmt: (v: number) => string, onChange: (v: number) => void) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      const lbl = document.getElementById(lblId);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = Number(el.value);
        if (lbl) lbl.textContent = fmt(v);
        onChange(v);
      });
    };

    // 1. Graphics & PBR
    bindRange('set-res', 'lbl-set-res', (v) => `${v}%`, (v) => {
      this.settings.resolutionScale = v;
      this.currentDpr = Math.min(2.2, ((window.devicePixelRatio || 1) * v) / 100);
      this.renderer.setPixelRatio(this.currentDpr);
    });
    const setShadows = document.getElementById('set-shadows') as HTMLSelectElement | null;
    setShadows?.addEventListener('change', () => {
      const val = setShadows.value as GameSettings['shadowQuality'];
      this.settings.shadowQuality = val;
      this.renderer.shadowMap.enabled = val !== 'off';
      if (this.track?.dirLight && val !== 'off') {
        const sz = Number(val);
        this.track.dirLight.castShadow = true;
        this.track.dirLight.shadow.mapSize.set(sz, sz);
      }
    });
    bindRange('set-env', 'lbl-set-env', (v) => `${v}%`, (v) => {
      this.settings.envReflectionIntensity = v;
    });
    bindRange('set-bloom', 'lbl-set-bloom', (v) => `${v}%`, (v) => {
      this.settings.bloomIntensity = v;
    });
    bindRange('set-exp', 'lbl-set-exp', (v) => `${v}%`, (v) => {
      this.settings.exposure = v;
      this.renderer.toneMappingExposure = v / 100;
    });
    bindRange('set-vig', 'lbl-set-vig', (v) => `${v}%`, (v) => {
      this.settings.vignetteIntensity = v;
    });
    const setSmaa = document.getElementById('set-smaa') as HTMLInputElement | null;
    setSmaa?.addEventListener('change', () => {
      this.settings.smaaEnabled = setSmaa.checked;
      this.post.rebuild(this.settings.quality, this.settings.smaaEnabled);
      this.post.setSize(window.innerWidth, window.innerHeight);
    });
    const setGov = document.getElementById('set-governor') as HTMLInputElement | null;
    setGov?.addEventListener('change', () => {
      this.settings.adaptiveFpsGovernor = setGov.checked;
    });

    // 2. Camera & Cockpit
    bindRange('set-fov', 'lbl-set-fov', (v) => `${v > 0 ? '+' : ''}${v}°`, (v) => { this.settings.fovOffset = v; });
    bindRange('set-speedfov', 'lbl-set-speedfov', (v) => `${v}%`, (v) => { this.settings.speedFovIntensity = v; });
    bindRange('set-seath', 'lbl-set-seath', (v) => `${v > 0 ? '+' : ''}${v} cm`, (v) => { this.settings.seatHeightCm = v; });
    bindRange('set-seatfore', 'lbl-set-seathe', (v) => `${v > 0 ? '+' : ''}${v} cm`, (v) => { this.settings.seatForeAftCm = v; });
    bindRange('set-pitch', 'lbl-set-pitch', (v) => `${v > 0 ? '+' : ''}${v}°`, (v) => { this.settings.cameraPitchDeg = v; });
    bindRange('set-shake', 'lbl-set-shake', (v) => `${v}%`, (v) => { this.settings.cameraShakeIntensity = v; });
    bindRange('set-roll', 'lbl-set-roll', (v) => `${v}%`, (v) => { this.settings.horizonRollIntensity = v; });
    const setHalo = document.getElementById('set-halo') as HTMLInputElement | null;
    setHalo?.addEventListener('change', () => {
      this.settings.hideHalo = setHalo.checked;
      if (this.playerVisual) this.playerVisual.haloMesh.visible = !this.settings.hideHalo;
    });
    const setRadar = document.getElementById('set-radar') as HTMLInputElement | null;
    setRadar?.addEventListener('change', () => {
      this.settings.showProximityRadar = setRadar.checked;
    });

    // 3. Car Engineering & Setup
    bindRange('set-fwing', 'lbl-set-fwing', (v) => String(v), (v) => {
      syncSlidersUI(v, this.settings.customBrakeBias, this.settings.customSuspStiff);
    });
    bindRange('set-rwing', 'lbl-set-rwing', (v) => String(v), (v) => { this.settings.customRearWingLoad = v; });
    bindRange('set-bbias', 'lbl-set-bbias', (v) => `${v}%`, (v) => {
      syncSlidersUI(this.settings.customWingLoad, v, this.settings.customSuspStiff);
    });
    bindRange('set-bpress', 'lbl-set-bpress', (v) => `${v}%`, (v) => { this.settings.customBrakePressure = v; });
    bindRange('set-diffon', 'lbl-set-diffon', (v) => `${v}%`, (v) => { this.settings.customDiffOnThrottle = v; });
    bindRange('set-diffoff', 'lbl-set-diffoff', (v) => `${v}%`, (v) => { this.settings.customDiffOffThrottle = v; });
    bindRange('set-susp', 'lbl-set-susp', (v) => String(v), (v) => {
      syncSlidersUI(this.settings.customWingLoad, this.settings.customBrakeBias, v);
    });
    const setRide = document.getElementById('set-ride') as HTMLInputElement | null;
    const setPsi = document.getElementById('set-psi') as HTMLInputElement | null;
    const lblRide = document.getElementById('lbl-set-ride');
    const updateRidePsi = () => {
      if (!setRide || !setPsi) return;
      this.settings.customRideHeightMm = Number(setRide.value);
      this.settings.customTirePressurePsi = Number(setPsi.value);
      if (lblRide) lblRide.textContent = `${this.settings.customRideHeightMm} mm / ${this.settings.customTirePressurePsi.toFixed(1)} PSI`;
    };
    setRide?.addEventListener('input', updateRidePsi);
    setPsi?.addEventListener('input', updateRidePsi);

    // 4. Controls & Assists
    bindRange('set-sens', 'lbl-set-sens', (v) => `${v}%`, (v) => { this.settings.steerSensitivity = v; });
    bindRange('set-lin', 'lbl-set-lin', (v) => (v / 100).toFixed(2), (v) => { this.settings.steerLinearity = v; });
    bindRange('set-dz', 'lbl-set-dz', (v) => `${v}%`, (v) => { this.settings.steerDeadzone = v; });
    bindRange('set-ffb', 'lbl-set-ffb', (v) => `${v}%`, (v) => { this.settings.ffbRumbleIntensity = v; });
    const setBassist = document.getElementById('set-bassist') as HTMLSelectElement | null;
    setBassist?.addEventListener('change', () => {
      this.settings.brakeAssist = setBassist.value as GameSettings['brakeAssist'];
    });
    const setTcModal = document.getElementById('set-tc-modal') as HTMLSelectElement | null;
    setTcModal?.addEventListener('change', () => {
      this.settings.tractionControl = setTcModal.value as GameSettings['tractionControl'];
      (document.getElementById('opt-tc') as HTMLSelectElement).value = this.settings.tractionControl;
    });
    const setAbsModal = document.getElementById('set-abs-modal') as HTMLInputElement | null;
    setAbsModal?.addEventListener('change', () => {
      this.settings.abs = setAbsModal.checked;
      (document.getElementById('opt-abs') as HTMLInputElement).checked = this.settings.abs;
    });
    const setManModal = document.getElementById('set-man-modal') as HTMLInputElement | null;
    setManModal?.addEventListener('change', () => {
      this.settings.manualGearbox = setManModal.checked;
      (document.getElementById('opt-manual') as HTMLInputElement).checked = this.settings.manualGearbox;
    });
    const setLineModal = document.getElementById('set-line-modal') as HTMLInputElement | null;
    setLineModal?.addEventListener('change', () => {
      this.settings.racingLine = setLineModal.checked;
      (document.getElementById('opt-line') as HTMLInputElement).checked = this.settings.racingLine;
      if (this.track) this.track.racingLineMesh.visible = this.settings.racingLine;
    });

    // 5. Audio, AI & FIA Rules
    bindRange('set-vol', 'lbl-set-vol', (v) => `${v}%`, (v) => { this.settings.masterVolume = v; });
    bindRange('set-ailevel', 'lbl-set-ailevel', (v) => `${v} / 110`, (v) => { this.settings.aiLevelNumber = v; });
    bindRange('set-aiagg', 'lbl-set-aiagg', (v) => `${v}%`, (v) => { this.settings.aiAggressionMult = v; });
    bindRange('set-dmg', 'lbl-set-dmg', (v) => `${v}%`, (v) => { this.settings.damageMult = v; });
    bindRange('set-wear', 'lbl-set-wear', (v) => `${v}%`, (v) => { this.settings.tireWearMult = v; });
    bindRange('set-fuel', 'lbl-set-fuel', (v) => `${v}%`, (v) => { this.settings.fuelBurnMult = v; });
    const setLimits = document.getElementById('set-limits') as HTMLSelectElement | null;
    setLimits?.addEventListener('change', () => {
      this.settings.trackLimitsStrictness = setLimits.value as GameSettings['trackLimitsStrictness'];
    });
    bindRange('set-tod', 'lbl-set-tod', (v) => `${v}x`, (v) => { this.settings.timeOfDaySpeed = v; });

    document.getElementById('btn-reset-settings')?.addEventListener('click', () => {
      this.settings = { ...DEFAULT_SETTINGS, mode: this.settings.mode, compound: this.settings.compound };
      syncSlidersUI(DEFAULT_SETTINGS.customWingLoad, DEFAULT_SETTINGS.customBrakeBias, DEFAULT_SETTINGS.customSuspStiff);
      this._applyQualityPreset(this.settings.quality);
      this.hud.showBanner(this.hud.t().bannerSettingsReset, 1300);
    });
  }

  private _bindWindowEvents(): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.post.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') {
        this.audio.init();
        const muted = this.audio.toggleMute();
        const tr = this.hud.t();
        document.getElementById('btn-mute-menu')!.textContent = muted ? tr.audioOff : tr.audioOn;
        document.getElementById('btn-hud-mute')!.textContent = muted ? '🔇' : '🔊';
      } else if (e.code === 'KeyO') {
        const modal = document.getElementById('settings-modal');
        this.openSettingsModal(modal ? modal.classList.contains('hidden') : true);
      } else if (e.code === 'KeyL') {
        this.hud.toggleLanguage(this.audio.muted, this.settings.mode);
      }
    });
  }

  private _cyclePlayerErsMode(): void {
    if (!this.player || this.mode !== 'RACE') return;
    const next = cycleERSMode(this.player);
    const label = this.hud.t().ersModes[next] || ERS_MODE_SPECS[next].label;
    this.hud.showBanner(`ERS MODE: ${label}`, 1000);
  }

  private _toggleVirtualHalo(): void {
    if (!this.playerVisual || this.mode !== 'RACE') return;
    this.settings.hideHalo = !this.settings.hideHalo;
    this.playerVisual.haloMesh.visible = !this.settings.hideHalo;
    this.hud.showBanner(this.settings.hideHalo ? this.hud.t().bannerHaloHidden : this.hud.t().bannerHaloVisible, 950);
  }

  private _handleRadioQuery(topic: 1 | 2 | 3): void {
    if (!this.player || !this.track || this.mode !== 'RACE') return;
    const tr = this.hud.t();
    this.audio.playRadioChime();
    if (topic === 1) {
      const wPct = Math.round(this.track.trackWetness * 100);
      this.hud.showRadio(
        tr.radioTiresWeather(
          Math.round(this.player.tireWear),
          Math.round(this.player.tireSurfaceTemp),
          Math.round(this.player.tireCoreTemp),
          Math.round(this.track.trackTempC),
          wPct
        ),
        3800
      );
    } else if (topic === 2) {
      const sorted = this._getSortedStandings();
      const idx = sorted.indexOf(this.player);
      const ahead = idx > 0 ? sorted[idx - 1] : null;
      const gap = ahead ? ((ahead.raceDistance - this.player.raceDistance) / Math.max(35, this.player.speed || 60)).toFixed(1) : '0.0';
      this.hud.showRadio(
        ahead
          ? tr.radioGapChasing(idx + 1, ahead.code, gap, this.player.fuelKg.toFixed(1))
          : tr.radioGapLeader(this.player.fuelKg.toFixed(1)),
        3800
      );
    } else {
      this._requestPlayerPitStop();
    }
  }

  private _exportTelemetryJSON(): void {
    if (!this.player || !this.track) return;
    const payload = {
      simulator: 'APEX GP 3D — 240Hz AAA Engine',
      timestamp: new Date().toISOString(),
      circuit: this.track.config.name,
      reverseLayout: this.settings.reverseTrack,
      team: this.player.team.name,
      bestLapTimeSec: Number.isFinite(this.player.bestLapTime) ? Number(this.player.bestLapTime.toFixed(3)) : null,
      bestSectorsSec: this.player.bestSectors.map((s) => (Number.isFinite(s) ? Number(s.toFixed(3)) : null)),
      driverLicense: this.driverStats,
      telemetryTrace: this.bestLapTrace.length ? this.bestLapTrace : this.currentLapTrace
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `apex-gp-telemetry-${this.track.config.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  public cycleCamera(): void {
    this.cameraModeIdx = (this.cameraModeIdx + 1) % CAMERA_MODES.length;
    this.cameraInitialized = false;
    this.hud.showBanner(`CAMERA: ${CAMERA_MODES[this.cameraModeIdx]}`, 950);
  }

  public togglePause(forceState: boolean | null = null): void {
    if (this.mode !== 'RACE') return;
    this.paused = forceState !== null ? forceState : !this.paused;
    this.hud.setPaused(this.paused);
    if (this.paused) this.audio.stopEngine();
  }

  public toggleReplay(): void {
    if (this.replayBuffer.length < 15) return;
    this.replayActive = !this.replayActive;
    this.replayCursor = 0;
    this.hud.setReplayBadge(this.replayActive);
    if (this.replayActive) this.audio.stopEngine();
  }

  private _requestPlayerPitStop(): void {
    if (!this.player || !this.track || this.mode !== 'RACE' || !this.raceActive || this.paused) return;
    const tr = this.hud.t();
    const nextComp: TireCompoundId = this.track.trackWetness > 0.45 ? 'inter' : 'soft';
    if (triggerPitStop(this.player, nextComp)) {
      const visIdx = this.cars.indexOf(this.player);
      if (visIdx >= 0) {
        this.carVisuals[visIdx].sidewallMat.map = createTireSidewallTexture(TIRE_COMPOUNDS[nextComp].color);
        this.carVisuals[visIdx].sidewallMat.needsUpdate = true;
      }
      // Show 3D Pit-Crew Mechanics around player car!
      this.track.pitCrewGroup.position.copy(this.player.pos);
      this.track.pitCrewGroup.rotation.y = this.player.yaw;
      this.track.pitCrewGroup.visible = true;

      this.audio.playRadioChime();
      this.hud.showRadio(tr.radioPitService, 2600);
    } else {
      this.audio.playRadioChime();
      this.hud.showRadio(tr.radioPitConfirm, 2600);
    }
  }

  private _clearRaceScene(): void {
    if (this.track) {
      this.scene.remove(this.track.group);
      disposeObject3D(this.track.group);
      this.track = null;
    }
    for (const vis of this.carVisuals) {
      this.scene.remove(vis.root);
      disposeObject3D(vis.root);
    }
    if (this.ghostVisual) {
      this.scene.remove(this.ghostVisual.root);
      disposeObject3D(this.ghostVisual.root);
      this.ghostVisual = null;
    }
    this.cars = [];
    this.carVisuals = [];
    this.player = null;
    this.playerVisual = null;
    if (this.vfx) {
      this.vfx.dispose(this.scene);
      this.vfx = null;
    }
  }

  public returnToShowroom(): void {
    this.audio.stopEngine();
    this._clearRaceScene();
    this.mode = 'MENU';
    this.paused = false;
    this.replayActive = false;
    this.showroom.setTeam(TEAMS[this.selectedTeamIdx], TIRE_COMPOUNDS[this.settings.compound].color);
    this.showroom.setVisible(true, this.studioEnv);
    this.hud.showMenu();
  }

  public startRace(): void {
    this._clearRaceScene();
    this.showroom.setVisible(false);

    const trackCfg = TRACKS[this.selectedTrackIdx];
    const playerTeam = TEAMS[this.selectedTeamIdx];
    this.settings.laps = trackCfg.laps;

    this.track = buildTrack(
      trackCfg,
      this.scene,
      this.renderer,
      this.settings.weather,
      this.settings.quality,
      this.settings.reverseTrack
    );
    this.track.racingLineMesh.visible = this.settings.racingLine;
    const vfxWeather = this.settings.weather === 'dynamic' ? 'overcast' : this.settings.weather;
    this.vfx = new VFXManager(this.scene, vfxWeather);

    const roster: Array<{ team: typeof playerTeam; number: number; code: string; isPlayer: boolean; compound: TireCompoundId }> = [];
    if (this.settings.mode === 'time_attack') {
      roster.push({
        team: playerTeam,
        number: playerTeam.number,
        code: playerTeam.code,
        isPlayer: true,
        compound: this.settings.compound
      });
    } else {
      const otherTeams = TEAMS.filter((t) => t.id !== playerTeam.id);
      const aiCompounds: TireCompoundId[] = this.track.trackWetness > 0.45
        ? ['inter', 'wet', 'inter', 'inter']
        : ['soft', 'medium', 'soft', 'hard'];
      const rivals = [
        { team: otherTeams[0], number: otherTeams[0].number, code: otherTeams[0].code, isPlayer: false, compound: aiCompounds[0] },
        { team: otherTeams[1], number: otherTeams[1].number, code: otherTeams[1].code, isPlayer: false, compound: aiCompounds[1] },
        { team: otherTeams[2], number: otherTeams[2].number, code: otherTeams[2].code, isPlayer: false, compound: aiCompounds[2] },
        { team: otherTeams[3], number: otherTeams[3].number, code: otherTeams[3].code, isPlayer: false, compound: aiCompounds[0] },
        { team: playerTeam,    number: playerTeam.aiNumber,  code: playerTeam.aiCode,  isPlayer: false, compound: aiCompounds[1] },
        { team: otherTeams[0], number: otherTeams[0].aiNumber, code: otherTeams[0].aiCode, isPlayer: false, compound: aiCompounds[2] },
        { team: otherTeams[1], number: otherTeams[1].aiNumber, code: otherTeams[1].aiCode, isPlayer: false, compound: aiCompounds[3] },
        { team: otherTeams[2], number: otherTeams[2].aiNumber, code: otherTeams[2].aiCode, isPlayer: false, compound: aiCompounds[1] },
        { team: otherTeams[3], number: otherTeams[3].aiNumber, code: otherTeams[3].aiCode, isPlayer: false, compound: aiCompounds[2] }
      ];
      const playerSlot = this.isQualifyingSession ? 0 : (this.qualifiedGridSlot ?? 4);
      rivals.splice(playerSlot, 0, {
        team: playerTeam,
        number: playerTeam.number,
        code: playerTeam.code,
        isPlayer: true,
        compound: this.settings.compound
      });
      roster.push(...rivals);
    }

    roster.forEach((entry, slot) => {
      const state = createCarState({
        id: `car_${slot}`,
        team: entry.team,
        number: entry.number,
        code: entry.code,
        isPlayer: entry.isPlayer,
        gridSlot: slot,
        track: this.track!,
        compound: entry.compound,
        settings: this.settings,
        isQualifying: this.isQualifyingSession
      });
      const vis = buildF1Car(entry.team, {
        overrideNumber: entry.number,
        tireBandColor: TIRE_COMPOUNDS[entry.compound].color,
        isPlayer: entry.isPlayer
      });
      vis.root.position.copy(state.pos);
      vis.root.rotation.set(0, state.yaw, 0);
      this.scene.add(vis.root);

      this.cars.push(state);
      this.carVisuals.push(vis);
      if (entry.isPlayer) {
        this.player = state;
        this.playerVisual = vis;
      }
    });

    this.currentLapGhost = [];
    this.bestLapGhost = [];
    this.currentLapTrace = [];
    this.bestLapTrace = [];

    if (this.settings.mode === 'time_attack') {
      this.ghostVisual = buildF1Car(playerTeam, { isGhost: true });
      this.ghostVisual.root.visible = false;
      this.scene.add(this.ghostVisual.root);
    }

    this.mode = 'RACE';
    this.paused = false;
    this.replayActive = false;
    this.replayBuffer = [];
    this.raceActive = false;
    this.raceClock = 0;
    this.countdownTimer = 0;
    this.countdownStage = 0;
    this.finishShown = false;
    this.prevPlayerLap = 1;
    this.prevBestLap = Infinity;
    this.sessionBest = { sectors: [Infinity, Infinity, Infinity] };
    this.raceFlag = 'GREEN';
    this.vscTimer = 0;
    this.cameraInitialized = false;

    const tr = this.hud.t();
    const sessionLabel = this.isQualifyingSession ? tr.qualifyingTag : 'APEX GP';
    this.hud.prepareRaceMinimap(this.track, this.cars.length, sessionLabel);
    this.hud.showRaceHUD();
    this.hud.setReplayBadge(false);
    this.hud.setStartLights(0, this.track.gantryLights);
    this.hud.showBanner(
      this.isQualifyingSession
        ? tr.bannerQualiStart(trackCfg.shortName)
        : tr.bannerGridStart(trackCfg.shortName, this.cars.indexOf(this.player!) + 1),
      1500
    );
  }

  private _updateStartCountdown(dt: number): void {
    if (this.raceActive || !this.track) return;
    const tr = this.hud.t();
    this.countdownTimer += dt;
    const launchPill = document.getElementById('launch-rpm-pill');
    if (launchPill && this.player) {
      launchPill.classList.remove('hidden');
      const rpm = Math.round(this.player.rpm);
      if (rpm >= 9200 && rpm <= 12200) {
        launchPill.textContent = tr.launchOptimal(rpm);
        launchPill.className = 'status-pill pit';
      } else if (rpm > 12200) {
        launchPill.textContent = tr.launchTooHigh(rpm);
        launchPill.className = 'status-pill offtrack';
      } else {
        launchPill.textContent = tr.launchHold(rpm);
        launchPill.className = 'status-pill slipstream';
      }
    }
    const nextStage = Math.min(5, Math.floor(this.countdownTimer / 0.72));
    if (nextStage > this.countdownStage && this.countdownStage < 5) {
      this.countdownStage = nextStage;
      this.hud.setStartLights(this.countdownStage, this.track.gantryLights);
      this.audio.playStartBeep(false);
    }
    if (this.countdownTimer >= 4.45) {
      this.raceActive = true;
      this.raceClock = 0;
      launchPill?.classList.add('hidden');
      this.hud.setStartLights('GO', this.track.gantryLights);
      const rpm = this.player ? this.player.rpm : 5000;
      const msg = rpm >= 9200 && rpm <= 12200
        ? tr.launchPerfectBanner
        : rpm > 12800
          ? tr.launchWheelspinBanner
          : tr.launchGoBanner;
      this.hud.showBanner(msg, 1600);
      this.audio.playStartBeep(true);
      window.setTimeout(() => {
        if (this.mode === 'RACE' && this.track) this.hud.setStartLights('HIDE', this.track.gantryLights);
      }, 1400);
    }
  }

  public _stepSimulation(dt: number): void {
    if (!this.track || !this.player) return;
    const tr = this.hud.t();
    this._updateStartCountdown(dt);
    if (this.raceActive) this.raceClock += dt;

    // Continuous Dynamic Weather & Drying Line Evolution (Items 19, 20, 22)
    if (this.raceActive && this.settings.weather === 'dynamic') {
      const targetWet = 0.45 + Math.sin(this.raceClock * 0.045) * 0.42;
      this.track.trackWetness += (targetWet - this.track.trackWetness) * dt * 0.08;
      this.track.dryingLineGrip = THREE.MathUtils.clamp(1 - this.track.trackWetness * 0.65, 0.25, 1.0);
      this.track.trackTempC = 32 - this.track.trackWetness * 10;
    }

    // FIA Race Director Flag Evaluation (Yellow Flag / VSC on multi-car spin or stalled car) (Items 68, 70)
    if (this.vscTimer > 0) {
      this.vscTimer = Math.max(0, this.vscTimer - dt);
      this.raceFlag = this.vscTimer > 0 ? 'VSC' : 'GREEN';
    } else {
      let hazard = false;
      for (const c of this.cars) {
        if (!c.isPlayer && !c.inPit && this.raceClock > 6 && (c.speed < 6 || c.wrongWay)) {
          hazard = true;
          break;
        }
      }
      this.raceFlag = hazard ? 'YELLOW' : 'GREEN';
    }

    // Hide 3D Pit-Crew once player leaves pit stop
    if (!this.player.inPit && this.track.pitCrewGroup.visible) {
      this.track.pitCrewGroup.visible = false;
    }

    if (this.player.finished) {
      updateAIDriver(this.player, this.track, this.cars, this.raceActive, this.raceClock, dt);
    } else {
      this.input.applyToPlayer(this.player, dt);
    }

    const vscActive = this.raceFlag === 'VSC';
    for (const car of this.cars) {
      if (!car.isPlayer) {
        updateAIDriver(car, this.track, this.cars, this.raceActive, this.raceClock, dt);
      }
      stepCarPhysics(car, this.track, this.cars, this.raceActive, this.raceClock, this.settings, this.sessionBest, vscActive, dt);
    }

    const dmgScale = this.settings.mode === 'time_attack' ? 0 : (this.settings.damageMult ?? 100) / 100;
    const colEvents = resolveCarCollisions(this.cars, dmgScale);
    for (const ev of colEvents) {
      this.vfx?.emitCarCollisionVFX(ev);
      if (ev.involvesPlayer) {
        this.audio.playImpact(ev.intensity);
        this.impactShake = Math.max(this.impactShake, ev.intensity);
        this.input.rumble(ev.intensity, ev.intensity * 0.75, 120);
        if (ev.intensity > 0.42) {
          this.hud.showBanner(ev.type === 'rear_end' ? tr.bannerCollisionWing : tr.bannerCollisionRub, 1100);
        }
      }
    }

    if (this.player.wallImpact > 0.14) {
      this.audio.playImpact(this.player.wallImpact);
      this.impactShake = Math.max(this.impactShake, this.player.wallImpact);
      this.input.rumble(this.player.wallImpact, this.player.wallImpact * 0.8, 130);
    } else if ((this.player.onCurb || this.player.frontLockup > 0.3) && Math.abs(this.player.speed) > 18) {
      this.input.rumble(0.12, 0.25, 45);
    }

    // Record Ghost & Telemetry Trace (10Hz)
    if (this.raceActive && this.raceClock - this.lastGhostRecordTime >= 0.1) {
      this.lastGhostRecordTime = this.raceClock;
      if (this.settings.mode === 'time_attack') {
        this.currentLapGhost.push({
          t: this.player.currentLapTime,
          x: this.player.pos.x,
          y: this.player.pos.y,
          z: this.player.pos.z,
          yaw: this.player.yaw,
          pitch: this.player.roadPitch
        });
      }
      this.currentLapTrace.push({
        frac: Number(this.player._tInfo.t.toFixed(3)),
        kmh: Math.round(Math.abs(this.player.speed) * 3.6),
        throttle: Math.round(this.player.throttleInput * 100),
        brake: Math.round(this.player.brakeInput * 100),
        gear: this.player.gear,
        gLat: Number(this.player.gLat.toFixed(2))
      });
    }

    // Record Instant Replay buffer (30Hz)
    if (this.raceActive && this.raceClock - this.lastReplaySampleClock >= 1 / 30) {
      this.lastReplaySampleClock = this.raceClock;
      this.replayBuffer.push({
        time: this.raceClock,
        cars: this.cars.map((c) => ({
          x: c.pos.x, y: c.pos.y, z: c.pos.z,
          yaw: c.yaw, pitch: c.roadPitch,
          speed: c.speed, steer: c.steerInput,
          drs: c.drsActive, brake: c.brakeInput
        }))
      });
      if (this.replayBuffer.length > 450) this.replayBuffer.shift();
    }

    // Lap / Best Lap / Finish
    if (this.player.lap > this.prevPlayerLap) {
      this.prevPlayerLap = this.player.lap;
      if (this.player.lastLapTime <= this.player.bestLapTime) {
        if (this.currentLapGhost.length > 10) this.bestLapGhost = [...this.currentLapGhost];
        if (this.currentLapTrace.length > 10) this.bestLapTrace = [...this.currentLapTrace];
      }
      this.currentLapGhost = [];
      this.currentLapTrace = [];

      if (this.player.lap === this.player.maxLaps && this.settings.mode !== 'time_attack') {
        this.hud.showBanner(tr.bannerFinalLap, 2200);
        this.audio.playRadioChime();
        this.hud.showRadio(tr.radioFinalLap);
      } else {
        this.hud.showBanner(`${tr.lapWord} ${this.player.lap} — ${formatTime(this.player.lastLapTime)}`, 1900);
      }
    }

    if (this.player.bestLapTime < this.prevBestLap) {
      this.prevBestLap = this.player.bestLapTime;
      if (this.player.lap > 1 && !this.player.finished) {
        this.audio.playRadioChime();
        this.hud.showRadio(tr.radioFastestLap(formatTime(this.player.bestLapTime)));
      }
    }

    if (this.player.finished && !this.finishShown) {
      this.finishShown = true;
      if (this.bestLapTrace.length === 0) this.bestLapTrace = [...this.currentLapTrace];
      const sorted = this._getSortedStandings();
      const playerPos = sorted.indexOf(this.player) + 1;

      // Celebrate podium finish with sky fireworks bursts! (Item 34)
      if (playerPos <= 3 && this.vfx) {
        for (let f = 0; f < 5; f++) {
          this.vfx.emitCollisionBurst(
            new THREE.Vector3(
              this.player.pos.x + (Math.random() - 0.5) * 35,
              this.player.pos.y + 14 + Math.random() * 12,
              this.player.pos.z + (Math.random() - 0.5) * 35
            ),
            2.2
          );
        }
      }

      // Update Driver License Safety & Skill Rating (Item 84)
      this.driverStats.racesCompleted++;
      if (!this.isQualifyingSession) {
        if (playerPos === 1) this.driverStats.wins++;
        if (playerPos <= 3) this.driverStats.podiums++;
        this.driverStats.skillRating = THREE.MathUtils.clamp(
          this.driverStats.skillRating + (5 - playerPos) * 14,
          1000,
          2800
        );
      } else if (playerPos === 1) {
        this.driverStats.poles++;
      }
      const cleanDelta = this.player.trackLimitWarnings === 0 ? 1.5 : -this.player.trackLimitWarnings * 1.2;
      this.driverStats.safetyRating = THREE.MathUtils.clamp(this.driverStats.safetyRating + cleanDelta, 40, 100);
      this._saveDriverStats();

      let hasNext = false;
      let nextLabel = tr.finishNextSession;
      if (this.isQualifyingSession) {
        this.qualifiedGridSlot = playerPos - 1;
        hasNext = true;
        nextLabel = tr.finishStartGP(playerPos);
      } else if (this.settings.mode === 'championship') {
        sorted.forEach((c, idx) => {
          this.champPoints[c.code] = (this.champPoints[c.code] || 0) + (FIA_POINTS[idx] || 0);
        });
        hasNext = this.champRound < TRACKS.length - 1;
        nextLabel = tr.finishNextChamp;
      }

      const wasQuali = this.isQualifyingSession;
      window.setTimeout(() => {
        if (this.mode === 'RACE' && this.track && this.player) {
          this.hud.showFinishModal({
            sortedCars: sorted,
            player: this.player,
            trackName: this.track.config.name,
            isQualifyingResult: wasQuali,
            hasNextAction: hasNext,
            nextActionLabel: nextLabel,
            trace: this.bestLapTrace,
            champPointsMap: this.settings.mode === 'championship' ? this.champPoints : undefined
          });
        }
      }, 900);
    }
  }

  public _getSortedStandings(): CarState[] {
    return [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.raceDistance - a.raceDistance;
    });
  }

  private _updateGhostCar(): void {
    if (!this.ghostVisual || !this.player || this.bestLapGhost.length < 2) return;
    const t = this.player.currentLapTime;
    const pts = this.bestLapGhost;
    let i = 0;
    while (i < pts.length - 2 && pts[i + 1].t < t) i++;
    const a = pts[i];
    const b = pts[i + 1];
    const f = THREE.MathUtils.clamp((t - a.t) / Math.max(0.001, b.t - a.t), 0, 1);

    this.ghostVisual.root.visible = true;
    this.ghostVisual.root.position.set(
      THREE.MathUtils.lerp(a.x, b.x, f),
      THREE.MathUtils.lerp(a.y, b.y, f),
      THREE.MathUtils.lerp(a.z, b.z, f)
    );
    this.ghostVisual.root.rotation.order = 'YXZ';
    this.ghostVisual.root.rotation.y = a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * f;
    this.ghostVisual.root.rotation.x = THREE.MathUtils.lerp(a.pitch, b.pitch, f);
  }

  public _updateRaceCamera(dt: number): void {
    if (!this.player) return;
    const p = this.player;
    const anchorPos = this.playerVisual ? this.playerVisual.root.position : p.pos;
    const anchorYaw = this.playerVisual ? this.playerVisual.root.rotation.y : p.yaw;
    const mode = CAMERA_MODES[this.cameraModeIdx];

    const sinY = Math.sin(anchorYaw);
    const cosY = Math.cos(anchorYaw);
    const fwd = this._camFwd.set(sinY, -Math.sin(p.roadPitch), cosY).normalize();
    const right = this._camRight.set(-cosY, 0, sinY);
    const speedNorm = THREE.MathUtils.clamp(Math.abs(p.speed) / 96, 0, 1.05);

    const baseFov = (mode === 'CHASE' ? 76 : mode === 'T-CAM' ? 68 : mode === 'COCKPIT' ? 74 : 70) + this.settings.fovOffset;
    const speedFovMult = (this.settings.speedFovIntensity ?? 100) / 100;
    const targetFov = baseFov + speedNorm * 9.0 * speedFovMult;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 5);
    this.camera.updateProjectionMatrix();

    const seatH = (this.settings.seatHeightCm ?? 0) * 0.01;
    const seatFore = (this.settings.seatForeAftCm ?? 0) * 0.01;
    const pitchOff = Math.tan(((this.settings.cameraPitchDeg ?? 0) * Math.PI) / 180) * 24.0;

    const desiredPos = this._camDesiredPos;
    const desiredLook = this._camDesiredLook;

    if (this.replayActive) {
      desiredPos.copy(anchorPos).addScaledVector(fwd, 9.5).addScaledVector(right, 6.2);
      desiredPos.y += 3.8;
      this.camera.position.lerp(desiredPos, Math.min(1, dt * 4));
      this.camera.lookAt(anchorPos.x, anchorPos.y + 0.65, anchorPos.z);
    } else if (mode === 'CHASE') {
      // Forza Horizon 4 wide-angle low planted chase camera framing (FOV 76–85°)
      const dist = 4.45 + speedNorm * 0.45 - seatFore * 2.5;
      const height = 1.56 + speedNorm * 0.11 + seatH * 1.8;
      desiredPos.copy(anchorPos).addScaledVector(fwd, -dist).addScaledVector(right, -p.steerInput * 0.55);
      desiredPos.y += height;

      desiredLook.copy(anchorPos).addScaledVector(fwd, 14.5).addScaledVector(right, -p.steerInput * 1.1);
      desiredLook.y += 0.88 + pitchOff * 0.4;

      if (!this.cameraInitialized) {
        this.camPosSmooth.copy(desiredPos);
        this.camLookSmooth.copy(desiredLook);
        this.cameraInitialized = true;
      } else {
        this.camPosSmooth.lerp(desiredPos, Math.min(1, dt * 12));
        this.camLookSmooth.lerp(desiredLook, Math.min(1, dt * 15));
      }
      this.camera.position.copy(this.camPosSmooth);
      this.camera.lookAt(this.camLookSmooth);
    } else if (mode === 'T-CAM') {
      desiredPos.copy(anchorPos).addScaledVector(fwd, -0.35 + seatFore);
      desiredPos.y += 1.36 + seatH;
      desiredLook.copy(anchorPos).addScaledVector(fwd, 28.0).addScaledVector(right, -p.steerInput * 0.9);
      desiredLook.y += 0.48 + pitchOff;
      this.camera.position.copy(desiredPos);
      this.camera.lookAt(desiredLook);
    } else if (mode === 'COCKPIT') {
      desiredPos.copy(anchorPos).addScaledVector(fwd, 0.18 + seatFore);
      desiredPos.y += 0.84 + seatH;
      desiredLook.copy(anchorPos).addScaledVector(fwd, 24.0).addScaledVector(right, -p.steerInput * 0.55);
      desiredLook.y += 0.36 + pitchOff;
      this.camera.position.copy(desiredPos);
      this.camera.lookAt(desiredLook);
    } else {
      desiredPos.copy(anchorPos).addScaledVector(fwd, 1.85 + seatFore);
      desiredPos.y += 0.50 + seatH;
      desiredLook.copy(anchorPos).addScaledVector(fwd, 32.0);
      desiredLook.y += 0.35 + pitchOff;
      this.camera.position.copy(desiredPos);
      this.camera.lookAt(desiredLook);
    }

    const shakeScale = (this.settings.cameraShakeIntensity ?? 100) / 100;
    const shake = (this.impactShake * 0.08 + ((p.onCurb || p.offTrack) && Math.abs(p.speed) > 20 ? (p.offTrack ? 0.028 : 0.014) : 0)) * shakeScale;
    if (shake > 0.002 && !this.replayActive) {
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }
    this.impactShake = Math.max(0, this.impactShake - dt * 3.5);

    if (this.track?.dirLight) {
      const sunOff = this.track.config.sunPos;
      this.track.dirLight.position.set(
        p.pos.x + sunOff[0] * 0.45,
        p.pos.y + Math.max(32, sunOff[1] * 0.45),
        p.pos.z + sunOff[2] * 0.45
      );
      this.track.dirLight.target.position.copy(p.pos);
      this.track.dirLight.updateMatrixWorld();
      this.track.dirLight.target.updateMatrixWorld();

      if (this.track.heroShadowLight) {
        const snapX = Math.round((anchorPos.x + fwd.x * 4.0) * 8) / 8;
        const snapZ = Math.round((anchorPos.z + fwd.z * 4.0) * 8) / 8;
        this.track.heroShadowLight.position.set(
          snapX + sunOff[0] * 0.35,
          anchorPos.y + Math.max(28, sunOff[1] * 0.35),
          snapZ + sunOff[2] * 0.35
        );
        this.track.heroShadowLight.target.position.set(snapX, anchorPos.y, snapZ);
        this.track.heroShadowLight.updateMatrixWorld();
        this.track.heroShadowLight.target.updateMatrixWorld();
      }
    }

    // Project Sun Position into Screen Space for Subtle Optical Lens Flare & Crepuscular Rays
    let sunU = 0.5;
    let sunV = 0.75;
    let sunVis = 0.0;
    const isNight = this.track?.config.theme === 'city';
    if (!isNight && this.track?.skyUniforms?.uSunDir) {
      this.camera.updateMatrixWorld();
      const sunWorld = desiredLook
        .copy(this.track.skyUniforms.uSunDir.value as THREE.Vector3)
        .multiplyScalar(900)
        .add(this.camera.position);
      sunWorld.project(this.camera);
      if (sunWorld.z < 1.0) {
        sunU = sunWorld.x * 0.5 + 0.5;
        sunV = sunWorld.y * 0.5 + 0.5;
        const offEdge = Math.max(Math.abs(sunWorld.x), Math.abs(sunWorld.y));
        const weatherFade = this.track.trackWetness > 0.4 ? 0.25 : 1.0;
        sunVis = THREE.MathUtils.clamp((1.35 - offEdge) / 0.65, 0, 1) * weatherFade;
      }
    }

    this.post.updateDynamic(
      speedNorm,
      this.impactShake,
      isNight,
      (this.settings.bloomIntensity ?? 115) / 100,
      (this.settings.vignetteIntensity ?? 35) / 35,
      sunU,
      sunV,
      sunVis
    );
  }

  private _updateAdaptiveGovernor(dt: number): void {
    if (!this.settings.adaptiveFpsGovernor) return;
    this.dprCheckTimer += dt;
    if (this.dprCheckTimer < 2.5) return;
    this.dprCheckTimer = 0;

    const maxDpr = Math.min(window.devicePixelRatio || 1, QUALITY_CONFIG[this.settings.quality].maxDpr);
    if (this.fpsSmooth < 48 && this.currentDpr > 0.85) {
      this.currentDpr = Math.max(0.85, this.currentDpr - 0.15);
      this.renderer.setPixelRatio(this.currentDpr);
    } else if (this.fpsSmooth > 57 && this.currentDpr < maxDpr) {
      this.currentDpr = Math.min(maxDpr, this.currentDpr + 0.10);
      this.renderer.setPixelRatio(this.currentDpr);
    }
  }

  private _loop(now: number): void {
    requestAnimationFrame((t) => this._loop(t));

    const rawDt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    this.fpsSmooth += (1 / rawDt - this.fpsSmooth) * 0.08;

    document.getElementById('gamepad-pill')?.classList.toggle('hidden', !this.input.gamepadConnected);

    const bloomMult = (this.settings.bloomIntensity ?? 115) / 100;
    const vigMult = (this.settings.vignetteIntensity ?? 35) / 35;

    if (this.mode === 'MENU') {
      this.showroom.update(rawDt, now);
      this.post.updateDynamic(0, 0, true, bloomMult, vigMult, 0.5, 0.75, 0.0);
      this.post.render(rawDt);
      return;
    }

    if (!this.paused && this.player && this.track) {
      // Animate TV Broadcast Helicopter circling overhead (Item 34)
      const heliAngle = now * 0.00025;
      this.track.helicopterGroup.position.set(
        Math.cos(heliAngle) * 185,
        74 + Math.sin(now * 0.001) * 3,
        Math.sin(heliAngle) * 185
      );
      this.track.helicopterGroup.rotation.y = -heliAngle;
      const rotor = this.track.helicopterGroup.getObjectByName('heliRotor');
      if (rotor) rotor.rotation.y += rawDt * 28;

      // Animate Sculpted 3D GT Safety Car + Flashing Roof Strobe Bar (Item 68)
      const sc = this.track.safetyCarGroup;
      const scBar = sc.getObjectByName('scLightbar') as THREE.Mesh | undefined;
      if (this.raceFlag === 'YELLOW' || this.raceFlag === 'VSC') {
        sc.visible = true;
        if (scBar) {
          const mat = scBar.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 1.8 + Math.abs(Math.sin(now * 0.022)) * 3.8;
        }
        const sortedForSc = this._getSortedStandings();
        const leader = sortedForSc[0] || this.player;
        const scIdx = (leader.splineIndex + 5) % this.track.N;
        const scSample = this.track.samples[scIdx];
        sc.position.set(scSample.pos.x, scSample.asphaltY, scSample.pos.z);
        sc.rotation.y = Math.atan2(scSample.tangent.x, scSample.tangent.z);
      } else {
        // Parked visibly in Pit-Exit Marshal Standby Bay with gentle amber standby beacon!
        sc.visible = true;
        if (sc.userData.standbyPos) {
          sc.position.copy(sc.userData.standbyPos);
          sc.rotation.y = sc.userData.standbyYaw ?? 0;
        }
        if (scBar) {
          const mat = scBar.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 1.0 + Math.sin(now * 0.006) * 0.5;
        }
      }

      // Dynamic Time-of-Day Sun Progression in GLSL Atmospheric Sky Shader (Item 24)
      const todSpeed = this.settings.timeOfDaySpeed ?? 3;
      if (this.track.config.theme !== 'city' && this.raceActive && todSpeed > 0) {
        const baseSun = this.track.config.sunPos;
        const sunShift = Math.sin(this.raceClock * 0.004 * todSpeed) * 35;
        this.track.skyUniforms.uSunDir.value
          .set(baseSun[0] + sunShift, Math.max(22, baseSun[1] - this.raceClock * 0.04 * todSpeed), baseSun[2])
          .normalize();
      }

      if (this.replayActive && this.replayBuffer.length > 0) {
        this.replayCursor = (this.replayCursor + rawDt * 30) % this.replayBuffer.length;
        const frame = this.replayBuffer[Math.floor(this.replayCursor)];
        for (let i = 0; i < this.cars.length && i < frame.cars.length; i++) {
          const fc = frame.cars[i];
          const vis = this.carVisuals[i];
          vis.root.position.set(fc.x, fc.y, fc.z);
          vis.root.rotation.order = 'YXZ';
          vis.root.rotation.y = fc.yaw;
          vis.root.rotation.x = fc.pitch;
          if (this.cars[i].isPlayer) {
            this.player.pos.set(fc.x, fc.y, fc.z);
            this.player.yaw = fc.yaw;
          }
        }
        this._updateRaceCamera(rawDt);
      } else {
        this.accumulator += rawDt;
        const fixedDt = GAME_CONSTANTS.FIXED_DT; // 1/240 s (240Hz!)
        let steps = 0;
        while (this.accumulator >= fixedDt && steps < 12) {
          this._stepSimulation(fixedDt);
          this.accumulator -= fixedDt;
          steps++;
        }

        const alpha = THREE.MathUtils.clamp(this.accumulator / fixedDt, 0, 1);
        for (let i = 0; i < this.cars.length; i++) {
          const car = this.cars[i];
          const vis = this.carVisuals[i];
          vis.root.position.lerpVectors(car.prevPos, car.pos, alpha);
          vis.root.rotation.order = 'YXZ';
          vis.root.rotation.y = car.prevYaw + Math.atan2(Math.sin(car.yaw - car.prevYaw), Math.cos(car.yaw - car.prevYaw)) * alpha;
          vis.root.rotation.x = car.roadPitch;
          // Keep wheels flush on flat asphalt ribbon (subtle roll is handled on sprung bodyGroup!)
          vis.root.rotation.z = car.roadRoll * 0.10;
          updateCarVisuals(vis, car, rawDt, now);
        }

        this._updateGhostCar();
        const vfxWeather = this.track.trackWetness > 0.45 ? 'rain' : 'dry';
        this.vfx?.updateForCars(this.cars, this.track, vfxWeather, this.player.pos, rawDt);
        this.audio.update(this.player, this.cars);
        this._updateRaceCamera(rawDt);

        const sorted = this._getSortedStandings();
        this.hud.updateRaceHUD(
          this.player,
          sorted,
          this.track,
          this.raceFlag,
          this.isQualifyingSession,
          CAMERA_MODES[this.cameraModeIdx],
          this.fpsSmooth,
          now,
          this.settings
        );

        this._updateAdaptiveGovernor(rawDt);
      }
    }

    this.post.render(rawDt);
  }
}

declare global {
  interface Window {
    apexGP: ApexGPGame;
  }
}

window.apexGP = new ApexGPGame();
