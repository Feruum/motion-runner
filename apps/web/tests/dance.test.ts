import { describe, expect, it } from 'vitest';
import type { Landmark } from '../../../packages/game/src/core/types';
import {
  DANCE_CUE_INTERVAL_MS,
  DANCE_CUES,
  DANCE_DURATION_MS,
  DANCE_HOLD_MS,
  DanceSoloRuntime,
  type DanceCue,
  type DanceFeature,
} from '../../../packages/game/src/core/dance';

type FeatureKey = DanceFeature['id'];

const defaultFeatures: Record<FeatureKey, number> = {
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

/** Inverse of Dance Solo's documented torso-normalized feature contract. */
function poseFor(cue: DanceCue, overrides: Partial<Record<FeatureKey, number>> = {}): Landmark[] {
  const values = { ...defaultFeatures };
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

  const arms: Array<{ side: 'left' | 'right'; shoulder: number; elbow: number; wrist: number }> = [
    { side: 'left', shoulder: 11, elbow: 13, wrist: 15 },
    { side: 'right', shoulder: 12, elbow: 14, wrist: 16 },
  ];
  for (const arm of arms) {
    const outwardSign = arm.side === 'left' ? 1 : -1;
    const out = values[`${arm.side}WristOut`];
    const wristY = shoulderY + values[`${arm.side}WristY`] * torso;
    const wristX = hipX + outwardSign * out * torso;
    const shoulder = landmarks[arm.shoulder];
    set(arm.wrist, wristX, wristY);
    const elbowAngle = values[`${arm.side}ElbowAngleDeg`];
    const dx = wristX - shoulder.x;
    const dy = wristY - shoulder.y;
    const limbLength = Math.hypot(dx, dy);
    const offset = elbowAngle >= 179.999 ? 0 : limbLength / (2 * Math.tan(elbowAngle * Math.PI / 360));
    const normalX = limbLength > 0 ? -dy / limbLength : 0;
    const normalY = limbLength > 0 ? dx / limbLength : 0;
    set(arm.elbow, (shoulder.x + wristX) / 2 + normalX * offset, (shoulder.y + wristY) / 2 + normalY * offset);
  }

  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? 1 : -1;
    const hipIndex = side === 'left' ? 23 : 24;
    const kneeIndex = side === 'left' ? 25 : 26;
    const ankleIndex = side === 'left' ? 27 : 28;
    const ankleX = hipX + sign * values[`${side}FootOut`] * torso;
    set(kneeIndex, (landmarks[hipIndex].x + ankleX) / 2, 0.82);
    set(ankleIndex, ankleX, 0.96);
  }
  return landmarks;
}

function samples(
  runtime: DanceSoloRuntime,
  cue: DanceCue,
  startMs = cue.atMs,
  endMs = startMs + DANCE_HOLD_MS,
  landmarks = poseFor(cue),
) {
  let result = runtime.update(startMs, landmarks, true);
  for (let timestampMs = startMs + 50; timestampMs <= endMs; timestampMs += 50) {
    result = runtime.update(timestampMs, landmarks, true);
  }
  return result;
}

