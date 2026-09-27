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
