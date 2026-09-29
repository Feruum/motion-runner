import type { Lane } from './types';
import {
  RHYTHM_HIGH_MIN_JUMP,
  RHYTHM_PICKUP_WINDOW_MS,
  type RhythmFrame,
  type RhythmSnapshot,
  type RhythmStar,
} from './rhythm-types';
import type { GameEvent } from './types';

const FIRST_STAR_AT_MS = 4_000;
const STAR_INTERVAL_MS = 2_000;
const STAR_SCORE = 100;
const COMBO_BONUS = 10;
const FEEDBACK_MS = 800;
const STAR_LANES: readonly Lane[] = [-1, 0, 1, 0];
const STAR_HEIGHTS: readonly RhythmStar['height'][] = ['low', 'high', 'low', 'high'];

function buildStars(durationMs: number): RhythmStar[] {
  const chart: RhythmStar[] = [];
  const lastChartTime = (Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0) - 500;
  for (let atMs = FIRST_STAR_AT_MS; atMs < lastChartTime; atMs += STAR_INTERVAL_MS) {
    const phraseIndex = chart.length % STAR_LANES.length;
    chart.push({
      id: chart.length,
      atMs,
      lane: STAR_LANES[phraseIndex],
      height: STAR_HEIGHTS[phraseIndex],
      status: 'upcoming',
      resolvedAtMs: null,
      points: 0,
    });
  }
  return chart;
}

function missedInstruction(star: RhythmStar): string {
  if (star.height === 'high') return 'Missed the high star. Jump to collect it.';
  const direction = star.lane === -1 ? 'left' : 'right';
  return `Missed the low star. Lean ${direction} to collect it.`;
}

function collectedFeedback(star: RhythmStar, points: number): string {
  const kind = star.height === 'high' ? 'High' : 'Low';
  return `${kind} star collected! +${points}`;
}

export class RhythmRunRuntime {
  private stars: RhythmStar[];
  private score = 0;
  private cleared = 0;
  private misses = 0;
  private combo = 0;
  private bestCombo = 0;
  private feedback = '';
  private feedbackKind: RhythmSnapshot['feedbackKind'] = 'neutral';
  private feedbackAtMs = -Infinity;
  private lastElapsedMs = 0;
  private finished = false;

  constructor(private readonly durationMs: number) {
    this.stars = buildStars(durationMs);
  }

  update(elapsedMs: number, frame: RhythmFrame): GameEvent[] {
    if (this.finished) return [];
    const now = this.advanceTo(elapsedMs);
    const events: GameEvent[] = [];

    for (const star of this.stars) {
      if (star.status !== 'upcoming') continue;
      const windowEnd = star.atMs + RHYTHM_PICKUP_WINDOW_MS;
      if (now > windowEnd) {
        this.miss(star);
        continue;
      }
      if (now < star.atMs - RHYTHM_PICKUP_WINDOW_MS) break;

      if (this.canCollect(star, frame)) {
        this.collect(star, now);
        events.push('clear');
      }
    }
    return events;
  }

  snapshot(elapsedMs: number): RhythmSnapshot {
    const now = Math.max(this.lastElapsedMs, this.safeElapsed(elapsedMs));
    const feedbackVisible = now >= this.feedbackAtMs && now - this.feedbackAtMs < FEEDBACK_MS;
    return {
      elapsedMs: now,
      stars: this.stars.map(star => ({ ...star })),
      score: this.score,
      cleared: this.cleared,
      misses: this.misses,
      combo: this.combo,
      bestCombo: this.bestCombo,
      feedback: feedbackVisible ? this.feedback : '',
      feedbackKind: feedbackVisible ? this.feedbackKind : 'neutral',
    };
  }

  reset(): void {
    this.stars = buildStars(this.durationMs);
    this.score = this.cleared = this.misses = this.combo = this.bestCombo = 0;
    this.feedback = '';
    this.feedbackKind = 'neutral';
    this.feedbackAtMs = -Infinity;
    this.lastElapsedMs = 0;
    this.finished = false;
  }

  finish(): void {
    if (this.finished) return;
    for (const star of this.stars) {
      if (star.status === 'upcoming') this.miss(star);
    }
    this.finished = true;
  }

  private canCollect(star: RhythmStar, frame: RhythmFrame): boolean {
    if (!frame.trackingValid || frame.lane !== star.lane || !Number.isFinite(frame.jumpHeight)) return false;
    return star.height === 'high'
      ? frame.jumpHeight >= RHYTHM_HIGH_MIN_JUMP
      : frame.jumpHeight < 1.0;
  }

  private collect(star: RhythmStar, elapsedMs: number): void {
    if (star.status !== 'upcoming') return;
    const points = STAR_SCORE + this.combo * COMBO_BONUS;
    star.status = 'collected';
    star.resolvedAtMs = elapsedMs;
    star.points = points;
    this.score += points;
    this.cleared++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.setFeedback(collectedFeedback(star, points), 'good', elapsedMs);
  }

  private miss(star: RhythmStar): void {
    if (star.status !== 'upcoming') return;
    star.status = 'missed';
    star.resolvedAtMs = star.atMs + RHYTHM_PICKUP_WINDOW_MS;
    this.misses++;
    this.combo = 0;
    this.setFeedback(missedInstruction(star), 'hint', star.resolvedAtMs);
  }

  private setFeedback(text: string, kind: RhythmSnapshot['feedbackKind'], elapsedMs: number): void {
    this.feedback = text;
    this.feedbackKind = kind;
    this.feedbackAtMs = elapsedMs;
  }

  private advanceTo(elapsedMs: number): number {
    this.lastElapsedMs = Math.max(this.lastElapsedMs, this.safeElapsed(elapsedMs));
    return this.lastElapsedMs;
  }

  private safeElapsed(elapsedMs: number): number {
    return Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : this.lastElapsedMs;
  }
}
