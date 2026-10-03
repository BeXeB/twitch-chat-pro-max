import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryInventoryRepository } from '../src/features/inventory/inventory-repository';
import {
  InMemoryLootboxCatalogRepository,
  starterLootboxCatalog,
} from '../src/features/lootboxes/lootbox-catalog-repository';
import { LootboxService } from '../src/features/lootboxes/lootbox-service';

test('equips an owned item by its full name without changing quantities', async () => {
  const inventory = new InMemoryInventoryRepository();
  const catalog = structuredClone(starterLootboxCatalog);
  catalog.items[0].name = 'Ember Text';
  const service = new LootboxService(
    new InMemoryLootboxCatalogRepository(catalog),
    inventory,
    () => 0,
  );
  await service.open({ boxId: 'common-lootbox', redemptionId: 'equip-drop', userId: '12345' });
  assert.deepEqual(await service.equipByName('12345', '  EMBER   text  '), {
    status: 'equipped',
    itemName: 'Ember Text',
  });
  assert.deepEqual((await inventory.getByUserId('12345'))?.equippedCosmetics, {
    'message-color': 'ember-text',
  });
  assert.deepEqual((await inventory.getByUserId('12345'))?.items, [
    { itemId: 'ember-text', quantity: 1 },
  ]);
  assert.deepEqual(await service.equipByName('67890', 'Ember Text'), { status: 'not-owned' });
  assert.deepEqual(await service.equipByName('12345', 'missing'), { status: 'not-owned' });
  assert.deepEqual(await service.equipByName('12345', '   '), { status: 'name-missing' });
  await assert.rejects(service.equipByName('invalid', 'Ember Text'), /user ID/i);
});

test('replaces only the matching slot and rejects ambiguous or removed equipment names', async () => {
  const inventory = new InMemoryInventoryRepository();
  const catalog = structuredClone(starterLootboxCatalog);
  catalog.items.push({
    id: 'rose-text',
    name: 'Rose Text',
    rarity: 'common',
    cosmetic: { slot: 'message-color', value: '#FF0000' },
  });
  const service = new LootboxService(new InMemoryLootboxCatalogRepository(catalog), inventory);
  for (const itemId of ['ember-text', 'mint-signature', 'rose-text', 'removed']) {
    await inventory.awardOpening({
      acquiredAt: '2026-10-03T00:00:00.000Z',
      announced: true,
      boxId: 'common-lootbox',
      boxName: 'Cache',
      itemId,
      itemName: itemId,
      redemptionId: itemId,
      userId: '12345',
    });
  }
  await inventory.equip('12345', 'message-color', 'ember-text');
  await inventory.equip('12345', 'username-color', 'mint-signature');
  assert.equal((await service.equipByName('12345', 'Rose Text')).status, 'equipped');
  assert.deepEqual((await inventory.getByUserId('12345'))?.equippedCosmetics, {
    'message-color': 'rose-text',
    'username-color': 'mint-signature',
  });
  assert.deepEqual(await service.equipByName('12345', 'removed'), { status: 'not-owned' });
  catalog.items[0].name = 'Rose Text';
  const ambiguousService = new LootboxService(
    new InMemoryLootboxCatalogRepository(catalog),
    inventory,
  );
  assert.deepEqual(await ambiguousService.equipByName('12345', 'Rose Text'), {
    status: 'ambiguous',
  });
  assert.equal(
    (await inventory.getByUserId('12345'))?.equippedCosmetics['message-color'],
    'rose-text',
  );
});

test('selects the item at each rarity-weight boundary', async () => {
  const cases = [
    [0, 'ember-text'],
    [39, 'ember-text'],
    [40, 'mint-signature'],
    [64, 'mint-signature'],
    [65, 'gilded-edge'],
    [84, 'gilded-edge'],
    [85, 'starlight-frame'],
    [94, 'starlight-frame'],
    [95, 'slide-entry'],
    [99, 'slide-entry'],
  ] as const;

  for (const [selectedIndex, expectedItemId] of cases) {
    let rollNumber = 0;
    const service = new LootboxService(
      new InMemoryLootboxCatalogRepository(),
      new InMemoryInventoryRepository(),
      () => (rollNumber++ === 0 ? selectedIndex : 0),
    );

    const opening = await service.open({
      boxId: 'common-lootbox',
      redemptionId: `redemption-${selectedIndex}`,
      userId: '12345',
    });

    assert.equal(opening.itemId, expectedItemId);
  }
});

