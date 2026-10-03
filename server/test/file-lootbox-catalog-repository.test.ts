import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { FileLootboxCatalogRepository } from '../src/features/lootboxes/file-lootbox-catalog-repository';
import {
  isLootboxCatalogDocument,
  starterLootboxCatalog,
} from '../src/features/lootboxes/lootbox-catalog-repository';

test('loads the configured local catalog with item lists on lootboxes', async () => {
  const repository = new FileLootboxCatalogRepository(
    join(process.cwd(), 'data/lootbox-catalog.json'),
  );
  const catalog = await repository.getCatalog();

  assert.equal(isLootboxCatalogDocument(catalog), true);
  assert.equal(
    catalog.items.some((item) => 'itemIds' in item),
    false,
  );
});

test('seeds a starter catalog only when the local file is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twitch-runtime-lootboxes-'));
  const filePath = join(directory, 'lootbox-catalog.json');

  try {
    const repository = new FileLootboxCatalogRepository(filePath);
    assert.deepEqual(await repository.getCatalog(), starterLootboxCatalog);
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), starterLootboxCatalog);

    const customCatalog = structuredClone(starterLootboxCatalog);
    customCatalog.items[0].name = 'Custom Sword';
    await writeFile(filePath, JSON.stringify(customCatalog), 'utf8');

    const reloadedRepository = new FileLootboxCatalogRepository(filePath);
    assert.deepEqual(await reloadedRepository.getCatalog(), customCatalog);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('validates cosmetic values for message colors, borders, and entry effects', () => {
  assert.equal(isLootboxCatalogDocument(starterLootboxCatalog), true);

  const invalidColor = structuredClone(starterLootboxCatalog);
  invalidColor.items[0].cosmetic.value = 'url(javascript:alert(1))';
  assert.equal(isLootboxCatalogDocument(invalidColor), false);

  const invalidEffect = structuredClone(starterLootboxCatalog);
  invalidEffect.items[4].cosmetic.value = 'spin-forever';
  assert.equal(isLootboxCatalogDocument(invalidEffect), false);

  const invalidSlot = structuredClone(starterLootboxCatalog);
  Reflect.set(invalidSlot.items[0].cosmetic, 'slot', 'weapon');
  assert.equal(isLootboxCatalogDocument(invalidSlot), false);
});

test('validates rarity weights against the lootbox item pool', () => {
  const invalidWeight = structuredClone(starterLootboxCatalog);
  invalidWeight.lootboxes[0].rarityWeights.common = 0;
  assert.equal(isLootboxCatalogDocument(invalidWeight), false);

  const unavailableRarity = structuredClone(starterLootboxCatalog);
  unavailableRarity.items.pop();
  assert.equal(isLootboxCatalogDocument(unavailableRarity), false);

  const unknownRarity = structuredClone(starterLootboxCatalog);
  Reflect.set(unknownRarity.lootboxes[0].rarityWeights, 'mythic', 1);
  assert.equal(isLootboxCatalogDocument(unknownRarity), false);

  const unknownItem = structuredClone(starterLootboxCatalog);
  unknownItem.lootboxes[0].itemIds.push('missing-item');
  assert.equal(isLootboxCatalogDocument(unknownItem), false);

  const duplicateItem = structuredClone(starterLootboxCatalog);
  duplicateItem.lootboxes[0].itemIds.push('ember-text');
  assert.equal(isLootboxCatalogDocument(duplicateItem), false);

  const missingWeight = structuredClone(starterLootboxCatalog);
  delete missingWeight.lootboxes[0].rarityWeights.common;
  assert.equal(isLootboxCatalogDocument(missingWeight), false);

  const emptyRarity = structuredClone(starterLootboxCatalog);
  emptyRarity.lootboxes[0].itemIds.pop();
  assert.equal(isLootboxCatalogDocument(emptyRarity), false);

  for (const weight of [-1, 0.5, NaN, Infinity, 1_000_000_000, Number.MAX_SAFE_INTEGER]) {
    const invalidTotal = structuredClone(starterLootboxCatalog);
    invalidTotal.lootboxes[0].rarityWeights.common = weight;
    assert.equal(isLootboxCatalogDocument(invalidTotal), false);
  }
});
