import { describe, expect, it } from 'vitest';
import { ModeEngine, type RhythmFrame } from '@motion-runner/game';
import { analysis } from './fixtures';

function createRhythmMode(durationMs = 14_000): ModeEngine {
  return new ModeEngine('rhythm-run', durationMs);
}

function step(mode: ModeEngine, elapsedMs: number, frame: RhythmFrame) {
  return mode.update(elapsedMs, analysis(elapsedMs, {
    lane: frame.lane,
    trackingValid: frame.trackingValid,
    handsTracked: frame.trackingValid,
    jumpTriggered: frame.jumpHeight >= 1.25,
    handsUp: frame.jumpHeight >= 1.25,
    }), undefined, undefined, undefined, frame);
}

describe('Rhythm Run star collection', () => {
  it('builds the shared low-left, high-center, low-right, high-center phrase', () => {
    const mode = createRhythmMode(12_000);
    const stars = mode.rhythm!.snapshot(0).stars;

    expect(stars.map(({ atMs, lane, height }) => [atMs, lane, height])).toEqual([
      [4_000, -1, 'low'],
      [6_000, 0, 'high'],
      [8_000, 1, 'low'],
      [10_000, 0, 'high'],
    ]);
  });

  it('collects a low star when the player is already holding its lane at the pickup window', () => {
    const mode = createRhythmMode();

    step(mode, 3_700, { lane: -1, jumpHeight: 0, trackingValid: true });
    expect(mode.rhythm!.snapshot(3_700).stars[0].status).toBe('upcoming');
    const events = step(mode, 3_760, { lane: -1, jumpHeight: 0, trackingValid: true });
    step(mode, 4_000, { lane: -1, jumpHeight: 0, trackingValid: true });

    expect(events).toContain('clear');
    expect(mode.rhythm!.snapshot(4_000)).toMatchObject({ score: 100, cleared: 1, misses: 0, combo: 1, bestCombo: 1 });
    expect(mode.rhythm!.snapshot(4_000).stars[0]).toMatchObject({ status: 'collected', points: 100 });
    expect(mode.snapshot(4_000)).toMatchObject({ score: 100, cleared: 1, misses: 0, combo: 1 });
    expect(mode.chart[0].resolved).toBe(true);
  });

  it('keeps star state unchanged when the active time is frozen during a pause', () => {
    const mode = createRhythmMode();
    step(mode, 3_760, { lane: -1, jumpHeight: 0, trackingValid: true });
    const beforePause = mode.rhythm!.snapshot(3_760);

    step(mode, 3_760, { lane: -1, jumpHeight: 0, trackingValid: true });

    expect(mode.rhythm!.snapshot(3_760)).toEqual(beforePause);
  });

  it('requires tracking, the correct lane, and an actual jump for a high star', () => {
    const mode = createRhythmMode();

    step(mode, 3_760, { lane: 0, jumpHeight: 0, trackingValid: false });
    step(mode, 4_000, { lane: 0, jumpHeight: 0, trackingValid: true });
    step(mode, 5_760, { lane: -1, jumpHeight: 1.5, trackingValid: true });
    step(mode, 6_000, { lane: 0, jumpHeight: 1.0, trackingValid: true });

    expect(mode.rhythm!.snapshot(6_000).stars[1].status).toBe('upcoming');
    const events = step(mode, 6_100, { lane: 0, jumpHeight: 1.25, trackingValid: true });

    expect(events).toContain('clear');
    expect(mode.rhythm!.snapshot(6_100).stars[1]).toMatchObject({ status: 'collected', height: 'high', points: 100 });
  });

  it('resolves a missed star once, resets combo, and expires precise feedback after 800ms', () => {
    const mode = createRhythmMode();
    step(mode, 3_760, { lane: -1, jumpHeight: 0, trackingValid: true });
    step(mode, 4_000, { lane: -1, jumpHeight: 0, trackingValid: true });

    step(mode, 6_241, { lane: 0, jumpHeight: 0, trackingValid: false });
    step(mode, 6_500, { lane: 0, jumpHeight: 2, trackingValid: true });

    expect(mode.rhythm!.snapshot(6_500)).toMatchObject({ score: 100, cleared: 1, misses: 1, combo: 0, bestCombo: 1 });
    expect(mode.rhythm!.snapshot(6_500).stars[1]).toMatchObject({ status: 'missed', points: 0 });
    expect(mode.rhythm!.snapshot(6_500)).toMatchObject({
      feedback: 'Missed the high star. Jump to collect it.',
      feedbackKind: 'hint',
    });
    expect(mode.rhythm!.snapshot(7_041)).toMatchObject({ feedback: '', feedbackKind: 'neutral' });
  });

  it('does not award a correct-looking pose after its pickup window or while tracking is invalid', () => {
    const mode = createRhythmMode();

    step(mode, 4_241, { lane: -1, jumpHeight: 0, trackingValid: false });
    const events = step(mode, 4_500, { lane: -1, jumpHeight: 0, trackingValid: true });

    expect(events).not.toContain('clear');
    expect(mode.rhythm!.snapshot(4_500)).toMatchObject({ score: 0, cleared: 0, misses: 1 });
    expect(mode.rhythm!.snapshot(4_500).stars[0].status).toBe('missed');
  });

  it('does not score from GestureAnalysis when no actual rhythm frame is supplied', () => {
    const mode = createRhythmMode();
    const events = mode.update(4_000, analysis(4_000, {
      lane: -1,
      jumpTriggered: true,
      handsUp: true,
    }));

    expect(events).not.toContain('clear');
    expect(mode.rhythm!.snapshot(4_000)).toMatchObject({ score: 0, cleared: 0, misses: 0 });
    expect(mode.rhythm!.snapshot(4_000).stars[0].status).toBe('upcoming');
  });

  it('resets and finishes the runtime with chart resolution mirrored into ModeEngine', () => {
    const mode = createRhythmMode(8_000);
    step(mode, 3_760, { lane: -1, jumpHeight: 0, trackingValid: true });
    step(mode, 4_000, { lane: -1, jumpHeight: 0, trackingValid: true });
    mode.reset();

    expect(mode.rhythm!.snapshot(0)).toMatchObject({ score: 0, cleared: 0, misses: 0, combo: 0 });
    expect(mode.chart.every(cue => !cue.resolved)).toBe(true);

    mode.finish();
    expect(mode.rhythm!.snapshot(8_000).stars.every(star => star.status !== 'upcoming')).toBe(true);
    expect(mode.chart.every(cue => cue.resolved)).toBe(true);
  });
});
