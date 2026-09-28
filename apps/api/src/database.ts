import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';

const databasePath = resolve(Bun.env.DATABASE_PATH ?? join(import.meta.dir, '../data/leaderboard.sqlite'));
mkdirSync(dirname(databasePath), { recursive: true });

export const database = new Database(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS leaderboard_entries (
    player_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'classic-run',
    player_name TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0),
    cleared INTEGER NOT NULL CHECK (cleared >= 0),
    collisions INTEGER NOT NULL CHECK (collisions >= 0),
    achieved_at TEXT NOT NULL,
    PRIMARY KEY (player_id, mode)
  );

  CREATE INDEX IF NOT EXISTS leaderboard_order
    ON leaderboard_entries (mode, score DESC, cleared DESC, achieved_at ASC);
`);
