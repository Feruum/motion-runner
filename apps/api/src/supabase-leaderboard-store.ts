import type { LeaderboardRow, LeaderboardStore, ScoreSubmission } from './leaderboard-store';

interface SupabaseLeaderboardConfig {
  url: string;
  secretKey: string;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

interface SupabaseLeaderboardRow {
  rank: number;
  player_id: string;
  player_name: string;
  score: number;
  cleared: number;
  collisions: number;
  achieved_at: string;
}

const ROW_FIELDS = 'rank,player_id,player_name,score,cleared,collisions,achieved_at';

function mapRow(value: unknown): LeaderboardRow {
  if (!value || typeof value !== 'object') throw new Error('Supabase leaderboard response was invalid.');
  const row = value as Partial<SupabaseLeaderboardRow>;
  if (typeof row.player_id !== 'string' || typeof row.player_name !== 'string'
    || typeof row.achieved_at !== 'string' || !Number.isFinite(Number(row.rank))
    || !Number.isFinite(Number(row.score)) || !Number.isFinite(Number(row.cleared))
    || !Number.isFinite(Number(row.collisions))) {
    throw new Error('Supabase leaderboard response was invalid.');
  }
  return {
    rank: Number(row.rank),
    playerId: row.player_id,
    name: row.player_name,
    score: Number(row.score),
    cleared: Number(row.cleared),
    collisions: Number(row.collisions),
    achievedAt: row.achieved_at,
  };
}

export function createSupabaseLeaderboardStore({ url, secretKey, fetcher = fetch }: SupabaseLeaderboardConfig): LeaderboardStore {
  const baseUrl = url.replace(/\/+$/, '');

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}/rest/v1/${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
          ...init.headers,
        },
      });
    } catch {
      throw new Error('Supabase leaderboard service is unavailable.');
    }
    if (!response.ok) throw new Error(`Supabase leaderboard request failed (${response.status}).`);
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new Error('Supabase leaderboard response was invalid.');
    }
  }

  function rankedUrl(mode: string): URL {
    const query = new URL(`${baseUrl}/rest/v1/leaderboard_ranked`);
    query.searchParams.set('select', ROW_FIELDS);
    query.searchParams.set('mode', `eq.${mode}`);
    return query;
  }

  return {
    async getTop(mode, limit) {
      const query = rankedUrl(mode);
      query.searchParams.set('order', 'rank.asc');
      query.searchParams.set('limit', String(limit));
      const result = await request(query.toString().slice(`${baseUrl}/rest/v1/`.length));
      if (!Array.isArray(result)) throw new Error('Supabase leaderboard response was invalid.');
      return result.map(mapRow);
    },

    async getPlayer(mode, playerId) {
      const query = rankedUrl(mode);
      query.searchParams.set('player_id', `eq.${playerId}`);
      query.searchParams.set('limit', '1');
      const result = await request(query.toString().slice(`${baseUrl}/rest/v1/`.length));
      if (!Array.isArray(result)) throw new Error('Supabase leaderboard response was invalid.');
      return result.length ? mapRow(result[0]) : null;
    },

    async submitBest(score: ScoreSubmission) {
      const result = await request('rpc/submit_leaderboard_score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_player_id: score.playerId,
          p_mode: score.mode,
          p_player_name: score.name,
          p_score: score.score,
          p_cleared: score.cleared,
          p_collisions: score.collisions,
        }),
      });
      if (typeof result !== 'boolean') throw new Error('Supabase leaderboard response was invalid.');
      return result;
    },
  };
}
