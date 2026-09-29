import { describe, expect, it } from 'vitest';
import { GestureEngine } from '@motion-runner/game';
import { pose } from './fixtures';
import type { TutorialGesture } from '@motion-runner/game';

function setup() { const engine = new GestureEngine(); for (let t=0;t<=2200;t+=50) engine.update(pose(t)); return engine; }
function hold(engine: GestureEngine, start: number, lean=0, arms: Parameters<typeof pose>[2]='down', expected?: TutorialGesture, duration=800) {
  let result = engine.update(pose(start, lean, arms), expected);
  const results = [result];
  for (let t=start+50;t<=start+duration;t+=50) { result=engine.update(pose(t,lean,arms),expected); results.push(result); }
  return { result, results };
}
describe('Gesture Engine', () => {
  it('requires two seconds of neutral calibration and stays silent at rest', () => {
    const e=new GestureEngine(); expect(e.update(pose(0)).calibrated).toBe(false);
    let r=e.update(pose(50)); for(let t=100;t<=2100;t+=50) r=e.update(pose(t));
    expect(r.calibrated).toBe(true); expect(r.lane).toBe(0); expect(r.correction).toBe(null);
  });
  it('does not calibrate with raised hands', () => { const e=new GestureEngine(); expect(hold(e,0,0,'up',undefined,3000).result.calibrated).toBe(false); });
  it('explains raised hands during calibration and clears the hint when they lower', () => {
    const e = new GestureEngine();
    const blocked = hold(e, 0, 0, 'up').result;
    expect(blocked.correction?.text).toBe('Lower both hands below your shoulders to begin calibration.');
    expect(blocked.correction?.highlightLandmarks).toEqual([15, 16]);
    const ready = hold(e, 850, 0, 'down', undefined, 3000).result;
    expect(ready.calibrated).toBe(true);
    expect(ready.correction).toBe(null);
  });
  it('explains a leaning posture during calibration', () => {
    const e = new GestureEngine();
    expect(hold(e, 0, .4).result.correction?.text).toBe('Stand upright with your shoulders above your hips.');
  });
  it('maps real-world leans into the mirrored left and right lanes', () => {
    const e=setup(); expect(hold(e,2250,-.35).result.lane).toBe(-1);
    expect(hold(e,3100,.35).result.lane).toBe(1);
    expect(hold(e,4000,0).result.lane).toBe(0);
  });
  it('uses hysteresis to suppress threshold jitter', () => {
    const e=setup(); hold(e,2250,.35); expect(hold(e,3100,.17).result.lane).toBe(1);
    expect(hold(e,4000,.04).result.lane).toBe(0);
  });
  it('diagnoses a partial lean only after a sustained attempt', () => {
    const e=setup(); const {results,result}=hold(e,2250,-.15,'down','LEAN_LEFT',1200);
    expect(results[0].correction).toBe(null); expect(result.correction?.text).toBe('Lean further left');
    expect(hold(e,3500,0,'down','LEAN_LEFT').result.correction).toBe(null);
  });
  it('identifies the right hand and prevents a partial jump', () => {
    const e=setup(); const {results,result}=hold(e,2250,0,'left','HANDS_UP_JUMP',1200);
    expect(results.some(r=>r.jumpTriggered)).toBe(false);
    expect(result.correction?.text).toBe('Raise your right hand above your head');
    expect(result.correction?.highlightLandmarks).toContain(16);
  });
  it('gives hand-specific corrections during the Six-Seven tutorial', () => {
    const e=setup();
    expect(hold(e,2250,0,'right','LEFT_HAND_UP',800).result.correction?.text).toBe('Raise your left hand above your head.');
    const both=setup();
    expect(hold(both,2250,0,'up','LEFT_HAND_UP',800).result.correction?.text).toBe('Keep your right hand down and raise your left hand.');
  });
  it('allows lean and jump together and re-arms only with both hands down', () => {
    const e=setup(); const first=hold(e,2250,-.4,'up',undefined,1200);
    expect(first.result.lane).toBe(-1); expect(first.results.filter(r=>r.jumpTriggered)).toHaveLength(1);
    expect(hold(e,3500,0,'left').results.some(r=>r.jumpTriggered)).toBe(false);
    expect(hold(e,4400,0,'up').results.some(r=>r.jumpTriggered)).toBe(false);
    hold(e,5300,0,'down'); expect(hold(e,6200,0,'up').results.filter(r=>r.jumpTriggered)).toHaveLength(1);
  });
  it('rejects missing and low confidence landmarks immediately', () => {
    const e=setup(); const p=pose(2300); p.landmarks[23].visibility=.2;
    expect(e.update(p).trackingValid).toBe(false);
    expect(e.update({...pose(2400),landmarks:[]}).trackingValid).toBe(false);
  });
  it('does not repeat a jump after tracking loss until hands lower', () => {
    const e=setup(); hold(e,2250,0,'up'); e.update({...pose(3100),landmarks:[]});
    expect(hold(e,3200,0,'up').results.some(r=>r.jumpTriggered)).toBe(false);
  });
  it('keeps steering when a wrist leaves the top of the frame and explains the missing hand', () => {
    const e=setup(); hold(e,2250,-.35);
    const p=pose(3100,-.35,'up'); p.landmarks[15].y=-.01;
    const r=e.update(p);
    expect(r.trackingValid).toBe(true);
    expect(r.lane).toBe(-1);
    expect(r.handsUp).toBe(false);
    expect(r.jumpTriggered).toBe(false);
    expect(r.correction?.code).toBe('tracking-hands');
    expect(r.correction?.text).toContain('inside the camera frame');
  });
  it('does not calibrate or infer a jump from low confidence wrists', () => {
    const e=new GestureEngine(); let r;
    for(let t=0;t<=3000;t+=50){const p=pose(t);p.landmarks[15].visibility=.1;r=e.update(p);}
    expect(r!.trackingValid).toBe(true);
    expect(r!.calibrated).toBe(false);
    expect(r!.correction?.code).toBe('tracking-hands');
  });
  it('recovers finite hand coordinates without a phantom jump after wrist clipping', () => {
    const e=setup(); const p=pose(2250,0,'up'); p.landmarks[15].x=NaN;
    expect(e.update(p).trackingValid).toBe(true);
    expect(hold(e,2300,0,'up').results.some(r=>r.jumpTriggered)).toBe(false);
    hold(e,3200);
    expect(hold(e,4100,0,'up').results.filter(r=>r.jumpTriggered)).toHaveLength(1);
  });
  it('preserves an established lane through a single missing body sample', () => {
    const e=setup();hold(e,2250,-.35);
    e.update({...pose(3100),landmarks:[]});
    expect(e.update(pose(3150,-.35)).lane).toBe(-1);
  });
  it('explains which part of the body is missing', () => {
    const e=setup();const p=pose(2250);p.landmarks[23].visibility=.1;
    expect(e.update(p).correction?.text).toContain('hips');
  });
});
