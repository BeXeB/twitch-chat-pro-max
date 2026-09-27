import { randomInt } from 'node:crypto';

import { InventoryOpeningRecord } from '../../../../shared/contracts/inventory';
import { LootboxDefinition, LootboxItemDefinition } from '../../../../shared/contracts/lootboxes';
import { InventoryRepository, validateUserId } from '../inventory/inventory-repository';
import { LootboxCatalogRepository } from './lootbox-catalog-repository';

export interface OpenLootboxRequest {
  boxId: string;
  redemptionId: string;
  userId: string;
}

export class LootboxService {
  constructor(
    private readonly catalog: LootboxCatalogRepository,
    private readonly inventory: InventoryRepository,
    private readonly chooseIndex: (exclusiveMaximum: number) => number = randomInt,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async open(request: OpenLootboxRequest): Promise<InventoryOpeningRecord> {
    validateUserId(request.userId);
    if (!isText(request.boxId) || !isText(request.redemptionId)) {
      throw new Error('The lootbox redemption is invalid.');
    }

    const existing = await this.inventory.getOpening(request.redemptionId);
    if (existing) {
      if (existing.userId !== request.userId || existing.boxId !== request.boxId) {
        throw new Error('The redemption ID is already associated with another lootbox opening.');
      }
      return existing;
    }

    const catalog = await this.catalog.getCatalog();
    const lootbox = catalog.lootboxes.find((candidate) => candidate.id === request.boxId);
    if (!lootbox) {
      throw new Error(`Unknown lootbox: ${request.boxId}.`);
    }

    const itemById = new Map(catalog.items.map((item) => [item.id, item]));
    const item = selectDrop(lootbox, itemById, this.chooseIndex);
    const opening: InventoryOpeningRecord = {
      acquiredAt: this.now().toISOString(),
      announced: false,
      boxId: lootbox.id,
      boxName: lootbox.name,
      itemId: item.id,
      itemName: item.name,
      redemptionId: request.redemptionId,
      userId: request.userId,
    };

    return this.inventory.awardOpening(opening);
  }

  async markAnnounced(redemptionId: string): Promise<void> {
    return this.inventory.markOpeningAnnounced(redemptionId);
  }
}

function selectDrop(
  lootbox: LootboxDefinition,
  itemById: Map<string, LootboxItemDefinition>,
  chooseIndex: (exclusiveMaximum: number) => number,
): LootboxItemDefinition {
  const totalWeight = lootbox.drops.reduce((total, drop) => total + drop.weight, 0);
  const selectedIndex = chooseIndex(totalWeight);

  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= totalWeight) {
    throw new Error('The lootbox random roll is invalid.');
  }

  let remainingWeight = selectedIndex;
  for (const drop of lootbox.drops) {
    remainingWeight -= drop.weight;
    if (remainingWeight < 0) {
      const item = itemById.get(drop.itemId);
      if (!item) {
        throw new Error(`The lootbox references an unknown item: ${drop.itemId}.`);
      }
      return item;
    }
  }

  throw new Error('The lootbox has no selectable drops.');
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
