import { randomUUID } from 'node:crypto';

import {
  ChannelPointRedemption,
  redemptionEventType,
  RewardAutomationMapping,
} from '../../../../shared/contracts/rewards';
import { ApplicationEvent } from '../../../../shared/contracts/runtime-events';
import { AutomationEngine } from '../automations/automation-engine';
import { RewardMappingRepository } from './reward-mapping-repository';

export class RedemptionAutomationRouter {
  constructor(
    private readonly mappings: RewardMappingRepository,
    private readonly automationEngine: AutomationEngine,
    private readonly updateRedemptionStatus: (
      rewardId: string,
      redemptionId: string,
      status: 'CANCELED' | 'FULFILLED',
    ) => Promise<void>,
  ) {}

  async handle(
    event: ApplicationEvent,
    emit: (event: ApplicationEvent) => void,
  ): Promise<boolean> {
    const redemption = readRedemption(event);

    if (!redemption) {
      return false;
    }

    const mapping = await this.mappings.get(redemption.rewardId);

    if (!mapping) {
      return false;
    }

    try {
      const results = await this.automationEngine.handleEvent(
        { ...event, targetAutomationId: mapping.automationId },
        emit,
      );
      const completed =
        results.length === 1 && results[0].status === 'completed';

      if (!completed) {
        emitReviewEvent(event, mapping, redemption, 'automation-not-completed', emit);
        return true;
      }

      if (mapping.completionPolicy === 'manual-review') {
        emitReviewEvent(event, mapping, redemption, 'manual-policy', emit);
        return true;
      }

      const status =
        mapping.completionPolicy === 'auto-fulfill' ? 'FULFILLED' : 'CANCELED';
      await this.updateRedemptionStatus(
        redemption.rewardId,
        redemption.id,
        status,
      );
      emit({
        causationId: event.id,
        correlationId: event.correlationId ?? event.id,
        id: randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {
          automationId: mapping.automationId,
          redemptionId: redemption.id,
          rewardId: redemption.rewardId,
          status,
        },
        source: 'automation',
        type: 'automation.redemption-completed',
      });
      return true;
    } catch {
      emitReviewEvent(event, mapping, redemption, 'automation-failed', emit);
      return true;
    }
  }
}

function emitReviewEvent(
  event: ApplicationEvent,
  mapping: RewardAutomationMapping,
  redemption: ChannelPointRedemption,
  reason: 'automation-failed' | 'automation-not-completed' | 'manual-policy',
  emit: (event: ApplicationEvent) => void,
): void {
  emit({
    causationId: event.id,
    correlationId: event.correlationId ?? event.id,
    id: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      automationId: mapping.automationId,
      reason,
      redemptionId: redemption.id,
      rewardId: redemption.rewardId,
    },
    source: 'automation',
    type: 'automation.redemption-requires-review',
  });
}

function readRedemption(event: ApplicationEvent): ChannelPointRedemption | null {
  if (event.type !== redemptionEventType) {
    return null;
  }

  const reward = readRecord(event.payload['reward']);
  const redemptionId = readString(event.payload, 'id');
  const rewardId = readString(reward, 'id');

  return redemptionId && rewardId ? { id: redemptionId, rewardId } : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];

  return typeof value === 'string' ? value : null;
}
