import { ApplicationEvent } from '../../../shared/contracts/runtime-events';
import {
  RuntimeAlert,
  RuntimeAutomationAlert,
  RuntimeBitsEvent,
  RuntimeChatMessage,
  RuntimeFollowEvent,
  RuntimeGiftSubscriptionEvent,
  RuntimeRaidEvent,
  RuntimeRedemptionEvent,
  RuntimeSubscriptionEvent,
  RuntimeViewState,
} from '../../../shared/contracts/runtime-view-state';

type RuntimeEventProjector = (event: ApplicationEvent) => void;

const maxAlerts = 100;
const maxChatMessages = 500;

export class RuntimeViewProjector {
  private readonly handlers = new Map<string, RuntimeEventProjector>([
    ['automation.alert-raised', (event) => this.projectAutomationAlert(event)],
    ['automation.chat-message-deleted', (event) => this.projectDeletedMessage(event)],
    ['automation.user-banned', (event) => this.projectModeratedUser(event)],
    ['automation.user-timed-out', (event) => this.projectModeratedUser(event)],
    ['manual.chat-message-deleted', (event) => this.projectDeletedMessage(event)],
    ['manual.user-banned', (event) => this.projectModeratedUser(event)],
    ['manual.user-timed-out', (event) => this.projectModeratedUser(event)],
    ['twitch.channel.chat.message', (event) => this.projectChatMessage(event)],
    ['twitch.stream.online', () => this.setStreamState('online')],
    ['twitch.stream.offline', () => this.setStreamState('offline')],
    ['twitch.channel.follow', (event) => this.projectFollow(event)],
    ['twitch.channel.subscribe', (event) => this.projectSubscription(event)],
    [
      'twitch.channel.subscription.message',
      (event) => this.projectSubscription(event),
    ],
    [
      'twitch.channel.subscription.gift',
      (event) => this.projectGiftSubscription(event),
    ],
    ['twitch.channel.cheer', (event) => this.projectBits(event)],
    ['twitch.channel.raid', (event) => this.projectRaid(event)],
    [
      'twitch.channel.channel_points_custom_reward_redemption.add',
      (event) => this.projectRedemption(event),
    ],
  ]);

  private state: RuntimeViewState = {
    alerts: [],
    chatMessages: [],
    deletedMessageIds: [],
    streamState: 'offline',
  };

  getState(): RuntimeViewState {
    return {
      alerts: [...this.state.alerts],
      chatMessages: [...this.state.chatMessages],
      deletedMessageIds: [...this.state.deletedMessageIds],
      streamState: this.state.streamState,
    };
  }

  project(event: ApplicationEvent): RuntimeViewState {
    this.handlers.get(event.type)?.(event);

    return this.getState();
  }

  private appendAlert(alert: RuntimeAlert): void {
    this.state = {
      ...this.state,
      alerts: [...this.state.alerts, alert].slice(-maxAlerts),
    };
  }

  private projectAutomationAlert(event: ApplicationEvent): void {
    const message = readString(event.payload, 'message');

    if (!message) {
      return;
    }

    const data: RuntimeAutomationAlert = {
      message,
      title: readOptionalString(event.payload, 'title'),
    };
    this.appendAlert({
      id: event.id,
      type: 'automation',
      timestamp: event.occurredAt,
      data,
    });
  }

  private projectDeletedMessage(event: ApplicationEvent): void {
    const messageId = readString(event.payload, 'messageId');

    if (!messageId) {
      return;
    }

    this.markMessagesDeleted([messageId]);
  }

  private projectModeratedUser(event: ApplicationEvent): void {
    const userId =
      readString(event.payload, 'userId') ??
      readString(event.payload, 'targetUserId');

    if (!userId) {
      return;
    }

    this.markMessagesDeleted(
      this.state.chatMessages
        .filter((message) => message.userId === userId)
        .map((message) => message.id),
    );
  }

  private markMessagesDeleted(messageIds: string[]): void {
    this.state = {
      ...this.state,
      deletedMessageIds: [...new Set([...this.state.deletedMessageIds, ...messageIds])]
        .slice(-maxChatMessages),
    };
  }

  private projectBits(event: ApplicationEvent): void {
    const payload = event.payload;
    const bits = readNumber(payload, 'bits');

    if (bits === null) {
      return;
    }

    const data: RuntimeBitsEvent = {
      userId: readOptionalString(payload, 'user_id'),
      username: readOptionalString(payload, 'user_login'),
      displayName: readOptionalString(payload, 'user_name'),
      bits,
      message: readString(payload, 'message') ?? '',
    };

    this.appendAlert({
      id: event.id,
      type: 'bits',
      timestamp: event.occurredAt,
      data,
    });
  }

