import { describe, expect, it } from 'vitest';
import type { Landmark } from '../../../packages/game/src/core/types';
import {
  MIRROR_ASSIGNMENTS,
  MIRROR_CHALLENGE_DURATION_MS,
  MIRROR_TASK_SCORE,
  MIRROR_TASK_WINDOW_MS,
  MirrorChallengeRuntime,
} from '../../../packages/game/src/core/mirror';

type PoseName = 'neutral' | 'lean-left' | 'lean-right' | 'left-up' | 'right-up' | 'both-up' | 'arms-out' | 'arms-out-too-far' | 'left-up-right-too-low' | 'left-up-too-high' | 'left-bent-out' | 'right-bent-out' | 'left-up-position-edge' | 'left-up-position-outside' | 'left-up-angle-edge';

function pose(name: PoseName): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99, presence: 0.99 }));
  const set = (index: number, x: number, y: number) => { landmarks[index] = { x, y, z: 0, visibility: 0.99, presence: 0.99 }; };

  // MediaPipe's anatomical left indexes are on the image's right, as in a mirrored preview.
  set(11, 0.62, 0.38); set(12, 0.38, 0.38);
  set(13, 0.68, 0.53); set(14, 0.32, 0.53);
  set(15, 0.65, 0.70); set(16, 0.35, 0.70);
  set(23, 0.59, 0.76); set(24, 0.41, 0.76);

  if (name === 'lean-left') { set(11, 0.68, 0.38); set(12, 0.44, 0.38); }
  if (name === 'lean-right') { set(11, 0.56, 0.38); set(12, 0.32, 0.38); }
  if (name === 'left-up' || name === 'both-up') { set(13, 0.62, 0.275); set(15, 0.62, 0.17); }
  if (name === 'right-up' || name === 'both-up') { set(14, 0.38, 0.275); set(16, 0.38, 0.17); }
  if (name === 'left-up-position-edge') { set(13, 0.658, 0.3135); set(15, 0.696, 0.247); }
  if (name === 'left-up-position-outside') { set(13, 0.62, 0.3249); set(15, 0.62, 0.2698); }
  if (name === 'left-up-angle-edge') { set(13, 0.638, 0.275); set(15, 0.62, 0.17); }
  if (name === 'left-up-too-high') { set(13, 0.62, 0.275); set(15, 0.62, 0.05); }
  if (name === 'left-up-right-too-low') {
    set(13, 0.62, 0.275); set(15, 0.62, 0.17);
    set(14, 0.38, 0.61); set(16, 0.38, 0.84);
  }
  if (name === 'arms-out') {
    set(13, 0.772, 0.38); set(15, 0.924, 0.38);
    set(14, 0.228, 0.38); set(16, 0.076, 0.38);
  }
  if (name === 'arms-out-too-far') {
    set(23, 0.59, 0.65); set(24, 0.41, 0.65);
    set(13, 0.81, 0.38); set(15, 1.0, 0.38);
    set(14, 0.19, 0.38); set(16, 0.0, 0.38);
  }
  if (name === 'left-bent-out') { set(13, 0.80, 0.43); set(15, 0.924, 0.38); set(14, 0.228, 0.38); set(16, 0.076, 0.38); }
  if (name === 'right-bent-out') { set(14, 0.20, 0.43); set(16, 0.076, 0.38); set(13, 0.772, 0.38); set(15, 0.924, 0.38); }
  return landmarks;
}

function hold(runtime: MirrorChallengeRuntime, name: PoseName, startMs: number, endMs: number) {
  let result = runtime.update(startMs, pose(name), true);
  for (let time = startMs + 50; time <= endMs; time += 50) result = runtime.update(time, pose(name), true);
  return result;
}

function neutral(runtime: MirrorChallengeRuntime, startMs: number, endMs: number) {
  let result = runtime.update(startMs, pose('neutral'), true);
  for (let time = startMs + 50; time <= endMs; time += 50) result = runtime.update(time, pose('neutral'), true);
  return result;
}

