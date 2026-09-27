import { randomUUID } from 'node:crypto';

import { AutomationAction } from '../../../../shared/contracts/automation';
import {
  AutomationContinuation,
  ContinuationReviewReason,
  ContinuationScheduleRequest,
  ContinuationScheduleResult,
} from './automation-continuation';
import { ContinuationRepository } from './continuation-repository';

export interface AutomationContinuationScheduler {
  schedule(
    request: ContinuationScheduleRequest,
  ): Promise<ContinuationScheduleResult>;
}

export interface ContinuationTimerApi {
  clear(handle: unknown): void;
  set(callback: () => void, delayMs: number): unknown;
}

const defaultTimerApi: ContinuationTimerApi = {
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
  set: (callback, delayMs) => setTimeout(callback, delayMs),
};

export class ContinuationScheduler implements AutomationContinuationScheduler {
  private executeContinuation: ((continuation: AutomationContinuation) => Promise<void>) | null = null;

  private handleReview: ((
    continuation: AutomationContinuation,
    reason: ContinuationReviewReason,
  ) => Promise<void>) | null = null;

  private readonly timers = new Map<string, unknown>();

  constructor(
    private readonly repository: ContinuationRepository,
    private readonly now = () => Date.now(),
    private readonly timerApi: ContinuationTimerApi = defaultTimerApi,
  ) {}

  async cancel(id: string): Promise<boolean> {
    this.clearTimer(id);
    return this.repository.remove(id);
  }

  async list(): Promise<AutomationContinuation[]> {
    return this.repository.list();
  }

  async schedule(
    request: ContinuationScheduleRequest,
  ): Promise<ContinuationScheduleResult> {
    const matchingContinuations = (await this.repository.listScheduled()).filter(
      (continuation) => continuation.automationId === request.automationId,
    );

    if (request.duplicatePolicy === 'skip' && matchingContinuations.length > 0) {
      return { status: 'duplicate-skipped' };
    }

    if (request.duplicatePolicy === 'replace') {
      await Promise.all(
        matchingContinuations.map((continuation) => this.cancel(continuation.id)),
      );
    }

    const createdAt = new Date(this.now()).toISOString();
    const continuation: AutomationContinuation = {
      actions: structuredClone(request.actions),
      automationId: request.automationId,
      createdAt,
      dueAt: new Date(this.now() + request.durationMs).toISOString(),
      event: structuredClone(request.event),
      id: randomUUID(),
      status: 'scheduled',
      version: 1,
    };

    await this.repository.upsert(continuation);

    if (this.executeContinuation) {
      this.arm(continuation);
    }

    return { continuation, status: 'scheduled' };
  }

  async start(
    executeContinuation: (continuation: AutomationContinuation) => Promise<void>,
    handleReview: (
      continuation: AutomationContinuation,
      reason: ContinuationReviewReason,
    ) => Promise<void>,
  ): Promise<void> {
    this.executeContinuation = executeContinuation;
    this.handleReview = handleReview;

    const continuations = await this.repository.listScheduled();

    for (const continuation of continuations) {
      if (!isRestartSafe(continuation.actions)) {
        await this.requireReview(continuation, 'restart-non-idempotent');
        continue;
      }

      if (Date.parse(continuation.dueAt) <= this.now()) {
        await this.run(continuation.id);
        continue;
      }

      this.arm(continuation);
    }
  }

  private arm(continuation: AutomationContinuation): void {
    this.clearTimer(continuation.id);
    const remainingDelay = Math.max(0, Date.parse(continuation.dueAt) - this.now());
    const handle = this.timerApi.set(() => {
      void this.run(continuation.id);
    }, remainingDelay);

    if (isUnrefable(handle)) {
      handle.unref();
    }

    this.timers.set(continuation.id, handle);
  }

  private clearTimer(id: string): void {
    const handle = this.timers.get(id);

    if (handle === undefined) {
      return;
    }

    this.timerApi.clear(handle);
    this.timers.delete(id);
  }

  private async requireReview(
    continuation: AutomationContinuation,
    reason: ContinuationReviewReason,
  ): Promise<void> {
    this.clearTimer(continuation.id);
    const updated = await this.repository.markRequiresReview(continuation.id, reason);

    if (updated && this.handleReview) {
      await this.handleReview(updated, reason);
    }
  }

  private async run(id: string): Promise<void> {
    this.clearTimer(id);
    const continuation = await this.repository.get(id);

    if (!continuation || continuation.status !== 'scheduled') {
      return;
    }

    if (!this.executeContinuation) {
      return;
    }

    try {
      await this.executeContinuation(continuation);
      await this.repository.remove(id);
    } catch {
      await this.requireReview(continuation, 'execution-failed');
    }
  }
}

function isRestartSafe(actions: AutomationAction[]): boolean {
  return actions.every(
    (action) => action.type === 'delay' || action.type === 'emit-runtime-event',
  );
}

function isUnrefable(value: unknown): value is { unref(): void } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'unref' in value &&
    typeof value.unref === 'function'
  );
}
