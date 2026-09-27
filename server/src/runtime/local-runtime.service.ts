import { randomUUID } from 'node:crypto';

import { ChatSettingsUpdate } from '../../../shared/contracts/automation';
import { ChannelPointReward } from '../../../shared/contracts/rewards';
import {
  CustomRewardCreateRequest,
  CustomRewardUpdateRequest,
  TwitchStreamInfo,
} from '../../../shared/contracts/twitch-operations';
import {
  ApplicationEvent,
  RuntimeSnapshot,
  RuntimeStreamMessage,
} from '../../../shared/contracts/runtime-events';
import { LocalRuntimeStatus } from '../../../shared/contracts/runtime-status';
import { TwitchAuthService } from '../auth/twitch-auth.service';
import { TwitchOAuthConfig } from '../config/runtime-config';
import {
  EventSubClient,
  EventSubNotification,
} from '../twitch/eventsub.client';
import { TwitchApiClient, TwitchCurrentUser } from '../twitch/twitch-api.client';
import { ApplicationEventDispatcher } from './application-event-dispatcher';
import { RuntimeViewProjector } from './runtime-view-projector';
import {
  AlwaysConditionHandler,
  AutomationActionRegistry,
  AutomationConditionRegistry,
  AutomationEngine,
  DelayActionHandler,
  EmitRuntimeEventActionHandler,
  EventFieldEqualsConditionHandler,
  SendChatMessageActionHandler,
  TimeoutUserActionHandler,
} from '../features/automations/automation-engine';
import { AutomationRepository } from '../features/automations/automation-repository';
import {
  BanUserActionHandler,
  CreatePollActionHandler,
  CreatePredictionActionHandler,
  DeleteChatMessageActionHandler,
  EndPollActionHandler,
  ResolvePredictionActionHandler,
  SendShoutoutActionHandler,
  ShowAlertActionHandler,
  UnbanUserActionHandler,
  UpdateChatSettingsActionHandler,
  UpdateRedemptionStatusActionHandler,
} from '../features/automations/twitch-action-handlers';
import { CommandRepository } from '../features/commands/command-repository';
import { CommandService } from '../features/commands/command-service';
import { TwitchOperationsService } from '../features/twitch-operations/twitch-operations.service';
import { RedemptionAutomationRouter } from '../features/rewards/redemption-automation-router';
import { RewardMappingRepository } from '../features/rewards/reward-mapping-repository';
import { TwitchRewardService } from '../features/rewards/twitch-reward.service';
import { AutomationContinuation } from '../features/timers/automation-continuation';
import { ContinuationRepository } from '../features/timers/continuation-repository';
import { ContinuationScheduler } from '../features/timers/continuation-scheduler';

export class LocalRuntimeService {
  private readonly applicationEvents = new ApplicationEventDispatcher();

  private readonly automationEngine: AutomationEngine;

  private readonly commandService: CommandService;

  private readonly continuations: ContinuationScheduler;

  private readonly redemptionRouter: RedemptionAutomationRouter;

  private readonly rewards: TwitchRewardService;

  private readonly operations: TwitchOperationsService;

  private broadcaster: TwitchCurrentUser | null = null;

  private connectionState: LocalRuntimeStatus['connectionState'] =
    'disconnected';

  private readonly eventSub: EventSubClient | null;

  private readonly listeners = new Set<(message: RuntimeStreamMessage) => void>();

  private recentEvents: ApplicationEvent[] = [];

  private readonly startedAt = new Date().toISOString();

  private readonly viewProjector = new RuntimeViewProjector();

