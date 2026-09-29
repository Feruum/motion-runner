import type { RaceObstacle } from './race-types';

const obstacles: readonly RaceObstacle[] = Object.freeze([
  Object.freeze({ id: 'gate-60', kind: 'gate', z: 60, width: 4, depth: 1, periodMs: 5000, amplitude: 3, phase: 0 }),
  Object.freeze({ id: 'gate-110', kind: 'gate', z: 110, width: 4, depth: 1, periodMs: 5000, amplitude: 3, phase: 0 }),
  Object.freeze({ id: 'sweeper-200', kind: 'sweeper', z: 200, width: 10, depth: 0.6, periodMs: 4500, amplitude: 0.9, phase: 0 }),
  Object.freeze({ id: 'sweeper-260', kind: 'sweeper', z: 260, width: 10, depth: 0.6, periodMs: 4500, amplitude: 0.9, phase: Math.PI / 3 }),
  Object.freeze({ id: 'gap-360', kind: 'gap', z: 360, width: 12, depth: 3, periodMs: 0, amplitude: 0, phase: 0 }),
  Object.freeze({ id: 'gap-420', kind: 'gap', z: 420, width: 12, depth: 3, periodMs: 0, amplitude: 0, phase: 0 }),
]);

export const RACE_TRACK = Object.freeze({
  length: 480,
  width: 12,
  speed: 8,
  timeLimitMs: 120_000,
  checkpoints: Object.freeze([0, 160, 320]),
  obstacles,
});

/**
 * Returns the obstacle's animated offset at a given race time. For gates this
 * is the opening's lateral x position in metres. For sweepers it is the beam's
 * angle in radians around the track's horizontal plane. Gaps return zero.
 */
export function obstacleOffset(obstacle: RaceObstacle, elapsedMs: number): number {
  if (obstacle.kind === 'gap' || !Number.isFinite(elapsedMs) || obstacle.periodMs <= 0) return 0;
  const phase = (elapsedMs / obstacle.periodMs) * Math.PI * 2 + obstacle.phase;
  return obstacle.amplitude * Math.sin(phase);
}
