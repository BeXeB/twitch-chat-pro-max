import { ChannelPointReward } from '../../../../shared/contracts/rewards';

export class TwitchRewardService {
  private rewards: ChannelPointReward[] = [];

  constructor(
    private readonly loadRewards: () => Promise<ChannelPointReward[]>,
  ) {}

  list(): ChannelPointReward[] {
    return structuredClone(this.rewards);
  }

  async sync(): Promise<ChannelPointReward[]> {
    this.rewards = await this.loadRewards();
    return this.list();
  }
}
