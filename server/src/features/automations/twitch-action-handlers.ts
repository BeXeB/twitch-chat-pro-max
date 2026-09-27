import { randomUUID } from 'node:crypto';

import {
  AddChannelVipAction,
  AddLeaderboardPointsAction,
  BanUserAction,
  CreatePollAction,
  CreatePredictionAction,
  DeleteChatMessageAction,
  EndPollAction,
  IncreaseCustomRewardCostAction,
  ResolvePredictionAction,
  SendShoutoutAction,
  ShowAlertAction,
  UnbanUserAction,
  UpdateChatSettingsAction,
  UpdateRedemptionStatusAction,
} from '../../../../shared/contracts/automation';
import { ApplicationEvent } from '../../../../shared/contracts/runtime-events';
import {
  AutomationActionContext,
  AutomationActionExecutionStatus,
  AutomationActionHandler,
} from './automation-engine';
import { renderEventPayloadTemplate } from './automation-template';

export class AddChannelVipActionHandler implements AutomationActionHandler {
  readonly type = 'add-channel-vip' as const;

  constructor(private readonly addChannelVip: (userId: string) => Promise<void>) {}

  async execute(
    action: AddChannelVipAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const userId = renderRequired(action.targetUserId, context.event, 'VIP target user ID');

    await this.addChannelVip(userId);
    emitActionEvent(context, 'automation.channel-vip-added', { userId });
    return 'continue';
  }
}

export class AddLeaderboardPointsActionHandler implements AutomationActionHandler {
  readonly type = 'add-leaderboard-points' as const;

  constructor(private readonly addPoints: (userId: string, points: number) => Promise<number>) {}

  async execute(
    action: AddLeaderboardPointsAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const userId = renderRequired(action.userId, context.event, 'leaderboard user ID');
    const pointsText = renderRequired(action.points, context.event, 'leaderboard points');
    const points = Number(pointsText);

    if (!Number.isSafeInteger(points) || points < 1) {
      throw new Error('The rendered leaderboard points must be a positive integer.');
    }

    const totalPoints = await this.addPoints(userId, points);
    emitActionEvent(context, 'automation.leaderboard-points-added', {
      points,
      totalPoints,
      userId,
    });
    return 'continue';
  }
}

export class IncreaseCustomRewardCostActionHandler implements AutomationActionHandler {
  readonly type = 'increase-custom-reward-cost' as const;

  constructor(
    private readonly increaseCustomRewardCost: (
      rewardId: string,
      amount: number,
    ) => Promise<number>,
  ) {}

  async execute(
    action: IncreaseCustomRewardCostAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const rewardId = renderRequired(action.rewardId, context.event, 'reward ID');
    const newCost = await this.increaseCustomRewardCost(rewardId, action.amount);

    emitActionEvent(context, 'automation.custom-reward-cost-increased', {
      amount: action.amount,
      newCost,
      rewardId,
    });
    return 'continue';
  }
}

export class BanUserActionHandler implements AutomationActionHandler {
  readonly type = 'ban-user' as const;

  constructor(private readonly banUser: (userId: string, reason?: string) => Promise<void>) {}

  async execute(
    action: BanUserAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const userId = renderRequired(action.targetUserId, context.event, 'ban target user ID');
    const reason = renderOptional(action.reason, context.event, 500);

    await this.banUser(userId, reason);
    emitActionEvent(context, 'automation.user-banned', { reason: reason ?? null, userId });
    return 'continue';
  }
}

export class CreatePollActionHandler implements AutomationActionHandler {
  readonly type = 'create-poll' as const;

  constructor(
    private readonly createPoll: (
      title: string,
      choices: string[],
      durationSeconds: number,
    ) => Promise<string>,
  ) {}

  async execute(
    action: CreatePollAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const title = renderRequired(action.title, context.event, 'poll title', 60);
    const choices = renderTextList(action.choices, context.event, 'poll choice', 25);
    const pollId = await this.createPoll(title, choices, action.durationSeconds);

    emitActionEvent(context, 'automation.poll-created', {
      choices,
      durationSeconds: action.durationSeconds,
      pollId,
      title,
    });
    return 'continue';
  }
}

export class CreatePredictionActionHandler implements AutomationActionHandler {
  readonly type = 'create-prediction' as const;

  constructor(
    private readonly createPrediction: (
      title: string,
      outcomes: string[],
      durationSeconds: number,
    ) => Promise<string>,
  ) {}

  async execute(
    action: CreatePredictionAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const title = renderRequired(action.title, context.event, 'prediction title', 45);
    const outcomes = renderTextList(action.outcomes, context.event, 'prediction outcome', 25);
    const predictionId = await this.createPrediction(title, outcomes, action.durationSeconds);

    emitActionEvent(context, 'automation.prediction-created', {
      durationSeconds: action.durationSeconds,
      outcomes,
      predictionId,
      title,
    });
    return 'continue';
  }
}

export class DeleteChatMessageActionHandler implements AutomationActionHandler {
  readonly type = 'delete-chat-message' as const;

  constructor(private readonly deleteChatMessage: (messageId: string) => Promise<void>) {}

  async execute(
    action: DeleteChatMessageAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const messageId = renderRequired(action.messageId, context.event, 'chat message ID');

    await this.deleteChatMessage(messageId);
    emitActionEvent(context, 'automation.chat-message-deleted', { messageId });
    return 'continue';
  }
}

