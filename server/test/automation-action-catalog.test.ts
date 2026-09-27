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
} from '../src/features/automations/automation-engine';
import { InMemoryAutomationRepository } from '../src/features/automations/automation-repository';
import {
  BanUserActionHandler,
  CreatePollActionHandler,
  CreatePredictionActionHandler,
  DeleteChatMessageActionHandler,
  EndPollActionHandler,
  ResolvePredictionActionHandler,
  SendShoutoutActionHandler,
  ShowAlertActionHandler,
  UnbanUserActionHandler,
  UpdateChatSettingsActionHandler,
  UpdateRedemptionStatusActionHandler,
} from '../src/features/automations/twitch-action-handlers';
import { AutomationContinuation } from '../src/features/timers/automation-continuation';
import { AutomationContinuationScheduler } from '../src/features/timers/continuation-scheduler';

test('executes the remaining action catalog through registered handlers', async () => {
  const calls: unknown[][] = [];
  const engine = new AutomationEngine(
    new InMemoryAutomationRepository([catalogAutomation]),
    new AutomationConditionRegistry([new AlwaysConditionHandler()]),
    new AutomationActionRegistry([
      new BanUserActionHandler(async (userId, reason) => {
        calls.push(['ban', userId, reason]);
      }),
      new CreatePollActionHandler(async (title, choices, durationSeconds) => {
        calls.push(['create-poll', title, choices, durationSeconds]);
        return 'poll-1';
      }),
      new CreatePredictionActionHandler(async (title, outcomes, durationSeconds) => {
        calls.push(['create-prediction', title, outcomes, durationSeconds]);
        return 'prediction-1';
      }),
      new DeleteChatMessageActionHandler(async (messageId) => {
        calls.push(['delete-chat-message', messageId]);
      }),
      new EndPollActionHandler(async (pollId, status) => {
        calls.push(['end-poll', pollId, status]);
      }),
      new ResolvePredictionActionHandler(async (predictionId, status, outcomeId) => {
        calls.push(['resolve-prediction', predictionId, status, outcomeId]);
      }),
      new SendShoutoutActionHandler(async (targetBroadcasterId) => {
        calls.push(['send-shoutout', targetBroadcasterId]);
      }),
      new ShowAlertActionHandler(),
      new UnbanUserActionHandler(async (userId) => {
        calls.push(['unban', userId]);
      }),
      new UpdateChatSettingsActionHandler(async (settings) => {
        calls.push(['update-chat-settings', settings]);
      }),
      new UpdateRedemptionStatusActionHandler(
        async (rewardId, redemptionIds, status) => {
          calls.push(['update-redemption', rewardId, redemptionIds, status]);
        },
      ),
    ]),
  );
  const emittedEvents: ApplicationEvent[] = [];

  const results = await engine.handleEvent(sourceEvent, (event) => {
    emittedEvents.push(event);
  });

  assert.deepEqual(results, [{ automationId: 'catalog', status: 'completed' }]);
  assert.deepEqual(calls, [
    ['ban', 'target-user', 'Rule violation'],
    ['unban', 'target-user'],
    ['delete-chat-message', 'chat-message'],
    [
      'update-chat-settings',
      { followerMode: true, followerModeDurationMinutes: 10, slowMode: true },
    ],
    ['send-shoutout', 'other-broadcaster'],
    ['update-redemption', 'reward-1', ['redemption-1'], 'FULFILLED'],
    ['create-poll', 'Best color?', ['Blue', 'Green'], 60],
    ['end-poll', 'poll-1', 'ARCHIVED'],
    ['create-prediction', 'Will it work?', ['Yes', 'No'], 60],
    ['resolve-prediction', 'prediction-1', 'RESOLVED', 'outcome-1'],
  ]);
  assert.deepEqual(
    emittedEvents.map((event) => event.type),
    [
      'automation.user-banned',
      'automation.user-unbanned',
      'automation.chat-message-deleted',
      'automation.chat-settings-updated',
      'automation.shoutout-sent',
      'automation.alert-raised',
      'automation.redemption-status-updated',
      'automation.poll-created',
      'automation.poll-ended',
      'automation.prediction-created',
      'automation.prediction-updated',
    ],
  );
});

