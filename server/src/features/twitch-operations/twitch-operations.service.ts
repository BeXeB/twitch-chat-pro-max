import { ChatSettingsUpdate } from '../../../../shared/contracts/automation';
import { ChannelPointReward } from '../../../../shared/contracts/rewards';
import {
  CustomRewardCreateRequest,
  CustomRewardUpdateRequest,
  TwitchStreamInfo,
} from '../../../../shared/contracts/twitch-operations';
import {
  TwitchApiClient,
  TwitchCurrentUser,
} from '../../twitch/twitch-api.client';

export interface ConnectedTwitchContext {
  api: TwitchApiClient;
  broadcaster: TwitchCurrentUser;
}

export class TwitchOperationsService {
  constructor(private readonly getContext: () => ConnectedTwitchContext) {}

  async banUser(userId: string, reason?: string): Promise<void> {
    const { api, broadcaster } = this.getContext();

    await api.banUser({
      broadcasterId: broadcaster.id,
      moderatorId: broadcaster.id,
      reason,
      userId,
    });
  }

  async createCustomReward(
    reward: CustomRewardCreateRequest,
  ): Promise<ChannelPointReward> {
    const { api, broadcaster } = this.getContext();
    return api.createCustomReward(broadcaster.id, reward);
  }

  async createPoll(
    title: string,
    choices: string[],
    durationSeconds: number,
  ): Promise<string> {
    const { api, broadcaster } = this.getContext();

    return api.createPoll({
      broadcasterId: broadcaster.id,
      choices,
      durationSeconds,
      title,
    });
  }

  async createPrediction(
    title: string,
    outcomes: string[],
    durationSeconds: number,
  ): Promise<string> {
    const { api, broadcaster } = this.getContext();

    return api.createPrediction({
      broadcasterId: broadcaster.id,
      durationSeconds,
      outcomes,
      title,
    });
  }

  async deleteChatMessage(messageId: string): Promise<void> {
    const { api, broadcaster } = this.getContext();

    await api.deleteChatMessage({
      broadcasterId: broadcaster.id,
      messageId,
      moderatorId: broadcaster.id,
    });
  }

  async deleteCustomReward(rewardId: string): Promise<void> {
    const { api, broadcaster } = this.getContext();
    await api.deleteCustomReward(broadcaster.id, rewardId);
  }

  async endPoll(
    pollId: string,
    status: 'ARCHIVED' | 'TERMINATED',
  ): Promise<void> {
    const { api, broadcaster } = this.getContext();
    await api.endPoll({ broadcasterId: broadcaster.id, pollId, status });
  }

  async getStreamInfo(): Promise<TwitchStreamInfo | null> {
    const { api, broadcaster } = this.getContext();
    return api.getStreamInfo(broadcaster.id);
  }

  async getUserIdByLogin(login: string): Promise<string> {
    const { api } = this.getContext();
    return api.getUserIdByLogin(login);
  }

  async resolvePrediction(
    predictionId: string,
    status: 'CANCELED' | 'LOCKED' | 'RESOLVED',
    winningOutcomeId?: string,
  ): Promise<void> {
    const { api, broadcaster } = this.getContext();

    await api.resolvePrediction({
      broadcasterId: broadcaster.id,
      predictionId,
      status,
      winningOutcomeId,
    });
  }

  async sendChatMessage(message: string): Promise<string> {
    const { api, broadcaster } = this.getContext();

    return api.sendChatMessage({
      broadcasterId: broadcaster.id,
      message,
      senderId: broadcaster.id,
    });
  }

  async sendShoutout(targetBroadcasterId: string): Promise<void> {
    const { api, broadcaster } = this.getContext();

    await api.sendShoutout({
      fromBroadcasterId: broadcaster.id,
      moderatorId: broadcaster.id,
      targetBroadcasterId,
    });
  }

  async timeoutUser(
    userId: string,
    durationSeconds: number,
    reason?: string,
  ): Promise<void> {
    const { api, broadcaster } = this.getContext();

    await api.timeoutUser({
      broadcasterId: broadcaster.id,
      durationSeconds,
      moderatorId: broadcaster.id,
      reason,
      userId,
    });
  }

  async unbanUser(userId: string): Promise<void> {
    const { api, broadcaster } = this.getContext();

    await api.unbanUser({
      broadcasterId: broadcaster.id,
      moderatorId: broadcaster.id,
      userId,
    });
  }

  async updateChatSettings(settings: ChatSettingsUpdate): Promise<void> {
    const { api, broadcaster } = this.getContext();

    await api.updateChatSettings({
      broadcasterId: broadcaster.id,
      moderatorId: broadcaster.id,
      settings,
    });
  }

  async updateCustomReward(
    rewardId: string,
    updates: CustomRewardUpdateRequest,
  ): Promise<ChannelPointReward> {
    const { api, broadcaster } = this.getContext();
    return api.updateCustomReward(broadcaster.id, rewardId, updates);
  }

  async updateRedemptionStatus(
    rewardId: string,
    redemptionIds: string[],
    status: 'CANCELED' | 'FULFILLED',
  ): Promise<void> {
    const { api, broadcaster } = this.getContext();

    await api.updateRedemptionStatus({
      broadcasterId: broadcaster.id,
      redemptionIds,
      rewardId,
      status,
    });
  }
}
