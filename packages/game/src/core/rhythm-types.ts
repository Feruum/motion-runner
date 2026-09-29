import type { Lane } from './types';

export interface RhythmStar {
  id: number;
  atMs: number;
  lane: Lane;
  height: 'low' | 'high';
  status: 'upcoming' | 'collected' | 'missed';
  resolvedAtMs: number | null;
  points: number;
}

export interface RhythmFrame {
  lane: Lane;
  jumpHeight: number;
  trackingValid: boolean;
}

export interface RhythmSnapshot {
  elapsedMs: number;
  stars: readonly RhythmStar[];
  score: number;
  cleared: number;
  misses: number;
  combo: number;
  bestCombo: number;
  feedback: string;
  feedbackKind: 'good' | 'hint' | 'neutral';
}

export const RHYTHM_PREVIEW_MS = 3000;
export const RHYTHM_PICKUP_WINDOW_MS = 240;
export const RHYTHM_HIGH_MIN_JUMP = 1.25;
