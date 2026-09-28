import { describe, expect, it } from 'vitest';
import { ModeEngine, makeBeatBlasterInput } from '../../../packages/game/src/core/modes';
import type { BeatBlasterInput } from '../../../packages/game/src/core/blaster';
import { analysis, pose } from './fixtures';

const torso = { centerX: 0.5, centerY: 0.5, length: 0.3 };
const outside = { x: 0.1, y: 0.1, confidence: 0.99 };
const firstTarget = { x: torso.centerX - 0.72 * torso.length, y: torso.centerY - 0.36 * torso.length };

function input(timestampMs: number, leftWrist = outside, rightWrist = outside): BeatBlasterInput {
  return { timestampMs, torso, leftWrist, rightWrist };
}

function primeFirstTarget(mode: ModeEngine) {
  mode.update(0, analysis(0), null, input(1_000));
  for (let elapsedMs = 50; elapsedMs < 2_000; elapsedMs += 50) {
    mode.update(elapsedMs, analysis(elapsedMs), null, input(1_000 + elapsedMs));
  }
}

describe('Beat Blaster mode integration', () => {
  it('uses four-beat targets for a 60-second round and shortens the dev chart to 20 seconds', () => {
    const production = new ModeEngine('beat-blaster', 60_000);
    const development = new ModeEngine('beat-blaster', 20_000);

    expect(production.chart).toHaveLength(29);
    expect(production.chart.slice(0, 4).map(cue => [cue.atMs, cue.move])).toEqual([
      [2_000, 'BLAST_LEFT'], [4_000, 'BLAST_RIGHT'], [6_000, 'BLAST_LEFT'], [8_000, 'BLAST_RIGHT'],
    ]);
    expect(development.chart).toHaveLength(9);
    expect(development.chart.at(-1)?.atMs).toBe(18_000);
  });

  it('converts source-camera landmarks into mirrored-preview torso and anatomical wrist coordinates', () => {
    const sample = pose(1_234);
    const set = (index: number, x: number, y: number) => {
      sample.landmarks[index] = { x, y, z: 0, visibility: 0.99, presence: 0.99 };
    };
    set(11, 0.6, 0.3); set(12, 0.4, 0.3);
    set(23, 0.58, 0.7); set(24, 0.42, 0.7);
    set(15, 0.25, 0.45); set(16, 0.75, 0.44);

    const converted = makeBeatBlasterInput(sample);

    expect(converted.timestampMs).toBe(1_234);
    expect(converted.torso.centerX).toBeCloseTo(0.5);
    expect(converted.torso.centerY).toBeCloseTo(0.5);
    expect(converted.torso.length).toBeCloseTo(0.4);
    expect(converted.leftWrist).toMatchObject({ x: 0.75, y: 0.45, confidence: 0.99 });
    expect(converted.rightWrist).toMatchObject({ x: 0.25, y: 0.44, confidence: 0.99 });
  });

  it('scores the matching-hand entry once through the dedicated runtime', () => {
    const mode = new ModeEngine('beat-blaster', 20_000);
    primeFirstTarget(mode);
    expect(mode.snapshot(1_950).blasterHighlight).toMatchObject({ side: 'left', x: firstTarget.x, y: firstTarget.y });

    const events = mode.update(2_000, analysis(2_000), null, input(3_000, {
      ...firstTarget, confidence: 0.99,
    }));

    expect(events).toContain('clear');
    expect(mode.snapshot(2_000)).toMatchObject({ score: 100, cleared: 1, misses: 0, combo: 1 });
    expect(mode.chart[0].resolved).toBe(true);
    expect(mode.chart[1].resolved).toBe(false);
  });

  it('gives concrete wrong-hand feedback without scoring or resolving the target', () => {
    const mode = new ModeEngine('beat-blaster', 20_000);
    primeFirstTarget(mode);

    const events = mode.update(2_000, analysis(2_000), null, input(3_000, outside, {
      ...firstTarget, confidence: 0.99,
    }));
    const snapshot = mode.snapshot(2_000);

    expect(events).not.toContain('clear');
    expect(snapshot).toMatchObject({ score: 0, cleared: 0, misses: 0, combo: 0, feedbackKind: 'hint' });
    expect(snapshot.feedback).toContain('Use your left hand');
    expect(mode.chart[0].resolved).toBe(false);
  });

  it('rejects wrists with confidence below the runtime threshold', () => {
    const sample = pose(1_234);
    sample.landmarks[15].visibility = 0.59;
    expect(makeBeatBlasterInput(sample).leftWrist).toBeNull();
  });

  it('freezes target time across a long recovery pause', () => {
    const mode = new ModeEngine('beat-blaster', 20_000);
    mode.update(0, analysis(0), null, input(1_000));
    mode.update(100, analysis(100), null, input(1_100));

    // Camera timestamps include the time spent paused, while game time does not.
    mode.update(100, analysis(10_100), null, input(10_100));
    mode.update(150, analysis(10_150), null, input(10_150));

    expect(mode.snapshot(150)).toMatchObject({ score: 0, misses: 0, cleared: 0 });
    expect(mode.snapshot(150).feedback).not.toContain('Missed');
  });
});
