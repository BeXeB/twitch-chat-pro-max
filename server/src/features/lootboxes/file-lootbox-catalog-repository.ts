import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { LootboxCatalogDocument } from '../../../../shared/contracts/lootboxes';
import {
  isLootboxCatalogDocument,
  LootboxCatalogRepository,
  starterLootboxCatalog,
} from './lootbox-catalog-repository';

export class FileLootboxCatalogRepository implements LootboxCatalogRepository {
  private catalog: LootboxCatalogDocument | null = null;

  constructor(private readonly filePath: string) {}

  async getCatalog(): Promise<LootboxCatalogDocument> {
    if (this.catalog) {
      return structuredClone(this.catalog);
    }

    let content: string;
    try {
      content = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      const catalog = structuredClone(starterLootboxCatalog);
      await this.writeCatalog(catalog);
      return structuredClone(catalog);
    }

    const parsed = JSON.parse(content) as unknown;
    if (!isLootboxCatalogDocument(parsed)) {
      throw new Error('The lootbox catalog file is invalid.');
    }

    this.catalog = parsed;
    return structuredClone(parsed);
  }

  private async writeCatalog(catalog: LootboxCatalogDocument): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporaryPath, JSON.stringify(catalog, null, 2), 'utf8');
      await rename(temporaryPath, this.filePath);
      this.catalog = catalog;
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