describe('Mirror Challenge runtime', () => {
  it('defines the six pose tasks followed by the two ordered combos', () => {
    expect(MIRROR_ASSIGNMENTS.map(task => task.id)).toEqual([
      'LEFT', 'RIGHT', 'LEFT_HAND_UP', 'RIGHT_HAND_UP', 'BOTH_HANDS_UP', 'ARMS_OUT',
      'LEFT_THEN_RIGHT', 'LEFT_HAND_UP_THEN_RIGHT_HAND_UP',
    ]);
    expect(MIRROR_ASSIGNMENTS.slice(0, 6).every(task => task.elements.length === 1)).toBe(true);
    expect(MIRROR_ASSIGNMENTS[6].elements.map(element => element.action)).toEqual(['LEFT', 'RIGHT']);
    expect(MIRROR_ASSIGNMENTS[7].elements.map(element => element.action)).toEqual(['LEFT_HAND_UP', 'RIGHT_HAND_UP']);
  });

  it('uses the planned 60-second round, 7.5-second task windows, and per-task timing phases', () => {
    expect(MIRROR_CHALLENGE_DURATION_MS).toBe(60_000);
    expect(MIRROR_TASK_WINDOW_MS).toBe(7_500);
    expect(MIRROR_ASSIGNMENTS.every(task => task.demoMs + task.attemptMs + task.resultMs === MIRROR_TASK_WINDOW_MS)).toBe(true);
    expect(MIRROR_ASSIGNMENTS.slice(0, 6).every(task => task.demoMs === 1_500 && task.attemptMs === 5_000 && task.resultMs === 1_000)).toBe(true);
    expect(MIRROR_ASSIGNMENTS.slice(6).every(task => task.demoMs === 2_000 && task.attemptMs === 4_500 && task.resultMs === 1_000)).toBe(true);

    const runtime = new MirrorChallengeRuntime();
    expect(runtime.update(0, pose('neutral'), true)).toMatchObject({ taskIndex: 0, taskPhase: 'demo' });
    expect(runtime.update(1_499, pose('neutral'), true).taskPhase).toBe('demo');
    expect(runtime.update(1_500, pose('neutral'), true).taskPhase).toBe('attempt');
    expect(runtime.update(6_499, pose('neutral'), true).taskPhase).toBe('attempt');
    expect(runtime.update(6_500, pose('neutral'), true)).toMatchObject({ taskIndex: 0, taskPhase: 'result' });
    expect(runtime.update(7_500, pose('neutral'), true)).toMatchObject({ taskIndex: 1, taskPhase: 'demo' });
    expect(runtime.update(60_000, pose('neutral'), true)).toMatchObject({ taskPhase: 'complete', challengeCompleted: true, remainingMs: 0 });
  });

  it('applies the planned 20-degree angle and 0.25-torso wrist tolerances', () => {
    const requirements = MIRROR_ASSIGNMENTS.flatMap(task => task.elements.flatMap(element => element.requirements));
    expect(requirements.filter(requirement => requirement.kind === 'elbow-angle').every(requirement => requirement.toleranceDegrees === 20)).toBe(true);
    expect(requirements.filter(requirement => requirement.kind === 'wrist-position').every(requirement => requirement.toleranceTorso === 0.25)).toBe(true);
    expect(requirements.filter(requirement => requirement.kind === 'torso-lean').every(requirement => requirement.activateAt === 0.22 && requirement.releaseAt === 0.12)).toBe(true);

    expect(hold(new MirrorChallengeRuntime(), 'left-up-position-edge', 16_500, 17_000)).toMatchObject({ completedTaskCount: 1, success: true });
    expect(hold(new MirrorChallengeRuntime(), 'left-up-angle-edge', 16_500, 17_000)).toMatchObject({ completedTaskCount: 1, success: true });
    expect(hold(new MirrorChallengeRuntime(), 'left-up-position-outside', 16_500, 17_000)).toMatchObject({ completedTaskCount: 0, success: false });
  });

  it('does not score at 499 ms, scores at 500 ms, and awards only 100 points once', () => {
    const runtime = new MirrorChallengeRuntime();
    expect(hold(runtime, 'lean-left', 1_500, 1_999)).toMatchObject({ completedTaskCount: 0, score: 0, success: false });
    const completed = runtime.update(2_000, pose('lean-left'), true);
    expect(completed).toMatchObject({ completedTaskCount: 1, score: MIRROR_TASK_SCORE, success: true });
    expect(runtime.update(2_050, pose('lean-left'), true)).toMatchObject({ completedTaskCount: 1, score: MIRROR_TASK_SCORE, success: false });
  });

  it('keeps normalized wrist poses stable when the player appears smaller in frame', () => {
    const runtime = new MirrorChallengeRuntime();
    let result = runtime.update(16_500, pose('left-up'), true);
    for (let time = 16_550; time <= 17_000; time += 50) {
      const smaller = pose('left-up').map(point => ({ ...point, x: 0.5 + (point.x - 0.5) * 0.65, y: 0.5 + (point.y - 0.5) * 0.65 }));
      result = runtime.update(time, smaller, true);
    }
    expect(result).toMatchObject({ completedTaskCount: 1, score: 100, success: true });
  });

  it('resets a pose hold when the pose breaks', () => {
    const runtime = new MirrorChallengeRuntime();
    hold(runtime, 'lean-left', 1_500, 1_750);
    runtime.update(1_800, pose('neutral'), true);
    expect(hold(runtime, 'lean-left', 1_850, 2_300)).toMatchObject({ completedTaskCount: 0, success: false });
    expect(runtime.update(2_350, pose('lean-left'), true)).toMatchObject({ completedTaskCount: 1, success: true, score: 100 });
  });

  it('completes each of the six single-pose tasks for 100 points', () => {
    const runtime = new MirrorChallengeRuntime();
    const sequence: PoseName[] = ['lean-left', 'lean-right', 'left-up', 'right-up', 'both-up', 'arms-out'];
    sequence.forEach((name, index) => {
      const taskStart = index * MIRROR_TASK_WINDOW_MS;
      const result = hold(runtime, name, taskStart + 1_500, taskStart + 2_000);
      expect(result).toMatchObject({ completedTaskCount: index + 1, score: (index + 1) * 100, success: true });
    });

    const firstComboStart = 6 * MIRROR_TASK_WINDOW_MS + 2_000;
    expect(hold(runtime, 'lean-left', firstComboStart, firstComboStart + 500).score).toBe(600);
    neutral(runtime, firstComboStart + 550, firstComboStart + 750);
    expect(hold(runtime, 'lean-right', firstComboStart + 800, firstComboStart + 1_300)).toMatchObject({ completedTaskCount: 7, score: 700, success: true });

    const lastComboStart = 7 * MIRROR_TASK_WINDOW_MS + 2_000;
    expect(hold(runtime, 'left-up', lastComboStart, lastComboStart + 500).score).toBe(700);
    neutral(runtime, lastComboStart + 550, lastComboStart + 750);
    expect(hold(runtime, 'right-up', lastComboStart + 800, lastComboStart + 1_300)).toMatchObject({ completedTaskCount: 8, score: 800, success: true });
    expect(runtime.update(MIRROR_CHALLENGE_DURATION_MS, pose('neutral'), true)).toMatchObject({ challengeCompleted: true, score: 800 });
  });

  it('requires LEFT then RIGHT and at least 200 ms of neutral to score the first combo', () => {
    const runtime = new MirrorChallengeRuntime();
    const comboStart = 6 * MIRROR_TASK_WINDOW_MS;
    const attemptStart = comboStart + 2_000;

    const wrongOrder = hold(runtime, 'lean-right', attemptStart, attemptStart + 500);
    expect(wrongOrder).toMatchObject({ completedTaskCount: 0, score: 0, success: false, elementCompleted: false });

    const firstElement = hold(runtime, 'lean-left', attemptStart + 550, attemptStart + 1_050);
    expect(firstElement).toMatchObject({ completedTaskCount: 0, score: 0, success: false, elementCompleted: true, awaitingNeutral: true });

    neutral(runtime, attemptStart + 1_100, attemptStart + 1_250);
    const tooEarly = hold(runtime, 'lean-right', attemptStart + 1_300, attemptStart + 1_800);
    expect(tooEarly).toMatchObject({ completedTaskCount: 0, score: 0, success: false, awaitingNeutral: true });

    expect(neutral(runtime, attemptStart + 1_850, attemptStart + 2_050).awaitingNeutral).toBe(false);
    const completed = hold(runtime, 'lean-right', attemptStart + 2_100, attemptStart + 2_600);
    expect(completed).toMatchObject({ completedTaskCount: 1, score: MIRROR_TASK_SCORE, success: true, challengeCompleted: false });
  });

  it('expires an unfinished combo at the task attempt deadline', () => {
    const runtime = new MirrorChallengeRuntime();
    const attemptStart = 6 * MIRROR_TASK_WINDOW_MS + 2_000;
    hold(runtime, 'lean-left', attemptStart, attemptStart + 500);
    const expired = runtime.update(attemptStart + 4_500, pose('neutral'), true);

    expect(expired).toMatchObject({ taskPhase: 'result', completedTaskCount: 0, score: 0, success: false, awaitingNeutral: false });
  });

  it('requires LEFT_HAND_UP then RIGHT_HAND_UP for the final combo', () => {
    const runtime = new MirrorChallengeRuntime();
    const comboStart = 7 * MIRROR_TASK_WINDOW_MS;
    const attemptStart = comboStart + 2_000;
    expect(hold(runtime, 'right-up', attemptStart, attemptStart + 500)).toMatchObject({ completedTaskCount: 0, success: false });
    expect(hold(runtime, 'left-up', attemptStart + 550, attemptStart + 1_050)).toMatchObject({ elementCompleted: true, awaitingNeutral: true, score: 0 });
    expect(neutral(runtime, attemptStart + 1_100, attemptStart + 1_300).awaitingNeutral).toBe(false);
    expect(hold(runtime, 'right-up', attemptStart + 1_350, attemptStart + 1_850)).toMatchObject({ completedTaskCount: 1, score: 100, success: true });
  });

  it('reports the strongest anatomical elbow correction for either arm', () => {
    const runtime = new MirrorChallengeRuntime();
    const attemptStart = 5 * MIRROR_TASK_WINDOW_MS + 1_500;
    const left = hold(runtime, 'left-bent-out', attemptStart, attemptStart + 500);
    expect(left.feedback).toBe('Straighten your left arm');
    expect(left.highlightedLandmarkIndexes).toEqual([11, 13, 15]);

    const rightRuntime = new MirrorChallengeRuntime();
    const right = hold(rightRuntime, 'right-bent-out', attemptStart, attemptStart + 500);
    expect(right.feedback).toBe('Straighten your right arm');
    expect(right.highlightedLandmarkIndexes).toEqual([12, 14, 16]);
  });

  it('gives the correct direction for raised-hand, lowered-hand, and arms-out overshoots', () => {
    const attemptStart = 2 * MIRROR_TASK_WINDOW_MS + 1_500;
    const raisedTooHigh = hold(new MirrorChallengeRuntime(), 'left-up-too-high', attemptStart, attemptStart + 500);
    expect(raisedTooHigh.feedback).toBe('Lower your left hand slightly');

    const loweredTooFar = hold(new MirrorChallengeRuntime(), 'left-up-right-too-low', attemptStart, attemptStart + 500);
    expect(loweredTooFar.feedback).toBe('Raise your right hand slightly');

    const armsOutTooFar = hold(new MirrorChallengeRuntime(), 'arms-out-too-far', 5 * MIRROR_TASK_WINDOW_MS + 1_500, 5 * MIRROR_TASK_WINDOW_MS + 2_000);
    expect(armsOutTooFar.feedback).toBe('Bring your left arm closer in');
  });

  it('waits 500 ms before a partial-pose correction and rate-limits repeat events to 2 seconds', () => {
    const runtime = new MirrorChallengeRuntime();
    const attemptStart = 2 * MIRROR_TASK_WINDOW_MS + 1_500;
    const wrong = pose('left-up-too-high');

    expect(runtime.update(attemptStart, wrong, true)).toMatchObject({ feedback: '', correctionEvent: false });
    expect(runtime.update(attemptStart + 499, wrong, true)).toMatchObject({ feedback: '', correctionEvent: false });
    expect(runtime.update(attemptStart + 500, wrong, true)).toMatchObject({
      feedback: 'Lower your left hand slightly',
      correctionEvent: true,
    });
    expect(runtime.update(attemptStart + 1_999, wrong, true).correctionEvent).toBe(false);
    expect(runtime.update(attemptStart + 2_500, wrong, true).correctionEvent).toBe(true);

    const corrected = runtime.update(attemptStart + 2_550, pose('left-up'), true);
    expect(corrected).toMatchObject({ feedback: 'Hold this pose.', correctionEvent: false, highlightedLandmarkIndexes: [] });
  });

  it('clears pending hold on missing or low-confidence landmarks and reports framing feedback', () => {
    const runtime = new MirrorChallengeRuntime();
    hold(runtime, 'lean-left', 1_500, 1_700);
    const uncertain = pose('lean-left');
    uncertain[24].visibility = 0.2;
    const lost = runtime.update(1_750, uncertain, true);
    expect(lost).toMatchObject({ completedTaskCount: 0, score: 0, success: false });
    expect(lost.feedback).toMatch(/visible|framing|step back/i);
    expect(lost.highlightedLandmarkIndexes).toContain(24);

    const missing = runtime.update(1_800, pose('lean-left').slice(0, 24), true);
    expect(missing.feedback).toMatch(/visible|framing|step back/i);
    expect(hold(runtime, 'lean-left', 1_850, 2_300)).toMatchObject({ completedTaskCount: 0, success: false });
    expect(runtime.update(2_350, pose('lean-left'), true)).toMatchObject({ completedTaskCount: 1, success: true });
  });

  it('freezes active task time across required-landmark loss and restarts the hold on recovery', () => {
    const runtime = new MirrorChallengeRuntime();
    runtime.update(0, pose('neutral'), true);
    runtime.update(1_500, pose('neutral'), true);
    runtime.update(1_500, pose('lean-left'), true);
    const partial = runtime.update(1_700, pose('lean-left'), true);
    expect(partial.holdingMs).toBe(200);

    const uncertain = pose('lean-left');
    uncertain[24].visibility = 0.2;
    const lost = runtime.update(1_750, uncertain, true);
    expect(lost).toMatchObject({ challengeElapsedMs: 1_700, taskIndex: 0, taskPhase: 'attempt' });
    expect(lost.feedback).toMatch(/visible|framing|step back/i);

    const stillLost = runtime.update(10_000, uncertain, true);
    expect(stillLost).toMatchObject({ challengeElapsedMs: 1_700, taskIndex: 0, taskPhase: 'attempt' });
    const resumed = runtime.update(20_000, pose('lean-left'), true);
    expect(resumed).toMatchObject({
      challengeElapsedMs: 1_700,
      taskIndex: 0,
      taskPhase: 'attempt',
      success: false,
      holdingMs: 0,
      feedback: 'Hold this pose.',
    });
  });

  it('resets round time, task progress, and score', () => {
    const runtime = new MirrorChallengeRuntime();
    hold(runtime, 'lean-left', 1_500, 2_000);
    runtime.reset();
    const replay = hold(runtime, 'lean-left', 1_500, 2_000);
    expect(replay).toMatchObject({ completedTaskCount: 1, score: 100, success: true });
  });
});
