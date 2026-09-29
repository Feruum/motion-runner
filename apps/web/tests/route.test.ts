import { describe, expect, it } from 'vitest';
import { sampleRoute, wrapSceneryZ } from '../src/presentation/route';

describe('landscape route', () => {
  it('visits the valley, forest and gateway for both round lengths', () => {
    for (const duration of [20000, 60000]) {
      expect(sampleRoute(0, duration).chapter).toBe(0);
      expect(sampleRoute(duration * .5, duration).chapter).toBe(1);
      expect(sampleRoute(duration * .9, duration).chapter).toBe(2);
      expect(sampleRoute(duration, duration).finish).toBe(1);
    }
  });
  it('crossfades at biome boundaries and resets on replay', () => {
    const transition = sampleRoute(60000 * (1 / 3 - .02), 60000);
    expect(transition.from).toBe(0);
    expect(transition.to).toBe(1);
    expect(transition.blend).toBeCloseTo(.5);
    expect(sampleRoute(0, 60000)).toEqual(sampleRoute(-100, 60000));
    expect(sampleRoute(60000, 60000)).toEqual(sampleRoute(70000, 60000));
  });
  it('moves scenery toward the camera at the same rate as the course', () => {
    expect(wrapSceneryZ(-25, 5)).toBe(-20);
    expect(wrapSceneryZ(-25, 10)).toBe(-15);
  });
  it('recycles behind the camera and keeps positions within the visible ring', () => {
    expect(wrapSceneryZ(11, 2)).toBe(-99);
    for (let travel = 0; travel < 10000; travel += 17) {
      const z = wrapSceneryZ(-70, travel);
      expect(z).toBeGreaterThanOrEqual(-100);
      expect(z).toBeLessThan(12);
    }
  });
});
