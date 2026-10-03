import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ChatCosmeticsByUserId } from '../../../../shared/contracts/lootboxes';
import {
  ApplicationEvent,
  RuntimeSnapshot,
  RuntimeStreamMessage,
} from '../../../../shared/contracts/runtime-events';
import { LocalRuntimeStatus } from '../../../../shared/contracts/runtime-status';
import { RuntimeViewState } from '../../../../shared/contracts/runtime-view-state';
import { AutomationDefinition, ChatSettingsUpdate } from '../../../../shared/contracts/automation';
import { CommandDefinition } from '../../../../shared/contracts/command';
import { ChannelPointReward, RewardAutomationMapping } from '../../../../shared/contracts/rewards';
import {
  CustomRewardCreateRequest,
  CustomRewardUpdateRequest,
  TwitchStreamInfo,
} from '../../../../shared/contracts/twitch-operations';

@Injectable({
  providedIn: 'root',
})
export class LocalRuntimeClient {
  readonly status = signal<LocalRuntimeStatus | null>(null);

  readonly loading = signal(false);

  readonly error = signal<string | null>(null);

  readonly recentEvents = signal<ApplicationEvent[]>([]);

  readonly chatCosmetics = signal<ChatCosmeticsByUserId>({});

  readonly animatedChatMessageId = signal<string | null>(null);

  readonly viewState = signal<RuntimeViewState>({
    alerts: [],
    chatMessages: [],
    deletedMessageIds: [],
    streamState: 'offline',
  });

  private eventSource: EventSource | null = null;

  constructor(private readonly http: HttpClient) {}

  async refreshStatus(): Promise<void> {
    this.loading.set(true);

    try {
      const status = await firstValueFrom(this.http.get<LocalRuntimeStatus>('/api/runtime/status'));

      this.status.set(status);
      this.error.set(null);
    } catch {
      this.error.set('Unable to reach the local Twitch runtime.');
      throw new Error('Unable to load the local Twitch runtime status.');
    } finally {
      this.loading.set(false);
    }
  }

  openEventStream(): void {
    if (this.eventSource) {
      return;
    }

    const eventSource = new EventSource('/api/runtime/events');
    this.eventSource = eventSource;

    eventSource.addEventListener('snapshot', (event) => {
      this.applyStreamMessage(event.data);
    });
    eventSource.addEventListener('event', (event) => {
      this.applyStreamMessage(event.data);
    });
    eventSource.onerror = () => {
      this.error.set('Lost the local Twitch runtime event stream.');
    };
  }

