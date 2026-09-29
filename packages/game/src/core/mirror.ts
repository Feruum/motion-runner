import { CONFIG as C } from './config';
import type { GestureAnalysis, Landmark } from './types';

export type MirrorSide = 'left' | 'right';
export type MirrorAction = 'LEFT' | 'RIGHT' | 'LEFT_HAND_UP' | 'RIGHT_HAND_UP' | 'BOTH_HANDS_UP' | 'ARMS_OUT';
export type MirrorAssignmentId =
  | MirrorAction
  | 'LEFT_THEN_RIGHT'
  | 'LEFT_HAND_UP_THEN_RIGHT_HAND_UP';

export type MirrorPoseRequirement =
  | { kind: 'torso-lean'; direction: MirrorSide; activateAt: number; releaseAt: number }
  | { kind: 'wrist-position'; side: MirrorSide; targetX: number; targetY: number; toleranceTorso: number }
  | { kind: 'elbow-angle'; side: MirrorSide; targetDegrees: number; toleranceDegrees: number };

export interface MirrorPoseElement {
  action: MirrorAction;
  name: string;
  requirements: readonly MirrorPoseRequirement[];
}

export interface MirrorAssignment {
  id: MirrorAssignmentId;
  name: string;
  kind: 'single' | 'combo';
  demoMs: number;
  attemptMs: number;
  resultMs: number;
  elements: readonly MirrorPoseElement[];
}

export const MIRROR_CHALLENGE_DURATION_MS = 60_000;
export const MIRROR_TASK_WINDOW_MS = 7_500;
export const MIRROR_HOLD_DURATION_MS = 500;
export const MIRROR_COMBO_NEUTRAL_MS = 200;
export const MIRROR_TASK_SCORE = 100;

const POSE_DEMO_MS = 1_500;
const POSE_ATTEMPT_MS = 5_000;
const COMBO_DEMO_MS = 2_000;
const COMBO_ATTEMPT_MS = 4_500;
const RESULT_MS = 1_000;
const WRIST_TOLERANCE_TORSO = 0.25;
const ELBOW_TOLERANCE_DEGREES = 20;
const HAND_UP_Y = -0.55;
const HAND_DOWN_Y = 0.8;
const ARMS_OUT_X = 0.8;
const NEUTRAL_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24] as const;
const BASE_LANDMARKS = [11, 12, 23, 24] as const;
const MAX_SAMPLE_GAP_MS = 250;
const CORRECTION_DELAY_MS = 500;
const CORRECTION_REPEAT_COOLDOWN_MS = 2_000;

function leanRequirement(direction: MirrorSide): MirrorPoseRequirement {
  return { kind: 'torso-lean', direction, activateAt: C.leanActivate, releaseAt: C.leanRelease };
}

function wristPosition(side: MirrorSide, targetX: number, targetY: number): MirrorPoseRequirement {
  return { kind: 'wrist-position', side, targetX, targetY, toleranceTorso: WRIST_TOLERANCE_TORSO };
}

function straightElbow(side: MirrorSide): MirrorPoseRequirement {
  return { kind: 'elbow-angle', side, targetDegrees: 180, toleranceDegrees: ELBOW_TOLERANCE_DEGREES };
}

function element(action: MirrorAction, name: string, requirements: readonly MirrorPoseRequirement[]): MirrorPoseElement {
  return { action, name, requirements };
}

const leanLeft = element('LEFT', 'Lean left', [
  leanRequirement('left'),
  wristPosition('left', 0, HAND_DOWN_Y),
  wristPosition('right', 0, HAND_DOWN_Y),
]);
const leanRight = element('RIGHT', 'Lean right', [
  leanRequirement('right'),
  wristPosition('left', 0, HAND_DOWN_Y),
  wristPosition('right', 0, HAND_DOWN_Y),
]);
const leftHandUp = element('LEFT_HAND_UP', 'Raise your left hand', [
  wristPosition('left', 0, HAND_UP_Y),
  straightElbow('left'),
  wristPosition('right', 0, HAND_DOWN_Y),
]);
const rightHandUp = element('RIGHT_HAND_UP', 'Raise your right hand', [
  wristPosition('right', 0, HAND_UP_Y),
  straightElbow('right'),
  wristPosition('left', 0, HAND_DOWN_Y),
]);
const bothHandsUp = element('BOTH_HANDS_UP', 'Raise both hands', [
  wristPosition('left', 0, HAND_UP_Y),
  straightElbow('left'),
  wristPosition('right', 0, HAND_UP_Y),
  straightElbow('right'),
]);
const armsOut = element('ARMS_OUT', 'Extend both arms to the sides', [
  wristPosition('left', ARMS_OUT_X, 0),
  straightElbow('left'),
  wristPosition('right', ARMS_OUT_X, 0),
  straightElbow('right'),
]);

