import { describe, expect, it } from 'vitest';
import { ModeEngine, GameEngine, configureGameForMode } from '@motion-runner/game';
import { analysis, pose } from './fixtures';

function oneHandPose(timestampMs: number, hand: 'left' | 'right') {
  const landmarks = pose(timestampMs).landmarks;
  landmarks[15].y = hand === 'left' ? .48 : .72;
  landmarks[16].y = hand === 'right' ? .48 : .72;
  return analysis(timestampMs, { handsDown: true, landmarks });
}

describe('mode chart lifecycle', () => {
  it('uses the dedicated 24-wave Dodge route in the 3D game timeline', () => {
    const game = new GameEngine(60_000);
    configureGameForMode(game, 'dodge-arena');

    expect(game.waves).toHaveLength(24);
    expect(game.waves[0]).toMatchObject({ atMs: 4_000, warningAtMs: 2_000, obstacles: [{ lane: 0, kind: 'high' }] });
    expect(game.waves[1].atMs - game.waves[0].atMs).toBe(2_300);
    expect(game.waves.every(wave => wave.obstacles.every(obstacle => obstacle.kind === 'high'))).toBe(true);
  });

  it('scores Dodge hits and clears through its dedicated runtime on the session clock', () => {
    const mode = new ModeEngine('dodge-arena', 60_000);
    const events = [] as string[];

    for (let elapsedMs = 0; elapsedMs <= 4_000; elapsedMs += 100) {
      const lane = elapsedMs < 4_000 ? -1 : 0;
      events.push(...mode.update(elapsedMs, analysis(elapsedMs, { lane })));
    }

    expect(events).toContain('hit');
    expect(mode.snapshot(4_000)).toMatchObject({ score: 0, collisions: 1, misses: 1, combo: 0 });
  });

  it('keeps the Rhythm Run compatibility chart aligned with its four-star phrase', () => {
    const mode = new ModeEngine('rhythm-run', 20_000);

    expect(mode.chart.slice(0, 5).map(cue => [cue.atMs, cue.move])).toEqual([
      [4_000, 'LEAN_LEFT'],
      [6_000, 'HANDS_UP_JUMP'],
      [8_000, 'LEAN_RIGHT'],
      [10_000, 'HANDS_UP_JUMP'],
      [12_000, 'LEAN_LEFT'],
    ]);
    expect(mode.rhythm?.snapshot(0).stars.slice(0, 4).map(star => [star.atMs, star.lane, star.height])).toEqual([
      [4_000, -1, 'low'], [6_000, 0, 'high'], [8_000, 1, 'low'], [10_000, 0, 'high'],
    ]);
    expect(mode.snapshot(1_999).activeCue).toBeNull();
    expect(mode.snapshot(2_000).activeCue).toBeNull();
    expect(mode.snapshot(3_760).activeCue).toMatchObject({ atMs: 4_000, move: 'LEAN_LEFT' });
  });

  it.each([3_759, 3_760, 4_000, 4_240, 4_241])('only scores a Rhythm star inside its pickup window at %i ms', elapsedMs => {
    const mode = new ModeEngine('rhythm-run', 20_000);
    const canMoveNow = mode.snapshot(elapsedMs).activeCue !== null;
    const events = mode.update(elapsedMs, analysis(elapsedMs, { lane: -1 }), undefined, undefined, undefined, {
      lane: -1, jumpHeight: 0, trackingValid: true,
    });
    expect(canMoveNow).toBe(events.includes('clear'));
  });

  it.each(['hit', 'miss'] as const)('clears Rhythm feedback after a %s so the next move can be shown', outcome => {
    const mode = new ModeEngine('rhythm-run', 20_000);
    const elapsedMs = outcome === 'hit' ? 4_000 : 4_241;
    mode.update(elapsedMs, analysis(elapsedMs, { lane: outcome === 'hit' ? -1 : 0 }), undefined, undefined, undefined, {
      lane: outcome === 'hit' ? -1 : 0, jumpHeight: 0, trackingValid: true,
    });
    expect(mode.snapshot(elapsedMs).feedback).not.toBe('');
    expect(mode.snapshot(5_600)).toMatchObject({ feedback: '', feedbackKind: 'neutral' });
    expect(mode.snapshot(5_760).activeCue?.move).toBe('HANDS_UP_JUMP');
  });

  it('misses a Rhythm star after the plus-or-minus 240ms pickup window', () => {
    const mode = new ModeEngine('rhythm-run', 20_000);
    mode.update(4_241, analysis(4_241), undefined, undefined, undefined, {
      lane: -1, jumpHeight: 0, trackingValid: false,
    });

    const events = mode.update(4_500, analysis(4_500, { lane: -1 }), undefined, undefined, undefined, {
      lane: -1, jumpHeight: 0, trackingValid: true,
    });

    expect(events).not.toContain('clear');
    expect(mode.snapshot(4_500)).toMatchObject({ score: 0, cleared: 0, misses: 1 });
  });

  it('preserves resolved waves when preparing an already running game after recovery', () => {
    const game=new GameEngine();configureGameForMode(game,'classic-run');
    game.update(5000,{lane:-1,jump:false});
    const waves=game.waves; const score=game.score;
    configureGameForMode(game,'classic-run');
    expect(game.waves).toBe(waves);
    game.update(0,{lane:-1,jump:false});
    expect(game.score).toBe(score);expect(game.cleared).toBe(1);
  });
  it('does not count clipped hands as a Six-Seven sequence', () => {
    const mode=new ModeEngine('six-seven',20000);
    for(const [t,hand] of [[0,'left'],[120,'left'],[400,'right'],[520,'right'],[800,'left'],[920,'left']] as const){
      mode.update(t,{...oneHandPose(t,hand),handsTracked:false});
    }
    expect(mode.score).toBe(0);
  });
  it('expires a missed star after its pickup window closes', () => {
    const mode = new ModeEngine('rhythm-run', 10_000);

    mode.update(4_241, analysis(4_241), undefined, undefined, undefined, {
      lane: 0, jumpHeight: 0, trackingValid: false,
    });

    expect(mode.chart[0].resolved).toBe(true);
    expect(mode.snapshot(3_301).misses).toBe(1);
  });

  it('continues to a later cue after the first cue was missed', () => {
    const mode = new ModeEngine('rhythm-run', 10_000);
    mode.update(4_361, analysis(4_361));

    const events = mode.update(6_000, analysis(6_000, {
      jumpTriggered: true,
      handsUp: true,
      handsDown: false,
    }), undefined, undefined, undefined, { lane: 0, jumpHeight: 1.25, trackingValid: true });

    expect(mode.chart[1].resolved).toBe(true);
    expect(mode.snapshot(6_000)).toMatchObject({ misses: 1, cleared: 1, score: 100 });
    expect(events).toContain('clear');
  });

  it('expires multiple missed cues without hiding the next future cue', () => {
    const mode = new ModeEngine('rhythm-run', 14_000);

    mode.update(10_000, analysis(10_000));

    expect(mode.chart.slice(0, 3).every(cue => cue.resolved)).toBe(true);
    expect(mode.chart[3].resolved).toBe(false);
    expect(mode.snapshot(8_000).misses).toBe(3);
  });

  it('scores one Six-Seven repetition for each two-hand pair', () => {
    const mode = new ModeEngine('six-seven', 20_000);
    mode.update(0, oneHandPose(0, 'left'));
    mode.update(120, oneHandPose(120, 'left'));
    mode.update(400, oneHandPose(400, 'right'));
    mode.update(520, oneHandPose(520, 'right'));
    expect(mode.snapshot(520)).toMatchObject({ score: 1, cleared: 1, sixSevenCount: 1, playerOneScore: 1, combo: 1 });

    mode.update(800, oneHandPose(800, 'left'));
    mode.update(920, oneHandPose(920, 'left'));
    mode.update(1_200, oneHandPose(1_200, 'right'));
    const events = mode.update(1_320, oneHandPose(1_320, 'right'));

    expect(events).toContain('clear');
    expect(mode.snapshot(1_320)).toMatchObject({ score: 2, cleared: 2, sixSevenCount: 2, playerOneScore: 2, combo: 2 });
  });
});
