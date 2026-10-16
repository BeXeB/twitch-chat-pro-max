export interface CustomRewardOptions {
  backgroundColor?: string;
  enabled?: boolean;
  globalCooldownSeconds?: number;
  isGlobalCooldownEnabled?: boolean;
  isMaxPerStreamEnabled?: boolean;
  isMaxPerUserPerStreamEnabled?: boolean;
  maxPerStream?: number;
  maxPerUserPerStream?: number;
  prompt?: string;
  userInputRequired?: boolean;
}

export interface CustomRewardCreateRequest extends CustomRewardOptions {
  cost: number;
  title: string;
}

export interface CustomRewardUpdateRequest extends CustomRewardOptions {
  cost?: number;
  title?: string;
}

export interface TwitchStreamInfo {
  gameId: string;
  gameName: string;
  id: string;
  language: string;
  startedAt: string;
  thumbnailUrl: string;
  title: string;
  userId: string;
  userLogin: string;
  userName: string;
  viewerCount: number;
}

export interface TwitchChannelInfo {
  gameId: string;
  gameName: string;
  title: string;
}

export interface TwitchGameCategory {
  id: string;
  name: string;
}

export interface TwitchChannelInfoUpdateRequest {
  gameId?: string;
  title?: string;
}

export interface TwitchChannelStats {
  followerCount: number | null;
  subscriberCount: number | null;
}

export type TwitchChatAnnouncementColor = 'blue' | 'green' | 'orange' | 'primary' | 'purple';

export interface TwitchPollInfo {
  choices: Array<{ id: string; title: string }>;
  id: string;
  startedAt: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'COMPLETED' | 'INVALID' | 'MODERATED' | 'TERMINATED';
  title: string;
}

export interface TwitchPredictionInfo {
  createdAt: string;
  id: string;
  lockedAt: string | null;
  outcomes: Array<{ id: string; title: string }>;
  status: 'ACTIVE' | 'CANCELED' | 'LOCKED' | 'RESOLVED';
  title: string;
}
