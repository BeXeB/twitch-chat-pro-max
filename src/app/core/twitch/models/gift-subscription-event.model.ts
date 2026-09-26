export interface GiftSubscriptionEvent {
  userId: string | null;
  username: string | null;
  displayName: string | null;
  total: number;
  tier: string;
  cumulativeTotal: number | null;
  isAnonymous: boolean;
}