describe('Dance Solo runtime', () => {
  it('authors eight distinct full-body cues across a 60-second round', () => {
    expect(DANCE_DURATION_MS).toBe(60_000);
    expect(DANCE_CUE_INTERVAL_MS).toBe(7_500);
    expect(DANCE_CUES).toHaveLength(8);
    expect(DANCE_CUES.map(cue => cue.atMs)).toEqual([0, 7_500, 15_000, 22_500, 30_000, 37_500, 45_000, 52_500]);
    expect(new Set(DANCE_CUES.map(cue => JSON.stringify(cue.features))).size).toBe(8);
    expect(DANCE_CUES.every(cue => ['arms', 'torso', 'legs'].every(group => cue.features.some(feature => feature.group === group)))).toBe(true);

    const runtime = new DanceSoloRuntime();
    runtime.update(0, poseFor(DANCE_CUES[0]), true);
    expect(runtime.update(DANCE_DURATION_MS, poseFor(DANCE_CUES[7]), true)).toMatchObject({
      elapsedMs: DANCE_DURATION_MS, remainingMs: 0, currentCueIndex: null, challengeCompleted: true,
    });
  });

  it('requires a continuous hold and resolves a cue only once at 500 ms', () => {
    const runtime = new DanceSoloRuntime();
    const cue = DANCE_CUES[0];
    const early = samples(runtime, cue, 0, DANCE_HOLD_MS - 50);
    expect(early).toMatchObject({ completedCueCount: 0, cueResolved: false, success: false, score: 0 });

    const completed = runtime.update(500, poseFor(cue), true);
    expect(completed).toMatchObject({ completedCueCount: 1, cueResolved: true, success: true, score: 100, cueScore: 100 });
    expect(runtime.update(550, poseFor(cue), true)).toMatchObject({ completedCueCount: 1, cueResolved: true, success: false, score: 100, cueScore: null });
  });

  it('resolves all eight authored cues for +100 each using their normalized full-body poses', () => {
    const runtime = new DanceSoloRuntime();
    let result = runtime.update(0, poseFor(DANCE_CUES[0]), true);
    for (let index = 0; index < DANCE_CUES.length; index += 1) {
      result = samples(runtime, DANCE_CUES[index]);
      expect(result).toMatchObject({ currentCueIndex: index, completedCueCount: index + 1, success: true, cueScore: 100 });
    }
    expect(result.score).toBe(800);
  });

  it('clears a pending hold when the target pose breaks', () => {
    const runtime = new DanceSoloRuntime();
    const cue = DANCE_CUES[0];
    const exact = poseFor(cue);
    runtime.update(0, exact, true);
    runtime.update(250, exact, true);
    const neutral = poseFor(DANCE_CUES[5]);
    const broken = runtime.update(300, neutral, true);
    expect(broken).toMatchObject({ completedCueCount: 0, success: false, score: 0 });
    expect(samples(runtime, cue, 350, 750)).toMatchObject({ completedCueCount: 0, success: false });
    expect(samples(runtime, cue, 800, 1_300)).toMatchObject({ completedCueCount: 1, cueResolved: true, score: 70 });
  });

  it('does not carry a pending hold across the authored cue boundary', () => {
    const runtime = new DanceSoloRuntime();
    runtime.update(0, poseFor(DANCE_CUES[5]), true);
    runtime.update(7_400, poseFor(DANCE_CUES[0]), true);
    runtime.update(7_500, poseFor(DANCE_CUES[1]), true);
    let beforeBoundaryHoldCompletes = runtime.update(7_550, poseFor(DANCE_CUES[1]), true);
    for (let timestampMs = 7_600; timestampMs <= 7_950; timestampMs += 50) {
      beforeBoundaryHoldCompletes = runtime.update(timestampMs, poseFor(DANCE_CUES[1]), true);
    }
    expect(beforeBoundaryHoldCompletes).toMatchObject({ currentCueIndex: 1, completedCueCount: 0, success: false });
    expect(runtime.update(8_000, poseFor(DANCE_CUES[1]), true)).toMatchObject({ currentCueIndex: 1, completedCueCount: 1, success: true });
  });

  it('scores pose accuracy and timing, while giving a concrete correction for an incorrect pose', () => {
    const runtime = new DanceSoloRuntime();
    const cue = DANCE_CUES[0];
    const wrongSide = poseFor(cue, { leftWristY: 0.82, rightWristY: -0.8 });
    const result = runtime.update(0, wrongSide, true);
    expect(result.success).toBe(false);
    expect(result.feedback).toMatch(/right hand|right arm/i);
    expect(result.highlightedLandmarkIndexes).toEqual(expect.arrayContaining([12, 14, 16]));

    const lateRuntime = new DanceSoloRuntime();
    lateRuntime.update(0, poseFor(DANCE_CUES[5]), true);
    const late = samples(lateRuntime, cue, 250, 750);
    expect(late).toMatchObject({ success: true, cueScore: 70, score: 70 });
    expect(late.poseSimilarity).toBeCloseTo(1);
    expect(late.timingSimilarity).toBe(0);

    const partialRuntime = new DanceSoloRuntime();
    const partial = samples(partialRuntime, cue, 0, 500, poseFor(cue, { leftWristY: 0.1 }));
    expect(partial.success).toBe(true);
    expect(partial.poseSimilarity).toBeLessThan(1);
    expect(partial.cueScore).toBeGreaterThan(90);
    expect(partial.cueScore).toBeLessThan(100);
  });

  it('keeps anatomical left and right arm corrections distinct', () => {
    const leftRuntime = new DanceSoloRuntime();
    const leftCue = DANCE_CUES.find(cue => cue.id === 'left-reach');
    const rightRuntime = new DanceSoloRuntime();
    const rightCue = DANCE_CUES.find(cue => cue.id === 'right-reach');
    expect(leftCue).toBeDefined();
    expect(rightCue).toBeDefined();
    if (!leftCue || !rightCue) return;

    const left = leftRuntime.update(0, poseFor(leftCue, { leftElbowAngleDeg: 90 }), true);
    rightRuntime.update(0, poseFor(DANCE_CUES[0]), true);
    const right = rightRuntime.update(7_500, poseFor(rightCue, { rightElbowAngleDeg: 90 }), true);
    expect(left.feedback).toBe('Straighten your left arm');
    expect(left.highlightedLandmarkIndexes).toEqual([11, 13, 15]);
    expect(right.feedback).toBe('Straighten your right arm');
    expect(right.highlightedLandmarkIndexes).toEqual([12, 14, 16]);
  });

  it('clears a hold on missing or low-confidence landmarks and asks the player to reframe', () => {
    const runtime = new DanceSoloRuntime();
    const cue = DANCE_CUES[0];
    const exact = poseFor(cue);
    runtime.update(0, exact, true);
    runtime.update(250, exact, true);
    const lowConfidence = [...exact.map(point => ({ ...point }))];
    lowConfidence[15].visibility = 0.2;
    const lost = runtime.update(300, lowConfidence, true);
    expect(lost).toMatchObject({ completedCueCount: 0, success: false, trackingRecovery: true });
    expect(lost.feedback).toMatch(/frame|visible|step back/i);
    expect(lost.highlightedLandmarkIndexes).toContain(15);

    const missing = runtime.update(350, exact.slice(0, 15), true);
    expect(missing.trackingRecovery).toBe(true);
    expect(missing.feedback).toMatch(/frame|visible|step back/i);
  });

  it('freezes cue time while paused and starts a fresh hold after resume', () => {
    const runtime = new DanceSoloRuntime();
    const cue = DANCE_CUES[0];
    const exact = poseFor(cue);
    runtime.update(0, exact, true);
    runtime.update(250, exact, true);
    const paused = runtime.update(5_000, exact, true, true);
    expect(paused).toMatchObject({ elapsedMs: 250, remainingMs: DANCE_DURATION_MS - 250, paused: true, completedCueCount: 0 });

    runtime.update(20_000, exact, true, true);
    const resumed = runtime.update(20_050, exact, true);
    expect(resumed).toMatchObject({ elapsedMs: 250, paused: false, completedCueCount: 0 });
    let result = resumed;
    for (let timestampMs = 20_100; timestampMs <= 20_550; timestampMs += 50) {
      result = runtime.update(timestampMs, exact, true);
      if (timestampMs < 20_550) expect(result.success).toBe(false);
    }
    expect(result).toMatchObject({ completedCueCount: 1, success: true, elapsedMs: 750 });
  });

  it('reports tracking recovery for a lost tracking-valid flag and resets round state', () => {
    const runtime = new DanceSoloRuntime();
    const cue = DANCE_CUES[0];
    runtime.update(0, poseFor(cue), true);
    const unavailable = runtime.update(100, poseFor(cue), false);
    expect(unavailable.trackingRecovery).toBe(true);
    expect(unavailable.feedback).toMatch(/tracking|frame|visible/i);

    samples(runtime, cue, 150, 650);
    runtime.reset();
    expect(runtime.update(0, poseFor(cue), true)).toMatchObject({ elapsedMs: 0, score: 0, completedCueCount: 0, currentCueIndex: 0 });
    expect(samples(runtime, cue, 0, 500)).toMatchObject({ success: true, score: 100 });
  });

  it('exposes the planned arm, torso and position tolerances as configurable defaults', () => {
    const features = DANCE_CUES.flatMap(cue => cue.features);
    expect(features.filter(feature => feature.unit === 'degrees').every(feature => feature.tolerance === 30)).toBe(true);
    expect(features.filter(feature => feature.unit === 'torso').every(feature => feature.tolerance === 0.35)).toBe(true);
    const configured = new DanceSoloRuntime({ holdMs: 300, confidenceThreshold: 0.8 });
    const pose = poseFor(DANCE_CUES[0]);
    pose[15].visibility = 0.7;
    expect(configured.update(0, pose, true)).toMatchObject({ trackingRecovery: true, completedCueCount: 0 });

    const shortHold = new DanceSoloRuntime({ holdMs: 300 });
    expect(samples(shortHold, DANCE_CUES[0], 0, 300)).toMatchObject({ completedCueCount: 1, success: true });
  });
});
