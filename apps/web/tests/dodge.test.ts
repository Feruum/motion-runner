import { describe, expect, it } from 'vitest';
import {
  DODGE_FIRST_WAVE_MS,
  DODGE_ROUND_DURATION_MS,
  DODGE_WAVE_COUNT,
  DODGE_WAVE_INTERVAL_MS,
  DodgeArenaRuntime,
  makeDodgeWaves,
  validateDodgeWaves,
} from '../../../packages/game/src/core/dodge';
import type { DodgeEvent, DodgeLane, DodgeWave } from '../../../packages/game/src/core/dodge';

const lanes: readonly DodgeLane[] = [-1, 0, 1];

function wave(id: number, atMs: number, obstacleLanes: readonly DodgeLane[]): DodgeWave {
  return { id, atMs, warningAtMs: atMs - 2_000, obstacles: obstacleLanes.map(lane => ({ lane, kind: 'high' })), resolved: false };
}

function safeLanes(item: DodgeWave): DodgeLane[] {
  return lanes.filter(lane => !item.obstacles.some(obstacle => obstacle.lane === lane));
}

function advance(runtime: DodgeArenaRuntime, deltaMs: number, lane: DodgeLane): DodgeEvent[] {
  let advancedMs = 0;
  let events: DodgeEvent[] = [];
  while (advancedMs < deltaMs) {
    const stepMs = Math.min(250, deltaMs - advancedMs);
    events = runtime.update(stepMs, { lane });
    advancedMs += stepMs;
  }
  return events;
}