  private projectChatMessage(event: ApplicationEvent): void {
    const payload = event.payload;
    const message = readRecord(payload['message']);
    const id = readString(payload, 'message_id');
    const userId = readString(payload, 'chatter_user_id');
    const username = readString(payload, 'chatter_user_login');
    const displayName = readString(payload, 'chatter_user_name');
    const text = readString(message, 'text');

    if (!id || !userId || !username || !displayName || text === null) {
      return;
    }

    const chatMessage: RuntimeChatMessage = {
      id,
      userId,
      username,
      displayName,
      message: text,
      timestamp: event.occurredAt,
      color: readOptionalString(payload, 'color'),
    };
    this.state = {
      ...this.state,
      chatMessages: [...this.state.chatMessages, chatMessage].slice(
        -maxChatMessages,
      ),
    };
  }

  private projectFollow(event: ApplicationEvent): void {
    const payload = event.payload;
    const userId = readString(payload, 'user_id');
    const username = readString(payload, 'user_login');
    const displayName = readString(payload, 'user_name');
    const followedAt = readString(payload, 'followed_at');

    if (!userId || !username || !displayName || !followedAt) {
      return;
    }

    const data: RuntimeFollowEvent = {
      userId,
      username,
      displayName,
      followedAt,
    };
    this.appendAlert({
      id: event.id,
      type: 'follow',
      timestamp: event.occurredAt,
      data,
    });
  }

  private projectGiftSubscription(event: ApplicationEvent): void {
    const payload = event.payload;
    const total = readNumber(payload, 'total');
    const tier = readString(payload, 'tier');
    const isAnonymous = readBoolean(payload, 'is_anonymous');

    if (total === null || !tier || isAnonymous === null) {
      return;
    }

    const data: RuntimeGiftSubscriptionEvent = {
      userId: isAnonymous ? null : readOptionalString(payload, 'user_id'),
      username: isAnonymous ? null : readOptionalString(payload, 'user_login'),
      displayName: isAnonymous ? null : readOptionalString(payload, 'user_name'),
      total,
      tier,
      cumulativeTotal: readNumber(payload, 'cumulative_total'),
      isAnonymous,
    };
    this.appendAlert({
      id: event.id,
      type: 'gift-subscription',
      timestamp: event.occurredAt,
      data,
    });
  }

  private projectRaid(event: ApplicationEvent): void {
    const payload = event.payload;
    const userId = readString(payload, 'from_broadcaster_user_id');
    const username = readString(payload, 'from_broadcaster_user_login');
    const displayName = readString(payload, 'from_broadcaster_user_name');
    const viewers = readNumber(payload, 'viewers');

    if (!userId || !username || !displayName || viewers === null) {
      return;
    }

    const data: RuntimeRaidEvent = {
      userId,
      username,
      displayName,
      viewers,
    };
    this.appendAlert({
      id: event.id,
      type: 'raid',
      timestamp: event.occurredAt,
      data,
    });
  }

  private projectRedemption(event: ApplicationEvent): void {
    const payload = event.payload;
    const reward = readRecord(payload['reward']);
    const id = readString(payload, 'id');
    const userId = readString(payload, 'user_id');
    const username = readString(payload, 'user_login');
    const displayName = readString(payload, 'user_name');
    const rewardId = readString(reward, 'id');
    const rewardTitle = readString(reward, 'title');
    const rewardCost = readNumber(reward, 'cost');
    const status = readString(payload, 'status');
    const redeemedAt = readString(payload, 'redeemed_at');

    if (
      !id ||
      !userId ||
      !username ||
      !displayName ||
      !rewardId ||
      !rewardTitle ||
      rewardCost === null ||
      !status ||
      !redeemedAt
    ) {
      return;
    }

    const data: RuntimeRedemptionEvent = {
      id,
      userId,
      username,
      displayName,
      rewardId,
      rewardTitle,
      rewardCost,
      userInput: readString(payload, 'user_input') ?? '',
      status,
      redeemedAt,
    };
    this.appendAlert({
      id: event.id,
      type: 'redemption',
      timestamp: event.occurredAt,
      data,
    });
  }

  private projectSubscription(event: ApplicationEvent): void {
    const payload = event.payload;
    const userId = readString(payload, 'user_id');
    const username = readString(payload, 'user_login');
    const displayName = readString(payload, 'user_name');
    const tier = readString(payload, 'tier');

    if (!userId || !username || !displayName || !tier) {
      return;
    }

    const message = readRecord(payload['message']);
    const data: RuntimeSubscriptionEvent = {
      userId,
      username,
      displayName,
      tier,
      isGift: readBoolean(payload, 'is_gift') ?? false,
      message: readString(message, 'text') ?? '',
    };
    this.appendAlert({
      id: event.id,
      type: 'subscription',
      timestamp: event.occurredAt,
      data,
    });
  }

  private setStreamState(streamState: RuntimeViewState['streamState']): void {
    this.state = { ...this.state, streamState };
  }
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];

  return typeof value === 'boolean' ? value : null;
}

function readNumber(
  record: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = record?.[key];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  return readString(record, key);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];

  return typeof value === 'string' ? value : null;
}
