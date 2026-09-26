import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ChatMessage } from './models/chat-message.model';
import { TwitchUser } from './models/twitch-user.model';
import { StreamState } from './models/stream-state.model';
import { FollowEvent } from './models/follow-event.model';
import { SubscriptionEvent } from './models/subscription-event.model';
import { GiftSubscriptionEvent } from './models/gift-subscription-event.model';
import { BitsEvent } from './models/bits-event.model';
import { RaidEvent } from './models/raid-event.model';
import { ChannelPointRedemptionEvent } from './models/channel-point-redemption-event.model';

@Injectable({
  providedIn: 'root',
})
export class TwitchService {
  private readonly clientId = environment.twitchClientId;
  private readonly redirectUri = 'http://localhost:4200';

  private readonly scopes: Set<string> = new Set([
    'user:read:chat',
    'user:write:chat',
    'channel:bot',
    'channel:read:redemptions',
    'channel:manage:redemptions',
    'channel:read:subscriptions',
    'channel:read:goals',
    'channel:manage:polls',
    'channel:manage:predictions',
    'bits:read',
    'moderator:read:followers',
    'moderator:read:chatters',
    'moderator:read:moderators',
    'moderator:manage:announcements',
    'moderator:manage:chat_messages',
    'moderator:manage:chat_settings',
    'moderator:manage:shoutouts',
    'moderator:manage:banned_users',
    'moderator:read:followers',
    'moderator:manage:shoutouts',
    'moderator:manage:chat_settings',
  ]);

  private accessToken: string | null = null;
  private socket: WebSocket | null = null;
  private currentUser: TwitchUser | null = null;

  private readonly messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  readonly messages$ = this.messagesSubject.asObservable();

  private readonly streamStateSubject = new BehaviorSubject<StreamState>(
    'offline',
  );

  private readonly connectedSubject = new BehaviorSubject<boolean>(false);

  readonly connected$ = this.connectedSubject.asObservable();

  readonly streamState$ = this.streamStateSubject.asObservable();

  private readonly followsSubject = new BehaviorSubject<FollowEvent[]>([]);

  readonly follows$ = this.followsSubject.asObservable();

  private readonly subscriptionsSubject = new BehaviorSubject<
    SubscriptionEvent[]
  >([]);

  readonly subscriptions$ = this.subscriptionsSubject.asObservable();

  private readonly giftSubscriptionsSubject = new BehaviorSubject<
    GiftSubscriptionEvent[]
  >([]);

  readonly giftSubscriptions$ = this.giftSubscriptionsSubject.asObservable();

  private readonly bitsSubject = new BehaviorSubject<BitsEvent[]>([]);

  readonly bits$ = this.bitsSubject.asObservable();

  private readonly raidsSubject = new BehaviorSubject<RaidEvent[]>([]);

  readonly raids$ = this.raidsSubject.asObservable();

  private readonly redemptionsSubject = new BehaviorSubject<
    ChannelPointRedemptionEvent[]
  >([]);

  readonly redemptions$ = this.redemptionsSubject.asObservable();