test('persists only remaining actions when a delay schedules a continuation', async () => {
  const requests: Array<{
    actions: AutomationContinuation['actions'];
    automationId: string;
    durationMs: number;
  }> = [];
  const scheduler: AutomationContinuationScheduler = {
    async schedule(request) {
      requests.push({
        actions: request.actions,
        automationId: request.automationId,
        durationMs: request.durationMs,
      });
      return {
        continuation: { id: 'continuation-1' } as AutomationContinuation,
        status: 'scheduled',
      };
    },
  };
  const definition: AutomationDefinition = {
    ...catalogAutomation,
    actions: [
      { duplicatePolicy: 'skip', durationMs: 1000, type: 'delay' },
      {
        eventType: 'automation.after-delay',
        payload: { complete: true },
        type: 'emit-runtime-event',
      },
    ],
    id: 'delayed',
  };
  const engine = new AutomationEngine(
    new InMemoryAutomationRepository([definition]),
    new AutomationConditionRegistry([new AlwaysConditionHandler()]),
    new AutomationActionRegistry([
      new DelayActionHandler(),
      new EmitRuntimeEventActionHandler(),
    ]),
    undefined,
    undefined,
    scheduler,
  );
  const emittedEvents: ApplicationEvent[] = [];

  const results = await engine.handleEvent(sourceEvent, (event) => {
    emittedEvents.push(event);
  });

  assert.deepEqual(results, [{ automationId: 'delayed', status: 'scheduled' }]);
  assert.deepEqual(requests, [
    {
      actions: [
        {
          eventType: 'automation.after-delay',
          payload: { complete: true },
          type: 'emit-runtime-event',
        },
      ],
      automationId: 'delayed',
      durationMs: 1000,
    },
  ]);
  assert.equal(emittedEvents[0].type, 'automation.continuation-scheduled');
});

const sourceEvent: ApplicationEvent = {
  id: 'source-event',
  occurredAt: '2026-09-27T00:00:00.000Z',
  payload: {},
  source: 'manual',
  type: 'manual.catalog-test',
};

const catalogAutomation: AutomationDefinition = {
  actions: [
    { reason: 'Rule violation', targetUserId: 'target-user', type: 'ban-user' },
    { targetUserId: 'target-user', type: 'unban-user' },
    { messageId: 'chat-message', type: 'delete-chat-message' },
    {
      settings: {
        followerMode: true,
        followerModeDurationMinutes: 10,
        slowMode: true,
      },
      type: 'update-chat-settings',
    },
    { targetBroadcasterId: 'other-broadcaster', type: 'send-shoutout' },
    { message: 'Heads up', title: 'Automation', type: 'show-alert' },
    {
      redemptionIds: ['redemption-1'],
      rewardId: 'reward-1',
      status: 'FULFILLED',
      type: 'update-redemption-status',
    },
    {
      choices: ['Blue', 'Green'],
      durationSeconds: 60,
      title: 'Best color?',
      type: 'create-poll',
    },
    { pollId: 'poll-1', status: 'ARCHIVED', type: 'end-poll' },
    {
      durationSeconds: 60,
      outcomes: ['Yes', 'No'],
      title: 'Will it work?',
      type: 'create-prediction',
    },
    {
      predictionId: 'prediction-1',
      status: 'RESOLVED',
      type: 'resolve-prediction',
      winningOutcomeId: 'outcome-1',
    },
  ],
  conditions: { type: 'always' },
  enabled: true,
  id: 'catalog',
  name: 'Action catalog',
  trigger: { eventType: 'manual.catalog-test', type: 'application-event' },
  version: 1,
};
