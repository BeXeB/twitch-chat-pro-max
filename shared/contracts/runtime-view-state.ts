export interface RuntimeChatMessage {
  color: string | null;
  displayName: string;
  id: string;
  message: string;
  timestamp: string;
  userId: string;
  username: string;
}

export interface RuntimeFollowEvent {
  displayName: string;
  followedAt: string;
  userId: string;
  username: string;
}

export interface RuntimeSubscriptionEvent {
  displayName: string;
  isGift: boolean;
  message: string;
  tier: string;
  userId: string;
  username: string;
}

export interface RuntimeGiftSubscriptionEvent {
  cumulativeTotal: number | null;
  displayName: string | null;
  isAnonymous: boolean;
  tier: string;
  total: number;
  userId: string | null;
  username: string | null;
}

export interface RuntimeBitsEvent {
  bits: number;
  displayName: string | null;
  message: string;
  userId: string | null;
  username: string | null;
}

export interface RuntimeRaidEvent {
  displayName: string;
  userId: string;
  username: string;
  viewers: number;
}

export interface RuntimeRedemptionEvent {
  displayName: string;
  id: string;
  redeemedAt: string;
  rewardCost: number;
  rewardId: string;
  rewardTitle: string;
  status: string;
  userId: string;
  userInput: string;
  username: string;
}

export interface RuntimeAutomationAlert {
  message: string;
  title: string | null;
}

export type RuntimeAlert =
  | {
      data: RuntimeAutomationAlert;
      id: string;
      timestamp: string;
      type: 'automation';
    }
  | {
      data: RuntimeFollowEvent;
      id: string;
      timestamp: string;
      type: 'follow';
    }
  | {
      data: RuntimeSubscriptionEvent;
      id: string;
      timestamp: string;
      type: 'subscription';
    }
  | {
      data: RuntimeGiftSubscriptionEvent;
      id: string;
      timestamp: string;
      type: 'gift-subscription';
    }
  | {
      data: RuntimeBitsEvent;
      id: string;
      timestamp: string;
      type: 'bits';
    }
  | {
      data: RuntimeRaidEvent;
      id: string;
      timestamp: string;
      type: 'raid';
    }
  | {
      data: RuntimeRedemptionEvent;
      id: string;
      timestamp: string;
      type: 'redemption';
    };

export interface RuntimeViewState {
  alerts: RuntimeAlert[];
  chatMessages: RuntimeChatMessage[];
  deletedMessageIds: string[];
  streamState: 'online' | 'offline';
}
