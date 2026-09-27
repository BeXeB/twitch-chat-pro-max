import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RefreshTokenStore } from '../src/auth/refresh-token-store';
import { TwitchAuthService } from '../src/auth/twitch-auth.service';
import { TwitchOAuthConfig } from '../src/config/runtime-config';
import { TwitchApiClient } from '../src/twitch/twitch-api.client';

class MemoryRefreshTokenStore implements RefreshTokenStore {
  readonly savedTokens: string[] = [];

  async clear(): Promise<void> {}

  async load(): Promise<string | null> {
    return null;
  }

  async save(refreshToken: string): Promise<void> {
    this.savedTokens.push(refreshToken);
  }
}

const config: TwitchOAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  eventSubUrl: 'wss://eventsub.example.test/ws',
  eventSubSubscriptionsUrl: 'https://api.example.test/helix/eventsub/subscriptions',
  frontendOrigin: 'http://localhost:4200',
  helixUrl: 'https://api.example.test/helix',
  redirectUri: 'http://127.0.0.1:4300/api/auth/twitch/callback',
  scopes: [],
};

test('forces Twitch consent when starting OAuth authorization', () => {
  const twitchAuth = new TwitchAuthService(config, new MemoryRefreshTokenStore());
  const authorizationUrl = new URL(twitchAuth.createAuthorizationUrl());

  assert.equal(authorizationUrl.searchParams.get('force_verify'), 'true');
  assert.equal(authorizationUrl.searchParams.get('scope'), '');
});

