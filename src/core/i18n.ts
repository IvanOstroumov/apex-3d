/**
 * APEX GP 3D — Full Bilingual Localization (Italiano 🇮🇹 / English 🇬🇧)
 * & Interactive F1 Academy / Wiki Encyclopedia Content for Beginners & Sim Racers
 */
import type { ERSMode, SetupPresetId, TireCompoundId } from './types';

export type Language = 'it' | 'en';

const LANG_STORAGE_KEY = 'apex_gp_3d_lang_v1';

export function getSavedLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'en' || saved === 'it') return saved;
  } catch {
    // ignore storage errors
  }
  return 'it';
}

export function saveLanguage(lang: Language): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // ignore storage errors
  }
}

export interface WikiArticle {
  badge: string;
  badgeColor: string;
  title: string;
  subtitle: string;
  body: string;
  proTip: string;
  svgDiagram?: string;
}

export interface WikiCategory {
  id: string;
  tabLabel: string;
  articles: WikiArticle[];
}

export interface I18nStrings {
  langToggleBtn: string;
  wikiBtnMenu: string;
  wikiBtnPause: string;
  subtitle: string;
  zoomHint: string;
  settingsProBtn: string;
  audioOn: string;
  audioOff: string;
  licensePrefix: string;

  // Menu Left Panel
  panel1Title: string;
  statSpeed: string;
  statAccel: string;
  statGrip: string;
  statAero: string;
  compoundLabel: string;
  setupPresets: Record<SetupPresetId, string>;
  sliderWing: string;
  sliderBrakes: string;
  sliderSusp: string;
  assistLine: string;
  assistManual: string;

  // Menu Right Panel
  panel2Title: string;
  modeQuickRace: string;
  modeWeekend: string;
  modeChamp: string;
  modeTimeAttack: string;
  metaEnv: string;
  metaSession: string;
  metaLayout: string;
  metaReverse: string;
  lapsUnit: string;
  lapsFree: string;
  lapsWeekend: string;
  weatherDry: string;
  weatherOvercast: string;
  weatherRain: string;
  weatherDynamic: string;
  diffRookie: string;
  diffPro: string;
  diffAce: string;
  diffLegend: string;
  qualLow: string;
  qualMed: string;
  qualHigh: string;
  qualUltra: string;
  launchBtn: string;

  // Team & Track Localized Metadata
  teamTaglines: Record<string, string>;
  trackBadges: Record<string, string>;
  trackDescs: Record<string, string>;
  trackEnvs: Record<string, string>;

  // In-Race HUD
  lapWord: string;
  qualifyingTag: string;
  flagGreen: string;
  flagWet: (pct: number) => string;
  flagYellow: string;
  flagVsc: string;
  launchOptimal: (rpm: number) => string;
  launchTooHigh: (rpm: number) => string;
  launchHold: (rpm: number) => string;
  launchPerfectBanner: string;
  launchWheelspinBanner: string;
  launchGoBanner: string;
  radioTitle: string;
  wrongWayBanner: string;
  badgeSlipstream: string;
  badgeDirtyAir: string;
  badgeDrsOpen: string;
  badgePitAvail: string;
  badgeMarbles: string;
  badgeTrackLimits: string;
  badgeReplay: string;
  timeLap: string;
  timeBest: string;
  trackTempLabel: string;
  wingWarnAero: string;
  wingWarnPuncture: string;
  drsOpen: string;
  drsReady: string;
  drsClosed: string;
  ersModes: Record<ERSMode, string>;

  // Banners & Radio
  bannerCarReset: string;
  bannerFinalLap: string;
  bannerSettingsReset: string;
  bannerHaloHidden: string;
  bannerHaloVisible: string;
  bannerQualiStart: (track: string) => string;
  bannerGridStart: (track: string, pos: number) => string;
  bannerCollisionRub: string;
  bannerCollisionWing: string;
  radioTiresWeather: (wear: number, sTemp: number, cTemp: number, tTemp: number, wetPct: number) => string;
  radioGapLeader: (fuel: string) => string;
  radioGapChasing: (pos: number, code: string, gap: string, fuel: string) => string;
  radioPitService: string;
  radioPitConfirm: string;
  radioFinalLap: string;
  radioFastestLap: (time: string) => string;
  radioCollisionWarn: string;

  // Pause Modal
  pauseTitle: string;
  pauseSub: string;
  pauseResume: string;
  pauseSettings: string;
  pauseRestart: string;
  pauseBackMenu: string;

  // Finish Modal
  finishEyebrowQuali: string;
  finishEyebrowRace: string;
  finishQualiTitles: Record<number, string>;
  finishRaceTitles: Record<number, string>;
  finishQualiGeneric: (pos: number) => string;
  finishRaceGeneric: (pos: number) => string;
  finishBestLap: string;
  finishYou: string;
  finishTelemetryHead: string;
  finishNoTelemetry: string;
  finishNextSession: string;
  finishStartGP: (pos: number) => string;
  finishNextChamp: string;
  finishReplayRace: string;
  finishBackShowroom: string;

  // Pro Settings Modal
  setEyebrow: string;
  setTitle: string;
  setCloseTop: string;
  setTab1: string;
  setTab2: string;
  setTab3: string;
  setTab4: string;
  setTab5: string;
  setRes: string;
  setShadows: string;
  setShadowOff: string;
  setShadowMed: string;
  setShadowHigh: string;
  setShadowUltra: string;
  setEnv: string;
  setBloom: string;
  setExp: string;
  setVig: string;
  setSmaa: string;
  setGov: string;
  setFov: string;
  setSpeedFov: string;
  setSeatH: string;
  setSeatFore: string;
  setPitch: string;
  setShake: string;
  setRoll: string;
  setHaloRadar: string;
  setNoHalo: string;
  setRadar360: string;
  setFWing: string;
  setRWing: string;
  setBBias: string;
  setBPress: string;
  setDiffOn: string;
  setDiffOff: string;
  setSusp: string;
  setRidePsi: string;
  setSens: string;
  setLin: string;
  setDz: string;
  setFfb: string;
  setBAssist: string;
  setBAssistOff: string;
  setBAssistLow: string;
  setBAssistHigh: string;
  setTcLabel: string;
  setAbsGearbox: string;
  setManualGear: string;
  setLine3D: string;
  setVol: string;
  setAiLevel: string;
  setAiAgg: string;
  setDmg: string;
  setWear: string;
  setFuel: string;
  setLimits: string;
  setLimitsOff: string;
  setLimitsStd: string;
  setLimitsStrict: string;
  setTod: string;
  setResetBtn: string;
  setApplyBtn: string;

  // Wiki Modal
  wikiEyebrow: string;
  wikiTitle: string;
  wikiSub: string;
  wikiCloseBtn: string;
  wikiCategories: WikiCategory[];
}

const SVG_APEX_DIAGRAM = `
<svg viewBox="0 0 280 110" class="wiki-svg">
  <path d="M 15 100 L 15 55 Q 15 15 65 15 L 265 15" fill="none" stroke="#2a3242" stroke-width="26" stroke-linecap="round"/>
  <path d="M 15 100 L 15 55 Q 15 15 65 15 L 265 15" fill="none" stroke="#1b202b" stroke-width="22" stroke-linecap="round"/>
  <!-- Curbs -->
  <path d="M 25 60 Q 25 27 65 27" fill="none" stroke="#ff2e24" stroke-width="4" stroke-dasharray="6 6"/>
  <!-- Ideal Racing Line (Outside -> Apex -> Outside) -->
  <path d="M 6 98 C 6 42, 34 26, 72 24 C 120 22, 185 6, 260 6" fill="none" stroke="#00e5ff" stroke-width="3" stroke-dasharray="5 3"/>
  <!-- Braking Zone -->
  <path d="M 6 98 L 6 58" fill="none" stroke="#ff2442" stroke-width="4"/>
  <!-- Apex Dot -->
  <circle cx="52" cy="27" r="5.5" fill="#22e56b" stroke="#fff" stroke-width="1.5"/>
  <text x="64" y="42" fill="#22e56b" font-size="10" font-weight="900">APEX (Punto di Corda)</text>
  <text x="16" y="92" fill="#ff6b7b" font-size="9" font-weight="800">1. Frenata (Esterno)</text>
  <text x="155" y="22" fill="#00e5ff" font-size="9" font-weight="800">3. Uscita a tutto gas (Esterno)</text>
</svg>`;

const SVG_ERS_DRS_DIAGRAM = `
<svg viewBox="0 0 280 110" class="wiki-svg">
  <!-- Car silhouette & airflow -->
  <rect x="12" y="18" width="256" height="36" rx="7" fill="rgba(0,229,255,0.08)" stroke="rgba(0,229,255,0.35)"/>
  <text x="22" y="34" fill="#00e5ff" font-size="10" font-weight="900">DRS (Ala Mobile Posteriore — Tasto SHIFT)</text>
  <text x="22" y="47" fill="#c7d5eb" font-size="9">Apre il flap dell'alettone in rettilineo: -25% attrito aria → +18 km/h</text>
  <rect x="12" y="62" width="256" height="38" rx="7" fill="rgba(34,229,107,0.08)" stroke="rgba(34,229,107,0.35)"/>
  <text x="22" y="78" fill="#22e56b" font-size="10" font-weight="900">ERS (Motore Elettrico Ibrido 160 CV — Tasto B / SPAZIO)</text>
  <text x="22" y="91" fill="#c7d5eb" font-size="9">Si ricarica in frenata ( Verde) • Spinge in accelerazione (⚡ Ciano)</text>
</svg>`;

