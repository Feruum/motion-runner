export const DODGE_WAVE_COUNT = 24;
export const DODGE_ROUND_DURATION_MS = 60_000;
export const DODGE_FIRST_WAVE_MS = 4_000;
export const DODGE_WAVE_INTERVAL_MS = 2_300;
export const DODGE_LANE_CHANGE_MS = 500;
export const DODGE_REACTION_SLACK_MS = 750;
export const DODGE_TELEGRAPH_MS = 2_000;
export const DODGE_MAX_DELTA_MS = 300;
export const DODGE_CLEAR_SCORE = 10;
export const DODGE_COLLISION_PENALTY = 5;

export type DodgeLane = -1 | 0 | 1;
export type DodgeObstacleKind = 'high';

export interface DodgeObstacle {
  lane: DodgeLane;
  kind: DodgeObstacleKind;
}

export interface DodgeWave {
  id: number;
  atMs: number;
  warningAtMs: number;
  obstacles: DodgeObstacle[];
  resolved: boolean;
}

export interface DodgeInput {
  lane: DodgeLane;
}

export type DodgeEvent = 'clear' | 'hit' | 'miss' | 'finish';

export interface DodgeArenaSnapshot {
  elapsedMs: number;
  durationMs: number;
  score: number;
  cleared: number;
  collisions: number;
  /** Unsafe waves, counted at most once per wave. */
  misses: number;
  combo: number;
  bestCombo: number;
  lane: DodgeLane;
  paused: boolean;
  finished: boolean;
}

const lanes: readonly DodgeLane[] = [-1, 0, 1];
const authoredObstacleLanes: readonly (readonly DodgeLane[])[] = [
  [0], [-1], [1], [0], [1], [-1], [0], [1],
  [-1], [-1, 0], [0], [0, 1], [1], [-1, 1], [-1], [-1, 0],
  [-1, 0], [0, 1], [-1, 1], [-1, 0], [0, 1], [-1, 1], [-1, 0], [0, 1],
];

export function getReachableDodgeLanes(wave: Pick<DodgeWave, 'obstacles'>): DodgeLane[] {
  return lanes.filter(lane => !wave.obstacles.some(obstacle => obstacle.lane === lane));
}

export function validateDodgeWaves(waves: readonly DodgeWave[]): void {
  const ids = new Set<number>();
  let previousAtMs = -Infinity;
  let reachableLanes: DodgeLane[] = [];

  for (const wave of waves) {
    if (!Number.isInteger(wave.id) || wave.id < 0 || ids.has(wave.id)) {
      throw new Error('Dodge wave id ' + wave.id + ' must be a unique non-negative integer.');
    }
    if (!Number.isFinite(wave.atMs) || wave.atMs < 0 || wave.atMs <= previousAtMs) {
      throw new Error('Dodge wave ' + wave.id + ' must have a finite, increasing time.');
    }
    if (!Number.isFinite(wave.warningAtMs) || wave.warningAtMs > wave.atMs - DODGE_TELEGRAPH_MS) {
      throw new Error('Dodge wave ' + wave.id + ' must be telegraphed at least 2 seconds before impact.');
    }
    if (wave.obstacles.length === 0) {
      throw new Error('Dodge wave ' + wave.id + ' must include at least one obstacle.');
    }
    if (wave.obstacles.some(obstacle => !lanes.includes(obstacle.lane) || obstacle.kind !== 'high')) {
      throw new Error('Dodge wave ' + wave.id + ' contains an unsupported obstacle.');
    }

    const safeLanes = getReachableDodgeLanes(wave);
    if (safeLanes.length === 0) {
      throw new Error('Dodge wave ' + wave.id + ' has no reachable safe lane.');
    }

    if (ids.size > 0) {
      const gapMs = wave.atMs - previousAtMs;
      const canChangeLane = gapMs >= DODGE_LANE_CHANGE_MS + DODGE_REACTION_SLACK_MS;
      reachableLanes = safeLanes.filter(lane => canChangeLane || reachableLanes.includes(lane));
      if (reachableLanes.length === 0) {
        throw new Error('Dodge wave ' + wave.id + ' has no reachable lane transition from the previous wave.');
      }
    } else {
      reachableLanes = safeLanes;
    }

    ids.add(wave.id);
    previousAtMs = wave.atMs;
  }
}

