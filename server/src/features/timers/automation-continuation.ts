import { AutomationAction } from '../../../../shared/contracts/automation';
import { ApplicationEvent } from '../../../../shared/contracts/runtime-events';

export type ContinuationReviewReason = 'execution-failed' | 'restart-non-idempotent';

export interface AutomationContinuation {
  actions: AutomationAction[];
  automationId: string;
  createdAt: string;
  dueAt: string;
  event: ApplicationEvent;
  id: string;
  reviewReason?: ContinuationReviewReason;
  status: 'requires-review' | 'scheduled';
  version: 1;
}

export interface ContinuationScheduleRequest {
  actions: AutomationAction[];
  automationId: string;
  duplicatePolicy: 'allow' | 'replace' | 'skip';
  durationMs: number;
  event: ApplicationEvent;
}

export interface ContinuationScheduleResult {
  continuation?: AutomationContinuation;
  status: 'duplicate-skipped' | 'scheduled';
}