const SVG_TIRES_DIAGRAM = `
<svg viewBox="0 0 280 110" class="wiki-svg">
  <g transform="translate(10, 14)">
    <circle cx="22" cy="24" r="16" fill="#151820" stroke="#ff2424" stroke-width="4"/>
    <text x="22" y="28" text-anchor="middle" fill="#ff2424" font-size="12" font-weight="900">S</text>
    <text x="22" y="54" text-anchor="middle" fill="#fff" font-size="8.5" font-weight="800">SOFT</text>
    <text x="22" y="65" text-anchor="middle" fill="#93a0b8" font-size="7.5">+Grip / -Vita</text>
  </g>
  <g transform="translate(65, 14)">
    <circle cx="22" cy="24" r="16" fill="#151820" stroke="#ffd200" stroke-width="4"/>
    <text x="22" y="28" text-anchor="middle" fill="#ffd200" font-size="12" font-weight="900">M</text>
    <text x="22" y="54" text-anchor="middle" fill="#fff" font-size="8.5" font-weight="800">MEDIUM</text>
    <text x="22" y="65" text-anchor="middle" fill="#93a0b8" font-size="7.5">Bilanciata</text>
  </g>
  <g transform="translate(120, 14)">
    <circle cx="22" cy="24" r="16" fill="#151820" stroke="#f2f5fa" stroke-width="4"/>
    <text x="22" y="28" text-anchor="middle" fill="#f2f5fa" font-size="12" font-weight="900">H</text>
    <text x="22" y="54" text-anchor="middle" fill="#fff" font-size="8.5" font-weight="800">HARD</text>
    <text x="22" y="65" text-anchor="middle" fill="#93a0b8" font-size="7.5">Max Durata</text>
  </g>
  <g transform="translate(175, 14)">
    <circle cx="22" cy="24" r="16" fill="#151820" stroke="#22e56b" stroke-width="4"/>
    <text x="22" y="28" text-anchor="middle" fill="#22e56b" font-size="12" font-weight="900">I</text>
    <text x="22" y="54" text-anchor="middle" fill="#fff" font-size="8.5" font-weight="800">INTER</text>
    <text x="22" y="65" text-anchor="middle" fill="#93a0b8" font-size="7.5">Umido/Pioggia</text>
  </g>
  <g transform="translate(228, 14)">
    <circle cx="22" cy="24" r="16" fill="#151820" stroke="#00a8ff" stroke-width="4"/>
    <text x="22" y="28" text-anchor="middle" fill="#00a8ff" font-size="12" font-weight="900">W</text>
    <text x="22" y="54" text-anchor="middle" fill="#fff" font-size="8.5" font-weight="800">FULL WET</text>
    <text x="22" y="65" text-anchor="middle" fill="#93a0b8" font-size="7.5">Diluvio</text>
  </g>
  <text x="140" y="99" text-anchor="middle" fill="#ffd13b" font-size="8.5" font-weight="800">Finestra Termica Ottimale Slick: 85°C – 105°C (S: Superficie / C: Carcassa)</text>
</svg>`;

