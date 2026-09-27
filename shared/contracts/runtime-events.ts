import { LocalRuntimeStatus } from './runtime-status';
import { RuntimeViewState } from './runtime-view-state';

export interface ApplicationEvent {
  causationId?: string;
  correlationId?: string;
  id: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  source: 'automation' | 'command' | 'manual' | 'twitch';
  targetAutomationId?: string;
  type: `automation.${string}` | `command.${string}` | `manual.${string}` | `twitch.${string}`;
}

export interface RuntimeSnapshot {
  recentEvents: ApplicationEvent[];
  status: LocalRuntimeStatus;
  viewState: RuntimeViewState;
}

export type RuntimeStreamMessage =
  | {
      kind: 'snapshot';
      snapshot: RuntimeSnapshot;
    }
  | {
      event: ApplicationEvent;
      kind: 'event';
      viewState: RuntimeViewState;
    };
