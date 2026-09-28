import { describe, expect, it } from 'bun:test';
import { createApp } from './app';
import type { LeaderboardRow, LeaderboardStore, ScoreSubmission } from './leaderboard-store';

const playerId = 'd9428888-122b-4b25-8f94-83d108c5b511';
const currentScore: LeaderboardRow = {
  rank: 2,
  playerId,
  name: 'Runner',
  score: 35,
  cleared: 6,
  collisions: 5,
  achievedAt: '2026-09-29T00:00:00.000Z',
};

function createStore(overrides: Partial<LeaderboardStore> = {}) {
  const submissions: ScoreSubmission[] = [];
  const store: LeaderboardStore = {
    getTop: async () => [currentScore],
    getPlayer: async () => currentScore,
    submitBest: async score => {
      submissions.push(score);
      return true;
    },
    ...overrides,
  };
  return { store, submissions };
}

describe('leaderboard API', () => {
  it('returns ranked entries and the current player row', async () => {
    const { store } = createStore();
    const app = createApp(store);

    const response = await app.request(`/api/leaderboard?playerId=${playerId}&limit=5`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: 'classic-run',
      entries: [{
        rank: 2,
        name: 'Runner',
        score: 35,
        cleared: 6,
        collisions: 5,
        achievedAt: '2026-09-29T00:00:00.000Z',
        isCurrentPlayer: true,
      }],
      personalBest: {
        rank: 2,
        name: 'Runner',
        score: 35,
        cleared: 6,
        collisions: 5,
        achievedAt: '2026-09-29T00:00:00.000Z',
        isCurrentPlayer: true,
      },
    });
  });

  it('submits a valid score through the selected store', async () => {
    const { store, submissions } = createStore();
    const app = createApp(store);

    const response = await app.request('/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, name: ' Runner ', score: 35, cleared: 6, collisions: 5 }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, improved: true });
    expect(submissions).toEqual([{
      playerId,
      mode: 'classic-run',
      name: 'Runner',
      score: 35,
      cleared: 6,
      collisions: 5,
    }]);
  });

  it('rejects invalid score payloads before calling the store', async () => {
    const { store, submissions } = createStore();
    const app = createApp(store);

    const response = await app.request('/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, name: 'Runner', score: 5000, cleared: 6, collisions: 5 }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_SCORE' } });
    expect(submissions).toHaveLength(0);
  });
});
