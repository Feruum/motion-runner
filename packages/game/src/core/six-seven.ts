import type { Landmark } from './types';

export interface SixSevenResult {
  count: number;
  completed: boolean;
  raised: 'left' | 'right' | null;
  feedback: string;
}

const required = [11, 12, 15, 16, 23, 24] as const;
const raiseThreshold = 0.3;
const releaseThreshold = 0.16;
const confirmMs = 120;
const minimumSwitchMs = 200;
const maximumSwitchMs = 2_000;

export class SixSevenRecognizer {
  count = 0;
  private lastSampleMs = -Infinity;
  private leftUp = false;
  private rightUp = false;
  private pending: 'left' | 'right' | null = null;
  private pendingSince = -Infinity;
  private lastPole: 'left' | 'right' | null = null;
  private cycleStart: 'left' | 'right' | null = null;
  private switches = 0;
  private lastPoleAt = -Infinity;
  private feedback = 'Raise one hand, then alternate hands to complete a full cycle.';

  update(timestampMs: number, landmarks: readonly Landmark[], trackingValid = true): SixSevenResult {
    if (!Number.isFinite(timestampMs) || timestampMs <= this.lastSampleMs) return this.result(null, false);
    this.lastSampleMs = timestampMs;
    if (!trackingValid || !required.every(index => {
      const point = landmarks[index];
      return point && Number.isFinite(point.x) && Number.isFinite(point.y)
        && point.visibility >= 0.6 && (point.presence ?? 1) >= 0.6;
    })) {
      this.resetAttempt();
      this.feedback = 'Keep both hands, shoulders and hips in view.';
      return this.result(null, false);
    }

    const shoulders = (landmarks[11].y + landmarks[12].y) / 2;
    const hips = (landmarks[23].y + landmarks[24].y) / 2;
    const torso = hips - shoulders;
    if (!Number.isFinite(torso) || torso < 0.12) {
      this.resetAttempt();
      this.feedback = 'Step back so your shoulders and hips stay in view.';
      return this.result(null, false);
    }

    const leftHeight = (landmarks[11].y - landmarks[15].y) / torso;
    const rightHeight = (landmarks[12].y - landmarks[16].y) / torso;
    this.leftUp = this.leftUp ? leftHeight > releaseThreshold : leftHeight >= raiseThreshold;
    this.rightUp = this.rightUp ? rightHeight > releaseThreshold : rightHeight >= raiseThreshold;
    const raised = this.leftUp === this.rightUp ? null : this.leftUp ? 'left' : 'right';
    if (!raised) {
      this.pending = null;
      this.pendingSince = -Infinity;
      if (this.leftUp && this.rightUp) this.feedback = 'Alternate your hands instead of raising both together.';
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
    this.leftUp = false;
    this.rightUp = false;
    this.pending = null;
    this.pendingSince = -Infinity;
    this.resetAttempt();
    this.feedback = 'Raise one hand, then alternate hands to complete a full cycle.';
  }

  private acceptPole(timestampMs: number, raised: 'left' | 'right'): SixSevenResult {
    if (this.lastPole === null) {
      this.lastPole = raised;
      this.cycleStart = raised;
      this.lastPoleAt = timestampMs;
      this.feedback = `Now raise your ${raised === 'left' ? 'right' : 'left'} hand.`;
      return this.result(raised, false);
    }
    if (raised === this.lastPole) return this.result(raised, false);

    const interval = timestampMs - this.lastPoleAt;
    if (interval < minimumSwitchMs) return this.result(raised, false);
    if (interval > maximumSwitchMs) {
      this.lastPole = raised;
      this.cycleStart = raised;
      this.switches = 0;
      this.lastPoleAt = timestampMs;
      this.feedback = `Start alternating again. Raise your ${raised === 'left' ? 'right' : 'left'} hand next.`;
      return this.result(raised, false);
    }

    this.lastPole = raised;
    this.lastPoleAt = timestampMs;
    this.switches++;
    if (this.switches === 2 && raised === this.cycleStart) {
      this.count++;
      this.switches = 0;
      this.cycleStart = raised;
      this.feedback = 'Full cycle! Switch hands and repeat.';
      return this.result(raised, true);
    }

    this.feedback = 'Good switch. Raise the other hand once more to finish the cycle.';
    return this.result(raised, false);
  }

  private resetAttempt(): void {
    this.leftUp = false;
    this.rightUp = false;
    this.pending = null;
    this.pendingSince = -Infinity;
    this.lastPole = null;
    this.cycleStart = null;
    this.switches = 0;
    this.lastPoleAt = -Infinity;
  }

  private result(raised: 'left' | 'right' | null, completed: boolean): SixSevenResult {
    return { count: this.count, completed, raised, feedback: this.feedback };
  }
}
