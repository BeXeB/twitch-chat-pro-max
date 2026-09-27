import { randomUUID } from 'node:crypto';

import { OpenLootboxAction } from '../../../../shared/contracts/automation';
import { InventoryOpeningRecord } from '../../../../shared/contracts/inventory';
import { redemptionEventType } from '../../../../shared/contracts/rewards';
import { LootboxService } from '../lootboxes/lootbox-service';
import {
  AutomationActionContext,
  AutomationActionExecutionStatus,
  AutomationActionHandler,
} from './automation-engine';

export class OpenLootboxActionHandler implements AutomationActionHandler {
  readonly type = 'open-lootbox' as const;

  private readonly announcements = new Map<string, Promise<void>>();

  constructor(
    private readonly lootboxes: LootboxService,
    private readonly sendChatMessage: (message: string) => Promise<void>,
  ) {}

  async execute(
    action: OpenLootboxAction,
    context: AutomationActionContext,
  ): Promise<AutomationActionExecutionStatus> {
    if (context.event.type !== redemptionEventType) {
      throw new Error('Lootboxes can only be opened from a channel point redemption.');
    }

    const redemptionId = readText(context.event.payload, 'id');
    const userId = readText(context.event.payload, 'user_id');
    const username = readText(context.event.payload, 'user_login');

    if (!redemptionId || !userId || !username) {
      throw new Error('The channel point redemption is missing viewer details.');
    }

    const opening = await this.lootboxes.open({
      boxId: action.lootboxId,
      redemptionId,
      userId,
    });

    await this.announceOnce(opening, username);
    emitLootboxOpened(context, opening);
    return 'continue';
  }

  private async announceOnce(opening: InventoryOpeningRecord, username: string): Promise<void> {
    if (opening.announced) {
      return;
    }

    const existingAnnouncement = this.announcements.get(opening.redemptionId);
    if (existingAnnouncement) {
      await existingAnnouncement;
      return;
    }

    const announcement = Promise.resolve().then(async () => {
      await this.sendChatMessage(
        `@${username} opened ${opening.boxName} and found ${opening.itemName}.`,
      );
      await this.lootboxes.markAnnounced(opening.redemptionId);
    });
    this.announcements.set(opening.redemptionId, announcement);

    try {
      await announcement;
    } finally {
      this.announcements.delete(opening.redemptionId);
    }
  }
}

function emitLootboxOpened(
  context: AutomationActionContext,
  opening: InventoryOpeningRecord,
): void {
  context.emit({
    causationId: context.event.id,
    correlationId: context.event.correlationId ?? context.event.id,
    id: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      boxId: opening.boxId,
      itemId: opening.itemId,
      itemName: opening.itemName,
      redemptionId: opening.redemptionId,
      userId: opening.userId,
    },
    source: 'automation',
    type: 'automation.lootbox-opened',
  });
}

function readText(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
