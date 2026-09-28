import { CONFIG as C } from './config';
import { GameEngine } from './game';
import type { GestureAnalysis, Stage } from './types';

export const tutorialSteps=['LEAN_LEFT','LEAN_RIGHT','HANDS_UP_JUMP'] as const;
export class SessionController {
  stage:Stage='WELCOME';
  readonly game:GameEngine;
  tutorialIndex=0;
  awaitingNeutral=false;
  tutorialSuccess=false;
  startArmed=false;
  startSince=-1;
  countdownEndsAt=-1;
  recoverySince=-1;
  lastValidAt=-Infinity;
  lastTickAt=-1;
  lastJumpEventAt=-1;
  private tutorialMatchSince=-1;
  bestScore=0;
  constructor(durationMs:number=C.durationMs){this.game=new GameEngine(durationMs);}
  get tutorialTarget(){return tutorialSteps[this.tutorialIndex]??'HANDS_UP_JUMP';}
  get tutorialProgress(){return this.tutorialIndex;}
  tick(now:number, pose:GestureAnalysis):Stage {
    const dt=this.lastTickAt<0?0:Math.min(100,Math.max(0,now-this.lastTickAt));
    this.lastTickAt=now;
    if(pose.trackingValid&&now-pose.timestampMs<=C.staleMs) this.lastValidAt=now;
    if(this.stage==='CALIBRATION'&&pose.calibrated){this.stage='TUTORIAL';return this.stage;}
    if(this.stage==='TUTORIAL') {this.tickTutorial(now,pose);return this.stage;}
    if(this.stage==='READY'||this.stage==='RESULTS') {
      const fresh=pose.trackingValid&&now-pose.timestampMs<=C.staleMs;
      if(pose.handsUp&&fresh) {
        if(this.startSince<0)this.startSince=now;
        if(now-this.startSince>=C.startHoldMs)this.startArmed=true;
      } else {
        if(this.startArmed&&fresh&&pose.handsDown)this.beginCountdown(now);
        this.startSince=-1;
      }
      return this.stage;
    }
    if(this.stage==='COUNTDOWN') {
      if(!pose.trackingValid||now-pose.timestampMs>C.staleMs||!pose.handsDown){this.pause();return this.stage;}
      if(now>=this.countdownEndsAt){this.stage='PLAYING';this.game.paused=false;this.startArmed=false;this.startSince=-1;this.lastTickAt=now;}
      return this.stage;
    }
    if(this.stage==='PLAYING') {
      if(!pose.trackingValid||now-pose.timestampMs>C.staleMs){this.pause();return this.stage;}
      if(documentHiddenSafe()){this.pause();return this.stage;}
      const jump=pose.jumpTriggered&&pose.timestampMs!==this.lastJumpEventAt;
      if(jump)this.lastJumpEventAt=pose.timestampMs;
      const events=this.game.update(dt,{lane:pose.lane,jump});
      if(events.includes('finish')) {this.stage='RESULTS';this.bestScore=Math.max(this.bestScore,this.game.score);}
      return this.stage;
    }
    if(this.stage==='PAUSED') {
      const recovered=pose.trackingValid&&now-pose.timestampMs<=C.staleMs&&pose.handsDown&&!documentHiddenSafe();
      if(!recovered){this.recoverySince=-1;return this.stage;}
      if(this.recoverySince<0)this.recoverySince=now;
      if(now-this.recoverySince>=C.recoveryMs)this.beginCountdown(now,false);
      return this.stage;
    }
    return this.stage;
  }
  private tickTutorial(now:number,pose:GestureAnalysis){
    if(!pose.trackingValid||!pose.calibrated){this.tutorialMatchSince=-1;return;}
    if(this.awaitingNeutral){
      if(pose.lane===0&&pose.handsDown){this.awaitingNeutral=false;this.tutorialSuccess=false;}
      else this.tutorialSuccess=false;
      return;
    }
    const match=this.tutorialTarget==='LEAN_LEFT'?pose.lane===-1:this.tutorialTarget==='LEAN_RIGHT'?pose.lane===1:pose.handsUp;
    if(!match){this.tutorialMatchSince=-1;return;}
    if(this.tutorialMatchSince<0)this.tutorialMatchSince=now;
    if(now-this.tutorialMatchSince>=C.tutorialConfirmMs){
      this.tutorialSuccess=true;this.awaitingNeutral=true;this.tutorialMatchSince=-1;
      if(this.tutorialIndex<tutorialSteps.length-1)this.tutorialIndex++;
      else {this.stage='READY';this.awaitingNeutral=false;this.tutorialSuccess=false;this.startArmed=false;this.game.reset();}
    }
  }
  private beginCountdown(now:number,resetGame=true){
    this.stage='COUNTDOWN';this.countdownEndsAt=now+C.countdownMs;this.recoverySince=-1;
    this.startArmed=false;this.startSince=-1;
    if(resetGame)this.game.reset();else this.game.paused=true;
  }
  private pause(){this.stage='PAUSED';this.game.paused=true;this.recoverySince=-1;}
  startLoading(){if(this.stage==='WELCOME'||this.stage==='ERROR')this.stage='LOADING';}
  cameraReady(){if(this.stage==='LOADING')this.stage='CALIBRATION';}
  cameraFailed(){this.stage='ERROR';this.game.paused=true;}
  restartSetup(){this.game.reset();this.stage='LOADING';this.tutorialIndex=0;this.awaitingNeutral=false;this.tutorialSuccess=false;this.startArmed=false;this.startSince=-1;this.countdownEndsAt=-1;this.recoverySince=-1;this.lastValidAt=-Infinity;this.lastTickAt=-1;this.lastJumpEventAt=-1;this.tutorialMatchSince=-1;}
  setTabHidden(hidden:boolean){if(hidden&&this.stage==='PLAYING')this.pause();}
  dismissPause(){if(this.stage==='PAUSED'){this.game.paused=true;}}
}
function documentHiddenSafe(){return typeof document!=='undefined'&&document.visibilityState==='hidden';}
