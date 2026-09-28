export type BlasterSide = 'left' | 'right';

/** A wrist point in the mirrored preview's normalized 0..1 image coordinates. */
export interface BlasterWrist {
  x: number;
  y: number;
  confidence: number;
}

export interface BeatBlasterInput {
  /** Monotonic timestamp in milliseconds; ModeEngine supplies active-run time. */
  timestampMs: number;
  /** Torso calibration and scale, expressed in mirrored-preview normalized coordinates. */
  torso: BlasterTorsoFrame;
  leftWrist?: BlasterWrist | null;
  rightWrist?: BlasterWrist | null;
}

export interface BlasterTorsoFrame {
  centerX: number;
  centerY: number;
  /** Shoulder-center to hip-center distance in normalized image coordinates. */
  length: number;
}

export interface BeatBlasterCue {
  id: string;
  /** Intended hit time, measured from the first update. */
  atMs: number;
  /** Anatomical side from the pose model, regardless of preview mirroring. */
  side: BlasterSide;
  /** Target center offsets from the calibrated torso center, in torso lengths. */
  offsetXTorso: number;
  offsetYTorso: number;
}

export interface BeatBlasterHighlight {
  id: string;
  side: BlasterSide;
  /** Center and radius in mirrored-preview normalized image coordinates. */
  x: number;
  y: number;
  radius: number;
}

export type BlasterTimingGrade = 'perfect' | 'good' | 'miss';

export interface BeatBlasterResolution {
  cueId: string;
  side: BlasterSide;
  grade: BlasterTimingGrade;
  points: number;
  /** Signed offset from the cue time; positive means late. */
  deltaMs: number;
}

export interface BeatBlasterResult {
  score: number;
  cleared: boolean;
  misses: number;
  combo: number;
  feedback: string;
  /** One-time cue resolutions produced by this update. */
  resolutions: readonly BeatBlasterResolution[];
  /** The currently visible target, positioned in the same coordinate space as the wrists. */
  highlight: BeatBlasterHighlight | null;
}

const minimumConfidence = 0.6;
const maximumFrameGapMs = 150;
const rearmDistanceTorsoLengths = 0.35;
const rearmHoldMs = 150;
const previewLeadMs = 360;

export const BEAT_BLASTER_DURATION_MS = 60_000;
export const BEAT_BLASTER_TARGET_INTERVAL_MS = 2_000;
export const BEAT_BLASTER_FIRST_TARGET_MS = BEAT_BLASTER_TARGET_INTERVAL_MS;
export const BEAT_BLASTER_TARGET_RADIUS_TORSO = 0.25;
export const BEAT_BLASTER_TIMING_WINDOW_MS = 360;
export const BEAT_BLASTER_PERFECT_WINDOW_MS = 180;

interface WristRearmLock {
  target: BeatBlasterHighlight;
  outsideSinceMs: number | null;
}

const reachPattern: readonly Pick<BeatBlasterCue, 'side' | 'offsetXTorso' | 'offsetYTorso'>[] = [
  { side: 'left', offsetXTorso: -0.72, offsetYTorso: -0.36 },
  { side: 'right', offsetXTorso: 0.72, offsetYTorso: -0.36 },
  { side: 'left', offsetXTorso: -0.68, offsetYTorso: 0.08 },
  { side: 'right', offsetXTorso: 0.68, offsetYTorso: 0.08 },
  { side: 'left', offsetXTorso: -0.56, offsetYTorso: 0.42 },
  { side: 'right', offsetXTorso: 0.56, offsetYTorso: 0.42 },
  { side: 'left', offsetXTorso: -0.88, offsetYTorso: -0.08 },
  { side: 'right', offsetXTorso: 0.88, offsetYTorso: -0.08 },
];

/** Authored reaches begin after one bar so the player can see the first target. */
export const BEAT_BLASTER_CHART: readonly BeatBlasterCue[] = Array.from({ length: 29 }, (_, index) => ({
  id: `blaster-${index + 1}`,
  atMs: BEAT_BLASTER_FIRST_TARGET_MS + index * BEAT_BLASTER_TARGET_INTERVAL_MS,
  ...reachPattern[index % reachPattern.length],
}));

const initialFeedback = 'Move the matching wrist into the highlighted target.';

/**
 * Pure pose-to-score runtime for Beat Blaster. It owns no timers or DOM state;
 * every decision comes from the timestamp and wrist points passed to update().
 */
export class BeatBlasterRuntime {
  private readonly chart: readonly BeatBlasterCue[];
  private targetIndex = 0;
  private score = 0;
  private misses = 0;
  private combo = 0;
  private lastTimestampMs = -Infinity;
  private startTimestampMs: number | null = null;
  private previousLeft: BlasterWrist | null = null;
  private previousRight: BlasterWrist | null = null;
  private leftLockedTo: WristRearmLock | null = null;
  private rightLockedTo: WristRearmLock | null = null;
  private feedback = initialFeedback;
  private resolutions: readonly BeatBlasterResolution[] = [];
  private lastTorso: BlasterTorsoFrame | null = null;

