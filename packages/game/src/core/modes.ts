import { GameEngine, makeWaves } from './game';
import { DodgeArenaRuntime, makeDodgeWaves as makeAuthoredDodgeWaves } from './dodge';
import { SixSevenRecognizer } from './six-seven';
import { BeatBlasterRuntime, BEAT_BLASTER_CHART } from './blaster';
import type { BeatBlasterHighlight, BeatBlasterInput, BeatBlasterResult } from './blaster';
import { DanceSoloRuntime, DANCE_CUES } from './dance';
import { DanceDuoRuntime } from './dance-duo';
import { MirrorChallengeRuntime } from './mirror';
import type { MirrorChallengeResult } from './mirror';
import { RhythmRunRuntime } from './rhythm';
import { RHYTHM_PICKUP_WINDOW_MS, type RhythmFrame, type RhythmSnapshot } from './rhythm-types';
import type { GameMode, GestureAnalysis, GameEvent, Landmark, PoseSample, Wave } from './types';

export interface ModeDefinition {
  id: GameMode;
  title: string;
  subtitle: string;
  instruction: string;
  icon: string;
  music: boolean;
  twoPlayers?: boolean;
}

export const GAME_MODES: readonly ModeDefinition[] = [
  { id: 'party-race', title: 'Party Race', subtitle: 'Race friends and bots', instruction: 'Lean to steer freely. Raise both hands to jump. Reach the finish together.', icon: '⚑', music: false },
  { id: 'classic-run', title: 'Classic Run', subtitle: 'Run the skyway', instruction: 'Lean to change lanes. Raise both hands to jump.', icon: '↗', music: false },
  { id: 'rhythm-run', title: 'Rhythm Run', subtitle: 'Collect stars on the beat', instruction: 'Lean to collect low stars. Jump to collect high stars.', icon: '★', music: true },
  { id: 'mirror-challenge', title: 'Mirror Challenge', subtitle: 'Copy the coach', instruction: 'Match the coach’s pose and hold it when the pulse lands.', icon: '◉', music: true },
  { id: 'dodge-arena', title: 'Dodge Arena', subtitle: 'Keep your combo alive', instruction: 'Watch the warning and lean into a safe lane.', icon: '⚡', music: false },
  { id: 'beat-blaster', title: 'Beat Blaster', subtitle: 'Reach for the targets', instruction: 'Extend the matching arm toward each glowing target on the beat.', icon: '✦', music: true },
  { id: 'dance-party', title: 'Dance Party · Solo', subtitle: 'Copy a short routine', instruction: 'Follow the left, right and hands-up choreography in time.', icon: '✺', music: true },
  { id: 'six-seven', title: 'Six-Seven Challenge', subtitle: 'Alternate hands', instruction: 'Raise one hand, then the other: each pair counts as 1 rep. Keep alternating.', icon: '67', music: false },
  { id: 'dance-duo', title: 'Dance Party · Duo', subtitle: 'Two players, one routine', instruction: 'Stand side by side. Both players copy the same cue together.', icon: 'Ⅱ', music: true, twoPlayers: true },
];

// Every mode has a complete camera setup, scoring and result/replay flow.
export const PLAYABLE_MODES = GAME_MODES;

export type MoveCue = 'LEAN_LEFT' | 'LEAN_RIGHT' | 'HANDS_UP_JUMP' | 'BLAST_LEFT' | 'BLAST_RIGHT';
export interface ModeCue { atMs: number; move: MoveCue; resolved: boolean }
export interface ModeSnapshot {
  score: number;
  cleared: number;
  misses: number;
  collisions: number;
  combo: number;
  bestCombo: number;
  playerOneScore: number;
  playerTwoScore: number;
  activeCue: ModeCue | null;
  feedback: string;
  feedbackKind: 'good' | 'hint' | 'neutral';
  sixSevenCount: number;
  blasterHighlight: BeatBlasterHighlight | null;
  poseCueName: string | null;
  poseCueIndex: number | null;
  poseCueCount: number;
  posePhase: string | null;
  highlightedLandmarkIndexes: number[];
  playerOneHighlights: number[];
  playerTwoHighlights: number[];
  playerOneFeedback: string;
  playerTwoFeedback: string;
  teamScore: number;
  synchronizedCueCount: number;
  trackingRecovery: boolean;
  rhythm: RhythmSnapshot | null;
  mirror: MirrorChallengeResult | null;
}

