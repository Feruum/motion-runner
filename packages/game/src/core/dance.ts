import { CONFIG as C } from './config';
import type { Landmark } from './types';

export type DanceFeatureGroup = 'arms' | 'torso' | 'legs';
export type DanceFeatureUnit = 'degrees' | 'torso';
export type DanceFeatureId =
  | 'leftWristOut' | 'leftWristY' | 'leftElbowAngleDeg'
  | 'rightWristOut' | 'rightWristY' | 'rightElbowAngleDeg'
  | 'torsoLeanDeg'
  | 'leftFootOut' | 'rightFootOut';

export interface DanceFeature {
  id: DanceFeatureId;
  group: DanceFeatureGroup;
  target: number;
  /** Degrees for angles, or a fraction of shoulder-to-hip torso length for positions. */
  tolerance: number;
  unit: DanceFeatureUnit;
}

export interface DanceCue {
  id: string;
  name: string;
  /** Start of this authored phrase in active round time. The runtime advances cues in order. */
  atMs: number;
  features: readonly DanceFeature[];
}

export const DANCE_DURATION_MS = 60_000;
export const DANCE_CUE_INTERVAL_MS = 7_500;
export const DANCE_HOLD_MS = 500;
export const DANCE_CUE_SCORE = 100;
export const DANCE_ANGLE_TOLERANCE_DEG = 30;
export const DANCE_POSITION_TOLERANCE_TORSO = 0.35;

function feature(id: DanceFeatureId, target: number): DanceFeature {
  const unit: DanceFeatureUnit = id.endsWith('Deg') ? 'degrees' : 'torso';
  const group: DanceFeatureGroup = id === 'torsoLeanDeg' ? 'torso'
    : id.endsWith('FootOut') ? 'legs'
      : 'arms';
  return {
    id,
    group,
    target,
    unit,
    tolerance: unit === 'degrees' ? DANCE_ANGLE_TOLERANCE_DEG : DANCE_POSITION_TOLERANCE_TORSO,
  };
}

const BASE_ARMS = [
  feature('leftWristOut', 0.36), feature('leftWristY', 0.82),
  feature('rightWristOut', 0.36), feature('rightWristY', 0.82),
];
const BASE_TORSO = feature('torsoLeanDeg', 0);
const BASE_LEGS = [feature('leftFootOut', 0.27), feature('rightFootOut', 0.27)];

function cue(
  index: number,
  id: string,
  name: string,
  armOverrides: Partial<Record<DanceFeatureId, number>> = {},
  torsoLeanDeg = 0,
  legOverrides: Partial<Record<DanceFeatureId, number>> = {},
): DanceCue {
  const features = [
    ...BASE_ARMS.map(item => feature(item.id, armOverrides[item.id] ?? item.target)),
    feature('leftElbowAngleDeg', armOverrides.leftElbowAngleDeg ?? 180),
    feature('rightElbowAngleDeg', armOverrides.rightElbowAngleDeg ?? 180),
    feature(BASE_TORSO.id, torsoLeanDeg),
    ...BASE_LEGS.map(item => feature(item.id, legOverrides[item.id] ?? item.target)),
  ];
  return { id, name, atMs: index * DANCE_CUE_INTERVAL_MS, features };
}

/** Eight coach-authored full-body phrases, one every 7.5 seconds. */
export const DANCE_CUES: readonly DanceCue[] = [
  cue(0, 'left-reach', 'Reach left', { leftWristOut: 0.92, leftWristY: 0, leftElbowAngleDeg: 180 }, 0, { leftFootOut: 0.34 }),
  cue(1, 'right-reach', 'Reach right', { rightWristOut: 0.92, rightWristY: 0, rightElbowAngleDeg: 180 }, 0, { rightFootOut: 0.34 }),
  cue(2, 'left-hand-up', 'Raise your left hand', { leftWristOut: 0.36, leftWristY: -0.82, leftElbowAngleDeg: 180 }),
  cue(3, 'right-hand-up', 'Raise your right hand', { rightWristOut: 0.36, rightWristY: -0.82, rightElbowAngleDeg: 180 }),
  cue(4, 'both-hands-up', 'Reach both hands overhead', { leftWristY: -0.82, rightWristY: -0.82 }),
  cue(5, 'lean-left', 'Lean left', {}, 20, { leftFootOut: 0.34 }),
  cue(6, 'step-left', 'Step left', {}, 5, { leftFootOut: 0.62 }),
  cue(7, 'step-right-hand-up', 'Step right and raise your right hand', { rightWristOut: 0.36, rightWristY: -0.55 }, -5, { rightFootOut: 0.62 }),
];

