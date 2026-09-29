import { describe, expect, it } from 'vitest';
import type { PoseSample, Landmark } from '../../../packages/game/src/core/types';
import { DANCE_CUE_INTERVAL_MS, DANCE_CUES, type DanceCue, type DanceFeature } from '../../../packages/game/src/core/dance';
import {
  DANCE_DUO_SYNC_BONUS,
  DANCE_DUO_SYNC_WINDOW_MS,
  DanceDuoRuntime,
} from '../../../packages/game/src/core/dance-duo';

type FeatureKey = DanceFeature['id'];

const defaults: Record<FeatureKey, number> = {
  leftWristOut: 0.36,
  leftWristY: 0.82,
  rightWristOut: 0.36,
  rightWristY: 0.82,
  leftElbowAngleDeg: 180,
  rightElbowAngleDeg: 180,
  torsoLeanDeg: 0,
  leftFootOut: 0.27,
  rightFootOut: 0.27,
};

/** Build a full-confidence pose from the same normalized features consumed by Dance Solo. */
function poseFor(cue: DanceCue): Landmark[] {
  const values = { ...defaults };
  for (const feature of cue.features) values[feature.id] = feature.target;
  const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99, presence: 0.99 }));
  const set = (index: number, x: number, y: number) => { points[index] = { x, y, z: 0, visibility: 0.99, presence: 0.99 }; };
  const torso = 0.33;
  const hipX = 0.5;
  const hipY = 0.68;
  const lean = values.torsoLeanDeg * Math.PI / 180;
  const shoulderX = hipX + Math.sin(lean) * torso;
  const shoulderY = hipY - Math.cos(lean) * torso;
  set(11, shoulderX + 0.12, shoulderY); set(12, shoulderX - 0.12, shoulderY);
  set(23, hipX + 0.09, hipY); set(24, hipX - 0.09, hipY);

  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? 1 : -1;
    const shoulderIndex = side === 'left' ? 11 : 12;
    const elbowIndex = side === 'left' ? 13 : 14;
    const wristIndex = side === 'left' ? 15 : 16;
    const wristX = hipX + sign * values[`${side}WristOut`] * torso;
    const wristY = shoulderY + values[`${side}WristY`] * torso;
    const shoulder = points[shoulderIndex];
    set(wristIndex, wristX, wristY);
    set(elbowIndex, (shoulder.x + wristX) / 2, (shoulder.y + wristY) / 2);

    const hipIndex = side === 'left' ? 23 : 24;
    const kneeIndex = side === 'left' ? 25 : 26;
    const ankleIndex = side === 'left' ? 27 : 28;
    const ankleX = hipX + sign * values[`${side}FootOut`] * torso;
    set(kneeIndex, (points[hipIndex].x + ankleX) / 2, 0.82);
    set(ankleIndex, ankleX, 0.96);
  }
  return points;
}

function sample(timestampMs: number, players: Landmark[][]): Pick<PoseSample, 'timestampMs' | 'players'> {
  return { timestampMs, players };
}

function feed(runtime: DanceDuoRuntime, first: Landmark[], second: Landmark[], startMs = 0, endMs = 500) {
  let result = runtime.update(sample(startMs, [first, second]));
  for (let timestampMs = startMs + 50; timestampMs <= endMs; timestampMs += 50) {
    result = runtime.update(sample(timestampMs, [first, second]));
  }
  return result;
}

