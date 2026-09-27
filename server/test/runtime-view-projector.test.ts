import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RuntimeViewProjector } from '../src/runtime/runtime-view-projector';

test('projects automation alerts into the bounded shared alert feed', () => {
  const projector = new RuntimeViewProjector();

  const state = projector.project({
    id: 'automation-alert',
    occurredAt: '2026-09-27T00:00:00.000Z',
    payload: { message: 'Timer completed', title: 'Automation' },
    source: 'automation',
    type: 'automation.alert-raised',
  });

  assert.deepEqual(state.alerts, [
    {
      data: { message: 'Timer completed', title: 'Automation' },
      id: 'automation-alert',
      timestamp: '2026-09-27T00:00:00.000Z',
      type: 'automation',
    },
  ]);
});

test('projects moderator deletions into shared chat state', () => {
  const projector = new RuntimeViewProjector();

  projector.project({
    id: 'chat-message-event',
    occurredAt: '2026-09-27T00:00:00.000Z',
    payload: {
      message: { text: 'test message' },
      message_id: 'message-1',
      chatter_user_id: 'user-1',
      chatter_user_login: 'viewer',
      chatter_user_name: 'Viewer',
    },
    source: 'twitch',
    type: 'twitch.channel.chat.message',
  });

  const state = projector.project({
    id: 'moderation-event',
    occurredAt: '2026-09-27T00:00:01.000Z',
    payload: { userId: 'user-1' },
    source: 'manual',
    type: 'manual.user-timed-out',
  });

  assert.deepEqual(state.deletedMessageIds, ['message-1']);

  const afterMessageDeletion = projector.project({
    id: 'message-deletion-event',
    occurredAt: '2026-09-27T00:00:02.000Z',
    payload: { messageId: 'message-2' },
    source: 'manual',
    type: 'manual.chat-message-deleted',
  });

  assert.deepEqual(afterMessageDeletion.deletedMessageIds, [
    'message-1',
    'message-2',
  ]);
});
