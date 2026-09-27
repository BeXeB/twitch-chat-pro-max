import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AutomationContinuation } from '../src/features/timers/automation-continuation';
import { InMemoryContinuationRepository } from '../src/features/timers/continuation-repository';
import {
  ContinuationScheduler,
  ContinuationTimerApi,
} from '../src/features/timers/continuation-scheduler';

const now = Date.parse('2026-09-27T00:00:00.000Z');

test('applies duplicate policies and supports cancellation', async () => {
  const repository = new InMemoryContinuationRepository();
  const scheduler = new ContinuationScheduler(repository, () => now, noOpTimers);
  await scheduler.start(async () => undefined, async () => undefined);

  const first = await scheduler.schedule(scheduleRequest('allow', 'first-event'));
  const skipped = await scheduler.schedule(scheduleRequest('skip', 'second-event'));
  const replacement = await scheduler.schedule(scheduleRequest('replace', 'third-event'));

  assert.equal(first.status, 'scheduled');
  assert.deepEqual(skipped, { status: 'duplicate-skipped' });
  assert.equal(replacement.status, 'scheduled');
  assert.equal((await repository.listScheduled()).length, 1);
  assert.equal((await repository.listScheduled())[0].event.id, 'third-event');
  assert.ok(replacement.continuation);
  assert.equal(await scheduler.cancel(replacement.continuation.id), true);
  assert.deepEqual(await repository.list(), []);
});

test('resumes due idempotent continuations and marks unsafe restart work for review', async () => {
  const safe = continuation({
    actions: [
      {
        eventType: 'automation.safe-resume',
        payload: {},
        type: 'emit-runtime-event',
      },
    ],
    dueAt: '2026-09-26T23:59:00.000Z',
    id: 'safe',
  });
  const unsafe = continuation({
    actions: [{ message: 'Do not replay', type: 'send-chat' }],
    dueAt: '2026-09-27T00:10:00.000Z',
    id: 'unsafe',
  });
  const repository = new InMemoryContinuationRepository([safe, unsafe]);
  const scheduler = new ContinuationScheduler(repository, () => now, noOpTimers);
  const executed: string[] = [];
  const reviewed: string[] = [];

  await scheduler.start(
    async (item) => {
      executed.push(item.id);
    },
    async (item) => {
      reviewed.push(item.id);
    },
  );

  assert.deepEqual(executed, ['safe']);
  assert.deepEqual(reviewed, ['unsafe']);
  assert.equal(await repository.get('safe'), null);
  assert.deepEqual(await repository.get('unsafe'), {
    ...unsafe,
    reviewReason: 'restart-non-idempotent',
    status: 'requires-review',
  });
});

const noOpTimers: ContinuationTimerApi = {
  clear: () => undefined,
  set: () => ({}),
};

function continuation(
  overrides: Partial<AutomationContinuation> = {},
): AutomationContinuation {
  return {
    actions: [],
    automationId: 'automation-1',
    createdAt: '2026-09-26T23:58:00.000Z',
    dueAt: '2026-09-27T00:10:00.000Z',
    event: {
      id: 'event-1',
      occurredAt: '2026-09-26T23:58:00.000Z',
      payload: {},
      source: 'manual',
      type: 'manual.timer-test',
    },
    id: 'continuation-1',
    status: 'scheduled',
    version: 1,
    ...overrides,
  };
}

function scheduleRequest(
  duplicatePolicy: 'allow' | 'replace' | 'skip',
  eventId: string,
) {
  return {
    actions: [
      {
        eventType: 'automation.after-delay',
        payload: {},
        type: 'emit-runtime-event' as const,
      },
    ],
    automationId: 'automation-1',
    duplicatePolicy,
    durationMs: 60000,
    event: {
      id: eventId,
      occurredAt: '2026-09-27T00:00:00.000Z',
      payload: {},
      source: 'manual' as const,
      type: 'manual.timer-test' as const,
    },
  };
}
