import { TwitchAuthService } from '../auth/twitch-auth.service';
import { TwitchOAuthConfig } from '../config/runtime-config';
import { ChatSettingsUpdate } from '../../../shared/contracts/automation';
import { ChannelPointReward } from '../../../shared/contracts/rewards';
import {
  CustomRewardCreateRequest,
  CustomRewardUpdateRequest,
  TwitchStreamInfo,
} from '../../../shared/contracts/twitch-operations';

interface TwitchHelixUserResponse {
  data: Array<{
    display_name: string;
    id: string;
    login: string;
    profile_image_url: string;
  }>;
}

export interface TwitchCurrentUser {
  displayName: string;
  id: string;
  login: string;
  profileImageUrl: string;
}

export interface TwitchChatMessageRequest {
  broadcasterId: string;
  message: string;
  senderId: string;
}

export interface TwitchUserTimeoutRequest {
  broadcasterId: string;
  durationSeconds: number;
  moderatorId: string;
  reason?: string;
  userId: string;
}

export interface TwitchChannelVipRequest {
  broadcasterId: string;
  userId: string;
}

export interface TwitchBanUserRequest {
  broadcasterId: string;
  moderatorId: string;
  reason?: string;
  userId: string;
}

export interface TwitchDeleteChatMessageRequest {
  broadcasterId: string;
  messageId: string;
  moderatorId: string;
}

export interface TwitchChatSettingsRequest {
  broadcasterId: string;
  moderatorId: string;
  settings: ChatSettingsUpdate;
}

export interface TwitchShoutoutRequest {
  fromBroadcasterId: string;
  moderatorId: string;
  targetBroadcasterId: string;
}

export interface TwitchRedemptionStatusRequest {
  broadcasterId: string;
  redemptionIds: string[];
  rewardId: string;
  status: 'CANCELED' | 'FULFILLED';
}

export interface TwitchCreatePollRequest {
  broadcasterId: string;
  choices: string[];
  durationSeconds: number;
  title: string;
}

export interface TwitchEndPollRequest {
  broadcasterId: string;
  pollId: string;
  status: 'ARCHIVED' | 'TERMINATED';
}

export interface TwitchCreatePredictionRequest {
  broadcasterId: string;
  durationSeconds: number;
  outcomes: string[];
  title: string;
}

export interface TwitchResolvePredictionRequest {
  broadcasterId: string;
  predictionId: string;
  status: 'CANCELED' | 'LOCKED' | 'RESOLVED';
  winningOutcomeId?: string;
}

export interface TwitchRewardListRequest {
  broadcasterId: string;
  onlyManageableRewards?: boolean;
}

interface TwitchChatMessageResponse {
  data: Array<{
    drop_reason: { code: string; message: string } | null;
    is_sent: boolean;
    message_id: string;
  }>;
}

interface TwitchCreatedResourceResponse {
  data: Array<{ id: string }>;
}

interface TwitchRewardListResponse {
  data: Array<{
    background_color: string | null;
    cost: number;
    global_cooldown_setting: {
      global_cooldown_seconds: number;
      is_enabled: boolean;
    } | null;
    id: string;
    is_enabled: boolean;
    is_user_input_required: boolean;
    max_per_stream_setting: {
      is_enabled: boolean;
      max_per_stream: number;
    } | null;
    max_per_user_per_stream_setting: {
      is_enabled: boolean;
      max_per_user_per_stream: number;
    } | null;
    prompt: string;
    title: string;
  }>;
}

interface TwitchStreamListResponse {
  data: Array<{
    game_id: string;
    game_name: string;
    id: string;
    language: string;
    started_at: string;
    thumbnail_url: string;
    title: string;
    user_id: string;
    user_login: string;
    user_name: string;
    viewer_count: number;
  }>;
}

export class TwitchApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export class TwitchApiClient {
  constructor(
    private readonly config: TwitchOAuthConfig,
    private readonly twitchAuth: TwitchAuthService,
  ) {}

