import { DANCE_CUES } from '../../../../packages/game/src/core/dance';
import type { Stage } from '../../../../packages/game/src/core/types';
import type { ModeSnapshot } from '../../../../packages/game/src/core/modes';

export type DanceGuideMode = 'dance-party' | 'dance-duo';

type DanceGuideSnapshot = Pick<ModeSnapshot,
  | 'cleared'
  | 'feedback'
  | 'poseCueCount'
  | 'poseCueIndex'
  | 'playerOneFeedback'
  | 'playerTwoFeedback'
>;

export interface DanceGuideState {
  isDuo: boolean;
  cueIndex: number | null;
  cueId: string | null;
  targetInstruction: string;
  cueCounter: string;
  poseCount: number;
  completedCueCount: number;
  progressPercent: number;
  feedback: string;
  playerOneFeedback: string;
  playerTwoFeedback: string;
}

/** Only show an authored pose while its scoring window is active or paused. */
export function dancePresentationCueIndex(stage: Stage, cueIndex: number | null): number | null {
  return stage === 'PLAYING' || stage === 'PAUSED' ? cueIndex : null;
}

function asCount(value: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(0, Math.floor(value))) : 0;
}

/**
 * Turns the runtime's current scoring cue into persistent guide content.
 * `poseCueIndex` is the sole target selector so display copy and the dancer
 * cannot drift onto a separate presentation schedule.
 */
export function danceGuideState(snapshot: DanceGuideSnapshot, mode: DanceGuideMode): DanceGuideState {
  const poseCount = Math.min(DANCE_CUES.length, asCount(snapshot.poseCueCount, DANCE_CUES.length));
  const cueIndex = Number.isInteger(snapshot.poseCueIndex)
    && snapshot.poseCueIndex! >= 0
    && snapshot.poseCueIndex! < poseCount
    ? snapshot.poseCueIndex
    : null;
  const cue = cueIndex === null ? null : DANCE_CUES[cueIndex];
  const completedCueCount = asCount(snapshot.cleared, poseCount);

  return {
    isDuo: mode === 'dance-duo',
    cueIndex,
    cueId: cue?.id ?? null,
    targetInstruction: cue?.name ?? 'Dance complete',
    cueCounter: `${String(cueIndex === null ? poseCount : cueIndex + 1).padStart(2, '0')} / ${String(poseCount).padStart(2, '0')}`,
    poseCount,
    completedCueCount,
    progressPercent: poseCount > 0 ? Math.round(completedCueCount / poseCount * 100) : 0,
    feedback: snapshot.feedback.trim(),
    playerOneFeedback: mode === 'dance-duo' ? snapshot.playerOneFeedback.trim() : '',
    playerTwoFeedback: mode === 'dance-duo' ? snapshot.playerTwoFeedback.trim() : '',
  };
}
