import { AutomationContinuation, ContinuationReviewReason } from './automation-continuation';

export interface ContinuationRepository {
  get(id: string): Promise<AutomationContinuation | null>;
  list(): Promise<AutomationContinuation[]>;
  listScheduled(): Promise<AutomationContinuation[]>;
  markRequiresReview(
    id: string,
    reason: ContinuationReviewReason,
  ): Promise<AutomationContinuation | null>;
  remove(id: string): Promise<boolean>;
  upsert(continuation: AutomationContinuation): Promise<void>;
}

export class InMemoryContinuationRepository implements ContinuationRepository {
  constructor(private readonly continuations: AutomationContinuation[] = []) {}

  async get(id: string): Promise<AutomationContinuation | null> {
    return this.continuations.find((continuation) => continuation.id === id) ?? null;
  }

  async list(): Promise<AutomationContinuation[]> {
    return [...this.continuations];
  }

  async listScheduled(): Promise<AutomationContinuation[]> {
    return this.continuations.filter((continuation) => continuation.status === 'scheduled');
  }

  async markRequiresReview(
    id: string,
    reason: ContinuationReviewReason,
  ): Promise<AutomationContinuation | null> {
    const continuation = await this.get(id);

    if (!continuation) {
      return null;
    }

    continuation.status = 'requires-review';
    continuation.reviewReason = reason;
    return continuation;
  }

  async remove(id: string): Promise<boolean> {
    const index = this.continuations.findIndex((continuation) => continuation.id === id);

    if (index === -1) {
      return false;
    }

    this.continuations.splice(index, 1);
    return true;
  }

  async upsert(continuation: AutomationContinuation): Promise<void> {
    const index = this.continuations.findIndex(
      (existingContinuation) => existingContinuation.id === continuation.id,
    );

    if (index === -1) {
      this.continuations.push(continuation);
      return;
    }

    this.continuations[index] = continuation;
  }
}
