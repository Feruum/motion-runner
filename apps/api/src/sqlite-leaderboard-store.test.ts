import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { createSqliteLeaderboardStore } from './sqlite-leaderboard-store';

const firstPlayer = 'd9428888-122b-4b25-8f94-83d108c5b511';
const secondPlayer = 'e4da1720-53e8-4e91-b86e-4a929802c40b';
const databases: Database[] = [];

function createStore() {
  const database = new Database(':memory:');
  databases.push(database);
  database.exec(`
    CREATE TABLE leaderboard_entries (
      player_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      player_name TEXT NOT NULL,
      score INTEGER NOT NULL,
      cleared INTEGER NOT NULL,
      collisions INTEGER NOT NULL,
      achieved_at TEXT NOT NULL,
      PRIMARY KEY (player_id, mode)
    );
  `);
  return createSqliteLeaderboardStore(database);
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe('SQLite leaderboard storage', () => {
  it('keeps the highest score per player and returns ranked rows', async () => {
    const store = createStore();

    expect(await store.submitBest({
      playerId: firstPlayer, mode: 'classic-run', name: 'First', score: 25, cleared: 5, collisions: 5,
    })).toBe(true);
    expect(await store.submitBest({
      playerId: secondPlayer, mode: 'classic-run', name: 'Second', score: 35, cleared: 6, collisions: 5,
    })).toBe(true);
    expect(await store.submitBest({
      playerId: firstPlayer, mode: 'classic-run', name: 'First', score: 15, cleared: 4, collisions: 5,
    })).toBe(false);

    const rows = await store.getTop('classic-run', 5);

    expect(rows.map(row => [row.rank, row.playerId, row.score])).toEqual([
      [1, secondPlayer, 35],
      [2, firstPlayer, 25],
    ]);
    expect(await store.getPlayer('classic-run', firstPlayer)).toMatchObject({ rank: 2, score: 25 });
  });
});
