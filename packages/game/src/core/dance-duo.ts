import { CONFIG as C } from './config';
import { DANCE_CUES, DANCE_DURATION_MS, DANCE_CUE_INTERVAL_MS, DanceSoloRuntime } from './dance';
import type { DanceSoloOptions, DanceSoloResult } from './dance';
import type { Landmark, PoseSample } from './types';

export const DANCE_DUO_SYNC_WINDOW_MS = 300;
export const DANCE_DUO_SYNC_BONUS = 25;

export type DanceDuoSynchronization = 'synchronized' | 'out-of-sync' | null;
export type DanceDuoPauseReason = 'manual' | 'player-one-lost' | 'player-two-lost' | 'both-lost' | 'ambiguous-players' | null;
export type DanceDuoDiagnosis =
  | 'waiting'
  | 'tracking-paused'
  | 'both-matched'
  | 'player-one-matched'
  | 'player-two-matched'
  | 'player-one-needs-correction'
  | 'player-two-needs-correction'
  | 'both-need-correction'
  | 'out-of-sync';

export interface DanceDuoOptions extends DanceSoloOptions {
  /** Maximum difference between the two completed hold times for a synchronized phrase. */
  syncWindowMs?: number;
  /** Team-only bonus. Individual scoreboards remain independent. */
  syncBonus?: number;
}

export interface DanceDuoPlayerResult {
  playerNumber: 1 | 2;
  score: number;
  completedCueCount: number;
  missedCueCount: number;
  success: boolean;
  cueResolved: boolean;
  cueScore: number | null;
  poseSimilarity: number | null;
  timingSimilarity: number | null;
  feedback: string;
  highlightedLandmarkIndexes: number[];
  trackingRecovery: boolean;
}

export interface DanceDuoResult {
  elapsedMs: number;
  remainingMs: number;
  currentCueIndex: number | null;
  currentCueId: string | null;
  currentCueName: string;
  players: readonly [DanceDuoPlayerResult, DanceDuoPlayerResult];
  playerOneScore: number;
  playerTwoScore: number;
  /** Sum of each player's one-time missed cue resolutions. */
  misses: number;
  /** Points earned only through a synchronized pair; never copied into either personal score. */
  teamScore: number;
  synchronizedCueCount: number;
  /** One-update event emitted once after both players resolve the same cue. */
  synchronization: DanceDuoSynchronization;
  syncDeltaMs: number | null;
  diagnosis: DanceDuoDiagnosis;
  feedback: string;
  paused: boolean;
  pauseReason: DanceDuoPauseReason;
  challengeCompleted: boolean;
}

interface TrackingCheck {
  valid: boolean;
  missingLandmarkIndexes: number[];
}

const REQUIRED_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24, 27, 28] as const;
const NO_CORRECTION_FEEDBACK = new Set([
  '', 'Hold that pose', 'Paused', 'Dance complete', 'Great work — phrase complete',
]);

function checkTracking(landmarks: readonly Landmark[] | undefined, confidenceThreshold: number): TrackingCheck {
  const missingLandmarkIndexes = REQUIRED_LANDMARKS.filter(index => {
    const point = landmarks?.[index];
    return !point
      || !Number.isFinite(point.x)
      || !Number.isFinite(point.y)
      || !Number.isFinite(point.visibility)
      || point.visibility < confidenceThreshold
      || (point.presence !== undefined && (!Number.isFinite(point.presence) || point.presence < confidenceThreshold));
  });
  return { valid: missingLandmarkIndexes.length === 0, missingLandmarkIndexes: [...missingLandmarkIndexes] };
}

function correction(result: DanceSoloResult): boolean {
  return !result.trackingRecovery && !NO_CORRECTION_FEEDBACK.has(result.feedback)
    && !result.feedback.startsWith('Cue complete')
    && !result.feedback.startsWith('Waiting for an updated');
}

function sortedIndexes(indexes: readonly number[]): number[] {
  return [...new Set(indexes)].sort((left, right) => left - right);
}

function pauseReasonFor(checks: readonly [TrackingCheck, TrackingCheck], manualPause: boolean, ambiguous: boolean): DanceDuoPauseReason {
  if (manualPause) return 'manual';
  if (ambiguous) return 'ambiguous-players';
  if (!checks[0].valid && !checks[1].valid) return 'both-lost';
  if (!checks[0].valid) return 'player-one-lost';
  if (!checks[1].valid) return 'player-two-lost';
  return null;
}

/**
 * Pure two-player Dance Solo session.
 *
 * Pass a PoseSample-shaped value with one shared `timestampMs` and exactly two `players` arrays.
 * The caller must keep array slot 0 and slot 1 bound to the same tracked identities on every
 * update; detector ordering alone is not a stable identity. Each player is scored independently
 * with the authored Dance Solo cues. If either player's required landmarks disappear or fall
 * below the confidence threshold, both clocks pause and both pending holds clear. Synchronized
 * completion earns a separate team bonus and never copies either player's score to the other.
 */
