import { describe, expect, it } from 'vitest';
import type { MirrorChallengeResult } from '../../../packages/game/src/core/mirror';
import { ModeEngine } from '../../../packages/game/src/core/modes';
import type { GestureAnalysis } from '../../../packages/game/src/core/types';
import { mirrorCoachState } from '../src/presentation/mirror-coach-state';

function result(overrides: Partial<MirrorChallengeResult> = {}): MirrorChallengeResult {
  return {
    challengeElapsedMs: 0,
    remainingMs: 60_000,
    taskIndex: 0,
    taskNumber: 1,
    taskId: 'LEFT',
    taskName: 'Lean left',
    taskPhase: 'demo',
    taskElapsedMs: 0,
    taskRemainingMs: 7_500,
    targetId: 'LEFT',
    completedTaskCount: 0,
    completedTargetCount: 0,
    totalTasks: 8,
    totalTargets: 8,
    score: 0,
    success: false,
    elementCompleted: false,
    correctionEvent: false,
    elementIndex: 0,
    holdingMs: 0,
    awaitingNeutral: false,
    challengeCompleted: false,
    feedback: 'Watch the coach: Lean left.',
    highlightedLandmarkIndexes: [],
    ...overrides,
  };
}

describe('Mirror coach state mapping', () => {
  it('keeps the target visible while a corrective hint explains how to match it', () => {
    expect(mirrorCoachState(result({taskPhase:'attempt',targetId:'LEFT',feedback:'Move your right hand toward your shoulder.'}),2200)).toMatchObject({
      instruction:'Match: Lean left.', hint:'Move your right hand toward your shoulder.',
    });
  });
  it('starts with the first demo when the runtime has not produced a result', () => {
    expect(mirrorCoachState(null, 0)).toMatchObject({
      action: 'LEFT',
      phase: 'demo',
      taskIndex: 0,
      elementIndex: 0,
      elapsedMs: 0,
      instruction: 'Watch: Lean left.',
    });
  });

  it('cycles through both actions during the combo demonstrations', () => {
    expect(mirrorCoachState(result({
      taskIndex: 6,
      taskId: 'LEFT_THEN_RIGHT',
      taskName: 'Lean left, then right',
      taskElapsedMs: 1_200,
    }), 46_200)).toMatchObject({ action: 'RIGHT', elementIndex: 1, phase: 'demo' });

    expect(mirrorCoachState(result({
      taskIndex: 7,
      taskId: 'LEFT_HAND_UP_THEN_RIGHT_HAND_UP',
      taskName: 'Raise your left hand, then right',
      taskElapsedMs: 1_200,
    }), 53_700)).toMatchObject({ action: 'RIGHT_HAND_UP', elementIndex: 1, phase: 'demo' });
  });

  it('uses the current attempt target and shows neutral transitions with hold time', () => {
    expect(mirrorCoachState(result({
      taskPhase: 'attempt',
      taskElapsedMs: 2_250,
      targetId: 'RIGHT_HAND_UP',
      holdingMs: 250,
    }), 2_250)).toMatchObject({
      action: 'RIGHT_HAND_UP',
      phase: 'attempt',
      holdingMs: 250,
      awaitingNeutral: false,
    });

    expect(mirrorCoachState(result({
      taskIndex: 6,
      taskId: 'LEFT_THEN_RIGHT',
      taskName: 'Lean left, then right',
      taskPhase: 'attempt',
      taskElapsedMs: 2_700,
      targetId: 'RIGHT',
      elementIndex: 1,
      awaitingNeutral: true,
    }), 47_700)).toMatchObject({ action: 'NEUTRAL', awaitingNeutral: true });
  });

  it('keeps successful feedback visible and does not infer success from the global count', () => {
    expect(mirrorCoachState(result({
      taskPhase: 'attempt',
      targetId: 'LEFT',
      feedback: 'Task complete! +100 points.',
    }), 2_000).successful).toBe(true);

    expect(mirrorCoachState(result({
      taskIndex: 7,
      taskId: 'LEFT_HAND_UP_THEN_RIGHT_HAND_UP',
      taskPhase: 'result',
      taskElapsedMs: 6_500,
      completedTaskCount: 7,
      feedback: 'Time is up. Get ready for the next pose.',
    }), 59_000).successful).toBe(false);
  });

  it('exposes the last Mirror result as a defensive snapshot and clears it on reset', () => {
    const engine = new ModeEngine('mirror-challenge', 60_000);
    const noTracking = { trackingValid: false, landmarks: [] } as unknown as GestureAnalysis;

    expect(engine.snapshot(0).mirror).toBeNull();
    engine.update(0, noTracking);
    const first = engine.snapshot(0);
    expect(first.mirror).toMatchObject({ taskIndex: 0, taskPhase: 'demo' });
    expect(first.mirror!.highlightedLandmarkIndexes.length).toBeGreaterThan(0);

    first.mirror!.highlightedLandmarkIndexes.length = 0;
    expect(engine.snapshot(0).mirror!.highlightedLandmarkIndexes.length).toBeGreaterThan(0);

    engine.reset();
    expect(engine.snapshot(0).mirror).toBeNull();
  });
});
