import { describe, expect, it } from 'vitest';
import { poseResultToSample } from '../src/vision/pose-sample';

function pose(centerX: number, leftHipX = centerX, rightHipX = leftHipX, shoulderX = centerX) {
  const landmarks = Array.from({ length: 33 }, (_, index) => ({
    x: index === 23 ? leftHipX : index === 24 ? rightHipX : index === 11 || index === 12 ? shoulderX : centerX,
    y: index,
    z: -index,
    visibility: 0.9,
  }));
  return landmarks;
}

describe('poseResultToSample', () => {
  it('keeps the primary player and orders detected people by hip center from left to right', () => {
    const rightPlayer = pose(0.8, 0.82, 0.74);
    const leftPlayer = pose(0.2, 0.23, 0.13);
    const sample = poseResultToSample({
      timestampMs: 123,
      frameWidth: 640,
      frameHeight: 480,
      landmarks: [rightPlayer, leftPlayer],
    });

    expect(sample.players).toHaveLength(2);
    expect(sample.players?.[0]?.[23]?.x).toBe(0.23);
    expect(sample.players?.[0]?.[24]?.x).toBe(0.13);
    expect(sample.players?.[1]?.[23]?.x).toBe(0.82);
    expect(sample.players?.[1]?.[24]?.x).toBe(0.74);
    expect(sample.landmarks).toEqual(sample.players?.[0]);
    expect(sample).toMatchObject({ timestampMs: 123, frameWidth: 640, frameHeight: 480 });
  });

  it('uses shoulder center as a stable fallback when hip landmarks are non-finite', () => {
    const rightPlayer = pose(0.7, Number.NaN, Number.NaN, 0.74);
    const leftPlayer = pose(0.3, Number.NaN, Number.NaN, 0.26);
    const sample = poseResultToSample({
      timestampMs: 1,
      frameWidth: 320,
      frameHeight: 240,
      landmarks: [rightPlayer, leftPlayer],
    });

    expect(sample.players?.[0]?.[11]?.x).toBe(0.26);
    expect(sample.landmarks).toEqual(sample.players?.[0]);
  });

  it('preserves the existing primary landmarks when only one body is visible', () => {
    const onlyPlayer = pose(0.63, 0.61);
    const sample = poseResultToSample({
      timestampMs: 9,
      frameWidth: 640,
      frameHeight: 480,
      landmarks: [onlyPlayer],
    });

    expect(sample.players).toHaveLength(1);
    expect(sample.landmarks).toEqual(sample.players?.[0]);
    expect(sample.landmarks[23]?.x).toBe(0.61);
  });

  it('returns empty primary and player arrays when no body is detected', () => {
    const sample = poseResultToSample({
      timestampMs: 9,
      frameWidth: 640,
      frameHeight: 480,
      landmarks: [],
    });

    expect(sample.players).toEqual([]);
    expect(sample.landmarks).toEqual([]);
  });
});
