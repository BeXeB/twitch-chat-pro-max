import { randomUUID } from 'node:crypto';

import { CommandDefinition, CommandRole, commandRoles } from '../../../../shared/contracts/command';
import { ApplicationEvent } from '../../../../shared/contracts/runtime-events';
import { CommandRepository } from './command-repository';

const roleWeights: Record<CommandRole, number> = {
  everyone: 0,
  subscriber: 1,
  vip: 2,
  moderator: 3,
  broadcaster: 4,
};

export type CommandHandlingStatus =
  | 'arguments-missing'
  | 'arguments-unexpected'
  | 'cooldown'
  | 'executed'
  | 'ignored'
  | 'not-found'
  | 'permission-denied';

export interface CommandHandlingResult {
  event?: ApplicationEvent;
  status: CommandHandlingStatus;
}

export class CommandService {
  private readonly cooldowns = new CommandCooldownTracker();

  constructor(
    private readonly repository: CommandRepository,
    private readonly now = () => Date.now(),
    private readonly prefix = '!',
  ) {}

  async handleEvent(event: ApplicationEvent): Promise<CommandHandlingResult> {
    if (event.type !== 'twitch.channel.chat.message') {
      return { status: 'ignored' };
    }

    const text = readString(readRecord(event.payload['message']), 'text');
    const chatterId = readString(event.payload, 'chatter_user_id');
    const chatterLogin = readString(event.payload, 'chatter_user_login');
    const chatterName = readString(event.payload, 'chatter_user_name');
    const parsed = parseInvocation(text, this.prefix);

    if (!parsed || !chatterId || !chatterLogin || !chatterName) {
      return { status: 'ignored' };
    }

    const definition = (await this.repository.listEnabled()).find(
      (command) => command.name === parsed.name || command.aliases.includes(parsed.name),
    );

    if (!definition) {
      return { status: 'not-found' };
    }

    const role = getChatterRole(event.payload);

    if (roleWeights[role] < roleWeights[definition.requiredRole]) {
      return { status: 'permission-denied' };
    }

    if (definition.argumentPolicy === 'required' && parsed.arguments.length === 0) {
      return { status: 'arguments-missing' };
    }

    if (definition.argumentPolicy === 'none' && parsed.arguments.length > 0) {
      return { status: 'arguments-unexpected' };
    }

    const now = this.now();

    if (!this.cooldowns.isAvailable(definition, chatterId, now)) {
      return { status: 'cooldown' };
    }

    this.cooldowns.reserve(definition, chatterId, now);

    return {
      event: {
        causationId: event.id,
        correlationId: event.correlationId ?? event.id,
        id: randomUUID(),
        occurredAt: new Date(now).toISOString(),
        payload: {
          arguments: parsed.arguments,
          argumentsText: parsed.argumentsText,
          commandId: definition.id,
          commandName: definition.name,
          invocation: parsed.name,
          sourceMessageId: readOptionalString(event.payload, 'message_id'),
          user: {
            displayName: chatterName,
            id: chatterId,
            login: chatterLogin,
            role,
          },
        },
        source: 'command',
        targetAutomationId: definition.targetAutomationId,
        type: 'command.executed',
      },
      status: 'executed',
    };
  }
}

class CommandCooldownTracker {
  private readonly expirations = new Map<string, number>();

  isAvailable(command: CommandDefinition, chatterId: string, now: number): boolean {
    if (!command.cooldown) {
      return true;
    }

    const key = this.getKey(command, chatterId);
    const expiration = this.expirations.get(key) ?? 0;

    if (expiration <= now) {
      this.expirations.delete(key);
      return true;
    }

    return false;
  }

  reserve(command: CommandDefinition, chatterId: string, now: number): void {
    if (!command.cooldown) {
      return;
    }

    this.expirations.set(this.getKey(command, chatterId), now + command.cooldown.durationMs);
  }

  private getKey(command: CommandDefinition, chatterId: string): string {
    return command.cooldown?.scope === 'user'
      ? `${command.id}:user:${chatterId}`
      : `${command.id}:global`;
  }
}

function getChatterRole(payload: Record<string, unknown>): CommandRole {
  const broadcasterId = readOptionalString(payload, 'broadcaster_user_id');
  const chatterId = readOptionalString(payload, 'chatter_user_id');
  const badgeIds = getBadgeIds(payload);

  if (badgeIds.has('broadcaster') || broadcasterId === chatterId) {
    return 'broadcaster';
  }

  for (const role of [...commandRoles].reverse()) {
    if (badgeIds.has(role)) {
      return role;
    }
  }

  return 'everyone';
}

function getBadgeIds(payload: Record<string, unknown>): Set<string> {
  const badges = payload['badges'];

  if (!Array.isArray(badges)) {
    return new Set();
  }

  return new Set(
    badges.flatMap((badge) => {
      if (!isRecord(badge)) {
        return [];
      }

      const setId = readString(badge, 'set_id');
      return setId ? [setId] : [];
    }),
  );
}

function parseInvocation(
  text: string | null,
  prefix: string,
): { arguments: string[]; argumentsText: string; name: string } | null {
  if (!text || !text.startsWith(prefix)) {
    return null;
  }

  const textAfterPrefix = text.slice(prefix.length).trim();

  if (!textAfterPrefix) {
    return null;
  }

  const [name, ...argumentsList] = textAfterPrefix.split(/\s+/);

  return {
    arguments: argumentsList,
    argumentsText: argumentsList.join(' '),
    name: name.toLowerCase(),
  };
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  const result = value[key];

  return typeof result === 'string' ? result : undefined;
}

function readString(value: Record<string, unknown> | null, key: string): string | null {
  if (!value) {
    return null;
  }

  const result = value[key];
  return typeof result === 'string' ? result : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