const chartMoves: Record<'rhythm-run' | 'beat-blaster', MoveCue[]> = {
  'rhythm-run': ['LEAN_LEFT', 'HANDS_UP_JUMP', 'LEAN_RIGHT', 'HANDS_UP_JUMP'],
  'beat-blaster': ['BLAST_LEFT', 'BLAST_RIGHT', 'BLAST_LEFT', 'BLAST_RIGHT'],
};

const intervalMs: Record<keyof typeof chartMoves, number> = {
  'rhythm-run': 2000, 'beat-blaster': 1600,
};

export function buildModeChart(mode: GameMode, durationMs: number): ModeCue[] {
  if (!(mode in chartMoves)) return [];
  if (mode === 'beat-blaster') {
    return BEAT_BLASTER_CHART
      .filter(cue => cue.atMs < durationMs)
      .map(cue => ({ atMs: cue.atMs, move: cue.side === 'left' ? 'BLAST_LEFT' : 'BLAST_RIGHT', resolved: false }));
  }
  const key = mode as keyof typeof chartMoves;
  const interval = intervalMs[key];
  const firstCueMs = mode === 'rhythm-run' ? 4_000 : 2_600;
  const chart: ModeCue[] = [];
  for (let atMs = firstCueMs; atMs < durationMs - 500; atMs += interval) {
    chart.push({ atMs, move: chartMoves[key][chart.length % chartMoves[key].length], resolved: false });
  }
  return chart;
}

const invalidBlasterTorso = { centerX: Number.NaN, centerY: Number.NaN, length: 0 };

/**
 * Converts MediaPipe's unmirrored normalized landmarks into the coordinate
 * system used by the camera preview and BeatBlasterRuntime. Anatomical sides
 * remain unchanged; only x is mirrored. Invalid torso data is passed through as
 * an invalid calibration so the runtime can clear entry history safely.
 */
export function makeBeatBlasterInput(sample: PoseSample | null | undefined): BeatBlasterInput {
  const timestampMs = sample && Number.isFinite(sample.timestampMs) ? sample.timestampMs : Number.NaN;
  const landmarks = sample?.landmarks;
  if (!landmarks || landmarks.length <= 24) {
    return { timestampMs, torso: invalidBlasterTorso, leftWrist: null, rightWrist: null };
  }

  const point = (index: number) => validBlasterPoint(landmarks[index]);
  const leftWrist = point(15);
  const rightWrist = point(16);
  const leftShoulder = point(11);
  const rightShoulder = point(12);
  const leftHip = point(23);
  const rightHip = point(24);

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return { timestampMs, torso: invalidBlasterTorso, leftWrist, rightWrist };
  }

  const shoulderX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipX = (leftHip.x + rightHip.x) / 2;
  const hipY = (leftHip.y + rightHip.y) / 2;
  const torso = {
    centerX: 1 - (shoulderX + hipX) / 2,
    centerY: (shoulderY + hipY) / 2,
    length: Math.hypot((1 - shoulderX) - (1 - hipX), shoulderY - hipY),
  };
  return { timestampMs, torso, leftWrist, rightWrist };
}

function validBlasterPoint(landmark: Landmark | undefined) {
  if (!landmark) return null;
  const confidence = Math.min(landmark.visibility, landmark.presence ?? landmark.visibility);
  if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)
    || landmark.x < 0 || landmark.x > 1 || landmark.y < 0 || landmark.y > 1
    || !Number.isFinite(confidence) || confidence < 0.6 || confidence > 1) {
    return null;
  }
  return { x: 1 - landmark.x, y: landmark.y, confidence };
}

