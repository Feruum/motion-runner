import { describe, expect, it } from 'vitest';
import type { GestureAnalysis, Landmark, PoseSample } from '../../../packages/game/src/core/types';
import { ModeEngine } from '../../../packages/game/src/core/modes';
import { DANCE_CUES, type DanceCue, type DanceFeature } from '../../../packages/game/src/core/dance';
import { analysis } from './fixtures';

type FeatureKey = DanceFeature['id'];

const danceDefaults: Record<FeatureKey, number> = {
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

function dancePose(cue: DanceCue, overrides: Partial<Record<FeatureKey, number>> = {}): Landmark[] {
  const values = { ...danceDefaults };
  for (const feature of cue.features) values[feature.id] = feature.target;
  Object.assign(values, overrides);
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99, presence: 0.99 }));
  const set = (index: number, x: number, y: number) => { landmarks[index] = { x, y, z: 0, visibility: 0.99, presence: 0.99 }; };
  const torso = 0.33;
  const hipX = 0.5;
  const hipY = 0.68;
  const leanRadians = values.torsoLeanDeg * Math.PI / 180;
  const shoulderX = hipX + Math.sin(leanRadians) * torso;
  const shoulderY = hipY - Math.cos(leanRadians) * torso;
  set(11, shoulderX + 0.12, shoulderY);
  set(12, shoulderX - 0.12, shoulderY);
  set(23, hipX + 0.09, hipY);
  set(24, hipX - 0.09, hipY);

  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? 1 : -1;
    const shoulderIndex = side === 'left' ? 11 : 12;
    const elbowIndex = side === 'left' ? 13 : 14;
    const wristIndex = side === 'left' ? 15 : 16;
    const wristX = hipX + sign * values[`${side}WristOut`] * torso;
    const wristY = shoulderY + values[`${side}WristY`] * torso;
    const shoulder = landmarks[shoulderIndex];
    set(wristIndex, wristX, wristY);
    const elbowAngle = values[`${side}ElbowAngleDeg`];
    const dx = wristX - shoulder.x;
    const dy = wristY - shoulder.y;
    const limbLength = Math.hypot(dx, dy);
    const offset = elbowAngle >= 179.999 ? 0 : limbLength / (2 * Math.tan(elbowAngle * Math.PI / 360));
    const normalX = limbLength > 0 ? -dy / limbLength : 0;
    const normalY = limbLength > 0 ? dx / limbLength : 0;
    set(elbowIndex, (shoulder.x + wristX) / 2 + normalX * offset, (shoulder.y + wristY) / 2 + normalY * offset);

    const hipIndex = side === 'left' ? 23 : 24;
    const kneeIndex = side === 'left' ? 25 : 26;
    const ankleIndex = side === 'left' ? 27 : 28;
    const ankleX = hipX + sign * values[`${side}FootOut`] * torso;
    set(kneeIndex, (landmarks[hipIndex].x + ankleX) / 2, 0.82);
    set(ankleIndex, ankleX, 0.96);
  }
  return landmarks;
}

function withLandmarks(timestampMs: number, landmarks: Landmark[], overrides: Partial<GestureAnalysis> = {}): GestureAnalysis {
  return analysis(timestampMs, { landmarks, ...overrides });
}

function mirrorPose(leftLean = 0): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99, presence: 0.99 }));
  const set = (index: number, x: number, y: number) => { landmarks[index] = { x, y, z: 0, visibility: 0.99, presence: 0.99 }; };
  set(11, 0.62 + leftLean, 0.38); set(12, 0.38 + leftLean, 0.38);
  set(13, 0.68 + leftLean, 0.53); set(14, 0.32 + leftLean, 0.53);
  set(15, 0.65 + leftLean, 0.70); set(16, 0.35 + leftLean, 0.70);
  set(23, 0.59, 0.76); set(24, 0.41, 0.76);
  return landmarks;
}

function sample(timestampMs: number, landmarks: Landmark[], players?: Landmark[][]): PoseSample {
  return { timestampMs, frameWidth: 640, frameHeight: 480, landmarks, ...(players ? { players } : {}) };
}

