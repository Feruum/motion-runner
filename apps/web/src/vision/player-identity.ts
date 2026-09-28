import { CONFIG as C } from '@motion-runner/game';
import type { Landmark } from '@motion-runner/game';

export type PlayerIdentity = 'player-1' | 'player-2';

export interface TorsoCenter {
  x: number;
  y: number;
  source: 'hips' | 'shoulders';
}

export interface IdentifiedPlayerPose {
  id: PlayerIdentity;
  landmarks: readonly Landmark[];
  center: TorsoCenter;
}

export interface PlayerIdentityResult {
  /** Stable identity slots; a missing player is null and is never duplicated. */
  players: readonly [IdentifiedPlayerPose | null, IdentifiedPlayerPose | null];
  visiblePlayerCount: number;
}

export interface PlayerIdentityOptions {
  /** Minimum visibility/presence for a torso point to participate in center calculation. */
  confidenceThreshold?: number;
}

interface Detection {
  inputIndex: number;
  landmarks: readonly Landmark[];
  center: TorsoCenter;
}

interface Point2D {
  x: number;
  y: number;
}

const SLOT_IDS: readonly [PlayerIdentity, PlayerIdentity] = ['player-1', 'player-2'];
const HIP_INDEXES = [23, 24] as const;
const SHOULDER_INDEXES = [11, 12] as const;

function visiblePoint(landmarks: readonly Landmark[], index: number, threshold: number): Point2D | null {
  const point = landmarks[index];
  if (!point
    || !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
    || !Number.isFinite(point.visibility)
    || point.visibility < threshold
    || (point.presence !== undefined && (!Number.isFinite(point.presence) || point.presence < threshold))) return null;
  return { x: point.x, y: point.y };
}

function centerFrom(landmarks: readonly Landmark[], indexes: readonly number[], threshold: number): Point2D | null {
  const points = indexes.map(index => visiblePoint(landmarks, index, threshold))
    .filter((point): point is Point2D => point !== null);
  if (points.length === 0) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function torsoCenter(landmarks: readonly Landmark[], threshold: number): TorsoCenter | null {
  const hips = centerFrom(landmarks, HIP_INDEXES, threshold);
  if (hips) return { ...hips, source: 'hips' };
  const shoulders = centerFrom(landmarks, SHOULDER_INDEXES, threshold);
  return shoulders ? { ...shoulders, source: 'shoulders' } : null;
}

function distance(left: Point2D, right: Point2D): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function compareDetections(left: Detection, right: Detection): number {
  return left.center.x - right.center.x
    || left.center.y - right.center.y
    || left.inputIndex - right.inputIndex;
}

/**
 * Assign up to two per-frame pose detections to stable player slots.
 *
 * The first frame with two usable detections labels them left-to-right, independent of detector
 * array order. Later frames use the minimum-total-distance matching to the last visible torso
 * centers, which remains stable when the detector reorders its outputs. If only one player is
 * visible, their identity stays in their slot and the other slot is null. Invalid detections do
 * not claim a slot or erase a previous center, so that identity can be matched when it returns.
 */
export class PlayerIdentityAdapter {
  private readonly confidenceThreshold: number;
  private readonly previousCenters: Array<TorsoCenter | null> = [null, null];

  constructor(options: PlayerIdentityOptions = {}) {
    this.confidenceThreshold = options.confidenceThreshold ?? C.confidence;
  }

  reset(): void {
    this.previousCenters[0] = null;
    this.previousCenters[1] = null;
  }

  update(detections: readonly (readonly Landmark[])[]): PlayerIdentityResult {
    if (detections.length > 2) throw new RangeError('PlayerIdentityAdapter accepts at most two players per frame');

    const validDetections: Detection[] = detections.flatMap((landmarks, inputIndex) => {
      const center = torsoCenter(landmarks, this.confidenceThreshold);
      return center ? [{ inputIndex, landmarks, center }] : [];
    });
    const assigned: [Detection | null, Detection | null] = [null, null];
    const occupiedSlots = this.previousCenters.map(center => center !== null);
    const occupiedIndexes = occupiedSlots.flatMap((occupied, index) => occupied ? [index as 0 | 1] : []);

    if (occupiedIndexes.length === 0) {
      const sorted = [...validDetections].sort(compareDetections);
      if (sorted[0]) assigned[0] = sorted[0];
      if (sorted[1]) assigned[1] = sorted[1];
    } else if (occupiedIndexes.length === 1) {
      this.assignWithOnePrior(occupiedIndexes[0], validDetections, assigned);
    } else {
      this.assignWithTwoPriors(validDetections, assigned);
    }

    const players: [IdentifiedPlayerPose | null, IdentifiedPlayerPose | null] = [null, null];
    for (const slot of [0, 1] as const) {
      const detection = assigned[slot];
      if (!detection) continue;
      this.previousCenters[slot] = detection.center;
      players[slot] = {
        id: SLOT_IDS[slot],
        landmarks: detection.landmarks,
        center: { ...detection.center },
      };
    }

    return { players, visiblePlayerCount: validDetections.length };
  }

  private assignWithOnePrior(
    priorSlot: 0 | 1,
    detections: readonly Detection[],
    assigned: [Detection | null, Detection | null],
  ): void {
    const prior = this.previousCenters[priorSlot];
    if (!prior || detections.length === 0) return;

    const ordered = [...detections].sort((left, right) => {
      const byDistance = distance(left.center, prior) - distance(right.center, prior);
      return byDistance || compareDetections(left, right);
    });
    assigned[priorSlot] = ordered[0];
    if (ordered[1]) assigned[priorSlot === 0 ? 1 : 0] = ordered[1];
  }

  private assignWithTwoPriors(
    detections: readonly Detection[],
    assigned: [Detection | null, Detection | null],
  ): void {
    const firstPrior = this.previousCenters[0];
    const secondPrior = this.previousCenters[1];
    if (!firstPrior || !secondPrior || detections.length === 0) return;

    if (detections.length === 1) {
      const detection = detections[0];
      const firstDistance = distance(detection.center, firstPrior);
      const secondDistance = distance(detection.center, secondPrior);
      assigned[firstDistance <= secondDistance ? 0 : 1] = detection;
      return;
    }

    const [firstDetection, secondDetection] = detections;
    const directCost = distance(firstPrior, firstDetection.center) + distance(secondPrior, secondDetection.center);
    const swappedCost = distance(firstPrior, secondDetection.center) + distance(secondPrior, firstDetection.center);
    if (directCost < swappedCost) {
      assigned[0] = firstDetection;
      assigned[1] = secondDetection;
    } else if (swappedCost < directCost) {
      assigned[0] = secondDetection;
      assigned[1] = firstDetection;
    } else {
      const leftToRight = [...detections].sort(compareDetections);
      assigned[0] = leftToRight[0];
      assigned[1] = leftToRight[1];
    }
  }
}
