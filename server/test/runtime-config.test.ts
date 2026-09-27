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
});
