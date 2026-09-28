export type Lane = -1 | 0 | 1;
export type GestureId = 'LEAN_LEFT' | 'LEAN_RIGHT' | 'HANDS_UP_JUMP';
export interface Landmark { x: number; y: number; z: number; visibility: number; presence?: number }
export interface PoseSample { timestampMs: number; frameWidth: number; frameHeight: number; landmarks: Landmark[] }
export interface Correction { code: string; text: string; highlightLandmarks: number[] }
export interface GestureAnalysis {
  timestampMs: number; lane: Lane; lean: number; jumpTriggered: boolean;
  handsUp: boolean; handsDown: boolean; trackingValid: boolean;
  calibrated: boolean; calibrationProgress: number; correction: Correction | null;
  landmarks: Landmark[];
}
export type Stage = 'WELCOME' | 'LOADING' | 'CALIBRATION' | 'TUTORIAL' | 'READY' | 'COUNTDOWN' | 'PLAYING' | 'PAUSED' | 'RESULTS' | 'ERROR';
export interface GameInput { lane: Lane; jump: boolean }
export type ObstacleKind = 'low' | 'high';
export interface Wave { id: number; atMs: number; obstacles: { lane: Lane; kind: ObstacleKind }[]; resolved: boolean }
export type GameEvent = 'jump' | 'clear' | 'hit' | 'finish';
