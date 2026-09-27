import { AutomationDefinition } from '../../../../shared/contracts/automation';
import { AutomationRepository } from '../automations/automation-repository';

export interface RecurringAutomationTimerApi {
  clear(handle: unknown): void;
  set(callback: () => void, delayMs: number): unknown;
}

interface ScheduledTimer {
  handle: unknown;
  intervalMs: number;
}

const defaultTimerApi: RecurringAutomationTimerApi = {
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
  set: (callback, delayMs) => setTimeout(callback, delayMs),
};

export class RecurringAutomationScheduler {
  private readonly timers = new Map<string, ScheduledTimer>();

  private started = false;

  private streamOnline = false;

  constructor(
    private readonly repository: AutomationRepository,
    private readonly runAutomation: (
      definition: AutomationDefinition,
    ) => Promise<void>,
    private readonly onError = (error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Unknown scheduled automation error.';
      console.error('Scheduled automation failed:', message);
    },
    private readonly timerApi: RecurringAutomationTimerApi = defaultTimerApi,
  ) {}

  async start(): Promise<void> {
    this.started = true;
    await this.refresh();
  }

  async setStreamOnline(isOnline: boolean): Promise<void> {
    this.streamOnline = isOnline;

    if (this.started) {
      await this.refresh();
    }
  }

  stop(): void {
    this.started = false;

    for (const timer of this.timers.values()) {
      this.timerApi.clear(timer.handle);
    }

    this.timers.clear();
  }

  private async refresh(): Promise<void> {
    const definitions = (await this.repository.listEnabled()).filter(
      (definition) =>
        definition.schedule &&
        (!definition.schedule.onlyWhileLive || this.streamOnline),
    );
    const intervals = new Map(
      definitions.map((definition) => [
        definition.id,
        definition.schedule!.intervalMs,
      ]),
    );

    for (const [automationId, timer] of this.timers) {
      if (intervals.get(automationId) !== timer.intervalMs) {
        this.timerApi.clear(timer.handle);
        this.timers.delete(automationId);
      }
    }

    for (const definition of definitions) {
      if (!this.timers.has(definition.id)) {
        this.schedule(definition);
      }
    }
  }

  private schedule(definition: AutomationDefinition): void {
    const intervalMs = definition.schedule!.intervalMs;
    const handle = this.timerApi.set(() => {
      this.timers.delete(definition.id);

      if (!this.canRun(definition)) {
        return;
      }

      void this.runAutomation(definition)
        .catch(this.onError)
        .finally(() => {
          if (this.canRun(definition) && !this.timers.has(definition.id)) {
            this.schedule(definition);
          }
        });
    }, intervalMs);

    if (isUnrefable(handle)) {
      handle.unref();
    }

    this.timers.set(definition.id, { handle, intervalMs });
  }

  private canRun(definition: AutomationDefinition): boolean {
    return (
      this.started &&
      definition.enabled &&
      definition.schedule !== undefined &&
      (!definition.schedule.onlyWhileLive || this.streamOnline)
    );
  }
}

function isUnrefable(value: unknown): value is { unref(): void } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'unref' in value &&
    typeof value.unref === 'function'
  );
}