export class DanceDuoRuntime {
  private readonly players: readonly [DanceSoloRuntime, DanceSoloRuntime];
  private readonly confidenceThreshold: number;
  private readonly syncWindowMs: number;
  private readonly syncBonus: number;
  private readonly completedAtMs: Array<[number | null, number | null]> = DANCE_CUES.map(() => [null, null]);
  private readonly syncResolved: boolean[] = DANCE_CUES.map(() => false);
  private teamScore = 0;
  private synchronizedCueCount = 0;

  constructor(options: DanceDuoOptions = {}) {
    this.confidenceThreshold = options.confidenceThreshold ?? C.confidence;
    this.syncWindowMs = Number.isFinite(options.syncWindowMs) ? Math.max(0, options.syncWindowMs!) : DANCE_DUO_SYNC_WINDOW_MS;
    this.syncBonus = Number.isFinite(options.syncBonus) ? Math.max(0, Math.round(options.syncBonus!)) : DANCE_DUO_SYNC_BONUS;
    this.players = [new DanceSoloRuntime(options), new DanceSoloRuntime(options)];
  }

  reset(): void {
    this.players[0].reset();
    this.players[1].reset();
    this.completedAtMs.forEach(times => { times[0] = null; times[1] = null; });
    this.syncResolved.fill(false);
    this.teamScore = 0;
    this.synchronizedCueCount = 0;
  }

  update(sample: Pick<PoseSample, 'timestampMs' | 'players'>, paused = false): DanceDuoResult {
    const framePlayers = sample.players ?? [];
    const ambiguous = framePlayers.length > 2;
    const landmarks: readonly [readonly Landmark[] | undefined, readonly Landmark[] | undefined] = [framePlayers[0], framePlayers[1]];
    const checks: readonly [TrackingCheck, TrackingCheck] = [
      checkTracking(landmarks[0], this.confidenceThreshold),
      checkTracking(landmarks[1], this.confidenceThreshold),
    ];
    const pauseReason = pauseReasonFor(checks, paused, ambiguous);
    const shouldPause = pauseReason !== null;

    const first = this.players[0].update(sample.timestampMs, landmarks[0] ?? [], checks[0].valid, shouldPause);
    const second = this.players[1].update(sample.timestampMs, landmarks[1] ?? [], checks[1].valid, shouldPause);
    const soloResults: readonly [DanceSoloResult, DanceSoloResult] = [first, second];
    const elapsedMs = first.elapsedMs;
    const currentCueIndex = elapsedMs >= DANCE_DURATION_MS ? null : Math.floor(elapsedMs / DANCE_CUE_INTERVAL_MS);

    let synchronization: DanceDuoSynchronization = null;
    let syncDeltaMs: number | null = null;
    if (!shouldPause && currentCueIndex !== null) {
      for (const playerIndex of [0, 1] as const) {
        const result = soloResults[playerIndex];
        if (result.success && result.currentCueIndex === currentCueIndex) {
          this.completedAtMs[currentCueIndex][playerIndex] = elapsedMs;
        }
      }
      const [playerOneCompletedAt, playerTwoCompletedAt] = this.completedAtMs[currentCueIndex];
      if (!this.syncResolved[currentCueIndex] && playerOneCompletedAt !== null && playerTwoCompletedAt !== null) {
        syncDeltaMs = Math.abs(playerOneCompletedAt - playerTwoCompletedAt);
        synchronization = syncDeltaMs <= this.syncWindowMs ? 'synchronized' : 'out-of-sync';
        this.syncResolved[currentCueIndex] = true;
        if (synchronization === 'synchronized') {
          this.synchronizedCueCount += 1;
          this.teamScore += this.syncBonus;
        }
      }
    }

    const playerResults: readonly [DanceDuoPlayerResult, DanceDuoPlayerResult] = [
      this.playerResult(1, first, checks[0], pauseReason),
      this.playerResult(2, second, checks[1], pauseReason),
    ];
    const diagnosis = this.diagnose(soloResults, pauseReason, synchronization);
    const feedback = this.teamFeedback(playerResults, diagnosis, synchronization, pauseReason);
    const cue = currentCueIndex === null ? null : DANCE_CUES[currentCueIndex];

    return {
      elapsedMs,
      remainingMs: Math.max(0, DANCE_DURATION_MS - elapsedMs),
      currentCueIndex,
      currentCueId: cue?.id ?? null,
      currentCueName: cue?.name ?? (elapsedMs >= DANCE_DURATION_MS ? 'Complete' : 'Dance Duo'),
      players: playerResults,
      playerOneScore: first.score,
      playerTwoScore: second.score,
      misses: first.missedCueCount + second.missedCueCount,
      teamScore: this.teamScore,
      synchronizedCueCount: this.synchronizedCueCount,
      synchronization,
      syncDeltaMs,
      diagnosis,
      feedback,
      paused: shouldPause,
      pauseReason,
      challengeCompleted: elapsedMs >= DANCE_DURATION_MS,
    };
  }

