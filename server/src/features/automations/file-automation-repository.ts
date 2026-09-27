import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  AutomationAction,
  AutomationCondition,
  AutomationDefinition,
  AutomationSchedule,
} from '../../../../shared/contracts/automation';
import { ApplicationEvent } from '../../../../shared/contracts/runtime-events';
import { AutomationRepository } from './automation-repository';

interface AutomationDocument {
  automations: AutomationDefinition[];
  version: 1;
}

const emptyDocument: AutomationDocument = {
  automations: [],
  version: 1,
};

export class FileAutomationRepository implements AutomationRepository {
  private document: AutomationDocument | null = null;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<AutomationDefinition[]> {
    const document = await this.loadDocument();

    return structuredClone(document.automations);
  }

  async listEnabled(): Promise<AutomationDefinition[]> {
    const definitions = await this.list();

    return definitions.filter((definition) => definition.enabled);
  }

  async remove(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const document = await this.loadDocument();
      const index = document.automations.findIndex((automation) => automation.id === id);

      if (index === -1) {
        return false;
      }

      document.automations.splice(index, 1);
      await this.writeDocument(document);
      return true;
    });
  }

  async upsert(definition: AutomationDefinition): Promise<void> {
    return this.enqueue(async () => {
      const document = await this.loadDocument();
      const index = document.automations.findIndex((automation) => automation.id === definition.id);

      if (index === -1) {
        document.automations.push(structuredClone(definition));
      } else {
        document.automations[index] = structuredClone(definition);
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

  private async loadDocument(): Promise<AutomationDocument> {
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

    if (!isAutomationDocument(parsed)) {
      throw new Error('The automation configuration file is invalid.');
    }

    this.document = parsed;
    return this.document;
  }

  private async writeDocument(document: AutomationDocument): Promise<void> {
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

export function isAutomationDefinition(value: unknown): value is AutomationDefinition {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['enabled'] === 'boolean' &&
    value['version'] === 1 &&
    isAutomationTrigger(value['trigger']) &&
    isAutomationCondition(value['conditions']) &&
    Array.isArray(value['actions']) &&
    value['actions'].every(isAutomationAction) &&
    hasValidActionOrder(value['actions']) &&
    (value['cooldown'] === undefined || isCooldown(value['cooldown'])) &&
    (value['schedule'] === undefined || isAutomationSchedule(value['schedule']))
  );
}

function isAutomationSchedule(value: unknown): value is AutomationSchedule {
  return (
    isRecord(value) &&
    isIntegerInRange(value['intervalMs'], 1000, 2147483647) &&
    typeof value['onlyWhileLive'] === 'boolean'
  );
}

function isApplicationEventType(value: unknown): value is ApplicationEvent['type'] {
  return typeof value === 'string' && /^(automation|command|manual|twitch)\./.test(value);
}

export function isAutomationAction(value: unknown): value is AutomationAction {
  if (!isRecord(value)) {
    return false;
  }

  if (value['type'] === 'emit-runtime-event') {
    return (
      typeof value['eventType'] === 'string' &&
      value['eventType'].startsWith('automation.') &&
      isRecord(value['payload'])
    );
  }

  if (value['type'] === 'send-chat') {
    return isText(value['message'], 500);
  }

  if (value['type'] === 'send-discord-webhook') {
    return (
      isText(value['content'], 2000) &&
      isOptionalText(value['username'], 80) &&
      (value['allowedRoleId'] === undefined ||
        (typeof value['allowedRoleId'] === 'string' && /^\d{17,20}$/.test(value['allowedRoleId'])))
    );
  }

  if (value['type'] === 'add-channel-vip') {
    return isRequiredText(value['targetUserId']);
  }

  if (value['type'] === 'add-leaderboard-points') {
    return isRequiredText(value['userId']) && isRequiredText(value['points']);
  }

  if (value['type'] === 'increase-custom-reward-cost') {
    return isRequiredText(value['rewardId']) && isIntegerInRange(value['amount'], 1, 1000000000);
  }

  if (value['type'] === 'timeout-user') {
    return (
      isRequiredText(value['targetUserId']) &&
      isIntegerInRange(value['durationSeconds'], 1, 1209600) &&
      isOptionalText(value['reason'], 500)
    );
  }

  if (value['type'] === 'ban-user') {
    return isRequiredText(value['targetUserId']) && isOptionalText(value['reason'], 500);
  }

  if (value['type'] === 'unban-user') {
    return isRequiredText(value['targetUserId']);
  }

  if (value['type'] === 'delete-chat-message') {
    return isRequiredText(value['messageId']);
  }

  if (value['type'] === 'update-chat-settings') {
    return isChatSettingsUpdate(value['settings']);
  }

  if (value['type'] === 'send-shoutout') {
    return isRequiredText(value['targetBroadcasterId']);
  }

  if (value['type'] === 'show-alert') {
    return isText(value['message'], 500) && isOptionalText(value['title'], 100);
  }

  if (value['type'] === 'update-redemption-status') {
    return (
      isRequiredText(value['rewardId']) &&
      isTextList(value['redemptionIds'], 1, 50) &&
      (value['status'] === 'CANCELED' || value['status'] === 'FULFILLED')
    );
  }

  if (value['type'] === 'create-poll') {
    return (
      isText(value['title'], 60) &&
      isTextList(value['choices'], 2, 5, 25) &&
      isIntegerInRange(value['durationSeconds'], 15, 1800)
    );
  }

  if (value['type'] === 'end-poll') {
    return (
      isRequiredText(value['pollId']) &&
      (value['status'] === 'ARCHIVED' || value['status'] === 'TERMINATED')
    );
  }

  if (value['type'] === 'create-prediction') {
    return (
      isText(value['title'], 45) &&
      isTextList(value['outcomes'], 2, 10, 25) &&
      isIntegerInRange(value['durationSeconds'], 1, 1800)
    );
  }

  if (value['type'] === 'resolve-prediction') {
    return (
      isRequiredText(value['predictionId']) &&
      (value['status'] === 'CANCELED' ||
        value['status'] === 'LOCKED' ||
        value['status'] === 'RESOLVED') &&
      isOptionalText(value['winningOutcomeId']) &&
      (value['status'] !== 'RESOLVED' || isRequiredText(value['winningOutcomeId']))
    );
  }

  return (
    value['type'] === 'delay' &&
    isIntegerInRange(value['durationMs'], 100, 604800000) &&
    (value['duplicatePolicy'] === 'allow' ||
      value['duplicatePolicy'] === 'replace' ||
      value['duplicatePolicy'] === 'skip')
  );
}

function hasValidActionOrder(actions: AutomationAction[]): boolean {
  return actions.every((action, index) => action.type !== 'delay' || index < actions.length - 1);
}

function isChatSettingsUpdate(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const keys = [
    'emoteMode',
    'followerMode',
    'followerModeDurationMinutes',
    'slowMode',
    'slowModeWaitTimeSeconds',
    'subscriberMode',
  ] as const;

  if (!keys.some((key) => value[key] !== undefined)) {
    return false;
  }

  return (
    isOptionalBoolean(value['emoteMode']) &&
    isOptionalBoolean(value['followerMode']) &&
    isOptionalIntegerInRange(value['followerModeDurationMinutes'], 0, 129600) &&
    isOptionalBoolean(value['slowMode']) &&
    isOptionalIntegerInRange(value['slowModeWaitTimeSeconds'], 1, 120) &&
    isOptionalBoolean(value['subscriberMode'])
  );
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): boolean {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
  );
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalIntegerInRange(value: unknown, minimum: number, maximum: number): boolean {
  return value === undefined || isIntegerInRange(value, minimum, maximum);
}

function isOptionalText(value: unknown, maximumLength?: number): boolean {
  return value === undefined || isText(value, maximumLength);
}

function isRequiredText(value: unknown, maximumLength?: number): boolean {
  return isText(value, maximumLength);
}

function isText(value: unknown, maximumLength?: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    (maximumLength === undefined || value.length <= maximumLength)
  );
}

function isTextList(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
  itemMaximumLength?: number,
): boolean {
  return (
    Array.isArray(value) &&
    value.length >= minimumLength &&
    value.length <= maximumLength &&
    value.every((item) => isText(item, itemMaximumLength))
  );
}

function isAutomationCondition(value: unknown): value is AutomationCondition {
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    return false;
  }

  switch (value['type']) {
    case 'always':
      return true;
    case 'event-field-equals':
      return (
        typeof value['path'] === 'string' &&
        (typeof value['value'] === 'string' ||
          typeof value['value'] === 'number' ||
          typeof value['value'] === 'boolean')
      );
    case 'all':
    case 'any':
    case 'not':
      return Array.isArray(value['children']) && value['children'].every(isAutomationCondition);
    default:
      return false;
  }
}

function isAutomationDocument(value: unknown): value is AutomationDocument {
  return (
    isRecord(value) &&
    value['version'] === 1 &&
    Array.isArray(value['automations']) &&
    value['automations'].every(isAutomationDefinition)
  );
}

function isAutomationTrigger(value: unknown): boolean {
  return (
    isRecord(value) &&
    value['type'] === 'application-event' &&
    isApplicationEventType(value['eventType'])
  );
}

function isCooldown(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['durationMs'] === 'number' &&
    Number.isFinite(value['durationMs']) &&
    value['durationMs'] >= 0
  );
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
