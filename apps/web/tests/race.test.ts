import { describe, expect, it } from 'vitest';
import { RaceEngine } from '../../../packages/game/src/core/race';
import { RACE_TRACK, obstacleOffset } from '../../../packages/game/src/core/race-track';
import type { RaceEntrant, RaceInput, RacePlayer } from '../../../packages/game/src/core/race-types';

const human: RaceEntrant = { id: 'runner', name: 'Runner', characterId: 'fox', isBot: false };

function entrants(count: number, bot = false): RaceEntrant[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${bot ? 'bot' : 'runner'}-${index}`,
    name: `${bot ? 'Bot' : 'Runner'} ${index}`,
    characterId: 'fox',
    isBot: bot,
  }));
}

function step(engine: RaceEngine, steps: number, inputs: Record<string, RaceInput> = {}): void {
  for (let index = 0; index < steps; index += 1) engine.update(1000 / 30, inputs);
}

describe('Party Race track', () => {
  it('defines the shared 480 m course and deterministic moving hazards', () => {
    expect(RACE_TRACK).toMatchObject({ length: 480, width: 12, speed: 8, timeLimitMs: 120_000, checkpoints: [0, 160, 320] });
    expect(RACE_TRACK.obstacles.map(({ kind, z }) => [kind, z])).toEqual([
      ['gate', 60], ['gate', 110], ['sweeper', 200], ['sweeper', 260], ['gap', 360], ['gap', 420],
    ]);

    const gate = RACE_TRACK.obstacles[0];
    const sweeper = RACE_TRACK.obstacles[2];
    expect(obstacleOffset(gate, gate.periodMs / 4)).toBeCloseTo(gate.amplitude);
    expect(obstacleOffset(gate, gate.periodMs / 4 + gate.periodMs)).toBeCloseTo(obstacleOffset(gate, gate.periodMs / 4));
    expect(Number.isFinite(obstacleOffset(gate, Number.MAX_VALUE))).toBe(true);
    expect(obstacleOffset(sweeper, sweeper.periodMs / 4)).toBeCloseTo(sweeper.amplitude);
    expect(obstacleOffset(sweeper, sweeper.periodMs / 4 + sweeper.periodMs)).toBeCloseTo(obstacleOffset(sweeper, sweeper.periodMs / 4));
  });
});

describe('Party Race engine', () => {
  it('advances at 30 Hz, clamps continuous steering to the track, and snapshots defensively', () => {
    const entrant = { ...human };
    const inputs = { runner: { steer: 1, jump: false, tracking: true } };
    const oneFrame = new RaceEngine([entrant], 3);
    const thirtyFrames = new RaceEngine([entrant], 3);

    oneFrame.update(1000, inputs);
    step(thirtyFrames, 30, inputs);

    expect(oneFrame.snapshot()).toEqual(thirtyFrames.snapshot());
    expect(oneFrame.snapshot()).toMatchObject({ elapsedMs: 1000, players: [{ x: 5.5, vx: 6, vz: 8 }] });
    expect(oneFrame.snapshot().players[0].z).toBeCloseTo(8);
    const leaked = oneFrame.snapshot();
    leaked.players[0].x = -999;
    leaked.players[0].name = 'changed';
    expect(oneFrame.snapshot().players[0]).toMatchObject({ x: 5.5, name: 'Runner' });
  });

  it('freezes horizontal movement when tracking is lost and does not queue a held jump', () => {
    const engine = new RaceEngine([human]);
    const noTracking = { runner: { steer: 1, jump: true, tracking: false } };
    step(engine, 30, noTracking);
    expect(engine.snapshot().players[0]).toMatchObject({ x: 0, y: 0, z: 0, vx: 0, vz: 0 });

    step(engine, 3, { runner: { ...noTracking.runner, tracking: true } });
    expect(engine.snapshot().players[0].y).toBe(0);
    step(engine, 1, { runner: { steer: 0, jump: false, tracking: true } });
    step(engine, 1, { runner: { steer: 0, jump: true, tracking: true } });
    expect(engine.snapshot().players[0].y).toBeGreaterThan(0);
  });

  it('latches a one-frame jump pulse until the next fixed simulation step', () => {
    const engine = new RaceEngine([human]);
    engine.update(10, { runner: { steer: 0, jump: true, tracking: true } });
    engine.update(10, { runner: { steer: 0, jump: false, tracking: true } });
    engine.update(14, { runner: { steer: 0, jump: false, tracking: true } });
    expect(engine.snapshot().players[0].y).toBeGreaterThan(0);
  });

  it('drops a pending jump pulse if tracking is lost before the simulation step', () => {
    const engine = new RaceEngine([human]);
    engine.update(10, { runner: { steer: 0, jump: true, tracking: false } });
    engine.update(24, { runner: { steer: 0, jump: false, tracking: true } });
    expect(engine.snapshot().players[0].y).toBe(0);
  });

  it('uses a rising jump pulse and requires release after landing before another jump', () => {
    const engine = new RaceEngine([human]);
    const held = { runner: { steer: 0, jump: true, tracking: true } };
    step(engine, 1, held);
    expect(engine.snapshot().players[0].y).toBeGreaterThan(0);

    step(engine, 45, held);
    expect(engine.snapshot().players[0].y).toBe(0);
    step(engine, 1, { runner: { ...held.runner, jump: false } });
    step(engine, 1, held);
    expect(engine.snapshot().players[0].y).toBeGreaterThan(0);
  });

  it('sanitizes non-finite deltas and steering values', () => {
    const engine = new RaceEngine([human]);
    engine.update(Number.NaN, { runner: { steer: 1, jump: false, tracking: true } });
    engine.update(Number.POSITIVE_INFINITY, { runner: { steer: 1, jump: false, tracking: true } });
    expect(engine.snapshot().elapsedMs).toBe(0);

    engine.update(1000 / 30, { runner: { steer: Number.NaN, jump: false, tracking: true } });
    expect(engine.snapshot().players[0]).toMatchObject({ x: 0, z: 8 / 30, vx: 0 });
  });

  it('knocks a runner back on a closed gate and lets the stun clear without repeated lockup', () => {
    const engine = new RaceEngine([human], 10);
    const input = { runner: { steer: 0, jump: false, tracking: true } };

    for (let index = 0; index < 600 && engine.snapshot().players[0].stunMs === 0; index += 1) step(engine, 1, input);
    const impact = engine.snapshot().players[0];
    expect(impact.z).toBeGreaterThan(106);
    expect(impact.stunMs).toBeGreaterThan(0);
    expect(impact.invulnerableMs).toBeGreaterThan(0);

    step(engine, 60, input);
    expect(engine.snapshot().players[0].stunMs).toBe(0);
    expect(engine.snapshot().players[0].z).toBeGreaterThan(110);
  });

  it('collides with the rotated end of a sweeper away from its center z', () => {
    const engine = new RaceEngine([human]);
    const sweeper = RACE_TRACK.obstacles.find(obstacle => obstacle.kind === 'sweeper')!;
    const elapsedMs = 600;
    const angle = obstacleOffset(sweeper, elapsedMs);
    const z = sweeper.z - 2.4;
    const player: RacePlayer = {
      ...human,
      x: -(z - sweeper.z) * Math.cos(angle) / Math.sin(angle),
      y: 0,
      z,
      vx: 0,
      vz: 8,
      checkpoint: 0,
      rank: 1,
      finishMs: null,
      status: 'racing',
      invulnerableMs: 0,
      stunMs: 0,
    };
    const collisionCheck = (engine as unknown as {
      collidesWithObstacle: (candidate: RacePlayer, timeMs: number) => boolean;
    }).collidesWithObstacle;

    expect(collisionCheck.call(engine, player, elapsedMs)).toBe(true);
  });

  it('applies a capped slowdown on ground contact and then lets both racers recover', () => {
    const [first, second] = entrants(2);
    const engine = new RaceEngine([first, second]);
    step(engine, 1, {
      [first.id]: { steer: 1, jump: false, tracking: true },
      [second.id]: { steer: -1, jump: false, tracking: true },
    });
    const bumped = engine.snapshot().players;
    expect(bumped.every(player => player.stunMs > 0)).toBe(true);
    expect(bumped.every(player => player.vz < 8)).toBe(true);

    step(engine, 30, {
      [first.id]: { steer: -1, jump: false, tracking: true },
      [second.id]: { steer: 1, jump: false, tracking: true },
    });
    expect(engine.snapshot().players.every(player => player.stunMs === 0)).toBe(true);
    expect(engine.snapshot().players.every(player => player.z > 6)).toBe(true);
  });

  it('does not bump across a jump-height separation', () => {
    const [first, second] = entrants(2);
    const engine = new RaceEngine([first, second]);
    step(engine, 7, {
      [first.id]: { steer: -1, jump: true, tracking: true },
      [second.id]: { steer: 1, jump: false, tracking: true },
    });
    step(engine, 8, {
      [first.id]: { steer: 1, jump: false, tracking: true },
      [second.id]: { steer: -1, jump: false, tracking: true },
    });
    const players = engine.snapshot().players;
    expect(players[0].y).toBeGreaterThan(0.8);
    expect(players.every(player => player.stunMs === 0)).toBe(true);
    expect(players[0].vx).toBe(6);
    expect(players[1].vx).toBe(-6);
  });

  it('keeps an untracked runner fixed when another runner reaches them', () => {
    const [first, second] = entrants(2);
    const engine = new RaceEngine([first, second]);
    step(engine, 4, {
      [first.id]: { steer: 0, jump: false, tracking: false },
      [second.id]: { steer: -1, jump: false, tracking: true },
    });
    const stopped = engine.snapshot().players.find(player => player.id === first.id)!;
    expect(stopped).toMatchObject({ x: -0.55, z: 0, stunMs: 0, vx: 0, vz: 0 });
  });

  it('honors respawn collision protection for overlapping racers', () => {
    const engine = new RaceEngine(entrants(2));
    const internals = engine as unknown as {
      runners: Array<{ player: RacePlayer; tracking: boolean }>;
      resolvePlayerBumps: () => void;
    };
    const [first, second] = internals.runners;
    first.player.x = 0;
    first.player.z = 20;
    internals.runners[0].tracking = true;
    first.player.invulnerableMs = 1000;
    second.player.x = 0.2;
    second.player.z = 20;
    internals.runners[1].tracking = true;

    internals.resolvePlayerBumps();
    expect(first.player.stunMs).toBe(0);
    expect(second.player.stunMs).toBe(0);

    first.player.invulnerableMs = 0;
    internals.resolvePlayerBumps();
    expect(first.player.stunMs).toBeGreaterThan(0);
    expect(second.player.stunMs).toBeGreaterThan(0);
  });

  it('falls into an unjumped gap, respawns at the latest checkpoint, and grants protection', () => {
    const engine = new RaceEngine([human], 4);
    const input = { runner: { steer: 0, jump: false, tracking: true } };
    for (let index = 0; index < 1800 && engine.snapshot().players[0].status !== 'falling'; index += 1) step(engine, 1, input);

    expect(engine.snapshot().players[0]).toMatchObject({ status: 'falling', checkpoint: 320 });
    step(engine, 24, input);
    expect(engine.snapshot().players[0]).toMatchObject({ status: 'racing', z: 320, invulnerableMs: 1000 });
  });

  it('ranks racers by progress, puts DNF last, and records finish time at the line', () => {
    const first = entrants(1)[0];
    const second = entrants(1, true)[0];
    const engine = new RaceEngine([first, second]);
    step(engine, 30, {
      [first.id]: { steer: 0, jump: false, tracking: false },
      [second.id]: { steer: 0, jump: false, tracking: true },
    });
    expect(engine.snapshot().players.find(player => player.id === second.id)?.rank).toBe(1);
    expect(engine.snapshot().players.find(player => player.id === first.id)?.rank).toBe(2);

    engine.markDNF(first.id);
    expect(engine.snapshot().players.find(player => player.id === first.id)).toMatchObject({ status: 'dnf', rank: 2 });
    engine.update(120_000, { [first.id]: { steer: 0, jump: false, tracking: true } });
    expect(engine.snapshot()).toMatchObject({ finished: true });
    expect(engine.snapshot().players.find(player => player.id === second.id)).toMatchObject({ status: 'finished', rank: 1 });
    expect(engine.snapshot().players.find(player => player.id === second.id)?.finishMs).toBeGreaterThan(0);
  });

  it('marks unfinished racers DNF at the two-minute limit', () => {
    const engine = new RaceEngine([human]);
    step(engine, 3600, { runner: { steer: 0, jump: false, tracking: false } });
    expect(engine.snapshot()).toMatchObject({ elapsedMs: 120_000, finished: true, players: [{ status: 'dnf', finishMs: null }] });
  });

  it('runs deterministic bots through complete races under the same course rules', () => {
    for (const seed of [1, 27, 842]) {
      const engine = new RaceEngine(entrants(6, true), seed);
      engine.update(120_000, {});
      const result = engine.snapshot();
      expect(result.finished).toBe(true);
      expect(result.players.every(player => player.status === 'finished')).toBe(true);
      expect(result.players.every(player => player.finishMs !== null && player.finishMs < RACE_TRACK.timeLimitMs)).toBe(true);
      expect(result.players.map(player => player.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });
});