test('selects uniformly among items of the rolled rarity', async () => {
  const catalog = structuredClone(starterLootboxCatalog);
  catalog.items.push({
    cosmetic: { slot: 'message-color', value: '#FF0000' },
    id: 'rose-text',
    name: 'Rose Text',
    rarity: 'common',
  });
  catalog.lootboxes[0].itemIds.push('rose-text');

  for (const [selectedItemIndex, expectedItemId] of [
    [0, 'ember-text'],
    [1, 'rose-text'],
  ] as const) {
    let rollNumber = 0;
    const selectedIndexes = [0, selectedItemIndex] as const;
    const rollMaximums: number[] = [];
    const service = new LootboxService(
      new InMemoryLootboxCatalogRepository(catalog),
      new InMemoryInventoryRepository(),
      (exclusiveMaximum) => {
        rollMaximums.push(exclusiveMaximum);
        return selectedIndexes[rollNumber++] ?? 0;
      },
    );

    const opening = await service.open({
      boxId: 'common-lootbox',
      redemptionId: `common-${selectedItemIndex}`,
      userId: '12345',
    });

    assert.equal(opening.itemId, expectedItemId);
    assert.equal(rollNumber, 2);
    assert.deepEqual(rollMaximums, [100, 2]);
  }
});

test('limits selectable items to the lootbox item list', async () => {
  const catalog = structuredClone(starterLootboxCatalog);
  catalog.items.push({
    cosmetic: { slot: 'message-color', value: '#FF0000' },
    id: 'rose-text',
    name: 'Rose Text',
    rarity: 'common',
  });
  catalog.lootboxes.push({
    id: 'rose-cache',
    itemIds: ['rose-text'],
    name: 'Rose Cache',
    rarityWeights: { common: 1 },
  });
  const service = new LootboxService(
    new InMemoryLootboxCatalogRepository(catalog),
    new InMemoryInventoryRepository(),
    () => 0,
  );

  const opening = await service.open({
    boxId: 'rose-cache',
    redemptionId: 'rose-redemption',
    userId: '12345',
  });

  assert.equal(opening.itemId, 'rose-text');
});

test('returns the original result for a repeated redemption without another roll or grant', async () => {
  const inventory = new InMemoryInventoryRepository();
  let rolls = 0;
  const service = new LootboxService(
    new InMemoryLootboxCatalogRepository(),
    inventory,
    () => {
      rolls += 1;
      return 0;
    },
    () => new Date('2026-09-27T00:00:00.000Z'),
  );
  const request = {
    boxId: 'common-lootbox',
    redemptionId: 'redemption-1',
    userId: '12345',
  };

  const firstOpening = await service.open(request);
  const repeatedOpening = await service.open(request);

  assert.deepEqual(repeatedOpening, firstOpening);
  assert.equal(rolls, 2);
  assert.deepEqual(await inventory.getByUserId('12345'), {
    equippedCosmetics: {},
    items: [{ itemId: 'ember-text', quantity: 1 }],
    userId: '12345',
  });
});

test('resolves equipped catalog items into per-user cosmetic values', async () => {
  const inventory = new InMemoryInventoryRepository();
  await inventory.awardOpening({
    acquiredAt: '2026-09-27T00:00:00.000Z',
    announced: true,
    boxId: 'common-lootbox',
    boxName: 'Chat Style Cache',
    itemId: 'ember-text',
    itemName: 'Parázsszöveg',
    redemptionId: 'redemption-1',
    userId: '12345',
  });
  await inventory.equip('12345', 'message-color', 'ember-text');
  const service = new LootboxService(new InMemoryLootboxCatalogRepository(), inventory);

  assert.deepEqual(await service.getEquippedCosmetics(), {
    '12345': { 'message-color': '#FF735C' },
  });
});

test('rejects unknown lootboxes and invalid user IDs', async () => {
  const service = new LootboxService(
    new InMemoryLootboxCatalogRepository(),
    new InMemoryInventoryRepository(),
  );

  await assert.rejects(
    service.open({ boxId: 'missing-box', redemptionId: 'redemption-1', userId: '12345' }),
    /Unknown lootbox/,
  );
  await assert.rejects(
    service.open({ boxId: 'common-lootbox', redemptionId: 'redemption-1', userId: 'viewer' }),
    /user ID is invalid/,
  );
});
