import { createApp } from './app';
import { createLeaderboardStorage } from './storage-config';
import { createSupabaseLeaderboardStore } from './supabase-leaderboard-store';

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

if (import.meta.main) {
  const server = Bun.serve({
    hostname: Bun.env.API_HOST ?? '127.0.0.1',
    port: Number(Bun.env.API_PORT ?? 3002),
    fetch: app.fetch,
  });
  console.info(`Motion Runner API listening at http://${server.hostname}:${server.port} (${configuredStorage.mode})`);
}