export function makeDodgeWaves(durationMs: number): Wave[] {
  return makeAuthoredDodgeWaves()
    .filter(wave => wave.atMs < durationMs)
    .map(wave => ({
      id: wave.id,
      atMs: wave.atMs,
      warningAtMs: wave.warningAtMs,
      obstacles: wave.obstacles.map(obstacle => ({ ...obstacle })),
      resolved: false,
    }));
}

export function configureGameForMode(game: GameEngine, mode: GameMode): void {
  // Recovery must preserve resolved waves and their scores. A new run calls reset first.
  if (game.elapsedMs > 0) return;
  if (mode === 'classic-run') game.waves = makeWaves(game.durationMs);
  else if (mode === 'dodge-arena') game.waves = makeDodgeWaves(game.durationMs);
  else game.waves = [];
}

const moveName: Record<MoveCue, string> = {
  LEAN_LEFT: 'Lean left', LEAN_RIGHT: 'Lean right', HANDS_UP_JUMP: 'Raise both hands',
  BLAST_LEFT: 'Reach left', BLAST_RIGHT: 'Reach right',
};

function poseMatches(move: MoveCue, pose: GestureAnalysis): boolean {
  if (move === 'LEAN_LEFT') return pose.lane === -1;
  if (move === 'LEAN_RIGHT') return pose.lane === 1;
  if (move === 'HANDS_UP_JUMP') return pose.handsUp;
  const l = pose.landmarks;
  if (l.length < 25) return false;
  const shoulderWidth = Math.abs(l[11].x - l[12].x);
  const leftReach = l[15].x > l[11].x + shoulderWidth * 0.42;
  const rightReach = l[16].x < l[12].x - shoulderWidth * 0.42;
  return move === 'BLAST_LEFT' ? leftReach : rightReach;
}

function reachEdge(move: MoveCue, pose: GestureAnalysis, previous: GestureAnalysis | null): boolean {
  return poseMatches(move, pose) && (!previous || !poseMatches(move, previous));
}

export class ModeEngine {
  readonly chart: ModeCue[];
  readonly rhythm: RhythmRunRuntime | null;
  score = 0;
  cleared = 0;
  misses = 0;
  collisions = 0;
  combo = 0;
  bestCombo = 0;
  playerOneScore = 0;
  playerTwoScore = 0;
  sixSevenCount = 0;
  feedback = '';
  feedbackKind: ModeSnapshot['feedbackKind'] = 'neutral';
  private previous: GestureAnalysis | null = null;
  private readonly sixSeven = new SixSevenRecognizer();
  private readonly dodge: DodgeArenaRuntime | null;
  private readonly blaster: BeatBlasterRuntime | null;
  private readonly mirror: MirrorChallengeRuntime | null;
  private lastMirrorResult: MirrorChallengeResult | null = null;
  private readonly danceSolo: DanceSoloRuntime | null;
  private readonly danceDuo: DanceDuoRuntime | null;
  private lastBlasterResult: BeatBlasterResult | null = null;
  private lastPoseElapsedMs = 0;
  private readonly missedMirrorTasks = new Set<number>();
  private readonly completedMirrorTasks = new Set<number>();
  private poseFinished = false;
  private completedDanceCues = 0;
  private poseCueName: string | null = null;
  private poseCueIndex: number | null = null;
  private poseCueCount = 0;
  private posePhase: string | null = null;
  private highlightedLandmarkIndexes: number[] = [];
  private playerOneHighlights: number[] = [];
  private playerTwoHighlights: number[] = [];
  private playerOneFeedback = '';
  private playerTwoFeedback = '';
  private teamScore = 0;
  private synchronizedCueCount = 0;
  private trackingRecovery = false;
  private lastDodgeElapsedMs = 0;
  private lastFeedbackAt = -Infinity;

  constructor(readonly mode: GameMode, durationMs: number) {
    this.chart = buildModeChart(mode, durationMs);
    this.rhythm = mode === 'rhythm-run' ? new RhythmRunRuntime(durationMs) : null;
    this.dodge = mode === 'dodge-arena' ? new DodgeArenaRuntime(durationMs) : null;
    this.blaster = mode === 'beat-blaster'
      ? new BeatBlasterRuntime(BEAT_BLASTER_CHART.filter(cue => cue.atMs < durationMs))
      : null;
    this.mirror = mode === 'mirror-challenge' ? new MirrorChallengeRuntime() : null;
    this.danceSolo = mode === 'dance-party' ? new DanceSoloRuntime() : null;
    this.danceDuo = mode === 'dance-duo' ? new DanceDuoRuntime() : null;
  }

