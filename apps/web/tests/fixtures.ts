import type { GestureAnalysis, Landmark, PoseSample } from '@motion-runner/game';
export function pose(timestampMs: number, lean = 0, arms: 'down' | 'up' | 'left' | 'right' | 'partial' = 'down'): PoseSample {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: .99, presence: .99 }));
  const set = (i: number, x: number, y: number) => { landmarks[i] = { x, y, z: 0, visibility: .99, presence: .99 }; };
  const dx = -lean * .24;
  set(0, .5 + dx, .23); set(2, .52 + dx, .21); set(5, .48 + dx, .21);
  set(11, .62 + dx, .4); set(12, .38 + dx, .4);
  set(23, .59, .76); set(24, .41, .76);
  set(13, .64 + dx, .52); set(14, .36 + dx, .52);
  set(15, .64 + dx, arms === 'up' || arms === 'left' ? .09 : arms === 'partial' ? .3 : .65);
  set(16, .36 + dx, arms === 'up' || arms === 'right' ? .09 : arms === 'partial' || arms === 'left' ? .3 : .65);
  return { timestampMs, landmarks, frameWidth: 640, frameHeight: 480 };
}
export function analysis(timestampMs: number, overrides: Partial<GestureAnalysis> = {}): GestureAnalysis {
  return { timestampMs, lane: 0, lean: 0, jumpTriggered: false, handsUp: false, handsDown: true, trackingValid: true, calibrated: true, calibrationProgress: 1, correction: null, landmarks: pose(timestampMs).landmarks, ...overrides };
}
