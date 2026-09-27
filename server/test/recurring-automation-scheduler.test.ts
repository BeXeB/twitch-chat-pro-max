import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AutomationDefinition } from '../../shared/contracts/automation';
import { InMemoryAutomationRepository } from '../src/features/automations/automation-repository';
import {
  RecurringAutomationScheduler,
  RecurringAutomationTimerApi,
} from '../src/features/timers/recurring-automation-scheduler';

test('runs scheduled automations repeatedly while live and pauses them offline', async () => {
  const definition: AutomationDefinition = {
    actions: [{ message: 'Discord reminder', type: 'send-chat' }],
    conditions: { type: 'always' },
    enabled: true,
    id: 'discord-reminder',
    name: 'Discord reminder',
    schedule: { intervalMs: 600000, onlyWhileLive: true },
    trigger: { eventType: 'command.executed', type: 'application-event' },
    version: 1,
  };
  const timers = new ManualTimers();
  const executions: string[] = [];
  const scheduler = new RecurringAutomationScheduler(
    new InMemoryAutomationRepository([definition]),
    async (automation) => {
      executions.push(automation.id);
    },
    undefined,
    timers,
  );

  await scheduler.start();
  assert.equal(timers.size, 0);

  await scheduler.setStreamOnline(true);
  assert.deepEqual(timers.delays, [600000]);

  timers.fireNext();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(executions, ['discord-reminder']);
  assert.deepEqual(timers.delays, [600000, 600000]);

  await scheduler.setStreamOnline(false);
  assert.equal(timers.size, 0);
  scheduler.stop();
});

class ManualTimers implements RecurringAutomationTimerApi {
  private nextHandle = 0;

  private readonly callbacks = new Map<number, () => void>();

  readonly delays: number[] = [];

  get size(): number {
    return this.callbacks.size;
  }

  clear(handle: unknown): void {
    if (typeof handle === 'number') {
      this.callbacks.delete(handle);
    }
  }

  fireNext(): void {
    const next = this.callbacks.entries().next();
    assert.equal(next.done, false);

    if (next.done) {
      return;
    }

    const [handle, callback] = next.value;
    this.callbacks.delete(handle);
    callback();
  }

  set(callback: () => void, delayMs: number): unknown {
    const handle = ++this.nextHandle;
    this.callbacks.set(handle, callback);
    this.delays.push(delayMs);
    return handle;
  }
}
