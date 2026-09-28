import { describe, expect, it } from 'vitest';
import { ModeEngine, GameEngine, configureGameForMode } from '@motion-runner/game';
import { analysis, pose } from './fixtures';

function oneHandPose(timestampMs: number, hand: 'left' | 'right') {
  const sample = pose(timestampMs, 0, hand);
  sample.landmarks[hand === 'left' ? 16 : 15].y = .65;
  return analysis(timestampMs, { handsDown: false, landmarks: sample.landmarks });
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

  it('starts Rhythm Run after its two-second preview and repeats the four-beat phrase every two seconds', () => {
    const mode = new ModeEngine('rhythm-run', 20_000);

    expect(mode.chart.slice(0, 5).map(cue => [cue.atMs, cue.move])).toEqual([
      [4_000, 'LEAN_LEFT'],
      [6_000, 'HANDS_UP_JUMP'],
      [8_000, 'LEAN_RIGHT'],
      [10_000, 'HANDS_UP_JUMP'],
      [12_000, 'LEAN_LEFT'],
    ]);
    expect(mode.snapshot(1_999).activeCue).toBeNull();
    expect(mode.snapshot(2_000).activeCue).toBeNull();
    expect(mode.snapshot(3_640).activeCue).toMatchObject({ atMs: 4_000, move: 'LEAN_LEFT' });
  });

  it.each([2_000, 3_639, 3_640, 4_000, 4_360, 4_361])('only asks for a Rhythm move when it can score at %i ms', elapsedMs => {
    const mode = new ModeEngine('rhythm-run', 20_000);
    mode.update(0, analysis(0));
    const canMoveNow = mode.snapshot(elapsedMs).activeCue !== null;
    const events = mode.update(elapsedMs, analysis(elapsedMs, { lane: -1 }));
    expect(canMoveNow).toBe(events.includes('clear'));
  });

  it.each(['hit', 'miss'] as const)('clears Rhythm feedback after a %s so the next move can be shown', outcome => {
    const mode = new ModeEngine('rhythm-run', 20_000);
    const elapsedMs = outcome === 'hit' ? 4_000 : 4_361;
    mode.update(elapsedMs, analysis(elapsedMs, { lane: outcome === 'hit' ? -1 : 0 }));
    expect(mode.snapshot(elapsedMs).feedback).not.toBe('');
    expect(mode.snapshot(5_600)).toMatchObject({ feedback: '', feedbackKind: 'neutral' });
    expect(mode.snapshot(5_640).activeCue?.move).toBe('HANDS_UP_JUMP');
  });

  it('misses a Rhythm move after the plus-or-minus 360ms scoring window', () => {
    const mode = new ModeEngine('rhythm-run', 20_000);
    mode.update(4_000, analysis(4_000));

    const events = mode.update(4_361, analysis(4_361, { lane: -1 }));

    expect(events).not.toContain('clear');
    expect(mode.snapshot(4_361)).toMatchObject({ score: 0, cleared: 0, misses: 1 });
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
  it('expires a missed cue after its timing window closes', () => {
    const mode = new ModeEngine('rhythm-run', 10_000);

    mode.update(4_361, analysis(4_361));

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
    }));

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

  it('scores one full Six-Seven cycle only after returning to the first hand', () => {
    const mode = new ModeEngine('six-seven', 20_000);
    mode.update(0, oneHandPose(0, 'left'));
    mode.update(120, oneHandPose(120, 'left'));
    mode.update(400, oneHandPose(400, 'right'));
    mode.update(520, oneHandPose(520, 'right'));
    expect(mode.snapshot(520)).toMatchObject({ score: 0, cleared: 0 });

    mode.update(800, oneHandPose(800, 'left'));
    const events = mode.update(920, oneHandPose(920, 'left'));

    expect(events).toContain('clear');
    expect(mode.snapshot(920)).toMatchObject({ score: 100, cleared: 1, sixSevenCount: 1, combo: 1 });
  });
});