export interface DanceSoloOptions {
  /** Continuous active hold needed to confirm a cue. */
  holdMs?: number;
  /** Minimum visibility and optional presence required for every feature landmark. */
  confidenceThreshold?: number;
  /** A larger sample gap clears an unconfirmed hold and freezes active time; defaults to 300 ms. */
  maxSampleGapMs?: number;
  /** Overrides the authored default tolerance for all angle features. */
  angleToleranceDegrees?: number;
  /** Overrides the authored default tolerance for torso-normalized positions. */
  positionToleranceTorso?: number;
  /** Optional group weights. Weights are normalized over groups present in a cue. */
  groupWeights?: Partial<Record<DanceFeatureGroup, number>>;
}

export interface DanceSoloResult {
  elapsedMs: number;
  remainingMs: number;
  currentCueIndex: number | null;
  currentCueId: string | null;
  currentCueName: string;
  completedCueCount: number;
  /** Number of authored cue attempts that expired without a successful hold. */
  missedCueCount: number;
  score: number;
  /** True for the single update where this cue resolves. */
  success: boolean;
  cueResolved: boolean;
  cueScore: number | null;
  poseSimilarity: number | null;
  timingSimilarity: number | null;
  feedback: string;
  highlightedLandmarkIndexes: number[];
  trackingRecovery: boolean;
  paused: boolean;
  challengeCompleted: boolean;
}

interface BodyScale {
  shoulderCenterX: number;
  shoulderCenterY: number;
  hipCenterX: number;
  hipCenterY: number;
  torsoLength: number;
  shoulderWidth: number;
  anatomicalLeftDirection: 1 | -1;
}

interface FeatureAssessment {
  feature: DanceFeature;
  actual: number;
  normalizedError: number;
  similarity: number;
}

const FEATURE_LANDMARKS: Record<DanceFeatureId, readonly number[]> = {
  leftWristOut: [11, 12, 15, 23, 24],
  leftWristY: [11, 12, 15],
  leftElbowAngleDeg: [11, 13, 15],
  rightWristOut: [11, 12, 16, 23, 24],
  rightWristY: [11, 12, 16],
  rightElbowAngleDeg: [12, 14, 16],
  torsoLeanDeg: [11, 12, 23, 24],
  leftFootOut: [11, 12, 23, 24, 27],
  rightFootOut: [11, 12, 23, 24, 28],
};

const BASE_LANDMARKS = [11, 12, 23, 24] as const;
const DEFAULT_GROUP_WEIGHTS: Record<DanceFeatureGroup, number> = { arms: 0.5, torso: 0.25, legs: 0.25 };

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function requiredLandmarkIndexes(cue: DanceCue): number[] {
  return uniqueSorted([...BASE_LANDMARKS, ...cue.features.flatMap(item => FEATURE_LANDMARKS[item.id])]);
}

function confidenceProblems(landmarks: readonly Landmark[], indexes: readonly number[], threshold: number): number[] {
  return indexes.filter(index => {
    const point = landmarks[index];
    return !point
      || !Number.isFinite(point.x)
      || !Number.isFinite(point.y)
      || !Number.isFinite(point.visibility)
      || point.visibility < threshold
      || (point.presence !== undefined && (!Number.isFinite(point.presence) || point.presence < threshold));
  });
}

