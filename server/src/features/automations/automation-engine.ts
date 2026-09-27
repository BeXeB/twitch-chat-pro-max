import { randomUUID } from 'node:crypto';

import {
  AutomationAction,
  AutomationCondition,
  AutomationDefinition,
  DelayAction,
  EmitRuntimeEventAction,
  EventFieldEqualsCondition,
  SendChatMessageAction,
  TimeoutUserAction,
} from '../../../../shared/contracts/automation';
import { ApplicationEvent } from '../../../../shared/contracts/runtime-events';
import { AutomationRepository } from './automation-repository';
import { renderEventPayloadTemplate } from './automation-template';
import { AutomationContinuation } from '../timers/automation-continuation';
import { AutomationContinuationScheduler } from '../timers/continuation-scheduler';

export interface AutomationExecutionResult {
  automationId: string;
  status:
    | 'completed'
    | 'conditions-failed'
    | 'cooldown'
    | 'duplicate-skipped'
    | 'scheduled';
}

export type AutomationActionExecutionStatus =
  | 'continue'
  | 'duplicate-skipped'
  | 'scheduled';

export interface AutomationActionContext {
  emit(event: ApplicationEvent): void;
  event: ApplicationEvent;
  scheduleContinuation?: (
    durationMs: number,
    duplicatePolicy: DelayAction['duplicatePolicy'],
  ) => Promise<{ status: 'duplicate-skipped' | 'scheduled'; continuationId?: string }>;
}

export interface AutomationActionHandler {
  execute(
    action: AutomationAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus>;
  type: AutomationAction['type'];
}

export interface AutomationConditionHandler {
  evaluate(condition: AutomationCondition, event: ApplicationEvent): boolean;
  type: Exclude<AutomationCondition['type'], 'all' | 'any' | 'not'>;
}

export class AutomationActionRegistry {
  private readonly handlers = new Map<
    AutomationAction['type'],
    AutomationActionHandler
  >();

  constructor(handlers: AutomationActionHandler[]) {
    for (const handler of handlers) {
      this.handlers.set(handler.type, handler);
    }
  }

  async execute(
    action: AutomationAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const handler = this.handlers.get(action.type);

    if (!handler) {
      throw new Error(`No automation action handler is registered for ${action.type}.`);
    }

    return handler.execute(action, context);
  }
}

export class AutomationConditionRegistry {
  private readonly handlers = new Map<
    Exclude<AutomationCondition['type'], 'all' | 'any' | 'not'>,
    AutomationConditionHandler
  >();

  constructor(handlers: AutomationConditionHandler[]) {
    for (const handler of handlers) {
      this.handlers.set(handler.type, handler);
    }
  }

  evaluate(condition: AutomationCondition, event: ApplicationEvent): boolean {
    switch (condition.type) {
      case 'all':
        return condition.children.every((child) => this.evaluate(child, event));
      case 'any':
        return condition.children.some((child) => this.evaluate(child, event));
      case 'not':
        return !condition.children.some((child) => this.evaluate(child, event));
      default: {
        const handler = this.handlers.get(condition.type);

        if (!handler) {
          throw new Error(
            `No automation condition handler is registered for ${condition.type}.`,
          );
        }

        return handler.evaluate(condition, event);
      }
    }
  }
}

export class CooldownTracker {
  private readonly expirations = new Map<string, number>();

  isAvailable(automation: AutomationDefinition, now: number): boolean {
    const expiration = this.expirations.get(automation.id) ?? 0;

    return expiration <= now;
  }

  reserve(automation: AutomationDefinition, now: number): void {
    if (!automation.cooldown) {
      return;
    }

    this.expirations.set(automation.id, now + automation.cooldown.durationMs);
  }
}

export class AutomationEngine {
  constructor(
    private readonly repository: AutomationRepository,
    private readonly conditions: AutomationConditionRegistry,
    private readonly actions: AutomationActionRegistry,
    private readonly cooldowns = new CooldownTracker(),
    private readonly now = () => Date.now(),
    private readonly continuations: AutomationContinuationScheduler | null = null,
  ) {}

  async handleEvent(
    event: ApplicationEvent,
    emit: (event: ApplicationEvent) => void,
  ): Promise<AutomationExecutionResult[]> {
    if (event.source === 'automation') {
      return [];
    }

    const enabledDefinitions = await this.repository.listEnabled();
    const definitions = event.targetAutomationId
      ? enabledDefinitions.filter(
          (definition) => definition.id === event.targetAutomationId,
        )
      : enabledDefinitions;
    const results: AutomationExecutionResult[] = [];

    for (const definition of definitions) {
      if (definition.trigger.eventType !== event.type) {
        continue;
      }

      const now = this.now();

      if (!this.cooldowns.isAvailable(definition, now)) {
        results.push({ automationId: definition.id, status: 'cooldown' });
        continue;
      }

      if (!this.conditions.evaluate(definition.conditions, event)) {
        results.push({ automationId: definition.id, status: 'conditions-failed' });
        continue;
      }

      this.cooldowns.reserve(definition, now);

      const status = await this.executeActions(
        definition.id,
        event,
        definition.actions,
        emit,
      );

      results.push({ automationId: definition.id, status });
    }

    return results;
  }