  connectToTwitch(): void {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'token',
      scope: Array.from(this.scopes).join(' '),
      state: crypto.randomUUID(),
    });

    window.location.href = `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  async initialize(): Promise<void> {
    const hash = window.location.hash;

    if (!hash) {
      return;
    }

    const params = new URLSearchParams(hash.substring(1));

    const accessToken = params.get('access_token');

    // Remove the OAuth token from the browser URL.
    window.history.replaceState({}, document.title, window.location.pathname);

    if (!accessToken) {
      return;
    }

    await this.connect(accessToken);
  }

  async connect(accessToken: string): Promise<void> {
    this.accessToken = accessToken;

    const user = await this.getCurrentUser();

    if (!user) {
      this.accessToken = null;
      this.connectedSubject.next(false);
      throw new Error('Unable to get Twitch user.');
    }

    this.currentUser = user;
    this.connectedSubject.next(true);

    console.log('Connected Twitch user:', user.displayName);

    this.connectToEventSub();
  }

  private async getCurrentUser(): Promise<TwitchUser | null> {
    if (!this.accessToken) {
      return null;
    }

    const response = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,

        'Client-Id': this.clientId,
      },
    });

    if (!response.ok) {
      console.error('Failed to get Twitch user:', await response.text());

      return null;
    }

    const data = await response.json();

    const user = data.data[0];

    return {
      id: user.id,
      login: user.login,
      displayName: user.display_name,
      profileImageUrl: user.profile_image_url,
    };
  }

  private connectToEventSub(): void {
    this.socket = new WebSocket('wss://eventsub.wss.twitch.tv/ws');

    this.socket.onopen = () => {
      console.log('Connected to Twitch EventSub.');
    };

    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);

      this.handleEventSubMessage(message);
    };

    this.socket.onerror = (error) => {
      console.error('Twitch EventSub WebSocket error:', error);
    };

    this.socket.onclose = () => {
      console.log('Twitch EventSub WebSocket closed.');

      this.socket = null;
    };
  }

  private async handleEventSubMessage(message: any): Promise<void> {
    const messageType = message.metadata?.message_type;

    switch (messageType) {
      case 'session_welcome':
        await this.subscribeToEvents(message.payload.session.id);
        break;

      case 'notification':
        this.handleNotification(message);
        break;

      case 'session_keepalive':
        break;

      case 'session_reconnect':
        console.log('Twitch requested a reconnect.');
        break;

      default:
        console.log('Unhandled EventSub message:', message);
    }
  }

  private async subscribeToEvents(sessionId: string): Promise<void> {
    if (!this.accessToken || !this.currentUser) {
      return;
    }

    const subscriptions = [
      {
        type: 'channel.chat.message',
        version: '1',
        condition: {
          broadcaster_user_id: this.currentUser.id,

          user_id: this.currentUser.id,
        },
      },

      {
        type: 'stream.online',
        version: '1',
        condition: {
          broadcaster_user_id: this.currentUser.id,
        },
      },

      {
        type: 'stream.offline',
        version: '1',
        condition: {
          broadcaster_user_id: this.currentUser.id,
        },
      },
      {
        type: 'channel.follow',
        version: '2',
        condition: {
          broadcaster_user_id: this.currentUser.id,
          moderator_user_id: this.currentUser.id,
        },
      },
      {
        type: 'channel.subscribe',
        version: '1',
        condition: {
          broadcaster_user_id: this.currentUser.id,
        },
      },
      {
        type: 'channel.subscription.gift',
        version: '1',
        condition: {
          broadcaster_user_id: this.currentUser.id,
        },
      },
      {
        type: 'channel.subscription.message',
        version: '1',
        condition: {
          broadcaster_user_id: this.currentUser.id,
        },
      },
      {
        type: 'channel.cheer',
        version: '1',
        condition: {
          broadcaster_user_id: this.currentUser.id,
        },
      },
      {
        type: 'channel.raid',
        version: '1',
        condition: {
          to_broadcaster_user_id: this.currentUser.id,
        },
      },
      {
        type: 'channel.channel_points_custom_reward_redemption.add',
        version: '1',
        condition: {
          broadcaster_user_id: this.currentUser.id,
        },
      },
      {
        type: 'channel.hype_train.begin',
        version: '2',
        condition: {
          broadcaster_user_id: this.currentUser.id,
        },
      },
      {
        type: 'channel.hype_train.progress',
        version: '2',
        condition: {
          broadcaster_user_id: this.currentUser.id,
        },
      },
      {
        type: 'channel.hype_train.end',
        version: '2',
        condition: {
          broadcaster_user_id: this.currentUser.id,
        },
      },
    ];

    for (const subscription of subscriptions) {
      const response = await fetch(
        'https://api.twitch.tv/helix/eventsub/subscriptions',
        {
          method: 'POST',

          headers: {
            Authorization: `Bearer ${this.accessToken}`,

            'Client-Id': this.clientId,

            'Content-Type': 'application/json',
          },

          body: JSON.stringify({
            ...subscription,

            transport: {
              method: 'websocket',
              session_id: sessionId,
            },
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        console.error(`Failed to subscribe to ${subscription.type}:`, data);

        continue;
      }

      console.log(`Subscribed to ${subscription.type}`);
    }
  }

  private handleNotification(message: any): void {
    const subscription = message.payload?.subscription;

    switch (subscription?.type) {
      case 'channel.chat.message':
        this.handleChatMessage(message);
        break;

      case 'stream.online':
        this.handleStreamOnline(message);
        break;

      case 'stream.offline':
        this.handleStreamOffline(message);
        break;

      case 'channel.follow':
        this.handleFollow(message);
        break;

      case 'channel.subscribe':
        this.handleSubscription(message);
        break;

      case 'channel.subscription.gift':
        this.handleGiftSubscription(message);
        break;

      case 'channel.subscription.message':
        this.handleSubscriptionMessage(message);
        break;

      case 'channel.cheer':
        this.handleBits(message);
        break;

      case 'channel.raid':
        this.handleRaid(message);
        break;

      case 'channel.channel_points_custom_reward_redemption.add':
        this.handleChannelPointRedemption(message);
        break;

      case 'channel.hype_train.begin':
      case 'channel.hype_train.progress':
      case 'channel.hype_train.end':
        this.handleHypeTrain(message);
        break;

      default:
        console.log('Unhandled Twitch notification:', subscription?.type);
    }
  }

  private handleChatMessage(message: any): void {
    const event = message.payload.event;

    const chatMessage: ChatMessage = {
      id: event.message_id,
      userId: event.chatter_user_id,
      username: event.chatter_user_login,
      displayName: event.chatter_user_name,
      message: event.message.text,
      timestamp: message.metadata.message_timestamp,
    };

    const messages = this.messagesSubject.value;

    this.messagesSubject.next([...messages, chatMessage]);
  }

  private handleStreamOnline(message: any): void {
    console.log('Stream went online:', message.payload.event);

    this.streamStateSubject.next('online');
  }

  private handleStreamOffline(message: any): void {
    console.log('Stream went offline:', message.payload.event);

    this.streamStateSubject.next('offline');
  }

  private handleFollow(message: any): void {
    const event = message.payload.event;

    const follow: FollowEvent = {
      userId: event.user_id,
      username: event.user_login,
      displayName: event.user_name,
      followedAt: event.followed_at,
    };

    this.followsSubject.next([...this.followsSubject.value, follow]);
  }

  private handleSubscription(message: any): void {
    const event = message.payload.event;

    const subscription: SubscriptionEvent = {
      userId: event.user_id,
      username: event.user_login,
      displayName: event.user_name,
      tier: event.tier,
      isGift: event.is_gift,
    };

    this.subscriptionsSubject.next([
      ...this.subscriptionsSubject.value,
      subscription,
    ]);
  }

  private handleGiftSubscription(message: any): void {
    const event = message.payload.event;

    const gift: GiftSubscriptionEvent = {
      userId: event.is_anonymous ? null : event.user_id,
      username: event.is_anonymous ? null : event.user_login,
      displayName: event.is_anonymous ? null : event.user_name,
      total: event.total,
      tier: event.tier,
      cumulativeTotal: event.cumulative_total ?? null,
      isAnonymous: event.is_anonymous,
    };

    this.giftSubscriptionsSubject.next([
      ...this.giftSubscriptionsSubject.value,
      gift,
    ]);
  }

  private handleSubscriptionMessage(message: any): void {
    const event = message.payload.event;

    console.log('Resubscription:', event);
  }

  private handleBits(message: any): void {
    const event = message.payload.event;

    const bits: BitsEvent = {
      userId: event.user_id ?? null,
      username: event.user_login ?? null,
      displayName: event.user_name ?? null,
      bits: event.bits,
      message: event.message ?? '',
    };

    this.bitsSubject.next([...this.bitsSubject.value, bits]);
  }

  private handleRaid(message: any): void {
    const event = message.payload.event;

    const raid: RaidEvent = {
      userId: event.from_broadcaster_user_id,
      username: event.from_broadcaster_user_login,
      displayName: event.from_broadcaster_user_name,
      viewers: event.viewers,
    };

    this.raidsSubject.next([...this.raidsSubject.value, raid]);
  }

  private handleChannelPointRedemption(message: any): void {
    const event = message.payload.event;

    const redemption: ChannelPointRedemptionEvent = {
      id: event.id,
      userId: event.user_id,
      username: event.user_login,
      displayName: event.user_name,
      rewardId: event.reward.id,
      rewardTitle: event.reward.title,
      rewardCost: event.reward.cost,
      userInput: event.user_input,
      status: event.status,
      redeemedAt: event.redeemed_at,
    };

    this.redemptionsSubject.next([
      ...this.redemptionsSubject.value,
      redemption,
    ]);
  }

  private handleHypeTrain(message: any): void {
    const subscription = message.payload?.subscription;

    const event = message.payload?.event;

    console.log('Hype Train event:', subscription?.type, event);
  }

  async sendShoutout(targetBroadcasterId: string): Promise<boolean> {
    if (!this.accessToken || !this.currentUser) {
      return false;
    }

    const broadcasterId = this.currentUser.id;

    const url = new URL('https://api.twitch.tv/helix/chat/shoutouts');

    url.searchParams.set('from_broadcaster_id', broadcasterId);

    url.searchParams.set('to_broadcaster_id', targetBroadcasterId);

    url.searchParams.set('moderator_id', broadcasterId);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
      },
    });

    if (!response.ok) {
      console.error('Failed to send Twitch shoutout:', await response.text());

      return false;
    }

    console.log('Shoutout sent to:', targetBroadcasterId);

    return true;
  }

  async updateChatSettings(settings: {
    followerMode?: boolean;
    followerModeDuration?: number;
    slowMode?: boolean;
    slowModeWaitTime?: number;
    subscriberMode?: boolean;
    emoteMode?: boolean;
  }): Promise<boolean> {
    if (!this.accessToken || !this.currentUser) {
      return false;
    }

    const body: Record<string, any> = {};

    if (settings.followerMode !== undefined) {
      body['follower_mode'] = settings.followerMode;
    }

    if (settings.followerModeDuration !== undefined) {
      body['follower_mode_duration'] = settings.followerModeDuration;
    }

    if (settings.slowMode !== undefined) {
      body['slow_mode'] = settings.slowMode;
    }

    if (settings.slowModeWaitTime !== undefined) {
      body['slow_mode_wait_time'] = settings.slowModeWaitTime;
    }

    if (settings.subscriberMode !== undefined) {
      body['subscriber_mode'] = settings.subscriberMode;
    }

    if (settings.emoteMode !== undefined) {
      body['emote_mode'] = settings.emoteMode;
    }

    const url = new URL('https://api.twitch.tv/helix/chat/settings');

    url.searchParams.set('broadcaster_id', this.currentUser.id);

    url.searchParams.set('moderator_id', this.currentUser.id);

    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error('Failed to update chat settings:', await response.text());

      return false;
    }

    return true;
  }

  async sendChatMessage(message: string): Promise<boolean> {
    if (!this.accessToken || !this.currentUser) {
      return false;
    }

    const response = await fetch('https://api.twitch.tv/helix/chat/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        broadcaster_id: this.currentUser.id,
        sender_id: this.currentUser.id,
        message,
      }),
    });

    if (!response.ok) {
      console.error('Failed to send chat message:', await response.text());

      return false;
    }

    return true;
  }

  async getCustomRewards(): Promise<any[]> {
    if (!this.accessToken || !this.currentUser) {
      return [];
    }

    const url = new URL(
      'https://api.twitch.tv/helix/channel_points/custom_rewards',
    );

    url.searchParams.set('broadcaster_id', this.currentUser.id);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
      },
    });

    if (!response.ok) {
      console.error('Failed to get custom rewards:', await response.text());

      return [];
    }

    const data = await response.json();

    return data.data;
  }

  async createCustomReward(
    title: string,
    cost: number,
    options: {
      prompt?: string;
      enabled?: boolean;
      userInputRequired?: boolean;
      backgroundColor?: string;
      maxPerStream?: number;
      maxPerUserPerStream?: number;
      globalCooldownSeconds?: number;
      isGlobalCooldownEnabled?: boolean;
      isMaxPerStreamEnabled?: boolean;
      isMaxPerUserPerStreamEnabled?: boolean;
    } = {},
  ): Promise<any | null> {
    if (!this.accessToken || !this.currentUser) {
      return null;
    }

    const body: Record<string, any> = {
      title,
      cost,
    };

    if (options.prompt !== undefined) {
      body['prompt'] = options.prompt;
    }

    if (options.enabled !== undefined) {
      body['is_enabled'] = options.enabled;
    }

    if (options.userInputRequired !== undefined) {
      body['is_user_input_required'] = options.userInputRequired;
    }

    if (options.backgroundColor !== undefined) {
      body['background_color'] = options.backgroundColor;
    }

    if (options.maxPerStream !== undefined) {
      body['max_per_stream'] = options.maxPerStream;
    }

    if (options.maxPerUserPerStream !== undefined) {
      body['max_per_user_per_stream'] = options.maxPerUserPerStream;
    }

    if (options.globalCooldownSeconds !== undefined) {
      body['global_cooldown_seconds'] = options.globalCooldownSeconds;
    }

    if (options.isGlobalCooldownEnabled !== undefined) {
      body['is_global_cooldown_enabled'] = options.isGlobalCooldownEnabled;
    }

    if (options.isMaxPerStreamEnabled !== undefined) {
      body['is_max_per_stream_enabled'] = options.isMaxPerStreamEnabled;
    }

    if (options.isMaxPerUserPerStreamEnabled !== undefined) {
      body['is_max_per_user_per_stream_enabled'] =
        options.isMaxPerUserPerStreamEnabled;
    }

    const url = new URL(
      'https://api.twitch.tv/helix/channel_points/custom_rewards',
    );

    url.searchParams.set('broadcaster_id', this.currentUser.id);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error('Failed to create custom reward:', await response.text());

      return null;
    }

    const data = await response.json();

    return data.data[0] ?? null;
  }

  async updateCustomReward(
    rewardId: string,
    updates: Record<string, any>,
  ): Promise<any | null> {
    if (!this.accessToken || !this.currentUser) {
      return null;
    }

    const url = new URL(
      'https://api.twitch.tv/helix/channel_points/custom_rewards',
    );

    url.searchParams.set('broadcaster_id', this.currentUser.id);

    url.searchParams.set('id', rewardId);

    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      console.error('Failed to update custom reward:', await response.text());

      return null;
    }

    const data = await response.json();

    return data.data[0] ?? null;
  }

  async deleteCustomReward(rewardId: string): Promise<boolean> {
    if (!this.accessToken || !this.currentUser) {
      return false;
    }

    const url = new URL(
      'https://api.twitch.tv/helix/channel_points/custom_rewards',
    );

    url.searchParams.set('broadcaster_id', this.currentUser.id);

    url.searchParams.set('id', rewardId);

    const response = await fetch(url.toString(), {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
      },
    });

    if (!response.ok) {
      console.error('Failed to delete custom reward:', await response.text());

      return false;
    }

    return true;
  }

  async updateRedemptionStatus(
    rewardId: string,
    redemptionIds: string[],
    status: 'FULFILLED' | 'CANCELED',
  ): Promise<boolean> {
    if (!this.accessToken || !this.currentUser) {
      return false;
    }

    const url = new URL(
      'https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions',
    );

    url.searchParams.set('broadcaster_id', this.currentUser.id);

    url.searchParams.set('reward_id', rewardId);

    for (const redemptionId of redemptionIds) {
      url.searchParams.append('id', redemptionId);
    }

    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status,
      }),
    });

    if (!response.ok) {
      console.error('Failed to update redemption:', await response.text());

      return false;
    }

    return true;
  }

  async getStreamInfo(): Promise<any | null> {
    if (!this.accessToken || !this.currentUser) {
      return null;
    }

    const url = new URL('https://api.twitch.tv/helix/streams');

    url.searchParams.set('user_id', this.currentUser.id);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
      },
    });

    if (!response.ok) {
      console.error('Failed to get stream info:', await response.text());

      return null;
    }

    const data = await response.json();

    return data.data[0] ?? null;
  }

  async createPoll(
    title: string,
    choices: string[],
    durationSeconds = 60,
  ): Promise<any | null> {
    if (!this.accessToken || !this.currentUser) {
      return null;
    }

    const url = new URL('https://api.twitch.tv/helix/polls');

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        broadcaster_id: this.currentUser.id,
        title,
        choices: choices.map((title) => ({
          title,
        })),
        duration: durationSeconds,
      }),
    });

    if (!response.ok) {
      console.error('Failed to create poll:', await response.text());

      return null;
    }

    const data = await response.json();

    return data.data[0] ?? null;
  }

  async endPoll(
    pollId: string,
    status: 'TERMINATED' | 'ARCHIVED',
  ): Promise<boolean> {
    if (!this.accessToken || !this.currentUser) {
      return false;
    }

    const url = new URL('https://api.twitch.tv/helix/polls');

    url.searchParams.set('broadcaster_id', this.currentUser.id);

    url.searchParams.set('id', pollId);

    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status,
      }),
    });

    if (!response.ok) {
      console.error('Failed to end poll:', await response.text());

      return false;
    }

    return true;
  }

  async createPrediction(
    title: string,
    outcomes: string[],
    durationSeconds = 120,
  ): Promise<any | null> {
    if (!this.accessToken || !this.currentUser) {
      return null;
    }

    const response = await fetch('https://api.twitch.tv/helix/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        broadcaster_id: this.currentUser.id,
        title,
        outcomes: outcomes.map((title) => ({ title })),
        prediction_window: durationSeconds,
      }),
    });

    if (!response.ok) {
      console.error('Failed to create prediction:', await response.text());

      return null;
    }

    const data = await response.json();

    return data.data[0] ?? null;
  }

  async resolvePrediction(
    predictionId: string,
    status: 'RESOLVED' | 'CANCELED' | 'LOCKED',
    winningOutcomeId?: string,
  ): Promise<boolean> {
    if (!this.accessToken || !this.currentUser) {
      return false;
    }

    const body: Record<string, string> = {
      id: predictionId,
      broadcaster_id: this.currentUser.id,
      status,
    };

    if (winningOutcomeId) {
      body['winning_outcome_id'] = winningOutcomeId;
    }

    const response = await fetch('https://api.twitch.tv/helix/predictions', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error('Failed to update prediction:', await response.text());

      return false;
    }

    return true;
  }

  getUser(): TwitchUser | null {
    return this.currentUser;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  disconnect(): void {
    this.socket?.close();

    this.socket = null;
    this.accessToken = null;
    this.currentUser = null;

    this.connectedSubject.next(false);
    this.streamStateSubject.next('offline');
  }
}
