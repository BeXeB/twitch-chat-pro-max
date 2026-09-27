import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { AutomationDefinition } from '../../shared/contracts/automation';
import {
  FileAutomationRepository,
  isAutomationDefinition,
} from '../src/features/automations/file-automation-repository';

const automation: AutomationDefinition = {
  actions: [
    {
      eventType: 'automation.raid-alert',
      payload: {},
      type: 'emit-runtime-event',
    },
  ],
  conditions: { type: 'always' },
  enabled: true,
  id: 'raid-alert',
  name: 'Raid alert',
  trigger: { eventType: 'twitch.channel.raid', type: 'application-event' },
  version: 1,
};

test('persists automation definitions across repository instances', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twitch-runtime-automations-'));
  const filePath = join(directory, 'automations.json');

  try {
    const firstRepository = new FileAutomationRepository(filePath);
    await firstRepository.upsert(automation);

    const secondRepository = new FileAutomationRepository(filePath);
    assert.deepEqual(await secondRepository.listEnabled(), [automation]);
    assert.equal(await secondRepository.remove(automation.id), true);
    assert.deepEqual(await secondRepository.list(), []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('rejects invalid action configuration', () => {
  const emptyMessage: AutomationDefinition = {
    ...automation,
    actions: [{ message: '   ', type: 'send-chat' }],
  };
  const overlongMessage: AutomationDefinition = {
    ...automation,
    actions: [{ message: 'x'.repeat(501), type: 'send-chat' }],
  };
  const invalidTimeout: AutomationDefinition = {
    ...automation,
    actions: [
      {
        durationSeconds: 0,
        targetUserId: 'target-user',
        type: 'timeout-user',
      },
    ],
  };
  const validVipAutomation: AutomationDefinition = {
    ...automation,
    actions: [
      { targetUserId: '{{event.payload.user_id}}', type: 'add-channel-vip' },
      {
        amount: 8000,
        rewardId: '{{event.payload.reward.id}}',
        type: 'increase-custom-reward-cost',
      },
    ],
  };
  const validWasteRedemption: AutomationDefinition = {
    ...automation,
    actions: [
      {
        points: '{{event.payload.reward.cost}}',
        type: 'add-leaderboard-points',
        userId: '{{event.payload.user_id}}',
      },
      {
        amount: 1,
        rewardId: '{{event.payload.reward.id}}',
        type: 'increase-custom-reward-cost',
      },
    ],
    conditions: {
      path: 'reward.id',
      type: 'event-field-equals',
      value: '2df00252-acb6-49e1-8e65-03830732dd6f',
    },
  };
  const invalidRewardCost: AutomationDefinition = {
    ...automation,
    actions: [
      {
        amount: 0,
        rewardId: '{{event.payload.reward.id}}',
        type: 'increase-custom-reward-cost',
      },
    ],
  };

  assert.equal(isAutomationDefinition(emptyMessage), false);
  assert.equal(isAutomationDefinition(overlongMessage), false);
  assert.equal(isAutomationDefinition(invalidTimeout), false);
  assert.equal(isAutomationDefinition(validVipAutomation), true);
  assert.equal(isAutomationDefinition(validWasteRedemption), true);
  assert.equal(isAutomationDefinition(invalidRewardCost), false);
});

test('accepts valid schedules and rejects invalid intervals', () => {
  assert.equal(
    isAutomationDefinition({
      ...automation,
      schedule: { intervalMs: 600000, onlyWhileLive: true },
    }),
    true,
  );
  assert.equal(
    isAutomationDefinition({
      ...automation,
      schedule: { intervalMs: 0, onlyWhileLive: true },
    }),
    false,
  );
});

test('validates Discord webhook message and role fields', () => {
  assert.equal(
    isAutomationDefinition({
      ...automation,
      actions: [
        {
          allowedRoleId: '1084227335819100170',
          content: 'Live now!',
          type: 'send-discord-webhook',
          username: 'BeXe',
        },
      ],
    }),
    true,
  );
  assert.equal(
    isAutomationDefinition({
      ...automation,
      actions: [
        {
          allowedRoleId: 'not-a-role-id',
          content: 'Live now!',
          type: 'send-discord-webhook',
        },
      ],
    }),
    false,
  );
});
