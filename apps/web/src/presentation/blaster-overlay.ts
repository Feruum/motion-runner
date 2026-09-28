import type { BeatBlasterHighlight } from '../../../../packages/game/src/core/blaster';

/** Canvas backing size and source-camera size used by the mirrored cover preview. */
export interface BlasterOverlayViewport {
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
}

/** A target transformed into the visible preview, ready for canvas drawing. */
export interface BlasterOverlayTarget {
  id: string;
  side: 'left' | 'right';
  /** Horizontal position after cover-cropping, normalized across the visible preview. */
  x: number;
  /** Vertical position after cover-cropping, normalized across the visible preview. */
  y: number;
  /** Circle radius normalized against the shorter side of the visible preview. */
  radius: number;
  handLabel: 'LEFT HAND' | 'RIGHT HAND';
  color: string;
}

export const BLASTER_OVERLAY_MIN_RADIUS = 0.025;
export const BLASTER_OVERLAY_MAX_RADIUS = 0.18;

const sideColors: Record<BlasterOverlayTarget['side'], string> = {
  left: '#67e8f9',
  right: '#fbbf77',
};

/**
 * Maps a runtime highlight into the actual object-fit: cover preview rectangle.
 * Runtime x is already in mirrored-preview space, so its anatomical side stays
 * unchanged while the skeleton canvas itself is compensated at draw time.
 */
export function placeBlasterOverlayTarget(
  target: BeatBlasterHighlight | null | undefined,
  viewport: BlasterOverlayViewport,
): BlasterOverlayTarget | null {
  if (!target || !viewport
    || !Number.isFinite(target.x) || !Number.isFinite(target.y)
    || !Number.isFinite(target.radius) || target.radius <= 0
    || (target.side !== 'left' && target.side !== 'right')
    || !Number.isFinite(viewport.width) || viewport.width <= 0
    || !Number.isFinite(viewport.height) || viewport.height <= 0
    || !Number.isFinite(viewport.frameWidth) || viewport.frameWidth <= 0
    || !Number.isFinite(viewport.frameHeight) || viewport.frameHeight <= 0) {
    return null;
  }

  const { width, height, frameWidth, frameHeight } = viewport;
  const coverScale = Math.max(width / frameWidth, height / frameHeight);
  const renderedWidth = frameWidth * coverScale;
  const renderedHeight = frameHeight * coverScale;
  const shortSide = Math.min(width, height);

  const displayX = (target.x * renderedWidth + (width - renderedWidth) / 2) / width;
  const displayY = (target.y * renderedHeight + (height - renderedHeight) / 2) / height;
  const radius = Math.min(
    BLASTER_OVERLAY_MAX_RADIUS,
    Math.max(BLASTER_OVERLAY_MIN_RADIUS, target.radius * renderedHeight / shortSide),
  );

  return {
    id: target.id,
    side: target.side,
    // Clamp after cover-cropping so the whole circle remains visible, including
    // targets whose torso-relative offset places them just beyond the frame.
    x: clamp(displayX, radius * shortSide / width, 1 - radius * shortSide / width),
    y: clamp(displayY, radius * shortSide / height, 1 - radius * shortSide / height),
    radius,
    handLabel: target.side === 'left' ? 'LEFT HAND' : 'RIGHT HAND',
    color: sideColors[target.side],
  };
}

/**
 * Draws a target into the skeleton canvas, whose parent mirrors the canvas with
 * scaleX(-1). The circle's x-coordinate is pre-mirrored; the label is flipped
 * locally so it remains readable after the parent mirror.
 */
export function drawBlasterTarget(
  context: CanvasRenderingContext2D,
  target: BlasterOverlayTarget | null | undefined,
  width: number,
  height: number,
): void {
  if (!target || !context || !Number.isFinite(width) || width <= 0
    || !Number.isFinite(height) || height <= 0
    || !Number.isFinite(target.x) || !Number.isFinite(target.y)
    || !Number.isFinite(target.radius) || target.radius <= 0) {
    return;
  }

  const centerX = width * (1 - target.x);
  const centerY = height * target.y;
  const radiusPx = target.radius * Math.min(width, height);

  context.save();
  context.beginPath();
  context.arc(centerX, centerY, radiusPx, 0, Math.PI * 2);
  context.fillStyle = `${target.color}33`;
  context.fill();
  context.lineWidth = Math.max(2, Math.min(width, height) * 0.008);
  context.strokeStyle = target.color;
  context.stroke();
  context.restore();

  context.save();
  // Keep glyphs readable after the camera-mirror wrapper flips the canvas.
  context.translate(centerX * 2, 0);
  context.scale(-1, 1);
  context.fillStyle = target.color;
  context.font = `600 ${Math.max(11, Math.min(width, height) * 0.045)}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(target.handLabel, centerX, centerY + radiusPx + Math.max(12, radiusPx * 0.4));
  context.restore();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