function feed(engine: ModeEngine, landmarks: Landmark[], startMs: number, endMs: number, players?: Landmark[][]): void {
  for (let elapsedMs = startMs; elapsedMs <= endMs; elapsedMs += 50) {
    const primary = withLandmarks(elapsedMs, landmarks);
    engine.update(elapsedMs, primary, undefined, undefined, sample(elapsedMs, landmarks, players));
  }
}

describe('pose-mode ModeEngine integration', () => {
  it.each(['dance-party', 'dance-duo'] as const)('finalizes every %s cue when the session ends between camera frames', mode => {
    const engine = new ModeEngine(mode, 60_000);
    const target = dancePose(DANCE_CUES[0]);
    const players = mode === 'dance-duo' ? [target, target] : undefined;
    // The first camera frame arrives after zero; the last is before the session deadline.
    feed(engine, target, 50, 59_950, players);
    const before = engine.snapshot(60_000);
    expect(before.posePhase).not.toBe('complete');
    engine.finish();
    const after = engine.snapshot(60_000);
    expect(after).toMatchObject({
      score: before.score,
      playerOneScore: before.playerOneScore,
      playerTwoScore: before.playerTwoScore,
      teamScore: before.teamScore,
      posePhase: 'complete', poseCueIndex: null, trackingRecovery: false,
      misses: (DANCE_CUES.length - before.cleared) * (mode === 'dance-duo' ? 2 : 1),
    });
    engine.finish();
    feed(engine, target, 60_000, 60_500, players);
    expect(engine.snapshot(60_500)).toEqual(after);
    engine.reset();
    feed(engine, target, 0, 500, players);
    expect(engine.snapshot(500)).toMatchObject({ cleared: 1, misses: 0, poseCueIndex: 0 });
  });

  it('finalizes Duo misses independently when only one player completed a cue', () => {
    const engine = new ModeEngine('dance-duo', 60_000);
    const target = dancePose(DANCE_CUES[0]);
    const wrong = dancePose(DANCE_CUES[1]);
    feed(engine, target, 0, 500, [target, wrong]);
    engine.finish();
    expect(engine.snapshot(500)).toMatchObject({ playerOneScore: 100, playerTwoScore: 0, teamScore: 0, misses: 15 });
  });

  it('routes Mirror Challenge through the held-pose runtime and exposes specific corrections', () => {
    const engine = new ModeEngine('mirror-challenge', 60_000);
    const partialPose = mirrorPose(0.024);
    feed(engine, partialPose, 1_500, 2_000);
    const partial = engine.update(2_000, withLandmarks(2_000, partialPose));
    expect(partial).toEqual([]);
    expect(engine.snapshot(2_000)).toMatchObject({
      score: 0,
      feedbackKind: 'hint',
      feedback: 'Lean further left',
      highlightedLandmarkIndexes: [11, 12, 23, 24],
      poseCueName: 'Lean left',
      poseCueIndex: 0,
      posePhase: 'attempt',
    });

    const left = mirrorPose(0.072);
    feed(engine, left, 2_050, 2_550);
    expect(engine.snapshot(2_550)).toMatchObject({ score: 100, cleared: 1, feedbackKind: 'good', poseCueIndex: 0 });
    expect(engine.chart).toHaveLength(0);
  });

  it('routes Dance Solo through full-body scoring and reports missing tracking recovery', () => {
    const engine = new ModeEngine('dance-party', 60_000);
    const target = dancePose(DANCE_CUES[0]);
    feed(engine, target, 0, 500);
    expect(engine.snapshot(500)).toMatchObject({ score: 100, cleared: 1, feedbackKind: 'good', poseCueIndex: 0, poseCueCount: 8 });

    engine.reset();
    const missing = engine.update(0, withLandmarks(0, target, { trackingValid: false }));
    expect(missing).toEqual([]);
    expect(engine.snapshot(0)).toMatchObject({
      score: 0,
      feedbackKind: 'hint',
      trackingRecovery: true,
      feedback: 'Step back and keep your full body visible in the frame',
      highlightedLandmarkIndexes: expect.arrayContaining([11, 12, 23, 24]),
    });
  });

  it('scores Duo players independently, adds only the sync bonus to teamScore, and resets cleanly', () => {
    const engine = new ModeEngine('dance-duo', 60_000);
    const target = dancePose(DANCE_CUES[0]);
    feed(engine, target, 0, 500, [target, target]);
    expect(engine.snapshot(500)).toMatchObject({
      score: 225,
      playerOneScore: 100,
      playerTwoScore: 100,
      teamScore: 25,
      synchronizedCueCount: 1,
      cleared: 1,
      feedbackKind: 'good',
      playerOneFeedback: 'Great work — phrase complete',
      playerTwoFeedback: 'Great work — phrase complete',
    });

    engine.reset();
    engine.update(0, withLandmarks(0, target), undefined, undefined, sample(0, target, [target]));
    expect(engine.snapshot(0)).toMatchObject({
      score: 0,
      playerOneScore: 0,
      playerTwoScore: 0,
      teamScore: 0,
      synchronizedCueCount: 0,
      trackingRecovery: true,
      feedback: 'Player 2 is out of frame. Both players are paused.',
    });
    expect(engine.snapshot(0).playerOneHighlights).toEqual([]);
    expect(engine.snapshot(0).playerTwoHighlights.length).toBeGreaterThan(0);
  });

  it('uses Duo slots rather than primary landmarks and keeps player correction details separate', () => {
    const engine = new ModeEngine('dance-duo', 60_000);
    const target = dancePose(DANCE_CUES[0]);
    const wrong = dancePose(DANCE_CUES[1]);
    feed(engine, target, 0, 500, [target, wrong]);
    expect(engine.snapshot(500)).toMatchObject({
      playerOneScore: 100,
      playerTwoScore: 0,
      teamScore: 0,
      score: 100,
      feedbackKind: 'hint',
      feedback: expect.stringContaining('Player 2:'),
      playerOneHighlights: [],
      playerTwoHighlights: expect.arrayContaining([11, 13, 15]),
    });
  });

  it('pauses both Duo clocks when one slot is lost, then resumes without counting the gap', () => {
    const engine = new ModeEngine('dance-duo', 60_000);
    const target = dancePose(DANCE_CUES[0]);
    feed(engine, target, 0, 250, [target, target]);
    engine.update(1_000, withLandmarks(1_000, target), undefined, undefined, sample(1_000, target, [target]));
    expect(engine.snapshot(1_000)).toMatchObject({ score: 0, trackingRecovery: true, posePhase: 'paused' });

    feed(engine, target, 10_000, 10_500, [target, target]);
    expect(engine.snapshot(10_500)).toMatchObject({
      playerOneScore: 70,
      playerTwoScore: 70,
      teamScore: 25,
      synchronizedCueCount: 1,
      score: 165,
      posePhase: 'attempt',
      trackingRecovery: false,
    });
  });

  it('surfaces each expired Dance Solo and individual Duo cue once as a miss', () => {
    const solo = new ModeEngine('dance-party', 60_000);
    const wrong = dancePose(DANCE_CUES[5]);
    feed(solo, wrong, 0, 7_500);
    expect(solo.snapshot(7_500)).toMatchObject({ score: 0, cleared: 0, misses: 1 });
    solo.update(7_550, withLandmarks(7_550, wrong), undefined, undefined, sample(7_550, wrong));
    expect(solo.snapshot(7_550).misses).toBe(1);

    const duo = new ModeEngine('dance-duo', 60_000);
    const target = dancePose(DANCE_CUES[0]);
    feed(duo, target, 0, 7_500, [target, wrong]);
    expect(duo.snapshot(7_500)).toMatchObject({
      playerOneScore: 100,
      playerTwoScore: 0,
      misses: 1,
    });
    duo.update(7_550, withLandmarks(7_550, target), undefined, undefined, sample(7_550, target, [target, wrong]));
    expect(duo.snapshot(7_550).misses).toBe(1);
  });
});
