import { describe, expect, it } from 'vitest';
import { nextBeatDelayMs } from '../src/presentation/music-transport';

describe('music beat phase', () => {
  it('waits for the next full beat after resuming at an offset', () => {
    expect(nextBeatDelayMs(1_250, 120)).toBe(250);
  });

  it('starts on the current beat when the offset is exactly on beat', () => {
    expect(nextBeatDelayMs(1_000, 120)).toBe(0);
  });

  it('uses the configured tempo', () => {
    expect(nextBeatDelayMs(1_250, 100)).toBe(550);
  });
});
