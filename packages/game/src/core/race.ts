import type { RaceEntrant, RaceInput, RacePlayer, RaceSnapshot } from './race-types';
import { obstacleOffset, RACE_TRACK } from './race-track';

const STEP_MS = 1000 / 30;
const STEP_SECONDS = STEP_MS / 1000;
const PLAYER_RADIUS = 0.45;
const MAX_X = RACE_TRACK.width / 2 - 0.5;
const JUMP_VELOCITY = 6.5;
const GRAVITY = 11.5;
const RESPAWN_MS = 800;
const RESPAWN_INVULNERABILITY_MS = 1000;
const OBSTACLE_INVULNERABILITY_MS = 1100;
const STUN_MS = 650;
const BUMP_STUN_MS = 180;
const BUMP_SLOW_SPEED = 5.5;
const LOW_HAZARD_CLEARANCE = 1.05;

interface RunnerState {
  player: RacePlayer;
  jumpArmed: boolean;
  jumpHeld: boolean;
  verticalVelocity: number;
  fallRemainingMs: number;
  bumpSlowMs: number;
  tracking: boolean;
  botLaneOffset: number;
  botJumpHeld: boolean;
}

interface NormalizedInput extends RaceInput {}

const NO_INPUT: NormalizedInput = { steer: 0, jump: false, tracking: false };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeInput(input: RaceInput | undefined): NormalizedInput {
  if (!input) return { ...NO_INPUT };
  return {
    steer: Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0,
    jump: input.jump === true,
    tracking: input.tracking === true,
  };
}

function hash(value: string, seed: number): number {
  let result = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619) >>> 0;
  }
  return result >>> 0;
}

function pairKey(first: string, second: string): string {
  return first < second ? `${first}\u0000${second}` : `${second}\u0000${first}`;
}

export class RaceEngine {
  private readonly runners: RunnerState[];
  private readonly seed: number;
  private readonly externalJumpHeld = new Map<string, boolean>();
  private readonly pendingJumps = new Set<string>();
  private readonly pairCooldowns = new Map<string, number>();
  private latestInputs: Record<string, NormalizedInput> = {};
  private accumulatorMs = 0;
  private ticks = 0;

  constructor(entrants: RaceEntrant[], seed = 1) {
    this.seed = Number.isFinite(seed) ? seed >>> 0 : 1;
    const spacing = entrants.length > 1 ? Math.min(1.1, 10 / (entrants.length - 1)) : 0;
    const middle = (entrants.length - 1) / 2;
    this.runners = entrants.map((entrant, index) => {
      const laneOffset = (index - middle) * 0.4;
      return {
        player: {
          ...entrant,
          x: clamp((index - middle) * spacing, -MAX_X, MAX_X),
          y: 0,
          z: 0,
          vx: 0,
          vz: 0,
          checkpoint: 0,
          rank: index + 1,
          finishMs: null,
          status: 'racing',
          invulnerableMs: 0,
          stunMs: 0,
        },
        jumpArmed: true,
        jumpHeld: false,
        verticalVelocity: 0,
        fallRemainingMs: 0,
        bumpSlowMs: 0,
        tracking: false,
        botLaneOffset: laneOffset,
        botJumpHeld: false,
      };
    });
    this.refreshRanks();
  }

