import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { AutomationContinuation } from '../src/features/timers/automation-continuation';
import { FileContinuationRepository } from '../src/features/timers/file-continuation-repository';

const continuation: AutomationContinuation = {
  actions: [
    {
      eventType: 'automation.after-delay',
      payload: {},
      type: 'emit-runtime-event',
    },
  ],
  automationId: 'automation-1',
  createdAt: '2026-09-27T00:00:00.000Z',
  dueAt: '2026-09-27T00:01:00.000Z',
  event: {
    id: 'event-1',
    occurredAt: '2026-09-27T00:00:00.000Z',
    payload: {},
    source: 'manual',
    type: 'manual.timer-test',
  },
  id: 'continuation-1',
  status: 'scheduled',
  version: 1,
};

test('persists continuations and records review status', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twitch-runtime-timers-'));
  const filePath = join(directory, 'timer-continuations.json');

  try {
    const firstRepository = new FileContinuationRepository(filePath);
    await firstRepository.upsert(continuation);

    const secondRepository = new FileContinuationRepository(filePath);
    assert.deepEqual(await secondRepository.listScheduled(), [continuation]);
    assert.deepEqual(
      await secondRepository.markRequiresReview(continuation.id, 'execution-failed'),
      {
        ...continuation,
        reviewReason: 'execution-failed',
        status: 'requires-review',
      },
    );
    assert.equal(await secondRepository.remove(continuation.id), true);
    assert.deepEqual(await secondRepository.list(), []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
