import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getEventSubSubscriptionDefinitions } from '../src/twitch/eventsub.client';

test('omits unsupported chat and Hype Train subscriptions for a local mock', () => {
  const subscriptions = getEventSubSubscriptionDefinitions(
    'broadcaster-id',
    'ws://localhost:8080/ws',
  );

  assert.equal(
    subscriptions.some(({ type }) => type === 'channel.chat.message'),
    false,
  );
  assert.equal(
    subscriptions.some(({ type }) => type.startsWith('channel.hype_train.')),
    false,
  );
  assert.equal(subscriptions[0]?.type, 'stream.online');
});

test('keeps chat message subscriptions for Twitch EventSub', () => {
  const subscriptions = getEventSubSubscriptionDefinitions(
    'broadcaster-id',
    'wss://eventsub.wss.twitch.tv/ws',
  );

  assert.equal(subscriptions[0]?.type, 'channel.chat.message');
});