  reset(): void {
    this.score = this.cleared = this.misses = this.combo = this.bestCombo = 0;
    this.collisions = 0;
    this.playerOneScore = this.playerTwoScore = this.sixSevenCount = 0;
    for (const cue of this.chart) cue.resolved = false;
    this.previous = null;
    this.sixSeven.reset();
    this.rhythm?.reset();
    this.dodge?.reset();
    this.blaster?.reset();
    this.mirror?.reset();
    this.lastMirrorResult = null;
    this.danceSolo?.reset();
    this.danceDuo?.reset();
    this.lastBlasterResult = null;
    this.lastPoseElapsedMs = 0;
    this.missedMirrorTasks.clear();
    this.completedMirrorTasks.clear();
    this.poseFinished = false;
    this.completedDanceCues = 0;
    this.poseCueName = null;
    this.poseCueIndex = null;
    this.poseCueCount = 0;
    this.posePhase = null;
    this.highlightedLandmarkIndexes = [];
    this.playerOneHighlights = [];
    this.playerTwoHighlights = [];
    this.playerOneFeedback = '';
    this.playerTwoFeedback = '';
    this.teamScore = 0;
    this.synchronizedCueCount = 0;
    this.trackingRecovery = false;
    this.lastDodgeElapsedMs = 0;
    this.lastFeedbackAt = -Infinity;
    this.feedback = '';
    this.feedbackKind = 'neutral';
  }

