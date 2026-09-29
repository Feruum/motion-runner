import { describe, expect, it } from 'bun:test';
import { RaceRoomManager, type RaceSocket } from './race-rooms';
import type { RaceEntrant, RaceInput, RacePlayer, RaceRoomSnapshot, RaceServerMessage, RaceSnapshot } from '../../../packages/game/src/core/race-types';

class FakeEngine {
  readonly entrants: RaceEntrant[];
  readonly updates: Array<{ deltaMs: number; inputs: Record<string, RaceInput> }> = [];
  readonly dnf: string[] = [];
  elapsedMs = 0;
  finished = false;

  constructor(entrants: RaceEntrant[]) {
    this.entrants = entrants;
  }

  update(deltaMs: number, inputs: Record<string, RaceInput>) {
    this.elapsedMs += deltaMs;
    this.updates.push({ deltaMs, inputs: structuredClone(inputs) });
  }

  snapshot(): RaceSnapshot {
    return {
      elapsedMs: this.elapsedMs,
      finished: this.finished,
      players: this.entrants.map((entrant, index): RacePlayer => ({
        ...entrant,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vz: 0,
        checkpoint: 0,
        rank: index + 1,
        finishMs: null,
        status: this.dnf.includes(entrant.id) ? 'dnf' : 'racing',
        invulnerableMs: 0,
        stunMs: 0,
      })),
    };
  }

  markDNF(id: string) {
    this.dnf.push(id);
  }
}

type TestSocket = RaceSocket & { received: RaceServerMessage[] };

function fixture(maxRooms = 64) {
  let now = 1_000;
  let nextId = 0;
  let byte = 0;
  const sent = new Map<TestSocket, RaceServerMessage[]>();
  const engines: FakeEngine[] = [];
  const manager = new RaceRoomManager({
    now: () => now,
    newId: () => `player-${++nextId}`,
    randomBytes: length => Uint8Array.from({ length }, () => ++byte % 256),
    maxRooms,
    send: (socket, message) => sent.get(socket as TestSocket)?.push(structuredClone(message)),
    makeEngine: entrants => {
      const engine = new FakeEngine(entrants);
      engines.push(engine);
      return engine;
    },
  });

  function client() {
    const socket = { received: [] as RaceServerMessage[] } as TestSocket;
    sent.set(socket, socket.received);
    manager.open(socket);
    return {
      socket,
      send(message: unknown) { manager.message(socket, JSON.stringify(message)); },
      last(type: RaceServerMessage['type']) {
        return [...socket.received].reverse().find(message => message.type === type);
      },
      room(): RaceRoomSnapshot {
        const message = this.last('room') ?? this.last('welcome');
        if (!message || (message.type !== 'room' && message.type !== 'welcome')) throw new Error('No room was sent');
        return message.room;
      },
    };
  }

  return {
    manager,
    engines,
    client,
    setNow(value: number) { now = value; },
    advance(ms: number) { now += ms; manager.tick(); },
  };
}

function welcomeFor(client: ReturnType<ReturnType<typeof fixture>['client']>) {
  const welcome = client.last('welcome');
  if (!welcome || welcome.type !== 'welcome') throw new Error('Expected welcome');
  return welcome;
}

