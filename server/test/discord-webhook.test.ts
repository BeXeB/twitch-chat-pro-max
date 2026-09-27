import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SendDiscordWebhookAction } from '../../shared/contracts/automation';
import { ApplicationEvent } from '../../shared/contracts/runtime-events';
import { SendDiscordWebhookActionHandler } from '../src/features/automations/discord-webhook-action-handler';
import { DiscordWebhookClient } from '../src/features/discord/discord-webhook.client';

const webhookUrl = 'https://discord.com/api/webhooks/123456789012345678/fake-token';
const roleId = '1084227335819100170';

test('sends the message with only the configured role mention allowed', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const client = new DiscordWebhookClient(webhookUrl, async (input, init) => {
    requestUrl = input;
    requestInit = init;
    return { ok: true, status: 204 };
  });

  await client.send({
    allowedRoleId: roleId,
    content: 'Mar megy is a mai stream! <@&1084227335819100170>\nhttps://www.twitch.tv/bexe_',
    username: 'BeXe',
  });

  assert.equal(requestUrl, webhookUrl);
  assert.equal(requestInit?.method, 'POST');
  assert.deepEqual(JSON.parse(requestInit?.body as string), {
    allowed_mentions: { parse: [], roles: [roleId] },
    content: 'Mar megy is a mai stream! <@&1084227335819100170>\nhttps://www.twitch.tv/bexe_',
    username: 'BeXe',
  });
});

test('rejects webhook URLs outside Discord HTTPS endpoints', async () => {
  let sent = false;
  const client = new DiscordWebhookClient(
    'https://example.com/api/webhooks/123/token',
    async () => {
      sent = true;
      return { ok: true, status: 204 };
    },
  );

  await assert.rejects(
    client.send({ content: 'Live now!' }),
    /valid Discord webhook URL/,
  );
  assert.equal(sent, false);
});

test('automation handler emits a delivery event after sending', async () => {
  const action: SendDiscordWebhookAction = {
    allowedRoleId: roleId,
    content: 'Stream live: {{event.payload.streamUrl}}',
    type: 'send-discord-webhook',
    username: 'BeXe',
  };
  const event: ApplicationEvent = {
    id: 'stream-online-1',
    occurredAt: '2026-09-27T00:00:00.000Z',
    payload: { streamUrl: 'https://www.twitch.tv/bexe_' },
    source: 'twitch',
    type: 'twitch.stream.online',
  };
  const sentMessages: unknown[] = [];
  const emittedEvents: ApplicationEvent[] = [];
  const handler = new SendDiscordWebhookActionHandler(async (message) => {
    sentMessages.push(message);
  });

  await handler.execute(action, {
    emit: (emittedEvent) => emittedEvents.push(emittedEvent),
    event,
  });

  assert.deepEqual(sentMessages, [
    {
      allowedRoleId: roleId,
      content: 'Stream live: https://www.twitch.tv/bexe_',
      username: 'BeXe',
    },
  ]);
  assert.equal(emittedEvents[0].type, 'automation.discord-webhook-sent');
});
