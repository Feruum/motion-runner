import { CONFIG as C } from './config';
import type { GameEvent, GameInput, Lane, Wave } from './types';

const patterns: Wave['obstacles'][] = [
  [{lane:0,kind:'high'}], [{lane:-1,kind:'high'},{lane:0,kind:'low'}],
  [{lane:1,kind:'high'},{lane:0,kind:'low'}], [{lane:-1,kind:'high'},{lane:1,kind:'high'}],
  [{lane:0,kind:'low'},{lane:1,kind:'low'}], [{lane:0,kind:'high'},{lane:1,kind:'high'}],
  [{lane:-1,kind:'low'},{lane:0,kind:'high'}], [{lane:-1,kind:'high'},{lane:0,kind:'low'}],
];
export function makeWaves(durationMs:number):Wave[] {
  const waves:Wave[]=[];
  for(let t=C.firstWaveMs;t<durationMs-1000;t+=C.waveIntervalMs) {
    const id=waves.length;
    waves.push({id,atMs:t,obstacles:patterns[id%patterns.length].map(o=>({...o})),resolved:false});
  }
  return waves;
}
export class GameEngine {
  elapsedMs=0;score=0;cleared=0;collisions=0;finished=false;paused=false;
  lane:Lane=0; jumpStartedMs=-Infinity;
  waves:Wave[];
  constructor(public readonly durationMs:number=C.durationMs) {this.waves=makeWaves(durationMs);}
  get jumpAgeMs(){return this.elapsedMs-this.jumpStartedMs;}
  get jumpHeight(){return this.jumpAgeMs>=0 && this.jumpAgeMs<C.jumpMs?Math.sin(Math.PI*this.jumpAgeMs/C.jumpMs)*2.2:0;}
  reset(){this.elapsedMs=0;this.score=0;this.cleared=0;this.collisions=0;this.finished=false;this.paused=false;this.lane=0;this.jumpStartedMs=-Infinity;this.waves=makeWaves(this.durationMs);}
  update(deltaMs:number,input:GameInput):GameEvent[] {
    if(this.paused||this.finished||!Number.isFinite(deltaMs)||deltaMs<0) return [];
    const events:GameEvent[]=[];
    this.lane=input.lane;
    if(input.jump&&this.jumpAgeMs>=C.jumpMs) {this.jumpStartedMs=this.elapsedMs;events.push('jump');}
    this.elapsedMs=Math.min(this.durationMs,this.elapsedMs+deltaMs);
    for(const wave of this.waves) {
      if(wave.resolved||wave.atMs>this.elapsedMs) continue;
      wave.resolved=true;
      const age=wave.atMs-this.jumpStartedMs;
      const safeJump=age>=C.jumpSafeStartMs&&age<=C.jumpSafeEndMs;
      const hit=wave.obstacles.some(o=>o.lane===this.lane&&(o.kind==='high'||!safeJump));
      if(hit){this.score=Math.max(0,this.score-5);this.collisions++;events.push('hit');}
      else {this.score+=10;this.cleared++;events.push('clear');}
    }
    if(this.elapsedMs>=this.durationMs){this.finished=true;events.push('finish');}
    return events;
  }
}
