import { describe, expect, it } from 'vitest';
import { GameEngine } from '@motion-runner/game';
import { classicRunCue } from '../src/presentation/run-cue';

describe('classic run guidance',()=>{
  it('directs the player away from a tall obstacle',()=>{
    const game=new GameEngine();game.elapsedMs=4400;
    expect(classicRunCue(game,true).text).toContain('Change lanes');
  });
  it('cues a jump early enough for gesture confirmation',()=>{
    const game=new GameEngine();game.update(6800,{lane:0,jump:false});
    expect(classicRunCue(game,true).text).toBe('Raise both hands now');
    game.elapsedMs=7300;
    expect(classicRunCue(game,true).text).toContain('Change lanes');
  });
  it('explains rearming a jump when hands are still raised',()=>{
    const game=new GameEngine();game.update(6800,{lane:0,jump:false});
    expect(classicRunCue(game,false).text).toContain('Lower');
  });
  it('does not ask for another jump during a safe jump',()=>{
    const game=new GameEngine();game.update(7100,{lane:0,jump:false});game.jumpStartedMs=6900;
    expect(classicRunCue(game,false).text).toBe('Jump in progress');
  });
  it('confirms an open lane without asking for an unnecessary move',()=>{
    const game=new GameEngine();game.elapsedMs=4400;game.lane=-1;
    expect(classicRunCue(game,true).text).toBe('Lane clear · hold your position');
  });
});
