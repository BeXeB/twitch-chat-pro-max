export const redemptionEventType =
  'twitch.channel.channel_points_custom_reward_redemption.add' as const;

export interface ChannelPointReward {
  backgroundColor: string | null;
  cost: number;
  globalCooldownSeconds: number | null;
  id: string;
  isEnabled: boolean;
  isUserInputRequired: boolean;
  maxPerStream: number | null;
  maxPerUserPerStream: number | null;
  prompt: string | null;
  title: string;
}

export interface ChannelPointRedemption {
  id: string;
  rewardId: string;
}

export interface RewardAutomationMapping {
  automationId: string;
  completionPolicy: RedemptionCompletionPolicy;
  rewardId: string;
  version: 1;
}

export type RedemptionCompletionPolicy =
  | 'auto-cancel'
  | 'auto-fulfill'
  | 'manual-review';