  async getCurrentUser(): Promise<TwitchCurrentUser> {
    const response = await this.request<TwitchHelixUserResponse>('/users');
    const user = response.data[0];

    if (!user) {
      throw new TwitchApiError('Twitch did not return the authenticated user.', 200);
    }

    return {
      id: user.id,
      login: user.login,
      displayName: user.display_name,
      profileImageUrl: user.profile_image_url,
    };
  }

  async getUserIdByLogin(login: string): Promise<string> {
    const parameters = new URLSearchParams({ login });
    const response = await this.request<TwitchHelixUserResponse>(
      `/users?${parameters}`,
    );
    const user = response.data[0];

    if (!user) {
      throw new TwitchApiError(`Twitch user "${login}" was not found.`, 404);
    }

    return user.id;
  }

  async getCustomRewards({
    broadcasterId,
    onlyManageableRewards = true,
  }: TwitchRewardListRequest): Promise<ChannelPointReward[]> {
    const parameters = new URLSearchParams({
      broadcaster_id: broadcasterId,
      only_manageable_rewards: String(onlyManageableRewards),
    });
    const response = await this.request<TwitchRewardListResponse>(
      `/channel_points/custom_rewards?${parameters}`,
    );

    return response.data.map(normalizeReward);
  }

  async getCustomReward(
    broadcasterId: string,
    rewardId: string,
  ): Promise<ChannelPointReward> {
    const parameters = new URLSearchParams({
      broadcaster_id: broadcasterId,
      id: rewardId,
    });
    const response = await this.request<TwitchRewardListResponse>(
      `/channel_points/custom_rewards?${parameters}`,
    );

    return readRewardResponse(response);
  }

  async createCustomReward(
    broadcasterId: string,
    reward: CustomRewardCreateRequest,
  ): Promise<ChannelPointReward> {
    const parameters = new URLSearchParams({ broadcaster_id: broadcasterId });
    const response = await this.request<TwitchRewardListResponse>(
      `/channel_points/custom_rewards?${parameters}`,
      {
        body: JSON.stringify(createCustomRewardBody(reward)),
        method: 'POST',
      },
    );

    return readRewardResponse(response);
  }

  async updateCustomReward(
    broadcasterId: string,
    rewardId: string,
    updates: CustomRewardUpdateRequest,
  ): Promise<ChannelPointReward> {
    const parameters = new URLSearchParams({
      broadcaster_id: broadcasterId,
      id: rewardId,
    });
    const response = await this.request<TwitchRewardListResponse>(
      `/channel_points/custom_rewards?${parameters}`,
      {
        body: JSON.stringify(createCustomRewardBody(updates)),
        method: 'PATCH',
      },
    );

    return readRewardResponse(response);
  }

  async deleteCustomReward(
    broadcasterId: string,
    rewardId: string,
  ): Promise<void> {
    const parameters = new URLSearchParams({
      broadcaster_id: broadcasterId,
      id: rewardId,
    });

    await this.request<undefined>(
      `/channel_points/custom_rewards?${parameters}`,
      { method: 'DELETE' },
    );
  }

  async getStreamInfo(broadcasterId: string): Promise<TwitchStreamInfo | null> {
    const parameters = new URLSearchParams({ user_id: broadcasterId });
    const response = await this.request<TwitchStreamListResponse>(
      `/streams?${parameters}`,
    );
    const stream = response.data[0];

    return stream
      ? {
          gameId: stream.game_id,
          gameName: stream.game_name,
          id: stream.id,
          language: stream.language,
          startedAt: stream.started_at,
          thumbnailUrl: stream.thumbnail_url,
          title: stream.title,
          userId: stream.user_id,
          userLogin: stream.user_login,
          userName: stream.user_name,
          viewerCount: stream.viewer_count,
        }
      : null;
  }

