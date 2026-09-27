import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  CommandDefinition,
  CommandRole,
  commandRoles,
} from '../../../../shared/contracts/command';
import { CommandRepository } from './command-repository';

interface CommandDocument {
  commands: CommandDefinition[];
  version: 1;
}

const commandNamePattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const emptyDocument: CommandDocument = {
  commands: [],
  version: 1,
};

export class FileCommandRepository implements CommandRepository {
  private document: CommandDocument | null = null;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<CommandDefinition[]> {
    const document = await this.loadDocument();

    return structuredClone(document.commands);
  }

  async listEnabled(): Promise<CommandDefinition[]> {
    const definitions = await this.list();

    return definitions.filter((definition) => definition.enabled);
  }

  async remove(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const document = await this.loadDocument();
      const index = document.commands.findIndex((command) => command.id === id);

      if (index === -1) {
        return false;
      }

      document.commands.splice(index, 1);
      await this.writeDocument(document);
      return true;
    });
  }

  async upsert(definition: CommandDefinition): Promise<void> {
    return this.enqueue(async () => {
      const document = await this.loadDocument();
      const index = document.commands.findIndex(
        (command) => command.id === definition.id,
      );
      const commands = [...document.commands];

      if (index === -1) {
        commands.push(structuredClone(definition));
      } else {
        commands[index] = structuredClone(definition);
      }

      assertDistinctInvocationNames(commands);
      document.commands = commands;
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

  private async loadDocument(): Promise<CommandDocument> {
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

    if (!isCommandDocument(parsed)) {
      throw new Error('The command configuration file is invalid.');
    }

    this.document = parsed;
    return this.document;
  }

  private async writeDocument(document: CommandDocument): Promise<void> {
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

export function isCommandDefinition(value: unknown): value is CommandDefinition {
  if (!isRecord(value)) {
    return false;
  }

  const aliases = value['aliases'];

  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    isCommandName(value['name']) &&
    typeof value['enabled'] === 'boolean' &&
    value['version'] === 1 &&
    isCommandRole(value['requiredRole']) &&
    typeof value['targetAutomationId'] === 'string' &&
    value['targetAutomationId'].length > 0 &&
    (value['argumentPolicy'] === 'none' ||
      value['argumentPolicy'] === 'optional' ||
      value['argumentPolicy'] === 'required') &&
    Array.isArray(aliases) &&
    aliases.every(isCommandName) &&
    new Set([value['name'], ...aliases]).size === aliases.length + 1 &&
    (value['cooldown'] === undefined || isCommandCooldown(value['cooldown']))
  );
}

function assertDistinctInvocationNames(commands: CommandDefinition[]): void {
  const commandIdsByName = new Map<string, string>();

  for (const command of commands) {
    for (const invocationName of [command.name, ...command.aliases]) {
      const existingCommandId = commandIdsByName.get(invocationName);

      if (existingCommandId && existingCommandId !== command.id) {
        throw new CommandConfigurationError(
          `The command invocation "${invocationName}" is already in use.`,
        );
      }

      commandIdsByName.set(invocationName, command.id);
    }
  }
}

export class CommandConfigurationError extends Error {}

function isCommandCooldown(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['durationMs'] === 'number' &&
    Number.isFinite(value['durationMs']) &&
    value['durationMs'] >= 0 &&
    (value['scope'] === 'global' || value['scope'] === 'user')
  );
}

function isCommandDocument(value: unknown): value is CommandDocument {
  return (
    isRecord(value) &&
    value['version'] === 1 &&
    Array.isArray(value['commands']) &&
    value['commands'].every(isCommandDefinition)
  );
}

function isCommandName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.toLowerCase() &&
    commandNamePattern.test(value)
  );
}

function isCommandRole(value: unknown): value is CommandRole {
  return typeof value === 'string' && commandRoles.includes(value as CommandRole);
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
