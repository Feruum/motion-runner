import { describe, expect, it } from 'vitest';
import { raceSteer, raceSocketUrl, predictRacePlayer } from '../src/race-controls';
import type { RacePlayer } from '../../../packages/game/src/core/race-types';

describe('race controls', () => {
  it('keeps neutral still and maps continuous lean symmetrically', () => {
    expect(raceSteer(.05)).toBe(0);
    // Camera looks down +z, so its screen-right points toward world -x.
    expect(raceSteer(.2)).toBeLessThan(0);
    expect(raceSteer(-.2)).toBe(-raceSteer(.2));
    expect(raceSteer(1)).toBe(-1);
    expect(raceSteer(NaN)).toBe(0);
  });
  it('uses secure sockets from an HTTPS page and preserves a configured server', () => {
    expect(raceSocketUrl('https://game.test/project/')).toBe('wss://game.test/api/race');
    expect(raceSocketUrl('http://localhost:5175/', 'http://localhost:3002')).toBe('ws://localhost:3002/api/race');
    expect(() => raceSocketUrl('https://game.test/', 'http://remote.test')).toThrow();
  });
  it('bounds prediction and stops it on lost tracking or a finished racer', () => {
    const player: RacePlayer = { id:'a', name:'A', characterId:'rogue', isBot:false, x:0,y:0,z:20,vx:0,vz:8,checkpoint:0,rank:1,finishMs:null,status:'racing',invulnerableMs:0,stunMs:0 };
    const input = { steer:1,jump:false,tracking:true };
    expect(predictRacePlayer(player,input,1000).z).toBeCloseTo(20.8);
    expect(predictRacePlayer(player,input,100).x).toBeCloseTo(.6);
    expect(predictRacePlayer(player,{...input,tracking:false},100).z).toBe(20);
    expect(predictRacePlayer({...player,status:'finished'},input,100).z).toBe(20);
    expect(player.x).toBe(0);
  });
});