  async createEventSubSubscription(
    subscription: {
      condition: Record<string, string>;
      type: string;
      version: string;
    },
    sessionId: string,
  ): Promise<void> {
    await this.requestUrl<undefined>(
      this.config.eventSubSubscriptionsUrl,
      {
        method: 'POST',
        body: JSON.stringify({
          ...subscription,
          transport: {
            method: 'websocket',
            session_id: sessionId,
          },
        }),
      },
    );
  }

  async banUser({
    broadcasterId,
    moderatorId,
    reason,
    userId,
  }: TwitchBanUserRequest): Promise<void> {
    const data: { reason?: string; user_id: string } = { user_id: userId };

    if (reason) {
      data.reason = reason;
    }

    await this.request<undefined>(
      `/moderation/bans?${createModerationParameters(broadcasterId, moderatorId)}`,
      {
        body: JSON.stringify({ data }),
        method: 'POST',
      },
    );
  }

  async addChannelVip({ broadcasterId, userId }: TwitchChannelVipRequest): Promise<void> {
    const parameters = new URLSearchParams({
      broadcaster_id: broadcasterId,
      user_id: userId,
    });

    await this.request<undefined>(`/channels/vips?${parameters}`, {
      method: 'POST',
    });
  }

  async createPoll({
    broadcasterId,
    choices,
    durationSeconds,
    title,
  }: TwitchCreatePollRequest): Promise<string> {
    const response = await this.request<TwitchCreatedResourceResponse>('/polls', {
      body: JSON.stringify({
        broadcaster_id: broadcasterId,
        choices: choices.map((choice) => ({ title: choice })),
        duration: durationSeconds,
        title,
      }),
      method: 'POST',
    });

    return readCreatedResourceId(response, 'poll');
  }

  async createPrediction({
    broadcasterId,
    durationSeconds,
    outcomes,
    title,
  }: TwitchCreatePredictionRequest): Promise<string> {
    const response = await this.request<TwitchCreatedResourceResponse>(
      '/predictions',
      {
        body: JSON.stringify({
          broadcaster_id: broadcasterId,
          outcomes: outcomes.map((outcome) => ({ title: outcome })),
          prediction_window: durationSeconds,
          title,
        }),
        method: 'POST',
      },
    );

    return readCreatedResourceId(response, 'prediction');
  }

  async deleteChatMessage({
    broadcasterId,
    messageId,
    moderatorId,
  }: TwitchDeleteChatMessageRequest): Promise<void> {
    const parameters = createModerationParameters(broadcasterId, moderatorId);
    parameters.set('message_id', messageId);

    await this.request<undefined>(`/moderation/chat?${parameters}`, {
      method: 'DELETE',
    });
  }

  async endPoll({
    broadcasterId,
    pollId,
    status,
  }: TwitchEndPollRequest): Promise<void> {
    const parameters = new URLSearchParams({
      broadcaster_id: broadcasterId,
      id: pollId,
    });

    await this.request<undefined>(`/polls?${parameters}`, {
      body: JSON.stringify({ status }),
      method: 'PATCH',
    });
  }

  async sendChatMessage({
    broadcasterId,
    message,
    senderId,
  }: TwitchChatMessageRequest): Promise<string> {
    const response = await this.request<TwitchChatMessageResponse>(
      '/chat/messages',
      {
        body: JSON.stringify({
          broadcaster_id: broadcasterId,
          message,
          sender_id: senderId,
        }),
        method: 'POST',
      },
    );
    const result = response.data[0];

    if (!result) {
      throw new TwitchApiError(
        'Twitch did not return a chat message result.',
        200,
      );
    }

    if (!result.is_sent) {
      throw new TwitchApiError(
        result.drop_reason?.message ?? 'Twitch did not send the chat message.',
        200,
      );
    }

    return result.message_id;
  }

  async sendShoutout({
    fromBroadcasterId,
    moderatorId,
    targetBroadcasterId,
  }: TwitchShoutoutRequest): Promise<void> {
    const parameters = new URLSearchParams({
      from_broadcaster_id: fromBroadcasterId,
      moderator_id: moderatorId,
      to_broadcaster_id: targetBroadcasterId,
    });

    await this.request<undefined>(`/chat/shoutouts?${parameters}`, {
      method: 'POST',
    });
  }