function bodyScale(landmarks: readonly Landmark[]): BodyScale | null {
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;

  const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderCenterY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipCenterX = (leftHip.x + rightHip.x) / 2;
  const hipCenterY = (leftHip.y + rightHip.y) / 2;
  const shoulderWidth = Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y);
  const torsoLength = Math.hypot(shoulderCenterX - hipCenterX, shoulderCenterY - hipCenterY);
  if (shoulderWidth < 0.06 || torsoLength < 0.1) return null;

  return {
    shoulderCenterX, shoulderCenterY, hipCenterX, hipCenterY, torsoLength, shoulderWidth,
    anatomicalLeftDirection: leftShoulder.x > rightShoulder.x ? 1 : -1,
  };
}

function elbowAngleDegrees(shoulder: Landmark, elbow: Landmark, wrist: Landmark): number {
  const shoulderX = shoulder.x - elbow.x;
  const shoulderY = shoulder.y - elbow.y;
  const wristX = wrist.x - elbow.x;
  const wristY = wrist.y - elbow.y;
  const lengths = Math.hypot(shoulderX, shoulderY) * Math.hypot(wristX, wristY);
  if (lengths === 0) return 0;
  const cosine = Math.max(-1, Math.min(1, (shoulderX * wristX + shoulderY * wristY) / lengths));
  return Math.acos(cosine) * (180 / Math.PI);
}

function sideDirection(side: 'left' | 'right', scale: BodyScale): number {
  return side === 'left' ? scale.anatomicalLeftDirection : -scale.anatomicalLeftDirection;
}

function measureFeature(featureId: DanceFeatureId, landmarks: readonly Landmark[], scale: BodyScale): number {
  switch (featureId) {
    case 'leftWristOut':
    case 'rightWristOut': {
      const side = featureId.startsWith('left') ? 'left' : 'right';
      const wrist = landmarks[side === 'left' ? 15 : 16];
      return (wrist.x - scale.hipCenterX) * sideDirection(side, scale) / scale.torsoLength;
    }
    case 'leftWristY':
      return (landmarks[15].y - scale.shoulderCenterY) / scale.torsoLength;
    case 'rightWristY':
      return (landmarks[16].y - scale.shoulderCenterY) / scale.torsoLength;
    case 'leftElbowAngleDeg':
      return elbowAngleDegrees(landmarks[11], landmarks[13], landmarks[15]);
    case 'rightElbowAngleDeg':
      return elbowAngleDegrees(landmarks[12], landmarks[14], landmarks[16]);
    case 'torsoLeanDeg':
      return Math.atan2(
        (scale.shoulderCenterX - scale.hipCenterX) * scale.anatomicalLeftDirection,
        scale.hipCenterY - scale.shoulderCenterY,
      ) * (180 / Math.PI);
    case 'leftFootOut':
      return (landmarks[27].x - scale.hipCenterX) * sideDirection('left', scale) / scale.torsoLength;
    case 'rightFootOut':
      return (landmarks[28].x - scale.hipCenterX) * sideDirection('right', scale) / scale.torsoLength;
  }
}

function featureHighlight(featureId: DanceFeatureId): number[] {
  switch (featureId) {
    case 'leftWristOut':
    case 'leftWristY':
    case 'leftElbowAngleDeg':
      return [11, 13, 15];
    case 'rightWristOut':
    case 'rightWristY':
    case 'rightElbowAngleDeg':
      return [12, 14, 16];
    case 'torsoLeanDeg':
      return [11, 12, 23, 24];
    case 'leftFootOut':
      return [23, 25, 27];
    case 'rightFootOut':
      return [24, 26, 28];
  }
}

