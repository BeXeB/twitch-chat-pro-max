import { signal } from '@angular/core';

import { LocalRuntimeClient } from '../../core/runtime/local-runtime-client.service';
import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent', () => {
  it('reports poll creation separately when refreshing the poll list fails', async () => {
    const createPoll = jasmine
      .createSpy<LocalRuntimeClient['createPoll']>('createPoll')
      .and.resolveTo({ id: 'poll-1' });
    const getPolls = jasmine
      .createSpy<LocalRuntimeClient['getPolls']>('getPolls')
      .and.rejectWith(new Error('Poll list unavailable.'));
    const getPredictions = jasmine
      .createSpy<LocalRuntimeClient['getPredictions']>('getPredictions')
      .and.resolveTo([]);
    const runtime = createRuntime({
      createPoll,
      getPolls,
      getPredictions,
    });
    const component = new DashboardComponent(runtime);
    component.pollTitle = 'Best color?';
    component.pollChoices = 'Blue, Green';

    await component.createPoll();

    expect(createPoll).toHaveBeenCalledOnceWith('Best color?', ['Blue', 'Green'], 60);
    expect(getPolls).toHaveBeenCalledOnceWith();
    expect(getPredictions).not.toHaveBeenCalled();
    expect(component.pollTitle).toBe('');
    expect(component.pollChoices).toBe('');
    expect(component.notice()).toEqual({
      message:
        'Poll created (poll-1). The active poll list could not be refreshed. Poll list unavailable.',
      reconnectRequired: false,
      tone: 'error',
    });
  });

  it('resolves a broadcaster login before sending a shoutout', async () => {
    const getUserIdByLogin = jasmine
      .createSpy<LocalRuntimeClient['getUserIdByLogin']>('getUserIdByLogin')
      .and.resolveTo('target-id');
    const sendShoutout = jasmine
      .createSpy<LocalRuntimeClient['sendShoutout']>('sendShoutout')
      .and.resolveTo(true);
    const runtime = createRuntime({ getUserIdByLogin, sendShoutout });
    const component = new DashboardComponent(runtime);
    component.shoutoutBroadcasterLogin = '@some_user';

    await component.sendShoutout();

    expect(getUserIdByLogin).toHaveBeenCalledOnceWith('some_user');
    expect(sendShoutout).toHaveBeenCalledOnceWith('target-id');
    expect(component.shoutoutBroadcasterLogin).toBe('');
    expect(component.notice()?.message).toBe('Shoutout sent to @some_user.');
  });

  it('resolves a login before adding a channel VIP', async () => {
    const getUserIdByLogin = jasmine
      .createSpy<LocalRuntimeClient['getUserIdByLogin']>('getUserIdByLogin')
      .and.resolveTo('vip-id');
    const addChannelVip = jasmine
      .createSpy<LocalRuntimeClient['addChannelVip']>('addChannelVip')
      .and.resolveTo(true);
    const runtime = createRuntime({ getUserIdByLogin, addChannelVip });
    const component = new DashboardComponent(runtime);
    component.moderationLogin = 'vip_user';

    await component.addChannelVip();

    expect(getUserIdByLogin).toHaveBeenCalledOnceWith('vip_user');
    expect(addChannelVip).toHaveBeenCalledOnceWith('vip-id');
    expect(component.notice()?.message).toBe('Added @vip_user as a VIP.');
  });

  it('includes emote-only and subscriber-only modes when saving chat settings', async () => {
    const updateChatSettings = jasmine
      .createSpy<LocalRuntimeClient['updateChatSettings']>('updateChatSettings')
      .and.resolveTo(true);
    const runtime = createRuntime({ updateChatSettings });
    const component = new DashboardComponent(runtime);
    component.emoteMode = true;
    component.slowMode = true;
    component.slowModeWaitTimeSeconds = 15;
    component.subscriberMode = true;

    await component.saveChatSettings();

    expect(updateChatSettings).toHaveBeenCalledOnceWith({
      emoteMode: true,
      followerMode: false,
      slowMode: true,
      slowModeWaitTimeSeconds: 15,
      subscriberMode: true,
    });
  });

  it('sends an announcement with its selected color and clears the message', async () => {
    const sendAnnouncement = jasmine
      .createSpy<LocalRuntimeClient['sendAnnouncement']>('sendAnnouncement')
      .and.resolveTo(true);
    const runtime = createRuntime({ sendAnnouncement });
    const component = new DashboardComponent(runtime);
    component.announcementMessage = '  Stream starting soon!  ';
    component.announcementColor = 'purple';

    await component.sendAnnouncement();

    expect(sendAnnouncement).toHaveBeenCalledOnceWith('Stream starting soon!', 'purple');
    expect(component.announcementMessage).toBe('');
    expect(component.notice()?.message).toBe('Announcement sent.');
  });
});

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
