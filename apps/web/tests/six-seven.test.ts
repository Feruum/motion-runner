import { describe, expect, it } from 'vitest';
import { SixSevenRecognizer } from '@motion-runner/game';
import { pose } from './fixtures';

function sample(time: number, arms: Parameters<typeof pose>[2]) {
  const landmarks = pose(time, 0, arms).landmarks;
  if (arms === 'left') landmarks[16].y = .65;
  if (arms === 'right') landmarks[15].y = .65;
  return landmarks;
}

describe('Six-Seven hand sequence', () => {
  it('counts a full left-right-left cycle, not a single hand switch', () => {
    const recognizer = new SixSevenRecognizer();

    recognizer.update(0, sample(0, 'left'));
    recognizer.update(120, sample(120, 'left'));
    recognizer.update(400, sample(400, 'right'));
    const halfCycle = recognizer.update(520, sample(520, 'right'));
    expect(halfCycle).toMatchObject({ count: 0, completed: false });

    recognizer.update(800, sample(800, 'left'));
    const fullCycle = recognizer.update(920, sample(920, 'left'));
    expect(fullCycle).toMatchObject({ count: 1, completed: true });
  });

  it('counts repeated full cycles consistently at 15, 30 and 60 pose updates per second', () => {
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
      phase(1_200, 1_450, 'left');

      expect(recognizer.count, `${fps} pose updates per second`).toBe(2);
    }
  });

  it('does not count a held arm, two raised arms or motion below the amplitude threshold', () => {
    const recognizer = new SixSevenRecognizer();
    for (const time of [0, 120, 500, 1000, 1500]) recognizer.update(time, sample(time, 'left'));
    for (const time of [1600, 1720, 1900]) recognizer.update(time, sample(time, 'up'));

    const lowAmplitude = sample(2000, 'down').map(point => ({ ...point }));
    lowAmplitude[15].y = .32;
    for (const time of [2000, 2120, 2300]) recognizer.update(time, lowAmplitude);

    expect(recognizer.count).toBe(0);
  });

  it('requires a stable raised hand and times out an unfinished alternation', () => {
    const recognizer = new SixSevenRecognizer();
    recognizer.update(0, sample(0, 'left'));
    recognizer.update(60, sample(60, 'right'));
    recognizer.update(120, sample(120, 'left'));
    recognizer.update(240, sample(240, 'left'));
    recognizer.update(400, sample(400, 'right'));
    recognizer.update(520, sample(520, 'right'));
    recognizer.update(2800, sample(2800, 'left'));
    const restarted = recognizer.update(2920, sample(2920, 'left'));

    expect(restarted.count).toBe(0);
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
});
