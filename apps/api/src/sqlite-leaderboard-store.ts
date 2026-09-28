import type { Database } from 'bun:sqlite';
import type { LeaderboardRow, LeaderboardStore, ScoreSubmission } from './leaderboard-store';

interface SqliteLeaderboardRow {
  rank: number;
  playerId: string;
  name: string;
  score: number;
  cleared: number;
  collisions: number;
  achievedAt: string;
}

const RANKED_QUERY = `
  WITH ranked AS (
    SELECT
      ROW_NUMBER() OVER (ORDER BY score DESC, cleared DESC, achieved_at ASC, player_id ASC) AS rank,
      player_id AS playerId,
      player_name AS name,
      score,
      cleared,
      collisions,
      achieved_at AS achievedAt
    FROM leaderboard_entries
    WHERE mode = ?
  )
`;

function mapRow(row: SqliteLeaderboardRow | null | undefined): LeaderboardRow | null {
  if (!row) return null;
  return {
    rank: Number(row.rank),
    playerId: row.playerId,
    name: row.name,
    score: Number(row.score),
    cleared: Number(row.cleared),
    collisions: Number(row.collisions),
    achievedAt: row.achievedAt,
  };
}

export function createSqliteLeaderboardStore(database: Database): LeaderboardStore {
  return {
    async getTop(mode, limit) {
      const rows = database.query(`${RANKED_QUERY}
        SELECT rank, playerId, name, score, cleared, collisions, achievedAt
        FROM ranked
        ORDER BY rank
        LIMIT ?
      `).all(mode, limit) as SqliteLeaderboardRow[];
      return rows.map(row => mapRow(row) as LeaderboardRow);
    },

    async getPlayer(mode, playerId) {
      const row = database.query(`${RANKED_QUERY}
        SELECT rank, playerId, name, score, cleared, collisions, achievedAt
        FROM ranked
        WHERE playerId = ?
      `).get(mode, playerId) as SqliteLeaderboardRow | null;
      return mapRow(row);
    },

    async submitBest(score: ScoreSubmission) {
      const result = database.query(`
        INSERT INTO leaderboard_entries (player_id, mode, player_name, score, cleared, collisions, achieved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (player_id, mode) DO UPDATE SET
          player_name = excluded.player_name,
          score = excluded.score,
          cleared = excluded.cleared,
          collisions = excluded.collisions,
          achieved_at = excluded.achieved_at
        WHERE excluded.score > leaderboard_entries.score
      `).run(
        score.playerId,
        score.mode,
        score.name,
        score.score,
        score.cleared,
        score.collisions,
        new Date().toISOString(),
      );
      return result.changes > 0;
    },
  };
}
