export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
  cleared: number;
  collisions: number;
  achievedAt: string;
  isCurrentPlayer: boolean;
}

export interface LeaderboardSnapshot {
  mode: string;
  entries: LeaderboardEntry[];
  personalBest: LeaderboardEntry | null;
}

const PLAYER_ID_KEY = 'motion-runner-player-id';
let sessionPlayerId = '';

function getPlayerId(): string {
  try {
    const stored = localStorage.getItem(PLAYER_ID_KEY);
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) return stored;
    const created = crypto.randomUUID();
    localStorage.setItem(PLAYER_ID_KEY, created);
    return created;
  } catch {
    sessionPlayerId ||= crypto.randomUUID();
    return sessionPlayerId;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch { /* Use the generic response below. */ }
  return `Leaderboard request failed (${response.status}).`;
}

export async function loadLeaderboard(): Promise<LeaderboardSnapshot> {
  const url = new URL('/api/leaderboard', window.location.origin);
  url.searchParams.set('limit', '5');
  url.searchParams.set('playerId', getPlayerId());
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(await readError(response));
  const snapshot = await response.json() as LeaderboardSnapshot;
  if (!Array.isArray(snapshot.entries)) throw new Error('The leaderboard response was incomplete.');
  return snapshot;
}

export async function submitLeaderboardScore(score: {
  name: string;
  score: number;
  cleared: number;
  collisions: number;
}): Promise<{ improved: boolean }> {
  const response = await fetch('/api/leaderboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...score, playerId: getPlayerId() }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return await response.json() as { improved: boolean };
}
