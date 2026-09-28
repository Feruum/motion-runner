import { describe,expect,it } from 'vitest';
import { SessionController } from '@motion-runner/game';
import { analysis } from './fixtures';
describe('Session controller',()=>{
  it('requires a gesture hold, hand release and a countdown before playing',()=>{
    const s=new SessionController(20000); s.stage='READY';
    for(let t=0;t<=1200;t+=50) s.tick(t,analysis(t,{handsUp:true,handsDown:false}));
    expect(s.stage).toBe('READY'); expect(s.startArmed).toBe(true);
    s.tick(1250,analysis(1250)); expect(s.stage).toBe('COUNTDOWN');
    s.tick(4200,analysis(4200));expect(s.stage).toBe('COUNTDOWN');
    s.tick(4300,analysis(4300));expect(s.stage).toBe('PLAYING'); expect(s.game.elapsedMs).toBe(0);
  });
  it('pauses immediately on tracking loss and counts down after recovery',()=>{
    const s=new SessionController();s.stage='PLAYING';s.tick(0,analysis(0));s.tick(100,analysis(100));
    s.tick(150,analysis(150,{trackingValid:false}));expect(s.stage).toBe('PAUSED');
    const frozen=s.game.elapsedMs;s.tick(5000,analysis(150,{trackingValid:false}));expect(s.game.elapsedMs).toBe(frozen);
    for(let t=5050;t<=6100;t+=50)s.tick(t,analysis(t));expect(s.stage).toBe('COUNTDOWN');
    s.tick(9200,analysis(9200));expect(s.stage).toBe('PLAYING');expect(s.game.elapsedMs).toBe(frozen);
  });
  it('detects stale results even when the last pose was valid',()=>{
    const s=new SessionController();s.stage='PLAYING';s.tick(0,analysis(0));s.tick(400,analysis(0));expect(s.stage).toBe('PAUSED');
  });
  it('never skips tutorials and requires neutral between them',()=>{
    const s=new SessionController();s.stage='CALIBRATION';s.tick(0,analysis(0));expect(s.stage).toBe('TUTORIAL');
    s.tick(50,analysis(50,{lane:-1}));s.tick(750,analysis(750,{lane:-1}));
    expect(s.tutorialIndex).toBe(1);expect(s.awaitingNeutral).toBe(true);
    s.tick(800,analysis(800,{lane:1}));expect(s.tutorialSuccess).toBe(false);
    s.tick(850,analysis(850));
    for(let t=900;t<=1550;t+=50)s.tick(t,analysis(t,{lane:1}));
    expect(s.tutorialSuccess).toBe(true);
  });
  it('completes a full short run and replay resets its score',()=>{
    const s=new SessionController(20000);s.stage='PLAYING';
    for(let t=0;t<=20100;t+=100)s.tick(t,analysis(t));
    expect(s.stage).toBe('RESULTS');expect(s.game.finished).toBe(true);
    for(let t=20200;t<=21400;t+=100)s.tick(t,analysis(t,{handsUp:true,handsDown:false}));
    s.tick(21500,analysis(21500));expect(s.stage).toBe('COUNTDOWN');
    expect(s.game.score).toBe(0);expect(s.game.elapsedMs).toBe(0);
  });
});