describe('Dodge Arena runtime', () => {
  it('builds the 24-wave lane-only schedule and validates safe lanes', () => {
    const waves = makeDodgeWaves();

    expect(waves).toHaveLength(DODGE_WAVE_COUNT);
    expect(waves.map(item => item.atMs)).toEqual(Array.from({ length: 24 }, (_, index) => 4_000 + index * 2_300));
    expect(waves[0].warningAtMs).toBe(2_000);
    expect(waves.every(item => item.warningAtMs <= item.atMs - 2_000)).toBe(true);
    expect(waves.every(item => item.obstacles.every(obstacle => obstacle.kind === 'high'))).toBe(true);
    expect(waves.slice(0, 8).every(item => item.obstacles.length === 1)).toBe(true);
    expect(waves.slice(8, 16).every((item, index) => item.obstacles.length === (index % 2 === 0 ? 1 : 2))).toBe(true);
    expect(waves.slice(16).every(item => item.obstacles.length === 2 && safeLanes(item).length === 1)).toBe(true);
    expect(waves.every(item => safeLanes(item).length > 0)).toBe(true);
    expect(waves[0].atMs).toBe(DODGE_FIRST_WAVE_MS);
    expect(waves[1].atMs - waves[0].atMs).toBe(DODGE_WAVE_INTERVAL_MS);
    expect(() => validateDodgeWaves(waves)).not.toThrow();

    const blocked = wave(99, 58_000, [-1, 0, 1]);
    expect(safeLanes(blocked)).toHaveLength(0);
    expect(() => validateDodgeWaves([blocked])).toThrow(/safe lane/i);
  });

  it('rejects individually safe consecutive waves with no reachable lane transition', () => {
    const tooSoon = [wave(0, 0, [-1, 1]), wave(1, 1_249, [-1, 0])];
    expect(tooSoon.every(item => safeLanes(item).length > 0)).toBe(true);
    expect(() => validateDodgeWaves(tooSoon)).toThrow(/consecutive|transition|reachable/i);

    const enoughTime = [wave(0, 0, [-1, 1]), wave(1, 1_250, [-1, 0])];
    expect(() => validateDodgeWaves(enoughTime)).not.toThrow();
  });

  it('scores clears once and applies a penalty and collision count per obstacle', () => {
    const runtime = new DodgeArenaRuntime(1_000, [
      wave(0, 100, [1]),
      wave(1, 200, [0, 0]),
    ]);

    runtime.update(100, { lane: 0 });
    expect(runtime.snapshot()).toMatchObject({ score: 10, cleared: 1, collisions: 0, misses: 0, combo: 1 });

    const collisionEvents = runtime.update(100, { lane: 0 });
    expect(collisionEvents).toContain('hit');
    expect(runtime.snapshot()).toMatchObject({ score: 0, cleared: 1, collisions: 2, misses: 1, combo: 0, bestCombo: 1 });

    runtime.update(400, { lane: 0 });
    expect(runtime.snapshot()).toMatchObject({ score: 0, cleared: 1, collisions: 2, misses: 1 });

    const scoreFloor = new DodgeArenaRuntime(1_000, [wave(0, 100, [0, 0])]);
    scoreFloor.update(100, { lane: 0 });
    expect(scoreFloor.snapshot()).toMatchObject({ score: 0, collisions: 2, misses: 1 });
  });

  it('avoids high hazards by changing to a reachable lane', () => {
    const runtime = new DodgeArenaRuntime(1_000, [wave(0, 100, [0])]);
    runtime.update(50, { lane: 0 });
    runtime.update(50, { lane: -1 });
    expect(runtime.snapshot()).toMatchObject({ cleared: 1, collisions: 0, misses: 0, score: 10 });
  });

  it('rejects a frame delta over 300 ms without changing the lane or resolving stale waves', () => {
    const runtime = new DodgeArenaRuntime(1_000, [wave(0, 100, [0]), wave(1, 200, [0])]);
    runtime.update(100, { lane: 0 });
    const events = runtime.update(301, { lane: -1 });

    expect(events).toEqual([]);
    expect(runtime.snapshot()).toMatchObject({ elapsedMs: 100, lane: 0, collisions: 1, misses: 1, cleared: 0 });
    expect(runtime.waves[1].resolved).toBe(false);

    runtime.update(100, { lane: -1 });
    expect(runtime.snapshot()).toMatchObject({ elapsedMs: 200, lane: -1, collisions: 1, misses: 1, cleared: 1 });
  });

  it('resets the combo after a collision', () => {
    const runtime = new DodgeArenaRuntime(1_000, [wave(0, 100, [1]), wave(1, 200, [0]), wave(2, 300, [1])]);

    runtime.update(100, { lane: 0 });
    runtime.update(100, { lane: 0 });
    expect(runtime.snapshot()).toMatchObject({ combo: 0, bestCombo: 1, misses: 1 });
    runtime.update(100, { lane: 0 });
    expect(runtime.snapshot()).toMatchObject({ combo: 1, bestCombo: 1, cleared: 2, misses: 1 });
  });

  it('pauses, resumes, finishes a 60-second round, and resets for replay', () => {
    const runtime = new DodgeArenaRuntime();
    runtime.update(100, { lane: 0 });
    runtime.pause();
    runtime.update(5_000, { lane: -1 });
    expect(runtime.snapshot()).toMatchObject({ elapsedMs: 100, paused: true, finished: false });

    runtime.resume();
    advance(runtime, 59_900, 0);
    expect(runtime.snapshot()).toMatchObject({ elapsedMs: DODGE_ROUND_DURATION_MS, finished: true, paused: false });
    const snapshotBeforeReplay = runtime.snapshot();
    runtime.update(1_000, { lane: -1 });
    expect(runtime.snapshot()).toEqual(snapshotBeforeReplay);

    runtime.reset();
    expect(runtime.snapshot()).toMatchObject({ elapsedMs: 0, score: 0, cleared: 0, collisions: 0, misses: 0, combo: 0, bestCombo: 0, paused: false, finished: false });
    expect(runtime.waves.every(item => !item.resolved)).toBe(true);
  });

  it('does not score while paused or count waves scheduled after the round ends as misses', () => {
    const paused = new DodgeArenaRuntime(1_000, [wave(0, 100, [0])]);
    paused.pause();
    expect(paused.update(1_000, { lane: 0 })).toEqual([]);
    expect(paused.snapshot()).toMatchObject({ elapsedMs: 0, score: 0, collisions: 0, misses: 0, paused: true });

    const future = new DodgeArenaRuntime(1_000, [wave(0, 1_001, [0])]);
    const events = advance(future, 1_000, 0);
    expect(events).toContain('finish');
    expect(future.snapshot()).toMatchObject({ elapsedMs: 1_000, score: 0, collisions: 0, misses: 0, finished: true });
    expect(future.waves[0].resolved).toBe(false);
  });
});
