import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createApp } from '../src/app';

test('rejects malformed Twitch operation intents before runtime execution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twitch-operation-routes-'));
  const previousDataDirectory = process.env['TWITCH_RUNTIME_DATA_DIR'];
  const previousClientId = process.env['TWITCH_CLIENT_ID'];
  const previousClientSecret = process.env['TWITCH_CLIENT_SECRET'];
  process.env['TWITCH_RUNTIME_DATA_DIR'] = directory;
  delete process.env['TWITCH_CLIENT_ID'];
  delete process.env['TWITCH_CLIENT_SECRET'];
  const app = createApp();

  try {
    const invalidTimeout = await app.inject({
      method: 'POST',
      url: '/api/moderation/timeouts',
      payload: { durationSeconds: 0, userId: 'target-user' },
    });
    const invalidChatSettings = await app.inject({
      method: 'PATCH',
      url: '/api/chat/settings',
      payload: { slowModeWaitTimeSeconds: 200 },
    });
    const invalidReward = await app.inject({
      method: 'POST',
      url: '/api/rewards',
      payload: { cost: 0, title: 'Invalid' },
    });
    const invalidPoll = await app.inject({
      method: 'POST',
      url: '/api/polls',
      payload: { choices: ['A', 'B'], durationSeconds: 5, title: 'Invalid' },
    });
    const invalidPrediction = await app.inject({
      method: 'PATCH',
      url: '/api/predictions/prediction-1',
      payload: { status: 'RESOLVED' },
    });

    assert.equal(invalidTimeout.statusCode, 400);
    assert.equal(invalidChatSettings.statusCode, 400);
    assert.equal(invalidReward.statusCode, 400);
    assert.equal(invalidPoll.statusCode, 400);
    assert.equal(invalidPrediction.statusCode, 400);
  } finally {
    await app.close();
    await rm(directory, { force: true, recursive: true });
    restoreEnvironment('TWITCH_RUNTIME_DATA_DIR', previousDataDirectory);
    restoreEnvironment('TWITCH_CLIENT_ID', previousClientId);
    restoreEnvironment('TWITCH_CLIENT_SECRET', previousClientSecret);
  }
});

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
