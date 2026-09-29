import { describe, expect, it } from 'vitest';
import { GestureEngine, ModeEngine, SessionController, type GestureAnalysis } from '@motion-runner/game';
import { pose } from './fixtures';
import { RHYTHM_HIGH_JUMP_CUE_LEAD_MS, rhythmRunCue } from '../src/presentation/rhythm-cue';

function playThrough(fps: number, responsesMs: Readonly<Record<number, number | null>>, uiRefreshDelayMs = 85) {
  const stepMs = 1000 / fps;
  const gesture = new GestureEngine();
  const session = new SessionController(12_000, 'rhythm-run');
  const mode = new ModeEngine('rhythm-run', 12_000);
  let cameraTime = 0;
  let analysis: GestureAnalysis = gesture.update(pose(cameraTime));

  while (!analysis.calibrated) {
    cameraTime += stepMs;
    analysis = gesture.update(pose(cameraTime));
  }

  session.stage = 'PLAYING';
  session.lastTickAt = cameraTime;
  const jumpCueShownAt = new Map<number, number>();
  const jumpedAt = new Map<number, number>();
  const endedAt = Math.max(6_000, ...Object.keys(responsesMs).map(id => mode.rhythm!.snapshot(0).stars[Number(id)]?.atMs ?? 0)) + 300;

  while (session.game.elapsedMs < endedAt) {
    cameraTime += stepMs;
    const elapsed = session.game.elapsedMs;
    const nextStar = mode.rhythm!.snapshot(elapsed).stars.find(star => star.status === 'upcoming');
    const responseMs = nextStar?.height === 'high' ? responsesMs[nextStar.id] : null;
    const cueVisibleAt = nextStar?.height === 'high'
      ? nextStar.atMs - RHYTHM_HIGH_JUMP_CUE_LEAD_MS + uiRefreshDelayMs
      : Infinity;
    const raiseAt = responseMs === null || responseMs === undefined ? Infinity : cueVisibleAt + responseMs;
    const handsHeldUntil = raiseAt + 500;
    const raiseForThisStar = nextStar?.height === 'high' && elapsed >= raiseAt && elapsed < handsHeldUntil;
    const lean = elapsed >= 3_600 && elapsed < 4_100 ? -0.35 : 0;
    analysis = gesture.update(pose(cameraTime, lean, raiseForThisStar ? 'up' : 'down'));

    // Let the same 900 ms jump animation used by the app advance from the actual
    // confirmed gesture. Rhythm only receives its height and never a synthetic jump.
    session.tick(cameraTime, analysis);
    if (analysis.jumpTriggered && nextStar?.height === 'high' && !jumpedAt.has(nextStar.id)) {
      jumpedAt.set(nextStar.id, session.game.elapsedMs);
    }
    mode.update(session.game.elapsedMs, analysis, undefined, undefined, undefined, {
      lane: session.game.lane,
      jumpHeight: session.game.jumpHeight,
      trackingValid: analysis.trackingValid,
    });

    // Verify that the throttled UI would actually show the actionable cue at
    // the configured display time, then start the human response clock there.
    if (nextStar?.height === 'high' && session.game.elapsedMs >= cueVisibleAt && !jumpCueShownAt.has(nextStar.id)) {
      const cue = rhythmRunCue(mode.rhythm!.snapshot(cueVisibleAt), session.game.lane, analysis.handsDown, session.game.jumpHeight, analysis.handsUp);
      if (cue.title === 'Raise both hands · jump for the star') jumpCueShownAt.set(nextStar.id, session.game.elapsedMs);
    }
  }

  return {
    snapshot: mode.rhythm!.snapshot(session.game.elapsedMs),
    jumpCueShownAt,
    jumpedAt,
  };
}

describe('Rhythm Run input timing', () => {
  it.each([15, 20, 30])('collects at %s camera samples per second across realistic reaction delays', fps => {
    for (const responseMs of [150, 250, 350]) {
      const result = playThrough(fps, { 1: responseMs });
      expect(result.jumpCueShownAt.has(1), `${fps} fps, ${responseMs} ms: cue was visible`).toBe(true);
      expect(result.jumpedAt.has(1), `${fps} fps, ${responseMs} ms: a real jump was detected`).toBe(true);
      expect(result.snapshot.stars[1].status, `${fps} fps, ${responseMs} ms`).toBe('collected');
    }
  });

  it('still collects a later high star after missing the previous high and low stars', () => {
    const result = playThrough(20, { 1: null, 3: 250 });

    expect(result.snapshot.stars[1].status).toBe('missed');
    expect(result.snapshot.stars[2].status).toBe('missed');
    expect(result.jumpCueShownAt.has(3)).toBe(true);
    expect(result.jumpedAt.has(3)).toBe(true);
    expect(result.snapshot.stars[3]).toMatchObject({ status: 'collected', height: 'high' });
    expect(result.snapshot).toMatchObject({ score: 200, cleared: 2, misses: 2 });
  });

  it('does not award a high star when the player does not jump after the cue', () => {
    const result = playThrough(20, { 1: null });

    expect(result.snapshot.stars[1]).toMatchObject({ status: 'missed', points: 0 });
    expect(result.snapshot).toMatchObject({ cleared: 1, misses: 1, score: 100 });
  });
});
