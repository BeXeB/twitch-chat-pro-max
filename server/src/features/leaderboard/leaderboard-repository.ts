export interface LeaderboardEntry {
  points: number;
  userId: string;
}

export interface LeaderboardRepository {
  addPoints(userId: string, points: number): Promise<number>;
  list(): Promise<LeaderboardEntry[]>;
}

export class InMemoryLeaderboardRepository implements LeaderboardRepository {
  constructor(private readonly entries: LeaderboardEntry[] = []) {}

  async addPoints(userId: string, points: number): Promise<number> {
    validateRecord(userId, points);
    const entry = this.entries.find((candidate) => candidate.userId === userId);

    if (entry) {
      entry.points += points;
      return entry.points;
    }

    this.entries.push({ points, userId });
    return points;
  }

  async list(): Promise<LeaderboardEntry[]> {
    return structuredClone(this.entries);
  }
}

export function validateRecord(userId: string, points: number): void {
  if (!/^\d+$/.test(userId) || !Number.isSafeInteger(points) || points < 1) {
    throw new Error('The leaderboard record is invalid.');
  }
}
