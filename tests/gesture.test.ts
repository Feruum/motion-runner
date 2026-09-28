import { describe, expect, it } from 'vitest';
import { GestureEngine } from '../src/core/gesture';
import { pose } from './fixtures';
import type { GestureId } from '../src/core/types';

function setup() { const engine = new GestureEngine(); for (let t=0;t<=2200;t+=50) engine.update(pose(t)); return engine; }
function hold(engine: GestureEngine, start: number, lean=0, arms: Parameters<typeof pose>[2]='down', expected?: GestureId, duration=800) {
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
});
