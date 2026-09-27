import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { FileLeaderboardRepository } from '../src/features/leaderboard/file-leaderboard-repository';

test('serializes leaderboard increments and persists totals across instances', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twitch-runtime-leaderboard-'));
  const filePath = join(directory, 'leaderboard.json');

  try {
    const firstRepository = new FileLeaderboardRepository(filePath);
    const totals = await Promise.all([
      firstRepository.addPoints('12345', 515),
      firstRepository.addPoints('12345', 516),
      firstRepository.addPoints('67890', 10),
    ]);

    assert.deepEqual(totals, [515, 1031, 10]);

    const secondRepository = new FileLeaderboardRepository(filePath);
    assert.deepEqual(await secondRepository.list(), [
      { points: 1031, userId: '12345' },
      { points: 10, userId: '67890' },
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('rejects invalid leaderboard user IDs and points', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twitch-runtime-leaderboard-'));

  try {
    const repository = new FileLeaderboardRepository(join(directory, 'leaderboard.json'));

    await assert.rejects(repository.addPoints('not-a-user-id', 515));
    await assert.rejects(repository.addPoints('12345', 0));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
