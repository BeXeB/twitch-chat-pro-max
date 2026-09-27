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
