import type {
  RaceEntrant,
  RaceInput,
  RacePlayer,
  RaceRoomPlayer,
  RaceRoomSnapshot,
  RaceServerMessage,
  RaceSnapshot,
} from '../../../packages/game/src/core/race-types';

export interface RaceSocket {
  send(data: string): unknown;
  close?(code?: number, reason?: string): unknown;
}

export interface RaceEngineLike {
  update(deltaMs: number, inputs: Record<string, RaceInput>): void;
  snapshot(): RaceSnapshot;
  markDNF(id: string): void;
}

export interface RaceRoomOptions {
  now?: () => number;
  newId?: () => string;
  randomBytes?: (length: number) => Uint8Array;
  send?: (socket: RaceSocket, message: RaceServerMessage) => void;
  makeEngine: (entrants: RaceEntrant[], seed?: number) => RaceEngineLike;
  maxRooms?: number;
  maxConnections?: number;
}

interface PlayerState extends RaceRoomPlayer {
  token: string | null;
  socket: RaceSocket | null;
  disconnectedAt: number | null;
  graceExpired: boolean;
  joinOrder: number;
  lastInputAt: number;
  lastInputSeq: number;
  input: RaceInput;
  pendingJump: boolean;
}

interface RaceRoom {
  code: string;
  hostId: string;
  phase: RaceRoomSnapshot['phase'];
  fillBots: boolean;
  players: PlayerState[];
  bots: RaceRoomPlayer[];
  racers: RaceRoomPlayer[];
  engine: RaceEngineLike | null;
  countdownUntil: number;
  lastEngineAt: number;
  engineAccumulatorMs: number;
  emptySince: number | null;
}

interface Connection {
  socket: RaceSocket;
  room: RaceRoom | null;
  player: PlayerState | null;
  rateWindowStartedAt: number;
  rateCount: number;
  rateErrorSent: boolean;
}

type ClientMessage =
  | { type: 'create'; name: string; characterId: string; fillBots?: boolean }
  | { type: 'join'; code: string; name: string; characterId: string }
  | { type: 'resume'; code: string; token: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'fillBots'; enabled: boolean }
  | { type: 'start' }
  | { type: 'rematch' }
  | { type: 'input'; seq: number; steer: number; jump: boolean; tracking: boolean }
  | { type: 'leave' };

const PLAYER_LIMIT = 8;
const MAX_NAME_LENGTH = 24;
const MAX_MESSAGE_BYTES = 4_096;
const MAX_MESSAGES_PER_SECOND = 120;
const MAX_ROOM_COUNT = 256;
const MAX_CONNECTION_COUNT = 1_024;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VALID_CHARACTERS = new Set(['rogue', 'knight', 'mage', 'barbarian']);
const FIXED_STEP_MS = 1_000 / 30;
const BROADCAST_INTERVAL_MS = 1_000 / 15;
const INPUT_STALE_MS = 500;
const DISCONNECT_GRACE_MS = 10_000;
const EMPTY_ROOM_TTL_MS = 15 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const allowed = [...keys].sort();
  return actual.length === allowed.length && actual.every((key, index) => key === allowed[index]);
}

function hasOnlyKeys(value: Record<string, unknown>, required: string[], optional: string[]): boolean {
  const actual = Object.keys(value);
  return required.every(key => Object.hasOwn(value, key))
    && actual.every(key => required.includes(key) || optional.includes(key));
}

function decodeMessage(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (raw instanceof ArrayBuffer) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      return null;
    }
  }
  if (ArrayBuffer.isView(raw)) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    } catch {
      return null;
    }
  }
  return null;
}

function isOversized(raw: unknown): boolean {
  if (typeof raw === 'string') {
    return raw.length > MAX_MESSAGE_BYTES || new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES;
  }
  if (raw instanceof ArrayBuffer) return raw.byteLength > MAX_MESSAGE_BYTES;
  if (ArrayBuffer.isView(raw)) return raw.byteLength > MAX_MESSAGE_BYTES;
  return false;
}

