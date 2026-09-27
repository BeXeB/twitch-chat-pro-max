import {
  InventoryDocument,
  InventoryOpeningRecord,
  UserInventory,
} from '../../../../shared/contracts/inventory';
import { CosmeticSlot } from '../../../../shared/contracts/lootboxes';

export interface InventoryRepository {
  awardOpening(opening: InventoryOpeningRecord): Promise<InventoryOpeningRecord>;
  equip(userId: string, slot: CosmeticSlot, itemId: string): Promise<UserInventory>;
  getByUserId(userId: string): Promise<UserInventory | null>;
  getOpening(redemptionId: string): Promise<InventoryOpeningRecord | null>;
  list(): Promise<UserInventory[]>;
  markOpeningAnnounced(redemptionId: string): Promise<void>;
  unequip(userId: string, slot: CosmeticSlot): Promise<UserInventory>;
}

export class InMemoryInventoryRepository implements InventoryRepository {
  private document: InventoryDocument = { inventories: [], openings: [], version: 1 };

  async awardOpening(opening: InventoryOpeningRecord): Promise<InventoryOpeningRecord> {
    validateOpening(opening);
    const existing = this.document.openings.find(
      (candidate) => candidate.redemptionId === opening.redemptionId,
    );

    if (existing) {
      assertInventoryRedemption(existing, opening);
      return structuredClone(existing);
    }

    const document = structuredClone(this.document);
    grantInventoryOpening(document, opening);
    this.document = document;
    return structuredClone(opening);
  }

  async equip(userId: string, slot: CosmeticSlot, itemId: string): Promise<UserInventory> {
    validateUserId(userId);
    validateEquipmentRequest(slot, itemId);
    const document = structuredClone(this.document);
    const inventory = document.inventories.find((candidate) => candidate.userId === userId);

    if (!inventory?.items.some((item) => item.itemId === itemId)) {
      throw new Error('The item is not in this inventory.');
    }

    equipItem(inventory, slot, itemId);
    this.document = document;
    return structuredClone(inventory);
  }

  async getByUserId(userId: string): Promise<UserInventory | null> {
    validateUserId(userId);
    const inventory = this.document.inventories.find((candidate) => candidate.userId === userId);
    return inventory ? structuredClone(inventory) : null;
  }

  async getOpening(redemptionId: string): Promise<InventoryOpeningRecord | null> {
    const opening = this.document.openings.find(
      (candidate) => candidate.redemptionId === redemptionId,
    );
    return opening ? structuredClone(opening) : null;
  }

  async list(): Promise<UserInventory[]> {
    return structuredClone(this.document.inventories);
  }

  async markOpeningAnnounced(redemptionId: string): Promise<void> {
    const document = structuredClone(this.document);
    const opening = document.openings.find((candidate) => candidate.redemptionId === redemptionId);

    if (!opening) {
      throw new Error('The lootbox opening was not found.');
    }

    opening.announced = true;
    this.document = document;
  }

  async unequip(userId: string, slot: CosmeticSlot): Promise<UserInventory> {
    validateUserId(userId);
    if (!isCosmeticSlot(slot)) {
      throw new Error('The cosmetic slot is invalid.');
    }

    const document = structuredClone(this.document);
    const inventory = document.inventories.find((candidate) => candidate.userId === userId);
    if (!inventory) {
      throw new Error('The inventory was not found.');
    }

    delete inventory.equippedCosmetics[slot];
    this.document = document;
    return structuredClone(inventory);
  }
}

export function assertInventoryRedemption(
  existing: InventoryOpeningRecord,
  requested: InventoryOpeningRecord,
): void {
  if (existing.userId !== requested.userId || existing.boxId !== requested.boxId) {
    throw new Error('The redemption ID is already associated with another lootbox opening.');
  }
}

export function grantInventoryOpening(
  document: InventoryDocument,
  opening: InventoryOpeningRecord,
): void {
  const inventory = document.inventories.find((candidate) => candidate.userId === opening.userId);

  if (inventory) {
    const stack = inventory.items.find((item) => item.itemId === opening.itemId);

    if (stack) {
      if (!Number.isSafeInteger(stack.quantity + 1)) {
        throw new Error('The inventory item quantity is too high.');
      }
      stack.quantity += 1;
    } else {
      inventory.items.push({ itemId: opening.itemId, quantity: 1 });
    }
  } else {
    document.inventories.push({
      equippedCosmetics: {},
      items: [{ itemId: opening.itemId, quantity: 1 }],
      userId: opening.userId,
    });
  }

  document.openings.push(structuredClone(opening));
  if (document.openings.length > MAX_OPENING_RECORDS) {
    document.openings.splice(0, document.openings.length - MAX_OPENING_RECORDS);
  }
}

