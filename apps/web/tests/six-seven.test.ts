import { describe, expect, it } from 'vitest';
import { SixSevenRecognizer } from '@motion-runner/game';
import { pose } from './fixtures';

function sample(time: number, hands: 'left' | 'right' | 'level' | 'overhead-left' | 'overhead-right' | 'noise' | 'noise-right' | 'down') {
  const landmarks = pose(time).landmarks;
  if (hands === 'left') { landmarks[15].y = .48; landmarks[16].y = .72; }
  if (hands === 'right') { landmarks[15].y = .72; landmarks[16].y = .48; }
  if (hands === 'level') { landmarks[15].y = .58; landmarks[16].y = .58; }
  if (hands === 'overhead-left') { landmarks[15].y = .09; landmarks[16].y = .72; }
  if (hands === 'overhead-right') { landmarks[15].y = .72; landmarks[16].y = .09; }
  if (hands === 'noise') { landmarks[15].y = .58; landmarks[16].y = .61; }
  if (hands === 'noise-right') { landmarks[15].y = .61; landmarks[16].y = .58; }
  if (hands === 'down') { landmarks[15].y = .65; landmarks[16].y = .65; }
  return landmarks;
}

function sideBentSample(time: number, bend: 'left' | 'right') {
  const landmarks = pose(time).landmarks;
  const leftLean = bend === 'left';
  landmarks[11].y = leftLean ? .35 : .45;
  landmarks[12].y = leftLean ? .45 : .35;
  landmarks[23].y = leftLean ? .70 : .82;
  landmarks[24].y = leftLean ? .82 : .70;
  landmarks[15].y = leftLean ? .60 : .70;
  landmarks[16].y = leftLean ? .70 : .60;
  return landmarks;
}

