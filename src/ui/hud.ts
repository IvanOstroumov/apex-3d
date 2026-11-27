/**
 * APEX GP 3D — AAA F1 Broadcast HUD, Bilingual IT/EN Controller,
 * Interactive F1 Wiki / Academy & Telemetry Trace Analyzer
 */
import * as THREE from 'three';
import type {
  CarState,
  DriverProfileStats,
  GameSettings,
  RaceFlag,
  SetupPresetId,
  TeamConfig,
  TelemetryTracePoint,
  TrackConfig,
  TrackData
} from '../core/types';
import { ERS_MODE_SPECS, TIRE_COMPOUNDS } from '../core/config';
import { TRANSLATIONS, getSavedLanguage, saveLanguage, type I18nStrings, type Language } from '../core/i18n';

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '--:--.---';
  const mins = Math.floor(sec / 60);
  const rem = sec - mins * 60;
  const whole = Math.floor(rem);
  const ms = Math.floor((rem - whole) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export class HUDController {
  public lang: Language = getSavedLanguage();
  private activeWikiCatIdx = 0;

  private menuOverlay = document.getElementById('menu-overlay')!;
  private hudOverlay = document.getElementById('hud-overlay')!;
  private pauseModal = document.getElementById('pause-modal')!;
  private finishModal = document.getElementById('finish-modal')!;
  private wikiModal = document.getElementById('wiki-modal')!;

  private teamListEl = document.getElementById('team-list')!;
  private trackListEl = document.getElementById('track-list')!;
  private previewCanvas = document.getElementById('track-preview-canvas') as HTMLCanvasElement;
  private previewCtx = this.previewCanvas.getContext('2d')!;

  private lbListEl = document.getElementById('leaderboard-list')!;
  private sessionTagEl = document.getElementById('hud-session-tag')!;
  private lapPillEl = document.getElementById('hud-lap-pill')!;
  private posEl = document.getElementById('hud-pos')!;
  private posTotalEl = document.getElementById('hud-pos-total')!;
  private lapTimeEl = document.getElementById('hud-lap-time')!;
  private bestTimeEl = document.getElementById('hud-best-time')!;
  private camModeEl = document.getElementById('hud-cam-mode')!;
  private ersModeEl = document.getElementById('hud-ers-mode')!;
  private speedEl = document.getElementById('hud-speed')!;
  private gearEl = document.getElementById('hud-gear')!;
  private throttleBarEl = document.getElementById('bar-throttle')!;
  private brakeBarEl = document.getElementById('bar-brake')!;
  private clutchBarEl = document.getElementById('bar-clutch') as HTMLElement | null;
  private arcadePillEl = document.getElementById('arcade-mode-pill') as HTMLElement | null;
  private rearviewCanvas = document.getElementById('rearview-canvas') as HTMLCanvasElement | null;
  private rearviewCtx = this.rearviewCanvas ? this.rearviewCanvas.getContext('2d') : null;
  private drsPctEl = document.getElementById('hud-drs-pct')!;
  private drsFillEl = document.getElementById('hud-drs-fill')!;
  private drsStatusEl = document.getElementById('hud-drs-status')!;
  private fpsEl = document.getElementById('hud-fps')!;
  private minimapTrackEl = document.getElementById('minimap-track-name')!;

  private secEls = [1, 2, 3].map((i) => document.getElementById(`sec-${i}`)!);
  private compBadgeEl = document.getElementById('hud-compound-badge')!;
  private tireWearFillEl = document.getElementById('hud-tire-wear-fill')!;
  private tireTempEl = document.getElementById('hud-tire-temp')!;
  private fuelEl = document.getElementById('hud-fuel')!;
  private trackTempEl = document.getElementById('hud-track-temp')!;
  private penaltyEl = document.getElementById('hud-penalty')!;
  private wingWarnEl = document.getElementById('hud-wing-warn')!;
  private fiaFlagEl = document.getElementById('fia-flag-pill')!;

  private startLightsEl = document.getElementById('start-lights')!;
  private lightPods = [1, 2, 3, 4, 5].map((i) => document.getElementById(`light-${i}`)!);
  private bannerEl = document.getElementById('race-banner')!;
  private radioToastEl = document.getElementById('radio-toast')!;
  private radioMsgEl = document.getElementById('radio-msg')!;
  private wrongWayEl = document.getElementById('wrong-way-banner')!;
  private badgeSlipEl = document.getElementById('badge-slipstream')!;
  private badgeDirtyEl = document.getElementById('badge-dirtyair')!;
  private badgeDrsEl = document.getElementById('badge-drs')!;
  private badgePitEl = document.getElementById('badge-pit')!;
  private badgeMarblesEl = document.getElementById('badge-marbles')!;
  private badgeOffEl = document.getElementById('badge-offtrack')!;
  private badgeReplayEl = document.getElementById('badge-replay')!;

  private radarCanvas = document.getElementById('radar-canvas') as HTMLCanvasElement;
  private radarCtx = this.radarCanvas.getContext('2d')!;
  private minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  private minimapCtx = this.minimapCanvas.getContext('2d')!;
  private minimapBounds: { minX: number; minZ: number; scale: number; ox: number; oz: number; startPos: THREE.Vector3 } | null = null;
  private minimapTrackPts: THREE.Vector3[] = [];

  private speedoCanvas = document.getElementById('speedo-dial-canvas') as HTMLCanvasElement | null;
  private speedoCtx = this.speedoCanvas ? this.speedoCanvas.getContext('2d') : null;

  private traceCanvas = document.getElementById('telemetry-trace-canvas') as HTMLCanvasElement;
  private traceCtx = this.traceCanvas.getContext('2d')!;

  private rpmLeds: HTMLDivElement[] = [];
  private bannerTimeout: number | null = null;
  private radioTimeout: number | null = null;
  private lastLbUpdate = 0;

  public garageCategory: 'f1' | 'supercar' = 'f1';
  private cachedTeams: TeamConfig[] = [];
  private cachedTracks: TrackConfig[] = [];
  private cachedTeamIdx = 0;
  private cachedTrackIdx = 0;
  private cachedOnSelectTeam: ((idx: number) => void) | null = null;
  private cachedOnSelectTrack: ((idx: number) => void) | null = null;
  private cachedDriverStats: DriverProfileStats | null = null;

  constructor() {
    const rpmWrap = document.getElementById('rpm-leds')!;
    rpmWrap.innerHTML = '';
    for (let i = 0; i < 15; i++) {
      const d = document.createElement('div');
      d.className = 'rpm-led';
      rpmWrap.appendChild(d);
      this.rpmLeds.push(d);
    }
  }

  public t(): I18nStrings {
    return TRANSLATIONS[this.lang];
  }

  public toggleLanguage(isMuted = false, currentMode = 'quick_race'): Language {
    this.lang = this.lang === 'it' ? 'en' : 'it';
    saveLanguage(this.lang);
    this.applyLanguage(isMuted, currentMode);
    return this.lang;
  }

  public applyLanguage(isMuted = false, currentMode = 'quick_race'): void {
    const tr = this.t();
    document.documentElement.lang = this.lang;

    const setText = (id: string, val: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    // Header & Navigation Dock Buttons
    setText('btn-lang-toggle', tr.langToggleBtn);
    setText('btn-wiki-lang', tr.langToggleBtn);
    setText('ui-nav-play', tr.navPlay);
    setText('ui-nav-garage', tr.navGarage);
    setText('ui-nav-wiki', tr.navWiki);
    setText('ui-nav-settings', tr.navSettings);
    setText('btn-map-vector', tr.mapViewVector);
    setText('btn-map-satellite', tr.mapViewSatellite);
    setText('btn-open-wiki-pause', tr.wikiBtnPause);
    setText('ui-subtitle', tr.subtitle);
    setText('ui-zoom-hint', tr.zoomHint);
    setText('btn-mute-menu', isMuted ? tr.audioOff : tr.audioOn);

    // Left Panel
    setText('ui-panel1-title', tr.panel1Title);
    setText('ui-stat-speed', tr.statSpeed);
    setText('ui-stat-accel', tr.statAccel);
    setText('ui-stat-grip', tr.statGrip);
    setText('ui-stat-aero', tr.statAero);
    setText('ui-compound-label', tr.compoundLabel);
    setText('ui-slider-wing', tr.sliderWing);
    setText('ui-slider-brakes', tr.sliderBrakes);
    setText('ui-slider-susp', tr.sliderSusp);
    setText('ui-assist-line', tr.assistLine);
    setText('ui-assist-manual', tr.assistManual);

    const optSetup = document.getElementById('opt-setup') as HTMLSelectElement | null;
    if (optSetup) {
      Array.from(optSetup.options).forEach((opt) => {
        const key = opt.value as SetupPresetId;
        if (tr.setupPresets[key]) opt.textContent = tr.setupPresets[key];
      });
    }

    // Right Panel
    setText('ui-panel2-title', tr.panel2Title);
    const modeMap: Record<string, string> = {
      quick_race: tr.modeQuickRace,
      weekend: tr.modeWeekend,
      championship: tr.modeChamp,
      time_attack: tr.modeTimeAttack
    };
    document.querySelectorAll('#mode-tabs .mode-btn').forEach((btn) => {
      const m = (btn as HTMLElement).dataset.mode || '';
      if (modeMap[m]) btn.textContent = modeMap[m];
    });

    setText('ui-meta-env', tr.metaEnv);
    setText('ui-meta-session', tr.metaSession);
    setText('ui-meta-layout', tr.metaLayout);
    setText('ui-meta-rev', tr.metaReverse);
    setText('ui-launch-btn', tr.launchBtn);

    const setSelectOpts = (id: string, map: Record<string, string>) => {
      const sel = document.getElementById(id) as HTMLSelectElement | null;
      if (!sel) return;
      Array.from(sel.options).forEach((opt) => {
        if (map[opt.value]) opt.textContent = map[opt.value];
      });
    };

    setSelectOpts('opt-weather', {
      dry: tr.weatherDry,
      overcast: tr.weatherOvercast,
      rain: tr.weatherRain,
      dynamic: tr.weatherDynamic
    });
    setSelectOpts('opt-difficulty', {
      rookie: tr.diffRookie,
      pro: tr.diffPro,
      ace: tr.diffAce,
      legend: tr.diffLegend
    });
    setSelectOpts('opt-quality', {
      low: tr.qualLow,
      medium: tr.qualMed,
      high: tr.qualHigh,
      ultra: tr.qualUltra
    });

    // HUD Static Labels
    setText('ui-radio-title', tr.radioTitle);
    setText('wrong-way-banner', tr.wrongWayBanner);
    setText('badge-slipstream', tr.badgeSlipstream);
    setText('badge-dirtyair', tr.badgeDirtyAir);
    setText('badge-drs', tr.badgeDrsOpen);
    setText('badge-pit', tr.badgePitAvail);
    setText('badge-marbles', tr.badgeMarbles);
    setText('badge-offtrack', tr.badgeTrackLimits);
    setText('badge-replay', tr.badgeReplay);
    setText('ui-time-lap', tr.timeLap);
    setText('ui-time-best', tr.timeBest);
    setText('ui-track-temp-lbl', tr.trackTempLabel);

    // Pause Modal
    setText('ui-pause-title', tr.pauseTitle);
    setText('ui-pause-sub', tr.pauseSub);
    setText('btn-resume', tr.pauseResume);
    setText('btn-open-settings-pause', tr.pauseSettings);
    setText('btn-restart', tr.pauseRestart);
    setText('btn-back-menu', tr.pauseBackMenu);

    // Finish Modal
    setText('ui-tel-head', tr.finishTelemetryHead);
    setText('btn-finish-replay', tr.finishReplayRace);
    setText('btn-finish-menu', tr.finishBackShowroom);

    // Pro Settings Modal
    setText('ui-set-eyebrow', tr.setEyebrow);
    setText('ui-set-title', tr.setTitle);
    setText('btn-close-settings-top', tr.setCloseTop);
    setText('ui-set-tab1', tr.setTab1);
    setText('ui-set-tab2', tr.setTab2);
    setText('ui-set-tab3', tr.setTab3);
    setText('ui-set-tab4', tr.setTab4);
    setText('ui-set-tab5', tr.setTab5);
    setText('ui-set-res', tr.setRes);
    setText('ui-set-shadows', tr.setShadows);
    setSelectOpts('set-shadows', {
      off: tr.setShadowOff,
      '1024': tr.setShadowMed,
      '2048': tr.setShadowHigh,
      '4096': tr.setShadowUltra
    });
    setText('ui-set-env', tr.setEnv);
    setText('ui-set-bloom', tr.setBloom);
    setText('ui-set-exp', tr.setExp);
    setText('ui-set-vig', tr.setVig);
    setText('ui-set-smaa', tr.setSmaa);
    setText('ui-set-gov', tr.setGov);
    setText('ui-set-fov', tr.setFov);
    setText('ui-set-speedfov', tr.setSpeedFov);
    setText('ui-set-seath', tr.setSeatH);
    setText('ui-set-seatfore', tr.setSeatFore);
    setText('ui-set-pitch', tr.setPitch);
    setText('ui-set-shake', tr.setShake);
    setText('ui-set-roll', tr.setRoll);
    setText('ui-set-haloradar', tr.setHaloRadar);
    setText('ui-set-nohalo', tr.setNoHalo);
    setText('ui-set-radar360', tr.setRadar360);
    setText('ui-set-fwing', tr.setFWing);
    setText('ui-set-rwing', tr.setRWing);
    setText('ui-set-bbias', tr.setBBias);
    setText('ui-set-bpress', tr.setBPress);
    setText('ui-set-diffon', tr.setDiffOn);
    setText('ui-set-diffoff', tr.setDiffOff);
    setText('ui-set-susp', tr.setSusp);
    setText('ui-set-ridepsi', tr.setRidePsi);
    setText('ui-set-sens', tr.setSens);
    setText('ui-set-lin', tr.setLin);
    setText('ui-set-dz', tr.setDz);
    setText('ui-set-ffb', tr.setFfb);
    setText('ui-set-bassist', tr.setBAssist);
    setSelectOpts('set-bassist', {
      off: tr.setBAssistOff,
      low: tr.setBAssistLow,
      high: tr.setBAssistHigh
    });
    setText('ui-set-tclbl', tr.setTcLabel);
    setText('ui-set-absgear', tr.setAbsGearbox);
    setText('ui-set-mangear', tr.setManualGear);
    setText('ui-set-line3d', tr.setLine3D);
    setText('ui-set-vol', tr.setVol);
    setText('ui-set-ailevel', tr.setAiLevel);
    setText('ui-set-aiagg', tr.setAiAgg);
    setText('ui-set-dmg', tr.setDmg);
    setText('ui-set-wear', tr.setWear);
    setText('ui-set-fuel', tr.setFuel);
    setText('ui-set-limits', tr.setLimits);
    setSelectOpts('set-limits', {
      off: tr.setLimitsOff,
      standard: tr.setLimitsStd,
      strict: tr.setLimitsStrict
    });
    setText('ui-set-tod', tr.setTod);
    setText('btn-reset-settings', tr.setResetBtn);
    setText('btn-close-settings', tr.setApplyBtn);

    // Wiki Modal
    setText('ui-wiki-eyebrow', tr.wikiEyebrow);
    setText('ui-wiki-title', tr.wikiTitle);
    setText('ui-wiki-sub', tr.wikiSub);
    setText('btn-close-wiki-top', tr.wikiCloseBtn);
    this.renderWikiModal(this.activeWikiCatIdx);

    if (this.cachedDriverStats) {
      this.updateLicenseUI(this.cachedDriverStats);
    }
    if (this.cachedTeams.length && this.cachedTracks.length && this.cachedOnSelectTeam && this.cachedOnSelectTrack) {
      this.initMenu(
        this.cachedTeams,
        this.cachedTracks,
        this.cachedTeamIdx,
        this.cachedTrackIdx,
        this.cachedOnSelectTeam,
        this.cachedOnSelectTrack
      );
      const lapsEl = document.getElementById('meta-laps');
      if (lapsEl) {
        const trackLaps = this.cachedTracks[this.cachedTrackIdx].laps;
        lapsEl.textContent = currentMode === 'weekend'
          ? tr.lapsWeekend
          : currentMode === 'time_attack'
          ? tr.lapsFree
          : `${trackLaps} ${tr.lapsUnit}`;
      }
    }
  }

  public renderWikiModal(catIdx = 0): void {
    const tr = this.t();
    const cats = tr.wikiCategories;
    this.activeWikiCatIdx = Math.max(0, Math.min(cats.length - 1, catIdx));

    const tabsEl = document.getElementById('wiki-tabs');
    const gridEl = document.getElementById('wiki-content-grid');
    if (!tabsEl || !gridEl) return;

    tabsEl.innerHTML = '';
    cats.forEach((cat, idx) => {
      const btn = document.createElement('button');
      btn.className = 'wiki-tab-btn' + (idx === this.activeWikiCatIdx ? ' active' : '');
      btn.textContent = cat.tabLabel;
      btn.addEventListener('click', () => this.renderWikiModal(idx));
      tabsEl.appendChild(btn);
    });

    const activeCat = cats[this.activeWikiCatIdx];
    gridEl.innerHTML = activeCat.articles
      .map(
        (art) => `
        <article class="wiki-card">
          <span class="wiki-card-badge" style="color:${art.badgeColor}">${art.badge}</span>
          <h3>${art.title}</h3>
          <div class="wiki-card-sub">${art.subtitle}</div>
          ${art.svgDiagram ? art.svgDiagram : ''}
          <div class="wiki-card-body">${art.body}</div>
          <div class="wiki-pro-tip">💡 <strong>PRO TIP:</strong> ${art.proTip}</div>
        </article>
      `
      )
      .join('');
    gridEl.scrollTop = 0;
  }

  public openWikiModal(open = true): void {
    if (!this.wikiModal) return;
    if (open) this.renderWikiModal(this.activeWikiCatIdx);
    this.wikiModal.classList.toggle('hidden', !open);
  }

  updateLicenseUI(stats: DriverProfileStats): void {
    this.cachedDriverStats = stats;
    const el = document.getElementById('license-pill');
    if (!el) return;
    const tr = this.t();
    const grade = stats.safetyRating >= 90 ? 'S' : stats.safetyRating >= 78 ? 'A' : stats.safetyRating >= 65 ? 'B' : 'C';
    el.textContent = `${tr.licensePrefix} ${grade} (${Math.round(stats.safetyRating)}%) • ${Math.round(stats.skillRating)} SR • ${stats.wins}🏆`;
  }

  public setGarageCategory(cat: 'f1' | 'supercar'): void {
    this.garageCategory = cat;
    this._renderTeamCards();
  }

  private _renderTeamCards(): void {
    if (!this.cachedTeams.length || !this.cachedOnSelectTeam) return;
    const tr = this.t();
    this.teamListEl.innerHTML = '';
    this.cachedTeams.forEach((team, idx) => {
      const isSupercar = Boolean(team.vehicleCategory && team.vehicleCategory !== 'f1');
      if (this.garageCategory === 'f1' && isSupercar) return;
      if (this.garageCategory === 'supercar' && !isSupercar) return;

      const tagline = tr.teamTaglines[team.id] || team.tagline;
      const card = document.createElement('div');
      card.className = 'team-card' + (idx === this.cachedTeamIdx ? ' active' : '');
      card.dataset.teamIdx = String(idx);
      card.style.setProperty('--team-color', team.secondaryColor === '#111111' ? team.primaryColor : team.secondaryColor);
      card.innerHTML = `
        <div class="team-swatch" style="background: linear-gradient(180deg, ${team.primaryColor}, ${team.secondaryColor})"></div>
        <div class="team-info">
          <strong>${team.name}</strong>
          <small>${tagline}</small>
        </div>
        <span class="team-num">#${team.number}</span>
      `;
      card.addEventListener('click', () => this.cachedOnSelectTeam?.(idx));
      this.teamListEl.appendChild(card);
    });
  }

  initMenu(
    teams: TeamConfig[],
    tracks: TrackConfig[],
    selectedTeamIdx: number,
    selectedTrackIdx: number,
    onSelectTeam: (idx: number) => void,
    onSelectTrack: (idx: number) => void
  ): void {
    this.cachedTeams = teams;
    this.cachedTracks = tracks;
    this.cachedTeamIdx = selectedTeamIdx;
    this.cachedTrackIdx = selectedTrackIdx;
    this.cachedOnSelectTeam = onSelectTeam;
    this.cachedOnSelectTrack = onSelectTrack;

    const tr = this.t();
    this._renderTeamCards();

    this.trackListEl.innerHTML = '';
    tracks.forEach((track, idx) => {
      const badge = tr.trackBadges[track.id] || track.badge;
      const desc = tr.trackDescs[track.id] || track.description;
      const card = document.createElement('div');
      card.className = 'track-card' + (idx === selectedTrackIdx ? ' active' : '');
      card.innerHTML = `
        <div class="track-card-top">
          <strong>${track.name}</strong>
          <span class="track-badge">${badge}</span>
        </div>
        <small>${desc}</small>
      `;
      card.addEventListener('click', () => onSelectTrack(idx));
      this.trackListEl.appendChild(card);
    });

    this.updateSelectedTeamUI(teams[selectedTeamIdx], selectedTeamIdx);
    this.updateSelectedTrackUI(tracks[selectedTrackIdx], selectedTrackIdx);
  }

  updateSelectedTeamUI(team: TeamConfig, activeIdx: number): void {
    this.cachedTeamIdx = activeIdx;
    const tr = this.t();
    Array.from(this.teamListEl.children).forEach((el) => {
      const idxAttr = Number((el as HTMLElement).dataset.teamIdx);
      el.classList.toggle('active', idxAttr === activeIdx);
    });
    document.getElementById('spec-number')!.textContent = `#${team.number}`;
    document.getElementById('spec-team-name')!.textContent = team.name;
    document.getElementById('spec-tagline')!.textContent = tr.teamTaglines[team.id] || team.tagline;
    document.getElementById('val-speed')!.textContent = String(team.uiStats.speed);
    document.getElementById('val-accel')!.textContent = String(team.uiStats.accel);
    document.getElementById('val-grip')!.textContent = String(team.uiStats.grip);
    document.getElementById('val-boost')!.textContent = String(team.uiStats.aero);
    (document.getElementById('bar-speed') as HTMLElement).style.width = `${team.uiStats.speed}%`;
    (document.getElementById('bar-accel') as HTMLElement).style.width = `${team.uiStats.accel}%`;
    (document.getElementById('bar-grip') as HTMLElement).style.width = `${team.uiStats.grip}%`;
    (document.getElementById('bar-boost') as HTMLElement).style.width = `${team.uiStats.aero}%`;
  }

  public mapPreviewMode: 'vector' | 'satellite' = 'vector';

  public setMapPreviewMode(mode: 'vector' | 'satellite'): void {
    this.mapPreviewMode = mode;
    document.getElementById('btn-map-vector')?.classList.toggle('active', mode === 'vector');
    document.getElementById('btn-map-satellite')?.classList.toggle('active', mode === 'satellite');
    if (this.cachedTracks.length) {
      this.updateSelectedTrackUI(this.cachedTracks[this.cachedTrackIdx], this.cachedTrackIdx);
    }
  }

  updateSelectedTrackUI(trackCfg: TrackConfig, activeIdx: number): void {
    this.cachedTrackIdx = activeIdx;
    const tr = this.t();
    Array.from(this.trackListEl.children).forEach((el, i) => el.classList.toggle('active', i === activeIdx));
    document.getElementById('meta-env')!.textContent = tr.trackEnvs[trackCfg.id] || trackCfg.environment;
    document.getElementById('meta-laps')!.textContent = `${trackCfg.laps} ${tr.lapsUnit}`;

    const satImg = document.getElementById('track-satellite-img') as HTMLImageElement | null;
    const pipImg = document.getElementById('track-satellite-pip') as HTMLImageElement | null;
    const isMonza = trackCfg.id === 'monza';

    if (satImg && pipImg) {
      if (isMonza) {
        pipImg.classList.remove('hidden');
        if (this.mapPreviewMode === 'satellite') {
          satImg.src = '/assets/monza_satellite.jpg';
          satImg.classList.remove('hidden');
          this.previewCanvas.classList.add('hidden');
          pipImg.src = '/assets/monza_map_diagram.jpg';
        } else {
          satImg.classList.add('hidden');
          this.previewCanvas.classList.remove('hidden');
          pipImg.src = '/assets/monza_satellite.jpg';
        }
      } else {
        satImg.classList.add('hidden');
        this.previewCanvas.classList.remove('hidden');
        pipImg.classList.add('hidden');
      }
    }

    const ctrl = trackCfg.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal', 0.5);
    const pts = curve.getSpacedPoints(180);
    this._drawSpline2D(
      this.previewCtx,
      this.previewCanvas.width,
      this.previewCanvas.height,
      pts,
      16,
      trackCfg.theme === 'city' ? '#00f0ff' : '#ff2e24',
      trackCfg.theme,
      this.mapPreviewMode === 'satellite' && !isMonza
    );
  }

  private _drawSpline2D(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    pts: THREE.Vector3[],
    pad: number,
    strokeColor: string,
    theme = 'monza',
    satelliteBg = false
  ) {
    ctx.clearRect(0, 0, w, h);
    if (satelliteBg) {
      const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, 10, w * 0.5, h * 0.5, w * 0.65);
      if (theme === 'desert') {
        grad.addColorStop(0, '#7c5333');
        grad.addColorStop(1, '#3d2514');
      } else if (theme === 'alpine') {
        grad.addColorStop(0, '#2a4a34');
        grad.addColorStop(1, '#14261a');
      } else if (theme === 'city') {
        grad.addColorStop(0, '#101c30');
        grad.addColorStop(1, '#060b14');
      } else {
        grad.addColorStop(0, '#1f4424');
        grad.addColorStop(1, '#0e2412');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
    const ox = (w - spanX * scale) * 0.5;
    const oz = (h - spanZ * scale) * 0.5;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = ox + (p.x - minX) * scale;
      const y = oz + (p.z - minZ) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = satelliteBg ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3.4;
    ctx.stroke();

    // Start/Finish marker dot
    if (pts.length > 0) {
      const sx = ox + (pts[0].x - minX) * scale;
      const sy = oz + (pts[0].z - minZ) * scale;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  prepareRaceMinimap(track: TrackData, totalCars: number, sessionName = 'APEX GP'): void {
    this.minimapTrackEl.textContent = track.config.shortName;
    this.sessionTagEl.textContent = sessionName;
    this.posTotalEl.textContent = `/${totalCars}`;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < track.N; i += 4) pts.push(track.samples[i].pos);
    this.minimapTrackPts = pts;

    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const pad = 22;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
    this.minimapBounds = {
      minX, minZ, scale,
      ox: (w - spanX * scale) * 0.5,
      oz: (h - spanZ * scale) * 0.5,
      startPos: track.samples[track.startIndex].pos
    };
  }

  showMenu(): void {
    this.menuOverlay.classList.remove('hidden');
    this.hudOverlay.classList.add('hidden');
    this.pauseModal.classList.add('hidden');
    this.finishModal.classList.add('hidden');
    this.wikiModal?.classList.add('hidden');
  }

  showRaceHUD(): void {
    this.menuOverlay.classList.add('hidden');
    this.hudOverlay.classList.remove('hidden');
    this.pauseModal.classList.add('hidden');
    this.finishModal.classList.add('hidden');
    this.wikiModal?.classList.add('hidden');
  }

  setPaused(paused: boolean): void {
    this.pauseModal.classList.toggle('hidden', !paused);
  }

  setReplayBadge(active: boolean): void {
    this.badgeReplayEl.classList.toggle('hidden', !active);
  }

  setStartLights(state: number | 'GO' | 'HIDE', gantryLights: THREE.MeshStandardMaterial[] = []): void {
    if (state === 'HIDE') {
      this.startLightsEl.classList.add('hidden');
      return;
    }
    this.startLightsEl.classList.remove('hidden');

    this.lightPods.forEach((pod, idx) => {
      pod.classList.remove('on', 'go');
      const bulbMat = gantryLights[idx];
      if (state === 'GO') {
        pod.classList.add('go');
        if (bulbMat) { bulbMat.emissive.setHex(0x00ff55); bulbMat.emissiveIntensity = 3.2; }
      } else if (typeof state === 'number' && idx < state) {
        pod.classList.add('on');
        if (bulbMat) { bulbMat.emissive.setHex(0xff0000); bulbMat.emissiveIntensity = 3.4; }
      } else if (bulbMat) {
        bulbMat.emissiveIntensity = 0;
      }
    });
  }

  showBanner(text: string, durationMs = 2000): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove('hidden');
    if (this.bannerTimeout) window.clearTimeout(this.bannerTimeout);
    this.bannerTimeout = window.setTimeout(() => this.bannerEl.classList.add('hidden'), durationMs);
  }

  showRadio(message: string, durationMs = 3500): void {
    this.radioMsgEl.textContent = message;
    this.radioToastEl.classList.remove('hidden');
    if (this.radioTimeout) window.clearTimeout(this.radioTimeout);
    this.radioTimeout = window.setTimeout(() => this.radioToastEl.classList.add('hidden'), durationMs);
  }

  updateRaceHUD(
    player: CarState,
    sortedCars: CarState[],
    track: TrackData,
    raceFlag: RaceFlag,
    isQualifying: boolean,
    camMode: string,
    fps: number,
    nowMs: number,
    settings: GameSettings,
    arcadeStatusText = ''
  ): void {
    const tr = this.t();
    const kmh = Math.max(0, Math.round(Math.abs(player.speed) * 3.6));
    this.speedEl.textContent = String(kmh);
    this.gearEl.textContent = player.gear === -1 ? 'R' : player.gear === 0 ? 'N' : String(player.gear);

    this.throttleBarEl.style.height = `${Math.round(player.throttleInput * 100)}%`;
    this.brakeBarEl.style.height = `${Math.round(player.brakeInput * 100)}%`;
    if (this.clutchBarEl) {
      this.clutchBarEl.style.height = `${Math.round((player.clutchInput || 0) * 100)}%`;
    }

    if (this.arcadePillEl) {
      if (arcadeStatusText) {
        this.arcadePillEl.textContent = arcadeStatusText;
        this.arcadePillEl.classList.remove('hidden');
      } else {
        this.arcadePillEl.classList.add('hidden');
      }
    }

    const maxRpm = player.team.physics.maxRpm || 15000;
    const minLedRpm = maxRpm * 0.36;
    const rpmFrac = THREE.MathUtils.clamp((player.rpm - minLedRpm) / Math.max(1000, maxRpm - minLedRpm), 0, 1);
    const litLeds = Math.round(rpmFrac * 15);
    const redlineFlash = rpmFrac > 0.94 && Math.floor(nowMs / 65) % 2 === 0;
    for (let i = 0; i < 15; i++) {
      const led = this.rpmLeds[i];
      led.className = 'rpm-led';
      if (i < litLeds && !redlineFlash) {
        if (i < 5) led.classList.add('lit-green');
        else if (i < 10) led.classList.add('lit-red');
        else led.classList.add('lit-blue');
      }
    }

    const ersPct = Math.round(player.ersEnergy);
    const ersSpec = ERS_MODE_SPECS[player.ersMode];
    const ersLabel = tr.ersModes[player.ersMode] || ersSpec.label;
    this.ersModeEl.textContent = ersLabel.slice(0, 4);
    this.ersModeEl.style.color = ersSpec.color;
    this.drsPctEl.textContent = `${ersPct}%`;
    this.drsFillEl.style.width = `${ersPct}%`;
    this.drsFillEl.className = 'drs-fill' + (player.ersActive ? ' deploy' : player.ersHarvesting ? ' harvest' : '');

    if (player.drsActive) {
      this.drsStatusEl.textContent = tr.drsOpen;
      this.drsStatusEl.className = 'drs-pill active';
    } else if (player.drsAvailable) {
      this.drsStatusEl.textContent = tr.drsReady;
      this.drsStatusEl.className = 'drs-pill ready';
    } else {
      this.drsStatusEl.textContent = tr.drsClosed;
      this.drsStatusEl.className = 'drs-pill';
    }

    // FIA Flag Pill
    if (raceFlag === 'VSC') {
      this.fiaFlagEl.className = 'fia-flag vsc';
      this.fiaFlagEl.textContent = tr.flagVsc;
    } else if (raceFlag === 'YELLOW') {
      this.fiaFlagEl.className = 'fia-flag yellow';
      this.fiaFlagEl.textContent = tr.flagYellow;
    } else {
      this.fiaFlagEl.className = 'fia-flag green';
      this.fiaFlagEl.textContent = track.trackWetness > 0.45
        ? tr.flagWet(Math.round(track.trackWetness * 100))
        : tr.flagGreen;
    }

    // Position, Laps, Sectors & Multi-Layer Tire/Fuel Widget
    const playerPos = sortedCars.indexOf(player) + 1;
    this.posEl.textContent = String(playerPos);
    this.lapPillEl.textContent = isQualifying
      ? tr.qualifyingTag
      : settings.mode === 'time_attack' || settings.mode === 'track_day'
      ? `${tr.lapWord} ${player.lap}`
      : `${tr.lapWord} ${Math.min(player.lap, player.maxLaps)} / ${player.maxLaps}`;
    this.lapTimeEl.textContent = formatTime(player.currentLapTime);
    this.bestTimeEl.textContent = formatTime(player.bestLapTime);
    this.camModeEl.textContent = camMode;
    this.fpsEl.textContent = `${Math.round(fps)} FPS`;

    for (let s = 0; s < 3; s++) {
      const st = player.lastSectorStatus[s];
      this.secEls[s].className = 'sec-pill' + (st !== 'none' ? ` ${st}` : '');
    }

    const comp = TIRE_COMPOUNDS[player.compound];
    this.compBadgeEl.textContent = comp.short;
    this.compBadgeEl.style.color = comp.color;
    this.compBadgeEl.style.borderColor = comp.color;
    this.tireWearFillEl.style.width = `${Math.round(player.tireWear)}%`;
    this.tireWearFillEl.style.background = player.tireWear > 45 ? '#22e56b' : player.tireWear > 24 ? '#ffd200' : '#ff2424';
    this.tireTempEl.textContent = `S:${Math.round(player.tireSurfaceTemp)}°/C:${Math.round(player.tireCoreTemp)}°`;

    this.fuelEl.textContent = `${player.fuelKg.toFixed(1)}kg`;
    this.trackTempEl.textContent = `${Math.round(track.trackTempC)}°C`;
    if (player.timePenaltySec > 0) {
      this.penaltyEl.textContent = `+${player.timePenaltySec}s PEN`;
      this.penaltyEl.classList.remove('hidden');
    } else {
      this.penaltyEl.classList.add('hidden');
    }

    this.wingWarnEl.classList.toggle('hidden', player.wingDamage < 0.2 && !player.puncture);
    if (player.puncture) this.wingWarnEl.textContent = tr.wingWarnPuncture;
    else this.wingWarnEl.textContent = tr.wingWarnAero;

    this.wrongWayEl.classList.toggle('hidden', !player.wrongWay);
    this.badgeSlipEl.classList.toggle('hidden', player.slipstream < 0.25);
    this.badgeDirtyEl.classList.toggle('hidden', player.dirtyAir < 0.35);
    this.badgeDrsEl.classList.toggle('hidden', !player.drsActive);
    this.badgeMarblesEl.classList.toggle('hidden', player.marblePickup < 0.3);
    this.badgeOffEl.classList.toggle('hidden', !player.offTrack);
    this.badgePitEl.classList.toggle('hidden', !(player._tInfo.isPitZone && !player.inPit && (player.tireWear < 82 || player.wingDamage > 0.15 || player.puncture)));

    // 10-Car Leaderboard Tower (~8 Hz)
    if (nowMs - this.lastLbUpdate > 125) {
      this.lastLbUpdate = nowMs;
      const leaderDist = sortedCars[0].raceDistance;
      let html = '';
      sortedCars.forEach((c, idx) => {
        const gapMeters = Math.max(0, leaderDist - c.raceDistance);
        const gapSec = (gapMeters / Math.max(35, c.speed || 55)).toFixed(1);
        let gapLabel = idx === 0 ? 'LEAD' : c.inPit ? 'PIT' : c.finished ? 'FIN' : `+${gapSec}`;
        if (settings.mode === 'knockout' && c.eliminated) gapLabel = '💀 OUT';
        else if (settings.mode === 'cops_robbers') {
          gapLabel = c.copsRole === 'COP' ? '🚓 COP' : c.robberArrested ? '🚨 BUST' : `💰${Math.round(c.robberHealth ?? 100)}%`;
        } else if (settings.mode === 'infection') {
          gapLabel = c.infected ? '☣️ INF' : '🛡️ OK';
        }
        const squadPrefix = settings.mode === 'team_race' ? (c.teamSquad === 'RED' ? '🔴 ' : '🔵 ') : '';
        const barColor = settings.mode === 'team_race'
          ? (c.teamSquad === 'RED' ? '#ff2424' : '#0088ff')
          : settings.mode === 'infection' && c.infected
          ? '#39ff14'
          : c.team.id === 'monster' ? '#39ff14'
          : c.team.id === 'mercedes' ? '#00d2be'
          : c.team.primaryColor;
        const cSpec = TIRE_COMPOUNDS[c.compound];
        html += `
          <div class="lb-row ${c.isPlayer ? 'is-player' : ''}" style="${c.eliminated || c.robberArrested ? 'opacity:0.45' : ''}">
            <span class="lb-pos">${idx + 1}</span>
            <span class="lb-color" style="background:${barColor}"></span>
            <span class="lb-code">${squadPrefix}${c.code}</span>
            <span class="lb-comp" style="color:${cSpec.color}">${cSpec.short}</span>
            <span class="lb-gap">${gapLabel}</span>
          </div>
        `;
      });
      this.lbListEl.innerHTML = html;
    }

    this._renderProximityRadar(player, sortedCars);
    this._renderMinimap(sortedCars);
    this._renderCircularSpeedo(player);
    this._renderRearviewMirror(player, sortedCars, track, nowMs);
  }

  private _renderRearviewMirror(player: CarState, cars: CarState[], track: TrackData, nowMs: number): void {
    const ctx = this.rearviewCtx;
    const canvas = this.rearviewCanvas;
    if (!ctx || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.5;
    const horizonY = Math.round(h * 0.36);

    ctx.clearRect(0, 0, w, h);

    // 1. Sky & Horizon Gradient (reflects Track Theme / Wetness)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    if (track.config.theme === 'city') {
      skyGrad.addColorStop(0, '#050814');
      skyGrad.addColorStop(1, '#13223d');
    } else if (track.config.theme === 'desert') {
      skyGrad.addColorStop(0, '#4a2f22');
      skyGrad.addColorStop(1, '#c67d47');
    } else {
      skyGrad.addColorStop(0, '#1d3658');
      skyGrad.addColorStop(1, '#5882b4');
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizonY);

    // 2. Ground & Asphalt Road Perspective behind Player
    ctx.fillStyle = track.config.theme === 'desert' ? '#58412b' : '#182b1c';
    ctx.fillRect(0, horizonY, w, h - horizonY);

    const curveHint = THREE.MathUtils.clamp(player.steerInput * 28, -24, 24);
    ctx.beginPath();
    ctx.moveTo(cx - 24 + curveHint, horizonY);
    ctx.lineTo(cx + 24 + curveHint, horizonY);
    ctx.lineTo(w + 18, h);
    ctx.lineTo(-18, h);
    ctx.closePath();
    ctx.fillStyle = '#202630';
    ctx.fill();

    // Red/White Curb Edges
    ctx.strokeStyle = '#e10600';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - 24 + curveHint, horizonY);
    ctx.lineTo(-14, h);
    ctx.moveTo(cx + 24 + curveHint, horizonY);
    ctx.lineTo(w + 14, h);
    ctx.stroke();

    // Rear Wing Silhouette in top corners of mirror
    ctx.fillStyle = player.team.primaryColor || '#11151c';
    ctx.fillRect(0, 0, w, 3);

    // 3. Project Rear-Approaching Cars in 3D Perspective
    const sinY = Math.sin(player.yaw);
    const cosY = Math.cos(player.yaw);
    const fwdX = sinY, fwdZ = cosY;
    const rightX = -cosY, rightZ = sinY;

    const rearCars: Array<{ car: CarState; backDist: number; lat: number }> = [];
    for (const c of cars) {
      if (c === player) continue;
      const dx = c.pos.x - player.pos.x;
      const dz = c.pos.z - player.pos.z;
      const fwdDist = dx * fwdX + dz * fwdZ; // negative = behind player
      if (fwdDist < -1.5 && fwdDist > -110) {
        const lat = dx * rightX + dz * rightZ; // positive = to player's right (in mirror, flipped horizontally)
        rearCars.push({ car: c, backDist: -fwdDist, lat });
      }
    }

    // Sort far-to-near (painter's algorithm)
    rearCars.sort((a, b) => b.backDist - a.backDist);

    for (const rc of rearCars) {
      const depthNorm = THREE.MathUtils.clamp(1 - rc.backDist / 110, 0.12, 1);
      const persp = 14 / Math.max(3.5, rc.backDist);
      // In a rearview mirror, right side of car is on right side of mirror (-lat or +lat depending on right vector)
      const screenX = cx - rc.lat * persp * 26 + curveHint * (1 - depthNorm);
      const screenY = horizonY + 4 + Math.pow(depthNorm, 1.35) * (h - horizonY - 8);
      const carW = THREE.MathUtils.clamp(persp * 64, 7, 68);
      const carH = THREE.MathUtils.clamp(carW * 0.42, 4, 26);

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(screenX - carW * 0.52, screenY + carH * 0.36, carW * 1.04, carH * 0.24);

      // Tires
      ctx.fillStyle = '#0c0e12';
      const tw = Math.max(2, carW * 0.18);
      ctx.fillRect(screenX - carW * 0.5, screenY - carH * 0.35, tw, carH * 0.85);
      ctx.fillRect(screenX + carW * 0.5 - tw, screenY - carH * 0.35, tw, carH * 0.85);

      // Body
      ctx.fillStyle = rc.car.infected ? '#39ff14' : rc.car.team.primaryColor;
      ctx.fillRect(screenX - carW * 0.34, screenY - carH * 0.45, carW * 0.68, carH * 0.82);

      // Headlights
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(screenX - carW * 0.3, screenY - carH * 0.08, Math.max(1.5, carW * 0.12), Math.max(1.5, carH * 0.2));
      ctx.fillRect(screenX + carW * 0.18, screenY - carH * 0.08, Math.max(1.5, carW * 0.12), Math.max(1.5, carH * 0.2));

      // Police Flashing Lightbar in mirror!
      if (rc.car.copsRole === 'COP') {
        const flashPhase = Math.floor(nowMs / 110) % 2 === 0;
        ctx.fillStyle = flashPhase ? '#ff1818' : '#0066ff';
        ctx.fillRect(screenX - carW * 0.22, screenY - carH * 0.65, carW * 0.22, Math.max(2, carH * 0.18));
        ctx.fillStyle = flashPhase ? '#0066ff' : '#ff1818';
        ctx.fillRect(screenX, screenY - carH * 0.65, carW * 0.22, Math.max(2, carH * 0.18));
      }

      // Driver Tag & Distance if close (< 45m)
      if (rc.backDist < 45) {
        ctx.font = '900 8px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(`${rc.car.code} ${Math.round(rc.backDist)}m`, screenX, Math.max(9, screenY - carH * 0.68));
      }
    }
  }

  private _renderCircularSpeedo(player: CarState): void {
    const ctx = this.speedoCtx;
    const canvas = this.speedoCanvas;
    if (!ctx || !canvas) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    ctx.clearRect(0, 0, w, h);

    const startAng = Math.PI * 0.78;
    const totalSweep = Math.PI * 1.44;
    const endAng = startAng + totalSweep;
    const rArc = 83;

    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, rArc, startAng, endAng);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 6.5;
    ctx.stroke();

    const redStart = startAng + totalSweep * 0.80;
    ctx.beginPath();
    ctx.arc(cx, cy, rArc, redStart, endAng);
    ctx.strokeStyle = 'rgba(255, 36, 66, 0.45)';
    ctx.lineWidth = 6.5;
    ctx.stroke();

    const maxRpm = player.team.physics.maxRpm || 15000;
    const minDialRpm = maxRpm > 11000 ? 3800 : 1000;
    const rpmNorm = THREE.MathUtils.clamp((player.rpm - minDialRpm) / Math.max(2000, maxRpm - minDialRpm), 0, 1);
    const needleAng = startAng + totalSweep * rpmNorm;

    if (rpmNorm > 0.01) {
      const grad = ctx.createLinearGradient(cx - rArc, cy, cx + rArc, cy);
      grad.addColorStop(0.0, '#00e5ff');
      grad.addColorStop(0.72, '#eefaff');
      grad.addColorStop(1.0, '#ff1e42');
      ctx.beginPath();
      ctx.arc(cx, cy, rArc, startAng, needleAng);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 6.5;
      ctx.stroke();
    }

    ctx.font = '800 8.5px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const nMajor = 10;
    const maxDialNum = Math.round(maxRpm / 1000);
    for (let i = 0; i <= nMajor * 2; i++) {
      const f = i / (nMajor * 2);
      const a = startAng + totalSweep * f;
      const isMajor = i % 2 === 0;
      const rOuter = 76;
      const rInner = isMajor ? 68.5 : 72.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rInner, cy + Math.sin(a) * rInner);
      ctx.lineTo(cx + Math.cos(a) * rOuter, cy + Math.sin(a) * rOuter);
      ctx.strokeStyle = f >= 0.8 ? '#ff3855' : isMajor ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.34)';
      ctx.lineWidth = isMajor ? 1.8 : 1.0;
      ctx.stroke();

      if (isMajor && i % 4 === 0) {
        const tx = cx + Math.cos(a) * 59;
        const ty = cy + Math.sin(a) * 59;
        ctx.fillStyle = f >= 0.8 ? '#ff556e' : 'rgba(255,255,255,0.65)';
        ctx.fillText(String(Math.round(f * maxDialNum)), tx, ty);
      }
    }

    if (player.throttleInput > 0.02) {
      const thSweep = player.throttleInput * 0.65;
      ctx.beginPath();
      ctx.arc(cx, cy, 91, Math.PI * 0.22 - thSweep, Math.PI * 0.22);
      ctx.strokeStyle = '#22e56b';
      ctx.lineWidth = 3.2;
      ctx.stroke();
    }
    if (player.brakeInput > 0.02) {
      const brSweep = player.brakeInput * 0.65;
      ctx.beginPath();
      ctx.arc(cx, cy, 91, Math.PI * 0.78, Math.PI * 0.78 + brSweep);
      ctx.strokeStyle = '#ff2b3d';
      ctx.lineWidth = 3.2;
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(needleAng);
    ctx.beginPath();
    ctx.moveTo(46, -1.6);
    ctx.lineTo(86, -0.6);
    ctx.lineTo(86, 0.6);
    ctx.lineTo(46, 1.6);
    ctx.closePath();
    ctx.fillStyle = rpmNorm > 0.84 ? '#ff2a48' : '#ffffff';
    ctx.shadowColor = rpmNorm > 0.84 ? '#ff1e38' : '#00e5ff';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }

  private _renderProximityRadar(player: CarState, cars: CarState[]): void {
    const sinY = Math.sin(player.yaw);
    const cosY = Math.cos(player.yaw);
    const fwdX = sinY, fwdZ = cosY;
    const rightX = -cosY, rightZ = sinY;

    const nearby: Array<{ rx: number; rz: number }> = [];
    for (const c of cars) {
      if (c === player) continue;
      const dx = c.pos.x - player.pos.x;
      const dz = c.pos.z - player.pos.z;
      if (dx * dx + dz * dz > 18 * 18) continue;
      nearby.push({ rx: dx * rightX + dz * rightZ, rz: dx * fwdX + dz * fwdZ });
    }

    this.radarCanvas.classList.toggle('hidden', nearby.length === 0);
    if (nearby.length === 0) return;

    const ctx = this.radarCtx;
    const w = this.radarCanvas.width;
    const h = this.radarCanvas.height;
    const cx = w * 0.5, cy = h * 0.5;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 32, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 58, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(cx - 5, cy - 11, 10, 22);

    const scale = 3.2;
    for (const n of nearby) {
      const px = cx + n.rx * scale;
      const py = cy - n.rz * scale;
      ctx.fillStyle = Math.abs(n.rz) < 5 && Math.abs(n.rx) < 4.5 ? '#ff2424' : '#ffd200';
      ctx.fillRect(px - 5, py - 11, 10, 22);
    }
  }

  private _renderMinimap(cars: CarState[]): void {
    if (!this.minimapBounds) return;
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const { minX, minZ, scale, ox, oz, startPos } = this.minimapBounds;

    ctx.clearRect(0, 0, w, h);
    ctx.save();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.5, w * 0.44, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.5, w * 0.25, 0, Math.PI * 2); ctx.stroke();

    ctx.beginPath();
    this.minimapTrackPts.forEach((p, i) => {
      const x = ox + (p.x - minX) * scale;
      const y = oz + (p.z - minZ) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(8, 14, 24, 0.72)';
    ctx.lineWidth = 8.0;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.32)';
    ctx.lineWidth = 6.2;
    ctx.stroke();
    ctx.strokeStyle = '#29e8ff';
    ctx.lineWidth = 2.8;
    ctx.stroke();

    const sx = ox + (startPos.x - minX) * scale;
    const sy = oz + (startPos.z - minZ) * scale;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx - 4, sy - 2, 8, 4);

    const ordered = [...cars].sort((a, b) => (a.isPlayer ? 1 : b.isPlayer ? -1 : 0));
    for (const c of ordered) {
      const cx = ox + (c.pos.x - minX) * scale;
      const cy = oz + (c.pos.z - minZ) * scale;
      const dotColor = c.team.id === 'monster' ? '#39ff14'
        : c.team.id === 'mercedes' ? '#00d2be'
        : c.team.id === 'redbull' ? '#ffd300'
        : c.team.primaryColor;
      if (c.isPlayer) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.atan2(Math.cos(c.yaw), Math.sin(c.yaw)));
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-5.5, -5.2);
        ctx.lineTo(-2.8, 0);
        ctx.lineTo(-5.5, 5.2);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(cx, cy, 3.1, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  renderTelemetryTrace(trace: TelemetryTracePoint[]): void {
    const tr = this.t();
    const ctx = this.traceCtx;
    const w = this.traceCanvas.width;
    const h = this.traceCanvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let y = 18; y < h; y += 22) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    if (trace.length < 2) {
      ctx.fillStyle = '#93a0b8';
      ctx.font = '700 11px Consolas, monospace';
      ctx.fillText(tr.finishNoTelemetry, 14, h * 0.5);
      return;
    }

    const drawCurve = (color: string, width: number, valFn: (pt: TelemetryTracePoint) => number) => {
      ctx.beginPath();
      trace.forEach((pt, idx) => {
        const x = (idx / (trace.length - 1)) * w;
        const y = h - 4 - THREE.MathUtils.clamp(valFn(pt), 0, 1) * (h - 10);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };

    drawCurve('rgba(34, 229, 107, 0.55)', 1.5, (p) => p.throttle / 100);
    drawCurve('rgba(255, 43, 43, 0.65)', 1.5, (p) => p.brake / 100);
    drawCurve('#00e5ff', 2.2, (p) => p.kmh / 350);
  }

  showFinishModal(params: {
    sortedCars: CarState[];
    player: CarState;
    trackName: string;
    isQualifyingResult: boolean;
    hasNextAction: boolean;
    nextActionLabel: string;
    trace: TelemetryTracePoint[];
    champPointsMap?: Record<string, number>;
  }): void {
    const { sortedCars, player, trackName, isQualifyingResult, hasNextAction, nextActionLabel, trace, champPointsMap } = params;
    const tr = this.t();
    const pos = sortedCars.indexOf(player) + 1;

    document.getElementById('finish-eyebrow')!.textContent = isQualifyingResult
      ? tr.finishEyebrowQuali
      : tr.finishEyebrowRace;

    const titles = isQualifyingResult ? tr.finishQualiTitles : tr.finishRaceTitles;
    document.getElementById('finish-title')!.textContent =
      titles[pos] || (isQualifyingResult ? tr.finishQualiGeneric(pos) : tr.finishRaceGeneric(pos));
    document.getElementById('finish-subtitle')!.textContent = `${trackName} • ${tr.finishBestLap}: ${formatTime(player.bestLapTime)}`;

    const nextBtn = document.getElementById('btn-finish-next')!;
    nextBtn.textContent = nextActionLabel;
    nextBtn.classList.toggle('hidden', !hasNextAction);

    const list = document.getElementById('finish-standings')!;
    list.innerHTML = sortedCars
      .map((c, idx) => {
        const barColor = c.team.id === 'monster' ? '#39ff14' : c.team.id === 'mercedes' ? '#00d2be' : c.team.primaryColor;
        const ptsStr = champPointsMap ? ` • <strong>${champPointsMap[c.code] ?? 0} pt</strong>` : '';
        const penStr = c.timePenaltySec > 0 ? ` (+${c.timePenaltySec}s)` : '';
        const timeStr = c.finished ? formatTime(c.finishTime) + penStr : `${tr.lapWord} ${c.lap}/${c.maxLaps}`;
        return `
          <div class="fin-row ${c.isPlayer ? 'is-player' : ''}">
            <span>${idx + 1}°</span>
            <span style="background:${barColor}; height:16px; border-radius:2px;"></span>
            <span>${c.team.shortName} <strong>#${c.number} ${c.code}</strong> ${c.isPlayer ? tr.finishYou : ''}${ptsStr}</span>
            <span class="fin-time">${timeStr}</span>
          </div>
        `;
      })
      .join('');

    this.renderTelemetryTrace(trace);
    this.finishModal.classList.remove('hidden');
  }
}