  update(deltaMs: number, inputs: Record<string, RaceInput>): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0 || this.isFinished()) return;

    this.captureInputs(inputs);
    this.accumulatorMs += deltaMs;
    while (this.accumulatorMs + 1e-8 >= STEP_MS && !this.isFinished()) {
      this.accumulatorMs = Math.max(0, this.accumulatorMs - STEP_MS);
      this.step();
    }
  }

  snapshot(): RaceSnapshot {
    const elapsedMs = Math.min(RACE_TRACK.timeLimitMs, this.ticks * STEP_MS);
    return {
      elapsedMs: Math.round(elapsedMs * 1e9) / 1e9,
      finished: this.isFinished(),
      players: this.runners
        .map(({ player }) => ({ ...player }))
        .sort((first, second) => first.rank - second.rank),
    };
  }

  markDNF(id: string): void {
    const runner = this.runners.find(candidate => candidate.player.id === id);
    if (!runner || runner.player.status === 'finished' || runner.player.status === 'dnf') return;
    runner.player.status = 'dnf';
    runner.player.vx = 0;
    runner.player.vz = 0;
    runner.player.finishMs = null;
    this.refreshRanks();
  }

  private captureInputs(inputs: Record<string, RaceInput>): void {
    const next: Record<string, NormalizedInput> = {};
    for (const runner of this.runners) {
      if (runner.player.isBot || runner.player.status === 'finished' || runner.player.status === 'dnf') continue;
      const input = normalizeInput(inputs[runner.player.id]);
      const wasHeld = this.externalJumpHeld.get(runner.player.id) ?? false;
      if (!input.tracking) this.pendingJumps.delete(runner.player.id);
      else if (input.jump && !wasHeld) this.pendingJumps.add(runner.player.id);
      this.externalJumpHeld.set(runner.player.id, input.jump);
      next[runner.player.id] = input;
    }
    this.latestInputs = next;
  }

  private step(): void {
    this.ticks += 1;
    const elapsedMs = Math.min(RACE_TRACK.timeLimitMs, this.ticks * STEP_MS);

    for (const runner of this.runners) {
      const player = runner.player;
      if (player.status === 'finished' || player.status === 'dnf') continue;

      const input = player.isBot ? this.makeBotInput(runner, elapsedMs) : (this.latestInputs[player.id] ?? NO_INPUT);
      const jumpPulse = player.isBot
        ? input.jump && !runner.botJumpHeld
        : this.pendingJumps.delete(player.id);
      if (player.isBot) runner.botJumpHeld = input.jump;
      this.advanceRunner(runner, input, jumpPulse, elapsedMs);
    }

    this.resolvePlayerBumps();
    if (elapsedMs >= RACE_TRACK.timeLimitMs) {
      for (const runner of this.runners) {
        if (runner.player.status === 'racing' || runner.player.status === 'falling') {
          runner.player.status = 'dnf';
          runner.player.vx = 0;
          runner.player.vz = 0;
          runner.player.finishMs = null;
        }
      }
    }
    this.refreshRanks();
  }

  private advanceRunner(runner: RunnerState, input: NormalizedInput, jumpPulse: boolean, elapsedMs: number): void {
    const player = runner.player;
    runner.tracking = input.tracking;
    if (player.status === 'falling') {
      runner.jumpHeld = input.jump;
      runner.fallRemainingMs -= STEP_MS;
      player.y -= GRAVITY * STEP_SECONDS;
      player.vx = 0;
      player.vz = 0;
      runner.bumpSlowMs = Math.max(0, runner.bumpSlowMs - STEP_MS);
      if (runner.fallRemainingMs <= 1e-7) this.respawn(runner, input);
      return;
    }

    if (player.invulnerableMs > 0) player.invulnerableMs = Math.max(0, player.invulnerableMs - STEP_MS);
    if (player.stunMs > 0) player.stunMs = Math.max(0, player.stunMs - STEP_MS);
    if (runner.bumpSlowMs > 0) runner.bumpSlowMs = Math.max(0, runner.bumpSlowMs - STEP_MS);

    if (jumpPulse && runner.jumpArmed && player.y <= 0 && input.tracking) {
      runner.verticalVelocity = JUMP_VELOCITY;
      runner.jumpArmed = false;
    }

    if (player.y > 0 || runner.verticalVelocity > 0) {
      runner.verticalVelocity -= GRAVITY * STEP_SECONDS;
      player.y += runner.verticalVelocity * STEP_SECONDS;
      if (player.y <= 0) {
        player.y = 0;
        runner.verticalVelocity = 0;
        if (!input.jump) runner.jumpArmed = true;
      }
    } else if (!input.jump && runner.jumpHeld) {
      runner.jumpArmed = true;
    }
    runner.jumpHeld = input.jump;

    if (input.tracking) {
      player.vx = input.steer * 6;
      player.x = clamp(player.x + player.vx * STEP_SECONDS, -MAX_X, MAX_X);
      player.vz = runner.bumpSlowMs > 0 ? BUMP_SLOW_SPEED : player.stunMs > 0 ? 2.5 : RACE_TRACK.speed;
      player.z += player.vz * STEP_SECONDS;
    } else {
      player.vx = 0;
      player.vz = 0;
    }

    this.updateCheckpoint(player);
    if (player.invulnerableMs <= 0 && this.collidesWithObstacle(player, elapsedMs)) this.hitObstacle(runner);
    if (player.status === 'racing' && player.z >= RACE_TRACK.length) {
      player.z = RACE_TRACK.length;
      player.status = 'finished';
      player.finishMs = elapsedMs;
      player.vx = 0;
      player.vz = 0;
    }
  }

  private updateCheckpoint(player: RacePlayer): void {
    for (const checkpoint of RACE_TRACK.checkpoints) {
      if (checkpoint > player.checkpoint && player.z >= checkpoint) player.checkpoint = checkpoint;
    }
  }

  private collidesWithObstacle(player: RacePlayer, elapsedMs: number): boolean {
    for (const obstacle of RACE_TRACK.obstacles) {
      const longitudinalDistance = Math.abs(player.z - obstacle.z);
      if (obstacle.kind === 'gap') {
        if (
          longitudinalDistance <= obstacle.depth / 2 &&
          Math.abs(player.x) <= obstacle.width / 2 + PLAYER_RADIUS &&
          player.y <= 0
        ) {
          player.status = 'falling';
          player.vx = 0;
          player.vz = 0;
          player.y = -0.05;
          return true;
        }
        continue;
      }

      if (obstacle.kind === 'gate') {
        if (longitudinalDistance > obstacle.depth / 2 + PLAYER_RADIUS) continue;
        const openingX = obstacleOffset(obstacle, elapsedMs);
        if (Math.abs(player.x - openingX) > obstacle.width / 2 - PLAYER_RADIUS) return true;
        continue;
      }

      const angle = obstacleOffset(obstacle, elapsedMs);
      const maxLongitudinalReach = obstacle.depth / 2 + PLAYER_RADIUS + Math.abs(Math.sin(angle)) * obstacle.width / 2;
      if (longitudinalDistance > maxLongitudinalReach) continue;
      if (player.y >= LOW_HAZARD_CLEARANCE) continue;
      const dx = player.x;
      const dz = player.z - obstacle.z;
      // Three.js positive rotation.y sends the beam's +x end toward negative z.
      const alongBeam = dx * Math.cos(angle) - dz * Math.sin(angle);
      const acrossBeam = Math.abs(dx * Math.sin(angle) + dz * Math.cos(angle));
      if (
        Math.abs(alongBeam) <= obstacle.width / 2 + PLAYER_RADIUS &&
        acrossBeam <= obstacle.depth / 2 + PLAYER_RADIUS
      ) {
        return true;
      }
    }
    return false;
  }

  private hitObstacle(runner: RunnerState): void {
    const player = runner.player;
    if (player.status === 'falling') {
      runner.fallRemainingMs = RESPAWN_MS;
      runner.verticalVelocity = -2;
      return;
    }
    player.z = Math.max(player.checkpoint, player.z - 1.25);
    player.vz = 0;
    player.stunMs = STUN_MS;
    player.invulnerableMs = OBSTACLE_INVULNERABILITY_MS;
    runner.bumpSlowMs = 0;
  }

  private respawn(runner: RunnerState, input: NormalizedInput): void {
    const player = runner.player;
    player.status = 'racing';
    player.x = 0;
    player.y = 0;
    player.z = player.checkpoint;
    player.vx = 0;
    player.vz = 0;
    player.stunMs = 0;
    player.invulnerableMs = RESPAWN_INVULNERABILITY_MS;
    runner.verticalVelocity = 0;
    runner.bumpSlowMs = 0;
    runner.tracking = input.tracking;
    runner.jumpArmed = !input.jump;
  }

  private resolvePlayerBumps(): void {
    for (let firstIndex = 0; firstIndex < this.runners.length; firstIndex += 1) {
      const first = this.runners[firstIndex];
      if (first.player.status !== 'racing') continue;
      for (let secondIndex = firstIndex + 1; secondIndex < this.runners.length; secondIndex += 1) {
        const second = this.runners[secondIndex];
        if (second.player.status !== 'racing') continue;
        const key = pairKey(first.player.id, second.player.id);
        const cooldown = this.pairCooldowns.get(key) ?? 0;
        if (cooldown > 0) this.pairCooldowns.set(key, Math.max(0, cooldown - STEP_MS));
        const dx = first.player.x - second.player.x;
        const dz = first.player.z - second.player.z;
        if (
          Math.abs(dx) >= PLAYER_RADIUS * 2 ||
          Math.abs(dz) > 0.9 ||
          Math.abs(first.player.y - second.player.y) >= 0.8 ||
          !first.tracking ||
          !second.tracking ||
          first.player.invulnerableMs > 0 ||
          second.player.invulnerableMs > 0 ||
          cooldown > 0
        ) continue;

        const direction = dx === 0 ? (first.player.id < second.player.id ? -1 : 1) : Math.sign(dx);
        first.player.x = clamp(first.player.x + direction * 0.18, -MAX_X, MAX_X);
        second.player.x = clamp(second.player.x - direction * 0.18, -MAX_X, MAX_X);
        first.player.vx = direction * 1.5;
        second.player.vx = -direction * 1.5;
        first.player.vz = BUMP_SLOW_SPEED;
        second.player.vz = BUMP_SLOW_SPEED;
        first.player.stunMs = Math.max(first.player.stunMs, BUMP_STUN_MS);
        second.player.stunMs = Math.max(second.player.stunMs, BUMP_STUN_MS);
        first.bumpSlowMs = BUMP_STUN_MS;
        second.bumpSlowMs = BUMP_STUN_MS;
        this.pairCooldowns.set(key, 900);
      }
    }
  }

  private makeBotInput(runner: RunnerState, elapsedMs: number): NormalizedInput {
    const player = runner.player;
    let steer = 0;
    const gate = RACE_TRACK.obstacles.find(obstacle =>
      obstacle.kind === 'gate' && obstacle.z - player.z >= 0 && obstacle.z - player.z <= 20,
    );
    if (gate) {
      const distance = gate.z - player.z;
      const speed = player.stunMs > 0 ? 2.5 : RACE_TRACK.speed;
      const etaMs = (distance / speed) * 1000;
      let targetX = obstacleOffset(gate, elapsedMs + etaMs) + runner.botLaneOffset;
      const errorRoll = hash(`${player.id}:${gate.id}`, this.seed) % 5;
      if (errorRoll === 0) targetX += (hash(`${gate.id}:${player.id}`, this.seed) % 2 === 0 ? -0.2 : 0.2);
      targetX = clamp(targetX, -MAX_X, MAX_X);
      const availableSeconds = Math.max(0.35, distance / speed);
      steer = clamp((targetX - player.x) / (6 * availableSeconds), -1, 1);
    }

    const lowHazard = RACE_TRACK.obstacles.find(obstacle =>
      (obstacle.kind === 'sweeper' || obstacle.kind === 'gap') &&
      obstacle.z - player.z >= 0 && obstacle.z - player.z <= 10,
    );
    let jump = false;
    if (lowHazard && player.y <= 0 && runner.jumpArmed) {
      const distance = lowHazard.z - player.z;
      const errorRoll = hash(`${player.id}:${lowHazard.id}`, this.seed) % 10;
      if (lowHazard.kind === 'sweeper' && errorRoll === 0) {
        // Some bots occasionally mistime a sweeper; obstacle invulnerability lets them recover.
        jump = false;
      } else {
        const triggerDistance = lowHazard.kind === 'gap' && errorRoll === 1 ? 5.6 : 6;
        jump = distance <= triggerDistance && distance >= triggerDistance - 0.5;
      }
    }

    return { steer, jump, tracking: true };
  }

  private refreshRanks(): void {
    const ordered = [...this.runners].sort((first, second) => {
      const a = first.player;
      const b = second.player;
      const aFinished = a.status === 'finished';
      const bFinished = b.status === 'finished';
      if (aFinished && bFinished) return (a.finishMs ?? Infinity) - (b.finishMs ?? Infinity);
      if (aFinished) return -1;
      if (bFinished) return 1;

      const aDnf = a.status === 'dnf';
      const bDnf = b.status === 'dnf';
      if (aDnf && bDnf) return 0;
      if (aDnf) return 1;
      if (bDnf) return -1;
      return b.z - a.z;
    });
    ordered.forEach((runner, index) => {
      runner.player.rank = index + 1;
    });
  }

  private isFinished(): boolean {
    return this.runners.every(({ player }) => player.status === 'finished' || player.status === 'dnf');
  }
}
