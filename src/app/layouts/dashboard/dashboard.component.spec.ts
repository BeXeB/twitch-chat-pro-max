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
    const runtime = {
      createPoll,
      getPolls,
      getPredictions,
      status: signal(null),
      viewState: signal({
        alerts: [],
        chatMessages: [],
        deletedMessageIds: [],
        streamState: 'offline',
      }),
    } as unknown as LocalRuntimeClient;
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
});
