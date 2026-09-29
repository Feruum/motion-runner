import type { Landmark, PoseSample } from '@motion-runner/game';
import { DANCE_CUES, type DanceFeature } from '../../../../packages/game/src/core/dance';

type FeatureKey = DanceFeature['id'];

const defaults: Record<FeatureKey, number> = {
  leftWristOut: 0.36,
  leftWristY: 0.82,
  leftElbowAngleDeg: 180,
  rightWristOut: 0.36,
  rightWristY: 0.82,
  rightElbowAngleDeg: 180,
  torsoLeanDeg: 0,
  leftFootOut: 0.27,
  rightFootOut: 0.27,
};

/** A full-confidence camera sample that matches one authored Dance cue. */
export function dancePose(cueIndex: number, centerX = 0.5): PoseSample {
  const cue = DANCE_CUES[cueIndex];
  if (!cue) throw new RangeError(`No Dance cue at index ${cueIndex}`);

  const values = { ...defaults };
  for (const feature of cue.features) values[feature.id] = feature.target;

  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({
    x: centerX,
    y: 0.5,
    z: 0,
    visibility: 0.99,
    presence: 0.99,
  }));
  const set = (index: number, x: number, y: number) => {
    landmarks[index] = { x, y, z: 0, visibility: 0.99, presence: 0.99 };
  };

  const torsoLength = 0.33;
  const hipY = 0.68;
  const lean = values.torsoLeanDeg * Math.PI / 180;
  const shoulderCenterX = centerX + Math.sin(lean) * torsoLength;
  const shoulderCenterY = hipY - Math.cos(lean) * torsoLength;
  const hipCenterX = centerX;
  set(11, shoulderCenterX + 0.12, shoulderCenterY);
  set(12, shoulderCenterX - 0.12, shoulderCenterY);
  set(23, hipCenterX + 0.09, hipY);
  set(24, hipCenterX - 0.09, hipY);

  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? 1 : -1;
    const shoulderIndex = side === 'left' ? 11 : 12;
    const elbowIndex = side === 'left' ? 13 : 14;
    const wristIndex = side === 'left' ? 15 : 16;
    const wristX = hipCenterX + sign * values[`${side}WristOut`] * torsoLength;
    const wristY = shoulderCenterY + values[`${side}WristY`] * torsoLength;
    const shoulder = landmarks[shoulderIndex]!;
    set(wristIndex, wristX, wristY);
    set(elbowIndex, (shoulder.x + wristX) / 2, (shoulder.y + wristY) / 2);

    const hipIndex = side === 'left' ? 23 : 24;
    const kneeIndex = side === 'left' ? 25 : 26;
    const ankleIndex = side === 'left' ? 27 : 28;
    const ankleX = hipCenterX + sign * values[`${side}FootOut`] * torsoLength;
    set(kneeIndex, (landmarks[hipIndex]!.x + ankleX) / 2, 0.82);
    set(ankleIndex, ankleX, 0.96);
  }

  return { timestampMs: 0, frameWidth: 640, frameHeight: 480, landmarks };
}

export function danceDuoSample(
  cueIndex: number,
  options: { reversed?: boolean; wrongPlayerOneCue?: number; missingPlayer?: 1 | 2 } = {},
): PoseSample {
  const first = dancePose(options.wrongPlayerOneCue ?? cueIndex, 0.34).landmarks;
  const second = dancePose(cueIndex, 0.66).landmarks;
  const logicalPlayers: Array<Landmark[] | undefined> = [first, second];
  if (options.missingPlayer) logicalPlayers[options.missingPlayer - 1] = undefined;
  const visible = logicalPlayers.filter((player): player is Landmark[] => !!player);
  const players = options.reversed ? [...visible].reverse() : visible;
  return {
    timestampMs: 0,
    frameWidth: 640,
    frameHeight: 480,
    landmarks: players[0] ?? [],
    players,
  };
}

