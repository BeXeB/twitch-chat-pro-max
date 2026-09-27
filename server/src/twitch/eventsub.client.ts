import { TwitchApiClient } from './twitch-api.client';

type EventSubConnectionState = 'connecting' | 'connected' | 'disconnected';

interface EventSubSessionContext {
  broadcasterId: string;
}

interface EventSubMetadata {
  messageId: string;
  messageTimestamp: string;
  messageType: string;
  subscriptionType: string | null;
}

interface EventSubEnvelope {
  metadata: EventSubMetadata;
  payload: Record<string, unknown>;
}

export interface EventSubNotification {
  event: Record<string, unknown>;
  id: string;
  occurredAt: string;
  type: string;
}

export interface EventSubClientCallbacks {
  onConnectionState(state: EventSubConnectionState): void;
  onError(error: Error): void;
  onNotification(notification: EventSubNotification): void;
}

interface EventSubSubscriptionDefinition {
  condition: Record<string, string>;
  type: string;
  version: string;
}

export const getEventSubSubscriptionDefinitions = (
  broadcasterId: string,
  eventSubUrl: string,
): EventSubSubscriptionDefinition[] => {
  const definitions: EventSubSubscriptionDefinition[] = [
    {
    type: 'channel.chat.message',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId, user_id: broadcasterId },
  },
  {
    type: 'stream.online',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
  },
  {
    type: 'stream.offline',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.follow',
    version: '2',
    condition: {
      broadcaster_user_id: broadcasterId,
      moderator_user_id: broadcasterId,
    },
  },
  {
    type: 'channel.subscribe',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.subscription.gift',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.subscription.message',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.cheer',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.raid',
    version: '1',
    condition: { to_broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.channel_points_custom_reward_redemption.add',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.hype_train.begin',
    version: '2',
    condition: { broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.hype_train.progress',
    version: '2',
    condition: { broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.hype_train.end',
    version: '2',
    condition: { broadcaster_user_id: broadcasterId },
  },
  ];
  const hostname = new URL(eventSubUrl).hostname;

  if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    return definitions.filter(
      (definition) =>
        definition.type !== 'channel.chat.message' &&
        !definition.type.startsWith('channel.hype_train.'),
    );
  }

  return definitions;
};

export class EventSubClient {
  private keepaliveTimeoutMs: number | null = null;

  private keepaliveTimer: ReturnType<typeof setTimeout> | null = null;

  private lastMessageAt = 0;

  private reconnectAttempts = 0;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private sessionContext: EventSubSessionContext | null = null;

  private socket: WebSocket | null = null;

  private stopped = true;

  constructor(
    private readonly api: TwitchApiClient,
    private readonly eventSubUrl: string,
    private readonly callbacks: EventSubClientCallbacks,
  ) {}

  async start(sessionContext: EventSubSessionContext): Promise<void> {
    this.stop();
    this.stopped = false;
    this.sessionContext = sessionContext;

    await this.connect(this.eventSubUrl, false);
  }

  stop(): void {
    this.stopped = true;
    this.sessionContext = null;

    this.clearKeepaliveWatchdog();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket?.close();
    this.socket = null;
    this.callbacks.onConnectionState('disconnected');
  }

  private async connect(
    endpoint: string,
    preservesSubscriptions: boolean,
  ): Promise<void> {
    const previousSocket = this.socket;
    const socket = new WebSocket(endpoint);
    this.socket = socket;
    this.callbacks.onConnectionState('connecting');

    await new Promise<void>((resolve, reject) => {
      let welcomed = false;

      socket.addEventListener('error', () => {
        if (!welcomed) {
          reject(new Error('Twitch EventSub WebSocket connection failed.'));
        }
      });

      socket.addEventListener('close', () => {
        if (!welcomed) {
          reject(new Error('Twitch EventSub WebSocket closed before welcome.'));
          return;
        }

        if (this.socket === socket && !this.stopped) {
          this.scheduleReconnect();
        }
      });

      socket.addEventListener('message', (message) => {
        void this.handleMessage(socket, String(message.data), preservesSubscriptions)
          .then((receivedWelcome) => {
            if (receivedWelcome) {
              welcomed = true;
              previousSocket?.close();
              resolve();
            }
          })
          .catch((error: unknown) => {
            const eventSubError =
              error instanceof Error
                ? error
                : new Error('Unable to handle a Twitch EventSub message.');
            this.callbacks.onError(eventSubError);

            if (!welcomed) {
              reject(eventSubError);
            }
          });
      });
    });
  }

  private async handleMessage(
    socket: WebSocket,
    data: string,
    preservesSubscriptions: boolean,
  ): Promise<boolean> {
    const message = parseEventSubEnvelope(data);

    if (!message) {
      throw new Error('Twitch EventSub sent an invalid message envelope.');
    }

    this.refreshKeepaliveWatchdog(socket);

    switch (message.metadata.messageType) {
      case 'session_welcome': {
        const sessionId = readString(message.payload['session'], 'id');
        const keepaliveTimeoutSeconds = readNumber(
          message.payload['session'],
          'keepalive_timeout_seconds',
        );

        if (!sessionId || !keepaliveTimeoutSeconds || !this.sessionContext) {
          throw new Error('Twitch EventSub welcome did not contain a session ID.');
        }

        if (!preservesSubscriptions) {
          await this.subscribeToEvents(sessionId);
        }

        this.startKeepaliveWatchdog(socket, keepaliveTimeoutSeconds);
        this.reconnectAttempts = 0;
        this.callbacks.onConnectionState('connected');
        return true;
      }

      case 'notification': {
        const event = readRecord(message.payload['event']);

        if (!event || !message.metadata.subscriptionType) {
          throw new Error('Twitch EventSub notification was incomplete.');
        }

        this.callbacks.onNotification({
          id: message.metadata.messageId,
          type: message.metadata.subscriptionType,
          occurredAt: message.metadata.messageTimestamp,
          event,
        });
        return false;
      }

      case 'session_reconnect': {
        const reconnectUrl = readString(
          message.payload['session'],
          'reconnect_url',
        );

        if (!reconnectUrl) {
          throw new Error('Twitch EventSub did not supply a reconnect URL.');
        }

        void this.connect(reconnectUrl, true).catch((error: unknown) => {
          const reconnectError =
            error instanceof Error
              ? error
              : new Error('Twitch EventSub reconnect failed.');
          this.callbacks.onError(reconnectError);
          this.scheduleReconnect();
        });
        return false;
      }
      default:
        return false;
    }
  }

  private async subscribeToEvents(sessionId: string): Promise<void> {
    if (!this.sessionContext) {
      throw new Error('Twitch EventSub is missing connection context.');
    }

    for (const subscription of getEventSubSubscriptionDefinitions(
      this.sessionContext.broadcasterId,
      this.eventSubUrl,
    )) {
      try {
        await this.api.createEventSubSubscription(subscription, sessionId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown subscription error.';
        throw new Error(
          `Twitch EventSub subscription ${subscription.type} v${subscription.version} failed: ${message}`,
        );
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }

    this.callbacks.onConnectionState('disconnected');
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 30000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(this.eventSubUrl, false).catch((error: unknown) => {
        const reconnectError =
          error instanceof Error
            ? error
            : new Error('Twitch EventSub reconnect failed.');
        this.callbacks.onError(reconnectError);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private startKeepaliveWatchdog(
    socket: WebSocket,
    keepaliveTimeoutSeconds: number,
  ): void {
    this.keepaliveTimeoutMs = keepaliveTimeoutSeconds * 1000;
    this.lastMessageAt = Date.now();
    this.refreshKeepaliveWatchdog(socket);
  }

  private refreshKeepaliveWatchdog(socket: WebSocket): void {
    if (!this.keepaliveTimeoutMs || this.socket !== socket) {
      return;
    }

    this.lastMessageAt = Date.now();
    this.clearKeepaliveTimer();

    this.keepaliveTimer = setTimeout(() => {
      const elapsed = Date.now() - this.lastMessageAt;

      if (this.socket === socket && elapsed >= this.keepaliveTimeoutMs!) {
        socket.close();
      }
    }, this.keepaliveTimeoutMs + 1000);
  }

  private clearKeepaliveWatchdog(): void {
    this.clearKeepaliveTimer();
    this.keepaliveTimeoutMs = null;
  }

  private clearKeepaliveTimer(): void {
    if (this.keepaliveTimer) {
      clearTimeout(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}

function parseEventSubEnvelope(data: string): EventSubEnvelope | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  const message = readRecord(parsed);
  const metadata = readRecord(message?.['metadata']);
  const payload = readRecord(message?.['payload']);
  const messageId = readString(metadata, 'message_id');
  const messageType = readString(metadata, 'message_type');
  const messageTimestamp = readString(metadata, 'message_timestamp');

  if (!metadata || !payload || !messageId || !messageType || !messageTimestamp) {
    return null;
  }

  return {
    metadata: {
      messageId,
      messageType,
      messageTimestamp,
      subscriptionType: readString(metadata, 'subscription_type'),
    },
    payload,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown, key: string): string | null {
  const record = readRecord(value);
  const property = record?.[key];

  return typeof property === 'string' ? property : null;
}

function readNumber(value: unknown, key: string): number | null {
  const record = readRecord(value);
  const property = record?.[key];

  return typeof property === 'number' && Number.isFinite(property)
    ? property
    : null;
}
