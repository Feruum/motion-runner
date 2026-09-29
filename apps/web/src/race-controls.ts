import type { RaceInput, RacePlayer } from '../../../packages/game/src/core/race-types';

export function raceSteer(lean: number): number {
  if (!Number.isFinite(lean) || Math.abs(lean) <= .08) return 0;
  // Race camera faces +z: world -x is the player's screen-right.
  return -Math.sign(lean) * Math.min(1, (Math.abs(lean) - .08) / .27);
}

export function raceSocketUrl(pageUrl: string, configured?: string): string {
  const page = new URL(pageUrl);
  const url = new URL(configured || page.origin);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) throw new Error('The race server address must use HTTP or WebSocket.');
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  if (page.protocol === 'https:' && url.protocol !== 'wss:') throw new Error('This page needs a secure race server (WSS).');
  if (url.pathname === '/') url.pathname = '/api/race';
  url.hash = ''; url.search = '';
  return url.href;
}

/** Short visual prediction only. Server snapshots always own collisions and results. */
export function predictRacePlayer(player: RacePlayer, input: RaceInput, ageMs: number): RacePlayer {
  if (!input.tracking || player.status !== 'racing' || player.stunMs > 0) return { ...player };
  const dt = Math.max(0, Math.min(100, ageMs)) / 1000;
  return { ...player, x: player.x + input.steer * 6 * dt, z: player.z + player.vz * dt };
}
