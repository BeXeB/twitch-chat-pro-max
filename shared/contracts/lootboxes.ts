export type CosmeticSlot =
  | 'border-color'
  | 'border-style'
  | 'entry-effect'
  | 'message-color'
  | 'username-color';

export type LootboxRarity = 'common' | 'epic' | 'legendary' | 'rare' | 'uncommon';

export interface LootboxCosmetic {
  slot: CosmeticSlot;
  value: string;
}

export interface LootboxItemDefinition {
  cosmetic: LootboxCosmetic;
  id: string;
  name: string;
  rarity: LootboxRarity;
}

export interface LootboxDrop {
  itemId: string;
  weight: number;
}

export interface LootboxDefinition {
  drops: LootboxDrop[];
  id: string;
  name: string;
}

export interface LootboxCatalogDocument {
  items: LootboxItemDefinition[];
  lootboxes: LootboxDefinition[];
  version: 1;
}
