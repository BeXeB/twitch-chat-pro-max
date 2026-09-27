import { RewardAutomationMapping } from '../../../../shared/contracts/rewards';

export interface RewardMappingRepository {
  get(rewardId: string): Promise<RewardAutomationMapping | null>;
  list(): Promise<RewardAutomationMapping[]>;
  remove(rewardId: string): Promise<boolean>;
  upsert(mapping: RewardAutomationMapping): Promise<void>;
}

export class InMemoryRewardMappingRepository implements RewardMappingRepository {
  constructor(private readonly mappings: RewardAutomationMapping[] = []) {}

  async get(rewardId: string): Promise<RewardAutomationMapping | null> {
    return this.mappings.find((mapping) => mapping.rewardId === rewardId) ?? null;
  }

  async list(): Promise<RewardAutomationMapping[]> {
    return [...this.mappings];
  }

  async remove(rewardId: string): Promise<boolean> {
    const index = this.mappings.findIndex((mapping) => mapping.rewardId === rewardId);

    if (index === -1) {
      return false;
    }

    this.mappings.splice(index, 1);
    return true;
  }

  async upsert(mapping: RewardAutomationMapping): Promise<void> {
    const index = this.mappings.findIndex(
      (existingMapping) => existingMapping.rewardId === mapping.rewardId,
    );

    if (index === -1) {
      this.mappings.push(mapping);
      return;
    }

    this.mappings[index] = mapping;
  }
}
