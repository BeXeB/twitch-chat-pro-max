import { randomInt } from 'node:crypto';

import { InventoryOpeningRecord } from '../../../../shared/contracts/inventory';
import {
  ChatCosmeticsByUserId,
  CosmeticSlot,
  LootboxDefinition,
  LootboxItemDefinition,
  LootboxRarity,
} from '../../../../shared/contracts/lootboxes';
import {
  InventoryRepository,
  isCosmeticSlot,
  validateUserId,
} from '../inventory/inventory-repository';
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

  async getEquippedCosmetics(): Promise<ChatCosmeticsByUserId> {
    const [catalog, inventories] = await Promise.all([
      this.catalog.getCatalog(),
      this.inventory.list(),
    ]);
    const itemsById = new Map(catalog.items.map((item) => [item.id, item]));
    const cosmeticsByUserId: ChatCosmeticsByUserId = {};

    for (const inventory of inventories) {
      const cosmetics: Partial<Record<CosmeticSlot, string>> = {};

      for (const [slot, itemId] of Object.entries(inventory.equippedCosmetics)) {
        if (!isCosmeticSlot(slot)) {
          continue;
        }

        const item = itemsById.get(itemId);
        if (item?.cosmetic.slot === slot) {
          cosmetics[slot] = item.cosmetic.value;
        }
      }

      if (Object.keys(cosmetics).length > 0) {
        cosmeticsByUserId[inventory.userId] = cosmetics;
      }
    }

    return cosmeticsByUserId;
  }
}

function selectDrop(
  lootbox: LootboxDefinition,
  itemById: Map<string, LootboxItemDefinition>,
  chooseIndex: (exclusiveMaximum: number) => number,
): LootboxItemDefinition {
  const rarityWeights = Object.entries(lootbox.rarityWeights) as [LootboxRarity, number][];
  const totalWeight = rarityWeights.reduce((total, [, weight]) => total + weight, 0);
  let remainingWeight = chooseIndex(totalWeight);

  if (!Number.isInteger(remainingWeight) || remainingWeight < 0 || remainingWeight >= totalWeight) {
    throw new Error('The lootbox random roll is invalid.');
  }

  let selectedRarity: LootboxRarity | undefined;
  for (const [rarity, weight] of rarityWeights) {
    remainingWeight -= weight;
    if (remainingWeight < 0) {
      selectedRarity = rarity;
      break;
    }
  }

  if (!selectedRarity) {
    throw new Error('The lootbox has no selectable rarities.');
  }

  const rarityItems: LootboxItemDefinition[] = [];
  for (const itemId of lootbox.itemIds) {
    const item = itemById.get(itemId);
    if (item?.rarity === selectedRarity) {
      rarityItems.push(item);
    }
  }
  const selectedItemIndex = chooseIndex(rarityItems.length);
  if (
    !Number.isInteger(selectedItemIndex) ||
    selectedItemIndex < 0 ||
    selectedItemIndex >= rarityItems.length
  ) {
    throw new Error('The lootbox random roll is invalid.');
  }

  const selectedItem = rarityItems[selectedItemIndex];
  if (!selectedItem) {
    throw new Error('The lootbox has no selectable items.');
  }

  return selectedItem;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
