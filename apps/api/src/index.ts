import { createApp } from './app';
import { createLeaderboardStorage } from './storage-config';
import { createSupabaseLeaderboardStore } from './supabase-leaderboard-store';
import { RaceEngine } from '../../../packages/game/src/core/race';
import { RaceRoomManager } from './race-rooms';
import { createRaceServerHooks } from './race-server';

const configuredStorage = await createLeaderboardStorage({
  LEADERBOARD_STORAGE: Bun.env.LEADERBOARD_STORAGE,
  SUPABASE_URL: Bun.env.SUPABASE_URL,
  SUPABASE_SECRET_KEY: Bun.env.SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE_KEY: Bun.env.SUPABASE_SERVICE_ROLE_KEY,
}, {
  sqlite: async () => {
    const [{ database }, { createSqliteLeaderboardStore }] = await Promise.all([
      import('./database'),
      import('./sqlite-leaderboard-store'),
    ]);
    return createSqliteLeaderboardStore(database);
  },
  supabase: (url, secretKey) => createSupabaseLeaderboardStore({ url, secretKey }),
});

export const app = createApp(configuredStorage.store, configuredStorage.mode);
const raceRooms = new RaceRoomManager({
  makeEngine: (entrants, seed) => new RaceEngine(entrants, seed),
});

if (import.meta.main) {
  setInterval(() => raceRooms.tick(), 1_000 / 30);
  const server = Bun.serve({
    hostname: Bun.env.API_HOST ?? '127.0.0.1',
    port: Number(Bun.env.API_PORT ?? 3002),
    ...createRaceServerHooks(app, raceRooms),
  });
  console.info(`Motion Runner API listening at http://${server.hostname}:${server.port} (${configuredStorage.mode}); race WebSocket at ws://${server.hostname}:${server.port}/api/race`);
}