  constructor(
    private readonly twitchAuth: TwitchAuthService,
    config: TwitchOAuthConfig | null,
    automationRepository: AutomationRepository,
    commandRepository: CommandRepository,
    continuationRepository: ContinuationRepository,
    private readonly rewardMappings: RewardMappingRepository,
  ) {
    this.continuations = new ContinuationScheduler(continuationRepository);
    this.operations = new TwitchOperationsService(() =>
      this.getConnectedTwitchClient(),
    );
    this.automationEngine = new AutomationEngine(
      automationRepository,
      new AutomationConditionRegistry([
        new AlwaysConditionHandler(),
        new EventFieldEqualsConditionHandler(),
      ]),
      new AutomationActionRegistry([
        new BanUserActionHandler((userId, reason) =>
          this.operations.banUser(userId, reason),
        ),
        new CreatePollActionHandler((title, choices, durationSeconds) =>
          this.operations.createPoll(title, choices, durationSeconds),
        ),
        new CreatePredictionActionHandler((title, outcomes, durationSeconds) =>
          this.operations.createPrediction(title, outcomes, durationSeconds),
        ),
        new DelayActionHandler(),
        new DeleteChatMessageActionHandler((messageId) =>
          this.operations.deleteChatMessage(messageId),
        ),
        new EmitRuntimeEventActionHandler(),
        new EndPollActionHandler((pollId, status) =>
          this.operations.endPoll(pollId, status),
        ),
        new ResolvePredictionActionHandler(
          (predictionId, status, winningOutcomeId) =>
            this.operations.resolvePrediction(
              predictionId,
              status,
              winningOutcomeId,
            ),
        ),
        new SendChatMessageActionHandler(async (message) => {
          await this.operations.sendChatMessage(message);
        }),
        new SendShoutoutActionHandler((targetBroadcasterId) =>
          this.operations.sendShoutout(targetBroadcasterId),
        ),
        new ShowAlertActionHandler(),
        new TimeoutUserActionHandler((userId, durationSeconds, reason) =>
          this.operations.timeoutUser(userId, durationSeconds, reason),
        ),
        new UnbanUserActionHandler((userId) => this.operations.unbanUser(userId)),
        new UpdateChatSettingsActionHandler((settings) =>
          this.operations.updateChatSettings(settings),
        ),
        new UpdateRedemptionStatusActionHandler(
          (rewardId, redemptionIds, status) =>
            this.operations.updateRedemptionStatus(
              rewardId,
              redemptionIds,
              status,
            ),
        ),
      ]),
      undefined,
      undefined,
      this.continuations,
    );
    this.redemptionRouter = new RedemptionAutomationRouter(
      rewardMappings,
      this.automationEngine,
      (rewardId, redemptionId, status) =>
        this.operations.updateRedemptionStatus(rewardId, [redemptionId], status),
    );
    this.rewards = new TwitchRewardService(() => this.listTwitchRewards());
    this.commandService = new CommandService(commandRepository);

    this.applicationEvents.subscribe((event) => {
      const viewState = this.viewProjector.project(event);
      this.recentEvents = [...this.recentEvents, event].slice(-100);
      this.publish({ kind: 'event', event, viewState });
      void this.commandService
        .handleEvent(event)
        .then((result) => {
          if (result.event) {
            this.applicationEvents.dispatch(result.event);
          }
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : 'Unknown command execution error.';
          console.error('Command execution failed:', message);
        });
      void this.handleAutomationEvent(event).catch((error: unknown) => {
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown automation execution error.';
          console.error('Automation execution failed:', message);
        });
    });

    if (!config) {
      this.eventSub = null;
      return;
    }

    const api = new TwitchApiClient(config, twitchAuth);
    this.eventSub = new EventSubClient(api, config.eventSubUrl, {
      onConnectionState: (state) => {
        this.updateConnectionState(state);
      },
      onError: (error) => {
        this.updateConnectionState('disconnected');
        console.error('Twitch EventSub error:', error.message);
      },
      onNotification: (notification) => this.handleNotification(notification),
    });

    this.api = api;
  }

  private readonly api: TwitchApiClient | null = null;