export function makeDodgeWaves(): DodgeWave[] {
  const waves = authoredObstacleLanes.map((obstacleLanes, id) => ({
    id,
    atMs: DODGE_FIRST_WAVE_MS + id * DODGE_WAVE_INTERVAL_MS,
    warningAtMs: DODGE_FIRST_WAVE_MS + id * DODGE_WAVE_INTERVAL_MS - DODGE_TELEGRAPH_MS,
    obstacles: obstacleLanes.map(lane => ({ lane, kind: 'high' as const })),
    resolved: false,
  }));
  validateDodgeWaves(waves);
  return waves;
}

function freshWave(wave: DodgeWave): DodgeWave {
  return { ...wave, obstacles: wave.obstacles.map(obstacle => ({ ...obstacle })), resolved: false };
}

export class DodgeArenaRuntime {
  elapsedMs = 0;
  score = 0;
  cleared = 0;
  collisions = 0;
  misses = 0;
  combo = 0;
  bestCombo = 0;
  paused = false;
  finished = false;
  lane: DodgeLane = 0;
  waves: DodgeWave[];
  private readonly startingWaves: DodgeWave[];

  constructor(
    readonly durationMs = DODGE_ROUND_DURATION_MS,
    waves: readonly DodgeWave[] = makeDodgeWaves(),
  ) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new RangeError('Dodge round duration must be a positive finite number.');
    }
    validateDodgeWaves(waves);
    this.startingWaves = waves.map(freshWave);
    this.waves = this.startingWaves.map(freshWave);
  }

  update(deltaMs: number, input: DodgeInput): DodgeEvent[] {
    if (this.paused || this.finished || !Number.isFinite(deltaMs) || deltaMs < 0 || deltaMs > DODGE_MAX_DELTA_MS) return [];

    this.lane = input.lane;
    this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + deltaMs);
    const events: DodgeEvent[] = [];

    for (const wave of this.waves) {
      if (wave.resolved || wave.atMs > this.elapsedMs || wave.atMs > this.durationMs) continue;

      wave.resolved = true;
      const collisions = wave.obstacles.filter(obstacle => obstacle.lane === this.lane).length;
      if (collisions > 0) {
        this.collisions += collisions;
        this.misses++;
        this.score = Math.max(0, this.score - DODGE_COLLISION_PENALTY * collisions);
        this.combo = 0;
        events.push('hit', 'miss');
      } else {
        this.score += DODGE_CLEAR_SCORE;
        this.cleared++;
        this.combo++;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        events.push('clear');
      }
    }

    if (this.elapsedMs >= this.durationMs) {
      this.finished = true;
      events.push('finish');
    }
    return events;
  }

  pause(): void {
    if (!this.finished) this.paused = true;
  }

  resume(): void {
    if (!this.finished) this.paused = false;
  }

  reset(): void {
    this.elapsedMs = 0;
    this.score = 0;
    this.cleared = 0;
    this.collisions = 0;
    this.misses = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.paused = false;
    this.finished = false;
    this.lane = 0;
    this.waves = this.startingWaves.map(freshWave);
  }

  snapshot(): DodgeArenaSnapshot {
    return {
      elapsedMs: this.elapsedMs,
      durationMs: this.durationMs,
      score: this.score,
      cleared: this.cleared,
      collisions: this.collisions,
      misses: this.misses,
      combo: this.combo,
      bestCombo: this.bestCombo,
      lane: this.lane,
      paused: this.paused,
      finished: this.finished,
    };
  }
}
