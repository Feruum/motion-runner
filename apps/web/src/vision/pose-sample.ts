import type { Landmark, PoseSample } from '@motion-runner/game';

export interface PoseLandmarkerPoint {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
}

export interface PoseLandmarkerSampleInput {
  timestampMs: number;
  frameWidth: number;
  frameHeight: number;
  landmarks: readonly (readonly PoseLandmarkerPoint[])[];
}

function centerXAt(landmarks: readonly PoseLandmarkerPoint[], first: number, second: number): number | null {
  const xs = [landmarks[first]?.x, landmarks[second]?.x].filter((value): value is number =>
    typeof value === 'number' && Number.isFinite(value),
  );
  if (xs.length === 0) return null;
  return xs.reduce((sum, value) => sum + value, 0) / xs.length;
}

function torsoCenterX(landmarks: readonly PoseLandmarkerPoint[]): number | null {
  return centerXAt(landmarks, 23, 24) ?? centerXAt(landmarks, 11, 12);
}

export function poseResultToSample(input: PoseLandmarkerSampleInput): PoseSample {
  const players: Landmark[][] = input.landmarks.map(pose => pose.map(point => ({
    x: point.x,
    y: point.y,
    z: point.z,
    visibility: point.visibility ?? 0,
    presence: 1,
  })));

  const orderedPlayers = players
    .map((landmarks, detectorIndex) => ({ landmarks, detectorIndex, centerX: torsoCenterX(landmarks) }))
    .sort((a, b) => {
      if (a.centerX === null && b.centerX === null) return a.detectorIndex - b.detectorIndex;
      if (a.centerX === null) return 1;
      if (b.centerX === null) return -1;
      return a.centerX - b.centerX || a.detectorIndex - b.detectorIndex;
    })
    .map(player => player.landmarks);

  return {
    timestampMs: input.timestampMs,
    frameWidth: input.frameWidth,
    frameHeight: input.frameHeight,
    landmarks: orderedPlayers[0] ?? [],
    players: orderedPlayers,
  };
}
