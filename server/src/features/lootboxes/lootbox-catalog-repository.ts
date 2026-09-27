import {
  isChatBorderStyle,
  isChatEntryEffect,
  LootboxCatalogDocument,
  LootboxCosmetic,
  LootboxItemDefinition,
  LootboxRarity,
} from '../../../../shared/contracts/lootboxes';

export interface LootboxCatalogRepository {
  getCatalog(): Promise<LootboxCatalogDocument>;
}

export class InMemoryLootboxCatalogRepository implements LootboxCatalogRepository {
  constructor(private readonly catalog: LootboxCatalogDocument = starterLootboxCatalog) {
    if (!isLootboxCatalogDocument(catalog)) {
      throw new Error('The lootbox catalog is invalid.');
    }
  }

  async getCatalog(): Promise<LootboxCatalogDocument> {
    return structuredClone(this.catalog);
  }
}

export const starterLootboxCatalog: LootboxCatalogDocument = {
  items: [
    {
      cosmetic: { slot: 'message-color', value: '#FF735C' },
      id: 'ember-text',
      name: 'Ember Text',
      rarity: 'common',
    },
    {
      cosmetic: { slot: 'username-color', value: '#72E0B6' },
      id: 'mint-signature',
      name: 'Mint Signature',
      rarity: 'uncommon',
    },
    {
      cosmetic: { slot: 'border-color', value: '#F0C56E' },
      id: 'gilded-edge',
      name: 'Gilded Edge',
      rarity: 'rare',
    },
    {
      cosmetic: { slot: 'border-style', value: 'starlight' },
      id: 'starlight-frame',
      name: 'Starlight Frame',
      rarity: 'epic',
    },
    {
      cosmetic: { slot: 'entry-effect', value: 'slide-in' },
      id: 'slide-entry',
      name: 'Slide Entry',
      rarity: 'legendary',
    },
  ],
  lootboxes: [
    {
      drops: [
        { itemId: 'ember-text', weight: 40 },
        { itemId: 'mint-signature', weight: 25 },
        { itemId: 'gilded-edge', weight: 20 },
        { itemId: 'starlight-frame', weight: 10 },
        { itemId: 'slide-entry', weight: 5 },
      ],
      id: 'adventurer-cache',
      name: 'Chat Style Cache',
    },
  ],
  version: 1,
};

export function isLootboxCatalogDocument(value: unknown): value is LootboxCatalogDocument {
  if (
    !isRecord(value) ||
    value['version'] !== 1 ||
    !Array.isArray(value['items']) ||
    !Array.isArray(value['lootboxes']) ||
    value['items'].length === 0 ||
    value['lootboxes'].length === 0
  ) {
    return false;
  }

  const itemIds = new Set<string>();
  if (
    !value['items'].every((item: unknown) => {
      if (!isLootboxItem(item) || itemIds.has(item.id)) {
        return false;
      }
      itemIds.add(item.id);
      return true;
    })
  ) {
    return false;
  }

  const lootboxIds = new Set<string>();
  return value['lootboxes'].every((lootbox: unknown) => {
    if (
      !isRecord(lootbox) ||
      !isId(lootbox['id']) ||
      !isDisplayName(lootbox['name']) ||
      lootboxIds.has(lootbox['id']) ||
      !Array.isArray(lootbox['drops']) ||
      lootbox['drops'].length === 0
    ) {
      return false;
    }

    lootboxIds.add(lootbox['id']);
    const dropIds = new Set<string>();
    let totalWeight = 0;

    return lootbox['drops'].every((drop: unknown) => {
      if (
        !isRecord(drop) ||
        !isId(drop['itemId']) ||
        !itemIds.has(drop['itemId']) ||
        dropIds.has(drop['itemId']) ||
        !isPositiveWeight(drop['weight'])
      ) {
        return false;
      }

      dropIds.add(drop['itemId']);
      totalWeight += drop['weight'];
      return totalWeight <= MAX_TOTAL_WEIGHT;
    });
  });
}

function isLootboxItem(value: unknown): value is LootboxItemDefinition {
  return (
    isRecord(value) &&
    isId(value['id']) &&
    isDisplayName(value['name']) &&
    isRarity(value['rarity']) &&
    isLootboxCosmetic(value['cosmetic'])
  );
}

function isLootboxCosmetic(value: unknown): value is LootboxCosmetic {
  if (!isRecord(value) || typeof value['value'] !== 'string') {
    return false;
  }

  switch (value['slot']) {
    case 'message-color':
    case 'username-color':
    case 'border-color':
      return /^#[\da-fA-F]{6}$/.test(value['value']);
    case 'border-style':
      return isChatBorderStyle(value['value']);
    case 'entry-effect':
      return isChatEntryEffect(value['value']);
    default:
      return false;
  }
}

function isRarity(value: unknown): value is LootboxRarity {
  return (
    value === 'common' ||
    value === 'uncommon' ||
    value === 'rare' ||
    value === 'epic' ||
    value === 'legendary'
  );
}

function isPositiveWeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}

function isDisplayName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 80;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MAX_TOTAL_WEIGHT = 1_000_000_000;