describe('Dance Duo runtime', () => {
  it('rewards two players who hold the same cue together, without repeating the sync reward', () => {
    const runtime = new DanceDuoRuntime();
    const target = poseFor(DANCE_CUES[0]);
    const result = feed(runtime, target, target);

    expect(result).toMatchObject({
      currentCueIndex: 0,
      playerOneScore: 100,
      playerTwoScore: 100,
      teamScore: DANCE_DUO_SYNC_BONUS,
      synchronizedCueCount: 1,
      synchronization: 'synchronized',
      syncDeltaMs: 0,
      diagnosis: 'both-matched',
    });
    expect(result.players.map(player => player.completedCueCount)).toEqual([1, 1]);
    expect(runtime.update(sample(550, [target, target]))).toMatchObject({
      playerOneScore: 100,
      playerTwoScore: 100,
      teamScore: DANCE_DUO_SYNC_BONUS,
      synchronizedCueCount: 1,
      synchronization: null,
    });
  });

  it('identifies the player who needs correction and keeps individual scores independent', () => {
    const runtime = new DanceDuoRuntime();
    const correct = poseFor(DANCE_CUES[0]);
    const wrong = poseFor(DANCE_CUES[1]);
    const result = feed(runtime, correct, wrong);

    expect(result).toMatchObject({
      playerOneScore: 100,
      playerTwoScore: 0,
      teamScore: 0,
      synchronization: null,
      diagnosis: 'player-two-needs-correction',
    });
    expect(result.players[0].success).toBe(true);
    expect(result.players[1].success).toBe(false);
    expect(result.players[1].feedback).toMatch(/hand higher|lower|reach|arm/i);
    expect(result.players[1].highlightedLandmarkIndexes).toEqual(expect.arrayContaining([11, 13, 15]));
    expect(result.feedback).toContain('Player 2');
  });

  it('diagnoses a timing mismatch when both players match the cue outside the sync window', () => {
    const runtime = new DanceDuoRuntime({ syncWindowMs: DANCE_DUO_SYNC_WINDOW_MS });
    const target = poseFor(DANCE_CUES[0]);
    const wrong = poseFor(DANCE_CUES[1]);
    runtime.update(sample(0, [target, wrong]));
    for (let timestampMs = 50; timestampMs <= 300; timestampMs += 50) {
      runtime.update(sample(timestampMs, [target, wrong]));
    }

    let result = runtime.update(sample(350, [target, target]));
    for (let timestampMs = 400; timestampMs <= 850; timestampMs += 50) {
      result = runtime.update(sample(timestampMs, [target, target]));
    }
    expect(result).toMatchObject({
      playerOneScore: 100,
      playerTwoScore: 70,
      teamScore: 0,
      synchronizedCueCount: 0,
      synchronization: 'out-of-sync',
      syncDeltaMs: 350,
      diagnosis: 'out-of-sync',
    });
    expect(result.feedback).toMatch(/together|same time|sync/i);
  });

  it.each([0, 1])('pauses both players when player %i loses tracking and resumes without counting the gap', lostIndex => {
    const runtime = new DanceDuoRuntime();
    const target = poseFor(DANCE_CUES[0]);
    runtime.update(sample(0, [target, target]));
    runtime.update(sample(250, [target, target]));
    const missingPlayers = [target, target];
    missingPlayers[lostIndex] = [];
    const lost = runtime.update(sample(300, missingPlayers));
    expect(lost).toMatchObject({
      elapsedMs: 250,
      paused: true,
      pauseReason: lostIndex === 0 ? 'player-one-lost' : 'player-two-lost',
      playerOneScore: 0,
      playerTwoScore: 0,
      diagnosis: 'tracking-paused',
    });
    expect(lost.players[lostIndex].trackingRecovery).toBe(true);
    expect(lost.players[1 - lostIndex].feedback).toContain(`Player ${lostIndex + 1}`);

    runtime.update(sample(5_000, missingPlayers));
    const resumed = runtime.update(sample(20_000, [target, target]));
    expect(resumed).toMatchObject({ elapsedMs: 250, paused: false, playerOneScore: 0, playerTwoScore: 0 });
    let result = resumed;
    for (let timestampMs = 20_050; timestampMs <= 20_500; timestampMs += 50) {
      result = runtime.update(sample(timestampMs, [target, target]));
    }
    expect(result).toMatchObject({ elapsedMs: 750, playerOneScore: 70, playerTwoScore: 70, teamScore: DANCE_DUO_SYNC_BONUS });
    expect(result.players[0].cueResolved).toBe(true);
    expect(result.players[1].cueResolved).toBe(true);
  });

  it('freezes both active cue clocks and clears both holds when a required landmark is unreliable', () => {
    const runtime = new DanceDuoRuntime();
    const target = poseFor(DANCE_CUES[0]);
    runtime.update(sample(0, [target, target]));
    runtime.update(sample(250, [target, target]));

    const lowConfidence = target.map(point => ({ ...point }));
    lowConfidence[27].visibility = 0.2;
    const lost = runtime.update(sample(300, [target, lowConfidence]));
    expect(lost).toMatchObject({
      elapsedMs: 250,
      paused: true,
      pauseReason: 'player-two-lost',
      misses: 0,
      players: [
        { missedCueCount: 0, trackingRecovery: false },
        { missedCueCount: 0, trackingRecovery: true },
      ],
    });

    runtime.update(sample(5_000, [target, lowConfidence]));
    expect(runtime.update(sample(20_000, [target, target]))).toMatchObject({ elapsedMs: 250, misses: 0 });
    let resumed = runtime.update(sample(20_050, [target, target]));
    for (let timestampMs = 20_100; timestampMs <= 20_500; timestampMs += 50) {
      resumed = runtime.update(sample(timestampMs, [target, target]));
    }
    expect(resumed).toMatchObject({ elapsedMs: 750, misses: 0, playerOneScore: 70, playerTwoScore: 70 });
  });

  it('counts each player cue missed once, including when only one player misses', () => {
    const runtime = new DanceDuoRuntime();
    const target = poseFor(DANCE_CUES[0]);
    const wrong = poseFor(DANCE_CUES[1]);
    let result = feed(runtime, target, wrong, 0, DANCE_CUE_INTERVAL_MS);

    expect(result).toMatchObject({
      elapsedMs: DANCE_CUE_INTERVAL_MS,
      misses: 1,
      players: [
        { completedCueCount: 1, missedCueCount: 0 },
        { completedCueCount: 0, missedCueCount: 1 },
      ],
    });
    result = runtime.update(sample(DANCE_CUE_INTERVAL_MS + 50, [target, wrong]));
    expect(result.misses).toBe(1);
  });

  it('treats fewer than two player arrays as a joint tracking pause', () => {
    const runtime = new DanceDuoRuntime();
    const target = poseFor(DANCE_CUES[0]);
    const result = runtime.update(sample(0, [target]));
    expect(result).toMatchObject({ paused: true, pauseReason: 'player-two-lost', diagnosis: 'tracking-paused' });
    expect(result.players[1].feedback).toMatch(/both players|player 2|return/i);
  });

  it('resets both timers, independent scores, sync history and feedback', () => {
    const runtime = new DanceDuoRuntime();
    const target = poseFor(DANCE_CUES[0]);
    feed(runtime, target, target);
    runtime.reset();
    expect(runtime.update(sample(0, [target, target]))).toMatchObject({
      elapsedMs: 0,
      playerOneScore: 0,
      playerTwoScore: 0,
      teamScore: 0,
      synchronizedCueCount: 0,
      synchronization: null,
      diagnosis: 'waiting',
    });
  });
});