/** Eight fixed assignments fill the complete 60-second round. */
export const MIRROR_ASSIGNMENTS: readonly MirrorAssignment[] = [
  { id: 'LEFT', name: 'Lean left', kind: 'single', demoMs: POSE_DEMO_MS, attemptMs: POSE_ATTEMPT_MS, resultMs: RESULT_MS, elements: [leanLeft] },
  { id: 'RIGHT', name: 'Lean right', kind: 'single', demoMs: POSE_DEMO_MS, attemptMs: POSE_ATTEMPT_MS, resultMs: RESULT_MS, elements: [leanRight] },
  { id: 'LEFT_HAND_UP', name: 'Raise your left hand', kind: 'single', demoMs: POSE_DEMO_MS, attemptMs: POSE_ATTEMPT_MS, resultMs: RESULT_MS, elements: [leftHandUp] },
  { id: 'RIGHT_HAND_UP', name: 'Raise your right hand', kind: 'single', demoMs: POSE_DEMO_MS, attemptMs: POSE_ATTEMPT_MS, resultMs: RESULT_MS, elements: [rightHandUp] },
  { id: 'BOTH_HANDS_UP', name: 'Raise both hands', kind: 'single', demoMs: POSE_DEMO_MS, attemptMs: POSE_ATTEMPT_MS, resultMs: RESULT_MS, elements: [bothHandsUp] },
  { id: 'ARMS_OUT', name: 'Extend both arms to the sides', kind: 'single', demoMs: POSE_DEMO_MS, attemptMs: POSE_ATTEMPT_MS, resultMs: RESULT_MS, elements: [armsOut] },
  {
    id: 'LEFT_THEN_RIGHT', name: 'Lean left, then right', kind: 'combo',
    demoMs: COMBO_DEMO_MS, attemptMs: COMBO_ATTEMPT_MS, resultMs: RESULT_MS, elements: [leanLeft, leanRight],
  },
  {
    id: 'LEFT_HAND_UP_THEN_RIGHT_HAND_UP', name: 'Raise your left hand, then right',
    kind: 'combo', demoMs: COMBO_DEMO_MS, attemptMs: COMBO_ATTEMPT_MS, resultMs: RESULT_MS,
    elements: [leftHandUp, rightHandUp],
  },
];

export type MirrorTrackingValidity = GestureAnalysis['trackingValid'];
export type MirrorTaskPhase = 'demo' | 'attempt' | 'result' | 'complete';

export interface MirrorChallengeResult {
  challengeElapsedMs: number;
  remainingMs: number;
  taskIndex: number | null;
  taskNumber: number | null;
  taskId: MirrorAssignmentId | null;
  taskName: string;
  taskPhase: MirrorTaskPhase;
  taskElapsedMs: number;
  taskRemainingMs: number;
  targetId: MirrorAction | null;
  completedTaskCount: number;
  /** Backwards-compatible count name; it counts completed assignments. */
  completedTargetCount: number;
  totalTasks: number;
  totalTargets: number;
  score: number;
  /** True only on the update that awards the task's 100 points. */
  success: boolean;
  /** True when a held pose completes one combo element. */
  elementCompleted: boolean;
  /** True when an actionable correction first becomes eligible or repeats after cooldown. */
  correctionEvent: boolean;
  elementIndex: number;
  holdingMs: number;
  awaitingNeutral: boolean;
  challengeCompleted: boolean;
  feedback: string;
  highlightedLandmarkIndexes: number[];
}

interface BodyScale {
  leftShoulder: Landmark;
  rightShoulder: Landmark;
  leftHip: Landmark;
  rightHip: Landmark;
  shoulderCenterX: number;
  shoulderCenterY: number;
  hipCenterX: number;
  hipCenterY: number;
  shoulderWidth: number;
  torsoLength: number;
}

interface Assessment {
  matches: boolean;
  deviation: number;
  feedback: string;
  highlight: number[];
}

