import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CommandDefinition } from '../../shared/contracts/command';
import {
  CommandConfigurationError,
  FileCommandRepository,
} from '../src/features/commands/file-command-repository';

const command: CommandDefinition = {
  aliases: ['about'],
  argumentPolicy: 'none',
  enabled: true,
  id: 'about-command',
  name: 'info',
  requiredRole: 'everyone',
  targetAutomationId: 'about-automation',
  version: 1,
};

test('persists commands and rejects duplicate invocation names', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twitch-runtime-commands-'));
  const filePath = join(directory, 'commands.json');

  try {
    const firstRepository = new FileCommandRepository(filePath);
    await firstRepository.upsert(command);

    const secondRepository = new FileCommandRepository(filePath);
    assert.deepEqual(await secondRepository.listEnabled(), [command]);
    await assert.rejects(
      () =>
        secondRepository.upsert({
          ...command,
          aliases: [],
          id: 'duplicate-command',
          name: 'about',
        }),
      CommandConfigurationError,
    );
    assert.equal(await secondRepository.remove(command.id), true);
    assert.deepEqual(await secondRepository.list(), []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