function boundedInteger(value: number | undefined, maximum: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
}

function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  switch (value.type) {
    case 'create':
      if (!hasOnlyKeys(value, ['type', 'name', 'characterId'], ['fillBots'])
        || typeof value.name !== 'string'
        || typeof value.characterId !== 'string'
        || (value.fillBots !== undefined && typeof value.fillBots !== 'boolean')) return null;
      return value as ClientMessage & { type: 'create' };
    case 'join':
      if (!hasExactKeys(value, ['type', 'code', 'name', 'characterId'])
        || typeof value.code !== 'string'
        || typeof value.name !== 'string'
        || typeof value.characterId !== 'string') return null;
      return value as ClientMessage & { type: 'join' };
    case 'resume':
      if (!hasExactKeys(value, ['type', 'code', 'token'])
        || typeof value.code !== 'string'
        || typeof value.token !== 'string') return null;
      return value as ClientMessage & { type: 'resume' };
    case 'ready':
      if (!hasExactKeys(value, ['type', 'ready']) || typeof value.ready !== 'boolean') return null;
      return value as ClientMessage & { type: 'ready' };
    case 'fillBots':
      if (!hasExactKeys(value, ['type', 'enabled']) || typeof value.enabled !== 'boolean') return null;
      return value as ClientMessage & { type: 'fillBots' };
    case 'start':
    case 'rematch':
    case 'leave':
      if (!hasExactKeys(value, ['type'])) return null;
      return value as ClientMessage;
    case 'input':
      if (!hasExactKeys(value, ['type', 'seq', 'steer', 'jump', 'tracking'])
        || typeof value.seq !== 'number'
        || !Number.isSafeInteger(value.seq)
        || value.seq < 0
        || typeof value.steer !== 'number'
        || !Number.isFinite(value.steer)
        || value.steer < -1
        || value.steer > 1
        || typeof value.jump !== 'boolean'
        || typeof value.tracking !== 'boolean') return null;
      return value as ClientMessage & { type: 'input' };
    default:
      return null;
  }
}

function cleanName(value: string): string | null {
  const name = value.normalize('NFKC').trim();
  if (!name || [...name].length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/u.test(name)) return null;
  return name;
}