  constructor(chart: readonly BeatBlasterCue[] = BEAT_BLASTER_CHART) {
    this.assertChart(chart);
    this.chart = chart.map(cue => ({ ...cue }));
  }

  update(input: BeatBlasterInput): BeatBlasterResult {
    this.resolutions = [];
    if (!Number.isFinite(input.timestampMs) || input.timestampMs <= this.lastTimestampMs) {
      this.feedback = 'Waiting for a fresh camera frame.';
      return this.result();
    }

    const frameGapMs = input.timestampMs - this.lastTimestampMs;
    const hasFrameGap = Number.isFinite(this.lastTimestampMs) && frameGapMs > maximumFrameGapMs;
    this.lastTimestampMs = input.timestampMs;
    if (this.startTimestampMs === null) this.startTimestampMs = input.timestampMs;

    const left = this.validWrist(input.leftWrist);
    const right = this.validWrist(input.rightWrist);
    const torso = this.validTorso(input.torso);
    this.lastTorso = torso;
    if (hasFrameGap) {
      this.leftLockedTo = this.updateRearm(this.leftLockedTo, left, torso, input.timestampMs, true);
      this.rightLockedTo = this.updateRearm(this.rightLockedTo, right, torso, input.timestampMs, true);
      this.previousLeft = null;
      this.previousRight = null;
      this.feedback = 'Camera frame gap. Move your wrist out, then enter the target again.';
      return this.result();
    }

    const elapsedMs = input.timestampMs - this.startTimestampMs;
    const resolutions: BeatBlasterResolution[] = [];
    let missedThisUpdate = false;

    while (this.targetIndex < this.chart.length) {
      const cue = this.chart[this.targetIndex];
      if (elapsedMs <= cue.atMs + BEAT_BLASTER_TIMING_WINDOW_MS) break;
      this.misses++;
      this.combo = 0;
      this.targetIndex++;
      missedThisUpdate = true;
      resolutions.push({ cueId: cue.id, side: cue.side, grade: 'miss', points: 0, deltaMs: elapsedMs - cue.atMs });
      this.feedback = `Missed that target. Use your ${cue.side} hand for the next one.`;
    }

    if (torso === null) {
      this.leftLockedTo = this.clearRearmTimer(this.leftLockedTo);
      this.rightLockedTo = this.clearRearmTimer(this.rightLockedTo);
      this.previousLeft = null;
      this.previousRight = null;
      this.resolutions = resolutions;
      this.feedback = 'Keep your shoulders and hips in view.';
      return this.result();
    }

    this.leftLockedTo = this.updateRearm(this.leftLockedTo, left, torso, input.timestampMs);
    this.rightLockedTo = this.updateRearm(this.rightLockedTo, right, torso, input.timestampMs);

    const cue = this.activeCue(elapsedMs);
    if (cue && !missedThisUpdate) {
      const target = this.targetFor(cue, torso);
      const expected = cue.side === 'left' ? left : right;
      const previousExpected = cue.side === 'left' ? this.previousLeft : this.previousRight;
      const expectedLocked = cue.side === 'left' ? this.leftLockedTo : this.rightLockedTo;
      const other = cue.side === 'left' ? right : left;
      const expectedInside = expected !== null && this.contains(target, expected);
      const otherInside = other !== null && this.contains(target, other);
      const entered = expected !== null
        && previousExpected !== null
        && !this.contains(target, previousExpected)
        && this.contains(target, expected);

      if (entered && expectedLocked === null) {
        const deltaMs = elapsedMs - cue.atMs;
        const grade = Math.abs(deltaMs) <= BEAT_BLASTER_PERFECT_WINDOW_MS ? 'perfect' : 'good';
        const points = grade === 'perfect' ? 100 : 75;
        this.score += points;
        this.combo++;
        this.targetIndex++;
        const lock = { target, outsideSinceMs: null };
        if (cue.side === 'left') this.leftLockedTo = lock;
        else this.rightLockedTo = lock;
        resolutions.push({ cueId: cue.id, side: cue.side, grade, points, deltaMs });
        this.feedback = `${grade === 'perfect' ? 'Perfect' : 'Good'} hit with your ${cue.side} hand.`;
      } else if (otherInside) {
        this.feedback = `Use your ${cue.side} hand for this target.`;
      } else if (expectedInside) {
        this.feedback = `Move your ${cue.side} wrist out, then enter the target again.`;
      } else {
        this.feedback = `Move your ${cue.side} wrist into the target.`;
      }
    }

    this.previousLeft = left;
    this.previousRight = right;
    this.resolutions = resolutions;
    return this.result();
  }