export function validateOpening(opening: InventoryOpeningRecord): void {
  if (
    !isRecord(opening) ||
    !isValidUserId(opening.userId) ||
    !isText(opening.redemptionId) ||
    !isText(opening.boxId) ||
    !isText(opening.boxName) ||
    !isText(opening.itemId) ||
    !isText(opening.itemName) ||
    !isTimestamp(opening.acquiredAt) ||
    typeof opening.announced !== 'boolean'
  ) {
    throw new Error('The lootbox opening is invalid.');
  }
}

export function validateUserId(userId: string): void {
  if (!isValidUserId(userId)) {
    throw new Error('The Twitch user ID is invalid.');
  }
}

export function isCosmeticSlot(value: unknown): value is CosmeticSlot {
  return (
    value === 'border-color' ||
    value === 'border-style' ||
    value === 'entry-effect' ||
    value === 'message-color' ||
    value === 'username-color'
  );
}

export function validateEquipmentRequest(slot: CosmeticSlot, itemId: string): void {
  if (!isCosmeticSlot(slot) || !isText(itemId)) {
    throw new Error('The equipped cosmetic is invalid.');
  }
}

export function equipItem(inventory: UserInventory, slot: CosmeticSlot, itemId: string): void {
  for (const [equippedSlot, equippedItemId] of Object.entries(inventory.equippedCosmetics)) {
    if (equippedItemId === itemId && equippedSlot !== slot) {
      delete inventory.equippedCosmetics[equippedSlot as CosmeticSlot];
    }
  }

  inventory.equippedCosmetics[slot] = itemId;
}

export function isInventoryDocument(value: unknown): value is InventoryDocument {
  if (
    !isRecord(value) ||
    value['version'] !== 1 ||
    !Array.isArray(value['inventories']) ||
    !Array.isArray(value['openings'])
  ) {
    return false;
  }

  const userIds = new Set<string>();
  const redemptionIds = new Set<string>();

  return (
    value['inventories'].every((candidate: unknown) => {
      if (!isUserInventory(candidate) || userIds.has(candidate.userId)) {
        return false;
      }

      userIds.add(candidate.userId);
      return true;
    }) &&
    value['openings'].every((candidate: unknown) => {
      if (!isInventoryOpeningRecord(candidate) || redemptionIds.has(candidate.redemptionId)) {
        return false;
      }

      redemptionIds.add(candidate.redemptionId);
      return true;
    })
  );
}

function isUserInventory(value: unknown): value is UserInventory {
  if (
    !isRecord(value) ||
    !isValidUserId(value['userId']) ||
    !Array.isArray(value['items']) ||
    !isRecord(value['equippedCosmetics'])
  ) {
    return false;
  }

  const itemIds = new Set<string>();
  const validItems = value['items'].every((item: unknown) => {
    if (
      !isRecord(item) ||
      !isText(item['itemId']) ||
      !isPositiveSafeInteger(item['quantity']) ||
      itemIds.has(item['itemId'])
    ) {
      return false;
    }

    itemIds.add(item['itemId']);
    return true;
  });

  return (
    validItems &&
    Object.entries(value['equippedCosmetics']).every(
      ([slot, itemId]) => isCosmeticSlot(slot) && typeof itemId === 'string' && itemIds.has(itemId),
    )
  );
}

function isInventoryOpeningRecord(value: unknown): value is InventoryOpeningRecord {
  return (
    isRecord(value) &&
    isValidUserId(value['userId']) &&
    isText(value['redemptionId']) &&
    isText(value['boxId']) &&
    isText(value['boxName']) &&
    isText(value['itemId']) &&
    isText(value['itemName']) &&
    isTimestamp(value['acquiredAt']) &&
    typeof value['announced'] === 'boolean'
  );
}

function isValidUserId(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MAX_OPENING_RECORDS = 5000;