describe('Six-Seven hand sequence', () => {
  it('counts one repetition for two alternating movements', () => {
    const recognizer = new SixSevenRecognizer();
    recognizer.update(0, sample(0, 'left'));
    recognizer.update(120, sample(120, 'left'));
    recognizer.update(400, sample(400, 'right'));
    const completed = recognizer.update(520, sample(520, 'right'));
    expect(completed).toMatchObject({ count: 1, completed: true });
    expect(completed.feedback).toMatch(/\+1 rep/i);
  });

  it('counts each non-overlapping pair at 15, 30 and 60 pose updates per second', () => {
    for (const fps of [15, 30, 60]) {
      const recognizer = new SixSevenRecognizer();
      const step = 1000 / fps;
      const phase = (start: number, end: number, hand: 'left' | 'right') => {
        for (let time = start; time <= end; time += step) recognizer.update(time, sample(time, hand));
      };

      phase(0, 250, 'left');
      phase(300, 550, 'right');
      phase(600, 850, 'left');
      phase(900, 1_150, 'right');

      expect(recognizer.count, `${fps} pose updates per second`).toBe(2);
    }
  });

  it('accepts either starting hand and does not reuse a movement across repetitions', () => {
    for (const [first, second] of [['left', 'right'], ['right', 'left']] as const) {
      const recognizer = new SixSevenRecognizer();
      recognizer.update(0, sample(0, first));
      recognizer.update(120, sample(120, first));
      recognizer.update(400, sample(400, second));
      const completed = recognizer.update(520, sample(520, second));
      expect(completed).toMatchObject({ count: 1, completed: true });
      recognizer.update(800, sample(800, first));
      expect(recognizer.update(920, sample(920, first))).toMatchObject({ count: 1, completed: false });
      recognizer.update(1_200, sample(1_200, second));
      expect(recognizer.update(1_320, sample(1_320, second))).toMatchObject({ count: 2, completed: true });
    }
  });

  it('does not expire a completed pair while the last hand is held', () => {
    const recognizer = new SixSevenRecognizer();
    recognizer.update(0, sample(0, 'left'));
    recognizer.update(120, sample(120, 'left'));
    recognizer.update(400, sample(400, 'right'));
    recognizer.update(520, sample(520, 'right'));

    for (const time of [1_000, 2_000, 2_600, 3_520, 3_640]) {
      recognizer.update(time, sample(time, 'right'));
    }
    recognizer.update(4_000, sample(4_000, 'left'));
    expect(recognizer.update(4_120, sample(4_120, 'left'))).toMatchObject({ count: 1, completed: false });

    recognizer.update(4_400, sample(4_400, 'right'));
    expect(recognizer.update(4_520, sample(4_520, 'right'))).toMatchObject({ count: 2, completed: true });
  });

  it('does not count a held arm, two raised arms or motion below the amplitude threshold', () => {
    const recognizer = new SixSevenRecognizer();
    for (const time of [0, 120, 500, 1000, 1500]) recognizer.update(time, sample(time, 'left'));
    for (const time of [1600, 1720, 1900]) recognizer.update(time, sample(time, 'overhead-left'));

    const lowAmplitude = sample(2000, 'noise');
    for (const time of [2000, 2120]) recognizer.update(time, lowAmplitude);
    for (const time of [2300, 2420, 2600]) recognizer.update(time, sample(time, 'noise-right'));

    expect(recognizer.count).toBe(0);
  });

  it('ignores alternating overhead raises so running arm swings cannot score reps', () => {
    const recognizer = new SixSevenRecognizer();
    for (const time of [0, 120, 400, 520]) {
      const hand = time < 300 ? 'overhead-left' : 'overhead-right';
      recognizer.update(time, sample(time, hand));
    }

    expect(recognizer.count).toBe(0);
  });

  it('does not treat a side-to-side body bend as alternating hand heights', () => {
    const recognizer = new SixSevenRecognizer();
    recognizer.update(0, sideBentSample(0, 'left'));
    recognizer.update(120, sideBentSample(120, 'left'));
    recognizer.update(400, sideBentSample(400, 'right'));
    const result = recognizer.update(520, sideBentSample(520, 'right'));

    expect(result).toMatchObject({ count: 0, completed: false });
  });

  it('requires a stable hand and requires a fresh confirmation after timing out', () => {
    const recognizer = new SixSevenRecognizer();
    recognizer.update(0, sample(0, 'left'));
    recognizer.update(60, sample(60, 'right'));
    recognizer.update(120, sample(120, 'left'));
    recognizer.update(240, sample(240, 'left'));
    const timedOut = recognizer.update(2_300, sample(2_300, 'left'));
    expect(timedOut.feedback).toMatch(/too slow/i);
    const restarted = recognizer.update(2_420, sample(2_420, 'left'));

    expect(restarted).toMatchObject({ count: 0, completed: false });
    expect(restarted.feedback).toContain('1/2');
  });

  it('clears an in-progress half-cycle when the required landmarks disappear', () => {
    const recognizer = new SixSevenRecognizer();
    recognizer.update(0, sample(0, 'left'));
    recognizer.update(120, sample(120, 'left'));
    const missing = sample(200, 'right').map(point => ({ ...point, visibility: 0 }));
    recognizer.update(200, missing, false);
    recognizer.update(400, sample(400, 'right'));
    const firstPoleAfterRecovery = recognizer.update(520, sample(520, 'right'));

    expect(firstPoleAfterRecovery.count).toBe(0);
  });

  it('preserves completed repetitions when tracking is lost and reset clears the count', () => {
    const recognizer = new SixSevenRecognizer();
    recognizer.update(0, sample(0, 'left'));
    recognizer.update(120, sample(120, 'left'));
    recognizer.update(400, sample(400, 'right'));
    expect(recognizer.update(520, sample(520, 'right')).count).toBe(1);

    recognizer.update(800, sample(800, 'left'));
    recognizer.update(920, sample(920, 'left'));
    const missing = sample(1_000, 'right').map(point => ({ ...point, visibility: 0 }));
    recognizer.update(1_000, missing, false);
    recognizer.update(1_200, sample(1_200, 'right'));
    expect(recognizer.update(1_320, sample(1_320, 'right')).count).toBe(1);

    recognizer.reset();
    expect(recognizer.count).toBe(0);
  });
});