  reset(): void {
    this.targetIndex = 0;
    this.score = 0;
    this.misses = 0;
    this.combo = 0;
    this.lastTimestampMs = -Infinity;
    this.startTimestampMs = null;
    this.previousLeft = null;
    this.previousRight = null;
    this.leftLockedTo = null;
    this.rightLockedTo = null;
    this.resolutions = [];
    this.lastTorso = null;
    this.feedback = initialFeedback;
  }

  private validWrist(wrist: BlasterWrist | null | undefined): BlasterWrist | null {
    if (!wrist || !Number.isFinite(wrist.x) || !Number.isFinite(wrist.y)
      || !Number.isFinite(wrist.confidence) || wrist.confidence < minimumConfidence
      || wrist.confidence > 1 || wrist.x < 0 || wrist.x > 1 || wrist.y < 0 || wrist.y > 1) {
      return null;
    }
    return wrist;
  }

  private validTorso(torso: BlasterTorsoFrame | null | undefined): BlasterTorsoFrame | null {
    if (!torso || !Number.isFinite(torso.centerX) || !Number.isFinite(torso.centerY)
      || torso.centerX < 0 || torso.centerX > 1 || torso.centerY < 0 || torso.centerY > 1
      || !Number.isFinite(torso.length) || torso.length <= 0 || torso.length > Math.SQRT2) {
      return null;
    }
    return torso;
  }

  private targetFor(cue: BeatBlasterCue, torso: BlasterTorsoFrame): BeatBlasterHighlight {
    return {
      id: cue.id,
      side: cue.side,
      x: torso.centerX + cue.offsetXTorso * torso.length,
      y: torso.centerY + cue.offsetYTorso * torso.length,
      radius: BEAT_BLASTER_TARGET_RADIUS_TORSO * torso.length,
    };
  }

  private contains(target: BeatBlasterHighlight, wrist: BlasterWrist): boolean {
    const dx = wrist.x - target.x;
    const dy = wrist.y - target.y;
    return dx * dx + dy * dy <= target.radius * target.radius;
  }

  private updateRearm(
    lockedTo: WristRearmLock | null,
    wrist: BlasterWrist | null,
    torso: BlasterTorsoFrame | null,
    timestampMs: number,
    frameGap = false,
  ): WristRearmLock | null {
    if (!lockedTo) return null;

    if (!wrist || torso === null) return { ...lockedTo, outsideSinceMs: null };
    const dx = wrist.x - lockedTo.target.x;
    const dy = wrist.y - lockedTo.target.y;
    const minimumDistance = rearmDistanceTorsoLengths * torso.length;
    const isFarEnough = dx * dx + dy * dy > minimumDistance * minimumDistance;
    if (!isFarEnough) return { ...lockedTo, outsideSinceMs: null };
    if (frameGap || lockedTo.outsideSinceMs === null) return { ...lockedTo, outsideSinceMs: timestampMs };
    if (timestampMs - lockedTo.outsideSinceMs >= rearmHoldMs) return null;
    return lockedTo;
  }

  private clearRearmTimer(lockedTo: WristRearmLock | null): WristRearmLock | null {
    return lockedTo ? { ...lockedTo, outsideSinceMs: null } : null;
  }

  private activeCue(elapsedMs: number): BeatBlasterCue | null {
    const cue = this.chart[this.targetIndex];
    const appearsAtMs = cue ? Math.max(0, cue.atMs - previewLeadMs) : Infinity;
    return cue && elapsedMs >= appearsAtMs && elapsedMs <= cue.atMs + BEAT_BLASTER_TIMING_WINDOW_MS ? cue : null;
  }

  private result(): BeatBlasterResult {
    const elapsedMs = this.startTimestampMs === null ? null : this.lastTimestampMs - this.startTimestampMs;
    const cue = elapsedMs === null ? null : this.activeCue(elapsedMs);
    return {
      score: this.score,
      cleared: this.targetIndex >= this.chart.length,
      misses: this.misses,
      combo: this.combo,
      feedback: this.feedback,
      resolutions: this.resolutions,
      highlight: cue && this.lastTorso ? this.targetFor(cue, this.lastTorso) : null,
    };
  }

  private assertChart(chart: readonly BeatBlasterCue[]): void {
    let previousAtMs = -Infinity;
    const ids = new Set<string>();
    for (const cue of chart) {
      if (!cue.id || ids.has(cue.id) || (cue.side !== 'left' && cue.side !== 'right')
        || !Number.isFinite(cue.atMs) || cue.atMs < 0 || cue.atMs < previousAtMs
        || cue.atMs >= BEAT_BLASTER_DURATION_MS
        || !Number.isFinite(cue.offsetXTorso) || Math.abs(cue.offsetXTorso) > 2
        || !Number.isFinite(cue.offsetYTorso) || Math.abs(cue.offsetYTorso) > 2) {
        throw new Error('Beat Blaster chart contains an invalid cue.');
      }
      previousAtMs = cue.atMs;
      ids.add(cue.id);
    }
  }
}