  private playerResult(
    playerNumber: 1 | 2,
    solo: DanceSoloResult,
    tracking: TrackingCheck,
    pauseReason: DanceDuoPauseReason,
  ): DanceDuoPlayerResult {
    let feedback = solo.feedback;
    let trackingRecovery = solo.trackingRecovery;
    let highlights = solo.highlightedLandmarkIndexes;

    if (pauseReason === 'manual') feedback = 'Paused';
    else if (pauseReason !== null) {
      if (pauseReason === 'ambiguous-players') {
        feedback = 'Paused while player tracking is clarified.';
        trackingRecovery = false;
        highlights = [];
      } else if (!tracking.valid) {
        feedback = 'Keep your full body visible. Both players are paused.';
        trackingRecovery = true;
        highlights = tracking.missingLandmarkIndexes.length > 0 ? tracking.missingLandmarkIndexes : [...REQUIRED_LANDMARKS];
      } else {
        const lostPlayerNumber = pauseReason === 'player-one-lost' ? 1 : 2;
        feedback = `Paused while Player ${lostPlayerNumber} returns to the frame`;
        trackingRecovery = false;
        highlights = [];
      }
    }

    return {
      playerNumber,
      score: solo.score,
      completedCueCount: solo.completedCueCount,
      missedCueCount: solo.missedCueCount,
      success: solo.success,
      cueResolved: solo.cueResolved,
      cueScore: solo.cueScore,
      poseSimilarity: solo.poseSimilarity,
      timingSimilarity: solo.timingSimilarity,
      feedback,
      highlightedLandmarkIndexes: sortedIndexes(highlights),
      trackingRecovery,
    };
  }

  private diagnose(
    results: readonly [DanceSoloResult, DanceSoloResult],
    pauseReason: DanceDuoPauseReason,
    synchronization: DanceDuoSynchronization,
  ): DanceDuoDiagnosis {
    if (pauseReason !== null) return 'tracking-paused';
    if (synchronization === 'synchronized') return 'both-matched';
    if (synchronization === 'out-of-sync') return 'out-of-sync';
    const [one, two] = results;
    const oneNeedsCorrection = correction(one);
    const twoNeedsCorrection = correction(two);
    if (oneNeedsCorrection && twoNeedsCorrection) return 'both-need-correction';
    if (oneNeedsCorrection) return 'player-one-needs-correction';
    if (twoNeedsCorrection) return 'player-two-needs-correction';
    if (one.cueResolved && two.cueResolved) return 'both-matched';
    if (one.cueResolved) return 'player-one-matched';
    if (two.cueResolved) return 'player-two-matched';
    return 'waiting';
  }

  private teamFeedback(
    players: readonly [DanceDuoPlayerResult, DanceDuoPlayerResult],
    diagnosis: DanceDuoDiagnosis,
    synchronization: DanceDuoSynchronization,
    pauseReason: DanceDuoPauseReason,
  ): string {
    if (pauseReason === 'manual') return 'Paused. Both players will resume together.';
    if (pauseReason === 'both-lost') return 'Both players are out of frame. Step back into view to continue.';
    if (pauseReason === 'ambiguous-players') return 'Player tracking is unclear. Keep some space between you and resume together.';
    if (pauseReason === 'player-one-lost') return 'Player 1 is out of frame. Both players are paused.';
    if (pauseReason === 'player-two-lost') return 'Player 2 is out of frame. Both players are paused.';
    if (synchronization === 'synchronized') return `Synchronized! +${this.syncBonus} team points.`;
    if (synchronization === 'out-of-sync') return 'Both players matched, but not together. Hold the next move at the same time.';
    if (diagnosis === 'player-one-needs-correction') return `Player 1: ${players[0].feedback}`;
    if (diagnosis === 'player-two-needs-correction') return `Player 2: ${players[1].feedback}`;
    if (diagnosis === 'both-need-correction') return `Player 1: ${players[0].feedback}. Player 2: ${players[1].feedback}`;
    if (diagnosis === 'player-one-matched') return 'Player 1 matched. Player 2, keep holding the pose.';
    if (diagnosis === 'player-two-matched') return 'Player 2 matched. Player 1, keep holding the pose.';
    if (diagnosis === 'both-matched') return 'Both players matched the pose.';
    return 'Both players: copy the coach and hold the pose together.';
  }
}
