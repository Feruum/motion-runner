import type { LeaderboardStore } from './leaderboard-store';

export type LeaderboardStorageMode = 'sqlite' | 'supabase';

export interface StorageEnvironment {
  LEADERBOARD_STORAGE?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  /** Legacy Supabase key name; keep accepting it for existing deployments. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

interface StorageFactories {
  sqlite: () => LeaderboardStore | Promise<LeaderboardStore>;
  supabase: (url: string, secretKey: string) => LeaderboardStore | Promise<LeaderboardStore>;
}

export async function createLeaderboardStorage(
  environment: StorageEnvironment,
  factories: StorageFactories,
): Promise<{ mode: LeaderboardStorageMode; store: LeaderboardStore }> {
  const mode = (environment.LEADERBOARD_STORAGE ?? 'sqlite').trim().toLowerCase();
  if (mode === 'sqlite') return { mode, store: await factories.sqlite() };
  if (mode !== 'supabase') throw new Error(`Unsupported LEADERBOARD_STORAGE value: ${mode}.`);

  const url = environment.SUPABASE_URL?.trim();
  const secretKey = environment.SUPABASE_SECRET_KEY?.trim()
    || environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !secretKey) {
    throw new Error('Supabase storage requires SUPABASE_URL and SUPABASE_SECRET_KEY.');
  }
  return { mode, store: await factories.supabase(url, secretKey) };
}