export const TRANSLATIONS: Record<Language, I18nStrings> = {
  it: {
    langToggleBtn: '🇮🇹 IT',
    wikiBtnMenu: '📖 WIKI F1',
    wikiBtnPause: '📖 WIKI & GUIDA MECCANICHE F1',
    subtitle: 'GOMME MULTI-STRATO • EFFETTO SUOLO • HDR BLOOM • 60+ FPS',
    zoomHint: '🖱️ 360° • Zoom',
    settingsProBtn: '⚙️ IMPOSTAZIONI PRO',
    audioOn: '🔊 Audio ON',
    audioOff: '🔇 Audio OFF',
    licensePrefix: '🪪 LICENZA',

    panel1Title: 'SCUDERIA & INGEGNERE ASSETTO',
    statSpeed: 'VELOCITÀ',
    statAccel: 'ACCEL.',
    statGrip: 'GRIP',
    statAero: 'AERO/DRS',
    compoundLabel: 'MESCOLA',
    setupPresets: {
      balanced: 'Assetto: Bilanciato',
      low_drag: 'Assetto: Scarico (Vmax)',
      high_downforce: 'Assetto: Alto Carico',
      anti_understeer: 'Fix Sottosterzo',
      anti_oversteer: 'Fix Sovrasterzo'
    },
    sliderWing: 'ALA',
    sliderBrakes: 'FRENI',
    sliderSusp: 'SOSP.',
    assistLine: 'Linea 3D',
    assistManual: 'Cambio Man.',

    panel2Title: 'MODALITÀ & CIRCUITO',
    modeQuickRace: 'GARA',
    modeWeekend: 'QUALIFICA+GP',
    modeChamp: 'CAMPIONATO',
    modeTimeAttack: 'TIME ATTACK',
    metaEnv: 'AMBIENTE',
    metaSession: 'SESSIONE',
    metaLayout: 'LAYOUT',
    metaReverse: 'Invertito',
    lapsUnit: 'Giri',
    lapsFree: 'Libero',
    lapsWeekend: 'Q3 + 3 Giri',
    weatherDry: '☀️ Asciutto',
    weatherOvercast: '⛅ Nuvoloso',
    weatherRain: '🌧️ Pioggia',
    weatherDynamic: '🌦️ Dinamico',
    diffRookie: 'AI: Rookie',
    diffPro: 'AI: Pro',
    diffAce: 'AI: Esperto',
    diffLegend: 'AI: Leggenda',
    qualLow: 'FPS: Basso',
    qualMed: 'Grafica: Medio',
    qualHigh: 'Grafica: Alto',
    qualUltra: 'Grafica: Ultra',
    launchBtn: 'SCENDI IN PISTA',

    teamTaglines: {
      ferrari: 'Bilanciata, grande trazione e accelerazione',
      monster: 'Assetto scarico, massima velocità di punta',
      mcdonalds: 'Avantreno affilato, massima agilità nelle chicane',
      redbull: 'Massima deportanza ed efficienza aerodinamica',
      mercedes: 'Frenata millimetrica e stabilità ad alta velocità'
    },
    trackBadges: {
      monza: 'ALTA VELOCITÀ',
      night_city: 'NOTTURNO',
      desert: 'TRAMONTO',
      alpine: 'DISLIVELLI'
    },
    trackDescs: {
      monza: 'Tempio della velocità: rettilinei da 345 km/h, chicane tecniche e parco secolare.',
      night_city: 'Muretti cittadini, grattacieli illuminati, tunnel neon e asfalto specchiato.',
      desert: 'Curve veloci tra dune scolpite, torri illuminate e riflettori da stadio.',
      alpine: 'Salite ripide stile Eau Rouge, discese veloci, pini e vette innevate.'
    },
    trackEnvs: {
      monza: 'Diurno',
      night_city: 'Notte Neon',
      desert: 'Tramonto',
      alpine: 'Montagna'
    },

    lapWord: 'GIRO',
    qualifyingTag: 'QUALIFICA Q3',
    flagGreen: '🟢 BANDIERA VERDE • PISTA LIBERA',
    flagWet: (pct) => `🌧️ PISTA BAGNATA (${pct}%) • DRS DISABILITATO`,
    flagYellow: '🟡 BANDIERA GIALLA • PERICOLO IN PISTA',
    flagVsc: '🟠 VSC • VIRTUAL SAFETY CAR (MAX 195 KM/H)',
    launchOptimal: (rpm) => `🎯 LAUNCH RPM OTTIMALE (${rpm} RPM) — PRONTO!`,
    launchTooHigh: (rpm) => `⚠ RPM TROPPO ALTO (${rpm} RPM) — RISCHIO PATTINAMENTO!`,
    launchHold: (rpm) => `🎯 TIENI ACCELERATORE A 9.500–12.000 RPM (${rpm} RPM)`,
    launchPerfectBanner: '🚀 LAUNCH CONTROL PERFETTO (+14% TRAZIONE)!',
    launchWheelspinBanner: 'LIGHTS OUT — ⚠ PATTINAMENTO AL VIA!',
    launchGoBanner: 'LIGHTS OUT — VIA!',
    radioTitle: '📻 INGEGNERE DI PISTA',
    wrongWayBanner: '⚠ SENSO CONTRARIO — PREMI R',
    badgeSlipstream: 'SCIA AERO',
    badgeDirtyAir: 'ARIA SPORCA',
    badgeDrsOpen: 'DRS APERTO',
    badgePitAvail: '🔧 [P] PIT-STOP DISPONIBILE',
    badgeMarbles: '⚠ MARBLES SU GOMMA',
    badgeTrackLimits: '⚠ TRACK LIMITS',
    badgeReplay: '⏪ REPLAY TV — PREMI V',
    timeLap: 'GIRO',
    timeBest: 'MIGLIORE',
    trackTempLabel: 'PISTA',
    wingWarnAero: '⚠ DANNO AERO — BOX [P]',
    wingWarnPuncture: '⚠ FORATURA! RIENTRA AI BOX [P]',
    drsOpen: 'DRS APERTO',
    drsReady: 'DRS [SHIFT]',
    drsClosed: 'DRS CHIUSO',
    ersModes: {
      none: 'RICARICA',
      medium: 'MEDIO',
      overtake: 'SORPASSO',
      hotlap: 'HOTLAP Q3'
    },

    bannerCarReset: 'AUTO RIPOSIZIONATA',
    bannerFinalLap: '🔥 GIRO FINALE!',
    bannerSettingsReset: 'IMPOSTAZIONI RIPRISTINATE',
    bannerHaloHidden: 'HALO: NASCOSTO',
    bannerHaloVisible: 'HALO: VISIBILE',
    bannerQualiStart: (t) => `${t} — QUALIFICA GIRO SECCO`,
    bannerGridStart: (t, p) => `${t} — IN GRIGLIA (P${p})`,
    bannerCollisionRub: '⚔ CONTATTO RUOTA A RUOTA!',
    bannerCollisionWing: '💥 CONTATTO PESANTE — CONTROLLA ALA!',
    radioTiresWeather: (wear, s, c, t, w) =>
      `Gomme al ${wear}% (Sup: ${s}°C / Core: ${c}°C). Pista ${t}°C, umidità ${w}%.`,
    radioGapLeader: (fuel) =>
      `Sei il LEADER della gara! Gestisci il passo, carburante: ${fuel}kg.`,
    radioGapChasing: (pos, code, gap, fuel) =>
      `Sei P${pos}. Distacco da ${code} davanti: +${gap}s. Carburante: ${fuel}kg.`,
    radioPitService: 'Box, box! Meccanici al lavoro: gomme nuove e ala riparata (2.4s)...',
    radioPitConfirm: 'Box confermato! Premi [P] sul rettilineo dei box a velocità ridotta.',
    radioFinalLap: 'Ultimo giro! Usa tutto l’ERS rimasto in modalità SORPASSO [B]!',
    radioFastestLap: (t) => `⚡ Giro Veloce personale: ${t}!`,
    radioCollisionWarn: 'Contatto rilevato! Attenzione all’ala anteriore e alle temperature gomme.',

    pauseTitle: '⏸ GARA IN PAUSA',
    pauseSub: 'WASD Guida • SHIFT DRS • SPAZIO/B ERS • Q/E Cambio • P Pit-Stop • 1/2/3 Radio • H Halo • V Replay • C Camera • O Impostazioni',
    pauseResume: 'RIPRENDI GARA',
    pauseSettings: '⚙️ IMPOSTAZIONI PRO',
    pauseRestart: 'RIAVVIA SESSIONE',
    pauseBackMenu: 'TORNA ALLO SHOWROOM',

    finishEyebrowQuali: 'QUALIFICHE Q3 COMPLETATE — GRIGLIA DI PARTENZA',
    finishEyebrowRace: 'BANDIERA A SCACCHI',
    finishQualiTitles: {
      1: '⚡ POLE POSITION — P1 IN GRIGLIA!',
      2: '🔥 PRIMA FILA — P2 IN GRIGLIA!',
      3: '🏁 SECONDA FILA — P3 IN GRIGLIA!'
    },
    finishRaceTitles: {
      1: '🏆 1° POSTO — VITTORIA!',
      2: '🥈 2° POSTO — PODIO!',
      3: '🥉 3° POSTO — PODIO!'
    },
    finishQualiGeneric: (p) => `${p}° POSTO — GRIGLIA DEFINITA`,
    finishRaceGeneric: (p) => `${p}° POSTO — GARA COMPLETATA`,
    finishBestLap: 'Miglior Giro',
    finishYou: '(TU)',
    finishTelemetryHead: '📈 TELEMETRIA GIRO VELOCE (VELOCITÀ / GAS / FRENO)',
    finishNoTelemetry: 'Nessuna traccia telemetrica disponibile',
    finishNextSession: 'PROSSIMA SESSIONE ▶',
    finishStartGP: (p) => `AVVIA GRAN PREMIO (PARTENZA P${p}) ▶`,
    finishNextChamp: 'PROSSIMA TAPPA CAMPIONATO ▶',
    finishReplayRace: 'CORRI DI NUOVO',
    finishBackShowroom: 'TORNA ALLO SHOWROOM',

    setEyebrow: 'TELEMETRIA & CONFIGURAZIONE SIMULATORE',
    setTitle: '⚙️ IMPOSTAZIONI PRO SIMULATORE',
    setCloseTop: '✕ CHIUDI',
    setTab1: '1. GRAFICA & PBR',
    setTab2: '2. CAMERA & ABITACOLO',
    setTab3: '3. INGEGNERIA AUTO',
    setTab4: '4. COMANDI & FFB',
    setTab5: '5. AUDIO, AI & FIA',
    setRes: 'Scala Risoluzione (Resolution Scale)',
    setShadows: 'Qualità Ombre (Shadow Map)',
    setShadowOff: 'Disattivate / Off',
    setShadowMed: '1024x1024 (Medie)',
    setShadowHigh: '2048x2048 (Alte)',
    setShadowUltra: '4096x4096 (Ultra)',
    setEnv: 'Riflessi PBR & Vernice (Env Map)',
    setBloom: 'Bagliore HDR Bloom',
    setExp: 'Esposizione ACES Filmic',
    setVig: 'Vignettatura Velocità',
    setSmaa: 'Anti-Aliasing SMAA',
    setGov: 'Governor Adattivo 60+ FPS',
    setFov: 'Campo Visivo (FOV Offset)',
    setSpeedFov: 'FOV Dinamico Velocità',
    setSeatH: 'Altezza Sedile (Seat Height)',
    setSeatFore: 'Posizione Sedile Avanti/Indietro',
    setPitch: 'Inclinazione Visuale (Pitch)',
    setShake: 'Vibrazione Camera & Cordoli',
    setRoll: 'Rollio Camera in Curva',
    setHaloRadar: 'Colonna Halo & Radar Prossimità',
    setNoHalo: 'Nascondi Halo',
    setRadar360: 'Radar 360°',
    setFWing: 'Ala Anteriore (Front Wing)',
    setRWing: 'Ala Posteriore (Rear Wing)',
    setBBias: 'Ripartizione Frenata (Brake Bias F)',
    setBPress: 'Pressione Freni (Brake Pressure)',
    setDiffOn: 'Differenziale in Accelerazione (On-Throttle)',
    setDiffOff: 'Differenziale in Rilascio (Off-Throttle)',
    setSusp: 'Rigidità Sospensioni',
    setRidePsi: 'Altezza Fondo / Pressione Gomme PSI',
    setSens: 'Sensibilità Sterzo',
    setLin: 'Linearità Sterzo (Gamma)',
    setDz: 'Zona Morta Sterzo (Deadzone)',
    setFfb: 'Intensità Vibrazione / Force Feedback',
    setBAssist: 'Assistenza Frenata (Brake Assist)',
    setBAssistOff: 'Off (Simulatore Puro)',
    setBAssistLow: 'Bassa / Low',
    setBAssistHigh: 'Alta / High',
    setTcLabel: 'Controllo Trazione (TC)',
    setAbsGearbox: 'ABS, Cambio & Traiettoria',
    setManualGear: 'Cambio Manuale',
    setLine3D: 'Traiettoria 3D',
    setVol: 'Volume Principale (Master)',
    setAiLevel: 'Livello AI Avversari (1–110)',
    setAiAgg: 'Aggressività AI nei Duelli',
    setDmg: 'Moltiplicatore Danni Aerodinamici',
    setWear: 'Moltiplicatore Usura Gomme',
    setFuel: 'Consumo Carburante (Fuel Burn)',
    setLimits: 'Severità Limiti Pista FIA (Track Limits)',
    setLimitsOff: 'Disattivati / Off',
    setLimitsStd: 'Standard FIA (3 avvisi = +3s)',
    setLimitsStrict: 'Severo Campionato (Strict)',
    setTod: 'Velocità Ciclo Giorno/Notte',
    setResetBtn: '↺ RIPRISTINA PREDEFINITI',
    setApplyBtn: '✓ APPLICA E CHIUDI',

    wikiEyebrow: 'ENCICLOPEDIA INTERATTIVA PER PRINCIPIANTI & PILOTI PRO',
    wikiTitle: '📖 WIKI & ACCADEMIA FORMULA 1',
    wikiSub: 'Non sai cosa siano Apex, ERS, DRS, Sottosterzo o Marbles? Scopri in modo semplice tutte le meccaniche reali simulate in APEX GP 3D.',
    wikiCloseBtn: '✕ CHIUDI WIKI',
    wikiCategories: [
      {
        id: 'driving',
        tabLabel: '1. GUIDA & APEX',
        articles: [
          {
            badge: 'FONDAMENTALE #1',
            badgeColor: '#22e56b',
            title: 'Cos’è l’APEX (Punto di Corda) e la Traiettoria Ideale?',
            subtitle: 'Il segreto per fare le curve 30 km/h più veloce senza uscire di pista',
            body: 'In Formula 1 non si gira mai seguendo il bordo della strada. Per percorrere una curva alla massima velocità bisogna "raddrizzarla" il più possibile seguendo la regola d’oro: <strong>Esterno → Interno (APEX) → Esterno</strong>.<br>• <strong>1. Impostazione (Esterno):</strong> Prima di una curva a destra, portati tutto a sinistra.<br>• <strong>2. APEX (Punto di Corda):</strong> È il punto interno del cordolo a metà curva che devi sfiorare con le ruote interne.<br>• <strong>3. Uscita (Esterno):</strong> Appena tocchi l’Apex, inizia a raddrizzare il volante e apri gradualmente l’acceleratore lasciando scorrere l’auto verso il cordolo esterno.',
            proTip: 'Attiva la "Linea 3D" nel menu: è VERDE dove puoi tenere tutto il gas, GIALLA dove devi parzializzare e ROSSA dove devi frenare forte!',
            svgDiagram: SVG_APEX_DIAGRAM
          },
          {
            badge: 'TECNICA DI FRENATA',
            badgeColor: '#ff2442',
            title: 'Frenata Aerodinamica & Trail Braking (Frenata Regressiva)',
            subtitle: 'Perché una F1 frena fortissimo ad alta velocità e blocca le ruote a bassa velocità',
            body: 'A 300 km/h le ali e il fondo piatto schiacciano l’auto a terra con oltre 1.500 kg di carico aerodinamico (<em>Downforce</em>). Per questo motivo:<br>• <strong>Colpo iniziale:</strong> Appena inizi a frenare in fondo al rettilineo puoi premere il freno al 100% senza bloccare le ruote.<br>• <strong>Trail Braking:</strong> Man mano che l’auto rallenta, il carico aerodinamico diminuisce. Mentre inizi a girare il volante verso l’Apex, rilascia gradualmente il freno per non superare il limite di grip delle gomme anteriori (evitando il <em>Front Lockup</em> e il fumo bianco dalle gomme!).',
            proTip: 'Se disattivi l’ABS per guidare come i veri piloti F1, evita di sterzare bruscamente mentre tieni il freno premuto al massimo.'
          },
          {
            badge: 'CONTROLLO AUTO',
            badgeColor: '#ffd13b',
            title: 'Sottosterzo (Understeer) vs Sovrasterzo (Oversteer)',
            subtitle: 'Come capire se stai perdendo il muso o la coda dell’auto',
            body: '• <strong>Sottosterzo (Understeer):</strong> Giri il volante ma l’auto "va dritta" e allarga verso l’esterno della curva perché le gomme anteriori hanno perso aderenza. <em>Rimedio:</em> entra in curva più piano o aumenta il carico dell’Ala Anteriore.<br>• <strong>Sovrasterzo (Oversteer):</strong> La coda dell’auto scivola verso l’esterno (tendenza al testacoda) perché le gomme posteriori pattinano sotto troppa potenza. <em>Rimedio:</em> dosa l’acceleratore in uscita di curva, controsterza dolcemente nella direzione della sbandata o usa <em>TC: MED / FULL</em>.',
            proTip: 'Nel menu rapido puoi scegliere "Fix Sottosterzo" o "Fix Sovrasterzo" per correggere subito il comportamento della tua monoposto!'
          },
          {
            badge: 'SUPERFICI & REGOLE',
            badgeColor: '#ff7a33',
            title: 'Cordoli (Curbs), Erba/Ghiaia e Limiti di Pista (Track Limits)',
            subtitle: 'Quando salire sui cordoli e cosa succede se finisci fuori pista',
            body: '• <strong>Cordoli (Curbs):</strong> I bordi colorati (rosso-bianchi) all’interno e all’esterno delle curve. Pizzicarli ti aiuta a stringere la traiettoria (vedrai scintille dal fondo in titanio!), ma hanno l’8% di grip in meno rispetto all’asfalto.<br>• <strong>Erba e Ghiaia (Fuori Pista):</strong> Se esci oltre il cordolo sull’erba o sulla sabbia, l’attrito del terreno rallenta l’auto, solleva zolle d’erba/terra e riduce la trazione. Rilascia leggermente il gas e rientra gradualmente senza sterzate brusche. Dopo 3 tagli di pista ad alta velocità ricevi <strong>+3 secondi di penalità FIA</strong>.',
            proTip: 'Se finisci contro le barriere o in testacoda, premi il tasto [R] per riposizionare subito l’auto in centro pista.'
          }
        ]
      },
      {
        id: 'power_aero',
        tabLabel: '2. ERS, DRS & AERO',
        articles: [
          {
            badge: 'SISTEMA IBRIDO',
            badgeColor: '#00e5ff',
            title: 'Cos’è l’ERS (Energy Recovery System) e come si usa?',
            subtitle: '160 CV elettrici extra che si ricaricano quando freni!',
            body: 'Le F1 moderne hanno un motore termico V6 Turbo + due motori elettrici (<strong>MGU-K</strong> collegato alle ruote posteriori e <strong>MGU-H</strong> collegato al turbocompressore).<br>• <strong>Ricarica (Harvesting):</strong> Ogni volta che freni forte, l’energia cinetica non va sprecata ma ricarica la batteria (la barra ERS in basso a destra diventa VERDE).<br>• <strong>4 Modalità ERS (Tasto [B] + Tasto [SPAZIO]):</strong><br>  1. 🟢 <strong>RICARICA:</strong> Disattiva la spinta elettrica per riempire la batteria al massimo.<br>  2. 🟡 <strong>MEDIO:</strong> Usa e ricarica la batteria in modo equilibrato su tutto il giro.<br>  3. 🔵 <strong>SORPASSO (Overtake):</strong> Scarica tutta la potenza elettrica per superare un rivale!<br>  4. 🟣 <strong>HOTLAP Q3:</strong> Mappatura estrema (+14% potenza) per fare il record sul giro.',
            proTip: 'Tieni premuto [SPAZIO] in uscita di curva per forzare manualmente il boost elettrico di Sorpasso anche se sei in modalità Media!',
            svgDiagram: SVG_ERS_DRS_DIAGRAM
          },
          {
            badge: 'ALA MOBILE',
            badgeColor: '#22e56b',
            title: 'Cos’è il DRS (Drag Reduction System)?',
            subtitle: 'Come aprire l’alettone posteriore per guadagnare +18 km/h sui rettilinei',
            body: 'L’alettone posteriore schiaccia l’auto a terra in curva, ma sui rettilinei fa da "paracadute" frenando l’auto.<br>• <strong>Come funziona:</strong> Nelle <strong>Zone DRS</strong> (i rettilinei principali segnalati dai cartelli verdi a bordo pista), il badge sul tachimetro diventa verde: <code>DRS [SHIFT]</code>.<br>• <strong>Attivazione:</strong> Premi <strong>[SHIFT]</strong> mentre acceleri sul dritto: il flap dell’ala posteriore si apre fisicamente, taglia la resistenza dell’aria del 25% e si chiude da solo appena tocchi il freno!',
            proTip: 'Per motivi di sicurezza FIA, il DRS viene disattivato automaticamente in caso di Pioggia o durante la Virtual Safety Car (VSC).'
          },
          {
            badge: 'AERODINAMICA',
            badgeColor: '#c84bff',
            title: 'Scia Aerodinamica (Slipstream) vs Aria Sporca (Dirty Air)',
            subtitle: 'Perché stare dietro a un’altra F1 è un vantaggio sul dritto ma un pericolo in curva',
            body: '• <strong>Scia (Slipstream — Badge Giallo):</strong> Quando segui un’auto a meno di 44 metri in rettilineo, lei "taglia" l’aria davanti a te. Hai fino al 21% di resistenza dell’aria in meno: usala per affiancarti prima della staccata!<br>• <strong>Aria Sporca (Dirty Air — Badge Arancione):</strong> Se invece resti incollato al cambio di un avversario (< 26 metri) <em>dentro una curva veloce</em>, le tue ali ricevono aria turbolenta e calda: perdi fino al <strong>16% di aderenza aerodinamica</strong> e i tuoi freni/gomme si scaldano di più!',
            proTip: 'In curva, se senti che l’auto allarga a causa dell’Aria Sporca, sposta leggermente la tua traiettoria di 2 metri per trovare "aria pulita".'
          },
          {
            badge: 'EFFETTO SUOLO',
            badgeColor: '#00a8ff',
            title: 'Effetto Suolo (Venturi Floor) & Porpoising',
            subtitle: 'Come il fondo della monoposto genera una ventosa naturale sotto l’asfalto',
            body: 'Oltre il 60% dell’aderenza di una F1 moderna non viene dalle ali, ma da due enormi tunnel sagomati sotto il fondo piatto (<strong>Canali Venturi</strong>) che accelerano l’aria creando bassa pressione (effetto ventosa).<br>• Più l’auto viaggia bassa vicino all’asfalto (es. 18–25 mm), più l’effetto suolo è potente.<br>• <strong>Porpoising:</strong> Se però abbassi troppo il fondo (< 18 mm) oltre i 270 km/h, il flusso d’aria sotto l’auto va in stallo ritmico facendo rimbalzare il muso su e giù!',
            proTip: 'Se noti rimbalzi ad altissima velocità, apri il DRS in rettilineo o alza di 2-3 mm l’Altezza Fondo nelle Impostazioni Pro.'
          }
        ]
      },
      {
        id: 'tires_pit',
        tabLabel: '3. GOMME & PIT-STOP',
        articles: [
          {
            badge: 'PIRELLI F1',
            badgeColor: '#ff2424',
            title: 'Le 5 Mescole di Gomme: Soft, Medium, Hard, Inter & Wet',
            subtitle: 'Come scegliere lo pneumatico giusto per ogni gara e condizione meteo',
            body: '• 🔴 <strong>Soft (S - Rossa):</strong> Gomma morbidissima. Ha il massimo grip immediato (+6%), perfetta per Qualifica o gare brevi, ma si consuma velocemente.<br>• 🟡 <strong>Medium (M - Gialla):</strong> La gomma più versatile: ottimo compromesso tra aderenza e resistenza all’usura.<br>• ⚪ <strong>Hard (H - Bianca):</strong> Mescola dura. Impiega mezzo giro a scaldarsi ma dura il doppio della Soft.<br>• 🟢 <strong>Intermediate (I - Verde):</strong> Per asfalto umido o pioggia leggera.<br>• 🔵 <strong>Full Wet (W - Blu):</strong> Per pioggia forte; espelle fino a 85 litri d’acqua al secondo evitando l’<strong>Aquaplaning</strong> nelle pozzanghere.',
            proTip: 'Se inizia a piovere in modalità Meteo Dinamico e hai le gomme da asciutto (S/M/H), rientra subito ai box [P] per montare le Intermedie!',
            svgDiagram: SVG_TIRES_DIAGRAM
          },
          {
            badge: 'TERMICA GOMME',
            badgeColor: '#ffd13b',
            title: 'Temperatura Superficie vs Carcassa (S/C), Graining & Marbles',
            subtitle: 'Cosa indicano i gradi °C accanto alla barra di usura gomme nell’HUD',
            body: 'Nell’angolo in alto a destra vedi due temperature, ad esempio <code>S:96°/C:92°</code>:<br>• <strong>S (Superficie):</strong> Si scalda subito quando sterzi, freni o fai pattinare le ruote.<br>• <strong>C (Carcassa interna):</strong> Si scalda più lentamente e mantiene la gomma nella finestra ottimale (85°C–105°C per le slick).<br>• <strong>Graining & Blistering:</strong> Se derapi a gomme fredde (< 78°C) rovini la superficie (<em>Graining</em>); se le surriscaldi (> 115°C) si formano bolle interne (<em>Blistering</em>).<br>• <strong>Marbles:</strong> Fuori dalla traiettoria ideale l’asfalto è pieno di riccioli di gomma staccati dalle auto: se ci vai sopra appare <code>⚠ MARBLES SU GOMMA</code> e perdi grip finché non si ripuliscono!',
            proTip: 'Nel giro di lancio in Qualifica fai curve decise per portare le gomme oltre gli 88°C prima di iniziare il giro cronometrato.'
          },
          {
            badge: 'STRATEGIA BOX',
            badgeColor: '#22e56b',
            title: 'Pit-Stop ai Box (Tasto [P]), Carburante & Freni in Carbonio',
            subtitle: 'Come cambiare gomme e riparare l’ala danneggiata in 2.4 secondi',
            body: '• <strong>Come fare il Pit-Stop:</strong> Sul rettilineo di partenza/arrivo (accanto al muretto box), quando appare il badge verde <code>🔧 [P] PIT-STOP DISPONIBILE</code>, rallenta sotto i 185 km/h e premi <strong>[P]</strong> (oppure <strong>[3]</strong> alla radio). La squadra meccanici 3D monterà gomme nuove al 100% e riparerà eventuali danni alle ali in <strong>2,4 secondi</strong>!<br>• <strong>Peso Carburante (kg):</strong> Ogni giro consumi benzina (indicata con ⛽ in alto a destra): con meno chili a bordo l’auto accelera e frena sempre più forte!<br>• <strong>Freni in Carbonio:</strong> Rendono al 100% tra 400°C e 850°C.',
            proTip: 'Premi [1] o [2] durante la gara per parlare via Radio con l’Ingegnere di Pista e conoscere lo stato esatto di gomme, meteo e distacchi!'
          }
        ]
      },
      {
        id: 'setup_eng',
        tabLabel: '4. ASSETTO AUTO',
        articles: [
          {
            badge: 'AERODINAMICA',
            badgeColor: '#00e5ff',
            title: 'Carico Ali (Front & Rear Wing: 1 – 50)',
            subtitle: 'Velocità di punta in rettilineo contro aderenza in curva',
            body: 'Le ali spingono gli pneumatici contro l’asfalto ma oppongono resistenza all’aria:<br>• <strong>Valori Bassi (10 – 18, Assetto Scarico):</strong> L’auto vola sui rettilinei (ideale per <em>Monza</em>), ma richiede spazi di frenata più lunghi e più cautela in curva.<br>• <strong>Valori Alti (34 – 48, Alto Carico):</strong> L’auto è incollata all’asfalto nelle curve strette e sul bagnato (ideale per <em>Night City</em> o <em>Alpi GP</em>), ma perde 8–12 km/h di velocità massima.<br>• <strong>Bilanciamento Ant/Post:</strong> Avere l’Ala Anteriore più alta della Posteriore rende il muso aggressivo in ingresso curva; avere l’Ala Posteriore più alta rende la coda stabilissima.',
            proTip: 'Non sai cosa scegliere? Usa il menu a tendina "Assetto: Bilanciato" o "Assetto: Scarico" e il tuo Ingegnere regolerà i cursori per te!'
          },
          {
            badge: 'MECCANICA & FRENI',
            badgeColor: '#ff2442',
            title: 'Ripartizione Frenata (Brake Bias) & Differenziale',
            subtitle: 'Come cucire il comportamento della monoposto sul tuo stile di guida',
            body: '• <strong>Brake Bias (50% – 66% Anteriore):</strong> Indica quanta forza frenante va alle ruote davanti. Spostarlo avanti (59%–62%) rende l’auto dritta e sicura nelle staccate violente; spostarlo indietro (53%–55%) aiuta l’auto a ruotare dentro la curva mentre freni.<br>• <strong>Differenziale On-Throttle (50% – 100%):</strong> Regola quanto le due ruote posteriori girano solidali quando premi il gas. Un valore basso (55%–65%) riduce il rischio di testacoda in uscita dalle curve lente; un valore alto (80%–95%) massimizza la trazione per piloti esperti.<br>• <strong>Differenziale Off-Throttle:</strong> Più è basso, più l’auto gira agile quando rilasci l’acceleratore.',
            proTip: 'Sotto la pioggia, abbassa il Brake Bias a 54-55% e il Differenziale On-Throttle a 60% per avere una trazione dolcissima.'
          },
          {
            badge: 'SOSPENSIONI & PSI',
            badgeColor: '#22e56b',
            title: 'Rigidità Sospensioni, Altezza Fondo (mm) & Pressione Gomme (PSI)',
            subtitle: 'Regolazioni millimetriche nelle Impostazioni Pro (Tasto [O])',
            body: '• <strong>Sospensioni (1 – 20):</strong> Sospensioni rigide (14–18) mantengono piatto il fondo Venturi nei cambi di direzione rapidi; sospensioni morbide (5–9) assorbono meglio i cordoli alti e danno più grip meccanico sul bagnato.<br>• <strong>Altezza Fondo (18 – 42 mm):</strong> Più è bassa, più aumenta l’Effetto Suolo (ma attenzione alle scintille sui dossi e al Porpoising sotto i 18 mm!).<br>• <strong>Pressione Gomme (20.0 – 26.0 PSI):</strong> Pressioni più alte scaldano più in fretta la gomma e riducono l’attrito in rettilineo; pressioni più basse aumentano l’impronta a terra nei circuiti tortuosi.',
            proTip: 'Premi [O] in qualsiasi momento (anche durante la gara!) per aprire le Impostazioni Pro a 5 schede e modificare l’assetto in tempo reale.'
          }
        ]
      },
      {
        id: 'rules_collisions',
        tabLabel: '5. SCONTRI & BANDIERE',
        articles: [
          {
            badge: 'FISICA CONTATTI',
            badgeColor: '#ff7a33',
            title: 'Meccanica degli Scontri tra Monoposto & Danni Aerodinamici',
            subtitle: 'Cosa succede nei contatti ruota-a-ruota, nei tamponamenti e negli urti laterali',
            body: 'Il motore fisico a 240Hz calcola la sagoma reale della monoposto (4,85m × 2,0m) distinguendo tre tipi di contatto:<br>• <strong>1. Duello Ruota a Ruota (Side Rubbing):</strong> Sfregamento laterale tra fiancate o gomme. Genera scintille in titanio e una spinta laterale realistica senza farti girare all’istante.<br>• <strong>2. Tamponamento (Nose-to-Diffuser):</strong> Se colpisci il retro di un avversario con il muso, trasferisci velocità in avanti a lui mentre tu subisci <strong>Danno all’Ala Anteriore</strong> (spruzzo di frammenti in fibra di carbonio e perdita fino al 30% di carico anteriore!).<br>• <strong>3. Impatto Angolare (T-Bone / Divebomb):</strong> Colpire la coda o l’avantreno di lato genera una coppia di rotazione fisica sul baricentro.',
            proTip: 'Tieni attivo il Radar di Prossimità 360° in basso al centro: diventa GIALLO quando un rivale è vicino e ROSSO quando è affiancato alle tue ruote!'
          },
          {
            badge: 'DIREZIONE GARA FIA',
            badgeColor: '#ffd13b',
            title: 'Bandiere FIA, Safety Car & Patente Pilota (Safety Rating)',
            subtitle: 'Come funzionano le regole ufficiali durante il Gran Premio',
            body: '• 🟢 <strong>Bandiera Verde:</strong> Pista libera, DRS ed ERS consentiti.<br>• 🟡 <strong>Bandiera Gialla:</strong> Auto ferma o incidente davanti a te. Massima prudenza, la Safety Car è pronta in uscita box.<br>• 🟠 <strong>VSC (Virtual Safety Car):</strong> Limitatore automatico attivo a <strong>195 km/h</strong> su tutto il circuito e DRS bloccato.<br>• 🔵 <strong>Bandiera Blu (Doppiaggi):</strong> Le AI doppiate si spostano automaticamente fuori dalla traiettoria ideale per lasciarti passare!<br>• 🪪 <strong>Patente FIA (Licenza S/A/B/C & SR):</strong> Gareggiare pulito senza uscire di pista aumenta il tuo Safety Rating (%) e vincere alza il tuo Skill Rating (SR).',
            proTip: 'Al termine di ogni gara puoi analizzare il grafico della tua Telemetria (Velocità, Gas, Freno) ed esportarlo in formato JSON!'
          }
        ]
      },
      {
        id: 'controls_hud',
        tabLabel: '6. COMANDI & HUD',
        articles: [
          {
            badge: 'TASTIERA & GAMEPAD',
            badgeColor: '#00e5ff',
            title: 'Mappa Completa dei Comandi (Tastiera & Controller)',
            subtitle: 'Tutti i tasti per dominare la monoposto, il cambio manuale e la radio box',
            body: '• <strong>Acceleratore / Freno:</strong> <code>W</code> / <code>S</code> oppure <code>Freccia Su</code> / <code>Giù</code> (Gamepad: <code>RT</code> / <code>LT</code>)<br>• <strong>Sterzo Sinistra / Destra:</strong> <code>A</code> / <code>D</code> oppure <code>Frecce</code> (Gamepad: <code>Stick Sinistro</code>)<br>• <strong>Cambio Marcia Manuale:</strong> <code>E</code> sali di marcia • <code>Q</code> scala / retromarcia da fermo (Gamepad: <code>RB</code> / <code>LB</code>) — <em>Attiva prima "Cambio Man." nel menu!</em><br>• <strong>DRS (Ala Mobile):</strong> <code>SHIFT</code> (Gamepad: <code>Y / Triangolo</code>)<br>• <strong>Modalità ERS / Boost Overtake:</strong> <code>B</code> cambia modalità • <code>SPAZIO</code> boost manuale (Gamepad: <code>A / X</code>)<br>• <strong>Pit-Stop ai Box:</strong> <code>P</code> sul rettilineo box • <strong>Radio Ingegnere:</strong> <code>1</code> Gomme/Meteo • <code>2</code> Distacchi • <code>3</code> Chiama Box',
            proTip: 'Altre scorciatoie utili: [C] Cambia Visuale (Chase / T-Cam / Cockpit / Nose) • [H] Mostra/Nascondi Halo • [V] Instant Replay TV • [R] Reset in pista • [O] Impostazioni Pro.'
          },
          {
            badge: 'PARTENZA & TELEMETRIA',
            badgeColor: '#c84bff',
            title: 'Partenza Perfetta (Launch Control) & Colori Settori S1 / S2 / S3',
            subtitle: 'Come scattare al via come un fulmine e leggere i tempi sul giro',
            body: '• <strong>Launch Control ai 5 Semafori Rossi:</strong> Mentre si accendono i 5 semafori rossi alla partenza, dosa l’acceleratore per tenere il motore tra <strong>9.500 e 12.000 RPM</strong> (il banner in alto diventa VERDE). Quando i semafori si spengono (<em>LIGHTS OUT!</em>), avrai il <strong>+14% di trazione immediata</strong>! Se invece tieni tutto il gas a 15.000 RPM senza TC, le gomme posteriori pattineranno.<br>• <strong>Colori dei 3 Settori (S1, S2, S3):</strong><br>  🟨 <strong>Giallo:</strong> Più lento del tuo record.<br>  🟩 <strong>Verde:</strong> Miglior tempo personale in quel settore.<br>  🟪 <strong>Viola (Fucsia):</strong> Record ASSOLUTO della sessione tra tutti i 10 piloti!',
            proTip: 'Nella modalità Time Attack comparirà anche la Ghost Car (auto fantasma trasparente) del tuo miglior giro per sfidare te stesso curva dopo curva!'
          }
        ]
      }
    ]
  },

  en: {
    langToggleBtn: '🇬🇧 EN',
    wikiBtnMenu: '📖 F1 WIKI',
    wikiBtnPause: '📖 F1 WIKI & MECHANICS GUIDE',
    subtitle: 'MULTI-LAYER TIRES • GROUND EFFECT • HDR BLOOM • 60+ FPS',
    zoomHint: '🖱️ 360° • Zoom',
    settingsProBtn: '⚙️ PRO SETTINGS',
    audioOn: '🔊 Audio ON',
    audioOff: '🔇 Audio OFF',
    licensePrefix: '🪪 LICENSE',

    panel1Title: 'TEAM & RACE ENGINEER SETUP',
    statSpeed: 'TOP SPEED',
    statAccel: 'ACCEL.',
    statGrip: 'GRIP',
    statAero: 'AERO/DRS',
    compoundLabel: 'COMPOUND',
    setupPresets: {
      balanced: 'Setup: Balanced',
      low_drag: 'Setup: Low Drag (Vmax)',
      high_downforce: 'Setup: High Downforce',
      anti_understeer: 'Fix Understeer',
      anti_oversteer: 'Fix Oversteer'
    },
    sliderWing: 'WING',
    sliderBrakes: 'BRAKES',
    sliderSusp: 'SUSP.',
    assistLine: '3D Line',
    assistManual: 'Manual Gear',

    panel2Title: 'GAME MODE & CIRCUIT',
    modeQuickRace: 'QUICK RACE',
    modeWeekend: 'QUALI + GP',
    modeChamp: 'CHAMPIONSHIP',
    modeTimeAttack: 'TIME ATTACK',
    metaEnv: 'SETTING',
    metaSession: 'SESSION',
    metaLayout: 'LAYOUT',
    metaReverse: 'Reverse',
    lapsUnit: 'Laps',
    lapsFree: 'Free Run',
    lapsWeekend: 'Q3 + 3 Laps',
    weatherDry: '☀️ Dry',
    weatherOvercast: '⛅ Overcast',
    weatherRain: '🌧️ Rain',
    weatherDynamic: '🌦️ Dynamic',
    diffRookie: 'AI: Rookie',
    diffPro: 'AI: Pro',
    diffAce: 'AI: Ace',
    diffLegend: 'AI: Legend',
    qualLow: 'FPS: Low',
    qualMed: 'Graphics: Medium',
    qualHigh: 'Graphics: High',
    qualUltra: 'Graphics: Ultra',
    launchBtn: 'START SESSION',

    teamTaglines: {
      ferrari: 'Balanced chassis, supreme corner-exit traction',
      monster: 'Low-drag aero package, blistering straight-line speed',
      mcdonalds: 'Razor-sharp front end, agile in technical chicanes',
      redbull: 'Maximum ground-effect downforce & aero efficiency',
      mercedes: 'Laser-precise braking stability & high-speed poise'
    },
    trackBadges: {
      monza: 'HIGH SPEED',
      night_city: 'NIGHT STREET',
      desert: 'SUNSET GP',
      alpine: 'ELEVATION'
    },
    trackDescs: {
      monza: 'Temple of Speed: 345 km/h straights, heavy-braking chicanes & historic parkland.',
      night_city: 'Tight street barriers, illuminated skyscrapers, neon tunnel & mirror asphalt.',
      desert: 'Fast sweeping corners across sculpted dunes, glowing towers & stadium floodlights.',
      alpine: 'Steep Eau Rouge-style climbs, fast downhill sweeps, pine forests & snowy peaks.'
    },
    trackEnvs: {
      monza: 'Daylight',
      night_city: 'Neon Night',
      desert: 'Sunset',
      alpine: 'Mountain'
    },

    lapWord: 'LAP',
    qualifyingTag: 'QUALIFYING Q3',
    flagGreen: '🟢 GREEN FLAG • TRACK CLEAR',
    flagWet: (pct) => `🌧️ WET TRACK (${pct}%) • DRS DISABLED`,
    flagYellow: '🟡 YELLOW FLAG • HAZARD ON TRACK',
    flagVsc: '🟠 VSC • VIRTUAL SAFETY CAR (MAX 195 KM/H)',
    launchOptimal: (rpm) => `🎯 OPTIMAL LAUNCH RPM (${rpm} RPM) — READY!`,
    launchTooHigh: (rpm) => `⚠ RPM TOO HIGH (${rpm} RPM) — WHEELSPIN RISK!`,
    launchHold: (rpm) => `🎯 HOLD THROTTLE AT 9,500–12,000 RPM (${rpm} RPM)`,
    launchPerfectBanner: '🚀 PERFECT LAUNCH CONTROL (+14% TRACTION)!',
    launchWheelspinBanner: 'LIGHTS OUT — ⚠ WHEELSPIN OFF THE LINE!',
    launchGoBanner: 'LIGHTS OUT AND AWAY WE GO!',
    radioTitle: '📻 RACE ENGINEER RADIO',
    wrongWayBanner: '⚠ WRONG WAY — PRESS R TO RESET',
    badgeSlipstream: 'SLIPSTREAM TOW',
    badgeDirtyAir: 'DIRTY AIR WAKE',
    badgeDrsOpen: 'DRS OPEN',
    badgePitAvail: '🔧 [P] PIT-STOP AVAILABLE',
    badgeMarbles: '⚠ TIRE MARBLES',
    badgeTrackLimits: '⚠ TRACK LIMITS',
    badgeReplay: '⏪ TV REPLAY — PRESS V',
    timeLap: 'LAP',
    timeBest: 'BEST',
    trackTempLabel: 'TRACK',
    wingWarnAero: '⚠ AERO DAMAGE — PIT [P]',
    wingWarnPuncture: '⚠ PUNCTURE! BOX NOW [P]',
    drsOpen: 'DRS OPEN',
    drsReady: 'DRS [SHIFT]',
    drsClosed: 'DRS CLOSED',
    ersModes: {
      none: 'CHARGE',
      medium: 'MEDIUM',
      overtake: 'OVERTAKE',
      hotlap: 'HOTLAP Q3'
    },

    bannerCarReset: 'CAR RESET ON TRACK',
    bannerFinalLap: '🔥 FINAL LAP!',
    bannerSettingsReset: 'DEFAULT SETTINGS RESTORED',
    bannerHaloHidden: 'HALO: HIDDEN',
    bannerHaloVisible: 'HALO: VISIBLE',
    bannerQualiStart: (t) => `${t} — ONE-SHOT QUALIFYING`,
    bannerGridStart: (t, p) => `${t} — STARTING GRID (P${p})`,
    bannerCollisionRub: '⚔ WHEEL-TO-WHEEL CONTACT!',
    bannerCollisionWing: '💥 HEAVY CONTACT — CHECK FRONT WING!',
    radioTiresWeather: (wear, s, c, t, w) =>
      `Tires at ${wear}% (Surf: ${s}°C / Core: ${c}°C). Track ${t}°C, wetness ${w}%.`,
    radioGapLeader: (fuel) =>
      `You are P1 (RACE LEADER)! Manage your pace, remaining fuel: ${fuel}kg.`,
    radioGapChasing: (pos, code, gap, fuel) =>
      `You are P${pos}. Gap to ${code} ahead: +${gap}s. Fuel remaining: ${fuel}kg.`,
    radioPitService: 'Box, box! Pit crew servicing: fresh tires & wing repair (2.4s)...',
    radioPitConfirm: 'Pit request confirmed! Press [P] on the main pit straight at reduced speed.',
    radioFinalLap: 'Final lap! Deploy all remaining ERS energy in OVERTAKE mode [B]!',
    radioFastestLap: (t) => `⚡ Personal Fastest Lap: ${t}!`,
    radioCollisionWarn: 'Contact detected! Watch your front wing downforce and tire temperatures.',

    pauseTitle: '⏸ SESSION PAUSED',
    pauseSub: 'WASD Drive • SHIFT DRS • SPACE/B ERS • Q/E Gears • P Pit-Stop • 1/2/3 Radio • H Halo • V Replay • C Camera • O Settings',
    pauseResume: 'RESUME SESSION',
    pauseSettings: '⚙️ PRO SETTINGS',
    pauseRestart: 'RESTART SESSION',
    pauseBackMenu: 'RETURN TO SHOWROOM',

    finishEyebrowQuali: 'Q3 QUALIFYING COMPLETE — STARTING GRID',
    finishEyebrowRace: 'CHEQUERED FLAG',
    finishQualiTitles: {
      1: '⚡ POLE POSITION — P1 ON THE GRID!',
      2: '🔥 FRONT ROW — P2 ON THE GRID!',
      3: '🏁 SECOND ROW — P3 ON THE GRID!'
    },
    finishRaceTitles: {
      1: '🏆 1ST PLACE — GRAND PRIX VICTORY!',
      2: '🥈 2ND PLACE — PODIUM FINISH!',
      3: '🥉 3RD PLACE — PODIUM FINISH!'
    },
    finishQualiGeneric: (p) => `P${p} — STARTING GRID LOCKED`,
    finishRaceGeneric: (p) => `P${p} — RACE COMPLETED`,
    finishBestLap: 'Best Lap',
    finishYou: '(YOU)',
    finishTelemetryHead: '📈 FASTEST LAP TELEMETRY (SPEED / THROTTLE / BRAKE)',
    finishNoTelemetry: 'No telemetry trace recorded yet',
    finishNextSession: 'NEXT SESSION ▶',
    finishStartGP: (p) => `START GRAND PRIX (GRID P${p}) ▶`,
    finishNextChamp: 'NEXT CHAMPIONSHIP ROUND ▶',
    finishReplayRace: 'RACE AGAIN',
    finishBackShowroom: 'RETURN TO SHOWROOM',

    setEyebrow: 'TELEMETRY & SIMULATOR CONFIGURATION',
    setTitle: '⚙️ PRO SIMULATOR SETTINGS',
    setCloseTop: '✕ CLOSE',
    setTab1: '1. GRAPHICS & PBR',
    setTab2: '2. CAMERA & COCKPIT',
    setTab3: '3. CAR ENGINEERING',
    setTab4: '4. CONTROLS & FFB',
    setTab5: '5. AUDIO, AI & FIA',
    setRes: 'Render Resolution Scale',
    setShadows: 'Shadow Map Quality',
    setShadowOff: 'Disabled / Off',
    setShadowMed: '1024x1024 (Medium)',
    setShadowHigh: '2048x2048 (High)',
    setShadowUltra: '4096x4096 (Ultra)',
    setEnv: 'PBR Clearcoat & Env Reflections',
    setBloom: 'HDR Bloom Intensity',
    setExp: 'ACES Filmic Exposure',
    setVig: 'High-Speed Vignette',
    setSmaa: 'SMAA Anti-Aliasing',
    setGov: 'Adaptive 60+ FPS Governor',
    setFov: 'Field of View (FOV Offset)',
    setSpeedFov: 'Dynamic Speed FOV Warp',
    setSeatH: 'Cockpit Seat Height',
    setSeatFore: 'Cockpit Seat Fore/Aft',
    setPitch: 'Camera Pitch Angle',
    setShake: 'Camera & Curb Shake',
    setRoll: 'Cornering Horizon Roll',
    setHaloRadar: 'Halo Pillar & Proximity Radar',
    setNoHalo: 'Hide Halo',
    setRadar360: '360° Radar',
    setFWing: 'Front Wing Aero Load',
    setRWing: 'Rear Wing Aero Load',
    setBBias: 'Front Brake Bias (%)',
    setBPress: 'Brake System Pressure',
    setDiffOn: 'On-Throttle Differential Lock',
    setDiffOff: 'Off-Throttle Differential Lock',
    setSusp: 'Suspension Stiffness',
    setRidePsi: 'Floor Ride Height / Tire PSI',
    setSens: 'Steering Sensitivity',
    setLin: 'Steering Linearity (Gamma)',
    setDz: 'Steering Deadzone',
    setFfb: 'Controller Rumble / FFB Strength',
    setBAssist: 'Corner Braking Assist',
    setBAssistOff: 'Off (Pure Simulator)',
    setBAssistLow: 'Low Assist',
    setBAssistHigh: 'High Assist',
    setTcLabel: 'Traction Control (TC)',
    setAbsGearbox: 'ABS, Gearbox & Racing Line',
    setManualGear: 'Manual Gearbox',
    setLine3D: '3D Racing Line',
    setVol: 'Master Audio Volume',
    setAiLevel: 'AI Rival Skill Level (1–110)',
    setAiAgg: 'AI Wheel-to-Wheel Aggression',
    setDmg: 'Aero Damage Multiplier',
    setWear: 'Tire Wear Multiplier',
    setFuel: 'Fuel Burn Multiplier',
    setLimits: 'FIA Track Limits Strictness',
    setLimitsOff: 'Disabled / Off',
    setLimitsStd: 'FIA Standard (3 warns = +3s)',
    setLimitsStrict: 'Strict Championship',
    setTod: 'Time-of-Day Cycle Speed',
    setResetBtn: '↺ RESET TO DEFAULTS',
    setApplyBtn: '✓ APPLY & CLOSE',

    wikiEyebrow: 'INTERACTIVE ENCYCLOPEDIA FOR BEGINNERS & SIM RACERS',
    wikiTitle: '📖 FORMULA 1 WIKI & DRIVING ACADEMY',
    wikiSub: 'New to Formula 1? Learn what Apex, ERS, DRS, Understeer, Dirty Air, and Tire Marbles mean—and how to use them to win in APEX GP 3D.',
    wikiCloseBtn: '✕ CLOSE WIKI',
    wikiCategories: [
      {
        id: 'driving',
        tabLabel: '1. DRIVING & APEX',
        articles: [
          {
            badge: 'CORE CONCEPT #1',
            badgeColor: '#22e56b',
            title: 'What is the APEX and the Ideal Racing Line?',
            subtitle: 'How to carry +30 km/h more speed through every corner without running wide',
            body: 'In Formula 1 you never follow the center of the road. To take a corner as fast as possible, you "flatten" its radius using the golden rule: <strong>Outside → Inside (APEX) → Outside</strong>.<br>• <strong>1. Turn-In (Outside):</strong> Before a right-hand corner, position your car on the far left edge of the asphalt.<br>• <strong>2. The APEX (Clipping Point):</strong> The innermost point on the inside curb midway through the turn that your inside tires should kiss.<br>• <strong>3. Exit (Outside):</strong> As soon as you clip the Apex, unwind the steering wheel and smoothly squeeze full throttle, letting the car drift out to the exit curb.',
            proTip: 'Enable the "3D Line" assist: it glows GREEN for full throttle, YELLOW for lift/coast, and RED where you must brake hard!',
            svgDiagram: SVG_APEX_DIAGRAM
          },
          {
            badge: 'BRAKING TECHNIQUE',
            badgeColor: '#ff2442',
            title: 'Aero Braking & Trail Braking',
            subtitle: 'Why an F1 car brakes hardest at 320 km/h and locks up if you brake late inside the turn',
            body: 'At 300+ km/h, the wings and underfloor press the car down with over 1,500 kg of aerodynamic <em>Downforce</em>. Therefore:<br>• <strong>Initial Hit:</strong> At high speed in a straight line, hit 100% brake pressure immediately.<br>• <strong>Trail Braking:</strong> As speed drops, aerodynamic downforce fades. As you begin turning the steering wheel toward the Apex, progressively bleed off the brake pedal so the front tires have enough grip to turn without locking up (avoiding white tire smoke and flat-spots!).',
            proTip: 'If you turn off ABS for maximum realism, always do your hardest braking in a straight line before turning into the corner.'
          },
          {
            badge: 'CAR BALANCE',
            badgeColor: '#ffd13b',
            title: 'Understeer vs Oversteer Explained Simply',
            subtitle: 'How to tell whether the front nose or the rear tail is losing grip',
            body: '• <strong>Understeer (Pushing Wide):</strong> You turn the steering wheel, but the front tires slide and the car plows straight toward the outside barrier. <em>Fix:</em> brake slightly earlier or increase Front Wing angle.<br>• <strong>Oversteer (Rear Slide / Spin):</strong> The rear tires lose traction when accelerating and the tail steps out sideways. <em>Fix:</em> apply throttle more progressively exiting slow corners, counter-steer into the slide, or set Traction Control to <em>TC: MED / FULL</em>.',
            proTip: 'Use the quick "Fix Understeer" or "Fix Oversteer" engineer presets in the showroom to tune the car to your driving style!'
          },
          {
            badge: 'SURFACES & RULES',
            badgeColor: '#ff7a33',
            title: 'Curbs (Kerbs), Grass/Gravel Runoff & FIA Track Limits',
            subtitle: 'When to attack the curbs and how to recover cleanly from going off-track',
            body: '• <strong>Curbs:</strong> The painted red/white ridges at corner entry, apex, and exit. Clipping them shortens the corner (and triggers titanium floor sparks!), though they offer ~8% less grip than pure asphalt.<br>• <strong>Grass & Gravel (Off-Track):</strong> Running off-track kicks up grass blades and dirt clods while natural ground resistance slows you down. Ease off full throttle and steer smoothly back onto the asphalt—never yank the wheel abruptly. Cutting corners at high speed 3 times earns a <strong>+3s FIA Time Penalty</strong>.',
            proTip: 'Stuck against a barrier or facing the wrong way? Press [R] anytime to instantly reset your car cleanly onto the track.'
          }
        ]
      },
      {
        id: 'power_aero',
        tabLabel: '2. ERS, DRS & AERO',
        articles: [
          {
            badge: 'HYBRID POWER UNIT',
            badgeColor: '#00e5ff',
            title: 'What is ERS (Energy Recovery System) and How Do You Use It?',
            subtitle: '160 HP of electric boost harvested automatically under braking!',
            body: 'Modern F1 cars pair a 1.6L V6 Turbo engine with two electric motor-generators (<strong>MGU-K</strong> kinetic & <strong>MGU-H</strong> turbo exhaust).<br>• <strong>Harvesting (Recharging):</strong> Whenever you brake for a corner, kinetic energy recharges the battery (the ERS bar turns GREEN).<br>• <strong>4 ERS Deployment Modes (Key [B] + [SPACE] Override):</strong><br>  1. 🟢 <strong>CHARGE (NONE):</strong> Saves battery and harvests at 145% rate.<br>  2. 🟡 <strong>MEDIUM:</strong> Balanced automatic deployment across the whole lap.<br>  3. 🔵 <strong>OVERTAKE:</strong> Maximum electric power for passing or defending on straights!<br>  4. 🟣 <strong>HOTLAP Q3:</strong> All-out 114% qualifying power output.',
            proTip: 'Hold [SPACE] coming out of a key corner to manually trigger maximum Overtake boost at any time!',
            svgDiagram: SVG_ERS_DRS_DIAGRAM
          },
          {
            badge: 'ACTIVE AERO',
            badgeColor: '#22e56b',
            title: 'What is DRS (Drag Reduction System)?',
            subtitle: 'Open the rear wing flap on designated straights for +18 km/h top speed',
            body: 'High downforce helps in corners, but creates aerodynamic drag ("air resistance") on straights.<br>• <strong>How it works:</strong> Inside designated <strong>DRS Zones</strong> (the main straights marked by green trackside boards), your HUD pill lights up green: <code>DRS [SHIFT]</code>.<br>• <strong>Activation:</strong> Press <strong>[SHIFT]</strong> while on the throttle: the rear wing flap opens flat, slicing drag by 25%, and automatically snaps shut the instant you tap the brakes!',
            proTip: 'Under FIA safety rules, DRS is automatically disabled in wet rain conditions or under Virtual Safety Car (VSC).'
          },
          {
            badge: 'AERODYNAMICS',
            badgeColor: '#c84bff',
            title: 'Slipstream (Drafting Tow) vs Dirty Air (Wake Turbulence)',
            subtitle: 'Why following closely boosts speed on straights but hurts grip in fast corners',
            body: '• <strong>Slipstream (Yellow Badge):</strong> Following within 44 meters of a rival on a straight lets them punch a hole through the air for you, cutting your drag by up to 21% so you can slingshot past!<br>• <strong>Dirty Air (Orange Badge):</strong> Following within 26 meters <em>inside a fast corner</em> starves your wings of clean airflow: you lose up to <strong>16% aerodynamic downforce</strong> (causing understeer) and run hotter brake and tire temperatures!',
            proTip: 'When stuck in Dirty Air through fast sweepers, offset your line slightly by 1–2 meters to feed clean air onto your front wing.'
          },
          {
            badge: 'VENTURI FLOOR',
            badgeColor: '#00a8ff',
            title: 'Ground Effect (Venturi Tunnels) & Porpoising',
            subtitle: 'How the underfloor sucks the car onto the asphalt above 250 km/h',
            body: 'Over 60% of a modern F1 car’s downforce comes from twin sculpted <strong>Venturi Tunnels</strong> underneath the floor that accelerate airflow to create a low-pressure vacuum seal against the track.<br>• Lower ride heights (18–25 mm) amplify Ground Effect suction.<br>• <strong>Porpoising:</strong> If the floor drops too close to the ground (< 18 mm) above 270 km/h, airflow momentarily stalls and re-attaches, causing aerodynamic bouncing!',
            proTip: 'Opening DRS on straights or raising Floor Ride Height by 2 mm in Pro Settings eliminates high-speed porpoising.'
          }
        ]
      },
      {
        id: 'tires_pit',
        tabLabel: '3. TIRES & PIT-STOP',
        articles: [
          {
            badge: 'PIRELLI COMPOUNDS',
            badgeColor: '#ff2424',
            title: 'The 5 Tire Compounds: Soft, Medium, Hard, Inter & Wet',
            subtitle: 'Choosing between peak qualifying grip, race endurance, and wet-weather drainage',
            body: '• 🔴 <strong>Soft (S - Red):</strong> Peak mechanical grip (+6%) and rapid warm-up. Best for Qualifying or short sprints, but wears fastest.<br>• 🟡 <strong>Medium (M - Yellow):</strong> Ideal all-rounder balancing pace and durability.<br>• ⚪ <strong>Hard (H - White):</strong> Tough compound built for long stints and high-energy tracks.<br>• 🟢 <strong>Intermediate (I - Green):</strong> Grooved tread for damp or light rain conditions.<br>• 🔵 <strong>Full Wet (W - Blue):</strong> Deep channels clear standing water to prevent <strong>Aquaplaning</strong> in heavy rain.',
            proTip: 'In Dynamic Weather mode, watch the Track Wetness % in the top banner—pit for Inters [P] as soon as wetness crosses 45%!',
            svgDiagram: SVG_TIRES_DIAGRAM
          },
          {
            badge: 'TIRE THERMALS',
            badgeColor: '#ffd13b',
            title: 'Surface vs Core Temps (S/C), Graining, Blistering & Marbles',
            subtitle: 'How to read the dual temperature readout next to your tire wear bar',
            body: 'Your HUD shows dual temperatures like <code>S:96°/C:92°</code>:<br>• <strong>S (Surface Tread):</strong> Spikes rapidly during hard cornering, lockups, or wheelspin.<br>• <strong>C (Internal Carcass):</strong> Changes gradually and determines whether the tire sits in its optimal grip window (85°C–105°C for slicks).<br>• <strong>Graining & Blistering:</strong> Sliding on cold tires (< 78°C) tears the surface (<em>Graining</em>); overheating (> 115°C) cooks the carcass (<em>Blistering</em>).<br>• <strong>Marbles:</strong> Straying > 4m off the racing line picks up shed rubber chunks (<code>⚠ TIRE MARBLES</code>), temporarily reducing grip until cleaned off!',
            proTip: 'Keep your tires inside their optimal thermal window for maximum cornering speed and minimal wear.'
          },
          {
            badge: 'PIT STRATEGY',
            badgeColor: '#22e56b',
            title: '2.4-Second Pit Stops (Key [P]), Fuel Load & Carbon Brakes',
            subtitle: 'How to pit for fresh rubber and repair front wing damage',
            body: '• <strong>How to Pit:</strong> On the main start/finish straight alongside the pit wall, when <code>🔧 [P] PIT-STOP AVAILABLE</code> appears, slow below 185 km/h and press <strong>[P]</strong> (or Radio <strong>[3]</strong>). Your 3D pit crew swaps all 4 tires to 100% and repairs wing/diffuser damage in <strong>2.4 seconds</strong>!<br>• <strong>Fuel Weight (kg):</strong> Burning fuel lightens your car every lap, making it accelerate and corner faster late in the race.<br>• <strong>Carbon-Ceramic Brakes:</strong> Bite hardest between 400°C and 850°C.',
            proTip: 'Press [1] or [2] anytime during a race to ask your Race Engineer for a live Tire/Weather or Gap/Fuel status report!'
          }
        ]
      },
      {
        id: 'setup_eng',
        tabLabel: '4. CAR SETUP',
        articles: [
          {
            badge: 'AERO BALANCE',
            badgeColor: '#00e5ff',
            title: 'Front & Rear Wing Angles (1 – 50)',
            subtitle: 'Trading straight-line Vmax for cornering downforce',
            body: '• <strong>Low Wing (10 – 18, Low Drag):</strong> Slashes air resistance for 345+ km/h top speeds at <em>Monza</em>, but requires earlier braking.<br>• <strong>High Wing (34 – 48, High Downforce):</strong> Plants the car through tight city corners, alpine sweepers, and wet conditions.<br>• <strong>Front vs Rear Balance:</strong> Running higher Front Wing than Rear Wing sharpens turn-in bite (fixes understeer); higher Rear Wing plants the tail on corner exit (fixes oversteer).',
            proTip: 'Not sure where to start? Pick a Race Engineer preset in the Showroom and watch the sliders auto-adjust!'
          },
          {
            badge: 'BRAKES & DIFF',
            badgeColor: '#ff2442',
            title: 'Brake Bias (%) & On/Off-Throttle Differential',
            subtitle: 'Fine-tuning corner-entry stability and corner-exit traction',
            body: '• <strong>Front Brake Bias (50% – 66%):</strong> Controls front-to-rear braking split. Higher values (59%–62%) keep the rear stable in heavy braking zones; lower values (53%–55%) help rotate the nose toward the apex.<br>• <strong>On-Throttle Differential (50% – 100%):</strong> Controls how locked the two rear wheels are under acceleration. Lower values (55%–65%) prevent snap-oversteer exiting hairpins; higher values maximize traction on fast exits.<br>• <strong>Off-Throttle Differential:</strong> Lower values make the car rotate more eagerly when you lift off the throttle.',
            proTip: 'In the rain, shift Brake Bias rearward to ~55% and lower On-Throttle Diff to ~60% for smooth, predictable wet traction.'
          },
          {
            badge: 'SUSPENSION & PSI',
            badgeColor: '#22e56b',
            title: 'Suspension Stiffness, Ride Height (mm) & Tire Pressure (PSI)',
            subtitle: 'Advanced Pro Settings available anytime by pressing [O]',
            body: '• <strong>Suspension Stiffness (1 – 20):</strong> Stiffer springs keep the aero platform flat in high-speed chicanes; softer springs absorb tall curbs and improve mechanical grip.<br>• <strong>Ride Height (18 – 42 mm):</strong> Lower ride height boosts Ground Effect suction (watch out for curb bottoming sparks below 20 mm!).<br>• <strong>Tire Pressure (20.0 – 26.0 PSI):</strong> Higher PSI heats tires faster and reduces rolling resistance; lower PSI enlarges the contact patch for maximum mechanical grip.',
            proTip: 'Press [O] even mid-race to open the 5-Tab Pro Settings modal and tweak engineering parameters on the fly!'
          }
        ]
      },
      {
        id: 'rules_collisions',
        tabLabel: '5. COLLISIONS & FLAGS',
        articles: [
          {
            badge: 'IMPACT PHYSICS',
            badgeColor: '#ff7a33',
            title: 'Car-to-Car Collision Physics & Aero Damage',
            subtitle: 'How wheel-to-wheel rubbing, rear-ending, and angular impacts work',
            body: 'The 240Hz physics engine models the true oriented F1 chassis footprint (4.85m × 2.0m) across three impact regimes:<br>• <strong>1. Wheel-to-Wheel Rubbing:</strong> Side-by-side contact produces titanium sparks, tire scrub smoke, and a controllable lateral push.<br>• <strong>2. Rear-Ending (Nose-to-Diffuser):</strong> Striking a rival from behind transfers forward momentum while inflicting <strong>Front Wing Damage</strong> (shattering carbon-fiber shards and cutting front downforce by up to 30%!).<br>• <strong>3. Angular Side Impact:</strong> Hitting a rival’s front or rear axle off-center imparts realistic rotational yaw torque.',
            proTip: 'Watch the 360° Proximity Radar at bottom-center: rival markers turn YELLOW nearby and RED when directly alongside your wheels!'
          },
          {
            badge: 'FIA RACE CONTROL',
            badgeColor: '#ffd13b',
            title: 'FIA Flags, Virtual Safety Car (VSC) & Driver License',
            subtitle: 'Official motorsport rules and persistent Safety/Skill Rating',
            body: '• 🟢 <strong>Green Flag:</strong> Track clear, full racing speed and DRS enabled.<br>• 🟡 <strong>Yellow Flag:</strong> Hazard or slow car ahead—exercise caution.<br>• 🟠 <strong>VSC (Virtual Safety Car):</strong> Enforces a <strong>195 km/h</strong> pit-limiter speed cap across the track and disables DRS.<br>• 🔵 <strong>Blue Flags:</strong> Lapped AI rivals automatically yield off the racing line to let leaders pass cleanly!<br>• 🪪 <strong>FIA Driver License (S/A/B/C & SR):</strong> Clean laps boost your Safety Rating (%), while podiums increase your Skill Rating (SR).',
            proTip: 'After finishing any session, inspect your Fastest Lap Telemetry Trace graph and export your session data as JSON!'
          }
        ]
      },
      {
        id: 'controls_hud',
        tabLabel: '6. CONTROLS & HUD',
        articles: [
          {
            badge: 'KEYBOARD & GAMEPAD',
            badgeColor: '#00e5ff',
            title: 'Complete Controls Reference (Keyboard & Controller)',
            subtitle: 'Every keybind for driving, manual gear shifts, ERS/DRS, and pit radio',
            body: '• <strong>Throttle / Brake:</strong> <code>W</code> / <code>S</code> or <code>Up</code> / <code>Down Arrow</code> (Gamepad: <code>RT</code> / <code>LT</code>)<br>• <strong>Steer Left / Right:</strong> <code>A</code> / <code>D</code> or <code>Left</code> / <code>Right Arrow</code> (Gamepad: <code>Left Stick</code>)<br>• <strong>Manual Gear Shift:</strong> <code>E</code> Shift Up • <code>Q</code> Shift Down / Reverse from standstill (Gamepad: <code>RB</code> / <code>LB</code>) — <em>Enable "Manual Gear" checkbox first!</em><br>• <strong>DRS Wing:</strong> <code>SHIFT</code> (Gamepad: <code>Y / Triangle</code>)<br>• <strong>ERS Mode / Manual Boost:</strong> <code>B</code> Cycle Mode • <code>SPACE</code> Manual Overtake Boost (Gamepad: <code>A / Cross</code>)<br>• <strong>Pit-Stop:</strong> <code>P</code> on pit straight • <strong>Engineer Radio:</strong> <code>1</code> Tires/Weather • <code>2</code> Gaps/Fuel • <code>3</code> Box Request',
            proTip: 'Extra shortcuts: [C] Cycle Camera (Chase / T-Cam / Cockpit / Nose) • [H] Toggle Halo • [V] Instant TV Replay • [R] Reset Car • [O] Pro Settings.'
          },
          {
            badge: 'LAUNCH & SECTORS',
            badgeColor: '#c84bff',
            title: 'Perfect Grid Launch Control & Sector Colors (S1 / S2 / S3)',
            subtitle: 'How to nail the 5-light F1 start and read live broadcast timing',
            body: '• <strong>Grid Launch Control:</strong> While the 5 red start lights illuminate one by one, feather your throttle to hold engine revs between <strong>9,500 and 12,000 RPM</strong> (top banner turns GREEN). When the lights go out, you get <strong>+14% bite-point launch traction</strong>! Revving at 15,000 RPM with TC off causes rear wheelspin.<br>• <strong>Sector Pill Colors (S1, S2, S3):</strong><br>  🟨 <strong>Yellow:</strong> Slower than your personal best.<br>  🟩 <strong>Green:</strong> Personal best sector time.<br>  🟪 <strong>Purple:</strong> OVERALL fastest sector among all 10 drivers!',
            proTip: 'In Time Attack mode, a translucent 3D Ghost Car of your personal best lap races alongside you in real time!'
          }
        ]
      }
    ]
  }
};