  update(elapsedMs: number, primary: GestureAnalysis, secondary?: GestureAnalysis | null, blasterInput?: BeatBlasterInput, poseSample?: PoseSample, rhythmFrame?: RhythmFrame): GameEvent[] {
    if (this.poseFinished && (this.danceSolo || this.danceDuo)) return [];
    if (this.mode === 'rhythm-run' && this.rhythm) {
      const events = this.rhythm.update(elapsedMs, rhythmFrame ?? {
        lane: primary.lane,
        jumpHeight: 0,
        trackingValid: false,
      });
      this.syncRhythm(this.rhythm.snapshot(elapsedMs));
      this.previous = primary;
      return events;
    }
    if (this.mode === 'beat-blaster' && this.blaster) {
      if (!blasterInput) return [];
      // Use active session time so recovery pauses and the pre-run countdown do
      // not age target windows while camera timestamps continue advancing.
      const result = this.blaster.update({ ...blasterInput, timestampMs: elapsedMs });
      this.lastBlasterResult = result;
      this.score = result.score;
      this.misses = result.misses;
      this.combo = result.combo;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      const resolutions = result.resolutions;
      const hits = resolutions.filter(resolution => resolution.points > 0);
      this.cleared += hits.length;
      for (const resolution of resolutions) {
        const chartIndex = Number(resolution.cueId.replace(/^blaster-/, '')) - 1;
        if (Number.isInteger(chartIndex) && chartIndex >= 0 && this.chart[chartIndex]) this.chart[chartIndex].resolved = true;
      }
      this.feedback = result.feedback;
      this.feedbackKind = hits.length ? 'good' : result.feedback ? 'hint' : 'neutral';
      this.lastFeedbackAt = elapsedMs;
      return hits.length ? ['clear'] : [];
    }
    if (this.mode === 'mirror-challenge' && this.mirror) return this.updateMirror(elapsedMs, primary);
    if (this.mode === 'dance-party' && this.danceSolo) return this.updateDanceSolo(elapsedMs, primary);
    if (this.mode === 'dance-duo' && this.danceDuo) return this.updateDanceDuo(elapsedMs, poseSample);
    if (this.mode === 'six-seven') {
      const result = this.sixSeven.update(elapsedMs, primary.landmarks, primary.trackingValid && primary.handsTracked);
      this.sixSevenCount = result.count;
      if (result.completed) {
        this.cleared++;
        this.combo++;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        this.score += 1;
        this.playerOneScore += 1;
        this.setFeedback(result.feedback, 'good', elapsedMs);
        this.previous = primary;
        return ['clear'];
      }
      if (result.feedback !== this.feedback) this.setFeedback(result.feedback, 'neutral', elapsedMs);
      this.previous = primary;
      return [];
    }
    if (this.mode === 'dodge-arena' && this.dodge) {
      if (!primary.trackingValid) return [];
      const deltaMs = Math.max(0, elapsedMs - this.lastDodgeElapsedMs);
      if (deltaMs > 300) {
        this.lastDodgeElapsedMs = elapsedMs;
        this.feedback = 'Tracking paused. Find a clear lane when the camera is steady.';
        this.feedbackKind = 'hint';
        return [];
      }
      const dodgeEvents = this.dodge.update(deltaMs, { lane: primary.lane });
      const dodge = this.dodge.snapshot();
      this.lastDodgeElapsedMs = dodge.elapsedMs;
      this.score = dodge.score;
      this.cleared = dodge.cleared;
      this.misses = dodge.misses;
      this.collisions = dodge.collisions;
      this.combo = dodge.combo;
      this.bestCombo = dodge.bestCombo;
      if (dodgeEvents.includes('hit')) this.setFeedback('Collision. Lean into a different clear lane.', 'hint', elapsedMs);
      else if (dodgeEvents.includes('clear')) this.setFeedback('Safe lane. Keep the combo going.', 'good', elapsedMs);
      this.previous = primary;
      const events: GameEvent[] = [];
      if (dodgeEvents.includes('hit')) events.push('hit');
      if (dodgeEvents.includes('clear')) events.push('clear');
      if (dodgeEvents.includes('finish')) events.push('finish');
      return events;
    }
    if (!primary.trackingValid) return [];
    const events: GameEvent[] = [];
    const isPoseRound = this.mode === 'mirror-challenge' || this.mode === 'dance-party' || this.mode === 'dance-duo';
    const earlyWindowMs = isPoseRound ? 950 : 700;
    const lateWindowMs = 550;
    const activeCue = this.chart.find(item => !item.resolved && elapsedMs >= item.atMs - earlyWindowMs && elapsedMs <= item.atMs + lateWindowMs);

    // Expire every missed cue before evaluating the one active cue. Keeping expiry
    // outside the active window prevents the first miss from blocking the chart.
    for (const cue of this.chart) {
      if (cue.resolved) continue;
      if (elapsedMs > cue.atMs + lateWindowMs) {
        const text = this.mode === 'beat-blaster'
          ? `Extend your ${cue.move === 'BLAST_LEFT' ? 'left' : 'right'} arm toward the target.`
          : isPoseRound
            ? 'Match the coach’s pose on the next beat.'
            : 'Wait for the next cue, then move with the beat.';
        this.registerMiss(cue, text);
        continue;
      }
      if (cue !== activeCue) break;

      const lateBy = elapsedMs - cue.atMs;
      const activeText = moveName[cue.move];
      if (isPoseRound) {
        const oneMatches = poseMatches(cue.move, primary);
        const twoMatches = this.mode !== 'dance-duo' || (!!secondary?.trackingValid && poseMatches(cue.move, secondary));
        if (elapsedMs >= cue.atMs - 120 && oneMatches && twoMatches) {
          if (this.registerHit(cue, elapsedMs)) events.push('clear');
        } else if (elapsedMs > cue.atMs - 120 && (!oneMatches || !twoMatches)) {
          this.setFeedback(this.mode === 'dance-duo' && oneMatches ? 'Both players: match the pose together.' : `Try it now: ${activeText.toLowerCase()}.`, 'hint', elapsedMs);
        }
      } else if (this.mode === 'beat-blaster') {
        if (reachEdge(cue.move, primary, this.previous) && Math.abs(lateBy) <= lateWindowMs) {
          if (this.registerHit(cue, elapsedMs)) events.push('clear');
        }
      } else {
        const eventMatch = cue.move === 'LEAN_LEFT'
          ? primary.lane === -1 && this.previous?.lane !== -1
          : cue.move === 'LEAN_RIGHT'
            ? primary.lane === 1 && this.previous?.lane !== 1
            : cue.move === 'HANDS_UP_JUMP' && primary.jumpTriggered;
        if (eventMatch && Math.abs(lateBy) <= lateWindowMs) {
          if (this.registerHit(cue, elapsedMs)) events.push('clear');
        }
      }
      break;
    }
    this.previous = primary;
    return events;
  }

