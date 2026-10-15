export type CosmeticSlot =
  | 'background-color'
  | 'border'
  | 'entry-effect'
  | 'message-color'
  | 'message-font'
  | 'username-color';

export const CHAT_BORDER_STYLES = ['neon', 'ornate', 'starlight'] as const;
export type ChatBorderStyle = (typeof CHAT_BORDER_STYLES)[number];
export type ChatBorderValue = ChatBorderStyle | `#${string}`;

export const CHAT_BACKGROUND_PRESETS = ['split-contrast-blue'] as const;
export type ChatBackgroundPreset = (typeof CHAT_BACKGROUND_PRESETS)[number];
export type ChatBackgroundValue = ChatBackgroundPreset | `#${string}`;

export const CHAT_ENTRY_EFFECTS = ['bounce-in', 'drift-up', 'fade-in', 'slide-in'] as const;
export type ChatEntryEffect = (typeof CHAT_ENTRY_EFFECTS)[number];

export const CHAT_MESSAGE_FONTS = ['jetbrains-mono'] as const;
export type ChatMessageFont = (typeof CHAT_MESSAGE_FONTS)[number];

export type ChatCosmeticsByUserId = Record<string, Partial<CosmeticValuesBySlot>>;

export const LOOTBOX_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type LootboxRarity = (typeof LOOTBOX_RARITIES)[number];

export type LootboxCosmetic = {
  [Slot in CosmeticSlot]: { slot: Slot; value: CosmeticValueBySlot[Slot] };
}[CosmeticSlot];

type CosmeticValueBySlot = {
  'background-color': ChatBackgroundValue;
  border: ChatBorderValue;
  'entry-effect': ChatEntryEffect;
  'message-color': string;
  'message-font': ChatMessageFont;
  'username-color': string;
};

export type CosmeticValuesBySlot = CosmeticValueBySlot;

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

export function isChatBorderColor(value: unknown): value is `#${string}` {
  return typeof value === 'string' && /^#[\da-fA-F]{6}$/.test(value);
}

export function isChatBackgroundValue(value: unknown): value is ChatBackgroundValue {
  return isChatBorderColor(value) || isChatBackgroundPreset(value);
}

export function isChatBackgroundPreset(value: unknown): value is ChatBackgroundPreset {
  return typeof value === 'string' && CHAT_BACKGROUND_PRESETS.some((preset) => preset === value);
}

export function isChatEntryEffect(value: unknown): value is ChatEntryEffect {
  return typeof value === 'string' && CHAT_ENTRY_EFFECTS.some((effect) => effect === value);
}

export function isChatMessageFont(value: unknown): value is ChatMessageFont {
  return typeof value === 'string' && CHAT_MESSAGE_FONTS.some((font) => font === value);
}
