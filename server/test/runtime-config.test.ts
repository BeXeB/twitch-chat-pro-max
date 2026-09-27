import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadRuntimeConfig } from '../src/config/runtime-config';

const credentials = {
  TWITCH_CLIENT_ID: 'client-id',
  TWITCH_CLIENT_SECRET: 'client-secret',
};

test('derives the local EventSub subscriptions endpoint from the mock URL', () => {
  const config = loadRuntimeConfig({
    ...credentials,
    TWITCH_EVENTSUB_URL: 'ws://localhost:8080/ws',
  });

  assert.equal(
    config.twitchOAuth?.eventSubSubscriptionsUrl,
    'http://localhost:8080/eventsub/subscriptions',
  );
});

test('derives the production EventSub subscriptions endpoint from Helix', () => {
  const config = loadRuntimeConfig({
    ...credentials,
    TWITCH_EVENTSUB_URL: 'wss://eventsub.wss.twitch.tv/ws',
  });

  assert.equal(
    config.twitchOAuth?.eventSubSubscriptionsUrl,
    'https://api.twitch.tv/helix/eventsub/subscriptions',
  );
  assert.ok(config.twitchOAuth?.scopes.includes('channel:manage:vips'));
  assert.ok(config.twitchOAuth?.scopes.includes('channel:read:hype_train'));
});

test('loads an optional Discord webhook URL independently of Twitch credentials', () => {
  const webhookUrl = 'https://discord.com/api/webhooks/123456789012345678/fake-token';
  const config = loadRuntimeConfig({
    DISCORD_STREAM_WEBHOOK_URL: webhookUrl,
  });

  assert.equal(config.discordStreamWebhookUrl, webhookUrl);
  assert.equal(config.twitchOAuth, null);
});
