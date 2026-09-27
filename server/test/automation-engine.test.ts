import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AutomationDefinition } from '../../shared/contracts/automation';
import { ApplicationEvent } from '../../shared/contracts/runtime-events';
import {
  AlwaysConditionHandler,
  AutomationActionRegistry,
  AutomationConditionRegistry,
  AutomationEngine,
  EmitRuntimeEventActionHandler,
  EventFieldEqualsConditionHandler,
  SendChatMessageActionHandler,
  TimeoutUserActionHandler,
} from '../src/features/automations/automation-engine';
import { InMemoryAutomationRepository } from '../src/features/automations/automation-repository';

const raidEvent: ApplicationEvent = {
  id: 'raid-event',
  occurredAt: '2026-09-27T00:00:00.000Z',
  payload: { viewers: 25 },
  source: 'twitch',
  type: 'twitch.channel.raid',
};

test('executes registered actions for matching events and respects cooldowns', async () => {
  const definition: AutomationDefinition = {
    actions: [
      {
        eventType: 'automation.raid-alert',
        payload: { viewers: 25 },
        type: 'emit-runtime-event',
      },
    ],
    conditions: {
      children: [
        { type: 'always' },
        { path: 'viewers', type: 'event-field-equals', value: 25 },
      ],
      type: 'all',
    },
    cooldown: { durationMs: 60000 },
    enabled: true,
    id: 'raid-automation',
    name: 'Raid alert',
    trigger: { eventType: 'twitch.channel.raid', type: 'application-event' },
    version: 1,
  };
  const emittedEvents: ApplicationEvent[] = [];
  const engine = new AutomationEngine(
    new InMemoryAutomationRepository([definition]),
    new AutomationConditionRegistry([
      new AlwaysConditionHandler(),
      new EventFieldEqualsConditionHandler(),
    ]),
    new AutomationActionRegistry([new EmitRuntimeEventActionHandler()]),
    undefined,
    () => 1000,
  );

  const firstResult = await engine.handleEvent(raidEvent, (event) => {
    emittedEvents.push(event);
  });
  const secondResult = await engine.handleEvent(raidEvent, (event) => {
    emittedEvents.push(event);
  });

  assert.deepEqual(firstResult, [
    { automationId: 'raid-automation', status: 'completed' },
  ]);
  assert.deepEqual(secondResult, [
    { automationId: 'raid-automation', status: 'cooldown' },
  ]);
  assert.equal(emittedEvents.length, 1);
  assert.equal(emittedEvents[0].source, 'automation');
  assert.equal(emittedEvents[0].type, 'automation.raid-alert');
  assert.equal(emittedEvents[0].causationId, 'raid-event');
});

test('sends a templated chat message through the registered backend sender', async () => {
  const definition: AutomationDefinition = {
    actions: [
      {
        message: 'Welcome, {{event.payload.user.displayName}}: {{event.payload.argumentsText}}',
        type: 'send-chat',
      },
    ],
    conditions: { type: 'always' },
    enabled: true,
    id: 'command-response',
    name: 'Command response',
    trigger: { eventType: 'command.executed', type: 'application-event' },
    version: 1,
  };
  const sentMessages: string[] = [];
  const emittedEvents: ApplicationEvent[] = [];
  const engine = new AutomationEngine(
    new InMemoryAutomationRepository([definition]),
    new AutomationConditionRegistry([new AlwaysConditionHandler()]),
    new AutomationActionRegistry([
      new SendChatMessageActionHandler(async (message) => {
        sentMessages.push(message);
      }),
    ]),
  );

  await engine.handleEvent(
    {
      id: 'command-event',
      occurredAt: '2026-09-27T00:00:00.000Z',
      payload: {
        argumentsText: 'hello there',
        user: { displayName: 'Ada' },
      },
      source: 'command',
      type: 'command.executed',
    },
    (event) => emittedEvents.push(event),
  );

  assert.deepEqual(sentMessages, ['Welcome, Ada: hello there']);
  assert.equal(emittedEvents.length, 1);
  assert.equal(emittedEvents[0].type, 'automation.chat-message-sent');
  assert.deepEqual(emittedEvents[0].payload, {
    message: 'Welcome, Ada: hello there',
  });
});

test('times out a templated target through the registered backend moderator', async () => {
  const definition: AutomationDefinition = {
    actions: [
      {
        durationSeconds: 120,
        reason: 'Requested by {{event.payload.user.displayName}}',
        targetUserId: '{{event.payload.target.id}}',
        type: 'timeout-user',
      },
    ],
    conditions: { type: 'always' },
    enabled: true,
    id: 'timeout-command',
    name: 'Timeout command',
    trigger: { eventType: 'command.executed', type: 'application-event' },
    version: 1,
  };
  const timeouts: Array<{
    durationSeconds: number;
    reason: string | undefined;
    userId: string;
  }> = [];
  const emittedEvents: ApplicationEvent[] = [];
  const engine = new AutomationEngine(
    new InMemoryAutomationRepository([definition]),
    new AutomationConditionRegistry([new AlwaysConditionHandler()]),
    new AutomationActionRegistry([
      new TimeoutUserActionHandler(async (userId, durationSeconds, reason) => {
        timeouts.push({ durationSeconds, reason, userId });
      }),
    ]),
  );

  await engine.handleEvent(
    {
      id: 'command-event',
      occurredAt: '2026-09-27T00:00:00.000Z',
      payload: {
        target: { id: 'target-user' },
        user: { displayName: 'Ada' },
      },
      source: 'command',
      type: 'command.executed',
    },
    (event) => emittedEvents.push(event),
  );

  assert.deepEqual(timeouts, [
    {
      durationSeconds: 120,
      reason: 'Requested by Ada',
      userId: 'target-user',
    },
  ]);
  assert.equal(emittedEvents.length, 1);
  assert.equal(emittedEvents[0].type, 'automation.user-timed-out');
  assert.deepEqual(emittedEvents[0].payload, {
    durationSeconds: 120,
    reason: 'Requested by Ada',
    targetUserId: 'target-user',
  });
});
