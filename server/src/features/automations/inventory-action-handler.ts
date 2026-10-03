import { randomUUID } from 'node:crypto';

import {
  EquipInventoryAction,
  WhisperInventoryAction,
} from '../../../../shared/contracts/automation';
import { CosmeticSlot } from '../../../../shared/contracts/lootboxes';
import { LootboxService, OwnedInventoryItem } from '../lootboxes/lootbox-service';
import {
  AutomationActionContext,
  AutomationActionExecutionStatus,
  AutomationActionHandler,
} from './automation-engine';

const equipmentSlots: Array<{ slot: CosmeticSlot | null; label: string }> = [
  { slot: 'message-color', label: 'Üzenetszín' },
  { slot: 'username-color', label: 'Névszín' },
  { slot: 'border-color', label: 'Szegélyszín' },
  { slot: 'border-style', label: 'Szegélystílus' },
  { slot: 'entry-effect', label: 'Belépési effekt' },
  { slot: null, label: 'Egyéb tárgyak' },
];

export class EquipInventoryActionHandler implements AutomationActionHandler {
  readonly type = 'equip-inventory' as const;

  constructor(
    private readonly lootboxes: Pick<LootboxService, 'equipByName'>,
    private readonly sendChat: (message: string) => Promise<void>,
  ) {}

  async execute(
    _action: EquipInventoryAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const user = context.event.payload['user'];
    if (
      context.event.type !== 'command.executed' ||
      !user ||
      typeof user !== 'object' ||
      !('id' in user) ||
      typeof user.id !== 'string' ||
      !/^\d+$/.test(user.id) ||
      !('login' in user) ||
      typeof user.login !== 'string' ||
      !/^[a-zA-Z0-9_]+$/.test(user.login)
    ) {
      throw new Error('Equipping inventory requires a command with a viewer user ID and login.');
    }
    const argumentsText = context.event.payload['argumentsText'];
    const result = await this.lootboxes.equipByName(
      user.id,
      typeof argumentsText === 'string' ? argumentsText : '',
    );
    let message: string;
    switch (result.status) {
      case 'equipped':
        context.emit({
          causationId: context.event.id,
          correlationId: context.event.correlationId ?? context.event.id,
          id: randomUUID(),
          occurredAt: new Date().toISOString(),
          payload: { userId: user.id, itemName: result.itemName },
          source: 'automation',
          type: 'automation.inventory-equipped',
        });
        message = `Felszerelve: ${result.itemName.replace(/\s+/g, ' ').trim()}`;
        break;
      case 'name-missing':
        message = 'Használat: !equip [tárgy neve]';
        break;
      case 'ambiguous':
        message = 'Több tárgyad is ezt a nevet viseli. A név nem egyértelmű.';
        break;
      case 'not-owned':
        message = 'Nincs ilyen felszerelhető tárgy az inventorydban.';
        break;
    }
    await this.sendChat(`@${user.login} ${message}`.slice(0, 500));
    return 'continue';
  }
}

export class WhisperInventoryActionHandler implements AutomationActionHandler {
  readonly type = 'whisper-inventory' as const;

  constructor(
    private readonly lootboxes: Pick<LootboxService, 'getInventoryItems'>,
    private readonly sendWhisper: (userId: string, message: string) => Promise<void>,
  ) {}

  async execute(
    _action: WhisperInventoryAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    const user = context.event.payload['user'];
    if (
      context.event.type !== 'command.executed' ||
      !user ||
      typeof user !== 'object' ||
      !('id' in user) ||
      typeof user.id !== 'string' ||
      !/^\d+$/.test(user.id)
    ) {
      throw new Error('Inventory whispers require a command with a viewer user ID.');
    }
    const items = await this.lootboxes.getInventoryItems(user.id);
    for (const message of formatInventoryWhispers(items)) {
      await this.sendWhisper(user.id, message);
    }
    return 'continue';
  }
}

export function formatInventoryWhispers(items: OwnedInventoryItem[]): string[] {
  if (items.length === 0) {
    return ['Az inventoryd üres.'];
  }
  const messages: string[] = [];
  let message = 'Inventory';
  for (const { slot, label } of equipmentSlots) {
    const entries = items
      .filter((item) => item.slot === slot)
      .sort((first, second) => first.name.localeCompare(second.name, 'hu'));
    if (slot === null && entries.length === 0) {
      continue;
    }
    const lines = entries.length
      ? entries.map(
          (item) =>
            `${label}: ${item.name.replace(/\s+/g, ' ').trim()}${item.equipped ? ' [felszerelve]' : ''}`,
        )
      : [`${label}: nincs`];
    for (const line of lines) {
      if (message.length + line.length + 3 > 500) {
        messages.push(message);
        message = 'Inventory (folytatás)';
      }
      message += ` | ${line}`;
    }
  }
  messages.push(message);
  return messages;
}