  /** Close unresolved dance cues when the owning session reaches its deadline.
   * Camera time can lag behind session time after startup, recovery or a frame gap.
   * Finalization never awards a pose or synchronization bonus from a stale frame.
   */
  finish(): void {
    if (this.mode === 'rhythm-run' && this.rhythm) {
      this.rhythm.finish();
      this.syncRhythm(this.rhythm.snapshot(0));
      return;
    }
    if (this.mode !== 'dance-party' && this.mode !== 'dance-duo') return;
    if (this.poseFinished) return;
    this.misses = DANCE_CUES.length * (this.mode === 'dance-duo' ? 2 : 1) - this.completedDanceCues;
    this.poseFinished = true;
    this.poseCueName = 'Complete';
    this.poseCueIndex = null;
    this.poseCueCount = DANCE_CUES.length;
    this.posePhase = 'complete';
    this.trackingRecovery = false;
    this.feedback = this.playerOneFeedback = 'Dance complete';
    this.playerTwoFeedback = this.mode === 'dance-duo' ? 'Dance complete' : '';
    this.feedbackKind = 'neutral';
    this.highlightedLandmarkIndexes = [];
    this.playerOneHighlights = [];
    this.playerTwoHighlights = [];
  }

  snapshot(elapsedMs: number): ModeSnapshot {
    const rhythm = this.rhythm?.snapshot(elapsedMs) ?? null;
    if (rhythm) this.syncRhythm(rhythm);
    const next = this.chart.find(item => !item.resolved) ?? null;
    const isPoseRound = this.mode === 'mirror-challenge' || this.mode === 'dance-party' || this.mode === 'dance-duo';
    const earlyWindowMs = isPoseRound ? 950 : this.mode === 'rhythm-run' ? RHYTHM_PICKUP_WINDOW_MS : 700;
    const lateWindowMs = this.mode === 'rhythm-run' ? RHYTHM_PICKUP_WINDOW_MS : 550;
    const activeCue = next && elapsedMs >= next.atMs - earlyWindowMs && elapsedMs <= next.atMs + lateWindowMs ? next : null;
    return { score: this.score, cleared: this.cleared, misses: this.misses, collisions: this.collisions, combo: this.combo, bestCombo: this.bestCombo,
      playerOneScore: this.playerOneScore, playerTwoScore: this.playerTwoScore, activeCue, feedback: rhythm?.feedback ?? this.feedback,
      feedbackKind: rhythm?.feedbackKind ?? this.feedbackKind, sixSevenCount: this.sixSevenCount,
      blasterHighlight: this.lastBlasterResult?.highlight ?? null,
      poseCueName: this.poseCueName, poseCueIndex: this.poseCueIndex, poseCueCount: this.poseCueCount, posePhase: this.posePhase,
      highlightedLandmarkIndexes: [...this.highlightedLandmarkIndexes],
      playerOneHighlights: [...this.playerOneHighlights], playerTwoHighlights: [...this.playerTwoHighlights],
      playerOneFeedback: this.playerOneFeedback, playerTwoFeedback: this.playerTwoFeedback,
      teamScore: this.teamScore, synchronizedCueCount: this.synchronizedCueCount, trackingRecovery: this.trackingRecovery, rhythm,
      mirror: this.lastMirrorResult ? {
        ...this.lastMirrorResult,
        highlightedLandmarkIndexes: [...this.lastMirrorResult.highlightedLandmarkIndexes],
      } : null };
  }

