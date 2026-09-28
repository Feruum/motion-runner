import { GameEngine, makeWaves } from './game';
import { SixSevenRecognizer } from './six-seven';
import type { GameMode, GestureAnalysis, GameEvent, Lane, Wave } from './types';

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
  { id: 'classic-run', title: 'Classic Run', subtitle: 'Run the skyway', instruction: 'Lean to change lanes. Raise both hands to jump.', icon: '↗', music: false },
  { id: 'rhythm-run', title: 'Rhythm Run', subtitle: 'Move on the beat', instruction: 'Follow each move cue and hit it as the beat lands.', icon: '♫', music: true },
  { id: 'mirror-challenge', title: 'Mirror Challenge', subtitle: 'Copy the coach', instruction: 'Match the coach’s pose and hold it when the pulse lands.', icon: '◉', music: true },
  { id: 'dodge-arena', title: 'Dodge Arena', subtitle: 'Keep your combo alive', instruction: 'Watch the lane marker, then lean away or jump over low barriers.', icon: '⚡', music: true },
  { id: 'beat-blaster', title: 'Beat Blaster', subtitle: 'Reach for the targets', instruction: 'Extend the matching arm toward each glowing target on the beat.', icon: '✦', music: true },
  { id: 'dance-party', title: 'Dance Party · Solo', subtitle: 'Copy a short routine', instruction: 'Follow the left, right and hands-up choreography in time.', icon: '✺', music: true },
  { id: 'six-seven', title: 'Six-Seven Challenge', subtitle: 'Alternate hands', instruction: 'Raise one hand, switch hands, then return to the first hand.', icon: '67', music: false },
  { id: 'dance-duo', title: 'Dance Party · Duo', subtitle: 'Two players, one routine', instruction: 'Stand side by side. Both players copy the same cue together.', icon: 'Ⅱ', music: true, twoPlayers: true },
];

// Only modes with a complete session, scoring and result flow belong in the release picker.
export const PLAYABLE_MODES = GAME_MODES.filter(mode => mode.id === 'classic-run' || mode.id === 'rhythm-run' || mode.id === 'six-seven');

export type MoveCue = 'LEAN_LEFT' | 'LEAN_RIGHT' | 'HANDS_UP_JUMP' | 'BLAST_LEFT' | 'BLAST_RIGHT';
export interface ModeCue { atMs: number; move: MoveCue; resolved: boolean }
export interface ModeSnapshot {
  score: number;
  cleared: number;
  misses: number;
  combo: number;
  bestCombo: number;
  playerOneScore: number;
  playerTwoScore: number;
  activeCue: ModeCue | null;
  feedback: string;
  feedbackKind: 'good' | 'hint' | 'neutral';
  sixSevenCount: number;
}

const chartMoves: Record<'rhythm-run' | 'mirror-challenge' | 'beat-blaster' | 'dance-party' | 'dance-duo', MoveCue[]> = {
  'rhythm-run': ['LEAN_LEFT', 'HANDS_UP_JUMP', 'LEAN_RIGHT', 'HANDS_UP_JUMP'],
  'mirror-challenge': ['LEAN_LEFT', 'LEAN_RIGHT', 'HANDS_UP_JUMP', 'LEAN_LEFT', 'HANDS_UP_JUMP', 'LEAN_RIGHT'],
  'beat-blaster': ['BLAST_LEFT', 'BLAST_RIGHT', 'BLAST_LEFT', 'BLAST_RIGHT'],
  'dance-party': ['LEAN_LEFT', 'LEAN_RIGHT', 'HANDS_UP_JUMP', 'LEAN_RIGHT', 'LEAN_LEFT', 'HANDS_UP_JUMP'],
  'dance-duo': ['LEAN_LEFT', 'LEAN_RIGHT', 'HANDS_UP_JUMP', 'LEAN_RIGHT', 'LEAN_LEFT', 'HANDS_UP_JUMP'],
};

const intervalMs: Record<keyof typeof chartMoves, number> = {
  'rhythm-run': 2000, 'mirror-challenge': 3000, 'beat-blaster': 1600, 'dance-party': 2200, 'dance-duo': 2200,
};

