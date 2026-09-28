import { describe, expect, it } from 'vitest';
import { drawBlasterTarget, placeBlasterOverlayTarget } from '../src/presentation/blaster-overlay';
import type { BeatBlasterHighlight } from '../../../packages/game/src/core/blaster';

const viewport = { width: 300, height: 200, frameWidth: 640, frameHeight: 480 };

function target(overrides: Partial<BeatBlasterHighlight> = {}): BeatBlasterHighlight {
  return { id: 'cue-1', side: 'left', x: 0.2, y: 0.35, radius: 0.06, ...overrides };
}

describe('Beat Blaster camera overlay', () => {
  it('keeps target placement in mirrored-preview coordinates and maps the expected hand', () => {
    const placed = placeBlasterOverlayTarget(target(), { ...viewport, width: 300, height: 225 });
    expect(placed).not.toBeNull();
    expect(placed?.x).toBeCloseTo(0.2);
    expect(placed?.y).toBeCloseTo(0.35);
    expect(placed?.handLabel).toBe('LEFT HAND');

    const arcCalls: number[][] = [];
    const context = {
      save() {}, restore() {}, beginPath() {}, fill() {}, stroke() {}, fillText() {},
      translate() {}, scale() {},
      arc: (...args: number[]) => arcCalls.push(args),
    } as unknown as CanvasRenderingContext2D;
    drawBlasterTarget(context, placed, 300, 225);

    expect(arcCalls[0][0]).toBeCloseTo(240);
    expect(arcCalls[0][1]).toBeCloseTo(78.75);
  });

  it('maps right-hand targets without changing their anatomical label', () => {
    const placed = placeBlasterOverlayTarget(target({ side: 'right', x: 0.72 }), viewport);
    expect(placed).toMatchObject({ side: 'right', handLabel: 'RIGHT HAND' });
  });

  it('accounts for horizontal cover-cropping while retaining mirrored-preview x', () => {
    const placed = placeBlasterOverlayTarget(target({ x: 0.4 }), {
      width: 200, height: 300, frameWidth: 640, frameHeight: 480,
    });
    expect(placed).not.toBeNull();
    // Cover scale is 0.625, leaving 100 px cropped from each horizontal edge.
    expect(placed?.x).toBeCloseTo(0.3);
  });

  it('keeps the full target in bounds and scales its radius with torso size', () => {
    const nearEdge = placeBlasterOverlayTarget(target({ x: 0.01, y: 0.99, radius: 0.08 }), viewport);
    const small = placeBlasterOverlayTarget(target({ radius: 0.04 }), viewport);
    const large = placeBlasterOverlayTarget(target({ radius: 0.08 }), viewport);

    expect(nearEdge).not.toBeNull();
    const horizontalInset = nearEdge!.radius * Math.min(viewport.width, viewport.height) / viewport.width;
    const verticalInset = nearEdge!.radius * Math.min(viewport.width, viewport.height) / viewport.height;
    expect(nearEdge!.x).toBeGreaterThanOrEqual(horizontalInset);
    expect(nearEdge!.x).toBeLessThanOrEqual(1 - horizontalInset);
    expect(nearEdge!.y).toBeGreaterThanOrEqual(verticalInset);
    expect(nearEdge!.y).toBeLessThanOrEqual(1 - verticalInset);
    expect(large!.radius).toBeGreaterThan(small!.radius);
    expect(nearEdge!.radius).toBeLessThanOrEqual(0.18);
  });

  it('ignores missing, non-finite, and invalid-sized inputs', () => {
    expect(placeBlasterOverlayTarget(null, viewport)).toBeNull();
    expect(placeBlasterOverlayTarget(target({ x: Number.NaN }), viewport)).toBeNull();
    expect(placeBlasterOverlayTarget(target({ radius: -1 }), viewport)).toBeNull();
    expect(placeBlasterOverlayTarget(target(), { ...viewport, frameWidth: 0 })).toBeNull();
  });
});
