/**
 * APEX GP 3D — Serverless WebRTC P2P + BroadcastChannel Multiplayer Room System
 * - Create Room -> Generates Room Code (e.g. APEX-4821) + Shareable Invite Link (?room=APEX-4821)
 * - Join Room -> Join via Code or auto-join from Invite Link URL parameter
 * - Hybrid Transport:
 *   1. Global Internet P2P via WebRTC DataChannels (PeerJS public signaling + Google/Twilio STUN)
 *   2. Instant Local Multi-Tab / LAN fallback via BroadcastChannel
 * - 30Hz Dead-Reckoned Car Telemetry Sync + 3D Floating Driver Nametags
 */
import * as THREE from 'three';
import Peer, { type DataConnection } from 'peerjs';
import type { CarState, GameMode, TimeOfDayType, TireCompoundId, TrackData, WeatherType } from '../core/types';

const PEER_ID_PREFIX = 'apexgp3d-room-v2-';
const DRIVER_NAME_KEY = 'apex_gp_3d_driver_name_v1';

export interface LobbyChatMessage {
  sender: string;
  text: string;
  color: string;
  time: string;
}

export interface RoomMember {
  peerId: string;
  name: string;
  code: string; // 3-letter FIA broadcast tag
  teamId: string;
  compound: TireCompoundId;
  isHost: boolean;
  ready: boolean;
  pingMs: number;
  lastSeenMs: number;
}

export interface RoomSettingsPayload {
  trackId: string;
  weather: WeatherType;
  timeOfDay?: TimeOfDayType;
  mode?: GameMode;
  reverseTrack: boolean;
  fillWithBots: boolean;
}

export interface MultiplayerGridEntry {
  peerId: string | null; // null = AI Bot
  name: string;
  code: string;
  teamId: string;
  number: number;
  compound: TireCompoundId;
  gridSlot: number;
}

export interface MultiplayerRaceStartPacket {
  type: 'race_start';
  roomCode: string;
  settings: RoomSettingsPayload;
  grid: MultiplayerGridEntry[];
  timestamp: number;
}

export interface CarTelemetryPacket {
  type: 'car_telemetry';
  seq: number;
  peerId: string;
  clock: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  speed: number;
  steer: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  drs: boolean;
  brakeTemp: number;
  compound: TireCompoundId;
  tireWear: number;
  lap: number;
  raceDistance: number;
  bestLapTime: number;
  finished: boolean;
  finishTime: number;
  eliminated?: boolean;
  robberHealth?: number;
  robberArrested?: boolean;
  sirenActive?: boolean;
  infected?: boolean;
}

type NetPacket =
  | { type: 'join_req'; member: RoomMember }
  | { type: 'member_update'; member: RoomMember }
  | { type: 'leave_notify'; peerId: string }
  | { type: 'lobby_state'; roomCode: string; hostId: string; settings: RoomSettingsPayload; members: RoomMember[] }
  | { type: 'chat_msg'; msg: LobbyChatMessage }
  | { type: 'ping_req'; fromId: string; sentAt: number }
  | { type: 'ping_ack'; fromId: string; toId: string; sentAt: number }
  | MultiplayerRaceStartPacket
  | CarTelemetryPacket;

interface RemoteCarSnap {
  seq: number;
  receivedAtMs: number;
  targetPos: THREE.Vector3;
  vel: THREE.Vector3;
  targetYaw: number;
  speed: number;
  steer: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  drs: boolean;
  brakeTemp: number;
  compound: TireCompoundId;
  tireWear: number;
  lap: number;
  raceDistance: number;
  bestLapTime: number;
  finished: boolean;
  finishTime: number;
  eliminated?: boolean;
  robberHealth?: number;
  robberArrested?: boolean;
  sirenActive?: boolean;
  infected?: boolean;
}

export function normalizeRoomCode(raw: string): string {
  const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean) return '';
  if (clean.startsWith('APEX') && clean.length > 4) {
    return `APEX-${clean.slice(4, 8)}`;
  }
  return `APEX-${clean.slice(0, 4)}`;
}

