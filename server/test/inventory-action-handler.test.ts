import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AutomationDefinition } from '../../shared/contracts/automation';
import { CommandDefinition } from '../../shared/contracts/command';
import {
  AlwaysConditionHandler,
  AutomationActionRegistry,
  AutomationConditionRegistry,
  AutomationEngine,
} from '../src/features/automations/automation-engine';
import { InMemoryAutomationRepository } from '../src/features/automations/automation-repository';
import { isAutomationDefinition } from '../src/features/automations/file-automation-repository';
import { InMemoryCommandRepository } from '../src/features/commands/command-repository';
import { isCommandDefinition } from '../src/features/commands/file-command-repository';
import { CommandService } from '../src/features/commands/command-service';
import { ApplicationEvent } from '../../shared/contracts/runtime-events';
import {
  EquipInventoryActionHandler,
  WhisperInventoryActionHandler,
  formatInventoryWhispers,
} from '../src/features/automations/inventory-action-handler';
import { InMemoryInventoryRepository } from '../src/features/inventory/inventory-repository';
import {
  InMemoryLootboxCatalogRepository,
  starterLootboxCatalog,
} from '../src/features/lootboxes/lootbox-catalog-repository';
import { LootboxService, OwnedInventoryItem } from '../src/features/lootboxes/lootbox-service';

const event: ApplicationEvent = {
  id: 'inventory-command',
  occurredAt: '2026-10-03T00:00:00.000Z',
  payload: { user: { id: '12345' } },
  source: 'command',
  type: 'command.executed',
};

test('configured !equip preserves a multi-word item name and replies publicly to its author', async () => {
  const command: CommandDefinition = {
    aliases: [],
    argumentPolicy: 'optional',
    cooldown: { durationMs: 5000, scope: 'user' },
    enabled: true,
    id: 'command-equip',
    name: 'equip',
    requiredRole: 'everyone',
    targetAutomationId: 'automation-equip',
    version: 1,
  };
  assert.ok(isCommandDefinition(command));
  const automation: AutomationDefinition = {
    actions: [{ type: 'equip-inventory' }],
    conditions: { type: 'always' },
    enabled: true,
    id: command.targetAutomationId,
    name: 'Equip Inventory',
    trigger: { eventType: 'command.executed', type: 'application-event' },
    version: 1,
  };
  assert.ok(isAutomationDefinition(automation));
  const inventory = new InMemoryInventoryRepository();
  const lootboxes = new LootboxService(new InMemoryLootboxCatalogRepository(), inventory, () => 0);
  const opening = await lootboxes.open({
    boxId: 'common-lootbox',
    redemptionId: 'equip-drop',
    userId: '12345',
  });
  const messages: string[] = [];
  const engine = new AutomationEngine(
    new InMemoryAutomationRepository([automation]),
    new AutomationConditionRegistry([new AlwaysConditionHandler()]),
    new AutomationActionRegistry([
      new EquipInventoryActionHandler(lootboxes, async (message) => {
        messages.push(message);
      }),
    ]),
  );
  const service = new CommandService(new InMemoryCommandRepository([command]), () => 1000);
  const chatEvent: ApplicationEvent = {
    ...event,
    source: 'twitch',
    type: 'twitch.channel.chat.message',
    payload: {
      chatter_user_id: '12345',
      chatter_user_login: 'viewer',
      chatter_user_name: 'Viewer',
      message: { text: `!equip ${opening.itemName.toLocaleUpperCase('hu')}` },
      badges: [],
    },
  };
  const result = await service.handleEvent(chatEvent);
  assert.ok(result.event);
  const emitted: ApplicationEvent[] = [];
  assert.deepEqual(
    await engine.handleEvent(result.event, (event) => {
      emitted.push(event);
    }),
    [{ automationId: automation.id, status: 'completed' }],
  );
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, 'automation.inventory-equipped');
  assert.equal(emitted[0].causationId, result.event.id);
  assert.deepEqual(emitted[0].payload, { userId: '12345', itemName: opening.itemName });
  assert.deepEqual(messages, [`@viewer Felszerelve: ${opening.itemName}`]);
  assert.deepEqual((await inventory.getByUserId('12345'))?.equippedCosmetics, {
    'message-color': opening.itemId,
  });
  assert.equal((await service.handleEvent(chatEvent)).status, 'cooldown');
});

