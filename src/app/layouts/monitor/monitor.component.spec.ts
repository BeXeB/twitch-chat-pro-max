import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';

import { LocalRuntimeClient } from '../../core/runtime/local-runtime-client.service';
import { ChatMessage } from '../../core/twitch/models/chat-message.model';
import { MonitorComponent } from './monitor.component';

describe('MonitorComponent', () => {
  it('accepts Twitch-style timeout syntax with an optional duration and reason', async () => {
    const getUserIdByLogin = jasmine
      .createSpy<LocalRuntimeClient['getUserIdByLogin']>('getUserIdByLogin')
      .and.resolveTo('viewer-id');
    const timeoutUser = jasmine
      .createSpy<LocalRuntimeClient['timeoutUser']>('timeoutUser')
      .and.resolveTo(true);
    const component = createComponent(createRuntime({ getUserIdByLogin, timeoutUser }));
    component.chatDraft = '/timeout @viewer 90 repeated spam';

    await component.sendChatMessage();

    expect(getUserIdByLogin).toHaveBeenCalledOnceWith('viewer');
    expect(timeoutUser).toHaveBeenCalledOnceWith('viewer-id', 90, 'repeated spam');
    expect(component.chatDraft).toBe('');
    expect(component.moderationFeedback).toEqual({
      message: 'Timed out viewer for 90 seconds.',
      success: true,
    });
  });

  it('uses Twitch default timeout duration when it is omitted', async () => {
    const timeoutUser = jasmine
      .createSpy<LocalRuntimeClient['timeoutUser']>('timeoutUser')
      .and.resolveTo(true);
    const component = createComponent(
      createRuntime({
        getUserIdByLogin: jasmine
          .createSpy<LocalRuntimeClient['getUserIdByLogin']>('getUserIdByLogin')
          .and.resolveTo('viewer-id'),
        timeoutUser,
      }),
    );
    component.chatDraft = '/timeout viewer spam';

    await component.sendChatMessage();

    expect(timeoutUser).toHaveBeenCalledOnceWith('viewer-id', 600, 'spam');
  });

  it('resolves logins for VIP and shoutout commands', async () => {
    const getUserIdByLogin = jasmine
      .createSpy<LocalRuntimeClient['getUserIdByLogin']>('getUserIdByLogin')
      .and.resolveTo('viewer-id');
    const addChannelVip = jasmine
      .createSpy<LocalRuntimeClient['addChannelVip']>('addChannelVip')
      .and.resolveTo(true);
    const sendShoutout = jasmine
      .createSpy<LocalRuntimeClient['sendShoutout']>('sendShoutout')
      .and.resolveTo(true);
    const component = createComponent(
      createRuntime({ getUserIdByLogin, addChannelVip, sendShoutout }),
    );

    component.chatDraft = '/vip @viewer';
    await component.sendChatMessage();
    component.chatDraft = '/so viewer';
    await component.sendChatMessage();

    expect(getUserIdByLogin).toHaveBeenCalledTimes(2);
    expect(getUserIdByLogin).toHaveBeenCalledWith('viewer');
    expect(addChannelVip).toHaveBeenCalledOnceWith('viewer-id');
    expect(sendShoutout).toHaveBeenCalledOnceWith('viewer-id');
  });

  it('sends default and colored announcement commands', async () => {
    const sendAnnouncement = jasmine
      .createSpy<LocalRuntimeClient['sendAnnouncement']>('sendAnnouncement')
      .and.resolveTo(true);
    const component = createComponent(createRuntime({ sendAnnouncement }));

    component.chatDraft = '/announcepurple Stream starts soon';
    await component.sendChatMessage();
    component.chatDraft = '/announce blue Welcome';
    await component.sendChatMessage();
    component.chatDraft = '/announce Regular message';
    await component.sendChatMessage();

    expect(sendAnnouncement).toHaveBeenCalledWith('Stream starts soon', 'purple');
    expect(sendAnnouncement).toHaveBeenCalledWith('Welcome', 'blue');
    expect(sendAnnouncement).toHaveBeenCalledWith('Regular message', undefined);
  });

  it('updates emote, subscriber, slow, and follower-only chat modes', async () => {
    const updateChatSettings = jasmine
      .createSpy<LocalRuntimeClient['updateChatSettings']>('updateChatSettings')
      .and.resolveTo(true);
    const component = createComponent(createRuntime({ updateChatSettings }));

    component.chatDraft = '/emoteonly';
    await component.sendChatMessage();
    component.chatDraft = '/subscribersoff';
    await component.sendChatMessage();
    component.chatDraft = '/slow 15';
    await component.sendChatMessage();
    component.chatDraft = '/followers 5';
    await component.sendChatMessage();

    expect(updateChatSettings).toHaveBeenCalledWith({ emoteMode: true });
    expect(updateChatSettings).toHaveBeenCalledWith({ subscriberMode: false });
    expect(updateChatSettings).toHaveBeenCalledWith({
      slowMode: true,
      slowModeWaitTimeSeconds: 15,
    });
    expect(updateChatSettings).toHaveBeenCalledWith({
      followerMode: true,
      followerModeDurationMinutes: 5,
    });
  });

  it('surfaces runtime error details for slash commands', async () => {
    const getUserIdByLogin = jasmine
      .createSpy<LocalRuntimeClient['getUserIdByLogin']>('getUserIdByLogin')
      .and.rejectWith(
        new HttpErrorResponse({
          status: 403,
          error: { message: 'Missing moderator permission.' },
        }),
      );
    const component = createComponent(createRuntime({ getUserIdByLogin }));
    component.chatDraft = '/vip viewer';

    await component.sendChatMessage();

    expect(component.moderationFeedback).toEqual({
      message: 'Failed to add viewer as a VIP. Missing moderator permission.',
      success: false,
    });
    expect(component.chatDraft).toBe('/vip viewer');
  });

  it('keeps message deletion attached to the selected chat message', async () => {
    const deleteChatMessage = jasmine
      .createSpy<LocalRuntimeClient['deleteChatMessage']>('deleteChatMessage')
      .and.resolveTo(true);
    const component = createComponent(createRuntime({ deleteChatMessage }));
    const message: ChatMessage = {
      color: null,
      displayName: 'Viewer',
      id: 'message-id',
      message: 'A chat message',
      timestamp: '2026-10-16T00:00:00.000Z',
      userId: 'viewer-id',
      username: 'viewer',
    };

    component.openUserActions(new MouseEvent('click'), message);
    await component.deleteMessage();

    expect(deleteChatMessage).toHaveBeenCalledOnceWith('message-id');
    expect(component.selectedUser).toBeNull();
  });
});

function createComponent(runtime: LocalRuntimeClient): MonitorComponent {
  return TestBed.runInInjectionContext(() => new MonitorComponent(runtime));
}

function createRuntime(overrides: Partial<LocalRuntimeClient> = {}): LocalRuntimeClient {
  return {
    status: signal(null),
    viewState: signal({
      alerts: [],
      chatMessages: [],
      deletedMessageIds: [],
      streamState: 'offline',
    }),
    ...overrides,
  } as unknown as LocalRuntimeClient;
}