const SIDE_LANDMARKS: Record<MirrorSide, readonly [shoulder: number, elbow: number, wrist: number]> = {
  left: [11, 13, 15],
  right: [12, 14, 16],
};

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function requiredIndexes(requirements: readonly MirrorPoseRequirement[]): number[] {
  const indexes: number[] = [...BASE_LANDMARKS];
  for (const requirement of requirements) {
    if (requirement.kind === 'torso-lean') continue;
    indexes.push(...SIDE_LANDMARKS[requirement.side]);
  }
  return uniqueSorted(indexes);
}

function confidenceProblems(landmarks: readonly Landmark[], indexes: readonly number[]): number[] {
  return indexes.filter(index => {
    const point = landmarks[index];
    return !point
      || !Number.isFinite(point.x)
      || !Number.isFinite(point.y)
      || !Number.isFinite(point.visibility)
      || point.visibility < C.confidence
      || (point.presence !== undefined && (!Number.isFinite(point.presence) || point.presence < C.confidence));
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
  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  const torsoLength = Math.hypot(shoulderCenterX - hipCenterX, shoulderCenterY - hipCenterY);
  if (shoulderWidth < 0.06 || torsoLength < 0.1) return null;

  return {
    leftShoulder, rightShoulder, leftHip, rightHip,
    shoulderCenterX, shoulderCenterY, hipCenterX, hipCenterY,
    shoulderWidth, torsoLength,
  };
}

function elbowAngleDegrees(shoulder: Landmark, elbow: Landmark, wrist: Landmark): number {
  const sx = shoulder.x - elbow.x;
  const sy = shoulder.y - elbow.y;
  const wx = wrist.x - elbow.x;
  const wy = wrist.y - elbow.y;
  const lengths = Math.hypot(sx, sy) * Math.hypot(wx, wy);
  if (lengths === 0) return 0;
  const cosine = Math.max(-1, Math.min(1, (sx * wx + sy * wy) / lengths));
  return Math.acos(cosine) * (180 / Math.PI);
}

function outwardDirection(side: MirrorSide, scale: BodyScale): number {
  const anatomicalLeftPointsRight = scale.leftShoulder.x > scale.rightShoulder.x ? 1 : -1;
  return side === 'left' ? anatomicalLeftPointsRight : -anatomicalLeftPointsRight;
}

function wristCorrection(requirement: Extract<MirrorPoseRequirement, { kind: 'wrist-position' }>, x: number, y: number): string {
  const xError = Math.abs(x - requirement.targetX);
  const yError = Math.abs(y - requirement.targetY);
  if (xError >= yError) {
    if (requirement.targetX > 0.4) {
      return x < requirement.targetX
        ? `Reach your ${requirement.side} arm farther out to the side`
        : `Bring your ${requirement.side} arm closer in`;
    }
    return `Move your ${requirement.side} hand toward your shoulder`;
  }

  if (requirement.targetY < 0) {
    return y > requirement.targetY
      ? `Raise your ${requirement.side} hand higher`
      : `Lower your ${requirement.side} hand slightly`;
  }
  if (requirement.targetY > 0) {
    return y < requirement.targetY
      ? `Lower your ${requirement.side} hand`
      : `Raise your ${requirement.side} hand slightly`;
  }
  return y < requirement.targetY
    ? `Lower your ${requirement.side} hand to shoulder height`
    : `Raise your ${requirement.side} hand to shoulder height`;
}

function assessRequirement(
  requirement: MirrorPoseRequirement,
  landmarks: readonly Landmark[],
  scale: BodyScale,
  continuing: boolean,
): Assessment {
  if (requirement.kind === 'torso-lean') {
    // Match GestureEngine's mirrored-preview convention and activation/release thresholds.
    const rawLean = (scale.shoulderCenterX - scale.hipCenterX) / scale.shoulderWidth;
    const signedLean = rawLean * (requirement.direction === 'left' ? 1 : -1);
    const threshold = continuing ? requirement.releaseAt : requirement.activateAt;
    const matches = signedLean >= threshold;
    return {
      matches,
      deviation: matches ? 0 : Math.max(0, (threshold - signedLean) / threshold),
      feedback: 'Lean further ' + requirement.direction,
      highlight: [11, 12, 23, 24],
    };
  }

  const [shoulderIndex, elbowIndex, wristIndex] = SIDE_LANDMARKS[requirement.side];
  const shoulder = landmarks[shoulderIndex];
  const elbow = landmarks[elbowIndex];
  const wrist = landmarks[wristIndex];
  const highlight = [shoulderIndex, elbowIndex, wristIndex];

  if (requirement.kind === 'elbow-angle') {
    const angle = elbowAngleDegrees(shoulder, elbow, wrist);
    const difference = Math.abs(angle - requirement.targetDegrees);
    return {
      matches: difference <= requirement.toleranceDegrees,
      deviation: Math.max(0, difference / requirement.toleranceDegrees - 1),
      feedback: 'Straighten your ' + requirement.side + ' arm',
      highlight,
    };
  }

  const x = (wrist.x - shoulder.x) * outwardDirection(requirement.side, scale) / scale.torsoLength;
  const y = (wrist.y - shoulder.y) / scale.torsoLength;
  const xError = Math.abs(x - requirement.targetX);
  const yError = Math.abs(y - requirement.targetY);
  const largestAxisError = Math.max(xError, yError);
  return {
    matches: xError <= requirement.toleranceTorso && yError <= requirement.toleranceTorso,
    deviation: Math.max(0, largestAxisError / requirement.toleranceTorso - 1),
    feedback: wristCorrection(requirement, x, y),
    highlight,
  };
}

function neutralAssessment(scale: BodyScale, landmarks: readonly Landmark[]): { matches: boolean; feedback: string; highlight: number[]; deviation: number } {
  const rawLean = (scale.shoulderCenterX - scale.hipCenterX) / scale.shoulderWidth;
  const deviations: { feedback: string; highlight: number[]; deviation: number }[] = [];
  const leanError = Math.abs(rawLean) - C.leanRelease;
  if (leanError > 0) {
    deviations.push({
      feedback: 'Return to an upright neutral stance between moves',
      highlight: [11, 12, 23, 24],
      deviation: leanError / C.leanRelease,
    });
  }

  for (const side of ['left', 'right'] as const) {
    const [shoulder, elbow, wrist] = SIDE_LANDMARKS[side];
    const belowShoulder = (landmarks[wrist].y - landmarks[shoulder].y) / scale.torsoLength;
    if (belowShoulder < 0.08) {
      deviations.push({
        feedback: 'Lower your ' + side + ' hand before the next move',
        highlight: [shoulder, elbow, wrist],
        deviation: (0.08 - belowShoulder) / 0.08,
      });
    }
  }

  if (deviations.length === 0) return { matches: true, feedback: '', highlight: [], deviation: 0 };
  const strongest = deviations.reduce((best, current) => current.deviation > best.deviation ? current : best);
  return { matches: false, ...strongest };
}

/**
 * Pure timed recognizer for Mirror Challenge. update receives elapsed challenge
 * time in milliseconds, normalized landmarks, and tracking validity. The round is
 * 60 seconds long with eight fixed 7.5-second assignments. A complete task emits
 * one success event and awards 100 points; combo elements each require a 500 ms
 * hold with at least 200 ms of neutral posture between them.
 */
export class MirrorChallengeRuntime {
  private readonly completedTasks = new Set<number>();
  private activeElapsedMs = 0;
  private lastTimestampMs: number | null = null;
  private trackingWasInvalid = false;
  private activeTaskIndex: number | null = null;
  private elementIndex = 0;
  private holdStartedAt: number | null = null;
  private lastPoseSampleAt: number | null = null;
  private neutralStartedAt: number | null = null;
  private neutralRequired = false;
  private correctionKey: string | null = null;
  private correctionStartedAt: number | null = null;
  private correctionLastEventAt: number | null = null;

  reset(): void {
    this.completedTasks.clear();
    this.activeElapsedMs = 0;
    this.lastTimestampMs = null;
    this.trackingWasInvalid = false;
    this.activeTaskIndex = null;
    this.elementIndex = 0;
    this.clearPoseHold();
    this.neutralStartedAt = null;
    this.neutralRequired = false;
    this.clearCorrection();
  }

  update(timestampMs: number, landmarks: readonly Landmark[], trackingValid: MirrorTrackingValidity): MirrorChallengeResult {
    if (!Number.isFinite(timestampMs)) {
      const taskIndex = this.activeElapsedMs >= MIRROR_CHALLENGE_DURATION_MS
        ? null : Math.floor(this.activeElapsedMs / MIRROR_TASK_WINDOW_MS);
      const task = taskIndex === null ? null : MIRROR_ASSIGNMENTS[taskIndex];
      return this.result(this.activeElapsedMs, taskIndex, task, task ? 'attempt' : 'complete', false, false, 0,
        'Waiting for a valid pose timestamp.', [], false);
    }
    if (this.lastTimestampMs !== null && timestampMs < this.lastTimestampMs) {
      const taskIndex = this.activeElapsedMs >= MIRROR_CHALLENGE_DURATION_MS
        ? null : Math.floor(this.activeElapsedMs / MIRROR_TASK_WINDOW_MS);
      const task = taskIndex === null ? null : MIRROR_ASSIGNMENTS[taskIndex];
      return this.result(this.activeElapsedMs, taskIndex, task, task ? 'attempt' : 'complete', false, false, 0,
        'Waiting for an updated pose.', [], false);
    }

    const priorTimestamp = this.lastTimestampMs;
    const interval = priorTimestamp === null ? 0 : Math.max(0, timestampMs - priorTimestamp);
    const candidateElapsed = priorTimestamp === null
      ? Math.max(0, timestampMs)
      : this.activeElapsedMs + (this.trackingWasInvalid ? 0 : interval);
    const candidateTaskIndex = candidateElapsed >= MIRROR_CHALLENGE_DURATION_MS
      ? MIRROR_ASSIGNMENTS.length - 1
      : Math.floor(candidateElapsed / MIRROR_TASK_WINDOW_MS);
    const candidateTask = MIRROR_ASSIGNMENTS[candidateTaskIndex];
    const sameTask = candidateTaskIndex === this.activeTaskIndex;
    const candidateElementIndex = sameTask ? this.elementIndex : 0;
    const candidateRequirements = candidateTask.elements[Math.min(candidateElementIndex, candidateTask.elements.length - 1)].requirements;
    const candidateNeededIndexes = sameTask && this.neutralRequired
      ? [...NEUTRAL_LANDMARKS]
      : requiredIndexes(candidateRequirements);
    const candidateProblems = confidenceProblems(landmarks, candidateNeededIndexes);
    const candidateScale = candidateProblems.length === 0 ? bodyScale(landmarks) : null;
    const trackingLost = !trackingValid || candidateProblems.length > 0 || candidateScale === null;
    this.lastTimestampMs = timestampMs;
    if (priorTimestamp === null) this.activeElapsedMs = Math.max(0, timestampMs);

    if (trackingLost) {
      this.trackingWasInvalid = true;
      this.clearPoseHold();
      this.neutralStartedAt = null;
      this.clearCorrection();
      const elapsedMs = this.activeElapsedMs;
      const taskIndex = elapsedMs >= MIRROR_CHALLENGE_DURATION_MS
        ? null : Math.floor(elapsedMs / MIRROR_TASK_WINDOW_MS);
      const task = taskIndex === null ? null : MIRROR_ASSIGNMENTS[taskIndex];
      const elapsedTaskIndex = taskIndex ?? 0;
      const phase = task
        ? elapsedMs - elapsedTaskIndex * MIRROR_TASK_WINDOW_MS < task.demoMs ? 'demo'
          : elapsedMs - elapsedTaskIndex * MIRROR_TASK_WINDOW_MS >= task.demoMs + task.attemptMs ? 'result' : 'attempt'
        : 'complete';
      const highlighted = candidateProblems.length > 0 ? candidateProblems : candidateNeededIndexes;
      return this.result(elapsedMs, taskIndex, task, phase, false, false, 0,
        'Step back so your shoulders, hips and hands stay visible.', highlighted, false);
    }

    if (priorTimestamp === null || !this.trackingWasInvalid) this.activeElapsedMs = candidateElapsed;
    this.trackingWasInvalid = false;
    const elapsedMs = this.activeElapsedMs;
    if (elapsedMs >= MIRROR_CHALLENGE_DURATION_MS) {
      this.clearPoseHold();
      this.neutralStartedAt = null;
      this.neutralRequired = false;
      this.clearCorrection();
      return this.result(elapsedMs, null, null, 'complete', false, false, 0, 'Challenge complete.', []);
    }

    const taskIndex = Math.floor(elapsedMs / MIRROR_TASK_WINDOW_MS);
    const task = MIRROR_ASSIGNMENTS[taskIndex];
    const taskElapsedMs = elapsedMs - taskIndex * MIRROR_TASK_WINDOW_MS;
    if (this.activeTaskIndex !== taskIndex) {
      this.activeTaskIndex = taskIndex;
      this.elementIndex = 0;
      this.clearPoseHold();
      this.neutralStartedAt = null;
      this.neutralRequired = false;
      this.clearCorrection();
    }

    if (taskElapsedMs < task.demoMs) {
      this.clearPoseHold();
      this.neutralStartedAt = null;
      this.clearCorrection();
      return this.result(elapsedMs, taskIndex, task, 'demo', false, false, 0, 'Watch the coach: ' + task.name + '.', []);
    }

    if (taskElapsedMs >= task.demoMs + task.attemptMs) {
      this.clearPoseHold();
      this.neutralStartedAt = null;
      this.neutralRequired = false;
      this.clearCorrection();
      const completed = this.completedTasks.has(taskIndex);
      return this.result(
        elapsedMs, taskIndex, task, 'result', false, false, 0,
        completed ? 'Task complete! +100 points.' : 'Time is up. Get ready for the next pose.',
        [],
      );
    }

    if (this.completedTasks.has(taskIndex)) {
      this.clearCorrection();
      return this.result(elapsedMs, taskIndex, task, 'attempt', false, false, 0, 'Task complete! +100 points.', []);
    }

    const elementToMatch = task.elements[this.elementIndex];
    const neededIndexes = this.neutralRequired ? [...NEUTRAL_LANDMARKS] : requiredIndexes(elementToMatch.requirements);
    const problems = confidenceProblems(landmarks, neededIndexes);
    if (!trackingValid || problems.length > 0) {
      this.clearPoseHold();
      this.neutralStartedAt = null;
      this.clearCorrection();
      const highlighted = problems.length > 0 ? problems : neededIndexes;
      return this.result(
        elapsedMs, taskIndex, task, 'attempt', false, false, 0,
        'Step back so your shoulders, hips and hands stay visible.',
        highlighted,
      );
    }

    const scale = bodyScale(landmarks);
    if (!scale) {
      this.clearPoseHold();
      this.neutralStartedAt = null;
      this.clearCorrection();
      return this.result(
        elapsedMs, taskIndex, task, 'attempt', false, false, 0,
        'Step back so your shoulders and hips stay visible.',
        [...BASE_LANDMARKS],
      );
    }

    if (this.neutralRequired) {
      this.clearPoseHold();
      const neutral = neutralAssessment(scale, landmarks);
      if (!neutral.matches) {
        this.neutralStartedAt = null;
        const correction = this.correctionFeedback(elapsedMs, neutral.feedback, neutral.highlight);
        return this.result(elapsedMs, taskIndex, task, 'attempt', false, false, 0, correction.feedback, correction.highlight, correction.event);
      }
      this.clearCorrection();

      const gap = this.neutralStartedAt === null ? 0 : elapsedMs - this.neutralStartedAt;
      if (this.neutralStartedAt === null || gap < 0 || gap > MAX_SAMPLE_GAP_MS) this.neutralStartedAt = elapsedMs;
      const neutralMs = elapsedMs - this.neutralStartedAt;
      if (neutralMs < MIRROR_COMBO_NEUTRAL_MS) {
        return this.result(elapsedMs, taskIndex, task, 'attempt', false, false, neutralMs, 'Hold neutral before the next move.', []);
      }
      this.neutralRequired = false;
      this.neutralStartedAt = null;
      return this.result(elapsedMs, taskIndex, task, 'attempt', false, false, 0, 'Ready for the next move.', []);
    }

    const assessments = elementToMatch.requirements.map(requirement =>
      assessRequirement(requirement, landmarks, scale, this.holdStartedAt !== null),
    );
    const failures = assessments.filter(assessment => !assessment.matches);
    if (failures.length > 0) {
      this.clearPoseHold();
      const strongest = failures.reduce((best, current) => current.deviation > best.deviation ? current : best);
      const correction = this.correctionFeedback(elapsedMs, strongest.feedback, strongest.highlight);
      return this.result(elapsedMs, taskIndex, task, 'attempt', false, false, 0, correction.feedback, correction.highlight, correction.event);
    }

    this.clearCorrection();
    const sampleGap = this.lastPoseSampleAt === null ? 0 : elapsedMs - this.lastPoseSampleAt;
    if (this.holdStartedAt === null || sampleGap < 0 || sampleGap > MAX_SAMPLE_GAP_MS) this.holdStartedAt = elapsedMs;
    this.lastPoseSampleAt = elapsedMs;
    const holdingMs = Math.max(0, elapsedMs - this.holdStartedAt);
    if (holdingMs < MIRROR_HOLD_DURATION_MS) {
      return this.result(elapsedMs, taskIndex, task, 'attempt', false, false, holdingMs, 'Hold this pose.', []);
    }

    this.elementIndex += 1;
    this.clearPoseHold();
    if (this.elementIndex < task.elements.length) {
      this.neutralRequired = true;
      this.neutralStartedAt = null;
      return this.result(elapsedMs, taskIndex, task, 'attempt', false, true, MIRROR_HOLD_DURATION_MS, 'Pose matched. Return to neutral before the next move.', []);
    }

    this.completedTasks.add(taskIndex);
    this.neutralRequired = false;
    this.neutralStartedAt = null;
    return this.result(elapsedMs, taskIndex, task, 'attempt', true, true, MIRROR_HOLD_DURATION_MS, 'Task complete! +100 points.', []);
  }

  private clearPoseHold(): void {
    this.holdStartedAt = null;
    this.lastPoseSampleAt = null;
  }

  private clearCorrection(): void {
    this.correctionKey = null;
    this.correctionStartedAt = null;
    this.correctionLastEventAt = null;
  }

  private correctionFeedback(
    elapsedMs: number,
    feedback: string,
    highlight: number[],
  ): { feedback: string; highlight: number[]; event: boolean } {
    const key = `${feedback}:${highlight.join(',')}`;
    if (key !== this.correctionKey || this.correctionStartedAt === null || elapsedMs < this.correctionStartedAt) {
      this.correctionKey = key;
      this.correctionStartedAt = elapsedMs;
      this.correctionLastEventAt = null;
    }

    if (elapsedMs - this.correctionStartedAt < CORRECTION_DELAY_MS) {
      return { feedback: '', highlight: [], event: false };
    }

    const event = this.correctionLastEventAt === null
      || elapsedMs - this.correctionLastEventAt >= CORRECTION_REPEAT_COOLDOWN_MS;
    if (event) this.correctionLastEventAt = elapsedMs;
    return { feedback, highlight, event };
  }

  private result(
    elapsedMs: number,
    taskIndex: number | null,
    task: MirrorAssignment | null,
    taskPhase: MirrorTaskPhase,
    success: boolean,
    elementCompleted: boolean,
    holdingMs: number,
    feedback: string,
    highlightedLandmarkIndexes: number[],
    correctionEvent = false,
  ): MirrorChallengeResult {
    const taskElapsedMs = taskIndex === null ? 0 : elapsedMs - taskIndex * MIRROR_TASK_WINDOW_MS;
    const targetElement = task
      ? task.elements[Math.min(this.elementIndex, task.elements.length - 1)]
      : undefined;
    const count = this.completedTasks.size;
    return {
      challengeElapsedMs: elapsedMs,
      remainingMs: Math.max(0, MIRROR_CHALLENGE_DURATION_MS - elapsedMs),
      taskIndex,
      taskNumber: taskIndex === null ? null : taskIndex + 1,
      taskId: task?.id ?? null,
      taskName: task?.name ?? 'Challenge complete',
      taskPhase,
      taskElapsedMs,
      taskRemainingMs: taskIndex === null ? 0 : Math.max(0, MIRROR_TASK_WINDOW_MS - taskElapsedMs),
      targetId: targetElement?.action ?? null,
      completedTaskCount: count,
      completedTargetCount: count,
      totalTasks: MIRROR_ASSIGNMENTS.length,
      totalTargets: MIRROR_ASSIGNMENTS.length,
      score: count * MIRROR_TASK_SCORE,
      success,
      elementCompleted,
      correctionEvent,
      elementIndex: this.elementIndex,
      holdingMs,
      awaitingNeutral: this.neutralRequired,
      challengeCompleted: taskPhase === 'complete',
      feedback,
      highlightedLandmarkIndexes: uniqueSorted(highlightedLandmarkIndexes),
    };
  }
}