  closeEventStream(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  async loadChatCosmetics(): Promise<void> {
    const cosmetics = await firstValueFrom(
      this.http.get<ChatCosmeticsByUserId>('/api/chat/cosmetics'),
    );
    this.chatCosmetics.set(cosmetics);
  }

  getAutomations(): Promise<AutomationDefinition[]> {
    return firstValueFrom(this.http.get<AutomationDefinition[]>('/api/automations'));
  }

  saveAutomation(definition: AutomationDefinition): Promise<AutomationDefinition> {
    return firstValueFrom(
      this.http.put<AutomationDefinition>(
        `/api/automations/${encodeURIComponent(definition.id)}`,
        definition,
      ),
    );
  }

  async deleteAutomation(id: string): Promise<boolean> {
    await firstValueFrom(this.http.delete<void>(`/api/automations/${encodeURIComponent(id)}`));
    return true;
  }

  getCommands(): Promise<CommandDefinition[]> {
    return firstValueFrom(this.http.get<CommandDefinition[]>('/api/commands'));
  }

  saveCommand(definition: CommandDefinition): Promise<CommandDefinition> {
    return firstValueFrom(
      this.http.put<CommandDefinition>(
        `/api/commands/${encodeURIComponent(definition.id)}`,
        definition,
      ),
    );
  }

  async deleteCommand(id: string): Promise<boolean> {
    await firstValueFrom(this.http.delete<void>(`/api/commands/${encodeURIComponent(id)}`));
    return true;
  }

  async sendChatMessage(message: string): Promise<boolean> {
    await firstValueFrom(this.http.post<void>('/api/chat/messages', { message }));
    return true;
  }

  async getUserIdByLogin(login: string): Promise<string> {
    const result = await firstValueFrom(
      this.http.get<{ userId: string }>(`/api/users/by-login/${encodeURIComponent(login)}`),
    );
    return result.userId;
  }

  async timeoutUser(userId: string, durationSeconds: number, reason?: string): Promise<boolean> {
    await firstValueFrom(
      this.http.post<void>('/api/moderation/timeouts', {
        userId,
        durationSeconds,
        reason,
      }),
    );
    return true;
  }

  async banUser(userId: string, reason?: string): Promise<boolean> {
    await firstValueFrom(this.http.post<void>('/api/moderation/bans', { userId, reason }));
    return true;
  }

  async unbanUser(userId: string): Promise<boolean> {
    await firstValueFrom(
      this.http.delete<void>(`/api/moderation/bans/${encodeURIComponent(userId)}`),
    );
    return true;
  }

  async deleteChatMessage(messageId: string): Promise<boolean> {
    await firstValueFrom(
      this.http.delete<void>(`/api/moderation/chat/${encodeURIComponent(messageId)}`),
    );
    return true;
  }

  async updateChatSettings(settings: ChatSettingsUpdate): Promise<boolean> {
    await firstValueFrom(this.http.patch<void>('/api/chat/settings', settings));
    return true;
  }

  async sendShoutout(targetBroadcasterId: string): Promise<boolean> {
    await firstValueFrom(this.http.post<void>('/api/chat/shoutouts', { targetBroadcasterId }));
    return true;
  }

  getCustomRewards(): Promise<ChannelPointReward[]> {
    return firstValueFrom(this.http.get<ChannelPointReward[]>('/api/rewards'));
  }

  syncCustomRewards(): Promise<ChannelPointReward[]> {
    return firstValueFrom(this.http.post<ChannelPointReward[]>('/api/rewards/sync', {}));
  }

  createCustomReward(reward: CustomRewardCreateRequest): Promise<ChannelPointReward> {
    return firstValueFrom(this.http.post<ChannelPointReward>('/api/rewards', reward));
  }

  updateCustomReward(
    rewardId: string,
    updates: CustomRewardUpdateRequest,
  ): Promise<ChannelPointReward> {
    return firstValueFrom(
      this.http.patch<ChannelPointReward>(`/api/rewards/${encodeURIComponent(rewardId)}`, updates),
    );
  }

  async deleteCustomReward(rewardId: string): Promise<boolean> {
    await firstValueFrom(this.http.delete<void>(`/api/rewards/${encodeURIComponent(rewardId)}`));
    return true;
  }

  async updateRedemptionStatus(
    rewardId: string,
    redemptionIds: string[],
    status: 'CANCELED' | 'FULFILLED',
  ): Promise<boolean> {
    await firstValueFrom(
      this.http.patch<void>(`/api/rewards/${encodeURIComponent(rewardId)}/redemptions`, {
        redemptionIds,
        status,
      }),
    );
    return true;
  }

  createPoll(title: string, choices: string[], durationSeconds = 60): Promise<{ id: string }> {
    return firstValueFrom(
      this.http.post<{ id: string }>('/api/polls', {
        title,
        choices,
        durationSeconds,
      }),
    );
  }

  async endPoll(pollId: string, status: 'ARCHIVED' | 'TERMINATED'): Promise<boolean> {
    await firstValueFrom(
      this.http.patch<void>(`/api/polls/${encodeURIComponent(pollId)}`, { status }),
    );
    return true;
  }

  createPrediction(
    title: string,
    outcomes: string[],
    durationSeconds = 120,
  ): Promise<{ id: string }> {
    return firstValueFrom(
      this.http.post<{ id: string }>('/api/predictions', {
        title,
        outcomes,
        durationSeconds,
      }),
    );
  }

  async resolvePrediction(
    predictionId: string,
    status: 'CANCELED' | 'LOCKED' | 'RESOLVED',
    winningOutcomeId?: string,
  ): Promise<boolean> {
    await firstValueFrom(
      this.http.patch<void>(`/api/predictions/${encodeURIComponent(predictionId)}`, {
        status,
        winningOutcomeId,
      }),
    );
    return true;
  }

  getStreamInfo(): Promise<TwitchStreamInfo | null> {
    return firstValueFrom(this.http.get<TwitchStreamInfo | null>('/api/stream'));
  }

  getRewardMappings(): Promise<RewardAutomationMapping[]> {
    return firstValueFrom(this.http.get<RewardAutomationMapping[]>('/api/reward-mappings'));
  }

  saveRewardMapping(mapping: RewardAutomationMapping): Promise<RewardAutomationMapping> {
    return firstValueFrom(
      this.http.put<RewardAutomationMapping>(
        `/api/reward-mappings/${encodeURIComponent(mapping.rewardId)}`,
        mapping,
      ),
    );
  }

  async deleteRewardMapping(rewardId: string): Promise<boolean> {
    await firstValueFrom(
      this.http.delete<void>(`/api/reward-mappings/${encodeURIComponent(rewardId)}`),
    );
    return true;
  }

  private applyStreamMessage(data: string): void {
    const message = JSON.parse(data) as RuntimeStreamMessage;

    if (message.kind === 'snapshot') {
      this.applySnapshot(message.snapshot);
      return;
    }

    this.recentEvents.update((events) => [...events, message.event].slice(-100));
    if (message.event.type === 'automation.inventory-equipped') {
      void this.loadChatCosmetics().catch(() => undefined);
    }
    if (message.event.type === 'twitch.channel.chat.message') {
      const previousIds = new Set(
        this.viewState().chatMessages.map((chatMessage) => chatMessage.id),
      );
      const newMessage = message.viewState.chatMessages.find(
        (chatMessage) => !previousIds.has(chatMessage.id),
      );
      if (newMessage) {
        this.animatedChatMessageId.set(newMessage.id);
      }
    }
    this.viewState.set(message.viewState);
  }

  private applySnapshot(snapshot: RuntimeSnapshot): void {
    void this.loadChatCosmetics().catch(() => undefined);
    this.animatedChatMessageId.set(null);
    this.status.set(snapshot.status);
    this.recentEvents.set(snapshot.recentEvents);
    this.viewState.set(snapshot.viewState);
    this.error.set(null);
  }
}
