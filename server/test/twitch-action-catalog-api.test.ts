import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RefreshTokenStore } from '../src/auth/refresh-token-store';
import { TwitchAuthService } from '../src/auth/twitch-auth.service';
import { TwitchOAuthConfig } from '../src/config/runtime-config';
import { TwitchOperationsService } from '../src/features/twitch-operations/twitch-operations.service';
import { TwitchApiClient } from '../src/twitch/twitch-api.client';

class MemoryRefreshTokenStore implements RefreshTokenStore {
  async clear(): Promise<void> {}

  async load(): Promise<string | null> {
    return null;
  }

  async save(): Promise<void> {}
}

const config: TwitchOAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  eventSubUrl: 'wss://eventsub.example.test/ws',
  eventSubSubscriptionsUrl:
    'https://api.example.test/helix/eventsub/subscriptions',
  frontendOrigin: 'http://localhost:4200',
  helixUrl: 'https://api.example.test/helix',
  redirectUri: 'http://127.0.0.1:4300/api/auth/twitch/callback',
  scopes: [],
};

test('resolves an entered Twitch login before timing out its user', async () => {
  const twitchAuth = new TwitchAuthService(config, new MemoryRefreshTokenStore());
  const twitchApi = new TwitchApiClient(config, twitchAuth);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: unknown; method: string; url: string }> = [];

  globalThis.fetch = (async (input, init) => {
    const url = String(input);

    if (url === 'https://id.twitch.tv/oauth2/token') {
      return jsonResponse({
        access_token: 'access-token',
        expires_in: 3600,
        refresh_token: 'refresh-token',
        scope: [],
        token_type: 'bearer',
      });
    }

    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      method: init?.method ?? 'GET',
      url,
    });

    return url === 'https://api.example.test/helix/users?login=target_user'
      ? jsonResponse({ data: [{ id: 'target-user-id' }] })
      : jsonResponse({ data: [] });
  }) as typeof fetch;

  try {
    const authorizationUrl = new URL(twitchAuth.createAuthorizationUrl());
    const state = authorizationUrl.searchParams.get('state');

    assert.ok(state);
    await twitchAuth.completeAuthorization('authorization-code', state);

    const operations = new TwitchOperationsService(() => ({
      api: twitchApi,
      broadcaster: {
        displayName: 'Streamer',
        id: 'broadcaster',
        login: 'streamer',
        profileImageUrl: 'https://example.test/avatar.png',
      },
    }));

    await operations.timeoutUser(' @target_user @ ', 60, 'Streamer volt!');

    assert.deepEqual(requests, [
      {
        body: null,
        method: 'GET',
        url: 'https://api.example.test/helix/users?login=target_user',
      },
      {
        body: {
          data: {
            duration: 60,
            reason: 'Streamer volt!',
            user_id: 'target-user-id',
          },
        },
        method: 'POST',
        url: 'https://api.example.test/helix/moderation/bans?broadcaster_id=broadcaster&moderator_id=broadcaster',
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sends the complete action catalog through typed Helix requests', async () => {
  const twitchAuth = new TwitchAuthService(config, new MemoryRefreshTokenStore());
  const twitchApi = new TwitchApiClient(config, twitchAuth);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: unknown; method: string; url: string }> = [];

  globalThis.fetch = (async (input, init) => {
    const url = String(input);

    if (url === 'https://id.twitch.tv/oauth2/token') {
      return jsonResponse({
        access_token: 'access-token',
        expires_in: 3600,
        refresh_token: 'refresh-token',
        scope: [],
        token_type: 'bearer',
      });
    }

    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      method: init?.method ?? 'GET',
      url,
    });

    if (url === 'https://api.example.test/helix/polls') {
      return jsonResponse({ data: [{ id: 'poll-1' }] });
    }

    if (url === 'https://api.example.test/helix/predictions') {
      return jsonResponse({ data: [{ id: 'prediction-1' }] });
    }

    return jsonResponse({ data: [] });
  }) as typeof fetch;

  try {
    const authorizationUrl = new URL(twitchAuth.createAuthorizationUrl());
    const state = authorizationUrl.searchParams.get('state');

    assert.ok(state);
    await twitchAuth.completeAuthorization('authorization-code', state);

    await twitchApi.banUser({
      broadcasterId: 'broadcaster',
      moderatorId: 'moderator',
      reason: 'Rule violation',
      userId: 'user',
    });
    await twitchApi.addChannelVip({
      broadcasterId: 'broadcaster',
      userId: 'vip-user',
    });
    await twitchApi.unbanUser({
      broadcasterId: 'broadcaster',
      moderatorId: 'moderator',
      userId: 'user',
    });
    await twitchApi.deleteChatMessage({
      broadcasterId: 'broadcaster',
      messageId: 'message',
      moderatorId: 'moderator',
    });
    await twitchApi.updateChatSettings({
      broadcasterId: 'broadcaster',
      moderatorId: 'moderator',
      settings: { slowMode: true, slowModeWaitTimeSeconds: 15 },
    });
    await twitchApi.sendShoutout({
      fromBroadcasterId: 'broadcaster',
      moderatorId: 'moderator',
      targetBroadcasterId: 'target',
    });
    await twitchApi.updateRedemptionStatus({
      broadcasterId: 'broadcaster',
      redemptionIds: ['redemption-1', 'redemption-2'],
      rewardId: 'reward',
      status: 'FULFILLED',
    });
    assert.equal(
      await twitchApi.createPoll({
        broadcasterId: 'broadcaster',
        choices: ['Blue', 'Green'],
        durationSeconds: 60,
        title: 'Best color?',
      }),
      'poll-1',
    );
    await twitchApi.endPoll({
      broadcasterId: 'broadcaster',
      pollId: 'poll-1',
      status: 'ARCHIVED',
    });
    assert.equal(
      await twitchApi.createPrediction({
        broadcasterId: 'broadcaster',
        durationSeconds: 60,
        outcomes: ['Yes', 'No'],
        title: 'Will it work?',
      }),
      'prediction-1',
    );
    await twitchApi.resolvePrediction({
      broadcasterId: 'broadcaster',
      predictionId: 'prediction-1',
      status: 'RESOLVED',
      winningOutcomeId: 'outcome-1',
    });

    assert.deepEqual(requests, [
      {
        body: { data: { reason: 'Rule violation', user_id: 'user' } },
        method: 'POST',
        url: 'https://api.example.test/helix/moderation/bans?broadcaster_id=broadcaster&moderator_id=moderator',
      },
      {
        body: null,
        method: 'POST',
        url: 'https://api.example.test/helix/channels/vips?broadcaster_id=broadcaster&user_id=vip-user',
      },
      {
        body: null,
        method: 'DELETE',
        url: 'https://api.example.test/helix/moderation/bans?broadcaster_id=broadcaster&moderator_id=moderator&user_id=user',
      },
      {
        body: null,
        method: 'DELETE',
        url: 'https://api.example.test/helix/moderation/chat?broadcaster_id=broadcaster&moderator_id=moderator&message_id=message',
      },
      {
        body: { slow_mode: true, slow_mode_wait_time: 15 },
        method: 'PATCH',
        url: 'https://api.example.test/helix/chat/settings?broadcaster_id=broadcaster&moderator_id=moderator',
      },
      {
        body: null,
        method: 'POST',
        url: 'https://api.example.test/helix/chat/shoutouts?from_broadcaster_id=broadcaster&moderator_id=moderator&to_broadcaster_id=target',
      },
      {
        body: { status: 'FULFILLED' },
        method: 'PATCH',
        url: 'https://api.example.test/helix/channel_points/custom_rewards/redemptions?broadcaster_id=broadcaster&reward_id=reward&id=redemption-1&id=redemption-2',
      },
      {
        body: {
          broadcaster_id: 'broadcaster',
          choices: [{ title: 'Blue' }, { title: 'Green' }],
          duration: 60,
          title: 'Best color?',
        },
        method: 'POST',
        url: 'https://api.example.test/helix/polls',
      },
      {
        body: { status: 'ARCHIVED' },
        method: 'PATCH',
        url: 'https://api.example.test/helix/polls?broadcaster_id=broadcaster&id=poll-1',
      },
      {
        body: {
          broadcaster_id: 'broadcaster',
          outcomes: [{ title: 'Yes' }, { title: 'No' }],
          prediction_window: 60,
          title: 'Will it work?',
        },
        method: 'POST',
        url: 'https://api.example.test/helix/predictions',
      },
      {
        body: {
          broadcaster_id: 'broadcaster',
          id: 'prediction-1',
          status: 'RESOLVED',
          winning_outcome_id: 'outcome-1',
        },
        method: 'PATCH',
        url: 'https://api.example.test/helix/predictions',
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('increments a reward cost for every serialized redemption', async () => {
  const twitchAuth = new TwitchAuthService(config, new MemoryRefreshTokenStore());
  const twitchApi = new TwitchApiClient(config, twitchAuth);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: unknown; method: string; url: string }> = [];
  let currentCost = 6400;

  globalThis.fetch = (async (input, init) => {
    const url = String(input);

    if (url === 'https://id.twitch.tv/oauth2/token') {
      return jsonResponse({
        access_token: 'access-token',
        expires_in: 3600,
        refresh_token: 'refresh-token',
        scope: [],
        token_type: 'bearer',
      });
    }

    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ body, method, url });

    if (method === 'PATCH') {
      currentCost = (body as { cost: number }).cost;
    }

    return jsonResponse({
      data: [{ ...rewardResponse('vip-reward'), cost: currentCost }],
    });
  }) as typeof fetch;

  try {
    const authorizationUrl = new URL(twitchAuth.createAuthorizationUrl());
    const state = authorizationUrl.searchParams.get('state');

    assert.ok(state);
    await twitchAuth.completeAuthorization('authorization-code', state);

    const operations = new TwitchOperationsService(() => ({
      api: twitchApi,
      broadcaster: {
        displayName: 'Streamer',
        id: 'broadcaster',
        login: 'streamer',
        profileImageUrl: 'https://example.test/avatar.png',
      },
    }));

    const updatedRewards = await Promise.all([
      operations.increaseCustomRewardCost('vip-reward', 8000),
      operations.increaseCustomRewardCost('vip-reward', 8000),
    ]);

    assert.deepEqual(updatedRewards.map((reward) => reward.cost), [14400, 22400]);
    assert.deepEqual(
      requests.map(({ body, method }) => [method, body]),
      [
        ['GET', null],
        ['PATCH', { cost: 14400 }],
        ['GET', null],
        ['PATCH', { cost: 22400 }],
      ],
    );
    assert.ok(
      requests.every(
        ({ url }) =>
          url ===
          'https://api.example.test/helix/channel_points/custom_rewards?broadcaster_id=broadcaster&id=vip-reward',
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('manages custom rewards and reads stream metadata through Helix', async () => {
  const twitchAuth = new TwitchAuthService(config, new MemoryRefreshTokenStore());
  const twitchApi = new TwitchApiClient(config, twitchAuth);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: unknown; method: string; url: string }> = [];

  globalThis.fetch = (async (input, init) => {
    const url = String(input);

    if (url === 'https://id.twitch.tv/oauth2/token') {
      return jsonResponse({
        access_token: 'access-token',
        expires_in: 3600,
        refresh_token: 'refresh-token',
        scope: [],
        token_type: 'bearer',
      });
    }

    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      method: init?.method ?? 'GET',
      url,
    });

    if (url.includes('/channel_points/custom_rewards')) {
      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      return jsonResponse({ data: [rewardResponse('reward-1')] });
    }

    if (url === 'https://api.example.test/helix/streams?user_id=broadcaster') {
      return jsonResponse({
        data: [
          {
            game_id: 'game-1',
            game_name: 'Example Game',
            id: 'stream-1',
            language: 'en',
            started_at: '2026-09-27T00:00:00.000Z',
            thumbnail_url: 'https://example.test/{width}x{height}.jpg',
            title: 'Live now',
            user_id: 'broadcaster',
            user_login: 'streamer',
            user_name: 'Streamer',
            viewer_count: 42,
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const authorizationUrl = new URL(twitchAuth.createAuthorizationUrl());
    const state = authorizationUrl.searchParams.get('state');

    assert.ok(state);
    await twitchAuth.completeAuthorization('authorization-code', state);

    const createdReward = await twitchApi.createCustomReward('broadcaster', {
      backgroundColor: '#ff0000',
      cost: 500,
      enabled: true,
      title: 'Highlight',
    });
    const updatedReward = await twitchApi.updateCustomReward(
      'broadcaster',
      'reward-1',
      { cost: 750, prompt: 'Pick a moment' },
    );
    await twitchApi.deleteCustomReward('broadcaster', 'reward-1');
    const stream = await twitchApi.getStreamInfo('broadcaster');

    assert.equal(createdReward.id, 'reward-1');
    assert.equal(updatedReward.cost, 1000);
    assert.deepEqual(stream, {
      gameId: 'game-1',
      gameName: 'Example Game',
      id: 'stream-1',
      language: 'en',
      startedAt: '2026-09-27T00:00:00.000Z',
      thumbnailUrl: 'https://example.test/{width}x{height}.jpg',
      title: 'Live now',
      userId: 'broadcaster',
      userLogin: 'streamer',
      userName: 'Streamer',
      viewerCount: 42,
    });
    assert.deepEqual(requests, [
      {
        body: {
          background_color: '#ff0000',
          cost: 500,
          is_enabled: true,
          title: 'Highlight',
        },
        method: 'POST',
        url: 'https://api.example.test/helix/channel_points/custom_rewards?broadcaster_id=broadcaster',
      },
      {
        body: { cost: 750, prompt: 'Pick a moment' },
        method: 'PATCH',
        url: 'https://api.example.test/helix/channel_points/custom_rewards?broadcaster_id=broadcaster&id=reward-1',
      },
      {
        body: null,
        method: 'DELETE',
        url: 'https://api.example.test/helix/channel_points/custom_rewards?broadcaster_id=broadcaster&id=reward-1',
      },
      {
        body: null,
        method: 'GET',
        url: 'https://api.example.test/helix/streams?user_id=broadcaster',
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function rewardResponse(id: string) {
  return {
    background_color: '#00ff00',
    cost: 1000,
    global_cooldown_setting: null,
    id,
    is_enabled: true,
    is_user_input_required: false,
    max_per_stream_setting: null,
    max_per_user_per_stream_setting: null,
    prompt: '',
    title: 'Highlight message',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}
