import { describe, expect, it } from 'bun:test';
import { createLeaderboardStorage } from './storage-config';
import type { LeaderboardStore } from './leaderboard-store';

const sqliteStore: LeaderboardStore = {
  getTop: async () => [],
  getPlayer: async () => null,
  submitBest: async () => false,
};
const supabaseStore: LeaderboardStore = {
  ...sqliteStore,
};

describe('leaderboard storage configuration', () => {
  it('defaults to SQLite and does not require Supabase secrets', async () => {
    const configured = await createLeaderboardStorage({}, {
      sqlite: async () => sqliteStore,
      supabase: () => supabaseStore,
    });

    expect(configured.mode).toBe('sqlite');
    expect(configured.store).toBe(sqliteStore);
  });

  it('refuses Supabase mode unless both server credentials are present', async () => {
    await expect(createLeaderboardStorage({ LEADERBOARD_STORAGE: 'supabase' }, {
      sqlite: async () => sqliteStore,
      supabase: () => supabaseStore,
    })).rejects.toThrow('Supabase storage requires SUPABASE_URL and SUPABASE_SECRET_KEY.');
  });

  it('selects Supabase only when explicitly configured with server credentials', async () => {
    let received: [string, string] | undefined;
    const configured = await createLeaderboardStorage({
      LEADERBOARD_STORAGE: 'SUPABASE',
      SUPABASE_URL: 'https://motion-runner.supabase.co',
      SUPABASE_SECRET_KEY: 'server-only-test-key',
    }, {
      sqlite: async () => sqliteStore,
      supabase: (url, key) => {
        received = [url, key];
        return supabaseStore;
      },
    });

    expect(configured.mode).toBe('supabase');
    expect(configured.store).toBe(supabaseStore);
    expect(received).toEqual(['https://motion-runner.supabase.co', 'server-only-test-key']);
  });
});
