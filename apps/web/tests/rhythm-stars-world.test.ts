import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { RhythmSnapshot, RhythmStar } from '../../../packages/game/src/core/rhythm-types';
import { RHYTHM_PREVIEW_MS } from '../../../packages/game/src/core/rhythm-types';
import { RhythmStarsPresentation } from '../src/presentation/rhythm-stars';

function star(overrides: Partial<RhythmStar> = {}): RhythmStar {
  return {
    id: 1,
    atMs: 3_000,
    lane: -1,
    height: 'low',
    status: 'upcoming',
    resolvedAtMs: null,
    points: 100,
    ...overrides,
  };
}

function snapshot(stars: RhythmStar[], elapsedMs = 0): RhythmSnapshot {
  return {
    elapsedMs,
    stars,
    score: 0,
    cleared: stars.filter(item => item.status === 'collected').length,
    misses: stars.filter(item => item.status === 'missed').length,
    combo: 0,
    bestCombo: 0,
    feedback: '',
    feedbackKind: 'neutral',
  };
}

function renderedStar(presentation: RhythmStarsPresentation, id: number): THREE.Group {
  const target = presentation.group.getObjectByName(`rhythm-star-${id}`);
  if (!(target instanceof THREE.Group)) throw new Error(`Rhythm star ${id} was not rendered.`);
  return target;
}

describe('RhythmStarsPresentation', () => {
  it('moves a low star from its lane spawn to the marked runner pickup plane', () => {
    const presentation = new RhythmStarsPresentation();
    const target = star();

    const atSpawn = presentation.update(snapshot([target]), true);
    const visual = renderedStar(presentation, target.id);
    expect(atSpawn.visibleStars).toBe(1);
    expect(visual.position.x).toBe(-2.75);
    expect(visual.position.y).toBeCloseTo(1.02);
    expect(visual.position.z).toBe(-14);
    expect(presentation.group.getObjectByName('rhythm-pickup-line')).toBeInstanceOf(THREE.Mesh);
    expect(presentation.group.getObjectByName('rhythm-pickup-ring-0')).toBeInstanceOf(THREE.Mesh);

    presentation.update(snapshot([target], RHYTHM_PREVIEW_MS / 2), true);
    expect(renderedStar(presentation, target.id)).toBe(visual);
    expect(visual.position.z).toBe(-7);
    presentation.update(snapshot([target], RHYTHM_PREVIEW_MS), true);
    expect(visual.position.z).toBe(0);
    presentation.dispose();
  });

  it('puts high stars over the center lane and gives them a distinct jump marker', () => {
    const presentation = new RhythmStarsPresentation();
    const target = star({ id: 2, lane: 0, height: 'high' });

    presentation.update(snapshot([target]), true);
    const visual = renderedStar(presentation, target.id);
    expect(visual.position.x).toBe(0);
    expect(visual.position.y).toBeCloseTo(3.05);
    expect(visual.getObjectByName('rhythm-high-ring-2')).toBeInstanceOf(THREE.Mesh);
    expect(presentation.group.getObjectByName('rhythm-star-shape-2')).toBeInstanceOf(THREE.Mesh);
    presentation.dispose();
  });

  it('holds a collected star at its pickup position while it bursts and shrinks', () => {
    const presentation = new RhythmStarsPresentation();
    const target = star({ status: 'collected', resolvedAtMs: 2_940 });

    presentation.update(snapshot([target], 2_940), true);
    const visual = renderedStar(presentation, target.id);
    const firstScale = visual.scale.x;
    const firstBurstScale = visual.getObjectByName('rhythm-collection-burst-1')!.scale.x;
    const collectionZ = visual.position.z;

    presentation.update(snapshot([target], 3_180), true);
    expect(visual.position.z).toBe(collectionZ);
    expect(visual.scale.x).toBeLessThan(firstScale);
    expect(visual.getObjectByName('rhythm-collection-burst-1')!.scale.x).toBeGreaterThan(firstBurstScale);
    presentation.dispose();
  });

  it('lets missed stars pass the pickup plane in a muted state and hides outside Rhythm Run', () => {
    const presentation = new RhythmStarsPresentation();
    const target = star({ status: 'missed', resolvedAtMs: 3_240 });

    presentation.update(snapshot([target], 3_600), true);
    const visual = renderedStar(presentation, target.id);
    expect(visual.position.z).toBeGreaterThan(0);
    expect(visual.userData.rhythmStarStatus).toBe('missed');
    const shape = visual.getObjectByName('rhythm-star-shape-1') as THREE.Mesh;
    expect((shape.material as THREE.Material).opacity).toBeCloseTo(0.38);

    const hidden = presentation.update(snapshot([target], 3_600), false);
    expect(presentation.group.visible).toBe(false);
    expect(hidden.visibleStars).toBe(0);
    presentation.dispose();
  });

  it('returns next-star metadata and total collected count for canvas diagnostics', () => {
    const presentation = new RhythmStarsPresentation();
    const next = star({ id: 7, atMs: 4_000, lane: 1, height: 'high' });
    const earlierCollected = star({ id: 6, status: 'collected', resolvedAtMs: 2_940 });
    const state = presentation.update(snapshot([earlierCollected, next], 3_000), true);

    expect(state.collected).toBe(1);
    expect(state.nextStar).toMatchObject({ id: 7, atMs: 4_000, lane: 1, height: 'high' });
    expect(state.nextZ).toBeCloseTo(-14 / 3);
    const frozen = presentation.update(snapshot([earlierCollected, next], 3_200), true, true);
    expect(frozen.nextZ).toBe(state.nextZ);
    presentation.reset();
    expect(presentation.group.getObjectByName('rhythm-star-7')).toBeUndefined();
    presentation.dispose();
  });
});
