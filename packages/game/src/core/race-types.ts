/** Shared simulation and room protocol. Coordinates: x sideways, y up, z forward. */
export interface RaceEntrant { id: string; name: string; characterId: string; isBot: boolean }
export interface RaceInput { steer: number; jump: boolean; tracking: boolean }
export type RaceStatus = 'racing' | 'falling' | 'finished' | 'dnf';
export interface RacePlayer extends RaceEntrant {
  x: number; y: number; z: number; vx: number; vz: number;
  checkpoint: number; rank: number; finishMs: number | null;
  status: RaceStatus; invulnerableMs: number; stunMs: number;
}
export interface RaceSnapshot { elapsedMs: number; finished: boolean; players: RacePlayer[] }
export interface RaceObstacle {
  id: string; kind: 'gate' | 'sweeper' | 'gap'; z: number;
  /** Gate opening width / sweeper beam length / gap width. */
  width: number; depth: number; periodMs: number; amplitude: number; phase: number;
}
export interface RaceRoomPlayer extends RaceEntrant { ready: boolean; connected: boolean }
export type RaceRoomPhase = 'lobby' | 'countdown' | 'racing' | 'results';
export interface RaceRoomSnapshot {
  code: string; hostId: string; phase: RaceRoomPhase; fillBots: boolean;
  players: RaceRoomPlayer[]; countdownMs: number; race: RaceSnapshot | null;
}
export type RaceClientMessage =
  | { type: 'create'; name: string; characterId: string; fillBots: boolean }
  | { type: 'join'; code: string; name: string; characterId: string }
  | { type: 'resume'; code: string; token: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'fillBots'; enabled: boolean }
  | { type: 'start' }
  | { type: 'rematch' }
  | { type: 'input'; seq: number; steer: number; jump: boolean; tracking: boolean }
  | { type: 'leave' };
export type RaceServerMessage =
  | { type: 'welcome'; playerId: string; token: string; room: RaceRoomSnapshot }
  | { type: 'room'; room: RaceRoomSnapshot }
  | { type: 'error'; code: string; message: string };
