import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { RacePlayer } from '../../../packages/game/src/core/race-types';
import { interpolateRacePosition, selectRaceCameraTarget, sweeperVisualRotation } from '../src/presentation/race-world';

function player(overrides: Partial<RacePlayer> & Pick<RacePlayer, 'id'>): RacePlayer {
  return {
    name: overrides.id,
    characterId: 'rogue',
    isBot: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vz: 0,
    checkpoint: 0,
    rank: 1,
    finishMs: null,
    status: 'racing',
    invulnerableMs: 0,
    stunMs: 0,
    ...overrides,
  };
}

describe('race world helpers', () => {
  it('interpolates actor coordinates and clamps the blend amount', () => {
    const from = player({ id: 'p1', x: -2, y: 0, z: 10 });
    const to = player({ id: 'p1', x: 2, y: 4, z: 30 });

    expect(interpolateRacePosition(from, to, 0.25)).toEqual({ x: -1, y: 1, z: 15 });
    expect(interpolateRacePosition(from, to, 2)).toEqual({ x: 2, y: 4, z: 30 });
  });

  it('spectates the furthest active runner when the local runner has finished', () => {
    const local = player({ id: 'local', z: 300, status: 'finished' });
    const nearby = player({ id: 'nearby', z: 320 });
    const leader = player({ id: 'leader', z: 410 });

    expect(selectRaceCameraTarget([local, nearby, leader], 'local')?.id).toBe('leader');
  });

  it('keeps the local runner as camera target during the race', () => {
    const local = player({ id: 'local', z: 40 });
    const leader = player({ id: 'leader', z: 220 });

    expect(selectRaceCameraTarget([local, leader], 'local')?.id).toBe('local');
  });

  it('rotates the rendered sweeper endpoint in the simulation direction', () => {
    const collisionAngle = Math.PI / 4;
    const renderedEndpoint = new THREE.Vector3(1, 0, 0)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), sweeperVisualRotation(collisionAngle));

    expect(renderedEndpoint.x).toBeCloseTo(Math.cos(collisionAngle));
    expect(renderedEndpoint.z).toBeCloseTo(-Math.sin(collisionAngle));
  });
});