  async connect(): Promise<void> {
    const accessToken = await this.twitchAuth.getAccessToken();

    if (!accessToken || !this.api || !this.eventSub) {
      this.updateConnectionState('reauth-required');
      return;
    }

    try {
      this.updateConnectionState('connecting');
      this.broadcaster = await this.api.getCurrentUser();
      await this.rewards.sync();
      this.publishSnapshot();
      await this.eventSub.start({
        broadcasterId: this.broadcaster.id,
      });
    } catch (error) {
      if (isUnauthorizedError(error)) {
        this.updateConnectionState('reauth-required');
      } else {
        this.updateConnectionState('disconnected');
      }

      throw error;
    }
  }

  async start(): Promise<void> {
    await this.continuations.start(
      async (continuation) => {
        await this.automationEngine.resumeContinuation(
          continuation,
          (event) => this.applicationEvents.dispatch(event),
        );
      },
      async (continuation, reason) => {
        this.applicationEvents.dispatch(this.createContinuationReviewEvent(continuation, reason));
      },
    );
  }

  async listContinuations(): Promise<AutomationContinuation[]> {
    return this.continuations.list();
  }

  async cancelContinuation(id: string): Promise<boolean> {
    return this.continuations.cancel(id);
  }

  listRewards(): ChannelPointReward[] {
    return this.rewards.list();
  }

  async syncRewards(): Promise<ChannelPointReward[]> {
    return this.rewards.sync();
  }

  async sendChatMessage(message: string): Promise<void> {
    const { broadcaster } = this.getConnectedTwitchClient();
    const messageId = await this.operations.sendChatMessage(message);

    this.viewProjector.addChatMessage({
      color: null,
      displayName: broadcaster.displayName,
      id: messageId,
      message,
      timestamp: new Date().toISOString(),
      userId: broadcaster.id,
      username: broadcaster.login,
    });
    this.publishSnapshot();
  }

  async timeoutUser(
    userId: string,
    durationSeconds: number,
    reason?: string,
  ): Promise<void> {
    await this.operations.timeoutUser(userId, durationSeconds, reason);
    this.publishManualEvent('manual.user-timed-out', {
      durationSeconds,
      userId,
    });
  }

  async banUser(userId: string, reason?: string): Promise<void> {
    await this.operations.banUser(userId, reason);
    this.publishManualEvent('manual.user-banned', { userId });
  }

  async unbanUser(userId: string): Promise<void> {
    return this.operations.unbanUser(userId);
  }

  async deleteChatMessage(messageId: string): Promise<void> {
    await this.operations.deleteChatMessage(messageId);
    this.publishManualEvent('manual.chat-message-deleted', { messageId });
  }

  async updateChatSettings(settings: ChatSettingsUpdate): Promise<void> {
    return this.operations.updateChatSettings(settings);
  }

  async sendShoutout(targetBroadcasterId: string): Promise<void> {
    return this.operations.sendShoutout(targetBroadcasterId);
  }

  async createCustomReward(
    reward: CustomRewardCreateRequest,
  ): Promise<ChannelPointReward> {
    const createdReward = await this.operations.createCustomReward(reward);
    await this.rewards.sync();
    return createdReward;
  }

  async updateCustomReward(
    rewardId: string,
    updates: CustomRewardUpdateRequest,
  ): Promise<ChannelPointReward> {
    const updatedReward = await this.operations.updateCustomReward(rewardId, updates);
    await this.rewards.sync();
    return updatedReward;
  }

  async deleteCustomReward(rewardId: string): Promise<void> {
    await this.operations.deleteCustomReward(rewardId);
    await this.rewardMappings.remove(rewardId);
    await this.rewards.sync();
  }

  async updateRedemptionStatus(
    rewardId: string,
    redemptionIds: string[],
    status: 'CANCELED' | 'FULFILLED',
  ): Promise<void> {
    return this.operations.updateRedemptionStatus(rewardId, redemptionIds, status);
  }

  async createPoll(
    title: string,
    choices: string[],
    durationSeconds: number,
  ): Promise<string> {
    return this.operations.createPoll(title, choices, durationSeconds);
  }

  async endPoll(
    pollId: string,
    status: 'ARCHIVED' | 'TERMINATED',
  ): Promise<void> {
    return this.operations.endPoll(pollId, status);
  }

