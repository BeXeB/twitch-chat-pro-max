import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { ApplicationEvent } from '../../../../shared/contracts/runtime-events';
import { isAutomationAction } from '../automations/file-automation-repository';
import {
  AutomationContinuation,
  ContinuationReviewReason,
} from './automation-continuation';
import { ContinuationRepository } from './continuation-repository';

interface ContinuationDocument {
  continuations: AutomationContinuation[];
  version: 1;
}

const emptyDocument: ContinuationDocument = {
  continuations: [],
  version: 1,
};

export class FileContinuationRepository implements ContinuationRepository {
  private document: ContinuationDocument | null = null;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async get(id: string): Promise<AutomationContinuation | null> {
    const document = await this.loadDocument();
    const continuation = document.continuations.find(
      (existingContinuation) => existingContinuation.id === id,
    );

    return continuation ? structuredClone(continuation) : null;
  }

  async list(): Promise<AutomationContinuation[]> {
    const document = await this.loadDocument();

    return structuredClone(document.continuations);
  }

  async listScheduled(): Promise<AutomationContinuation[]> {
    return (await this.list()).filter(
      (continuation) => continuation.status === 'scheduled',
    );
  }

  async markRequiresReview(
    id: string,
    reason: ContinuationReviewReason,
  ): Promise<AutomationContinuation | null> {
    return this.enqueue(async () => {
      const document = await this.loadDocument();
      const continuation = document.continuations.find(
        (existingContinuation) => existingContinuation.id === id,
      );

      if (!continuation) {
        return null;
      }

      continuation.status = 'requires-review';
      continuation.reviewReason = reason;
      await this.writeDocument(document);
      return structuredClone(continuation);
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const document = await this.loadDocument();
      const index = document.continuations.findIndex(
        (continuation) => continuation.id === id,
      );

      if (index === -1) {
        return false;
      }

      document.continuations.splice(index, 1);
      await this.writeDocument(document);
      return true;
    });
  }

  async upsert(continuation: AutomationContinuation): Promise<void> {
    return this.enqueue(async () => {
      const document = await this.loadDocument();
      const index = document.continuations.findIndex(
        (existingContinuation) => existingContinuation.id === continuation.id,
      );

      if (index === -1) {
        document.continuations.push(structuredClone(continuation));
      } else {
        document.continuations[index] = structuredClone(continuation);
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

  private async loadDocument(): Promise<ContinuationDocument> {
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

    if (!isContinuationDocument(parsed)) {
      throw new Error('The timer continuation configuration file is invalid.');
    }

    this.document = parsed;
    return this.document;
  }

  private async writeDocument(document: ContinuationDocument): Promise<void> {
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

function isApplicationEvent(value: unknown): value is ApplicationEvent {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['occurredAt'] === 'string' &&
    isRecord(value['payload']) &&
    (value['source'] === 'automation' ||
      value['source'] === 'command' ||
      value['source'] === 'manual' ||
      value['source'] === 'twitch') &&
    typeof value['type'] === 'string' &&
    /^(automation|command|manual|twitch)\./.test(value['type']) &&
    (value['causationId'] === undefined || typeof value['causationId'] === 'string') &&
    (value['correlationId'] === undefined || typeof value['correlationId'] === 'string') &&
    (value['targetAutomationId'] === undefined ||
      typeof value['targetAutomationId'] === 'string')
  );
}

function isAutomationContinuation(value: unknown): value is AutomationContinuation {
  return (
    isRecord(value) &&
    value['version'] === 1 &&
    typeof value['id'] === 'string' &&
    typeof value['automationId'] === 'string' &&
    typeof value['createdAt'] === 'string' &&
    typeof value['dueAt'] === 'string' &&
    isApplicationEvent(value['event']) &&
    Array.isArray(value['actions']) &&
    value['actions'].every(isAutomationAction) &&
    (value['status'] === 'scheduled' || value['status'] === 'requires-review') &&
    (value['reviewReason'] === undefined ||
      value['reviewReason'] === 'execution-failed' ||
      value['reviewReason'] === 'restart-non-idempotent')
  );
}

function isContinuationDocument(value: unknown): value is ContinuationDocument {
  return (
    isRecord(value) &&
    value['version'] === 1 &&
    Array.isArray(value['continuations']) &&
    value['continuations'].every(isAutomationContinuation)
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