function correctionFor(assessment: FeatureAssessment): string {
  const { feature: item, actual } = assessment;
  if (item.id === 'leftElbowAngleDeg' || item.id === 'rightElbowAngleDeg') {
    const side = item.id.startsWith('left') ? 'left' : 'right';
    return actual < item.target ? `Straighten your ${side} arm` : `Bend your ${side} arm a little`;
  }
  if (item.id === 'torsoLeanDeg') {
    if (Math.abs(item.target) < 0.001) return 'Keep your shoulders centered over your hips';
    const side = item.target > 0 ? 'left' : 'right';
    return (item.target > 0 ? actual < item.target : actual > item.target) ? `Lean further ${side}` : `Lean less to the ${side}`;
  }
  if (item.id.endsWith('WristY')) {
    const side = item.id.startsWith('left') ? 'left' : 'right';
    return actual > item.target ? `Raise your ${side} hand higher` : `Lower your ${side} hand slightly`;
  }
  if (item.id.endsWith('WristOut')) {
    const side = item.id.startsWith('left') ? 'left' : 'right';
    return actual < item.target ? `Reach your ${side} arm farther out` : `Bring your ${side} arm closer in`;
  }
  const side = item.id.startsWith('left') ? 'left' : 'right';
  return actual < item.target ? `Step your ${side} foot farther out` : `Bring your ${side} foot back in`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pure Dance Solo game logic.
 *
 * Input contract: call update with monotonically increasing wall-clock milliseconds and the
 * current MediaPipe landmark array. Landmarks use normalized image coordinates and MediaPipe's
 * anatomical indexes. Wrist and foot positions are normalized by shoulder-to-hip torso length;
 * horizontal direction is resolved from shoulder indexes 11/12 so anatomical left/right survive
 * a mirrored preview. `paused` freezes the active 60-second clock; the interval spanning either
 * pause transition is excluded and any incomplete pose hold is cleared. Invalid visibility or
 * a missing required landmark requests tracking recovery and also clears the hold. A timestamp
 * gap larger than `maxSampleGapMs` (300 ms by default) also clears the hold and excludes that
 * interval from active challenge and cue time.
 */
export class DanceSoloRuntime {
  private readonly options: Required<Pick<DanceSoloOptions, 'holdMs' | 'confidenceThreshold' | 'maxSampleGapMs'>> & DanceSoloOptions;
  private elapsedMs = 0;
  private lastTimestampMs: number | null = null;
  private pendingSinceMs: number | null = null;
  private activeCueIndex: number | null = null;
  private wasPaused = false;
  private resolved: boolean[] = DANCE_CUES.map(() => false);
  private missed: boolean[] = DANCE_CUES.map(() => false);
  private completedCueCount = 0;
  private missedCueCount = 0;
  private score = 0;

  constructor(options: DanceSoloOptions = {}) {
    this.options = {
      ...options,
      holdMs: options.holdMs ?? DANCE_HOLD_MS,
      confidenceThreshold: options.confidenceThreshold ?? C.confidence,
      maxSampleGapMs: options.maxSampleGapMs ?? 300,
    };
  }

  reset(): void {
    this.elapsedMs = 0;
    this.lastTimestampMs = null;
    this.pendingSinceMs = null;
    this.activeCueIndex = null;
    this.wasPaused = false;
    this.resolved = DANCE_CUES.map(() => false);
    this.missed = DANCE_CUES.map(() => false);
    this.completedCueCount = 0;
    this.missedCueCount = 0;
    this.score = 0;
  }

  update(timestampMs: number, landmarks: readonly Landmark[], trackingValid = true, paused = false): DanceSoloResult {
    if (!Number.isFinite(timestampMs)) return this.result(false, null, null, 'Waiting for a valid pose timestamp', [], true, this.wasPaused);
    if (this.lastTimestampMs !== null && timestampMs < this.lastTimestampMs) {
      return this.result(false, this.activeCueIndex, null, 'Waiting for an updated pose', [], false, this.wasPaused);
    }

    const priorTimestamp = this.lastTimestampMs;
    const interval = priorTimestamp === null ? 0 : Math.max(0, timestampMs - priorTimestamp);
    const frameGap = priorTimestamp !== null && interval > this.options.maxSampleGapMs;
    const cueForTracking = this.activeCueIndex === null
      ? DANCE_CUES[clamp(Math.floor(this.elapsedMs / DANCE_CUE_INTERVAL_MS), 0, DANCE_CUES.length - 1)]
      : DANCE_CUES[this.activeCueIndex];
    const requiredIndexes = requiredLandmarkIndexes(cueForTracking);
    const unavailable = !trackingValid
      ? requiredIndexes
      : confidenceProblems(landmarks, requiredIndexes, this.options.confidenceThreshold);
    const scale = unavailable.length === 0 ? bodyScale(landmarks) : null;
    const trackingLost = unavailable.length > 0 || scale === null;
    const crossedPauseBoundary = paused || this.wasPaused || trackingLost;
    if (!crossedPauseBoundary && !frameGap) this.elapsedMs += interval;
    this.lastTimestampMs = timestampMs;
    if (frameGap || trackingLost) this.pendingSinceMs = null;

    if (paused) {
      this.wasPaused = true;
      this.pendingSinceMs = null;
      return this.result(false, this.activeCueIndex, null, 'Paused', [], false, true);
    }

    if (trackingLost) {
      this.wasPaused = true;
      const cueIndex = this.elapsedMs >= DANCE_DURATION_MS
        ? null
        : clamp(Math.floor(this.elapsedMs / DANCE_CUE_INTERVAL_MS), 0, DANCE_CUES.length - 1);
      const highlighted = unavailable.length > 0 ? unavailable : [...BASE_LANDMARKS];
      return this.result(
        false, cueIndex, null,
        'Step back and keep your full body visible in the frame', highlighted, true, false,
      );
    }

    if (this.wasPaused) {
      this.wasPaused = false;
      this.pendingSinceMs = null;
    }

    if (this.elapsedMs >= DANCE_DURATION_MS) {
      this.pendingSinceMs = null;
      if (this.activeCueIndex !== null) this.markMissed(this.activeCueIndex);
      return this.result(false, null, null, 'Dance complete', [], false, false);
    }

    const cueIndex = clamp(Math.floor(this.elapsedMs / DANCE_CUE_INTERVAL_MS), 0, DANCE_CUES.length - 1);
    const currentCue = DANCE_CUES[cueIndex];
    if (this.activeCueIndex !== cueIndex) {
      if (this.activeCueIndex !== null) this.markMissed(this.activeCueIndex);
      this.activeCueIndex = cueIndex;
      this.pendingSinceMs = null;
    }

    if (this.resolved[cueIndex]) {
      this.pendingSinceMs = null;
      return this.result(false, cueIndex, null, 'Cue complete — get ready for the next move', [], false, false);
    }

    // The cue landmarks and body scale were validated before advancing active time.
    if (!scale) {
      return this.result(false, cueIndex, null, 'Step back and keep your shoulders and hips visible in the frame', [...BASE_LANDMARKS], true, false);
    }

    const assessments = currentCue.features.map(item => {
      const actual = measureFeature(item.id, landmarks, scale);
      const tolerance = this.toleranceFor(item);
      const error = Math.abs(actual - item.target);
      const normalizedError = tolerance > 0 ? error / tolerance : error === 0 ? 0 : Number.POSITIVE_INFINITY;
      return {
        feature: item,
        actual,
        normalizedError,
        similarity: tolerance > 0 ? clamp(1 - error / tolerance, 0, 1) : error === 0 ? 1 : 0,
      } satisfies FeatureAssessment;
    });
    const deviations = assessments.filter(assessment => assessment.normalizedError > 1)
      .sort((left, right) => right.normalizedError - left.normalizedError);
    const groupSimilarity = this.groupSimilarities(assessments);
    const activeGroups = (['arms', 'torso', 'legs'] as DanceFeatureGroup[]).filter(group =>
      currentCue.features.some(item => item.group === group));
    const totalWeight = activeGroups.reduce((sum, group) => sum + Math.max(0, this.weight(group)), 0) || 1;
    const poseSimilarity = activeGroups.reduce((sum, group) =>
      sum + groupSimilarity[group] * Math.max(0, this.weight(group)) / totalWeight, 0);

    if (deviations.length > 0) {
      this.pendingSinceMs = null;
      const strongest = deviations[0];
      return this.result(false, cueIndex, poseSimilarity, correctionFor(strongest), featureHighlight(strongest.feature.id), false, false, null);
    }

    if (this.pendingSinceMs === null) this.pendingSinceMs = this.elapsedMs;
    if (this.elapsedMs - this.pendingSinceMs < this.options.holdMs) {
      return this.result(false, cueIndex, poseSimilarity, 'Hold that pose', [], false, false, null);
    }

    const timingSimilarity = clamp(1 - Math.abs(this.pendingSinceMs - currentCue.atMs) / 250, 0, 1);
    const cueScore = Math.round(DANCE_CUE_SCORE * (0.7 * poseSimilarity + 0.3 * timingSimilarity));
    this.resolved[cueIndex] = true;
    this.completedCueCount += 1;
    this.score += cueScore;
    this.pendingSinceMs = null;
    return this.result(true, cueIndex, poseSimilarity, 'Great work — phrase complete', [], false, false, cueScore, timingSimilarity);
  }

  private toleranceFor(item: DanceFeature): number {
    if (item.unit === 'degrees') return this.options.angleToleranceDegrees ?? item.tolerance;
    return this.options.positionToleranceTorso ?? item.tolerance;
  }

  private markMissed(cueIndex: number): void {
    if (this.resolved[cueIndex] || this.missed[cueIndex]) return;
    this.missed[cueIndex] = true;
    this.missedCueCount += 1;
  }

  private weight(group: DanceFeatureGroup): number {
    const configured = this.options.groupWeights?.[group];
    return configured !== undefined && Number.isFinite(configured)
      ? Math.max(0, configured)
      : DEFAULT_GROUP_WEIGHTS[group];
  }

  private groupSimilarities(assessments: readonly FeatureAssessment[]): Record<DanceFeatureGroup, number> {
    const groups: DanceFeatureGroup[] = ['arms', 'torso', 'legs'];
    const similarities = {} as Record<DanceFeatureGroup, number>;
    for (const group of groups) {
      const items = assessments.filter(item => item.feature.group === group);
      const average = items.length > 0 ? items.reduce((sum, item) => sum + item.similarity, 0) / items.length : 0;
      similarities[group] = average;
    }
    return similarities;
  }

  private result(
    success: boolean,
    cueIndex: number | null,
    poseSimilarity: number | null,
    feedback: string,
    highlightedLandmarkIndexes: number[],
    trackingRecovery: boolean,
    paused: boolean,
    cueScore: number | null = null,
    timingSimilarity: number | null = null,
  ): DanceSoloResult {
    const cue = cueIndex === null ? null : DANCE_CUES[cueIndex];
    return {
      elapsedMs: this.elapsedMs,
      remainingMs: Math.max(0, DANCE_DURATION_MS - this.elapsedMs),
      currentCueIndex: cueIndex,
      currentCueId: cue?.id ?? null,
      currentCueName: cue?.name ?? (this.elapsedMs >= DANCE_DURATION_MS ? 'Complete' : 'Dance Solo'),
      completedCueCount: this.completedCueCount,
      missedCueCount: this.missedCueCount,
      score: this.score,
      success,
      cueResolved: cueIndex === null ? false : this.resolved[cueIndex],
      cueScore,
      poseSimilarity,
      timingSimilarity,
      feedback,
      highlightedLandmarkIndexes: uniqueSorted(highlightedLandmarkIndexes),
      trackingRecovery,
      paused,
      challengeCompleted: this.elapsedMs >= DANCE_DURATION_MS,
    };
  }
}