test('retries one Helix 401 with a refreshed backend token', async () => {
  const store = new MemoryRefreshTokenStore();
  const twitchAuth = new TwitchAuthService(config, store);
  const twitchApi = new TwitchApiClient(config, twitchAuth);
  const originalFetch = globalThis.fetch;
  const authorizations: string[] = [];
  let helixCalls = 0;
  let oauthCalls = 0;

  globalThis.fetch = (async (input, init) => {
    const url = String(input);

    if (url === 'https://id.twitch.tv/oauth2/token') {
      oauthCalls += 1;
      return jsonResponse({
        access_token: oauthCalls === 1 ? 'initial-access' : 'refreshed-access',
        expires_in: 3600,
        refresh_token: oauthCalls === 1 ? 'initial-refresh' : 'refreshed-refresh',
        scope: [],
        token_type: 'bearer',
      });
    }

    if (url === 'https://api.example.test/helix/users') {
      helixCalls += 1;
      authorizations.push(new Headers(init?.headers).get('Authorization') ?? '');

      if (helixCalls === 1) {
        return new Response('', { status: 401 });
      }

      return jsonResponse({
        data: [
          {
            display_name: 'Streamer',
            id: '1',
            login: 'streamer',
            profile_image_url: 'https://example.test/profile.png',
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

    const user = await twitchApi.getCurrentUser();

    assert.equal(user.displayName, 'Streamer');
    assert.equal(helixCalls, 2);
    assert.equal(oauthCalls, 2);
    assert.deepEqual(authorizations, ['Bearer initial-access', 'Bearer refreshed-access']);
    assert.deepEqual(store.savedTokens, ['initial-refresh', 'refreshed-refresh']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sends chat through the companion Helix client', async () => {
  const store = new MemoryRefreshTokenStore();
  const twitchAuth = new TwitchAuthService(config, store);
  const twitchApi = new TwitchApiClient(config, twitchAuth);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: unknown; method: string }> = [];

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

    if (url === 'https://api.example.test/helix/chat/messages') {
      requests.push({
        body: JSON.parse(String(init?.body)),
        method: init?.method ?? 'GET',
      });
      return jsonResponse({
        data: [
          {
            drop_reason: null,
            is_sent: true,
            message_id: 'sent-message',
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
    assert.equal(
      await twitchApi.sendChatMessage({
        broadcasterId: 'broadcaster-id',
        message: 'Hello from the companion',
        senderId: 'sender-id',
      }),
      'sent-message',
    );

    assert.deepEqual(requests, [
      {
        body: {
          broadcaster_id: 'broadcaster-id',
          message: 'Hello from the companion',
          sender_id: 'sender-id',
        },
        method: 'POST',
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('times out a user through the companion Helix client', async () => {
  const store = new MemoryRefreshTokenStore();
  const twitchAuth = new TwitchAuthService(config, store);
  const twitchApi = new TwitchApiClient(config, twitchAuth);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: unknown; path: string }> = [];

  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));

    if (url.href === 'https://id.twitch.tv/oauth2/token') {
      return jsonResponse({
        access_token: 'access-token',
        expires_in: 3600,
        refresh_token: 'refresh-token',
        scope: [],
        token_type: 'bearer',
      });
    }

    if (url.origin + url.pathname === 'https://api.example.test/helix/moderation/bans') {
      requests.push({
        body: JSON.parse(String(init?.body)),
        path: `${url.pathname}?${url.searchParams}`,
      });
      return jsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const authorizationUrl = new URL(twitchAuth.createAuthorizationUrl());
    const state = authorizationUrl.searchParams.get('state');

    assert.ok(state);
    await twitchAuth.completeAuthorization('authorization-code', state);
    await twitchApi.timeoutUser({
      broadcasterId: 'broadcaster-id',
      durationSeconds: 300,
      moderatorId: 'moderator-id',
      reason: 'Rule violation',
      userId: 'target-user',
    });

    assert.deepEqual(requests, [
      {
        body: {
          data: {
            duration: 300,
            reason: 'Rule violation',
            user_id: 'target-user',
          },
        },
        path: '/helix/moderation/bans?broadcaster_id=broadcaster-id&moderator_id=moderator-id',
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolves a Twitch login to its user ID through Helix', async () => {
  const store = new MemoryRefreshTokenStore();
  const twitchAuth = new TwitchAuthService(config, store);
  const twitchApi = new TwitchApiClient(config, twitchAuth);
  const originalFetch = globalThis.fetch;
  let resolvedUrl = '';

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

    resolvedUrl = url;
    return jsonResponse({
      data: [
        {
          display_name: 'Target User',
          id: 'target-user-id',
          login: 'target_user',
          profile_image_url: 'https://example.test/target.png',
        },
      ],
    });
  }) as typeof fetch;

  try {
    const authorizationUrl = new URL(twitchAuth.createAuthorizationUrl());
    const state = authorizationUrl.searchParams.get('state');

    assert.ok(state);
    await twitchAuth.completeAuthorization('authorization-code', state);
    assert.equal(await twitchApi.getUserIdByLogin('target_user'), 'target-user-id');
    assert.equal(resolvedUrl, 'https://api.example.test/helix/users?login=target_user');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sends EventSub subscriptions to the configured subscription endpoint', async () => {
  const subscriptionUrl = 'http://localhost:8080/eventsub/subscriptions';
  const subscriptionConfig = {
    ...config,
    eventSubSubscriptionsUrl: subscriptionUrl,
  };
  const store = new MemoryRefreshTokenStore();
  const twitchAuth = new TwitchAuthService(subscriptionConfig, store);
  const twitchApi = new TwitchApiClient(subscriptionConfig, twitchAuth);
  const originalFetch = globalThis.fetch;
  let subscriptionRequest: {
    body: unknown;
    method: string;
    url: string;
  } | null = null;

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

    if (url === subscriptionUrl) {
      subscriptionRequest = {
        body: JSON.parse(String(init?.body)),
        method: init?.method ?? 'GET',
        url,
      };
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const authorizationUrl = new URL(twitchAuth.createAuthorizationUrl());
    const state = authorizationUrl.searchParams.get('state');

    assert.ok(state);
    await twitchAuth.completeAuthorization('authorization-code', state);
    await twitchApi.createEventSubSubscription(
      {
        condition: { broadcaster_user_id: 'broadcaster-id' },
        type: 'stream.online',
        version: '1',
      },
      'mock-session-id',
    );

    assert.deepEqual(subscriptionRequest, {
      body: {
        condition: { broadcaster_user_id: 'broadcaster-id' },
        transport: {
          method: 'websocket',
          session_id: 'mock-session-id',
        },
        type: 'stream.online',
        version: '1',
      },
      method: 'POST',
      url: subscriptionUrl,
    });
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
