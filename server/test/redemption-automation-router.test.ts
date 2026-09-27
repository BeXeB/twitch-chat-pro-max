import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AutomationDefinition } from '../../shared/contracts/automation';
import {
  redemptionEventType,
  RewardAutomationMapping,
} from '../../shared/contracts/rewards';
import { ApplicationEvent } from '../../shared/contracts/runtime-events';
import {
  AlwaysConditionHandler,
  AutomationActionRegistry,
  AutomationConditionRegistry,
  AutomationEngine,
  EmitRuntimeEventActionHandler,
} from '../src/features/automations/automation-engine';
import { InMemoryAutomationRepository } from '../src/features/automations/automation-repository';
import { RedemptionAutomationRouter } from '../src/features/rewards/redemption-automation-router';
import { InMemoryRewardMappingRepository } from '../src/features/rewards/reward-mapping-repository';

test('executes a mapped redemption and auto-fulfills it after success', async () => {
  const statuses: Array<{
    redemptionId: string;
    rewardId: string;
    status: string;
  }> = [];
  const emittedEvents: ApplicationEvent[] = [];
  const router = createRouter('auto-fulfill', async (rewardId, redemptionId, status) => {
    statuses.push({ redemptionId, rewardId, status });
  });

  const handled = await router.handle(redemptionEvent, (event) => {
    emittedEvents.push(event);
  });

  assert.equal(handled, true);
  assert.deepEqual(statuses, [
    {
      redemptionId: 'redemption-1',
      rewardId: 'reward-1',
      status: 'FULFILLED',
    },
  ]);
  assert.deepEqual(
    emittedEvents.map((event) => event.type),
    ['automation.reward-ran', 'automation.redemption-completed'],
  );
});

test('retains manual-review redemptions without updating Twitch status', async () => {
  const statuses: string[] = [];
  const emittedEvents: ApplicationEvent[] = [];
  const router = createRouter('manual-review', async (_rewardId, _redemptionId, status) => {
    statuses.push(status);
  });

  const handled = await router.handle(redemptionEvent, (event) => {
    emittedEvents.push(event);
  });

  assert.equal(handled, true);
  assert.deepEqual(statuses, []);
  assert.deepEqual(
    emittedEvents.map((event) => event.type),
    ['automation.reward-ran', 'automation.redemption-requires-review'],
  );
  assert.equal(emittedEvents[1].payload['reason'], 'manual-policy');
});

test('cancels mapped redemptions when configured and retains failed completion for review', async () => {
  const statuses: string[] = [];
  const canceledRouter = createRouter(
    'auto-cancel',
    async (_rewardId, _redemptionId, status) => {
      statuses.push(status);
    },
  );
  const canceledEvents: ApplicationEvent[] = [];

  await canceledRouter.handle(redemptionEvent, (event) => {
    canceledEvents.push(event);
  });

  assert.deepEqual(statuses, ['CANCELED']);
  assert.equal(canceledEvents[1].type, 'automation.redemption-completed');

  const failedEvents: ApplicationEvent[] = [];
  const failingRouter = createRouter('auto-fulfill', async () => {
    throw new Error('Twitch completion failed');
  });

  await failingRouter.handle(redemptionEvent, (event) => {
    failedEvents.push(event);
  });

  assert.equal(failedEvents[1].type, 'automation.redemption-requires-review');
  assert.equal(failedEvents[1].payload['reason'], 'automation-failed');
});

test('leaves unmapped redemptions for ordinary automation handling', async () => {
  const engine = createEngine();
  const router = new RedemptionAutomationRouter(
    new InMemoryRewardMappingRepository(),
    engine,
    async () => undefined,
  );

  assert.equal(await router.handle(redemptionEvent, () => undefined), false);
});

function createRouter(
  completionPolicy: RewardAutomationMapping['completionPolicy'],
  updateRedemptionStatus: (
    rewardId: string,
    redemptionId: string,
    status: 'CANCELED' | 'FULFILLED',
  ) => Promise<void>,
): RedemptionAutomationRouter {
  return new RedemptionAutomationRouter(
    new InMemoryRewardMappingRepository([
      {
        automationId: 'reward-automation',
        completionPolicy,
        rewardId: 'reward-1',
        version: 1,
      },
    ]),
    createEngine(),
    updateRedemptionStatus,
  );
}

function createEngine(): AutomationEngine {
  const definition: AutomationDefinition = {
    actions: [
      {
        eventType: 'automation.reward-ran',
        payload: { source: 'reward' },
        type: 'emit-runtime-event',
      },
    ],
    conditions: { type: 'always' },
    enabled: true,
    id: 'reward-automation',
    name: 'Reward automation',
    trigger: { eventType: redemptionEventType, type: 'application-event' },
    version: 1,
  };

  return new AutomationEngine(
    new InMemoryAutomationRepository([definition]),
    new AutomationConditionRegistry([new AlwaysConditionHandler()]),
    new AutomationActionRegistry([new EmitRuntimeEventActionHandler()]),
  );
}

const redemptionEvent: ApplicationEvent = {
  id: 'redemption-event',
  occurredAt: '2026-09-27T00:00:00.000Z',
  payload: {
    id: 'redemption-1',
    reward: { id: 'reward-1' },
  },
  source: 'twitch',
  type: redemptionEventType,
};