  private syncRhythm(snapshot: RhythmSnapshot): void {
    this.score = snapshot.score;
    this.cleared = snapshot.cleared;
    this.misses = snapshot.misses;
    this.combo = snapshot.combo;
    this.bestCombo = snapshot.bestCombo;
    this.playerOneScore = snapshot.score;
    this.feedback = snapshot.feedback;
    this.feedbackKind = snapshot.feedbackKind;
    const resolvedAtMs = new Set(snapshot.stars
      .filter(star => star.status !== 'upcoming')
      .map(star => star.atMs));
    for (const cue of this.chart) cue.resolved = resolvedAtMs.has(cue.atMs);
  }

  private updateMirror(elapsedMs: number, primary: GestureAnalysis): GameEvent[] {
    const timestampMs = this.poseTimestamp(elapsedMs);
    const result = this.mirror!.update(timestampMs, primary.landmarks, primary.trackingValid);
    this.lastMirrorResult = result;
    this.score = result.score;
    this.cleared = result.completedTaskCount;
    this.poseCueName = result.taskName;
    this.poseCueIndex = result.taskIndex;
    this.poseCueCount = result.totalTasks;
    this.posePhase = result.taskPhase;
    this.highlightedLandmarkIndexes = [...result.highlightedLandmarkIndexes];
    this.playerOneHighlights = [...result.highlightedLandmarkIndexes];
    this.playerTwoHighlights = [];
    this.playerOneFeedback = result.feedback;
    this.playerTwoFeedback = '';
    this.trackingRecovery = !primary.trackingValid || result.feedback.startsWith('Step back');

    const events: GameEvent[] = [];
    if (result.success) {
      if (result.taskIndex !== null) this.completedMirrorTasks.add(result.taskIndex);
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      events.push('clear');
    }
    if (result.taskPhase === 'result' && result.taskIndex !== null
      && !this.completedMirrorTasks.has(result.taskIndex)
      && !this.missedMirrorTasks.has(result.taskIndex)) {
      this.missedMirrorTasks.add(result.taskIndex);
      this.misses++;
      this.combo = 0;
    }
    this.feedback = result.feedback;
    this.feedbackKind = result.success || result.feedback.startsWith('Task complete')
      ? 'good'
      : this.trackingRecovery || result.highlightedLandmarkIndexes.length > 0 || result.taskPhase === 'result'
        ? 'hint'
        : 'neutral';
    if (result.challengeCompleted && !this.poseFinished) {
      this.poseFinished = true;
      events.push('finish');
    }
    return events;
  }

  private updateDanceSolo(elapsedMs: number, primary: GestureAnalysis): GameEvent[] {
    const timestampMs = this.poseTimestamp(elapsedMs);
    const result = this.danceSolo!.update(timestampMs, primary.landmarks, primary.trackingValid);
    this.score = result.score;
    this.cleared = result.completedCueCount;
    this.completedDanceCues = result.completedCueCount;
    this.misses = result.missedCueCount;
    this.playerOneScore = result.score;
    this.poseCueName = result.currentCueName;
    this.poseCueIndex = result.currentCueIndex;
    this.poseCueCount = DANCE_CUES.length;
    this.posePhase = result.challengeCompleted ? 'complete' : result.trackingRecovery ? 'recovery' : result.cueResolved ? 'result' : 'attempt';
    this.highlightedLandmarkIndexes = [...result.highlightedLandmarkIndexes];
    this.playerOneHighlights = [...result.highlightedLandmarkIndexes];
    this.playerTwoHighlights = [];
    this.playerOneFeedback = result.feedback;
    this.playerTwoFeedback = '';
    this.trackingRecovery = result.trackingRecovery;
    this.feedback = result.feedback;
    this.feedbackKind = result.success ? 'good'
      : result.trackingRecovery || (result.feedback !== '' && result.feedback !== 'Hold that pose'
        && result.feedback !== 'Cue complete — get ready for the next move' && result.feedback !== 'Dance complete')
        ? 'hint' : 'neutral';

    const events: GameEvent[] = [];
    if (result.success) {
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      events.push('clear');
    }
    if (result.challengeCompleted && !this.poseFinished) {
      this.poseFinished = true;
      events.push('finish');
    }
    return events;
  }

