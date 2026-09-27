import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AutomationDefinition } from '../../shared/contracts/automation';
import { ApplicationEvent } from '../../shared/contracts/runtime-events';
import {
  AlwaysConditionHandler,
  AutomationActionRegistry,
  AutomationConditionRegistry,
  AutomationEngine,
  DelayActionHandler,
  EmitRuntimeEventActionHandler,
  EventFieldEqualsConditionHandler,
  SendChatMessageActionHandler,
  TimeoutUserActionHandler,
} from '../src/features/automations/automation-engine';
import { InMemoryAutomationRepository } from '../src/features/automations/automation-repository';
import {
  AddChannelVipActionHandler,
  AddLeaderboardPointsActionHandler,
  IncreaseCustomRewardCostActionHandler,
  SendShoutoutActionHandler,
  UpdateChatSettingsActionHandler,
} from '../src/features/automations/twitch-action-handlers';
import {
  ContinuationScheduleRequest,
} from '../src/features/timers/automation-continuation';
import { AutomationContinuationScheduler } from '../src/features/timers/continuation-scheduler';

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

test('shouts out raid sources, opens chat, and schedules follower mode restoration', async () => {
  const restoreSettings = {
    followerMode: true,
    followerModeDurationMinutes: 0,
  };
  const definition: AutomationDefinition = {
    actions: [
      {
        targetBroadcasterId: '{{event.payload.from_broadcaster_user_id}}',
        type: 'send-shoutout',
      },
      {
        settings: { followerMode: false },
        type: 'update-chat-settings',
      },
      { duplicatePolicy: 'replace', durationMs: 600000, type: 'delay' },
      { settings: restoreSettings, type: 'update-chat-settings' },
    ],
    conditions: { type: 'always' },
    enabled: true,
    id: 'raid-response',
    name: 'Raid response',
    trigger: { eventType: 'twitch.channel.raid', type: 'application-event' },
    version: 1,
  };
  const calls: unknown[][] = [];
  const continuations: ContinuationScheduleRequest[] = [];
  const continuationScheduler: AutomationContinuationScheduler = {
    async schedule(request) {
      continuations.push(request);
      return { status: 'scheduled' };
    },
  };
  const engine = new AutomationEngine(
    new InMemoryAutomationRepository([definition]),
    new AutomationConditionRegistry([new AlwaysConditionHandler()]),
    new AutomationActionRegistry([
      new SendShoutoutActionHandler(async (broadcasterId) => {
        calls.push(['shoutout', broadcasterId]);
      }),
      new UpdateChatSettingsActionHandler(async (settings) => {
        calls.push(['settings', settings]);
      }),
      new DelayActionHandler(),
    ]),
    undefined,
    undefined,
    continuationScheduler,
  );
  const raid: ApplicationEvent = {
    id: 'raid-1',
    occurredAt: '2026-09-27T00:00:00.000Z',
    payload: { from_broadcaster_user_id: 'raider-1' },
    source: 'twitch',
    type: 'twitch.channel.raid',
  };

  const result = await engine.handleEvent(raid, () => undefined);

  assert.deepEqual(result, [
    { automationId: 'raid-response', status: 'scheduled' },
  ]);
  assert.deepEqual(calls, [
    ['shoutout', 'raider-1'],
    ['settings', { followerMode: false }],
  ]);
  assert.equal(continuations.length, 1);
  assert.deepEqual(continuations[0], {
    actions: [{ settings: restoreSettings, type: 'update-chat-settings' }],
    automationId: 'raid-response',
    duplicatePolicy: 'replace',
    durationMs: 600000,
    event: raid,
  });
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

test('grants VIP to the redeemer and increases the redeemed reward cost', async () => {
  const definition: AutomationDefinition = {
    actions: [
      {
        targetUserId: '{{event.payload.user_id}}',
        type: 'add-channel-vip',
      },
      {
        amount: 8000,
        rewardId: '{{event.payload.reward.id}}',
        type: 'increase-custom-reward-cost',
      },
    ],
    conditions: { type: 'always' },
    enabled: true,
    id: 'vip-reward',
    name: 'VIP reward',
    trigger: {
      eventType: 'twitch.channel.channel_points_custom_reward_redemption.add',
      type: 'application-event',
    },
    version: 1,
  };
  const calls: unknown[][] = [];
  const emittedEvents: ApplicationEvent[] = [];
  const engine = new AutomationEngine(
    new InMemoryAutomationRepository([definition]),
    new AutomationConditionRegistry([new AlwaysConditionHandler()]),
    new AutomationActionRegistry([
      new AddChannelVipActionHandler(async (userId) => {
        calls.push(['vip', userId]);
      }),
      new IncreaseCustomRewardCostActionHandler(async (rewardId, amount) => {
        calls.push(['cost', rewardId, amount]);
        return 14400;
      }),
    ]),
  );

  const result = await engine.handleEvent(
    {
      id: 'vip-redemption',
      occurredAt: '2026-09-27T00:00:00.000Z',
      payload: { reward: { id: 'vip-reward-id' }, user_id: 'viewer-id' },
      source: 'twitch',
      type: 'twitch.channel.channel_points_custom_reward_redemption.add',
    },
    (event) => emittedEvents.push(event),
  );

  assert.deepEqual(result, [{ automationId: 'vip-reward', status: 'completed' }]);
  assert.deepEqual(calls, [
    ['vip', 'viewer-id'],
    ['cost', 'vip-reward-id', 8000],
  ]);
  assert.deepEqual(
    emittedEvents.map((event) => event.type),
    [
      'automation.channel-vip-added',
      'automation.custom-reward-cost-increased',
    ],
  );
  assert.deepEqual(emittedEvents[1].payload, {
    amount: 8000,
    newCost: 14400,
    rewardId: 'vip-reward-id',
  });
});

test('records the redemption cost for the redeemer in the leaderboard', async () => {
  const definition: AutomationDefinition = {
    actions: [
      {
        points: '{{event.payload.reward.cost}}',
        type: 'add-leaderboard-points',
        userId: '{{event.payload.user_id}}',
      },
    ],
    conditions: { type: 'always' },
    enabled: true,
    id: 'waste-redemption',
    name: 'Waste redemption',
    trigger: {
      eventType: 'twitch.channel.channel_points_custom_reward_redemption.add',
      type: 'application-event',
    },
    version: 1,
  };
  const recorded: Array<{ points: number; userId: string }> = [];
  const emittedEvents: ApplicationEvent[] = [];
  const engine = new AutomationEngine(
    new InMemoryAutomationRepository([definition]),
    new AutomationConditionRegistry([new AlwaysConditionHandler()]),
    new AutomationActionRegistry([
      new AddLeaderboardPointsActionHandler(async (userId, points) => {
        recorded.push({ points, userId });
        return 600;
      }),
    ]),
  );

  await engine.handleEvent(
    {
      id: 'waste-redemption-event',
      occurredAt: '2026-09-27T00:00:00.000Z',
      payload: { reward: { cost: 515 }, user_id: 'viewer-id' },
      source: 'twitch',
      type: 'twitch.channel.channel_points_custom_reward_redemption.add',
    },
    (event) => emittedEvents.push(event),
  );

  assert.deepEqual(recorded, [{ points: 515, userId: 'viewer-id' }]);
  assert.deepEqual(emittedEvents[0].payload, {
    points: 515,
    totalPoints: 600,
    userId: 'viewer-id',
  });
});

  test('executes a scheduled automation through its existing action list', async () => {
    const definition: AutomationDefinition = {
      actions: [{ message: 'Discord reminder', type: 'send-chat' }],
      conditions: { type: 'always' },
      enabled: true,
      id: 'discord-reminder',
      name: 'Discord reminder',
      schedule: { intervalMs: 600000, onlyWhileLive: true },
      trigger: { eventType: 'command.executed', type: 'application-event' },
      version: 1,
    };
    const sentMessages: string[] = [];
    const engine = new AutomationEngine(
      new InMemoryAutomationRepository([definition]),
      new AutomationConditionRegistry([new AlwaysConditionHandler()]),
      new AutomationActionRegistry([
        new SendChatMessageActionHandler(async (message) => {
          sentMessages.push(message);
        }),
      ]),
    );
    const emittedEvents: ApplicationEvent[] = [];

    const result = await engine.handleScheduledAutomation(
      definition.id,
      (event) => emittedEvents.push(event),
    );

    assert.deepEqual(result, {
      automationId: definition.id,
      status: 'completed',
    });
    assert.deepEqual(sentMessages, ['Discord reminder']);
    assert.equal(emittedEvents[0].type, 'automation.chat-message-sent');
  });
