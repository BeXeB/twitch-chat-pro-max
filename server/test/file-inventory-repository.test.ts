import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { InventoryOpeningRecord } from '../../shared/contracts/inventory';
import { FileInventoryRepository } from '../src/features/inventory/file-inventory-repository';

test('serializes duplicate awards and persists inventory across repository instances', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twitch-runtime-inventory-'));
  const filePath = join(directory, 'inventories.json');

  try {
    const repository = new FileInventoryRepository(filePath);
    const opening = createOpening();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repository.awardOpening(opening)),
    );

    assert.deepEqual(
      results,
      Array.from({ length: 8 }, () => opening),
    );
    assert.deepEqual(await repository.getByUserId('12345'), {
      equippedCosmetics: {},
      items: [{ itemId: 'ember-text', quantity: 1 }],
      userId: '12345',
    });

    await repository.awardOpening({ ...opening, redemptionId: 'redemption-2' });
    const reloadedRepository = new FileInventoryRepository(filePath);
    assert.deepEqual(await reloadedRepository.getByUserId('12345'), {
      equippedCosmetics: {},
      items: [{ itemId: 'ember-text', quantity: 2 }],
      userId: '12345',
    });
    assert.equal((await reloadedRepository.list()).length, 1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('persists equipped cosmetics and rejects equipping unowned items', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twitch-runtime-inventory-'));

  try {
    const repository = new FileInventoryRepository(join(directory, 'inventories.json'));
    await repository.awardOpening(createOpening());

    assert.deepEqual(await repository.equip('12345', 'message-color', 'ember-text'), {
      equippedCosmetics: { 'message-color': 'ember-text' },
      items: [{ itemId: 'ember-text', quantity: 1 }],
      userId: '12345',
    });
    await assert.rejects(repository.equip('12345', 'username-color', 'missing-item'));

    const reloadedRepository = new FileInventoryRepository(join(directory, 'inventories.json'));
    assert.deepEqual((await reloadedRepository.getByUserId('12345'))?.equippedCosmetics, {
      'message-color': 'ember-text',
    });
    assert.deepEqual(await reloadedRepository.unequip('12345', 'message-color'), {
      equippedCosmetics: {},
      items: [{ itemId: 'ember-text', quantity: 1 }],
      userId: '12345',
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

function createOpening(): InventoryOpeningRecord {
  return {
    acquiredAt: '2026-09-27T00:00:00.000Z',
    announced: false,
    boxId: 'common-lootbox',
    boxName: 'Chat Style Cache',
    itemId: 'ember-text',
    itemName: 'Ember Text',
    redemptionId: 'redemption-1',
    userId: '12345',
  };
}
