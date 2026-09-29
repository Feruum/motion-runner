import type { Landmark } from './types';

export interface SixSevenResult {
  count: number;
  completed: boolean;
  raised: 'left' | 'right' | null;
  feedback: string;
}

const required = [11, 12, 15, 16, 23, 24] as const;
const raiseThreshold = 0.12;
const releaseThreshold = 0.06;
const aboveShoulderAllowance = 0.2;
const belowHipAllowance = 0.2;
const confidenceThreshold = 0.6;
const confirmMs = 120;
const minimumSwitchMs = 200;
const maximumSwitchMs = 2_000;

/** Returns the hand held higher when both wrists are in the waist-to-chest gesture area. */
export function sixSevenRaisedHand(
  landmarks: readonly Landmark[],
  threshold = raiseThreshold,
): 'left' | 'right' | null {
  if (!Number.isFinite(threshold) || threshold < 0) return null;
  if (!required.every(index => {
    const point = landmarks[index];
    return point && Number.isFinite(point.x) && Number.isFinite(point.y)
      && Number.isFinite(point.visibility) && point.visibility >= confidenceThreshold
      && (point.presence ?? 1) >= confidenceThreshold;
  })) return null;

  const leftShoulderY = landmarks[11].y;
  const rightShoulderY = landmarks[12].y;
  const leftHipY = landmarks[23].y;
  const rightHipY = landmarks[24].y;
  const shoulders = (leftShoulderY + rightShoulderY) / 2;
  const hips = (leftHipY + rightHipY) / 2;
  const torso = hips - shoulders;
  if (!Number.isFinite(torso) || torso < 0.12) return null;

  const leftZoneTop = leftShoulderY - torso * aboveShoulderAllowance;
  const rightZoneTop = rightShoulderY - torso * aboveShoulderAllowance;
  const leftZoneBottom = leftHipY + torso * belowHipAllowance;
  const rightZoneBottom = rightHipY + torso * belowHipAllowance;
  const leftY = landmarks[15].y;
  const rightY = landmarks[16].y;
  if (leftY < leftZoneTop || leftY > leftZoneBottom || rightY < rightZoneTop || rightY > rightZoneBottom) return null;

  const leftElevation = leftShoulderY - leftY;
  const rightElevation = rightShoulderY - rightY;
  const heightDifference = (leftElevation - rightElevation) / torso;
  if (heightDifference >= threshold) return 'left';
  if (heightDifference <= -threshold) return 'right';
  return null;
}

export class SixSevenRecognizer {
  count = 0;
  private lastSampleMs = -Infinity;
  private raised: 'left' | 'right' | null = null;
  private pending: 'left' | 'right' | null = null;
  private pendingSince = -Infinity;
  private lastPole: 'left' | 'right' | null = null;
  private pairProgress: 0 | 1 = 0;
  private lastPoleAt = -Infinity;
  private feedback = 'Hold both palms between waist and chest; lift one slightly above the other.';

  update(timestampMs: number, landmarks: readonly Landmark[], trackingValid = true): SixSevenResult {
    if (!Number.isFinite(timestampMs) || timestampMs <= this.lastSampleMs) return this.result(null, false);
    this.lastSampleMs = timestampMs;
    if (this.pairProgress === 1 && this.lastPole !== null && timestampMs - this.lastPoleAt > maximumSwitchMs) {
      this.resetAttempt();
      this.feedback = 'Too slow — start a new pair. Switch hands within 2 seconds.';
    }
    if (!trackingValid || !required.every(index => {
      const point = landmarks[index];
      return point && Number.isFinite(point.x) && Number.isFinite(point.y)
        && Number.isFinite(point.visibility) && point.visibility >= confidenceThreshold
        && (point.presence ?? 1) >= confidenceThreshold;
    })) {
      this.resetAttempt();
      this.feedback = 'Keep both hands, shoulders and hips in view.';
      return this.result(null, false);
    }

    let raised = sixSevenRaisedHand(landmarks, this.raised ? releaseThreshold : raiseThreshold);
    if (this.raised && raised !== this.raised) raised = sixSevenRaisedHand(landmarks, raiseThreshold);
    this.raised = raised;
    if (!raised) {
      this.pending = null;
      this.pendingSince = -Infinity;
      this.feedback = 'Hold both palms between waist and chest; lift one slightly above the other.';
      return this.result(null, false);
    }

    if (raised !== this.pending) {
      this.pending = raised;
      this.pendingSince = timestampMs;
      return this.result(raised, false);
    }
    if (timestampMs - this.pendingSince < confirmMs) return this.result(raised, false);
    return this.acceptPole(timestampMs, raised);
  }

  reset(): void {
    this.count = 0;
    this.lastSampleMs = -Infinity;
    this.resetAttempt();
    this.feedback = 'Hold both palms between waist and chest; lift one slightly above the other.';
  }

  private acceptPole(timestampMs: number, raised: 'left' | 'right'): SixSevenResult {
    if (this.lastPole === null) {
      this.lastPole = raised;
      this.pairProgress = 1;
      this.lastPoleAt = timestampMs;
      this.feedback = `1/2 · Switch hands and lift the other palm within 2 seconds.`;
      return this.result(raised, false);
    }
    if (raised === this.lastPole) return this.result(raised, false);

    const interval = timestampMs - this.lastPoleAt;
    if (interval < minimumSwitchMs) return this.result(raised, false);

    this.lastPole = raised;
    this.lastPoleAt = timestampMs;
    if (this.pairProgress === 1) {
      this.count++;
      this.pairProgress = 0;
      this.feedback = '+1 rep! Start a fresh pair: lift one hand, then the other.';
      return this.result(raised, true);
    }

    this.pairProgress = 1;
    this.feedback = '1/2 · Switch hands and lift the other palm within 2 seconds.';
    return this.result(raised, false);
  }

  private resetAttempt(): void {
    this.raised = null;
    this.pending = null;
    this.pendingSince = -Infinity;
    this.lastPole = null;
    this.pairProgress = 0;
    this.lastPoleAt = -Infinity;
  }

  private result(raised: 'left' | 'right' | null, completed: boolean): SixSevenResult {
    return { count: this.count, completed, raised, feedback: this.feedback };
  }
}
