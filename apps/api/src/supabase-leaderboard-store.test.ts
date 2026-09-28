import { describe, expect, it } from 'bun:test';
import { createSupabaseLeaderboardStore } from './supabase-leaderboard-store';

const playerId = 'd9428888-122b-4b25-8f94-83d108c5b511';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Supabase leaderboard storage', () => {
  it('reads ranked top entries and maps database fields to the API model', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const store = createSupabaseLeaderboardStore({
      url: 'https://motion-runner.supabase.co',
      secretKey: 'server-only-test-key',
      fetcher: async (input, init) => {
        calls.push({ url: String(input), init });
        return jsonResponse([{
          rank: 1,
          player_id: playerId,
          player_name: 'Runner',
          score: 35,
          cleared: 6,
          collisions: 5,
          achieved_at: '2026-09-29T00:00:00.000Z',
        }]);
      },
    });

    const entries = await store.getTop('classic-run', 5);

    expect(entries).toEqual([{
      rank: 1,
      playerId,
      name: 'Runner',
      score: 35,
      cleared: 6,
      collisions: 5,
      achievedAt: '2026-09-29T00:00:00.000Z',
    }]);
    expect(calls[0]?.url).toContain('/rest/v1/leaderboard_ranked?');
    expect(calls[0]?.url).toContain('mode=eq.classic-run');
    expect(calls[0]?.url).toContain('limit=5');
    expect((calls[0]?.init?.headers as Record<string, string>)['apikey']).toBe('server-only-test-key');
    expect((calls[0]?.init?.headers as Record<string, string>)['Authorization']).toBe('Bearer server-only-test-key');
  });

  it('submits a score through the atomic best-score RPC', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const store = createSupabaseLeaderboardStore({
      url: 'https://motion-runner.supabase.co/',
      secretKey: 'server-only-test-key',
      fetcher: async (input, init) => {
        request = { url: String(input), init };
        return jsonResponse(true);
      },
    });

    const improved = await store.submitBest({
      playerId,
      mode: 'classic-run',
      name: 'Runner',
      score: 35,
      cleared: 6,
      collisions: 5,
    });

    expect(improved).toBe(true);
    expect(request?.url).toBe('https://motion-runner.supabase.co/rest/v1/rpc/submit_leaderboard_score');
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      p_player_id: playerId,
      p_mode: 'classic-run',
      p_player_name: 'Runner',
      p_score: 35,
      p_cleared: 6,
      p_collisions: 5,
    });
  });

  it('does not leak the server key in an upstream error', async () => {
    const store = createSupabaseLeaderboardStore({
      url: 'https://motion-runner.supabase.co',
      secretKey: 'server-only-test-key',
      fetcher: async () => jsonResponse({ message: 'database unavailable' }, 503),
    });

    await expect(store.getTop('classic-run', 5)).rejects.toThrow('Supabase leaderboard request failed (503).');
    await expect(store.getTop('classic-run', 5)).rejects.not.toThrow('server-only-test-key');
  });
});