  async timeoutUser({
    broadcasterId,
    durationSeconds,
    moderatorId,
    reason,
    userId,
  }: TwitchUserTimeoutRequest): Promise<void> {
    const data: { duration: number; reason?: string; user_id: string } = {
      duration: durationSeconds,
      user_id: userId,
    };

    if (reason) {
      data.reason = reason;
    }

    const parameters = new URLSearchParams({
      broadcaster_id: broadcasterId,
      moderator_id: moderatorId,
    });

    await this.request<undefined>(`/moderation/bans?${parameters}`, {
      body: JSON.stringify({ data }),
      method: 'POST',
    });
  }

  async unbanUser({
    broadcasterId,
    moderatorId,
    userId,
  }: TwitchBanUserRequest): Promise<void> {
    const parameters = createModerationParameters(broadcasterId, moderatorId);
    parameters.set('user_id', userId);

    await this.request<undefined>(`/moderation/bans?${parameters}`, {
      method: 'DELETE',
    });
  }

  async updateChatSettings({
    broadcasterId,
    moderatorId,
    settings,
  }: TwitchChatSettingsRequest): Promise<void> {
    const body: Record<string, boolean | number> = {};

    if (settings.emoteMode !== undefined) {
      body['emote_mode'] = settings.emoteMode;
    }

    if (settings.followerMode !== undefined) {
      body['follower_mode'] = settings.followerMode;
    }

    if (settings.followerModeDurationMinutes !== undefined) {
      body['follower_mode_duration'] = settings.followerModeDurationMinutes;
    }

    if (settings.slowMode !== undefined) {
      body['slow_mode'] = settings.slowMode;
    }

    if (settings.slowModeWaitTimeSeconds !== undefined) {
      body['slow_mode_wait_time'] = settings.slowModeWaitTimeSeconds;
    }

    if (settings.subscriberMode !== undefined) {
      body['subscriber_mode'] = settings.subscriberMode;
    }

    await this.request<undefined>(
      `/chat/settings?${createModerationParameters(broadcasterId, moderatorId)}`,
      {
        body: JSON.stringify(body),
        method: 'PATCH',
      },
    );
  }

  async updateRedemptionStatus({
    broadcasterId,
    redemptionIds,
    rewardId,
    status,
  }: TwitchRedemptionStatusRequest): Promise<void> {
    const parameters = new URLSearchParams({
      broadcaster_id: broadcasterId,
      reward_id: rewardId,
    });

    for (const redemptionId of redemptionIds) {
      parameters.append('id', redemptionId);
    }

    await this.request<undefined>(
      `/channel_points/custom_rewards/redemptions?${parameters}`,
      {
        body: JSON.stringify({ status }),
        method: 'PATCH',
      },
    );
  }

  async resolvePrediction({
    broadcasterId,
    predictionId,
    status,
    winningOutcomeId,
  }: TwitchResolvePredictionRequest): Promise<void> {
    const body: {
      broadcaster_id: string;
      id: string;
      status: TwitchResolvePredictionRequest['status'];
      winning_outcome_id?: string;
    } = {
      broadcaster_id: broadcasterId,
      id: predictionId,
      status,
    };

    if (winningOutcomeId) {
      body.winning_outcome_id = winningOutcomeId;
    }

    await this.request<undefined>('/predictions', {
      body: JSON.stringify(body),
      method: 'PATCH',
    });
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    return this.requestUrl(`${this.config.helixUrl}${path}`, options);
  }

