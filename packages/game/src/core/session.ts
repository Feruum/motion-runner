import { CONFIG as C } from './config';
import { GameEngine } from './game';
import { sixSevenRaisedHand } from './six-seven';
import type { GameMode, GestureAnalysis, Stage, TutorialGesture } from './types';

export const standardTutorialSteps: readonly TutorialGesture[]=['LEAN_LEFT','LEAN_RIGHT','HANDS_UP_JUMP'];
export const sixSevenTutorialSteps: readonly TutorialGesture[]=['LEFT_HAND_UP','RIGHT_HAND_UP'];
export const dodgeTutorialSteps: readonly TutorialGesture[]=['LEAN_LEFT','LEAN_RIGHT'];
export const beatBlasterTutorialSteps: readonly TutorialGesture[]=['BLAST_LEFT','BLAST_RIGHT'];
export class SessionController {
  stage:Stage='WELCOME';
  readonly game:GameEngine;
  tutorialMode:GameMode;
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
  constructor(durationMs:number=C.durationMs, mode:GameMode='classic-run'){this.game=new GameEngine(durationMs);this.tutorialMode=mode;}
  get tutorialSteps(){return this.tutorialMode==='six-seven'?sixSevenTutorialSteps:this.tutorialMode==='dodge-arena'?dodgeTutorialSteps:this.tutorialMode==='beat-blaster'?beatBlasterTutorialSteps:standardTutorialSteps;}
  get tutorialTarget():TutorialGesture{return this.tutorialSteps[this.tutorialIndex]??'HANDS_UP_JUMP';}
  get tutorialProgress(){return this.tutorialIndex;}
  setTutorialMode(mode:GameMode){this.tutorialMode=mode;this.tutorialIndex=0;this.awaitingNeutral=false;this.tutorialSuccess=false;this.tutorialMatchSince=-1;}
  tick(now:number, pose:GestureAnalysis):Stage {
    const dt=this.lastTickAt<0?0:Math.min(100,Math.max(0,now-this.lastTickAt));
    this.lastTickAt=now;
    const fresh=pose.trackingValid&&now-pose.timestampMs<=C.staleMs;
    if(fresh) this.lastValidAt=pose.timestampMs;
    // A jump used during setup/recovery must not fire on the first playing frame.
    if(this.stage!=='PLAYING'&&pose.jumpTriggered)this.lastJumpEventAt=pose.timestampMs;
    if(this.stage==='CALIBRATION'&&pose.calibrated){this.stage='TUTORIAL';return this.stage;}
    if(this.stage==='TUTORIAL') {this.tickTutorial(now,pose);return this.stage;}
    if(this.stage==='READY'||this.stage==='RESULTS') {
      if(!fresh||!pose.handsTracked){this.startSince=-1;this.startArmed=false;return this.stage;}
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
      if(documentHiddenSafe()){this.pause();return this.stage;}
      if(!fresh){
        this.countdownEndsAt+=dt;
        if(now-this.lastValidAt>=C.trackingGraceMs)this.pause();
        return this.stage;
      }
      if(now>=this.countdownEndsAt){this.stage='PLAYING';this.game.paused=false;this.startArmed=false;this.startSince=-1;this.lastTickAt=now;}
      return this.stage;
    }
    if(this.stage==='PLAYING') {
      if(documentHiddenSafe()){this.pause();return this.stage;}
      if(!fresh){
        this.game.paused=true;
        if(now-this.lastValidAt>=C.trackingGraceMs)this.pause();
        return this.stage;
      }
      const step=this.game.paused?0:dt;
      this.game.paused=false;
      const jump=pose.jumpTriggered&&pose.timestampMs!==this.lastJumpEventAt;
      if(jump)this.lastJumpEventAt=pose.timestampMs;
      const controls=this.tutorialMode==='six-seven'?{lane:0 as const,jump:false}
        :this.tutorialMode==='dodge-arena'?{lane:pose.lane,jump:false}
          :{lane:pose.lane,jump};
      const events=this.game.update(step,controls);
      if(events.includes('finish')) {this.stage='RESULTS';this.bestScore=Math.max(this.bestScore,this.game.score);}
      return this.stage;
    }
    if(this.stage==='PAUSED') {
      const recovered=fresh&&pose.handsDown&&!documentHiddenSafe();
      if(!recovered){this.recoverySince=-1;return this.stage;}
      if(this.recoverySince<0)this.recoverySince=now;
      if(now-this.recoverySince>=C.recoveryMs)this.beginCountdown(now,false);
      return this.stage;
    }
    return this.stage;
  }
  private tickTutorial(now:number,pose:GestureAnalysis){
    if(!pose.trackingValid||!pose.calibrated||now-pose.timestampMs>C.staleMs){this.tutorialMatchSince=-1;return;}
    if(this.awaitingNeutral){
      const sixSevenNeutral=this.tutorialMode!=='six-seven'||sixSevenRaisedHand(pose.landmarks)===null;
      if(pose.lane===0&&pose.handsDown&&sixSevenNeutral&&(this.tutorialMode!=='beat-blaster'||!this.hasBlasterReach(pose))){this.awaitingNeutral=false;this.tutorialSuccess=false;}
      else this.tutorialSuccess=false;
      return;
    }
    const match=this.tutorialTarget==='LEAN_LEFT'?pose.lane===-1
      :this.tutorialTarget==='LEAN_RIGHT'?pose.lane===1
        :this.tutorialTarget==='HANDS_UP_JUMP'?pose.handsUp
          :this.tutorialTarget==='LEFT_HAND_UP'?this.matchesSingleRaisedHand(pose,'left')
            :this.tutorialTarget==='RIGHT_HAND_UP'?this.matchesSingleRaisedHand(pose,'right')
              :this.matchesBlasterReach(pose,this.tutorialTarget==='BLAST_LEFT'?'left':'right');
    if(!match){this.tutorialMatchSince=-1;return;}
    if(this.tutorialMatchSince<0)this.tutorialMatchSince=now;
    if(now-this.tutorialMatchSince>=C.tutorialConfirmMs){
      this.tutorialSuccess=true;this.awaitingNeutral=true;this.tutorialMatchSince=-1;
      if(this.tutorialIndex<this.tutorialSteps.length-1)this.tutorialIndex++;
      else {this.stage='READY';this.awaitingNeutral=false;this.tutorialSuccess=false;this.startArmed=false;this.game.reset();}
    }
  }
  private matchesSingleRaisedHand(pose:GestureAnalysis,hand:'left'|'right'){
    return pose.handsTracked&&sixSevenRaisedHand(pose.landmarks)===hand;
  }
  private matchesBlasterReach(pose:GestureAnalysis,hand:'left'|'right'){
    const reach=this.blasterReach(pose);
    return !!reach&&reach[hand];
  }
  private hasBlasterReach(pose:GestureAnalysis){
    const reach=this.blasterReach(pose);
    return !!reach&&(reach.left||reach.right);
  }
  private blasterReach(pose:GestureAnalysis):{left:boolean;right:boolean}|null{
    const l=pose.landmarks;
    if(l.length<25)return null;
    const required=[l[11],l[12],l[15],l[16]];
    if(required.some(point=>!point||!Number.isFinite(point.x)||!Number.isFinite(point.visibility)||point.visibility<C.confidence||(point.presence??1)<C.confidence))return null;
    const shoulderWidth=Math.abs(l[11].x-l[12].x);
    if(shoulderWidth<.02)return null;
    return {
      left:l[15].x>l[11].x+shoulderWidth*.42,
      right:l[16].x<l[12].x-shoulderWidth*.42,
    };
  }
  private beginCountdown(now:number,resetGame=true){
    this.stage='COUNTDOWN';this.countdownEndsAt=now+(resetGame?C.countdownMs:C.recoveryCountdownMs);this.recoverySince=-1;
    this.startArmed=false;this.startSince=-1;
    if(resetGame)this.game.reset();else this.game.paused=true;
  }
  private pause(){this.stage='PAUSED';this.game.paused=true;this.recoverySince=-1;}
  requestStart(now:number,pose:GestureAnalysis):boolean{
    if(this.stage!=='READY'||!pose.calibrated||!pose.trackingValid||!pose.handsTracked||!pose.handsDown||now-pose.timestampMs>C.staleMs||documentHiddenSafe())return false;
    this.lastJumpEventAt=pose.timestampMs;
    this.beginCountdown(now);
    return true;
  }
  requestReplay(now:number,pose:GestureAnalysis):boolean{
    if(this.stage!=='RESULTS'||!pose.calibrated||!pose.trackingValid||now-pose.timestampMs>C.staleMs||documentHiddenSafe())return false;
    this.lastJumpEventAt=pose.timestampMs;
    this.beginCountdown(now);
    return true;
  }
  startLoading(){if(this.stage==='WELCOME'||this.stage==='ERROR')this.stage='LOADING';}
  cameraReady(){if(this.stage==='LOADING')this.stage='CALIBRATION';}
  cameraFailed(){this.stage='ERROR';this.game.paused=true;}
  restartSetup(){this.game.reset();this.stage='LOADING';this.tutorialIndex=0;this.awaitingNeutral=false;this.tutorialSuccess=false;this.startArmed=false;this.startSince=-1;this.countdownEndsAt=-1;this.recoverySince=-1;this.lastValidAt=-Infinity;this.lastTickAt=-1;this.lastJumpEventAt=-1;this.tutorialMatchSince=-1;}
  setTabHidden(hidden:boolean){if(hidden&&this.stage==='PLAYING')this.pause();}
  dismissPause(){if(this.stage==='PAUSED'){this.game.paused=true;}}
}
function documentHiddenSafe(){return typeof document!=='undefined'&&document.visibilityState==='hidden';}
