import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { RewardAutomationMapping } from '../../shared/contracts/rewards';
import {
  FileRewardMappingRepository,
  isRewardAutomationMapping,
} from '../src/features/rewards/file-reward-mapping-repository';

const mapping: RewardAutomationMapping = {
  automationId: 'reward-automation',
  completionPolicy: 'auto-fulfill',
  rewardId: 'reward-1',
  version: 1,
};

test('persists reward mappings across repository instances', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twitch-runtime-rewards-'));
  const filePath = join(directory, 'reward-mappings.json');

  try {
    const firstRepository = new FileRewardMappingRepository(filePath);
    await firstRepository.upsert(mapping);

    const secondRepository = new FileRewardMappingRepository(filePath);
    assert.deepEqual(await secondRepository.get(mapping.rewardId), mapping);
    assert.deepEqual(await secondRepository.list(), [mapping]);
    assert.equal(await secondRepository.remove(mapping.rewardId), true);
    assert.deepEqual(await secondRepository.list(), []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('rejects invalid reward mapping completion policies', () => {
  assert.equal(
    isRewardAutomationMapping({
      ...mapping,
      completionPolicy: 'fulfill',
    }),
    false,
  );
});