  private async requestUrl<T>(
    url: string,
    options: RequestInit = {},
  ): Promise<T> {
    const accessToken = await this.twitchAuth.getAccessToken();

    if (!accessToken) {
      throw new TwitchApiError('Twitch authorization is required.', 401);
    }

    let response = await this.sendRequest(accessToken, url, options);

    if (response.status === 401) {
      const refreshedAccessToken = await this.twitchAuth.refreshAccessToken();

      if (!refreshedAccessToken) {
        throw new TwitchApiError('Twitch authorization is required.', 401);
      }

      response = await this.sendRequest(refreshedAccessToken, url, options);
    }

    const text = await response.text();

    if (!response.ok) {
      const upstreamMessage = getUpstreamErrorMessage(text);
      throw new TwitchApiError(
        `Twitch API request failed with status ${response.status}${upstreamMessage ? `: ${upstreamMessage}` : '.'}`,
        response.status,
      );
    }

    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  private async sendRequest(
    accessToken: string,
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    let response: Response;

    try {
      response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Client-Id': this.config.clientId,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    } catch {
      throw new TwitchApiError('Unable to reach the Twitch Helix API.', null);
    }

    return response;
  }
}

function getUpstreamErrorMessage(text: string): string | null {
  try {
    const payload: unknown = JSON.parse(text);

    if (
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof payload.message === 'string'
    ) {
      return payload.message;
    }
  } catch {
    return null;
  }

  return null;
}

function createModerationParameters(
  broadcasterId: string,
  moderatorId: string,
): URLSearchParams {
  return new URLSearchParams({
    broadcaster_id: broadcasterId,
    moderator_id: moderatorId,
  });
}

function readCreatedResourceId(
  response: TwitchCreatedResourceResponse,
  resourceName: string,
): string {
  const id = response.data[0]?.id;

  if (!id) {
    throw new TwitchApiError(`Twitch did not return a ${resourceName} ID.`, 200);
  }

  return id;
}

function createCustomRewardBody(
  reward: CustomRewardCreateRequest | CustomRewardUpdateRequest,
): Record<string, boolean | number | string> {
  const body: Record<string, boolean | number | string> = {};
  const fields: Array<[keyof typeof reward, string]> = [
    ['backgroundColor', 'background_color'],
    ['cost', 'cost'],
    ['enabled', 'is_enabled'],
    ['globalCooldownSeconds', 'global_cooldown_seconds'],
    ['isGlobalCooldownEnabled', 'is_global_cooldown_enabled'],
    ['isMaxPerStreamEnabled', 'is_max_per_stream_enabled'],
    ['isMaxPerUserPerStreamEnabled', 'is_max_per_user_per_stream_enabled'],
    ['maxPerStream', 'max_per_stream'],
    ['maxPerUserPerStream', 'max_per_user_per_stream'],
    ['prompt', 'prompt'],
    ['title', 'title'],
    ['userInputRequired', 'is_user_input_required'],
  ];

  for (const [sourceKey, targetKey] of fields) {
    const value = reward[sourceKey];

    if (value !== undefined) {
      body[targetKey] = value;
    }
  }

  return body;
}

function normalizeReward(
  reward: TwitchRewardListResponse['data'][number],
): ChannelPointReward {
  return {
    backgroundColor: reward.background_color,
    cost: reward.cost,
    globalCooldownSeconds:
      reward.global_cooldown_setting?.is_enabled
        ? reward.global_cooldown_setting.global_cooldown_seconds
        : null,
    id: reward.id,
    isEnabled: reward.is_enabled,
    isUserInputRequired: reward.is_user_input_required,
    maxPerStream:
      reward.max_per_stream_setting?.is_enabled
        ? reward.max_per_stream_setting.max_per_stream
        : null,
    maxPerUserPerStream:
      reward.max_per_user_per_stream_setting?.is_enabled
        ? reward.max_per_user_per_stream_setting.max_per_user_per_stream
        : null,
    prompt: reward.prompt || null,
    title: reward.title,
  };
}

function readRewardResponse(response: TwitchRewardListResponse): ChannelPointReward {
  const reward = response.data[0];

  if (!reward) {
    throw new TwitchApiError('Twitch did not return a custom reward.', 200);
  }

  return normalizeReward(reward);
}
