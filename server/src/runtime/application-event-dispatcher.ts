import { ApplicationEvent } from '../../../shared/contracts/runtime-events';

type ApplicationEventListener = (event: ApplicationEvent) => void;

const deduplicationWindowMs = 10 * 60 * 1000;

export class ApplicationEventDispatcher {
  private readonly listeners = new Set<ApplicationEventListener>();

  private readonly seenEventIds = new Map<string, number>();

  dispatch(event: ApplicationEvent): boolean {
    this.removeExpiredEventIds();

    if (this.seenEventIds.has(event.id)) {
      return false;
    }

    this.seenEventIds.set(event.id, Date.now());

    for (const listener of this.listeners) {
      listener(event);
    }

    return true;
  }

  subscribe(listener: ApplicationEventListener): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  private removeExpiredEventIds(): void {
    const expiresBefore = Date.now() - deduplicationWindowMs;

    for (const [eventId, receivedAt] of this.seenEventIds) {
      if (receivedAt < expiresBefore) {
        this.seenEventIds.delete(eventId);
      }
    }
  }
}
