import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { LeaderboardEntry, LeaderboardRepository, validateRecord } from './leaderboard-repository';

interface LeaderboardDocument {
  entries: LeaderboardEntry[];
  version: 1;
}

const emptyDocument: LeaderboardDocument = { entries: [], version: 1 };

export class FileLeaderboardRepository implements LeaderboardRepository {
  private document: LeaderboardDocument | null = null;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async addPoints(userId: string, points: number): Promise<number> {
    validateRecord(userId, points);

    return this.enqueue(async () => {
      const document = await this.loadDocument();
      const entries = structuredClone(document.entries);
      const entry = entries.find((candidate) => candidate.userId === userId);

      if (entry) {
        const total = entry.points + points;

        if (!Number.isSafeInteger(total)) {
          throw new Error('The leaderboard total is too high.');
        }

        entry.points = total;
        await this.writeDocument({ entries, version: 1 });
        return total;
      }

      entries.push({ points, userId });
      await this.writeDocument({ entries, version: 1 });
      return points;
    });
  }

  async list(): Promise<LeaderboardEntry[]> {
    return structuredClone((await this.loadDocument()).entries);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private async loadDocument(): Promise<LeaderboardDocument> {
    if (this.document) {
      return this.document;
    }

    let content: string;

    try {
      content = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) {
        this.document = structuredClone(emptyDocument);
        return this.document;
      }

      throw error;
    }

    const parsed = JSON.parse(content) as unknown;

    if (!isLeaderboardDocument(parsed)) {
      throw new Error('The leaderboard data file is invalid.');
    }

    this.document = parsed;
    return this.document;
  }

  private async writeDocument(document: LeaderboardDocument): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporaryPath, JSON.stringify(document, null, 2), 'utf8');
      await rename(temporaryPath, this.filePath);
      this.document = document;
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

function isLeaderboardDocument(value: unknown): value is LeaderboardDocument {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('version' in value) ||
    !('entries' in value) ||
    value.version !== 1 ||
    !Array.isArray(value.entries)
  ) {
    return false;
  }

  const userIds = new Set<string>();

  return value.entries.every((entry: unknown) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      Array.isArray(entry) ||
      !('userId' in entry) ||
      !('points' in entry) ||
      typeof entry.userId !== 'string' ||
      !/^\d+$/.test(entry.userId) ||
      typeof entry.points !== 'number' ||
      !Number.isSafeInteger(entry.points) ||
      entry.points < 0 ||
      userIds.has(entry.userId)
    ) {
      return false;
    }

    userIds.add(entry.userId);
    return true;
  });
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