  async handleScheduledAutomation(
    automationId: string,
    emit: (event: ApplicationEvent) => void,
  ): Promise<AutomationExecutionResult | null> {
    const definition = (await this.repository.listEnabled()).find(
      (automation) =>
        automation.id === automationId && automation.schedule !== undefined,
    );

    if (!definition) {
      return null;
    }

    const results = await this.handleEvent(
      {
        id: randomUUID(),
        occurredAt: new Date(this.now()).toISOString(),
        payload: { automationId, scheduled: true },
        source: 'manual',
        targetAutomationId: automationId,
        type: definition.trigger.eventType,
      },
      emit,
    );

    return results[0] ?? null;
  }

  async resumeContinuation(
    continuation: AutomationContinuation,
    emit: (event: ApplicationEvent) => void,
  ): Promise<void> {
    await this.executeActions(
      continuation.automationId,
      continuation.event,
      continuation.actions,
      emit,
    );
  }

  private async executeActions(
    automationId: string,
    event: ApplicationEvent,
    actions: AutomationAction[],
    emit: (event: ApplicationEvent) => void,
  ): Promise<Extract<AutomationExecutionResult['status'], 'completed' | 'duplicate-skipped' | 'scheduled'>> {
    for (const [index, action] of actions.entries()) {
      const status = await this.actions.execute(action, {
        emit,
        event,
        scheduleContinuation: async (durationMs, duplicatePolicy) => {
          if (!this.continuations) {
            throw new Error('The automation continuation scheduler is unavailable.');
          }

          const remainingActions = actions.slice(index + 1);

          if (remainingActions.length === 0) {
            throw new Error('A delay action requires a subsequent action.');
          }

          const result = await this.continuations.schedule({
            actions: remainingActions,
            automationId,
            duplicatePolicy,
            durationMs,
            event,
          });

          return {
            continuationId: result.continuation?.id,
            status: result.status,
          };
        },
      });

      if (status !== 'continue') {
        return status;
      }
    }

    return 'completed';
  }
}

export class AlwaysConditionHandler implements AutomationConditionHandler {
  readonly type = 'always' as const;

  evaluate(): boolean {
    return true;
  }
}

export class EventFieldEqualsConditionHandler
  implements AutomationConditionHandler
{
  readonly type = 'event-field-equals' as const;

  evaluate(
    condition: EventFieldEqualsCondition,
    event: ApplicationEvent,
  ): boolean {
    return readPayloadValue(event.payload, condition.path) === condition.value;
  }
}

export class EmitRuntimeEventActionHandler implements AutomationActionHandler {
  readonly type = 'emit-runtime-event' as const;

  async execute(
    action: EmitRuntimeEventAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    context.emit({
      causationId: context.event.id,
      correlationId: context.event.correlationId ?? context.event.id,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: action.payload,
      source: 'automation',
      type: action.eventType,
    });
    return 'continue';
  }
}

export class SendChatMessageActionHandler implements AutomationActionHandler {
  readonly type = 'send-chat' as const;

  constructor(private readonly sendChatMessage: (message: string) => Promise<void>) {}

  async execute(
    action: SendChatMessageAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const message = renderEventPayloadTemplate(action.message, context.event);

    if (!message.trim()) {
      throw new Error('The rendered chat message cannot be empty.');
    }

    if (message.length > 500) {
      throw new Error('The rendered chat message exceeds Twitch\'s 500 character limit.');
    }

    await this.sendChatMessage(message);
    context.emit({
      causationId: context.event.id,
      correlationId: context.event.correlationId ?? context.event.id,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { message },
      source: 'automation',
      type: 'automation.chat-message-sent',
    });
    return 'continue';
  }
}

export class TimeoutUserActionHandler implements AutomationActionHandler {
  readonly type = 'timeout-user' as const;

  constructor(
    private readonly timeoutUser: (
      userId: string,
      durationSeconds: number,
      reason?: string,
    ) => Promise<void>,
  ) {}

  async execute(
    action: TimeoutUserAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const targetUserId = renderEventPayloadTemplate(
      action.targetUserId,
      context.event,
    ).trim();
    const reason = action.reason
      ? renderEventPayloadTemplate(action.reason, context.event).trim() || undefined
      : undefined;

    if (!targetUserId) {
      throw new Error('The rendered timeout target user ID cannot be empty.');
    }

    await this.timeoutUser(targetUserId, action.durationSeconds, reason);
    context.emit({
      causationId: context.event.id,
      correlationId: context.event.correlationId ?? context.event.id,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {
        durationSeconds: action.durationSeconds,
        reason: reason ?? null,
        targetUserId,
      },
      source: 'automation',
      type: 'automation.user-timed-out',
    });
    return 'continue';
  }
}

export class DelayActionHandler implements AutomationActionHandler {
  readonly type = 'delay' as const;

  async execute(
    action: DelayAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    if (!context.scheduleContinuation) {
      throw new Error('The automation continuation scheduler is unavailable.');
    }

    const result = await context.scheduleContinuation(
      action.durationMs,
      action.duplicatePolicy,
    );

    if (result.status === 'scheduled') {
      context.emit({
        causationId: context.event.id,
        correlationId: context.event.correlationId ?? context.event.id,
        id: randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {
          continuationId: result.continuationId ?? null,
          dueInMs: action.durationMs,
        },
        source: 'automation',
        type: 'automation.continuation-scheduled',
      });
    }

    return result.status;
  }
}

function readPayloadValue(
  payload: Record<string, unknown>,
  path: string,
): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }

    return (value as Record<string, unknown>)[segment];
  }, payload);
}

