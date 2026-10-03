export type CosmeticSlot =
  | 'border-color'
  | 'border-style'
  | 'entry-effect'
  | 'message-color'
  | 'username-color';

export const CHAT_BORDER_STYLES = ['neon', 'ornate', 'starlight'] as const;
export type ChatBorderStyle = (typeof CHAT_BORDER_STYLES)[number];

export const CHAT_ENTRY_EFFECTS = ['bounce-in', 'drift-up', 'fade-in', 'slide-in'] as const;
export type ChatEntryEffect = (typeof CHAT_ENTRY_EFFECTS)[number];

export type ChatCosmeticsByUserId = Record<string, Partial<Record<CosmeticSlot, string>>>;

export const LOOTBOX_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type LootboxRarity = (typeof LOOTBOX_RARITIES)[number];

export type LootboxCosmetic = {
  [Slot in CosmeticSlot]: { slot: Slot; value: CosmeticValueBySlot[Slot] };
}[CosmeticSlot];

type CosmeticValueBySlot = {
  'border-color': string;
  'border-style': ChatBorderStyle;
  'entry-effect': ChatEntryEffect;
  'message-color': string;
  'username-color': string;
};

export interface LootboxItemDefinition {
  cosmetic: LootboxCosmetic;
  id: string;
  name: string;
  rarity: LootboxRarity;
}

export interface LootboxDefinition {
  id: string;
  itemIds: string[];
  name: string;
  rarityWeights: Partial<Record<LootboxRarity, number>>;
}

export interface LootboxCatalogDocument {
  items: LootboxItemDefinition[];
  lootboxes: LootboxDefinition[];
  version: 1;
}

export function isChatBorderStyle(value: unknown): value is ChatBorderStyle {
  return typeof value === 'string' && CHAT_BORDER_STYLES.some((style) => style === value);
}

export function isChatEntryEffect(value: unknown): value is ChatEntryEffect {
  return typeof value === 'string' && CHAT_ENTRY_EFFECTS.some((effect) => effect === value);
}
