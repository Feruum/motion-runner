import { MIRROR_ASSIGNMENTS } from '../../../../packages/game/src/core/mirror';
import type { MirrorAction, MirrorChallengeResult } from '../../../../packages/game/src/core/mirror';

export interface MirrorCoachState {
  action: MirrorAction | 'NEUTRAL';
  phase: 'demo' | 'attempt' | 'result' | 'complete';
  taskIndex: number;
  elementIndex: number;
  elapsedMs: number;
  holdingMs: number;
  awaitingNeutral: boolean;
  successful: boolean;
  instruction: string;
  hint?: string;
}

export type MirrorResult = MirrorChallengeResult;

const actionLabels: Record<MirrorAction, string> = {
  LEFT: 'Lean left',
  RIGHT: 'Lean right',
  LEFT_HAND_UP: 'Raise your left hand',
  RIGHT_HAND_UP: 'Raise your right hand',
  BOTH_HANDS_UP: 'Raise both hands',
  ARMS_OUT: 'Extend both arms',
};

function safeElapsedMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function actionInstruction(action: MirrorAction | 'NEUTRAL'): string {
  return action === 'NEUTRAL' ? 'Return to neutral.' : actionLabels[action];
}

function isTaskComplete(result: MirrorChallengeResult | null): boolean {
  return !!result && (result.success || /^Task complete\b/i.test(result.feedback));
}

function instructionFor(
  result: MirrorChallengeResult | null,
  action: MirrorAction | 'NEUTRAL',
  phase: MirrorCoachState['phase'],
  holdingMs: number,
  awaitingNeutral: boolean,
  successful: boolean,
): string {
  if (phase === 'complete') return 'Challenge complete.';
  if (phase === 'result') return successful ? 'Task complete!' : 'Try the next pose.';
  if (awaitingNeutral || action === 'NEUTRAL') return 'Return to neutral.';
  if (successful) return 'Task complete!';

  if (phase === 'demo') return `Watch: ${actionInstruction(action)}.`;

  return holdingMs > 0
    ? `Hold: ${actionInstruction(action)}.`
    : `Match: ${actionInstruction(action)}.`;
}

/** Maps the runtime's last result to the pose and short instruction shown by the coach. */
export function mirrorCoachState(result: MirrorChallengeResult | null, elapsedMs: number): MirrorCoachState {
  const fallbackElapsedMs = safeElapsedMs(elapsedMs);
  const phase = result?.taskPhase ?? 'demo';
  const taskIndex = result?.taskIndex !== null && result?.taskIndex !== undefined
    && result.taskIndex >= 0 && result.taskIndex < MIRROR_ASSIGNMENTS.length
    ? result.taskIndex
    : 0;
  const assignment = MIRROR_ASSIGNMENTS[taskIndex];
  const taskElapsedMs = result ? safeElapsedMs(result.taskElapsedMs) : fallbackElapsedMs;
  const lastElementIndex = assignment.elements.length - 1;
  const elementIndex = phase === 'demo'
    ? Math.min(lastElementIndex, Math.floor(taskElapsedMs / assignment.demoMs * assignment.elements.length))
    : Math.min(lastElementIndex, Math.max(0, result?.elementIndex ?? 0));
  const demoAction = assignment.elements[elementIndex].action;
  const action = phase === 'complete'
    ? 'NEUTRAL'
    : phase === 'demo'
      ? demoAction
      : phase === 'attempt' && result?.awaitingNeutral
        ? 'NEUTRAL'
        : result?.targetId ?? assignment.elements[elementIndex].action;
  const holdingMs = safeElapsedMs(result?.holdingMs ?? 0);
  const awaitingNeutral = result?.awaitingNeutral ?? false;
  const successful = isTaskComplete(result);
  const feedback = result?.feedback.trim() ?? '';
  const actionableHint = !['Hold this pose.', 'Ready for the next move.'].includes(feedback) ? feedback : '';

  return {
    action,
    phase,
    taskIndex,
    elementIndex,
    elapsedMs: taskElapsedMs,
    holdingMs,
    awaitingNeutral,
    successful,
    instruction: instructionFor(result, action, phase, holdingMs, awaitingNeutral, successful),
    hint: phase === 'attempt' && !successful && !awaitingNeutral ? actionableHint : '',
  };
}
