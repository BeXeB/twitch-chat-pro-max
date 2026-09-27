import { ChannelPointReward } from '../../../../shared/contracts/rewards';

export class TwitchRewardService {
  private rewards: ChannelPointReward[] = [];

  constructor(private readonly loadRewards: () => Promise<ChannelPointReward[]>) {}

  list(): ChannelPointReward[] {
    return structuredClone(this.rewards);
  }

  async sync(): Promise<ChannelPointReward[]> {
    this.rewards = await this.loadRewards();
    return this.list();
  }

  update(reward: ChannelPointReward): void {
    const index = this.rewards.findIndex((cachedReward) => cachedReward.id === reward.id);

    if (index === -1) {
      this.rewards = [...this.rewards, reward];
      return;
    }

    this.rewards = this.rewards.map((cachedReward) =>
      cachedReward.id === reward.id ? reward : cachedReward,
    );
  }
}
