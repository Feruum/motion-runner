import { CONFIG as C, POINT as P } from './config';
import type { Correction, GestureAnalysis, Landmark, Lane, PoseSample, TutorialGesture } from './types';

const essential = [P.leftEye,P.rightEye,P.leftShoulder,P.rightShoulder,P.leftHip,P.rightHip];
const visible = (p: Landmark | undefined) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
  && p.visibility>=C.confidence && (p.presence??1)>=C.confidence
  && p.x>.015 && p.x<.985 && p.y>.015 && p.y<.985;
export class GestureEngine {
  private smooth: Landmark[] = [];
  private previousTime = -1;
  private calibrationStart = -1;
  private calibrationSamples: number[] = [];
  private neutral = 0;
  private calibrated = false;
  private lane: Lane = 0;
  private pendingLane: Lane = 0;
  private laneSince = 0;
  private upSince = -1;
  private armed = false;
  private candidate = '';
  private candidateSince = 0;
  private lastHintAt = -Infinity;
  private published: Correction | null = null;

  reset() { Object.assign(this, new GestureEngine()); }
  update(sample: PoseSample, expected?: TutorialGesture): GestureAnalysis {
    const now = sample.timestampMs;
    const output: GestureAnalysis = { timestampMs: now, lane: this.lane, lean: 0, handsUp:false, handsDown:false, handsTracked:false, jumpTriggered:false, trackingValid:false, calibrated:this.calibrated, calibrationProgress:this.calibrated?1:0, correction:null, landmarks:[] };
    if (now <= this.previousTime) return output;
    const dt = this.previousTime < 0 ? 1000 : now-this.previousTime;
    this.previousTime = now;
    const valid = sample.frameWidth>0 && sample.frameHeight>0 && essential.every(i=>visible(sample.landmarks[i]));
    if (!valid) {
      this.smooth=[]; this.pendingLane=this.lane; this.laneSince=now; this.armed=false; this.upSince=-1;
      this.calibrationStart=-1; this.calibrationSamples=[]; this.candidate=''; this.published=null;
      const missing=essential.filter(i=>!visible(sample.landmarks[i]));
      const hips=missing.length>0&&missing.every(i=>i===P.leftHip||i===P.rightHip);
      output.correction={code:hips?'tracking-hips':'tracking-body',text:hips?'Step back until both hips are inside the camera frame.':'Keep your head, shoulders and hips inside the camera frame.',highlightLandmarks:missing};
      return output;
    }
    const alpha=1-Math.exp(-dt/C.smoothingMs);
    this.smooth=sample.landmarks.map((p,i)=> {
      const old=this.smooth[i];
      return old&&visible(old)&&visible(p)?{...p,x:old.x+(p.x-old.x)*alpha,y:old.y+(p.y-old.y)*alpha,z:old.z+(p.z-old.z)*alpha}:{...p};
    });
    const point=(i:number)=>({x:this.smooth[i].x*sample.frameWidth,y:this.smooth[i].y*sample.frameHeight});
    const ls=point(P.leftShoulder),rs=point(P.rightShoulder),lh=point(P.leftHip),rh=point(P.rightHip);
    const sx=(ls.x+rs.x)/2,sy=(ls.y+rs.y)/2,hx=(lh.x+rh.x)/2,hy=(lh.y+rh.y)/2;
    const width=Math.hypot(ls.x-rs.x,ls.y-rs.y),torso=Math.hypot(sx-hx,sy-hy);
    if(width<sample.frameWidth*.08 || torso<sample.frameHeight*.12) {
      this.calibrationStart=-1; this.calibrationSamples=[]; this.smooth=[]; this.armed=false; this.upSince=-1;
      output.correction={code:'tracking-distance',text:'Move closer while keeping your head and hips in view.',highlightLandmarks:[P.leftShoulder,P.rightShoulder,P.leftHip,P.rightHip]};
      return output;
    }
    const rawLean=-(sx-hx)/width;
    const eyeY=Math.min(point(P.leftEye).y,point(P.rightEye).y);
    const handsTracked=visible(sample.landmarks[P.leftWrist])&&visible(sample.landmarks[P.rightWrist]);
    const leftY=handsTracked?point(P.leftWrist).y:Infinity,rightY=handsTracked?point(P.rightWrist).y:Infinity;
    const leftUp=leftY<eyeY-C.headMargin*torso,rightUp=rightY<eyeY-C.headMargin*torso;
    const handsDown=handsTracked && leftY>ls.y+.08*torso && rightY>rs.y+.08*torso;
    output.trackingValid=true; output.landmarks=this.smooth; output.handsDown=handsDown;output.handsTracked=handsTracked;
    if(!handsTracked){
      this.armed=false;this.upSince=-1;this.candidate='';this.published=null;
      output.correction={code:'tracking-hands',text:'Keep both hands inside the camera frame. Bend your elbows or step back to leave room above your head.',highlightLandmarks:[P.leftWrist,P.rightWrist]};
      if(!this.calibrated){this.calibrationStart=-1;this.calibrationSamples=[];return output;}
    }
    if (!this.calibrated) {
      const mean=this.calibrationSamples.length?this.calibrationSamples.reduce((a,b)=>a+b,0)/this.calibrationSamples.length:rawLean;
      if(!handsDown || Math.abs(rawLean)>.25 || Math.abs(rawLean-mean)>C.calibrationMaxDeviation) {
        output.correction = !handsDown
          ? {code:'calibration-hands',text:'Lower both hands below your shoulders to begin calibration.',highlightLandmarks:[P.leftWrist,P.rightWrist]}
          : Math.abs(rawLean)>.25
            ? {code:'calibration-upright',text:'Stand upright with your shoulders above your hips.',highlightLandmarks:[P.leftShoulder,P.rightShoulder,P.leftHip,P.rightHip]}
            : {code:'calibration-still',text:'Hold still for two seconds so we can learn your neutral posture.',highlightLandmarks:[P.leftShoulder,P.rightShoulder]};
        this.calibrationStart=-1; this.calibrationSamples=[]; return output;
      }
      if(this.calibrationStart<0) this.calibrationStart=now;
      this.calibrationSamples.push(rawLean);
      output.calibrationProgress=Math.min(1,(now-this.calibrationStart)/C.calibrationMs);
      if(output.calibrationProgress<1) return output;
      this.neutral=this.calibrationSamples.reduce((a,b)=>a+b,0)/this.calibrationSamples.length;
      this.calibrated=true; this.armed=true;
    }
    output.calibrated=true; output.calibrationProgress=1;
    const lean=rawLean-this.neutral;
    let desired=this.lane;
    if(lean<=-C.leanActivate) desired=-1;
    else if(lean>=C.leanActivate) desired=1;
    else if(Math.abs(lean)<=C.leanRelease) desired=0;
    if(desired!==this.pendingLane) {this.pendingLane=desired;this.laneSince=now;}
    if(desired!==this.lane && now-this.laneSince>=C.leanHoldMs) this.lane=desired;
    output.lane=this.lane;output.lean=lean;
    if(!handsTracked)return output;
    if(leftUp && rightUp) {if(this.upSince<0) this.upSince=now;} else this.upSince=-1;
    const handsUp=this.upSince>=0 && now-this.upSince>=C.handsHoldMs;
    if(handsDown) this.armed=true;
    if(handsUp && this.armed) {output.jumpTriggered=true;this.armed=false;}
    output.lane=this.lane;output.lean=lean;output.handsUp=handsUp;

    let hint: Correction|null=null;
    const jumpIntent=leftY<ls.y-.10*torso || rightY<rs.y-.10*torso;
    const leftHandIntent=leftY<ls.y-.08*torso;
    const rightHandIntent=rightY<rs.y-.08*torso;
    if(expected==='LEFT_HAND_UP' && leftHandIntent && rightHandIntent) {
      hint={code:'tutorial-one-hand-left',text:'Keep your right hand down and raise your left hand.',highlightLandmarks:[P.leftElbow,P.leftWrist,P.rightWrist]};
    } else if(expected==='RIGHT_HAND_UP' && leftHandIntent && rightHandIntent) {
      hint={code:'tutorial-one-hand-right',text:'Keep your left hand down and raise your right hand.',highlightLandmarks:[P.leftWrist,P.rightElbow,P.rightWrist]};
    } else if(expected==='LEFT_HAND_UP' && rightHandIntent && !leftHandIntent) {
      hint={code:'tutorial-left-hand',text:'Raise your left hand above your head.',highlightLandmarks:[P.leftElbow,P.leftWrist]};
    } else if(expected==='RIGHT_HAND_UP' && leftHandIntent && !rightHandIntent) {
      hint={code:'tutorial-right-hand',text:'Raise your right hand above your head.',highlightLandmarks:[P.rightElbow,P.rightWrist]};
    } else if(expected==='LEFT_HAND_UP' && leftHandIntent && !leftUp) {
      hint={code:'tutorial-left-height',text:'Move your left hand above your head.',highlightLandmarks:[P.leftElbow,P.leftWrist]};
    } else if(expected==='RIGHT_HAND_UP' && rightHandIntent && !rightUp) {
      hint={code:'tutorial-right-height',text:'Move your right hand above your head.',highlightLandmarks:[P.rightElbow,P.rightWrist]};
    } else if((expected==='HANDS_UP_JUMP' || !expected) && jumpIntent && !(leftUp&&rightUp)) {
      if(leftUp&&!rightUp) hint={code:'right-hand',text:'Raise your right hand above your head',highlightLandmarks:[12,14,16]};
      else if(rightUp&&!leftUp) hint={code:'left-hand',text:'Raise your left hand above your head',highlightLandmarks:[11,13,15]};
      else hint={code:'both-hands',text:'Move both hands above your head',highlightLandmarks:[13,14,15,16]};
    } else if(expected==='LEAN_LEFT' && lean>C.leanPartial) {
      hint={code:'wrong-right',text:'Lean left instead',highlightLandmarks:[11,12,23,24]};
    } else if(expected==='LEAN_RIGHT' && lean< -C.leanPartial) {
      hint={code:'wrong-left',text:'Lean right instead',highlightLandmarks:[11,12,23,24]};
    } else if(expected!=='HANDS_UP_JUMP' && Math.abs(lean)>=C.leanPartial && Math.abs(lean)<C.leanActivate && this.lane===0) {
      hint={code:lean<0?'lean-left':'lean-right',text:lean<0?'Lean further left':'Lean further right',highlightLandmarks:[11,12,23,24]};
    }
    if(!hint) {this.candidate='';this.published=null;}
    else {
      if(hint.code!==this.candidate) {this.candidate=hint.code;this.candidateSince=now;this.published=null;}
      if(now-this.candidateSince>=C.correctionDelayMs && (this.published?.code===hint.code || now-this.lastHintAt>=C.correctionRepeatMs)) {
        if(this.published?.code!==hint.code) this.lastHintAt=now;
        this.published=hint;
      }
    }
    output.correction=this.published;
    return output;
  }
}