  async createPrediction(
    title: string,
    outcomes: string[],
    durationSeconds: number,
  ): Promise<string> {
    return this.operations.createPrediction(title, outcomes, durationSeconds);
  }

  async resolvePrediction(
    predictionId: string,
    status: 'CANCELED' | 'LOCKED' | 'RESOLVED',
    winningOutcomeId?: string,
  ): Promise<void> {
    return this.operations.resolvePrediction(predictionId, status, winningOutcomeId);
  }

  async getStreamInfo(): Promise<TwitchStreamInfo | null> {
    return this.operations.getStreamInfo();
  }

  async getUserIdByLogin(login: string): Promise<string> {
    return this.operations.getUserIdByLogin(login);
  }

  getStatus(): LocalRuntimeStatus {
    return {
      authorizationState: this.twitchAuth.getAuthorizationState(),
      connectionState: this.connectionState,
      broadcaster: this.broadcaster
        ? {
            id: this.broadcaster.id,
            displayName: this.broadcaster.displayName,
          }
        : null,
      startedAt: this.startedAt,
    };
  }

  subscribe(listener: (message: RuntimeStreamMessage) => void): () => void {
    this.listeners.add(listener);
    listener({ kind: 'snapshot', snapshot: this.getSnapshot() });

    return () => this.listeners.delete(listener);
  }

  private handleNotification(notification: EventSubNotification): void {
    this.applicationEvents.dispatch({
      id: notification.id,
      occurredAt: notification.occurredAt,
      payload: notification.event,
      source: 'twitch',
      type: `twitch.${notification.type}`,
    });
  }

  private async handleAutomationEvent(event: ApplicationEvent): Promise<void> {
    const handledRedemption = await this.redemptionRouter.handle(
      event,
      (derivedEvent) => this.applicationEvents.dispatch(derivedEvent),
    );

    if (handledRedemption) {
      return;
    }

    await this.automationEngine.handleEvent(event, (derivedEvent) => {
      this.applicationEvents.dispatch(derivedEvent);
    });
  }

  private createContinuationReviewEvent(
    continuation: AutomationContinuation,
    reason: 'execution-failed' | 'restart-non-idempotent',
  ): ApplicationEvent {
    return {
      causationId: continuation.event.id,
      correlationId: continuation.event.correlationId ?? continuation.event.id,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {
        automationId: continuation.automationId,
        continuationId: continuation.id,
        dueAt: continuation.dueAt,
        reason,
      },
      source: 'automation',
      type: 'automation.continuation-requires-review',
    };
  }

  private publishManualEvent(
    type: `manual.${string}`,
    payload: Record<string, unknown>,
  ): void {
    this.applicationEvents.dispatch({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload,
      source: 'manual',
      type,
    });
  }

  private getConnectedTwitchClient(): {
    api: TwitchApiClient;
    broadcaster: TwitchCurrentUser;
  } {
    if (!this.api || !this.broadcaster) {
      throw new Error('The Twitch runtime is not connected.');
    }

    return { api: this.api, broadcaster: this.broadcaster };
  }

  private async listTwitchRewards(): Promise<ChannelPointReward[]> {
    const { api, broadcaster } = this.getConnectedTwitchClient();

    return api.getCustomRewards({ broadcasterId: broadcaster.id });
  }

  private getSnapshot(): RuntimeSnapshot {
    return {
      recentEvents: this.recentEvents,
      status: this.getStatus(),
      viewState: this.viewProjector.getState(),
    };
  }

  private publish(message: RuntimeStreamMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  private publishSnapshot(): void {
    this.publish({ kind: 'snapshot', snapshot: this.getSnapshot() });
  }

  private updateConnectionState(
    connectionState: LocalRuntimeStatus['connectionState'],
  ): void {
    this.connectionState = connectionState;
    this.publishSnapshot();
  }
}

function isUnauthorizedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 401
  );
}
