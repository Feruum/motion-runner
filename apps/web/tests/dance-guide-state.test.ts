import { describe, expect, it } from 'vitest';
import type { ModeSnapshot } from '../../../packages/game/src/core/modes';
import { danceGuideState, dancePresentationCueIndex } from '../src/presentation/dance-guide-state';

function snapshot(overrides: Partial<ModeSnapshot> = {}): ModeSnapshot {
  return {
    score: 0, cleared: 0, misses: 0, collisions: 0, combo: 0, bestCombo: 0,
    playerOneScore: 0, playerTwoScore: 0, activeCue: null, feedback: '', feedbackKind: 'neutral',
    sixSevenCount: 0, blasterHighlight: null, poseCueName: 'Reach left', poseCueIndex: 0,
    poseCueCount: 8, posePhase: 'attempt', highlightedLandmarkIndexes: [], playerOneHighlights: [],
    playerTwoHighlights: [], playerOneFeedback: '', playerTwoFeedback: '', teamScore: 0,
    synchronizedCueCount: 0, trackingRecovery: false, rhythm: null, mirror: null,
    ...overrides,
  };
}

describe('danceGuideState', () => {
  it.each(['COUNTDOWN', 'RESULTS'] as const)('keeps the demonstrator neutral during %s', stage => {
    expect(dancePresentationCueIndex(stage, 0)).toBeNull();
  });

  it.each(['PLAYING', 'PAUSED'] as const)('keeps the live scoring cue during %s', stage => {
    expect(dancePresentationCueIndex(stage, 3)).toBe(3);
  });

  it('uses the scoring cue index as the authored target when the display name is stale', () => {
    const state = danceGuideState(snapshot({ poseCueIndex: 1, poseCueName: 'Reach left' }), 'dance-party');

    expect(state).toMatchObject({
      cueIndex: 1,
      cueId: 'right-reach',
      targetInstruction: 'Reach right',
      cueCounter: '02 / 08',
    });
  });

  it('keeps cleared-pose progress separate from the current target', () => {
    const state = danceGuideState(snapshot({ cleared: 3, poseCueIndex: 4 }), 'dance-party');

    expect(state).toMatchObject({
      completedCueCount: 3,
      progressPercent: 38,
      cueIndex: 4,
      cueCounter: '05 / 08',
    });
  });

  it('keeps Solo corrective feedback separate from the persistent target', () => {
    const state = danceGuideState(snapshot({ feedback: 'Raise your left hand higher', feedbackKind: 'hint' }), 'dance-party');

    expect(state).toMatchObject({
      targetInstruction: 'Reach left',
      feedback: 'Raise your left hand higher',
      playerOneFeedback: '',
      playerTwoFeedback: '',
    });
  });

  it('preserves Duo corrective feedback under the correct player identity', () => {
    const state = danceGuideState(snapshot({
      feedback: 'Player 2: Raise your right hand higher',
      playerOneFeedback: 'Hold that pose',
      playerTwoFeedback: 'Raise your right hand higher',
    }), 'dance-duo');

    expect(state).toMatchObject({
      isDuo: true,
      playerOneFeedback: 'Hold that pose',
      playerTwoFeedback: 'Raise your right hand higher',
    });
  });
});
