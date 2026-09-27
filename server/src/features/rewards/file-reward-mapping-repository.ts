import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { RewardAutomationMapping } from '../../../../shared/contracts/rewards';
import { RewardMappingRepository } from './reward-mapping-repository';

interface RewardMappingDocument {
  mappings: RewardAutomationMapping[];
  version: 1;
}

const emptyDocument: RewardMappingDocument = {
  mappings: [],
  version: 1,
};

export class FileRewardMappingRepository implements RewardMappingRepository {
  private document: RewardMappingDocument | null = null;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async get(rewardId: string): Promise<RewardAutomationMapping | null> {
    const document = await this.loadDocument();
    const mapping = document.mappings.find(
      (existingMapping) => existingMapping.rewardId === rewardId,
    );

    return mapping ? structuredClone(mapping) : null;
  }

  async list(): Promise<RewardAutomationMapping[]> {
    const document = await this.loadDocument();

    return structuredClone(document.mappings);
  }

  async remove(rewardId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const document = await this.loadDocument();
      const index = document.mappings.findIndex((mapping) => mapping.rewardId === rewardId);

      if (index === -1) {
        return false;
      }

      document.mappings.splice(index, 1);
      await this.writeDocument(document);
      return true;
    });
  }

  async upsert(mapping: RewardAutomationMapping): Promise<void> {
    return this.enqueue(async () => {
      const document = await this.loadDocument();
      const index = document.mappings.findIndex(
        (existingMapping) => existingMapping.rewardId === mapping.rewardId,
      );

      if (index === -1) {
        document.mappings.push(structuredClone(mapping));
      } else {
        document.mappings[index] = structuredClone(mapping);
      }

      await this.writeDocument(document);
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

  private async loadDocument(): Promise<RewardMappingDocument> {
    if (this.document) {
      return this.document;
    }

    let content: string;

    try {
      content = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) {
        this.document = structuredClone(emptyDocument);
        return this.document;
      }

      throw error;
    }

    const parsed = JSON.parse(content) as unknown;

    if (!isRewardMappingDocument(parsed)) {
      throw new Error('The reward mapping configuration file is invalid.');
    }

    this.document = parsed;
    return this.document;
  }

  private async writeDocument(document: RewardMappingDocument): Promise<void> {
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

export function isRewardAutomationMapping(value: unknown): value is RewardAutomationMapping {
  return (
    isRecord(value) &&
    value['version'] === 1 &&
    typeof value['rewardId'] === 'string' &&
    value['rewardId'].trim().length > 0 &&
    typeof value['automationId'] === 'string' &&
    value['automationId'].trim().length > 0 &&
    (value['completionPolicy'] === 'auto-cancel' ||
      value['completionPolicy'] === 'auto-fulfill' ||
      value['completionPolicy'] === 'manual-review')
  );
}

function isRewardMappingDocument(value: unknown): value is RewardMappingDocument {
  return (
    isRecord(value) &&
    value['version'] === 1 &&
    Array.isArray(value['mappings']) &&
    value['mappings'].every(isRewardAutomationMapping)
  );
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