export class EndPollActionHandler implements AutomationActionHandler {
  readonly type = 'end-poll' as const;

  constructor(
    private readonly endPoll: (pollId: string, status: EndPollAction['status']) => Promise<void>,
  ) {}

  async execute(
    action: EndPollAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const pollId = renderRequired(action.pollId, context.event, 'poll ID');

    await this.endPoll(pollId, action.status);
    emitActionEvent(context, 'automation.poll-ended', { pollId, status: action.status });
    return 'continue';
  }
}

export class ResolvePredictionActionHandler implements AutomationActionHandler {
  readonly type = 'resolve-prediction' as const;

  constructor(
    private readonly resolvePrediction: (
      predictionId: string,
      status: ResolvePredictionAction['status'],
      winningOutcomeId?: string,
    ) => Promise<void>,
  ) {}

  async execute(
    action: ResolvePredictionAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const predictionId = renderRequired(action.predictionId, context.event, 'prediction ID');
    const winningOutcomeId = renderOptional(action.winningOutcomeId, context.event);

    await this.resolvePrediction(predictionId, action.status, winningOutcomeId);
    emitActionEvent(context, 'automation.prediction-updated', {
      predictionId,
      status: action.status,
      winningOutcomeId: winningOutcomeId ?? null,
    });
    return 'continue';
  }
}

export class SendShoutoutActionHandler implements AutomationActionHandler {
  readonly type = 'send-shoutout' as const;

  constructor(private readonly sendShoutout: (targetBroadcasterId: string) => Promise<void>) {}

  async execute(
    action: SendShoutoutAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const targetBroadcasterId = renderRequired(
      action.targetBroadcasterId,
      context.event,
      'shoutout target broadcaster ID',
    );

    await this.sendShoutout(targetBroadcasterId);
    emitActionEvent(context, 'automation.shoutout-sent', { targetBroadcasterId });
    return 'continue';
  }
}

export class ShowAlertActionHandler implements AutomationActionHandler {
  readonly type = 'show-alert' as const;

  async execute(
    action: ShowAlertAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const message = renderRequired(action.message, context.event, 'alert message', 500);
    const title = renderOptional(action.title, context.event, 100);

    emitActionEvent(context, 'automation.alert-raised', {
      message,
      title: title ?? null,
    });
    return 'continue';
  }
}

export class UnbanUserActionHandler implements AutomationActionHandler {
  readonly type = 'unban-user' as const;

  constructor(private readonly unbanUser: (userId: string) => Promise<void>) {}

  async execute(
    action: UnbanUserAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const userId = renderRequired(action.targetUserId, context.event, 'unban target user ID');

    await this.unbanUser(userId);
    emitActionEvent(context, 'automation.user-unbanned', { userId });
    return 'continue';
  }
}

export class UpdateChatSettingsActionHandler implements AutomationActionHandler {
  readonly type = 'update-chat-settings' as const;

  constructor(
    private readonly updateChatSettings: (
      settings: UpdateChatSettingsAction['settings'],
    ) => Promise<void>,
  ) {}

  async execute(
    action: UpdateChatSettingsAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    await this.updateChatSettings(action.settings);
    emitActionEvent(context, 'automation.chat-settings-updated', {
      settings: action.settings,
    });
    return 'continue';
  }
}

export class UpdateRedemptionStatusActionHandler implements AutomationActionHandler {
  readonly type = 'update-redemption-status' as const;

  constructor(
    private readonly updateRedemptionStatus: (
      rewardId: string,
      redemptionIds: string[],
      status: UpdateRedemptionStatusAction['status'],
    ) => Promise<void>,
  ) {}

  async execute(
    action: UpdateRedemptionStatusAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const rewardId = renderRequired(action.rewardId, context.event, 'reward ID');
    const redemptionIds = renderTextList(action.redemptionIds, context.event, 'redemption ID');

    await this.updateRedemptionStatus(rewardId, redemptionIds, action.status);
    emitActionEvent(context, 'automation.redemption-status-updated', {
      redemptionIds,
      rewardId,
      status: action.status,
    });
    return 'continue';
  }
}

function emitActionEvent(
  context: AutomationActionContext,
  type: `automation.${string}`,
  payload: Record<string, unknown>,
): void {
  context.emit({
    causationId: context.event.id,
    correlationId: context.event.correlationId ?? context.event.id,
    id: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload,
    source: 'automation',
    type,
  });
}

function renderOptional(
  template: string | undefined,
  event: ApplicationEvent,
  maximumLength?: number,
): string | undefined {
  if (template === undefined) {
    return undefined;
  }

  const value = renderEventPayloadTemplate(template, event).trim();

  if (!value) {
    return undefined;
  }

  if (maximumLength !== undefined && value.length > maximumLength) {
    throw new Error(`The rendered value exceeds the ${maximumLength} character limit.`);
  }

  return value;
}

function renderRequired(
  template: string,
  event: ApplicationEvent,
  label: string,
  maximumLength?: number,
): string {
  const value = renderOptional(template, event, maximumLength);

  if (!value) {
    throw new Error(`The rendered ${label} cannot be empty.`);
  }

  return value;
}

function renderTextList(
  templates: string[],
  event: ApplicationEvent,
  label: string,
  maximumLength?: number,
): string[] {
  return templates.map((template) => renderRequired(template, event, label, maximumLength));
}