  private updateDanceDuo(elapsedMs: number, poseSample?: PoseSample): GameEvent[] {
    const timestampMs = this.poseTimestamp(elapsedMs);
    // Duo is intentionally sourced from worker-assigned player slots. A primary
    // pose alone cannot silently count as two players.
    const sample = { timestampMs, players: poseSample?.players ?? [] };
    const result = this.danceDuo!.update(sample);
    this.playerOneScore = result.playerOneScore;
    this.playerTwoScore = result.playerTwoScore;
    this.misses = result.misses;
    this.teamScore = result.teamScore;
    this.synchronizedCueCount = result.synchronizedCueCount;
    this.score = result.playerOneScore + result.playerTwoScore + result.teamScore;
    this.cleared = Math.min(result.players[0].completedCueCount, result.players[1].completedCueCount);
    this.completedDanceCues = result.players[0].completedCueCount + result.players[1].completedCueCount;
    this.combo = result.synchronizedCueCount;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.poseCueName = result.currentCueName;
    this.poseCueIndex = result.currentCueIndex;
    this.poseCueCount = DANCE_CUES.length;
    this.posePhase = result.challengeCompleted ? 'complete' : result.paused ? 'paused' : 'attempt';
    this.playerOneHighlights = [...result.players[0].highlightedLandmarkIndexes];
    this.playerTwoHighlights = [...result.players[1].highlightedLandmarkIndexes];
    this.highlightedLandmarkIndexes = [...this.playerOneHighlights, ...this.playerTwoHighlights]
      .filter((index, position, all) => all.indexOf(index) === position)
      .sort((left, right) => left - right);
    this.playerOneFeedback = result.players[0].feedback;
    this.playerTwoFeedback = result.players[1].feedback;
    this.trackingRecovery = result.paused && result.pauseReason !== 'ambiguous-players';
    this.feedback = result.feedback;
    this.feedbackKind = result.synchronization === 'synchronized' || result.players.some(player => player.success)
      && !result.paused && result.diagnosis !== 'player-one-needs-correction' && result.diagnosis !== 'player-two-needs-correction'
      ? 'good'
      : result.paused || result.synchronization === 'out-of-sync'
        || result.diagnosis === 'player-one-needs-correction' || result.diagnosis === 'player-two-needs-correction'
        || result.diagnosis === 'both-need-correction'
        ? 'hint' : 'neutral';

    const events: GameEvent[] = [];
    if (result.players.some(player => player.success)) events.push('clear');
    if (result.challengeCompleted && !this.poseFinished) {
      this.poseFinished = true;
      events.push('finish');
    }
    return events;
  }

  private poseTimestamp(elapsedMs: number): number {
    const candidate = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : this.lastPoseElapsedMs;
    this.lastPoseElapsedMs = Math.max(this.lastPoseElapsedMs, candidate);
    return this.lastPoseElapsedMs;
  }

  private registerHit(cue: ModeCue, elapsedMs: number): boolean {
    if (cue.resolved) return false;
    cue.resolved = true;
    const error = Math.abs(elapsedMs - cue.atMs);
    const points = error <= 180 ? 100 : error <= 360 ? 75 : 50;
    this.cleared++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.score += points;
    this.playerOneScore += points;
    if (this.mode === 'dance-duo') this.playerTwoScore += points;
    this.setFeedback(error <= 180 ? 'Perfect!' : error <= 360 ? 'On beat!' : 'Move recognized!', 'good', elapsedMs);
    return true;
  }

  private registerMiss(cue: ModeCue, text: string): void {
    if (cue.resolved) return;
    cue.resolved = true;
    this.misses++;
    this.combo = 0;
    this.setFeedback(text, 'hint', cue.atMs + 550);
  }

  private setFeedback(text: string, kind: ModeSnapshot['feedbackKind'], elapsedMs: number): void {
    if (elapsedMs - this.lastFeedbackAt < 350 && text !== 'Perfect!') return;
    this.feedback = text;
    this.feedbackKind = kind;
    this.lastFeedbackAt = elapsedMs;
  }
}
