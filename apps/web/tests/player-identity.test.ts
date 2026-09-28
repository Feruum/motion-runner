import { describe, expect, it } from 'vitest';
import type { Landmark } from '@motion-runner/game';
import { PlayerIdentityAdapter, type PlayerIdentity } from '../src/vision/player-identity';

function poseAt(centerX: number, centerY = 0.55): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: centerX, y: centerY, z: 0, visibility: 0.99, presence: 0.99 }));
  const set = (index: number, x: number, y: number, visibility = 0.99) => {
    landmarks[index] = { x, y, z: 0, visibility, presence: 0.99 };
  };
  set(11, centerX + 0.08, centerY - 0.18); set(12, centerX - 0.08, centerY - 0.18);
  set(23, centerX + 0.06, centerY + 0.12); set(24, centerX - 0.06, centerY + 0.12);
  return landmarks;
}

function identifiedIds(players: readonly [
  { id: PlayerIdentity } | null,
  { id: PlayerIdentity } | null,
]): Array<PlayerIdentity | null> {
  return players.map(player => player?.id ?? null);
}

describe('PlayerIdentityAdapter', () => {
  it('labels first appearances deterministically from left to right, regardless of detector order', () => {
    const adapter = new PlayerIdentityAdapter();
    const result = adapter.update([poseAt(0.78), poseAt(0.22)]);

    expect(identifiedIds(result.players)).toEqual(['player-1', 'player-2']);
    expect(result.players[0]?.center.x).toBeCloseTo(0.22);
    expect(result.players[1]?.center.x).toBeCloseTo(0.78);
  });

  it('assigns reordered detections to the nearest prior torso centers, including near a crossing', () => {
    const adapter = new PlayerIdentityAdapter();
    adapter.update([poseAt(0.32), poseAt(0.68)]);

    const reordered = adapter.update([poseAt(0.65), poseAt(0.35)]);
    expect(identifiedIds(reordered.players)).toEqual(['player-1', 'player-2']);
    expect(reordered.players[0]?.center.x).toBeCloseTo(0.35);
    expect(reordered.players[1]?.center.x).toBeCloseTo(0.65);

    const crossedOrder = adapter.update([poseAt(0.54), poseAt(0.46)]);
    expect(crossedOrder.players[0]?.center.x).toBeCloseTo(0.46);
    expect(crossedOrder.players[1]?.center.x).toBeCloseTo(0.54);
  });

  it('returns one identified player and one empty slot on loss, then restores both identities', () => {
    const adapter = new PlayerIdentityAdapter();
    adapter.update([poseAt(0.25), poseAt(0.75)]);

    const onlyPlayerTwo = adapter.update([poseAt(0.72)]);
    expect(identifiedIds(onlyPlayerTwo.players)).toEqual([null, 'player-2']);
    expect(onlyPlayerTwo.players[1]?.landmarks).toHaveLength(33);

    const bothReturn = adapter.update([poseAt(0.27), poseAt(0.7)]);
    expect(identifiedIds(bothReturn.players)).toEqual(['player-1', 'player-2']);
    expect(bothReturn.players[0]?.center.x).toBeCloseTo(0.27);
    expect(bothReturn.players[1]?.center.x).toBeCloseTo(0.7);
  });

  it('ignores invalid torso centers without consuming an identity or duplicating a visible player', () => {
    const adapter = new PlayerIdentityAdapter();
    const invalid = poseAt(0.4);
    for (const index of [11, 12, 23, 24]) {
      invalid[index].x = Number.NaN;
      invalid[index].visibility = 0.1;
    }

    const first = adapter.update([invalid]);
    expect(identifiedIds(first.players)).toEqual([null, null]);

    const visible = adapter.update([invalid, poseAt(0.62)]);
    expect(identifiedIds(visible.players)).toEqual(['player-1', null]);
    expect(visible.players[0]?.center.x).toBeCloseTo(0.62);
    expect(visible.players[0]?.landmarks).toHaveLength(33);
  });

  it('falls back to visible shoulder centers when hip landmarks are unavailable', () => {
    const adapter = new PlayerIdentityAdapter();
    const noHips = poseAt(0.5);
    noHips[23].visibility = 0.1;
    noHips[24].visibility = 0.1;
    noHips[11].x = 0.58;
    noHips[12].x = 0.42;

    const result = adapter.update([noHips]);
    expect(result.players[0]?.center.x).toBeCloseTo(0.5);
    expect(result.players[0]?.center.source).toBe('shoulders');
  });

  it('resets stored centers so new first appearances are labeled from the new frame', () => {
    const adapter = new PlayerIdentityAdapter();
    adapter.update([poseAt(0.25), poseAt(0.75)]);
    adapter.reset();

    const afterReset = adapter.update([poseAt(0.75)]);
    expect(identifiedIds(afterReset.players)).toEqual(['player-1', null]);
  });

  it('rejects frames containing more than two detections', () => {
    const adapter = new PlayerIdentityAdapter();
    expect(() => adapter.update([poseAt(0.2), poseAt(0.5), poseAt(0.8)])).toThrow(/two players/i);
  });
});
