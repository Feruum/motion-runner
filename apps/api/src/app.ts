import { Hono } from 'hono';
import type { LeaderboardRow, LeaderboardStore } from './leaderboard-store';

const GAME_MODE = 'classic-run';
const MAX_NAME_LENGTH = 24;
const MAX_WAVES = 22;
const MAX_SCORE = MAX_WAVES * 10;
const PLAYER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPlayerId(value: string): boolean {
  return PLAYER_ID_PATTERN.test(value);
}

function cleanPlayerName(value: string): string {
  const cleaned = [...value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim()]
    .slice(0, MAX_NAME_LENGTH)
    .join('');
  return cleaned || 'Runner';
}

function presentRow(row: LeaderboardRow | null, playerId: string | null) {
  if (!row) return null;
  return {
    rank: Number(row.rank),
    name: row.name,
    score: Number(row.score),
    cleared: Number(row.cleared),
    collisions: Number(row.collisions),
    achievedAt: row.achievedAt,
    isCurrentPlayer: playerId !== null && row.playerId === playerId,
  };
}

export function createApp(store: LeaderboardStore, storage: 'sqlite' | 'supabase' = 'sqlite') {
  const app = new Hono();

  app.get('/api/health', (context) => context.json({
    status: 'ok',
    service: 'motion-runner-api',
    database: storage,
  }));

  app.get('/api/leaderboard', async (context) => {
    const rawPlayerId = context.req.query('playerId') ?? '';
    if (rawPlayerId && !isPlayerId(rawPlayerId)) {
      return context.json({ error: { code: 'INVALID_PLAYER_ID', message: 'The player id is invalid.' } }, 400);
    }
    const requestedLimit = Number(context.req.query('limit') ?? 10);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(25, Math.floor(requestedLimit))) : 10;
    const playerId = rawPlayerId || null;
    const [entries, personalBest] = await Promise.all([
      store.getTop(GAME_MODE, limit),
      playerId ? store.getPlayer(GAME_MODE, playerId) : Promise.resolve(null),
    ]);

    return context.json({
      mode: GAME_MODE,
      entries: entries.map(row => presentRow(row, playerId)),
      personalBest: presentRow(personalBest, playerId),
    });
  });

  app.post('/api/leaderboard', async (context) => {
    let payload: unknown;
    try {
      payload = await context.req.json();
    } catch {
      return context.json({ error: { code: 'INVALID_JSON', message: 'Send a valid JSON request body.' } }, 400);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return context.json({ error: { code: 'INVALID_SCORE', message: 'The score details are invalid.' } }, 400);
    }

    const body = payload as Record<string, unknown>;
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    const name = typeof body.name === 'string' ? cleanPlayerName(body.name) : '';
    const score = typeof body.score === 'number' ? body.score : Number.NaN;
    const cleared = typeof body.cleared === 'number' ? body.cleared : Number.NaN;
    const collisions = typeof body.collisions === 'number' ? body.collisions : Number.NaN;
    const scoreIsConsistent = Number.isSafeInteger(score)
      && score <= cleared * 10
      && score >= Math.max(0, cleared * 10 - collisions * 5);
    if (!isPlayerId(playerId)
      || typeof body.name !== 'string'
      || !Number.isSafeInteger(score) || score < 0 || score > MAX_SCORE
      || !Number.isSafeInteger(cleared) || cleared < 0 || cleared > MAX_WAVES
      || !Number.isSafeInteger(collisions) || collisions < 0 || collisions > MAX_WAVES
      || cleared + collisions > MAX_WAVES
      || !scoreIsConsistent) {
      return context.json({ error: { code: 'INVALID_SCORE', message: 'The score details are invalid.' } }, 400);
    }

    const improved = await store.submitBest({
      playerId,
      mode: GAME_MODE,
      name,
      score,
      cleared,
      collisions,
    });
    return context.json({ ok: true, improved }, improved ? 201 : 200);
  });

  app.notFound((context) => context.json({
    error: { code: 'NOT_FOUND', message: 'API route not found.' },
  }, 404));

  app.onError((error, context) => {
    console.error(error);
    return context.json({
      error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' },
    }, 500);
  });

  return app;
}
