import { CosmeticSlot } from './lootboxes';

export interface InventoryItemStack {
  itemId: string;
  quantity: number;
}

export interface UserInventory {
  equippedCosmetics: Partial<Record<CosmeticSlot, string>>;
  items: InventoryItemStack[];
  userId: string;
}

export interface InventoryOpeningRecord {
  acquiredAt: string;
  announced: boolean;
  boxId: string;
  boxName: string;
  itemId: string;
  itemName: string;
  redemptionId: string;
  userId: string;
}

export interface InventoryDocument {
  inventories: UserInventory[];
  openings: InventoryOpeningRecord[];
  version: 1;
}