test('equip reports missing names and unowned items publicly without changing inventory', async () => {
  const lootboxes = new LootboxService(
    new InMemoryLootboxCatalogRepository(),
    new InMemoryInventoryRepository(),
  );
  const messages: string[] = [];
  const handler = new EquipInventoryActionHandler(lootboxes, async (message) => {
    messages.push(message);
  });
  const commandEvent = {
    ...event,
    payload: { user: { id: '12345', login: 'viewer' }, argumentsText: '' },
  };
  await handler.execute(
    { type: 'equip-inventory' },
    { event: commandEvent, emit: () => undefined },
  );
  await handler.execute(
    { type: 'equip-inventory' },
    {
      event: {
        ...commandEvent,
        payload: { ...commandEvent.payload, argumentsText: 'Missing Item' },
      },
      emit: () => undefined,
    },
  );
  assert.deepEqual(messages, [
    '@viewer Használat: !equip [tárgy neve]',
    '@viewer Nincs ilyen felszerelhető tárgy az inventorydban.',
  ]);
  assert.deepEqual(await lootboxes.getEquippedCosmetics(), {});
  await assert.rejects(
    handler.execute(
      { type: 'equip-inventory' },
      {
        event: { ...commandEvent, type: 'twitch.channel.chat.message' },
        emit: () => undefined,
      },
    ),
    /command/,
  );
  const failingHandler = new EquipInventoryActionHandler(lootboxes, async () => {
    throw new Error('Chat failed');
  });
  await assert.rejects(
    failingHandler.execute(
      { type: 'equip-inventory' },
      {
        event: commandEvent,
        emit: () => undefined,
      },
    ),
    /Chat failed/,
  );
});

test('equip emits the saved equipment change even when public feedback fails', async () => {
  const emitted: ApplicationEvent[] = [];
  const handler = new EquipInventoryActionHandler(
    {
      equipByName: async () => ({ status: 'equipped', itemName: 'Ember Text' }),
    },
    async () => {
      throw new Error('Chat failed');
    },
  );
  await assert.rejects(
    handler.execute(
      { type: 'equip-inventory' },
      {
        event: {
          ...event,
          payload: { user: { id: '12345', login: 'viewer' }, argumentsText: 'Ember Text' },
        },
        emit: (event) => {
          emitted.push(event);
        },
      },
    ),
    /Chat failed/,
  );
  assert.equal(emitted[0].type, 'automation.inventory-equipped');
});

test('configured !inventory routes privately and enforces a per-viewer cooldown', async () => {
  const command: CommandDefinition = {
    aliases: [],
    argumentPolicy: 'none',
    cooldown: { durationMs: 30000, scope: 'user' },
    enabled: true,
    id: 'command-inventory',
    name: 'inventory',
    requiredRole: 'everyone',
    targetAutomationId: 'automation-inventory',
    version: 1,
  };
  assert.ok(isCommandDefinition(command));
  const automation: AutomationDefinition = {
    actions: [{ type: 'whisper-inventory' }],
    conditions: { type: 'always' },
    enabled: true,
    id: command.targetAutomationId,
    name: 'Whisper Inventory',
    trigger: { eventType: 'command.executed', type: 'application-event' },
    version: 1,
  };
  assert.ok(isAutomationDefinition(automation));
  const service = new CommandService(new InMemoryCommandRepository([command]), () => 1000);
  const whispers: string[] = [];
  const handler = new WhisperInventoryActionHandler(
    { getInventoryItems: async () => [] },
    async (userId) => {
      whispers.push(userId);
    },
  );
  const engine = new AutomationEngine(
    new InMemoryAutomationRepository([automation]),
    new AutomationConditionRegistry([new AlwaysConditionHandler()]),
    new AutomationActionRegistry([handler]),
  );
  const chatEvent: ApplicationEvent = {
    ...event,
    source: 'twitch',
    type: 'twitch.channel.chat.message',
    payload: {
      chatter_user_id: '12345',
      chatter_user_login: 'viewer',
      chatter_user_name: 'Viewer',
      message: { text: '!inventory' },
      message_id: 'chat-1',
      badges: [],
    },
  };
  const result = await service.handleEvent(chatEvent);
  assert.ok(result.event);
  assert.deepEqual(await engine.handleEvent(result.event, () => undefined), [
    { automationId: automation.id, status: 'completed' },
  ]);
  assert.deepEqual(whispers, ['12345']);
  assert.equal((await service.handleEvent(chatEvent)).status, 'cooldown');
  assert.equal(
    (
      await service.handleEvent({
        ...chatEvent,
        payload: { ...chatEvent.payload, chatter_user_id: '67890' },
      })
    ).status,
    'executed',
  );
});

