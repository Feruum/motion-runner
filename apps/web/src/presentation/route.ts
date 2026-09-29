export const BIOMES = [
  { name: 'Sunlit Valley', subtitle: 'Follow the river', sky: 0xbadfdf, ground: 0x99b978, sun: 0xffdeb3 },
  { name: 'Forest Crossing', subtitle: 'Through the treetops', sky: 0x93bab4, ground: 0x66896d, sun: 0xd6edc5 },
  { name: 'Ancient Gateway', subtitle: 'The last stretch', sky: 0xe6ceba, ground: 0xabaa8b, sun: 0xffc98f },
] as const;

const smooth = (x: number) => x * x * (3 - 2 * x);
export function sampleRoute(elapsedMs: number, durationMs: number) {
  const progress = Math.max(0, Math.min(1, elapsedMs / Math.max(1, durationMs)));
  let from = Math.min(2, Math.floor(progress * 3));
  let to = from;
  let blend = 0;
  if (from < 2) {
    const boundary = (from + 1) / 3;
    if (progress > boundary - .04) {
      to = from + 1;
      blend = smooth((progress - boundary + .04) / .04);
    }
  }
  return { from, to, blend, chapter: blend >= .5 ? to : from, progress,
    finish: smooth(Math.max(0, Math.min(1, (progress - .85) / .15))) };
}

/** Recycle only behind the viewer; distance is derived from active game time. */
export function wrapSceneryZ(baseZ: number, distance: number, near = 12, far = -100) {
  const length = near - far;
  return far + ((baseZ + distance - far) % length + length) % length;
}
