import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  InventoryDocument,
  InventoryOpeningRecord,
  UserInventory,
} from '../../../../shared/contracts/inventory';
import { CosmeticSlot } from '../../../../shared/contracts/lootboxes';
import {
  assertInventoryRedemption,
  equipItem,
  grantInventoryOpening,
  InventoryRepository,
  isCosmeticSlot,
  isInventoryDocument,
  validateEquipmentRequest,
  validateOpening,
  validateUserId,
} from './inventory-repository';

const emptyDocument: InventoryDocument = { inventories: [], openings: [], version: 1 };

export class FileInventoryRepository implements InventoryRepository {
  private document: InventoryDocument | null = null;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async awardOpening(opening: InventoryOpeningRecord): Promise<InventoryOpeningRecord> {
    validateOpening(opening);

    return this.enqueue(async () => {
      const document = structuredClone(await this.loadDocument());
      const existing = document.openings.find(
        (candidate) => candidate.redemptionId === opening.redemptionId,
      );

      if (existing) {
        assertInventoryRedemption(existing, opening);
        return structuredClone(existing);
      }

      grantInventoryOpening(document, opening);
      await this.writeDocument(document);
      return structuredClone(opening);
    });
  }

  async equip(userId: string, slot: CosmeticSlot, itemId: string): Promise<UserInventory> {
    validateUserId(userId);
    validateEquipmentRequest(slot, itemId);

    return this.enqueue(async () => {
      const document = structuredClone(await this.loadDocument());
      const inventory = document.inventories.find((candidate) => candidate.userId === userId);

      if (!inventory?.items.some((item) => item.itemId === itemId)) {
        throw new Error('The item is not in this inventory.');
      }

      equipItem(inventory, slot, itemId);
      await this.writeDocument(document);
      return structuredClone(inventory);
    });
  }

  async getByUserId(userId: string): Promise<UserInventory | null> {
    validateUserId(userId);
    await this.writeQueue;
    const inventory = (await this.loadDocument()).inventories.find(
      (candidate) => candidate.userId === userId,
    );
    return inventory ? structuredClone(inventory) : null;
  }

  async getOpening(redemptionId: string): Promise<InventoryOpeningRecord | null> {
    await this.writeQueue;
    const opening = (await this.loadDocument()).openings.find(
      (candidate) => candidate.redemptionId === redemptionId,
    );
    return opening ? structuredClone(opening) : null;
  }

  async list(): Promise<UserInventory[]> {
    await this.writeQueue;
    return structuredClone((await this.loadDocument()).inventories);
  }

  async markOpeningAnnounced(redemptionId: string): Promise<void> {
    return this.enqueue(async () => {
      const document = structuredClone(await this.loadDocument());
      const opening = document.openings.find(
        (candidate) => candidate.redemptionId === redemptionId,
      );

      if (!opening) {
        throw new Error('The lootbox opening was not found.');
      }

      if (opening.announced) {
        return;
      }

      opening.announced = true;
      await this.writeDocument(document);
    });
  }

  async unequip(userId: string, slot: CosmeticSlot): Promise<UserInventory> {
    validateUserId(userId);
    if (!isCosmeticSlot(slot)) {
      throw new Error('The cosmetic slot is invalid.');
    }

    return this.enqueue(async () => {
      const document = structuredClone(await this.loadDocument());
      const inventory = document.inventories.find((candidate) => candidate.userId === userId);
      if (!inventory) {
        throw new Error('The inventory was not found.');
      }

      delete inventory.equippedCosmetics[slot];
      await this.writeDocument(document);
      return structuredClone(inventory);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async loadDocument(): Promise<InventoryDocument> {
    if (this.document) {
      return this.document;
    }

    let content: string;
    try {
      content = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
      this.document = structuredClone(emptyDocument);
      return this.document;
    }

    const parsed = JSON.parse(content) as unknown;
    if (!isInventoryDocument(parsed)) {
      throw new Error('The inventory data file is invalid.');
    }

    this.document = parsed;
    return this.document;
  }

  private async writeDocument(document: InventoryDocument): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporaryPath, JSON.stringify(document, null, 2), 'utf8');
      await rename(temporaryPath, this.filePath);
      this.document = document;
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
