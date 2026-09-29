import { CONFIG as C } from '@motion-runner/game';
import type { GameEngine } from '@motion-runner/game';

export function classicRunCue(game: GameEngine, handsDown: boolean) {
  const wave = game.waves.find(item => !item.resolved);
  if (!wave || wave.atMs - game.elapsedMs > C.wavePreviewMs) {
    return { text: 'Tall coral: change lanes · low mint: jump', icon: '↗', tone: 'neutral' };
  }
  const obstacle = wave.obstacles.find(item => item.lane === game.lane);
  if (!obstacle) return { text: 'Lane clear · hold your position', icon: '✓', tone: 'safe' };
  if (obstacle.kind === 'high') return { text: 'Change lanes · tall barrier ahead', icon: '↔', tone: 'warning' };
  const landingAge = wave.atMs - game.jumpStartedMs;
  if (game.jumpAgeMs < C.jumpMs && landingAge >= C.jumpSafeStartMs && landingAge <= C.jumpSafeEndMs) {
    return { text: 'Jump in progress', icon: '↑', tone: 'safe' };
  }
  if (!handsDown) return { text: 'Lower both hands to prepare another jump', icon: '↓', tone: 'warning' };
  const remaining = wave.atMs - game.elapsedMs;
  const recognitionMs = C.handsHoldMs + C.smoothingMs;
  if (remaining < C.jumpSafeStartMs + recognitionMs) return { text: 'Change lanes · barrier close', icon: '↔', tone: 'warning' };
  if (remaining <= C.jumpSafeEndMs + recognitionMs) return { text: 'Raise both hands now', icon: '↑', tone: 'jump' };
  return { text: 'Low mint barrier ahead · get ready to jump', icon: '↑', tone: 'neutral' };
}