function isCode(value: string): boolean {
  return value.length === 6 && [...value].every(character => CODE_ALPHABET.includes(character));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function neutralInput(): RaceInput {
  return { steer: 0, jump: false, tracking: false };
}

export class RaceRoomManager {
  private readonly rooms = new Map<string, RaceRoom>();
  private readonly connections = new Map<RaceSocket, Connection>();
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly sendMessage: (socket: RaceSocket, message: RaceServerMessage) => void;
  private readonly makeEngine: RaceRoomOptions['makeEngine'];
  private readonly maxRooms: number;
  private readonly maxConnections: number;
  private nextJoinOrder = 0;
  private lastNow = Number.NEGATIVE_INFINITY;
  private lastTickAt: number;
  private lastBroadcastAt: number;

  constructor(options: RaceRoomOptions) {
    this.now = options.now ?? (() => performance.now());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.randomBytes = options.randomBytes ?? (length => crypto.getRandomValues(new Uint8Array(length)));
    this.sendMessage = options.send ?? ((socket, message) => { socket.send(JSON.stringify(message)); });
    this.makeEngine = options.makeEngine;
    this.maxRooms = boundedInteger(options.maxRooms, MAX_ROOM_COUNT, MAX_ROOM_COUNT);
    this.maxConnections = boundedInteger(options.maxConnections, MAX_CONNECTION_COUNT, MAX_CONNECTION_COUNT);
    this.lastTickAt = this.currentTime();
    this.lastBroadcastAt = this.lastTickAt;
  }

  open(socket: RaceSocket): void {
    if (this.connections.has(socket)) return;
    if (this.connections.size >= this.maxConnections) {
      this.sendError(socket, 'SERVER_BUSY', 'The race server is full. Try again soon.');
      socket.close?.(1013, 'Server busy');
      return;
    }
    const now = this.currentTime();
    this.connections.set(socket, {
      socket,
      room: null,
      player: null,
      rateWindowStartedAt: now,
      rateCount: 0,
      rateErrorSent: false,
    });
  }

  message(socket: RaceSocket, raw: unknown): void {
    let connection = this.connections.get(socket);
    if (!connection) {
      this.open(socket);
      connection = this.connections.get(socket);
      if (!connection) return;
    }

    const now = this.currentTime();
    if (now - connection.rateWindowStartedAt >= 1_000) {
      connection.rateWindowStartedAt = now;
      connection.rateCount = 0;
      connection.rateErrorSent = false;
    }
    connection.rateCount += 1;
    if (connection.rateCount > MAX_MESSAGES_PER_SECOND) {
      if (!connection.rateErrorSent) {
        this.sendError(socket, 'RATE_LIMITED', 'Too many messages. Slow down and try again.');
        connection.rateErrorSent = true;
      }
      return;
    }

    if (isOversized(raw)) {
      this.sendError(socket, 'MESSAGE_TOO_LARGE', 'Race messages must be 4 KB or smaller.');
      socket.close?.(1009, 'Message too large');
      this.close(socket);
      return;
    }
    const text = decodeMessage(raw);
    if (text === null) {
      this.sendError(socket, 'INVALID_MESSAGE', 'Send a valid JSON race message.');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.sendError(socket, 'INVALID_MESSAGE', 'Send a valid JSON race message.');
      return;
    }
    const message = parseClientMessage(parsed);
    if (!message) {
      this.sendError(socket, 'INVALID_MESSAGE', 'The race message does not match the protocol.');
      return;
    }

    if (message.type === 'create' || message.type === 'join' || message.type === 'resume') {
      if (connection.player) {
        this.sendError(socket, 'ALREADY_IN_ROOM', 'Leave the current race room first.');
        return;
      }
      if (message.type === 'create') this.createRoom(connection, message, now);
      else if (message.type === 'join') this.joinRoom(connection, message, now);
      else this.resumePlayer(connection, message, now);
      return;
    }

    if (!connection.room || !connection.player) {
      this.sendError(socket, 'NOT_IN_ROOM', 'Create or join a race room first.');
      return;
    }

    switch (message.type) {
      case 'ready':
        this.setReady(connection.room, connection.player, message.ready);
        break;
      case 'fillBots':
        this.setFillBots(connection.room, connection.player, message.enabled);
        break;
      case 'start':
        this.startRoom(connection.room, connection.player, now);
        break;
      case 'rematch':
        this.rematch(connection.room, connection.player);
        break;
      case 'input':
        this.setInput(connection.room, connection.player, message, now);
        break;
      case 'leave':
        this.leaveRoom(connection, now);
        break;
    }
  }

  close(socket: RaceSocket): void {
    const connection = this.connections.get(socket);
    if (!connection) return;
    this.connections.delete(socket);
    const room = connection.room;
    const player = connection.player;
    if (!room || !player || player.socket !== socket) return;

    player.socket = null;
    player.connected = false;
    player.disconnectedAt = this.currentTime();
    player.graceExpired = false;
    player.input = neutralInput();
    player.pendingJump = false;
    this.setRacerConnected(room, player.id, false);
    if (room.hostId === player.id) this.transferHost(room);
    this.updateEmptySince(room, this.currentTime());
    this.broadcastRoom(room);
  }

  tick(): void {
    const now = this.currentTime();
    const delta = Math.max(0, now - this.lastTickAt);
    this.lastTickAt = now;
    let broadcastDue = now - this.lastBroadcastAt >= BROADCAST_INTERVAL_MS;
    if (broadcastDue) this.lastBroadcastAt = now;

    for (const [code, room] of this.rooms) {
      const cleaned = this.cleanupDisconnectedPlayers(room, now);
      this.updateEmptySince(room, now);
      if (room.emptySince !== null && now - room.emptySince >= EMPTY_ROOM_TTL_MS) {
        this.rooms.delete(code);
        continue;
      }

      let changed = cleaned;
      let justStarted = false;
      if (room.phase === 'countdown' && now >= room.countdownUntil) {
        room.phase = 'racing';
        justStarted = true;
        room.countdownUntil = 0;
        room.lastEngineAt = now;
        room.engineAccumulatorMs = 0;
        room.engine = this.makeEngine(room.racers.map(player => ({
          id: player.id,
          name: player.name,
          characterId: player.characterId,
          isBot: player.isBot,
        })), this.randomSeed());
        changed = true;
      }

      if (room.phase === 'racing' && room.engine && !justStarted) {
        room.engineAccumulatorMs += Math.min(delta, FIXED_STEP_MS * 30);
        let steps = 0;
        while (room.engineAccumulatorMs >= FIXED_STEP_MS && steps < 8 && room.phase === 'racing') {
          const inputs = this.collectInputs(room, now);
          room.engine.update(FIXED_STEP_MS, inputs);
          room.engineAccumulatorMs -= FIXED_STEP_MS;
          steps += 1;
          if (room.engine.snapshot().finished) {
            room.phase = 'results';
            room.bots = [];
            changed = true;
          }
        }
      }

      if (changed || (broadcastDue && (room.phase === 'countdown' || room.phase === 'racing'))) {
        this.broadcastRoom(room);
      }
    }
  }

  private createRoom(connection: Connection, message: Extract<ClientMessage, { type: 'create' }>, now: number): void {
    const name = cleanName(message.name);
    if (!name || !VALID_CHARACTERS.has(message.characterId)) {
      this.sendError(connection.socket, 'INVALID_PLAYER', 'Choose a name up to 24 characters and a valid character.');
      return;
    }
    this.expireEmptyRooms(now);
    if (this.rooms.size >= this.maxRooms) {
      this.sendError(connection.socket, 'ROOM_LIMIT', 'The race server cannot create more rooms right now.');
      return;
    }
    const code = this.createCode();
    if (!code) {
      this.sendError(connection.socket, 'ROOM_LIMIT', 'A room code could not be reserved. Try again.');
      return;
    }
    const room: RaceRoom = {
      code,
      hostId: '',
      phase: 'lobby',
      fillBots: message.fillBots ?? true,
      players: [],
      bots: [],
      racers: [],
      engine: null,
      countdownUntil: 0,
      lastEngineAt: now,
      engineAccumulatorMs: 0,
      emptySince: null,
    };
    const player = this.makePlayer(name, message.characterId, connection.socket, now);
    room.hostId = player.id;
    room.players.push(player);
    room.emptySince = null;
    this.rooms.set(code, room);
    this.bind(connection, room, player);
    this.sendWelcome(connection, room, player);
  }

  private joinRoom(connection: Connection, message: Extract<ClientMessage, { type: 'join' }>, now: number): void {
    const code = message.code.toUpperCase();
    const room = isCode(code) ? this.rooms.get(code) : undefined;
    if (!room) {
      this.sendError(connection.socket, 'ROOM_NOT_FOUND', 'That race room could not be found.');
      return;
    }
    if (room.phase !== 'lobby') {
      this.sendError(connection.socket, 'ROOM_LOCKED', 'This race has already started.');
      return;
    }
    if (room.players.length >= PLAYER_LIMIT) {
      this.sendError(connection.socket, 'ROOM_FULL', 'This race room already has eight players.');
      return;
    }
    const name = cleanName(message.name);
    if (!name || !VALID_CHARACTERS.has(message.characterId)) {
      this.sendError(connection.socket, 'INVALID_PLAYER', 'Choose a name up to 24 characters and a valid character.');
      return;
    }
    const player = this.makePlayer(name, message.characterId, connection.socket, now);
    room.players.push(player);
    if (!room.players.some(candidate => candidate.id === room.hostId && candidate.connected)) room.hostId = player.id;
    room.emptySince = null;
    this.bind(connection, room, player);
    this.sendWelcome(connection, room, player);
    this.broadcastRoom(room);
  }

  private resumePlayer(connection: Connection, message: Extract<ClientMessage, { type: 'resume' }>, now: number): void {
    const code = message.code.toUpperCase();
    const room = isCode(code) ? this.rooms.get(code) : undefined;
    const player = room?.players.find(candidate => candidate.token !== null && constantTimeEqual(candidate.token, message.token));
    if (!room || !player || player.graceExpired || player.connected || player.disconnectedAt === null
      || now - player.disconnectedAt >= DISCONNECT_GRACE_MS) {
      if (room && player && now - (player.disconnectedAt ?? now) >= DISCONNECT_GRACE_MS) {
        this.cleanupDisconnectedPlayers(room, now);
        this.updateEmptySince(room, now);
      }
      this.sendError(connection.socket, 'INVALID_RESUME', 'The resume token is invalid or its grace period expired.');
      return;
    }

    player.socket = connection.socket;
    player.connected = true;
    player.disconnectedAt = null;
    player.graceExpired = false;
    player.lastInputAt = now;
    player.lastInputSeq = -1;
    player.input = neutralInput();
    player.pendingJump = false;
    this.setRacerConnected(room, player.id, true);
    room.emptySince = null;
    this.bind(connection, room, player);
    this.sendWelcome(connection, room, player);
    this.broadcastRoom(room);
  }

  private setReady(room: RaceRoom, player: PlayerState, ready: boolean): void {
    if (room.phase !== 'lobby') {
      this.sendError(player.socket!, 'ROOM_LOCKED', 'Readiness can only change in the lobby.');
      return;
    }
    player.ready = ready;
    this.broadcastRoom(room);
  }

  private setFillBots(room: RaceRoom, player: PlayerState, enabled: boolean): void {
    if (room.hostId !== player.id) {
      this.sendError(player.socket!, 'NOT_HOST', 'Only the host can change bot fill.');
      return;
    }
    if (room.phase !== 'lobby') {
      this.sendError(player.socket!, 'ROOM_LOCKED', 'Bot fill can only change in the lobby.');
      return;
    }
    room.fillBots = enabled;
    this.broadcastRoom(room);
  }

  private startRoom(room: RaceRoom, player: PlayerState, now: number): void {
    if (room.hostId !== player.id) {
      this.sendError(player.socket!, 'NOT_HOST', 'Only the host can start the race.');
      return;
    }
    if (room.phase !== 'lobby') {
      this.sendError(player.socket!, 'ROOM_LOCKED', 'This race room has already started.');
      return;
    }
    const humans = room.players.filter(candidate => candidate.connected && candidate.socket !== null);
    if (!humans.length || humans.some(candidate => !candidate.ready)) {
      this.sendError(player.socket!, 'PLAYERS_NOT_READY', 'Every connected player must be ready before the race starts.');
      return;
    }
    room.players = humans;
    room.racers = humans.map(candidate => ({
      id: candidate.id,
      name: candidate.name,
      characterId: candidate.characterId,
      isBot: false,
      ready: candidate.ready,
      connected: candidate.connected,
    }));
    room.bots = [];
    this.fillVacantRacers(room);
    room.phase = 'countdown';
    room.countdownUntil = now + 3_000;
    room.engine = null;
    room.engineAccumulatorMs = 0;
    this.broadcastRoom(room);
  }

  private rematch(room: RaceRoom, player: PlayerState): void {
    if (room.hostId !== player.id) {
      this.sendError(player.socket!, 'NOT_HOST', 'Only the host can reset the race.');
      return;
    }
    if (room.phase !== 'results') {
      this.sendError(player.socket!, 'ROOM_LOCKED', 'A rematch is available after the results.');
      return;
    }
    room.phase = 'lobby';
    room.bots = [];
    room.racers = [];
    room.engine = null;
    room.countdownUntil = 0;
    room.engineAccumulatorMs = 0;
    room.players = room.players.filter(candidate => candidate.connected && candidate.socket !== null);
    for (const human of room.players) human.ready = false;
    if (!room.players.some(candidate => candidate.id === room.hostId)) this.transferHost(room);
    this.broadcastRoom(room);
  }

  private setInput(room: RaceRoom, player: PlayerState, message: Extract<ClientMessage, { type: 'input' }>, now: number): void {
    if (room.phase !== 'racing') {
      this.sendError(player.socket!, 'ROOM_LOCKED', 'Race input is only accepted during a race.');
      return;
    }
    if (message.seq <= player.lastInputSeq) {
      this.sendError(player.socket!, 'INVALID_INPUT', 'Input sequence numbers must increase.');
      return;
    }
    player.lastInputSeq = message.seq;
    player.lastInputAt = now;
    if (!message.tracking) {
      player.input = neutralInput();
      player.pendingJump = false;
    } else {
      player.input = { steer: message.steer, jump: false, tracking: true };
      player.pendingJump ||= message.jump;
    }
  }

  private leaveRoom(connection: Connection, now: number): void {
    const room = connection.room;
    const player = connection.player;
    if (!room || !player) return;
    if (room.phase === 'racing') room.engine?.markDNF(player.id);
    else if (room.phase === 'countdown') this.removeRacer(room, player.id);
    player.token = null;
    player.socket = null;
    player.connected = false;
    player.disconnectedAt = null;
    room.players = room.players.filter(candidate => candidate !== player);
    connection.room = null;
    connection.player = null;
    if (room.hostId === player.id) this.transferHost(room);
    if (room.phase === 'countdown') {
      if (room.players.length === 0) this.cancelCountdown(room);
      else this.fillVacantRacers(room);
    }
    this.updateEmptySince(room, now);
    this.broadcastRoom(room);
  }

  private cleanupDisconnectedPlayers(room: RaceRoom, now: number): boolean {
    let changed = false;
    for (const player of [...room.players]) {
      if (player.connected || player.disconnectedAt === null || now - player.disconnectedAt < DISCONNECT_GRACE_MS) continue;
      player.token = null;
      player.graceExpired = true;
      player.disconnectedAt = null;
      if (room.phase === 'racing') {
        room.engine?.markDNF(player.id);
      } else {
        if (room.phase === 'countdown') this.removeRacer(room, player.id);
        room.players = room.players.filter(candidate => candidate !== player);
        if (room.hostId === player.id) this.transferHost(room);
        if (room.phase === 'countdown') {
          if (room.players.length === 0) this.cancelCountdown(room);
          else this.fillVacantRacers(room);
        }
      }
      changed = true;
    }
    return changed;
  }

  private collectInputs(room: RaceRoom, now: number): Record<string, RaceInput> {
    const inputs: Record<string, RaceInput> = Object.create(null) as Record<string, RaceInput>;
    for (const player of room.players) {
      if (!player.connected) {
        inputs[player.id] = neutralInput();
        player.pendingJump = false;
        continue;
      }
      const stale = now - player.lastInputAt > INPUT_STALE_MS;
      const tracking = !stale && player.input.tracking;
      inputs[player.id] = {
        steer: tracking ? player.input.steer : 0,
        jump: tracking && player.pendingJump,
        tracking,
      };
      player.pendingJump = false;
    }

    return inputs;
  }

  private makePlayer(name: string, characterId: string, socket: RaceSocket, now: number): PlayerState {
    return {
      id: this.newId(),
      name,
      characterId,
      isBot: false,
      ready: false,
      connected: true,
      token: this.createToken(),
      socket,
      disconnectedAt: null,
      graceExpired: false,
      joinOrder: this.nextJoinOrder++,
      lastInputAt: now,
      lastInputSeq: -1,
      input: neutralInput(),
      pendingJump: false,
    };
  }

  private bind(connection: Connection, room: RaceRoom, player: PlayerState): void {
    connection.room = room;
    connection.player = player;
    player.socket = connection.socket;
    player.connected = true;
  }

  private sendWelcome(connection: Connection, room: RaceRoom, player: PlayerState): void {
    if (!player.token) return;
    this.sendMessage(connection.socket, {
      type: 'welcome',
      playerId: player.id,
      token: player.token,
      room: this.snapshot(room),
    });
  }

  private broadcastRoom(room: RaceRoom): void {
    const message: RaceServerMessage = { type: 'room', room: this.snapshot(room) };
    for (const player of room.players) {
      if (player.connected && player.socket) this.sendMessage(player.socket, message);
    }
  }

  private snapshot(room: RaceRoom): RaceRoomSnapshot {
    return {
      code: room.code,
      hostId: room.hostId,
      phase: room.phase,
      fillBots: room.fillBots,
      players: [
        ...room.players.map(player => ({
          id: player.id,
          name: player.name,
          characterId: player.characterId,
          isBot: false,
          ready: player.ready,
          connected: player.connected,
        })),
        ...room.bots,
      ],
      countdownMs: room.phase === 'countdown' ? Math.max(0, Math.ceil(room.countdownUntil - this.currentTime())) : 0,
      race: room.engine?.snapshot() ?? null,
    };
  }

  private transferHost(room: RaceRoom): void {
    const nextHost = room.players
      .filter(player => player.connected && player.socket !== null)
      .sort((left, right) => left.joinOrder - right.joinOrder)[0];
    if (nextHost) room.hostId = nextHost.id;
  }

  private updateEmptySince(room: RaceRoom, now: number): void {
    if (room.players.some(player => player.connected && player.socket !== null)) room.emptySince = null;
    else room.emptySince ??= now;
  }

  private expireEmptyRooms(now: number): void {
    for (const [code, room] of this.rooms) {
      this.updateEmptySince(room, now);
      if (room.emptySince !== null && now - room.emptySince >= EMPTY_ROOM_TTL_MS) this.rooms.delete(code);
    }
  }

  private createCode(): string | null {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const bytes = this.randomBytes(6);
      const code = Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  private createToken(): string {
    return Array.from(this.randomBytes(32), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  private randomSeed(): number {
    const bytes = this.randomBytes(4);
    return (((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)) >>> 0;
  }

  private currentTime(): number {
    const value = this.now();
    const finite = Number.isFinite(value) ? value : performance.now();
    this.lastNow = Math.max(this.lastNow, finite);
    return this.lastNow;
  }

  private setRacerConnected(room: RaceRoom, playerId: string, connected: boolean): void {
    const racer = room.racers.find(candidate => candidate.id === playerId);
    if (racer) racer.connected = connected;
  }

  private removeRacer(room: RaceRoom, playerId: string): void {
    room.racers = room.racers.filter(racer => racer.id !== playerId);
    room.bots = room.bots.filter(bot => bot.id !== playerId);
  }

  private fillVacantRacers(room: RaceRoom): void {
    if (!room.fillBots) return;
    let botNumber = 1;
    while (room.racers.length < PLAYER_LIMIT) {
      const id = `bot-${room.code}-${botNumber}`;
      if (!room.racers.some(racer => racer.id === id)) {
        const bot: RaceRoomPlayer = {
          id,
          name: `Bot ${botNumber}`,
          characterId: ['rogue', 'knight', 'mage', 'barbarian'][(botNumber - 1) % VALID_CHARACTERS.size]!,
          isBot: true,
          ready: true,
          connected: true,
        };
        room.bots.push(bot);
        room.racers.push(bot);
      }
      botNumber += 1;
    }
  }

  private cancelCountdown(room: RaceRoom): void {
    room.phase = 'lobby';
    room.countdownUntil = 0;
    room.racers = [];
    room.bots = [];
    room.engine = null;
    room.engineAccumulatorMs = 0;
  }

  private sendError(socket: RaceSocket, code: string, message: string): void {
    this.sendMessage(socket, { type: 'error', code, message });
  }
}
