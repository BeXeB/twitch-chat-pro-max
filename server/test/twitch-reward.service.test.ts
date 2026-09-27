import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RefreshTokenStore } from '../src/auth/refresh-token-store';
import { TwitchAuthService } from '../src/auth/twitch-auth.service';
import { TwitchOAuthConfig } from '../src/config/runtime-config';
import { TwitchRewardService } from '../src/features/rewards/twitch-reward.service';
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
  frontendOrigin: 'http://localhost:4200',
  helixUrl: 'https://api.example.test/helix',
  redirectUri: 'http://127.0.0.1:4300/api/auth/twitch/callback',
  scopes: [],
};

test('synchronizes and normalizes manageable channel-point rewards', async () => {
  const twitchAuth = new TwitchAuthService(config, new MemoryRefreshTokenStore());
  const twitchApi = new TwitchApiClient(config, twitchAuth);
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];

  globalThis.fetch = (async (input) => {
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

    requests.push(url);
    return jsonResponse({
      data: [
        {
          background_color: '#00ff00',
          cost: 1000,
          global_cooldown: { is_enabled: true, seconds: 30 },
          id: 'reward-1',
          is_enabled: true,
          is_user_input_required: false,
          max_per_stream: { is_enabled: false, max_per_stream: 0 },
          prompt: '',
          title: 'Highlight message',
        },
      ],
    });
  }) as typeof fetch;

  try {
    const authorizationUrl = new URL(twitchAuth.createAuthorizationUrl());
    const state = authorizationUrl.searchParams.get('state');

    assert.ok(state);
    await twitchAuth.completeAuthorization('authorization-code', state);
    const rewards = new TwitchRewardService(() =>
      twitchApi.getCustomRewards({ broadcasterId: 'broadcaster-1' }),
    );

    assert.deepEqual(rewards.list(), []);
    assert.deepEqual(await rewards.sync(), [
      {
        backgroundColor: '#00ff00',
        cost: 1000,
        globalCooldownSeconds: 30,
        id: 'reward-1',
        isEnabled: true,
        isUserInputRequired: false,
        maxPerStream: null,
        prompt: null,
        title: 'Highlight message',
      },
    ]);
    assert.deepEqual(requests, [
      'https://api.example.test/helix/channel_points/custom_rewards?broadcaster_id=broadcaster-1&only_manageable_rewards=true',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}