export function buildModeChart(mode: GameMode, durationMs: number): ModeCue[] {
  if (!(mode in chartMoves)) return [];
  const key = mode as keyof typeof chartMoves;
  const interval = intervalMs[key];
  const firstCueMs = mode === 'rhythm-run' ? 4_000 : 2_600;
  const chart: ModeCue[] = [];
  for (let atMs = firstCueMs; atMs < durationMs - 500; atMs += interval) {
    chart.push({ atMs, move: chartMoves[key][chart.length % chartMoves[key].length], resolved: false });
  }
  return chart;
}

export function makeDodgeWaves(durationMs: number): Wave[] {
  const lanes: Lane[] = [-1, 0, 1, 0, 1, -1];
  const waves: Wave[] = [];
  for (let atMs = 3200, id = 0; atMs < durationMs - 500; atMs += 2100, id++) {
    const lane = lanes[id % lanes.length];
    waves.push({ id, atMs, obstacles: [{ lane, kind: id % 4 === 3 ? 'low' : 'high' }], resolved: false });
  }
  return waves;
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
  score = 0;
  cleared = 0;
  misses = 0;
  combo = 0;
  bestCombo = 0;
  playerOneScore = 0;
  playerTwoScore = 0;
  sixSevenCount = 0;
  feedback = '';
  feedbackKind: ModeSnapshot['feedbackKind'] = 'neutral';
  private previous: GestureAnalysis | null = null;
  private readonly sixSeven = new SixSevenRecognizer();
  private lastFeedbackAt = -Infinity;

  constructor(readonly mode: GameMode, durationMs: number) {
    this.chart = buildModeChart(mode, durationMs);
  }

  reset(): void {
    this.score = this.cleared = this.misses = this.combo = this.bestCombo = 0;
    this.playerOneScore = this.playerTwoScore = this.sixSevenCount = 0;
    for (const cue of this.chart) cue.resolved = false;
    this.previous = null;
    this.sixSeven.reset();
    this.lastFeedbackAt = -Infinity;
    this.feedback = '';
    this.feedbackKind = 'neutral';
  }

  update(elapsedMs: number, primary: GestureAnalysis, secondary?: GestureAnalysis | null): GameEvent[] {
    if (this.mode === 'six-seven') {
      const result = this.sixSeven.update(elapsedMs, primary.landmarks, primary.trackingValid && primary.handsTracked);
      this.sixSevenCount = result.count;
      if (result.completed) {
        this.cleared++;
        this.combo++;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        this.score += 100;
        this.playerOneScore += 100;
        this.setFeedback(result.feedback, 'good', elapsedMs);
        this.previous = primary;
        return ['clear'];
      }
      if (result.feedback !== this.feedback) this.setFeedback(result.feedback, 'neutral', elapsedMs);
      this.previous = primary;
      return [];
    }
    if (!primary.trackingValid) return [];
    const events: GameEvent[] = [];
    const isPoseRound = this.mode === 'mirror-challenge' || this.mode === 'dance-party' || this.mode === 'dance-duo';
    const earlyWindowMs = isPoseRound ? 950 : this.mode === 'rhythm-run' ? 2_000 : 700;
    const lateWindowMs = this.mode === 'rhythm-run' ? 360 : 550;
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

  snapshot(elapsedMs: number): ModeSnapshot {
    const next = this.chart.find(item => !item.resolved) ?? null;
    const isPoseRound = this.mode === 'mirror-challenge' || this.mode === 'dance-party' || this.mode === 'dance-duo';
    const earlyWindowMs = isPoseRound ? 950 : this.mode === 'rhythm-run' ? 2_000 : 700;
    const lateWindowMs = this.mode === 'rhythm-run' ? 360 : 550;
    const activeCue = next && elapsedMs >= next.atMs - earlyWindowMs && elapsedMs <= next.atMs + lateWindowMs ? next : null;
    return { score: this.score, cleared: this.cleared, misses: this.misses, combo: this.combo, bestCombo: this.bestCombo,
      playerOneScore: this.playerOneScore, playerTwoScore: this.playerTwoScore, activeCue, feedback: this.feedback,
      feedbackKind: this.feedbackKind, sixSevenCount: this.sixSevenCount };
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
