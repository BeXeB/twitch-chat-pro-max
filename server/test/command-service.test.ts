import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CommandDefinition } from '../../shared/contracts/command';
import { AutomationDefinition } from '../../shared/contracts/automation';
import { ApplicationEvent } from '../../shared/contracts/runtime-events';
import {
  AlwaysConditionHandler,
  AutomationActionRegistry,
  AutomationConditionRegistry,
  AutomationEngine,
  EmitRuntimeEventActionHandler,
} from '../src/features/automations/automation-engine';
import { InMemoryAutomationRepository } from '../src/features/automations/automation-repository';
import { InMemoryCommandRepository } from '../src/features/commands/command-repository';
import { CommandService } from '../src/features/commands/command-service';

const moderatorCommand: CommandDefinition = {
  aliases: ['hi'],
  argumentPolicy: 'optional',
  cooldown: { durationMs: 60000, scope: 'global' },
  enabled: true,
  id: 'greet-command',
  name: 'greet',
  requiredRole: 'moderator',
  targetAutomationId: 'greet-automation',
  version: 1,
};

test('parses aliases and applies global command cooldowns', async () => {
  const commandService = new CommandService(
    new InMemoryCommandRepository([moderatorCommand]),
    () => 1000,
  );

  const firstResult = await commandService.handleEvent(
    chatEvent({ badges: [{ set_id: 'moderator' }], text: '!hi Ada Lovelace' }),
  );
  const secondResult = await commandService.handleEvent(
    chatEvent({
      badges: [{ set_id: 'moderator' }],
      chatterId: 'another-moderator',
      text: '!greet',
    }),
  );

  assert.equal(firstResult.status, 'executed');
  assert.equal(firstResult.event?.type, 'command.executed');
  assert.equal(firstResult.event?.targetAutomationId, 'greet-automation');
  assert.deepEqual(firstResult.event?.payload, {
    arguments: ['Ada', 'Lovelace'],
    argumentsText: 'Ada Lovelace',
    commandId: 'greet-command',
    commandName: 'greet',
    invocation: 'hi',
    sourceMessageId: 'message-1',
    user: {
      displayName: 'Test User',
      id: 'user-1',
      login: 'test_user',
      role: 'moderator',
    },
  });
  assert.equal(secondResult.status, 'cooldown');
});

test('enforces roles, argument policy, and per-user cooldowns', async () => {
  const userCooldownCommand: CommandDefinition = {
    ...moderatorCommand,
    aliases: [],
    argumentPolicy: 'required',
    cooldown: { durationMs: 60000, scope: 'user' },
    id: 'target-command',
    name: 'target',
    requiredRole: 'subscriber',
  };
  const commandService = new CommandService(
    new InMemoryCommandRepository([moderatorCommand, userCooldownCommand]),
    () => 1000,
  );

  const deniedResult = await commandService.handleEvent(chatEvent({ text: '!greet' }));
  const missingArguments = await commandService.handleEvent(
    chatEvent({ badges: [{ set_id: 'subscriber' }], text: '!target' }),
  );
  const firstUserResult = await commandService.handleEvent(
    chatEvent({ badges: [{ set_id: 'subscriber' }], text: '!target first' }),
  );
  const sameUserResult = await commandService.handleEvent(
    chatEvent({ badges: [{ set_id: 'subscriber' }], text: '!target second' }),
  );
  const secondUserResult = await commandService.handleEvent(
    chatEvent({
      badges: [{ set_id: 'subscriber' }],
      chatterId: 'another-subscriber',
      text: '!target third',
    }),
  );

  assert.equal(deniedResult.status, 'permission-denied');
  assert.equal(missingArguments.status, 'arguments-missing');
  assert.equal(firstUserResult.status, 'executed');
  assert.equal(sameUserResult.status, 'cooldown');
  assert.equal(secondUserResult.status, 'executed');
});

test('routes a command event only to its configured automation', async () => {
  const definitions: AutomationDefinition[] = [
    automation('greet-automation', 'automation.greeted'),
    automation('other-automation', 'automation.other-command'),
  ];
  const engine = new AutomationEngine(
    new InMemoryAutomationRepository(definitions),
    new AutomationConditionRegistry([new AlwaysConditionHandler()]),
    new AutomationActionRegistry([new EmitRuntimeEventActionHandler()]),
  );
  const emittedEvents: ApplicationEvent[] = [];

  const result = await engine.handleEvent(
    {
      id: 'command-event',
      occurredAt: '2026-09-27T00:00:00.000Z',
      payload: {},
      source: 'command',
      targetAutomationId: 'greet-automation',
      type: 'command.executed',
    },
    (event) => emittedEvents.push(event),
  );

  assert.deepEqual(result, [{ automationId: 'greet-automation', status: 'completed' }]);
  assert.equal(emittedEvents.length, 1);
  assert.equal(emittedEvents[0].type, 'automation.greeted');
});

function automation(id: string, eventType: `automation.${string}`): AutomationDefinition {
  return {
    actions: [{ eventType, payload: {}, type: 'emit-runtime-event' }],
    conditions: { type: 'always' },
    enabled: true,
    id,
    name: id,
    trigger: { eventType: 'command.executed', type: 'application-event' },
    version: 1,
  };
}

function chatEvent({
  badges = [],
  chatterId = 'user-1',
  text,
}: {
  badges?: Array<{ set_id: string }>;
  chatterId?: string;
  text: string;
}): ApplicationEvent {
  return {
    id: `event-${chatterId}-${text}`,
    occurredAt: '2026-09-27T00:00:00.000Z',
    payload: {
      badges,
      broadcaster_user_id: 'broadcaster-1',
      chatter_user_id: chatterId,
      chatter_user_login: 'test_user',
      chatter_user_name: 'Test User',
      message: { text },
      message_id: 'message-1',
    },
    source: 'twitch',
    type: 'twitch.channel.chat.message',
  };
}
