export interface LeaderboardRow {
  rank: number;
  playerId: string;
  name: string;
  score: number;
  cleared: number;
  collisions: number;
  achievedAt: string;
}

export interface ScoreSubmission {
  playerId: string;
  mode: string;
  name: string;
  score: number;
  cleared: number;
  collisions: number;
}

export interface LeaderboardStore {
  getTop(mode: string, limit: number): Promise<LeaderboardRow[]>;
  getPlayer(mode: string, playerId: string): Promise<LeaderboardRow | null>;
  submitBest(score: ScoreSubmission): Promise<boolean>;
}
