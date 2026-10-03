import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AutomationDefinition } from '../../shared/contracts/automation';
import { ApplicationEvent } from '../../shared/contracts/runtime-events';
import { redemptionEventType, RewardAutomationMapping } from '../../shared/contracts/rewards';
import { OpenLootboxActionHandler } from '../src/features/automations/lootbox-action-handler';
import {
  AlwaysConditionHandler,
  AutomationActionRegistry,
  AutomationConditionRegistry,
  AutomationEngine,
} from '../src/features/automations/automation-engine';
import { InMemoryAutomationRepository } from '../src/features/automations/automation-repository';
import { InMemoryInventoryRepository } from '../src/features/inventory/inventory-repository';
import { InMemoryLootboxCatalogRepository } from '../src/features/lootboxes/lootbox-catalog-repository';
import { LootboxService } from '../src/features/lootboxes/lootbox-service';
import { RedemptionAutomationRouter } from '../src/features/rewards/redemption-automation-router';
import { InMemoryRewardMappingRepository } from '../src/features/rewards/reward-mapping-repository';

test('announces and fulfills a lootbox redemption once, including on redelivery', async () => {
  const inventory = new InMemoryInventoryRepository();
  const announcements: string[] = [];
  const statuses: string[] = [];
  const handler = createHandler(inventory, async (message) => {
    announcements.push(message);
  });
  const router = createRouter(handler, async (_rewardId, _redemptionId, status) => {
    statuses.push(status);
  });

  await router.handle(redemptionEvent, () => undefined);
  await router.handle(redemptionEvent, () => undefined);

  assert.deepEqual(announcements, ['@viewer opened Chat Style Cache and found Ember Text.']);
  assert.deepEqual(statuses, ['FULFILLED', 'FULFILLED']);
  assert.deepEqual(await inventory.getByUserId('12345'), {
    equippedCosmetics: {},
    items: [{ itemId: 'ember-text', quantity: 1 }],
    userId: '12345',
  });
});

test('retries a failed announcement with the persisted result without awarding twice', async () => {
  const inventory = new InMemoryInventoryRepository();
  const announcements: string[] = [];
  const statuses: string[] = [];
  let failAnnouncement = true;
  const handler = createHandler(inventory, async (message) => {
    if (failAnnouncement) {
      throw new Error('Chat send failed.');
    }
    announcements.push(message);
  });
  const router = createRouter(handler, async (_rewardId, _redemptionId, status) => {
    statuses.push(status);
  });
  const firstEvents: ApplicationEvent[] = [];

  await router.handle(redemptionEvent, (event) => firstEvents.push(event));

  assert.deepEqual(statuses, []);
  assert.equal(firstEvents.at(-1)?.type, 'automation.redemption-requires-review');
  assert.equal((await inventory.getOpening('redemption-1'))?.announced, false);
  assert.deepEqual((await inventory.getByUserId('12345'))?.items, [
    { itemId: 'ember-text', quantity: 1 },
  ]);

  failAnnouncement = false;
  await router.handle(redemptionEvent, () => undefined);

  assert.deepEqual(announcements, ['@viewer opened Chat Style Cache and found Ember Text.']);
  assert.deepEqual(statuses, ['FULFILLED']);
  assert.equal((await inventory.getOpening('redemption-1'))?.announced, true);
  assert.deepEqual((await inventory.getByUserId('12345'))?.items, [
    { itemId: 'ember-text', quantity: 1 },
  ]);
});

function createHandler(
  inventory: InMemoryInventoryRepository,
  sendChatMessage: (message: string) => Promise<void>,
): OpenLootboxActionHandler {
  return new OpenLootboxActionHandler(
    new LootboxService(
      new InMemoryLootboxCatalogRepository(),
      inventory,
      () => 0,
      () => new Date('2026-09-27T00:00:00.000Z'),
    ),
    sendChatMessage,
  );
}

function createRouter(
  handler: OpenLootboxActionHandler,
  updateRedemptionStatus: (
    rewardId: string,
    redemptionId: string,
    status: 'CANCELED' | 'FULFILLED',
  ) => Promise<void>,
): RedemptionAutomationRouter {
  const automation: AutomationDefinition = {
    actions: [{ lootboxId: 'common-lootbox', type: 'open-lootbox' }],
    conditions: { type: 'always' },
    enabled: true,
    id: 'open-common-lootbox',
    name: 'Common Lootbox',
    trigger: { eventType: redemptionEventType, type: 'application-event' },
    version: 1,
  };
  const mapping: RewardAutomationMapping = {
    automationId: automation.id,
    completionPolicy: 'auto-fulfill',
    rewardId: 'reward-1',
    version: 1,
  };
  const engine = new AutomationEngine(
    new InMemoryAutomationRepository([automation]),
    new AutomationConditionRegistry([new AlwaysConditionHandler()]),
    new AutomationActionRegistry([handler]),
  );

  return new RedemptionAutomationRouter(
    new InMemoryRewardMappingRepository([mapping]),
    engine,
    updateRedemptionStatus,
  );
}

const redemptionEvent: ApplicationEvent = {
  id: 'event-1',
  occurredAt: '2026-09-27T00:00:00.000Z',
  payload: {
    id: 'redemption-1',
    reward: { id: 'reward-1' },
    user_id: '12345',
    user_login: 'viewer',
  },
  source: 'twitch',
  type: redemptionEventType,
};