test('whispers owned items to the command author grouped by equipment slot', async () => {
  const inventory = new InMemoryInventoryRepository();
  let roll = 0;
  const lootboxes = new LootboxService(new InMemoryLootboxCatalogRepository(), inventory, () =>
    roll++ === 4 ? 40 : 0,
  );
  for (let index = 0; index < 3; index++) {
    await lootboxes.open({
      boxId: starterLootboxCatalog.lootboxes[0].id,
      redemptionId: `drop-${index}`,
      userId: '12345',
    });
  }
  await inventory.equip('12345', 'message-color', 'ember-text');
  const whispers: Array<{ userId: string; message: string }> = [];
  const handler = new WhisperInventoryActionHandler(lootboxes, async (userId, message) => {
    whispers.push({ userId, message });
  });
  assert.equal(
    await handler.execute({ type: 'whisper-inventory' }, { event, emit: () => undefined }),
    'continue',
  );
  assert.equal(whispers.length, 1);
  assert.equal(whispers[0].userId, '12345');
  assert.match(whispers[0].message, /Üzenetszín: Parázsvörös Szöveg/);
  assert.match(whispers[0].message, /Névszín: Mentazöld Név/);
  assert.match(whispers[0].message, /Üzenetszín: Parázsvörös Szöveg \[felszerelve\]/);
  assert.equal(whispers[0].message.match(/\[felszerelve\]/g)?.length, 1);
  assert.ok(!whispers[0].message.includes(' x2'));
  assert.match(whispers[0].message, /Szegélystílus: nincs/);
  assert.deepEqual(await lootboxes.getInventoryItems('67890'), []);
});

test('formats every starter item with only its Hungarian equipment slot and name', () => {
  const items: OwnedInventoryItem[] = starterLootboxCatalog.items.map((item) => ({
    equipped: false,
    itemId: item.id,
    name: item.name,
    quantity: 1,
    rarity: item.rarity,
    slot: item.cosmetic.slot,
  }));
  assert.equal(
    formatInventoryWhispers(items).join(' '),
    'Inventory' +
      ' | Üzenetszín: Parázsvörös Szöveg' +
      ' | Névszín: Mentazöld Név' +
      ' | Szegélyszín: Aranyozott Keret' +
      ' | Szegélystílus: Csillagfényes Keret' +
      ' | Belépési effekt: Becsúszás',
  );
});

test('handles empty inventories and propagates whisper failures without a public fallback', async () => {
  const handler = new WhisperInventoryActionHandler(
    { getInventoryItems: async () => [] },
    async (userId, message) => {
      assert.equal(userId, '12345');
      assert.equal(message, 'Az inventoryd üres.');
      throw new Error('Whispers are blocked.');
    },
  );
  await assert.rejects(
    handler.execute({ type: 'whisper-inventory' }, { event, emit: () => undefined }),
    /blocked/,
  );
  await assert.rejects(
    handler.execute(
      { type: 'whisper-inventory' },
      {
        event: { ...event, type: 'twitch.channel.chat.message' },
        emit: () => undefined,
      },
    ),
    /command/,
  );
});

test('splits large inventories into bounded whispers without losing items', () => {
  const items: OwnedInventoryItem[] = Array.from({ length: 25 }, (_, index) => ({
    equipped: false,
    itemId: `item-${index}`,
    name: `${index} ${'Long name '.repeat(7)}`,
    quantity: 2,
    rarity: 'common',
    slot: 'message-color',
  }));
  items.push({
    equipped: false,
    itemId: 'removed',
    name: 'removed',
    quantity: 1,
    rarity: null,
    slot: null,
  });
  const messages = formatInventoryWhispers(items);
  assert.ok(messages.length > 1);
  assert.ok(messages.every((message) => message.length <= 500));
  assert.match(messages.join('\n'), /Egyéb tárgyak: removed/);
  assert.ok(messages.slice(1).every((message) => message.startsWith('Inventory (folytatás)')));
  for (const item of items) {
    assert.ok(messages.join('\n').includes(item.name.trim()));
  }
});
