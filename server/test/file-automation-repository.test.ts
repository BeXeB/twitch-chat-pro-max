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

  assert.equal(isAutomationDefinition(emptyMessage), false);
  assert.equal(isAutomationDefinition(overlongMessage), false);
  assert.equal(isAutomationDefinition(invalidTimeout), false);
});
