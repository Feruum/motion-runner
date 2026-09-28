import { describe, expect, it } from 'vitest';
import { GameEngine, makeWaves } from '../src/core/game';
describe('Game Engine', () => {
  it('provides an open lane for every authored wave and enough reaction time', () => {
    const waves=makeWaves(60000); expect(waves[0].atMs).toBe(5000);
    waves.forEach((w,i)=> { expect(new Set(w.obstacles.map(o=>o.lane)).size).toBeLessThan(3); if(i) expect(w.atMs-waves[i-1].atMs).toBeGreaterThanOrEqual(2500); });
  });
  it('scores a wave only once', () => {
    const g=new GameEngine(20000); g.waves=[{id:0,atMs:100,obstacles:[{lane:-1,kind:'high'}],resolved:false}];
    g.update(100,{lane:0,jump:false}); expect(g.score).toBe(10);
    g.update(200,{lane:0,jump:false}); expect(g.score).toBe(10); expect(g.cleared).toBe(1);
  });
  it('never makes score negative or ends a run on collision', () => {
    const g=new GameEngine(); g.waves=[{id:0,atMs:100,obstacles:[{lane:0,kind:'high'}],resolved:false}];
    g.update(100,{lane:0,jump:false}); expect(g.score).toBe(0); expect(g.collisions).toBe(1); expect(g.finished).toBe(false);
  });
  it('clears low barriers in the safe jump window but not high obstacles', () => {
    for(const kind of ['low','high'] as const) {
      const g=new GameEngine(); g.waves=[{id:0,atMs:450,obstacles:[{lane:0,kind}],resolved:false}];
      g.update(0,{lane:0,jump:true}); g.update(450,{lane:0,jump:false});
      expect(g.collisions).toBe(kind==='low'?0:1);
    }
  });
  it('freezes time, score and jumping while paused', () => {
    const g=new GameEngine(); g.update(200,{lane:0,jump:true}); g.paused=true;
    const before=[g.elapsedMs,g.score,g.jumpHeight]; g.update(5000,{lane:1,jump:true});
    expect([g.elapsedMs,g.score,g.jumpHeight]).toEqual(before);
  });
  it('finishes at 60 seconds and completely resets', () => {
    const g=new GameEngine(); g.update(60000,{lane:0,jump:false}); expect(g.finished).toBe(true); expect(g.elapsedMs).toBe(60000);
    g.reset(); expect(g.elapsedMs).toBe(0); expect(g.score).toBe(0); expect(g.collisions).toBe(0); expect(g.finished).toBe(false);
    expect(g.waves.some(w=>w.resolved)).toBe(false);
  });
});
