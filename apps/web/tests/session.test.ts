import { describe,expect,it } from 'vitest';
import { SessionController } from '@motion-runner/game';
import { analysis, pose } from './fixtures';
describe('Session controller',()=>{
  it('teaches only lane changes and disables jump input in Dodge Arena',()=>{
    const s=new SessionController(20000,'dodge-arena');
    expect(s.tutorialSteps).toEqual(['LEAN_LEFT','LEAN_RIGHT']);
    s.stage='PLAYING';s.lastTickAt=0;
    s.tick(100,analysis(100,{lane:1,jumpTriggered:true,handsUp:true}));
    expect(s.game.lane).toBe(1);expect(s.game.jumpStartedMs).toBe(-Infinity);
  });

  it('requires a gesture hold, hand release and a countdown before playing',()=>{
    const s=new SessionController(20000); s.stage='READY';
    for(let t=0;t<=1200;t+=50) s.tick(t,analysis(t,{handsUp:true,handsDown:false}));
    expect(s.stage).toBe('READY'); expect(s.startArmed).toBe(true);
    s.tick(1250,analysis(1250)); expect(s.stage).toBe('COUNTDOWN');
    s.tick(4200,analysis(4200));expect(s.stage).toBe('COUNTDOWN');
    s.tick(4300,analysis(4300));expect(s.stage).toBe('PLAYING'); expect(s.game.elapsedMs).toBe(0);
  });
  it('holds the course through short tracking gaps and uses a short recovery countdown',()=>{
    const s=new SessionController();s.stage='PLAYING';s.tick(0,analysis(0));s.tick(100,analysis(100));
    s.tick(150,analysis(150,{trackingValid:false}));expect(s.stage).toBe('PLAYING');
    const frozen=s.game.elapsedMs;
    s.tick(400,analysis(400,{trackingValid:false}));expect(s.stage).toBe('PAUSED');
    expect(s.game.elapsedMs).toBe(frozen);
    for(let t=450;t<=850;t+=50)s.tick(t,analysis(t,{handsDown:false,handsUp:true}));
    expect(s.stage).toBe('COUNTDOWN');
    expect(s.countdownEndsAt).toBe(1850);
    s.tick(1850,analysis(1850,{handsDown:false,handsUp:true,jumpTriggered:true}));
    expect(s.stage).toBe('PLAYING');expect(s.game.elapsedMs).toBe(frozen);
    s.tick(1866,analysis(1850,{handsDown:false,handsUp:true,jumpTriggered:true}));
    expect(s.game.jumpStartedMs).toBe(-Infinity);
  });
  it('detects stale results even when the last pose was valid',()=>{
    const s=new SessionController();s.stage='PLAYING';s.tick(0,analysis(0));s.tick(400,analysis(0));expect(s.stage).toBe('PAUSED');
  });
  it('does not open a pause screen or move to center for a brief body occlusion',()=>{
    const s=new SessionController();s.stage='PLAYING';s.tick(0,analysis(0,{lane:-1}));
    s.tick(50,analysis(50,{trackingValid:false}));s.tick(200,analysis(200,{trackingValid:false}));
    expect(s.game.lane).toBe(-1);expect(s.game.elapsedMs).toBe(0);
    s.tick(250,analysis(250,{lane:-1}));
    expect(s.stage).toBe('PLAYING');expect(s.game.paused).toBe(false);
  });
  it('does not let a stale pose complete a tutorial hold',()=>{
    const s=new SessionController();s.stage='TUTORIAL';
    s.tick(0,analysis(0,{lane:-1}));s.tick(700,analysis(0,{lane:-1}));
    expect(s.tutorialIndex).toBe(0);
  });
  it('disarms a pending start when tracking is lost',()=>{
    const s=new SessionController();s.stage='READY';
    s.tick(0,analysis(0,{handsUp:true,handsDown:false}));s.tick(1000,analysis(1000,{handsUp:true,handsDown:false}));
    expect(s.startArmed).toBe(true);
    s.tick(1050,analysis(1050,{trackingValid:false}));s.tick(1100,analysis(1100));
    expect(s.stage).toBe('READY');expect(s.startArmed).toBe(false);
  });
  it('supports button replay only with fresh calibrated tracking',()=>{
    const s=new SessionController();s.stage='RESULTS';s.game.score=50;
    expect(s.requestReplay(1000,analysis(0))).toBe(false);
    expect(s.requestReplay(1000,analysis(1000,{trackingValid:false}))).toBe(false);
    expect(s.requestReplay(1000,analysis(1000))).toBe(true);
    expect(s.stage).toBe('COUNTDOWN');expect(s.game.score).toBe(0);
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
  it('teaches both hands separately before starting Six-Seven',()=>{
    const s=new SessionController(20000,'six-seven');s.stage='TUTORIAL';
    expect(s.tutorialTarget).toBe('LEFT_HAND_UP');
    for(let t=0;t<=650;t+=50)s.tick(t,analysis(t,{landmarks:pose(t,0,'left').landmarks,handsDown:false}));
    expect(s.tutorialIndex).toBe(1);expect(s.awaitingNeutral).toBe(true);
    s.tick(700,analysis(700));
    expect(s.tutorialTarget).toBe('RIGHT_HAND_UP');
    for(let t=750;t<=1400;t+=50)s.tick(t,analysis(t,{landmarks:pose(t,0,'right').landmarks,handsDown:false}));
    expect(s.stage).toBe('READY');
  });
  it('keeps lane and jump controls inactive during Six-Seven',()=>{
    const s=new SessionController(20000,'six-seven');s.stage='PLAYING';
    s.tick(0,analysis(0,{lane:-1,jumpTriggered:true,handsUp:true,handsDown:false}));
    s.tick(100,analysis(100,{lane:1,jumpTriggered:true,handsUp:true,handsDown:false}));
    expect(s.game.lane).toBe(0);expect(s.game.jumpStartedMs).toBe(-Infinity);
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
