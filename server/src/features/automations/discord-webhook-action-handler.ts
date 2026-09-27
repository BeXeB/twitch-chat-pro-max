import { randomUUID } from 'node:crypto';

import { SendDiscordWebhookAction } from '../../../../shared/contracts/automation';
import { ApplicationEvent } from '../../../../shared/contracts/runtime-events';
import {
  AutomationActionContext,
  AutomationActionExecutionStatus,
  AutomationActionHandler,
} from './automation-engine';
import { renderEventPayloadTemplate } from './automation-template';

export class SendDiscordWebhookActionHandler implements AutomationActionHandler {
  readonly type = 'send-discord-webhook' as const;

  constructor(
    private readonly send: (message: Omit<SendDiscordWebhookAction, 'type'>) => Promise<void>,
  ) {}

  async execute(
    action: SendDiscordWebhookAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const content = renderEventPayloadTemplate(action.content, context.event).trim();
    const username = action.username
      ? renderEventPayloadTemplate(action.username, context.event).trim() || undefined
      : undefined;

    if (!content || content.length > 2000) {
      throw new Error('The rendered Discord message must contain 1 to 2000 characters.');
    }

    if (username && username.length > 80) {
      throw new Error('The rendered Discord username exceeds 80 characters.');
    }

    await this.send({
      allowedRoleId: action.allowedRoleId,
      content,
      username,
    });
    context.emit({
      causationId: context.event.id,
      correlationId: context.event.correlationId ?? context.event.id,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { content, username: username ?? null },
      source: 'automation',
      type: 'automation.discord-webhook-sent',
    } satisfies ApplicationEvent);

    return 'continue';
  }
}
