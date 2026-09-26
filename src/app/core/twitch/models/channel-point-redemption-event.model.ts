export interface ChannelPointRedemptionEvent {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  rewardId: string;
  rewardTitle: string;
  rewardCost: number;
  userInput: string;
  status: string;
  redeemedAt: string;
}
