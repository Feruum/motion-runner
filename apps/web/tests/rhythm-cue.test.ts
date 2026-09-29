import { describe, expect, it } from 'vitest';
import type { RhythmSnapshot, RhythmStar } from '../../../packages/game/src/core/rhythm-types';
import { rhythmRunCue } from '../src/presentation/rhythm-cue';

function snapshot(star: Partial<RhythmStar> = {}, elapsedMs = 2000): RhythmSnapshot {
  return { elapsedMs, stars:[{id:0,atMs:4000,lane:-1,height:'low',status:'upcoming',resolvedAtMs:null,points:0,...star}],score:0,cleared:0,misses:0,combo:0,bestCombo:0,feedback:'',feedbackKind:'neutral' };
}
describe('rhythm star guidance',()=>{
  it('explains the visible low star and confirms an already aligned runner',()=>{
    expect(rhythmRunCue(snapshot(),0,true).title).toBe('Lean left · collect the low star');
    expect(rhythmRunCue(snapshot(),-1,true).title).toBe('Stay left · the star is coming to you');
  });
  it('prepares center and hands before cueing the jump early enough to meet the star',()=>{
    const star={lane:0 as const,height:'high' as const};
    expect(rhythmRunCue(snapshot(star),1,true).title).toBe('Return to center · high star ahead');
    expect(rhythmRunCue(snapshot(star,3450),0,true).title).toBe('Raise both hands · jump for the star');
    expect(rhythmRunCue(snapshot(star,3450),0,false,0,true).title).toBe('Lower both hands to prepare your jump');
    expect(rhythmRunCue(snapshot(star,3450),0,false,0,false).title).toBe('Raise both hands · jump for the star');
    expect(rhythmRunCue(snapshot(star,3450),0,false,1.5).title).toBe('Reach the high star · jump in progress');
  });
  it('shows a collected star without hiding an imminent jump',()=>{
    const state=snapshot({lane:0,height:'high'},3450);
    state.feedback='Star collected! +100';state.feedbackKind='good';
    expect(rhythmRunCue(state,0,true).title).toBe('Raise both hands · jump for the star');
    state.elapsedMs=2000;
    expect(rhythmRunCue(state,0,true).title).toBe('Star collected! +100');
  });
});
