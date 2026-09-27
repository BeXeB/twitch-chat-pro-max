import { ApplicationEvent } from './runtime-events';

export interface AutomationDefinition {
  actions: AutomationAction[];
  conditions: AutomationCondition;
  cooldown?: {
    durationMs: number;
  };
  enabled: boolean;
  id: string;
  name: string;
  schedule?: AutomationSchedule;
  trigger: AutomationTrigger;
  version: 1;
}

export interface AutomationSchedule {
  intervalMs: number;
  onlyWhileLive: boolean;
}

export type AutomationAction =
  | AddChannelVipAction
  | AddLeaderboardPointsAction
  | BanUserAction
  | CreatePollAction
  | CreatePredictionAction
  | DelayAction
  | DeleteChatMessageAction
  | EmitRuntimeEventAction
  | IncreaseCustomRewardCostAction
  | EndPollAction
  | ResolvePredictionAction
  | SendChatMessageAction
  | SendShoutoutAction
  | SendDiscordWebhookAction
  | ShowAlertAction
  | TimeoutUserAction
  | UnbanUserAction
  | UpdateChatSettingsAction
  | UpdateRedemptionStatusAction;

export interface AddChannelVipAction {
  targetUserId: string;
  type: 'add-channel-vip';
}

export interface AddLeaderboardPointsAction {
  points: string;
  type: 'add-leaderboard-points';
  userId: string;
}

export interface BanUserAction {
  reason?: string;
  targetUserId: string;
  type: 'ban-user';
}

export interface CreatePollAction {
  choices: string[];
  durationSeconds: number;
  title: string;
  type: 'create-poll';
}

export interface CreatePredictionAction {
  durationSeconds: number;
  outcomes: string[];
  title: string;
  type: 'create-prediction';
}

export interface DelayAction {
  duplicatePolicy: 'allow' | 'replace' | 'skip';
  durationMs: number;
  type: 'delay';
}

export interface DeleteChatMessageAction {
  messageId: string;
  type: 'delete-chat-message';
}

export interface EmitRuntimeEventAction {
  eventType: `automation.${string}`;
  payload: Record<string, unknown>;
  type: 'emit-runtime-event';
}

export interface IncreaseCustomRewardCostAction {
  amount: number;
  rewardId: string;
  type: 'increase-custom-reward-cost';
}

export interface SendChatMessageAction {
  message: string;
  type: 'send-chat';
}

export interface SendDiscordWebhookAction {
  allowedRoleId?: string;
  content: string;
  type: 'send-discord-webhook';
  username?: string;
}

export interface SendShoutoutAction {
  targetBroadcasterId: string;
  type: 'send-shoutout';
}

export interface ShowAlertAction {
  message: string;
  title?: string;
  type: 'show-alert';
}

export interface TimeoutUserAction {
  durationSeconds: number;
  reason?: string;
  targetUserId: string;
  type: 'timeout-user';
}

export interface UnbanUserAction {
  targetUserId: string;
  type: 'unban-user';
}

export interface UpdateChatSettingsAction {
  settings: ChatSettingsUpdate;
  type: 'update-chat-settings';
}

export interface UpdateRedemptionStatusAction {
  redemptionIds: string[];
  rewardId: string;
  status: 'CANCELED' | 'FULFILLED';
  type: 'update-redemption-status';
}

export interface EndPollAction {
  pollId: string;
  status: 'ARCHIVED' | 'TERMINATED';
  type: 'end-poll';
}

export interface ResolvePredictionAction {
  predictionId: string;
  status: 'CANCELED' | 'LOCKED' | 'RESOLVED';
  type: 'resolve-prediction';
  winningOutcomeId?: string;
}

export interface ChatSettingsUpdate {
  emoteMode?: boolean;
  followerMode?: boolean;
  followerModeDurationMinutes?: number;
  slowMode?: boolean;
  slowModeWaitTimeSeconds?: number;
  subscriberMode?: boolean;
}

export type AutomationCondition =
  | AlwaysCondition
  | ConditionGroup
  | EventFieldEqualsCondition;

export interface AlwaysCondition {
  type: 'always';
}

export interface ConditionGroup {
  children: AutomationCondition[];
  type: 'all' | 'any' | 'not';
}

export interface EventFieldEqualsCondition {
  path: string;
  type: 'event-field-equals';
  value: boolean | number | string;
}

export interface AutomationTrigger {
  eventType: ApplicationEvent['type'];
  type: 'application-event';
}