export function generateRoomCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `APEX-${suffix}`;
}

export function makeDriverCode(name: string): string {
  const letters = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (letters + 'DRV').slice(0, 3);
}

export function createDriverNametagSprite(driverName: string, accentHex: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(7, 11, 18, 0.82)';
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(14, 10, 228, 44, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accentHex;
  ctx.beginPath();
  ctx.arc(34, 32, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = '900 20px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(driverName.slice(0, 14).toUpperCase(), 134, 33);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.3, 0.58, 1);
  sprite.position.set(0, 1.48, 0);
  sprite.renderOrder = 10;
  return sprite;
}

export class MultiplayerRoomManager {
  public localPeerId = `p_${Math.random().toString(36).slice(2, 10)}`;
  public driverName = 'PILOTA 16';
  public roomCode = '';
  public isHost = false;
  public isConnected = false;
  public statusText = '';
  public members: RoomMember[] = [];
  public chatMessages: LobbyChatMessage[] = [];
  public roomSettings: RoomSettingsPayload = {
    trackId: 'monza',
    weather: 'dry',
    timeOfDay: 'day',
    mode: 'quick_race',
    reverseTrack: false,
    fillWithBots: true
  };

  private peer: Peer | null = null;
  private hostConn: DataConnection | null = null;
  private guestConns = new Map<string, DataConnection>();
  private bc: BroadcastChannel | null = null;
  private pingInterval: number | null = null;

  private localTeamId = 'ferrari';
  private localCompound: TireCompoundId = 'soft';
  private localReady = true;

  private lastTelemetrySentMs = 0;
  private localSeq = 0;
  private remoteSnaps = new Map<string, RemoteCarSnap>();

  public onLobbyUpdated: (() => void) | null = null;
  public onRaceStart: ((pkt: MultiplayerRaceStartPacket) => void) | null = null;

  constructor() {
    try {
      const saved = localStorage.getItem(DRIVER_NAME_KEY);
      if (saved && saved.trim()) {
        this.driverName = saved.trim().slice(0, 16);
      } else {
        this.driverName = `PILOTA ${Math.floor(10 + Math.random() * 89)}`;
      }
    } catch {
      // ignore storage errors
    }
  }

  public sendChatMessage(rawText: string, color = '#00e5ff'): void {
    if (!this.isConnected) return;
    const text = rawText.trim().slice(0, 160);
    if (!text) return;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const msg: LobbyChatMessage = {
      sender: this.driverName,
      text,
      color,
      time
    };
    this.chatMessages.push(msg);
    if (this.chatMessages.length > 45) this.chatMessages.shift();
    this._broadcastPacket({ type: 'chat_msg', msg });
    this._notifyUI();
  }

  public setDriverName(name: string): void {
    const clean = name.trim().slice(0, 16) || 'PILOTA';
    this.driverName = clean;
    try {
      localStorage.setItem(DRIVER_NAME_KEY, clean);
    } catch {
      // ignore
    }
    this._syncLocalMemberState();
  }

  public setLocalLoadout(teamId: string, compound: TireCompoundId): void {
    this.localTeamId = teamId;
    this.localCompound = compound;
    this._syncLocalMemberState();
  }

  public toggleReady(): boolean {
    this.localReady = !this.localReady;
    this._syncLocalMemberState();
    return this.localReady;
  }

  public getInviteUrl(): string {
    if (!this.roomCode) return window.location.href;
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.roomCode);
    return url.toString();
  }

  public createRoom(
    teamId: string,
    compound: TireCompoundId,
    settings: RoomSettingsPayload
  ): string {
    this.leaveRoom();

    this.localTeamId = teamId;
    this.localCompound = compound;
    this.roomSettings = { timeOfDay: 'day', mode: 'quick_race', ...settings };
    this.roomCode = generateRoomCode();
    this.isHost = true;
    this.isConnected = true;
    this.localReady = true;

    const hostMember: RoomMember = {
      peerId: this.localPeerId,
      name: this.driverName,
      code: makeDriverCode(this.driverName),
      teamId: this.localTeamId,
      compound: this.localCompound,
      isHost: true,
      ready: true,
      pingMs: 1,
      lastSeenMs: performance.now()
    };
    this.members = [hostMember];
    this.chatMessages = [{
      sender: 'SISTEMA',
      text: `Stanza ${this.roomCode} creata. Condividi il link o codice per invitare altri piloti!`,
      color: '#39ff14',
      time: 'LIVE'
    }];
    this.statusText = `Stanza ${this.roomCode} attiva (In attesa di piloti...)`;

    this._openBroadcastChannel(this.roomCode);
    this._initHostPeer(this.roomCode);
    this._startHeartbeat();
    this._notifyUI();
    return this.roomCode;
  }

  public joinRoom(
    rawCode: string,
    teamId: string,
    compound: TireCompoundId
  ): boolean {
    const code = normalizeRoomCode(rawCode);
    if (!code || code.length < 6) return false;

    this.leaveRoom();

    this.localTeamId = teamId;
    this.localCompound = compound;
    this.roomCode = code;
    this.isHost = false;
    this.isConnected = true;
    this.localReady = true;

    const guestMember: RoomMember = {
      peerId: this.localPeerId,
      name: this.driverName,
      code: makeDriverCode(this.driverName),
      teamId: this.localTeamId,
      compound: this.localCompound,
      isHost: false,
      ready: true,
      pingMs: 18,
      lastSeenMs: performance.now()
    };
    this.members = [guestMember];
    this.chatMessages = [{
      sender: 'SISTEMA',
      text: `Ingresso nella stanza ${code}...`,
      color: '#00e5ff',
      time: 'LIVE'
    }];
    this.statusText = `Connessione alla stanza ${code}...`;

    this._openBroadcastChannel(code);
    // Immediately send join_req on BroadcastChannel for instant local/multi-tab join
    this._sendBC({ type: 'join_req', member: guestMember });

    this._initGuestPeer(code, guestMember);
    this._startHeartbeat();
    this._notifyUI();
    return true;
  }

  public leaveRoom(): void {
    if (this.isConnected) {
      this._broadcastPacket({ type: 'leave_notify', peerId: this.localPeerId });
    }
    if (this.pingInterval !== null) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.hostConn) {
      try { this.hostConn.close(); } catch { /* ignore */ }
      this.hostConn = null;
    }
    for (const c of this.guestConns.values()) {
      try { c.close(); } catch { /* ignore */ }
    }
    this.guestConns.clear();
    if (this.peer) {
      try { this.peer.destroy(); } catch { /* ignore */ }
      this.peer = null;
    }
    if (this.bc) {
      try { this.bc.close(); } catch { /* ignore */ }
      this.bc = null;
    }

    this.roomCode = '';
    this.isHost = false;
    this.isConnected = false;
    this.members = [];
    this.chatMessages = [];
    this.remoteSnaps.clear();
    this.statusText = '';

    // Clean ?room= from URL bar if present
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('room')) {
        url.searchParams.delete('room');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // ignore
    }
    this._notifyUI();
  }

  public updateHostRoomSettings(partial: Partial<RoomSettingsPayload>): void {
    if (!this.isConnected || !this.isHost) return;
    this.roomSettings = { ...this.roomSettings, ...partial };
    this._broadcastLobbyState();
    this._notifyUI();
  }

  public startMultiplayerRace(allTeams: Array<{ id: string; number: number; aiNumber: number; code: string; aiCode: string }>): void {
    if (!this.isConnected || !this.isHost) return;

    const grid: MultiplayerGridEntry[] = [];
    const usedTeamCounts = new Map<string, number>();

    // 1. Place all human room members onto starting grid slots
    this.members.slice(0, 10).forEach((m, idx) => {
      const teamObj = allTeams.find((t) => t.id === m.teamId) || allTeams[0];
      const cnt = usedTeamCounts.get(teamObj.id) || 0;
      usedTeamCounts.set(teamObj.id, cnt + 1);
      grid.push({
        peerId: m.peerId,
        name: m.name,
        code: m.code,
        teamId: teamObj.id,
        number: cnt === 0 ? teamObj.number : teamObj.aiNumber,
        compound: m.compound,
        gridSlot: idx
      });
    });

    // 2. Optionally fill remaining slots up to 10 cars with AI Bots
    if (this.roomSettings.fillWithBots && grid.length < 10) {
      const aiCompounds: TireCompoundId[] = this.roomSettings.weather === 'rain'
        ? ['inter', 'wet', 'inter']
        : ['soft', 'medium', 'hard'];
      for (const t of allTeams) {
        if (grid.length >= 10) break;
        const cnt = usedTeamCounts.get(t.id) || 0;
        if (cnt === 0) {
          usedTeamCounts.set(t.id, 1);
          grid.push({
            peerId: null,
            name: `AI ${t.code}`,
            code: t.code,
            teamId: t.id,
            number: t.number,
            compound: aiCompounds[grid.length % aiCompounds.length],
            gridSlot: grid.length
          });
        }
      }
      // If still < 10, add second driver from teams
      for (const t of allTeams) {
        if (grid.length >= 10) break;
        const cnt = usedTeamCounts.get(t.id) || 0;
        if (cnt < 2) {
          usedTeamCounts.set(t.id, cnt + 1);
          grid.push({
            peerId: null,
            name: `AI ${t.aiCode}`,
            code: t.aiCode,
            teamId: t.id,
            number: t.aiNumber,
            compound: aiCompounds[grid.length % aiCompounds.length],
            gridSlot: grid.length
          });
        }
      }
    }

    const startPkt: MultiplayerRaceStartPacket = {
      type: 'race_start',
      roomCode: this.roomCode,
      settings: this.roomSettings,
      grid,
      timestamp: Date.now()
    };

    this.remoteSnaps.clear();
    this._broadcastPacket(startPkt);
    this.onRaceStart?.(startPkt);
  }

  public broadcastLocalTelemetry(player: CarState, raceClock: number): void {
    if (!this.isConnected) return;
    const now = performance.now();
    if (now - this.lastTelemetrySentMs < 32) return; // ~30Hz network tick
    this.lastTelemetrySentMs = now;
    this.localSeq++;

    const pkt: CarTelemetryPacket = {
      type: 'car_telemetry',
      seq: this.localSeq,
      peerId: this.localPeerId,
      clock: Number(raceClock.toFixed(3)),
      x: Number(player.pos.x.toFixed(3)),
      y: Number(player.pos.y.toFixed(3)),
      z: Number(player.pos.z.toFixed(3)),
      vx: Number(player.vel.x.toFixed(2)),
      vz: Number(player.vel.z.toFixed(2)),
      yaw: Number(player.yaw.toFixed(4)),
      speed: Number(player.speed.toFixed(2)),
      steer: Number(player.steerInput.toFixed(3)),
      throttle: Number(player.throttleInput.toFixed(2)),
      brake: Number(player.brakeInput.toFixed(2)),
      gear: player.gear,
      rpm: Math.round(player.rpm),
      drs: player.drsActive,
      brakeTemp: Math.round(player.brakeTemp),
      compound: player.compound,
      tireWear: Number(player.tireWear.toFixed(1)),
      lap: player.lap,
      raceDistance: Number(player.raceDistance.toFixed(2)),
      bestLapTime: Number.isFinite(player.bestLapTime) ? Number(player.bestLapTime.toFixed(3)) : -1,
      finished: player.finished,
      finishTime: Number(player.finishTime.toFixed(3)),
      eliminated: player.eliminated,
      robberHealth: player.robberHealth !== undefined ? Math.round(player.robberHealth) : undefined,
      robberArrested: player.robberArrested,
      sirenActive: player.sirenActive,
      infected: player.infected
    };

    this._broadcastPacket(pkt);
  }

  public stepRemoteCar(car: CarState, track: TrackData, dt: number): void {
    if (!car.remotePeerId) return;
    const snap = this.remoteSnaps.get(car.remotePeerId);
    if (!snap) return;

    const ageSec = Math.min(0.18, Math.max(0, (performance.now() - snap.receivedAtMs) * 0.001));
    const predX = snap.targetPos.x + snap.vel.x * ageSec;
    const predZ = snap.targetPos.z + snap.vel.z * ageSec;

    car.prevPos.copy(car.pos);
    const blend = Math.min(1, dt * 15);
    car.pos.x += (predX - car.pos.x) * blend;
    car.pos.y += (snap.targetPos.y - car.pos.y) * blend;
    car.pos.z += (predZ - car.pos.z) * blend;
    car.vel.copy(snap.vel);

    // Shortest-angle yaw interpolation
    let dyaw = snap.targetYaw - car.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    car.yaw += dyaw * Math.min(1, dt * 16);

    car.speed = snap.speed;
    car.steerInput += (snap.steer - car.steerInput) * Math.min(1, dt * 16);
    car.throttleInput = snap.throttle;
    car.brakeInput = snap.brake;
    car.gear = snap.gear;
    car.rpm = snap.rpm;
    car.drsActive = snap.drs;
    car.brakeTemp = snap.brakeTemp;
    car.compound = snap.compound;
    car.tireWear = snap.tireWear;
    car.lap = snap.lap;
    car.raceDistance = snap.raceDistance;
    if (snap.bestLapTime > 0) car.bestLapTime = snap.bestLapTime;
    car.finished = snap.finished;
    car.finishTime = snap.finishTime;
    if (snap.eliminated !== undefined) car.eliminated = snap.eliminated;
    if (snap.robberHealth !== undefined) car.robberHealth = snap.robberHealth;
    if (snap.robberArrested !== undefined) car.robberArrested = snap.robberArrested;
    if (snap.sirenActive !== undefined) car.sirenActive = snap.sirenActive;
    if (snap.infected) car.infected = true;

    car._tInfo = track.queryTrack(car.pos, car.splineIndex, car._tInfo);
    car.splineIndex = car._tInfo.index;
    car.onTrack = car._tInfo.onTrack;
    car.onCurb = car._tInfo.onCurb;
    car.offTrack = car._tInfo.offTrack;
    car.inTunnel = car._tInfo.isTunnel;
  }

  private _openBroadcastChannel(code: string): void {
    try {
      this.bc = new BroadcastChannel(`apexgp3d_mp_${code}`);
      this.bc.onmessage = (ev) => {
        if (ev.data && typeof ev.data === 'object') {
          this._handlePacket(ev.data as NetPacket);
        }
      };
    } catch {
      this.bc = null;
    }
  }

  private _sendBC(pkt: NetPacket): void {
    if (!this.bc) return;
    try {
      this.bc.postMessage(pkt);
    } catch {
      // ignore
    }
  }

  private _initHostPeer(code: string): void {
    try {
      const hostPeerId = `${PEER_ID_PREFIX}${code}`;
      const peer = new Peer(hostPeerId, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });
      this.peer = peer;

      peer.on('open', () => {
        this.statusText = `Stanza ${code} online (WebRTC P2P pronto)`;
        this._notifyUI();
      });

      peer.on('connection', (conn) => {
        conn.on('open', () => {
          this.guestConns.set(conn.peer, conn);
          this._broadcastLobbyState();
        });
        conn.on('data', (data) => {
          if (data && typeof data === 'object') {
            this._handlePacket(data as NetPacket, conn);
          }
        });
        conn.on('close', () => {
          this.guestConns.delete(conn.peer);
        });
      });

      peer.on('error', () => {
        // BroadcastChannel still works locally even if public PeerJS broker has a hiccup
        this.statusText = `Stanza ${code} attiva`;
        this._notifyUI();
      });
    } catch {
      // fallback to BroadcastChannel
    }
  }

  private _initGuestPeer(code: string, guestMember: RoomMember): void {
    try {
      const peer = new Peer({
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });
      this.peer = peer;

      peer.on('open', () => {
        const hostPeerId = `${PEER_ID_PREFIX}${code}`;
        const conn = peer.connect(hostPeerId, { reliable: true });
        this.hostConn = conn;

        conn.on('open', () => {
          this.statusText = `Connesso alla stanza ${code}!`;
          conn.send({ type: 'join_req', member: guestMember } satisfies NetPacket);
          this._notifyUI();
        });
        conn.on('data', (data) => {
          if (data && typeof data === 'object') {
            this._handlePacket(data as NetPacket);
          }
        });
        conn.on('close', () => {
          this.statusText = `Connessione chiusa dall'host`;
          this._notifyUI();
        });
      });

      peer.on('error', () => {
        // Keep BroadcastChannel active
      });
    } catch {
      // fallback
    }
  }

  private _syncLocalMemberState(): void {
    if (!this.isConnected) return;
    const me = this.members.find((m) => m.peerId === this.localPeerId);
    if (me) {
      me.name = this.driverName;
      me.code = makeDriverCode(this.driverName);
      me.teamId = this.localTeamId;
      me.compound = this.localCompound;
      me.ready = this.isHost ? true : this.localReady;
      me.lastSeenMs = performance.now();
    }
    if (this.isHost) {
      this._broadcastLobbyState();
    } else if (me) {
      this._broadcastPacket({ type: 'member_update', member: me });
    }
    this._notifyUI();
  }

  private _broadcastLobbyState(): void {
    if (!this.isHost) return;
    const pkt: NetPacket = {
      type: 'lobby_state',
      roomCode: this.roomCode,
      hostId: this.localPeerId,
      settings: this.roomSettings,
      members: this.members
    };
    this._broadcastPacket(pkt);
  }

  private _broadcastPacket(pkt: NetPacket, excludeConn?: DataConnection): void {
    this._sendBC(pkt);
    if (this.isHost) {
      for (const conn of this.guestConns.values()) {
        if (conn !== excludeConn && conn.open) {
          try { conn.send(pkt); } catch { /* ignore */ }
        }
      }
    } else if (this.hostConn && this.hostConn.open) {
      try { this.hostConn.send(pkt); } catch { /* ignore */ }
    }
  }

  private _handlePacket(pkt: NetPacket, sourceConn?: DataConnection): void {
    if (!this.isConnected) return;

    if (pkt.type === 'join_req') {
      if (!this.isHost) return;
      const incoming = pkt.member;
      const existingIdx = this.members.findIndex((m) => m.peerId === incoming.peerId);
      if (existingIdx >= 0) {
        this.members[existingIdx] = { ...incoming, isHost: false, lastSeenMs: performance.now() };
      } else if (this.members.length < 10) {
        this.members.push({ ...incoming, isHost: false, lastSeenMs: performance.now() });
      }
      this.statusText = `Stanza ${this.roomCode} • ${this.members.length} piloti connessi`;
      this._broadcastLobbyState();
      this._notifyUI();
      return;
    }

    if (pkt.type === 'member_update') {
      if (!this.isHost) return;
      const idx = this.members.findIndex((m) => m.peerId === pkt.member.peerId);
      if (idx >= 0) {
        this.members[idx] = { ...pkt.member, isHost: this.members[idx].isHost, lastSeenMs: performance.now() };
      } else if (this.members.length < 10) {
        this.members.push({ ...pkt.member, isHost: false, lastSeenMs: performance.now() });
      }
      this._broadcastLobbyState();
      this._notifyUI();
      return;
    }

    if (pkt.type === 'leave_notify') {
      if (pkt.peerId === this.localPeerId) return;
      this.members = this.members.filter((m) => m.peerId !== pkt.peerId);
      this.remoteSnaps.delete(pkt.peerId);
      if (this.isHost) {
        this._broadcastLobbyState();
      }
      this._notifyUI();
      return;
    }

    if (pkt.type === 'lobby_state') {
      if (this.isHost || pkt.roomCode !== this.roomCode) return;
      this.roomSettings = { ...pkt.settings };
      this.members = pkt.members.map((m) =>
        m.peerId === this.localPeerId
          ? {
              ...m,
              name: this.driverName,
              code: makeDriverCode(this.driverName),
              teamId: this.localTeamId,
              compound: this.localCompound,
              ready: this.localReady
            }
          : m
      );
      this.statusText = `Connesso a ${this.roomCode} (${this.members.length} piloti in lobby)`;
      this._notifyUI();
      return;
    }

    if (pkt.type === 'chat_msg') {
      if (this.isHost && sourceConn) {
        for (const conn of this.guestConns.values()) {
          if (conn !== sourceConn && conn.open) {
            try { conn.send(pkt); } catch { /* ignore */ }
          }
        }
      }
      this.chatMessages.push(pkt.msg);
      if (this.chatMessages.length > 45) this.chatMessages.shift();
      this._notifyUI();
      return;
    }

    if (pkt.type === 'ping_req') {
      if (pkt.fromId === this.localPeerId) return;
      this._broadcastPacket({
        type: 'ping_ack',
        fromId: this.localPeerId,
        toId: pkt.fromId,
        sentAt: pkt.sentAt
      });
      return;
    }

    if (pkt.type === 'ping_ack') {
      if (pkt.toId !== this.localPeerId) return;
      const rtt = Math.max(1, Math.round(performance.now() - pkt.sentAt));
      const m = this.members.find((mem) => mem.peerId === pkt.fromId);
      if (m) {
        m.pingMs = rtt;
        m.lastSeenMs = performance.now();
        if (this.isHost) this._broadcastLobbyState();
        this._notifyUI();
      }
      return;
    }

    if (pkt.type === 'race_start') {
      if (this.isHost || pkt.roomCode !== this.roomCode) return;
      this.roomSettings = { ...pkt.settings };
      this.remoteSnaps.clear();
      this.onRaceStart?.(pkt);
      return;
    }

    if (pkt.type === 'car_telemetry') {
      if (pkt.peerId === this.localPeerId) return;
      // If we are Host and received telemetry via WebRTC DataConnection, relay to other WebRTC guests
      if (this.isHost && sourceConn) {
        for (const conn of this.guestConns.values()) {
          if (conn !== sourceConn && conn.open) {
            try { conn.send(pkt); } catch { /* ignore */ }
          }
        }
      }
      const prev = this.remoteSnaps.get(pkt.peerId);
      if (prev && pkt.seq < prev.seq) return;
      this.remoteSnaps.set(pkt.peerId, {
        seq: pkt.seq,
        receivedAtMs: performance.now(),
        targetPos: new THREE.Vector3(pkt.x, pkt.y, pkt.z),
        vel: new THREE.Vector3(pkt.vx, 0, pkt.vz),
        targetYaw: pkt.yaw,
        speed: pkt.speed,
        steer: pkt.steer,
        throttle: pkt.throttle,
        brake: pkt.brake,
        gear: pkt.gear,
        rpm: pkt.rpm,
        drs: pkt.drs,
        brakeTemp: pkt.brakeTemp,
        compound: pkt.compound,
        tireWear: pkt.tireWear,
        lap: pkt.lap,
        raceDistance: pkt.raceDistance,
        bestLapTime: pkt.bestLapTime,
        finished: pkt.finished,
        finishTime: pkt.finishTime,
        eliminated: pkt.eliminated,
        robberHealth: pkt.robberHealth,
        robberArrested: pkt.robberArrested,
        sirenActive: pkt.sirenActive,
        infected: pkt.infected
      });
    }
  }

  private _startHeartbeat(): void {
    if (this.pingInterval !== null) window.clearInterval(this.pingInterval);
    this.pingInterval = window.setInterval(() => {
      if (!this.isConnected) return;
      this._broadcastPacket({
        type: 'ping_req',
        fromId: this.localPeerId,
        sentAt: performance.now()
      });
      if (!this.isHost) {
        const me = this.members.find((m) => m.peerId === this.localPeerId);
        if (me) {
          this._broadcastPacket({ type: 'member_update', member: me });
        }
      }
    }, 1800);
  }

  private _notifyUI(): void {
    this.onLobbyUpdated?.();
  }
}