describe('private race rooms', () => {
  it('creates a private room with a trimmed player name and a per-player resume token', () => {
    const { client } = fixture();
    const host = client();
    host.send({ type: 'create', name: '  Alice  ', characterId: 'rogue' });

    const welcome = welcomeFor(host);
    expect(welcome.room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(welcome.room.fillBots).toBe(true);
    expect(welcome.room.players).toEqual([expect.objectContaining({ id: welcome.playerId, name: 'Alice', characterId: 'rogue', connected: true, ready: false })]);
    expect(welcome.token.length).toBeGreaterThanOrEqual(32);
    expect(JSON.stringify(host.socket.received.map(message => message.type === 'welcome' ? message.room : message))).not.toContain(welcome.token);
  });

  it('rejects malformed, oversized, and extra-field client messages', () => {
    const { manager, client } = fixture();
    const player = client();
    manager.message(player.socket, '{');
    expect(player.last('error')).toMatchObject({ type: 'error', code: 'INVALID_MESSAGE' });

    player.send({ type: 'create', name: 'Alice', characterId: 'rogue', fillBots: true, isHost: true });
    expect(player.last('error')).toMatchObject({ type: 'error', code: 'INVALID_MESSAGE' });

    manager.message(player.socket, ' '.repeat(4_097));
    expect(player.last('error')).toMatchObject({ type: 'error', code: 'MESSAGE_TOO_LARGE' });
  });

  it('validates player names and character IDs before reserving a room', () => {
    const { client } = fixture();
    const emptyName = client();
    emptyName.send({ type: 'create', name: '   ', characterId: 'rogue', fillBots: true });
    expect(emptyName.last('error')).toMatchObject({ type: 'error', code: 'INVALID_PLAYER' });

    const unknownCharacter = client();
    unknownCharacter.send({ type: 'create', name: 'Alice', characterId: 'dragon', fillBots: true });
    expect(unknownCharacter.last('error')).toMatchObject({ type: 'error', code: 'INVALID_PLAYER' });

    const tooLong = client();
    tooLong.send({ type: 'create', name: 'A'.repeat(25), characterId: 'rogue', fillBots: true });
    expect(tooLong.last('error')).toMatchObject({ type: 'error', code: 'INVALID_PLAYER' });
  });

  it('allows room actions only for the host and starts after every connected human is ready', () => {
    const { client, advance, engines } = fixture();
    const host = client();
    const guest = client();
    host.send({ type: 'create', name: 'Host', characterId: 'knight', fillBots: false });
    const code = welcomeFor(host).room.code;
    guest.send({ type: 'join', code, name: 'Guest', characterId: 'mage' });
    const hostId = welcomeFor(host).playerId;
    const guestId = welcomeFor(guest).playerId;

    guest.send({ type: 'fillBots', enabled: true });
    expect(guest.last('error')).toMatchObject({ type: 'error', code: 'NOT_HOST' });
    guest.send({ type: 'start' });
    expect(guest.last('error')).toMatchObject({ type: 'error', code: 'NOT_HOST' });
    host.send({ type: 'ready', ready: true });
    host.send({ type: 'start' });
    expect(host.last('error')).toMatchObject({ type: 'error', code: 'PLAYERS_NOT_READY' });
    guest.send({ type: 'ready', ready: true });
    host.send({ type: 'start' });
    expect(host.room().phase).toBe('countdown');
    expect(engines).toHaveLength(0);

    advance(2_999);
    expect(host.room().phase).toBe('countdown');
    advance(1);
    expect(host.room().phase).toBe('racing');
    expect(engines[0].entrants.map(player => player.id)).toEqual([hostId, guestId]);
  });

  it('fills vacant seats with bots when enabled and only permits lobby joins', () => {
    const { client, advance, engines } = fixture();
    const host = client();
    const late = client();
    host.send({ type: 'create', name: 'Host', characterId: 'rogue', fillBots: true });
    const code = welcomeFor(host).room.code;
    host.send({ type: 'ready', ready: true });
    host.send({ type: 'start' });
    expect(host.room().players.filter(player => player.isBot)).toHaveLength(7);
    advance(3_000);
    expect(engines[0].entrants).toHaveLength(8);
    late.send({ type: 'join', code, name: 'Late', characterId: 'barbarian' });
    expect(late.last('error')).toMatchObject({ type: 'error', code: 'ROOM_LOCKED' });
  });

  it('authenticates resume, rebinds the socket, resets sequence state, and keeps tokens private', () => {
    const { client, manager } = fixture();
    const host = client();
    host.send({ type: 'create', name: 'Alice', characterId: 'rogue', fillBots: false });
    const welcome = welcomeFor(host);
    manager.close(host.socket);

    const resumed = client();
    resumed.send({ type: 'resume', code: welcome.room.code, token: welcome.token });
    expect(welcomeFor(resumed).playerId).toBe(welcome.playerId);
    expect(resumed.room().players[0]?.connected).toBe(true);
    expect(JSON.stringify(resumed.socket.received.flatMap(message => message.type === 'room' || message.type === 'welcome' ? [message.room] : []))).not.toContain(welcome.token);

    const impostor = client();
    impostor.send({ type: 'resume', code: welcome.room.code, token: `${welcome.token}x` });
    expect(impostor.last('error')).toMatchObject({ type: 'error', code: 'INVALID_RESUME' });
  });

  it('accepts monotonic bounded inputs, consumes each jump once, and stops stale camera input', () => {
    const { client, advance, engines } = fixture();
    const host = client();
    host.send({ type: 'create', name: 'Alice', characterId: 'rogue', fillBots: false });
    const playerId = welcomeFor(host).playerId;
    host.send({ type: 'ready', ready: true });
    host.send({ type: 'start' });
    advance(3_000);

    host.send({ type: 'input', seq: 4, steer: 0.75, jump: true, tracking: true });
    host.send({ type: 'input', seq: 5, steer: 0.8, jump: false, tracking: true });
    advance(34);
    expect(engines[0].updates.at(-1)?.inputs[playerId]).toEqual({ steer: 0.8, jump: true, tracking: true });
    advance(34);
    expect(engines[0].updates.at(-1)?.inputs[playerId]?.jump).toBe(false);

    host.send({ type: 'input', seq: 5, steer: -0.5, jump: false, tracking: true });
    expect(host.last('error')).toMatchObject({ type: 'error', code: 'INVALID_INPUT' });
    host.send({ type: 'input', seq: 6, steer: 1.01, jump: false, tracking: true });
    expect(host.last('error')).toMatchObject({ type: 'error', code: 'INVALID_MESSAGE' });
    advance(501);
    expect(engines[0].updates.at(-1)?.inputs[playerId]).toEqual({ steer: 0, jump: false, tracking: false });
  });

  it('transfers host on disconnect, expires lobby slots, and marks racing disconnects DNF after grace', () => {
    const { client, manager, advance, engines } = fixture();
    const host = client();
    const guest = client();
    host.send({ type: 'create', name: 'Host', characterId: 'rogue', fillBots: false });
    const code = welcomeFor(host).room.code;
    guest.send({ type: 'join', code, name: 'Guest', characterId: 'mage' });
    const hostId = welcomeFor(host).playerId;
    const guestId = welcomeFor(guest).playerId;
    manager.close(host.socket);
    expect(guest.room().hostId).toBe(guestId);
    advance(10_001);
    expect(guest.room().players.map(player => player.id)).toEqual([guestId]);

    guest.send({ type: 'ready', ready: true });
    guest.send({ type: 'start' });
    advance(3_000);
    manager.close(guest.socket);
    advance(10_001);
    expect(engines[0].dnf).toContain(guestId);
    expect(guestId).not.toBe(hostId);
  });

  it('removes a player who explicitly leaves during countdown before building the engine', () => {
    const { client, advance, engines } = fixture();
    const host = client();
    const guest = client();
    host.send({ type: 'create', name: 'Host', characterId: 'rogue', fillBots: true });
    const code = welcomeFor(host).room.code;
    guest.send({ type: 'join', code, name: 'Guest', characterId: 'mage' });
    const hostId = welcomeFor(host).playerId;
    const guestId = welcomeFor(guest).playerId;
    host.send({ type: 'ready', ready: true });
    guest.send({ type: 'ready', ready: true });
    host.send({ type: 'start' });
    host.send({ type: 'leave' });
    expect(guest.room().hostId).toBe(guestId);
    advance(3_000);
    expect(engines[0].entrants.some(entrant => entrant.id === hostId)).toBe(false);
    expect(engines[0].entrants.some(entrant => entrant.id === guestId)).toBe(true);
    expect(engines[0].entrants).toHaveLength(8);
  });

  it('removes an expired disconnected lobby player from an overdue countdown', () => {
    const { client, manager, advance, engines } = fixture();
    const host = client();
    const guest = client();
    host.send({ type: 'create', name: 'Host', characterId: 'rogue', fillBots: false });
    const code = welcomeFor(host).room.code;
    guest.send({ type: 'join', code, name: 'Guest', characterId: 'mage' });
    const hostId = welcomeFor(host).playerId;
    const guestId = welcomeFor(guest).playerId;
    host.send({ type: 'ready', ready: true });
    guest.send({ type: 'ready', ready: true });
    host.send({ type: 'start' });
    manager.close(host.socket);
    advance(10_001);

    expect(engines[0].entrants.map(entrant => entrant.id)).toEqual([guestId]);
    expect(engines[0].entrants.some(entrant => entrant.id === hostId)).toBe(false);
  });

  it('rate limits each socket and expires rooms after all humans have been gone for fifteen minutes', () => {
    const { manager, client, advance } = fixture(1);
    const noisy = client();
    for (let index = 0; index <= 120; index += 1) manager.message(noisy.socket, '{');
    expect(noisy.last('error')).toMatchObject({ type: 'error', code: 'RATE_LIMITED' });

    const host = client();
    host.send({ type: 'create', name: 'Host', characterId: 'rogue', fillBots: false });
    manager.close(host.socket);
    advance(15 * 60_000);
    const replacement = client();
    replacement.send({ type: 'create', name: 'Replacement', characterId: 'knight', fillBots: false });
    expect(replacement.last('welcome')).toMatchObject({ type: 'welcome' });
  });

  it('lets a host explicitly leave, invalidates that player slot, and keeps the room bounded', () => {
    const { client, advance, engines, manager } = fixture(1);
    const host = client();
    host.send({ type: 'create', name: 'Host', characterId: 'rogue', fillBots: false });
    const welcome = welcomeFor(host);
    const guest = client();
    guest.send({ type: 'join', code: welcome.room.code, name: 'Guest', characterId: 'mage' });
    const extra = client();
    extra.send({ type: 'create', name: 'Extra', characterId: 'mage', fillBots: false });
    expect(extra.last('error')).toMatchObject({ type: 'error', code: 'ROOM_LIMIT' });

    host.send({ type: 'ready', ready: true });
    guest.send({ type: 'ready', ready: true });
    host.send({ type: 'start' });
    advance(3_000);
    host.send({ type: 'leave' });
    expect(engines[0].dnf).toContain(welcome.playerId);
    expect(guest.room().players.some(player => player.id === welcome.playerId)).toBe(false);

    const impostor = client();
    impostor.send({ type: 'resume', code: welcome.room.code, token: welcome.token });
    expect(impostor.last('error')).toMatchObject({ type: 'error', code: 'INVALID_RESUME' });
    manager.close(host.socket);
  });

  it('lets only the host reset results into a fresh unready lobby', () => {
    const { client, advance, engines } = fixture();
    const host = client();
    const guest = client();
    host.send({ type: 'create', name: 'Host', characterId: 'rogue', fillBots: false });
    const code = welcomeFor(host).room.code;
    guest.send({ type: 'join', code, name: 'Guest', characterId: 'mage' });
    host.send({ type: 'ready', ready: true });
    guest.send({ type: 'ready', ready: true });
    host.send({ type: 'start' });
    advance(3_000);
    engines[0].finished = true;
    advance(34);
    expect(host.room().phase).toBe('results');

    guest.send({ type: 'rematch' });
    expect(guest.last('error')).toMatchObject({ type: 'error', code: 'NOT_HOST' });
    host.send({ type: 'rematch' });
    expect(host.room().phase).toBe('lobby');
    expect(host.room().players.every(player => !player.ready && !player.isBot)).toBe(true);
  });

  it('keeps the transferred host after the original host resumes and the new host rematches', () => {
    const { client, manager, advance, engines } = fixture();
    const originalHost = client();
    const transferredHost = client();
    originalHost.send({ type: 'create', name: 'One', characterId: 'rogue', fillBots: false });
    const originalWelcome = welcomeFor(originalHost);
    transferredHost.send({ type: 'join', code: originalWelcome.room.code, name: 'Two', characterId: 'mage' });
    const transferredId = welcomeFor(transferredHost).playerId;

    manager.close(originalHost.socket);
    expect(transferredHost.room().hostId).toBe(transferredId);
    const resumedOriginal = client();
    resumedOriginal.send({ type: 'resume', code: originalWelcome.room.code, token: originalWelcome.token });
    expect(welcomeFor(resumedOriginal).playerId).toBe(originalWelcome.playerId);
    expect(resumedOriginal.room().hostId).toBe(transferredId);

    resumedOriginal.send({ type: 'ready', ready: true });
    transferredHost.send({ type: 'ready', ready: true });
    transferredHost.send({ type: 'start' });
    advance(3_000);
    engines[0].finished = true;
    advance(34);
    expect(transferredHost.room().phase).toBe('results');

    transferredHost.send({ type: 'rematch' });
    expect(transferredHost.room().phase).toBe('lobby');
    expect(transferredHost.room().hostId).toBe(transferredId);
  });
});
