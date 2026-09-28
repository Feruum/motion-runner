import { describe, expect, it } from 'vitest';
import {
  BEAT_BLASTER_CHART,
  BEAT_BLASTER_DURATION_MS,
  BEAT_BLASTER_TARGET_INTERVAL_MS,
  BeatBlasterRuntime,
  type BeatBlasterCue,
  type BeatBlasterInput,
  type BlasterTimingGrade,
} from '../../../packages/game/src/core/blaster';

const leftCue: BeatBlasterCue = {
  id: 'left-center',
  atMs: 0,
  side: 'left',
  offsetXTorso: -0.5,
  offsetYTorso: -0.1,
};

function wrist(x: number, y: number, confidence = 0.95) {
  return { x, y, confidence };
}

function frame(
  timestampMs: number,
  leftWrist: BeatBlasterInput['leftWrist'] = wrist(0.1, 0.1),
  rightWrist: BeatBlasterInput['rightWrist'] = wrist(0.9, 0.1),
  torso: BeatBlasterInput['torso'] = { centerX: 0.5, centerY: 0.45, length: 0.3 },
): BeatBlasterInput {
  return { timestampMs, leftWrist, rightWrist, torso };
}

describe('Beat Blaster runtime', () => {
  it('authors a 60-second chart at one cue every four 120 BPM beats', () => {
    expect(BEAT_BLASTER_DURATION_MS).toBe(60_000);
    expect(BEAT_BLASTER_TARGET_INTERVAL_MS).toBe(2_000);
    expect(BEAT_BLASTER_CHART).toHaveLength(29);
    expect(BEAT_BLASTER_CHART.map(cue => cue.atMs)).toEqual(
      Array.from({ length: 29 }, (_, index) => (index + 1) * BEAT_BLASTER_TARGET_INTERVAL_MS),
    );
  });

  it('highlights a known target and scores only when its expected wrist enters it', () => {
    const runtime = new BeatBlasterRuntime([leftCue]);
    const waiting = runtime.update(frame(0));

    expect(waiting.highlight?.side).toBe('left');
    expect(waiting.highlight?.x).toBeCloseTo(0.35);
    expect(waiting.highlight?.y).toBeCloseTo(0.42);
    expect(waiting.highlight?.radius).toBeCloseTo(0.075);

    const largerTorso = frame(50, undefined, undefined, { centerX: 0.45, centerY: 0.5, length: 0.4 });
    const scaledTarget = runtime.update(largerTorso).highlight;
    expect(scaledTarget?.x).toBeCloseTo(0.25);
    expect(scaledTarget?.y).toBeCloseTo(0.46);
    expect(scaledTarget?.radius).toBeCloseTo(0.1);
    expect(runtime.update(frame(100, wrist(0.25, 0.46), undefined, { centerX: 0.45, centerY: 0.5, length: 0.4 })).score).toBe(100);
  });

  it('does not score the wrong wrist and tells the player which hand to use', () => {
    const runtime = new BeatBlasterRuntime([leftCue]);
    runtime.update(frame(0));

    const wrongHand = runtime.update(frame(100, wrist(0.1, 0.1), wrist(0.35, 0.42)));
    expect(wrongHand.score).toBe(0);
    expect(wrongHand.feedback.toLowerCase()).toContain('left hand');

    expect(runtime.update(frame(200, wrist(0.35, 0.42), wrist(0.35, 0.42))).score).toBe(75);
  });

  it('does not count a held wrist twice for consecutive targets', () => {
    const secondCue = { ...leftCue, id: 'left-center-again', atMs: 100 };
    const runtime = new BeatBlasterRuntime([leftCue, secondCue]);
    runtime.update(frame(0));
    runtime.update(frame(50, wrist(0.35, 0.42)));

    const stillHeld = runtime.update(frame(120, wrist(0.35, 0.42)));
    expect(stillHeld).toMatchObject({ score: 100, misses: 0, cleared: false, resolutions: [] });
  });

  it('allows a next hit after the expected wrist exits and re-enters', () => {
    const secondCue = { ...leftCue, id: 'left-center-again', atMs: 100 };
    const runtime = new BeatBlasterRuntime([leftCue, secondCue]);
    runtime.update(frame(0));
    runtime.update(frame(50, wrist(0.35, 0.42)));
    runtime.update(frame(120, wrist(0.35, 0.42)));
    runtime.update(frame(150, wrist(0.5, 0.42)));

    const returnedAfterShortExit = runtime.update(frame(180, wrist(0.35, 0.42)));
    expect(returnedAfterShortExit.score).toBe(100);

    runtime.update(frame(200, wrist(0.5, 0.42)));
    runtime.update(frame(275, wrist(0.5, 0.42)));
    runtime.update(frame(350, wrist(0.5, 0.42)));

    const reentered = runtime.update(frame(380, wrist(0.35, 0.42)));
    expect(reentered).toMatchObject({ score: 175, combo: 2, cleared: true });
    expect(reentered.resolutions).toMatchObject([{ cueId: 'left-center-again', grade: 'good', points: 75 }]);
  });

  it('does not interpolate a wrist entry across a frame gap over 150 ms', () => {
    const runtime = new BeatBlasterRuntime([leftCue]);
    runtime.update(frame(0));

    const afterGap = runtime.update(frame(151, wrist(0.35, 0.42)));
    expect(afterGap.score).toBe(0);
    expect(afterGap.feedback.toLowerCase()).toContain('frame gap');

    expect(runtime.update(frame(181, wrist(0.35, 0.42))).score).toBe(0);
    runtime.update(frame(211, wrist(0.1, 0.1)));
    const reentered = runtime.update(frame(241, wrist(0.35, 0.42)));
    expect(reentered.score).toBe(75);
    expect(reentered.resolutions).toMatchObject([{ grade: 'good', points: 75 }]);
  });

  it('grades target entry at the inclusive ±180 ms and ±360 ms boundaries', () => {
    const cases: { deltaMs: number; grade: BlasterTimingGrade; points: number }[] = [
      { deltaMs: -360, grade: 'good', points: 75 },
      { deltaMs: -180, grade: 'perfect', points: 100 },
      { deltaMs: 180, grade: 'perfect', points: 100 },
      { deltaMs: 360, grade: 'good', points: 75 },
    ];

    for (const testCase of cases) {
      const cue = { ...leftCue, atMs: 1_000 };
      const runtime = new BeatBlasterRuntime([cue]);
      runtime.update(frame(0));
      const entryAtMs = cue.atMs + testCase.deltaMs;
      for (let timestampMs = 50; timestampMs < entryAtMs; timestampMs += 50) {
        runtime.update(frame(timestampMs));
      }

      const result = runtime.update(frame(entryAtMs, wrist(0.35, 0.42)));
      expect(result.score).toBe(testCase.points);
      expect(result.resolutions).toMatchObject([
        { cueId: cue.id, grade: testCase.grade, points: testCase.points },
      ]);
    }
  });

  it('does not count entry before the target appears, even if the wrist stays inside', () => {
    const runtime = new BeatBlasterRuntime([{ ...leftCue, atMs: 1_000 }]);
    runtime.update(frame(0));
    for (let timestampMs = 50; timestampMs <= 550; timestampMs += 50) runtime.update(frame(timestampMs));

    const enteredEarly = runtime.update(frame(600, wrist(0.35, 0.42)));
    expect(enteredEarly).toMatchObject({ score: 0, highlight: null, resolutions: [] });

    const stillHeldWhenShown = runtime.update(frame(640, wrist(0.35, 0.42)));
    expect(stillHeldWhenShown).toMatchObject({ score: 0, highlight: { id: 'left-center' }, resolutions: [] });

    runtime.update(frame(700, wrist(0.1, 0.1)));
    const freshEntry = runtime.update(frame(740, wrist(0.35, 0.42)));
    expect(freshEntry).toMatchObject({ score: 75, resolutions: [{ grade: 'good', points: 75 }] });
  });

  it('ignores stale frames, missing wrists, and wrists below the confidence threshold', () => {
    const runtime = new BeatBlasterRuntime([leftCue]);
    runtime.update(frame(0));

    const stale = runtime.update(frame(-10, wrist(0.35, 0.42)));
    expect(stale.score).toBe(0);

    const missing = runtime.update(frame(100, null, null));
    expect(missing.score).toBe(0);

    const lowConfidence = runtime.update(frame(200, wrist(0.35, 0.42, 0.59)));
    expect(lowConfidence.score).toBe(0);
  });

  it('resolves each target once, even while a wrist remains inside after a hit', () => {
    const runtime = new BeatBlasterRuntime([leftCue]);
    runtime.update(frame(0));
    runtime.update(frame(50, wrist(0.35, 0.42)));
    let result = runtime.update(frame(100, wrist(0.35, 0.42)));
    result = runtime.update(frame(200, wrist(0.35, 0.42)));
    result = runtime.update(frame(900, wrist(0.35, 0.42)));

    expect(result).toMatchObject({ score: 100, misses: 0, combo: 1, cleared: true, resolutions: [] });
  });

  it('counts an expired cue as one miss', () => {
    const runtime = new BeatBlasterRuntime([leftCue]);
    runtime.update(frame(0));
    runtime.update(frame(150));
    runtime.update(frame(300));
    const afterExpiry = runtime.update(frame(361));

    expect(afterExpiry).toMatchObject({ score: 0, misses: 1, combo: 0, cleared: true });
    expect(afterExpiry.resolutions).toMatchObject([{ cueId: 'left-center', grade: 'miss', points: 0 }]);
    expect(runtime.update(frame(411)).resolutions).toEqual([]);
  });

  it('reset clears progress and starts a fresh timestamp sequence', () => {
    const runtime = new BeatBlasterRuntime([leftCue]);
    runtime.update(frame(0));
    runtime.update(frame(50, wrist(0.35, 0.42)));
    expect(runtime.update(frame(60, wrist(0.1, 0.1))).score).toBe(100);

    runtime.reset();
    const restarted = runtime.update(frame(0));
    expect(restarted).toMatchObject({ score: 0, misses: 0, combo: 0, cleared: false });
    expect(runtime.update(frame(10, wrist(0.35, 0.42))).score).toBe(100);
  });
});
