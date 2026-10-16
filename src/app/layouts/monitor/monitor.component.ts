import { Component, HostListener } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { map } from 'rxjs';

import { ChatSettingsUpdate } from '../../../../shared/contracts/automation';
import { TwitchChatAnnouncementColor } from '../../../../shared/contracts/twitch-operations';
import { getErrorMessage } from '../../core/utils/error-message';
import { LocalRuntimeClient } from '../../core/runtime/local-runtime-client.service';
import { normalizeTwitchLogin } from '../../core/twitch/normalize-twitch-login';
import { LinkifyPipe } from '../../core/pipes/linkify.pipe';
import { ChatMessage } from '../../core/twitch/models/chat-message.model';

const chatModeCommands: Record<
  string,
  { enabled: boolean; label: string; setting: 'emoteMode' | 'subscriberMode' }
> = {
  emoteonly: { enabled: true, label: 'emote-only', setting: 'emoteMode' },
  emoteonlyoff: { enabled: false, label: 'emote-only', setting: 'emoteMode' },
  subscribers: { enabled: true, label: 'subscriber-only', setting: 'subscriberMode' },
  subscribersoff: { enabled: false, label: 'subscriber-only', setting: 'subscriberMode' },
};

const announcementCommandColors: Record<string, TwitchChatAnnouncementColor> = {
  announceblue: 'blue',
  announcegreen: 'green',
  announceorange: 'orange',
  announcepurple: 'purple',
};

@Component({
  selector: 'app-monitor',
  standalone: true,
  imports: [AsyncPipe, FormsModule, LinkifyPipe],
  templateUrl: './monitor.component.html',
  styleUrls: ['./monitor.component.css'],
})
export class MonitorComponent {
  @HostListener('document:click')
  onDocumentClick(): void {
    this.closeUserActions();
  }

  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly messages$ = toObservable(this.localRuntimeClient.viewState).pipe(
    map((viewState) => [...viewState.chatMessages].reverse()),
  );

  readonly viewState = this.localRuntimeClient.viewState;

  readonly runtimeStatus = this.localRuntimeClient.status;

  readonly streamState$ = toObservable(this.localRuntimeClient.viewState).pipe(
    map((viewState) => viewState.streamState),
  );

  readonly alerts$ = toObservable(this.localRuntimeClient.viewState).pipe(
    map((viewState) => [...viewState.alerts].reverse()),
  );

  moderationFeedback: { message: string; success: boolean } | null = null;

  chatDraft = '';

  sendingChatMessage = false;

  selectedUser: ChatMessage | null = null;

  userActionsPosition = {
    x: 0,
    y: 0,
  };

  openUserActions(event: MouseEvent, message: ChatMessage): void {
    event.stopPropagation();

    this.selectedUser = message;

    this.userActionsPosition = {
      x: event.clientX,
      y: event.clientY,
    };
  }

  closeUserActions(): void {
    this.selectedUser = null;
  }

  async sendChatMessage(): Promise<void> {
    const message = this.chatDraft.trim();

    if (!message || this.sendingChatMessage) {
      return;
    }

    if (message.startsWith('/')) {
      this.sendingChatMessage = true;

      try {
        await this.runSlashCommand(message);
      } finally {
        this.sendingChatMessage = false;
      }

      return;
    }

    this.sendingChatMessage = true;

    try {
      const sent = await this.runChatAction(
        this.localRuntimeClient.sendChatMessage(message),
        'Message sent.',
        'Failed to send chat message.',
      );

      if (sent) {
        this.chatDraft = '';
      }
    } finally {
      this.sendingChatMessage = false;
    }
  }

  private async runSlashCommand(commandText: string): Promise<void> {
    const [command = '', ...argumentsList] = commandText.slice(1).trim().split(/\s+/);
    const normalizedCommand = command.toLowerCase();

    if (normalizedCommand === 'help') {
      this.showActionFeedback(
        [
          'Commands: /ban <user> [reason], /unban <user>, /timeout <user> [seconds] [reason], /untimeout <user>,',
          '/vip <user>, /shoutout <user> (/so), /announce [color] <message> or /announceblue|green|orange|purple,',
          '/emoteonly, /emoteonlyoff, /subscribers, /subscribersoff, /slow [seconds], /slowoff,',
          '/followers [minutes], /followersoff. Click a chat username for moderation and message deletion.',
        ].join(' '),
        true,
      );
      this.chatDraft = '';
      return;
    }

    if (await this.runModerationSlashCommand(normalizedCommand, argumentsList)) {
      return;
    }
    if (await this.runChatSettingsSlashCommand(normalizedCommand, argumentsList)) {
      return;
    }
    if (await this.runAnnouncementSlashCommand(normalizedCommand, argumentsList)) {
      return;
    }

    this.showActionFeedback(
      `Unknown command /${normalizedCommand}. Use /help for supported commands.`,
      false,
    );
  }

  private async runModerationSlashCommand(
    command: string,
    argumentsList: string[],
  ): Promise<boolean> {
    const login = normalizeTwitchLogin(argumentsList[0] ?? '');

    if (command === 'unban' || command === 'untimeout') {
      if (!login || argumentsList.length !== 1) {
        this.showActionFeedback(`Usage: /${command} <user>`, false);
        return true;
      }

      const actionName = command === 'untimeout' ? 'Removed timeout from' : 'Unbanned';
      const succeeded = await this.runChatAction(
        this.localRuntimeClient
          .getUserIdByLogin(login)
          .then((userId) => this.localRuntimeClient.unbanUser(userId)),
        `${actionName} ${login}.`,
        `Failed to remove timeout or ban from ${login}.`,
      );
      this.clearDraftAfterSuccess(succeeded);
      return true;
    }

    if (command === 'ban') {
      if (!login) {
        this.showActionFeedback('Usage: /ban <user> [reason]', false);
        return true;
      }

      const reason = argumentsList.slice(1).join(' ');
      const succeeded = await this.runChatAction(
        this.localRuntimeClient
          .getUserIdByLogin(login)
          .then((userId) => this.localRuntimeClient.banUser(userId, reason || undefined)),
        `Banned ${login}.`,
        `Failed to ban ${login}.`,
      );
      this.clearDraftAfterSuccess(succeeded);
      return true;
    }

    if (command === 'timeout') {
      const durationArgument = argumentsList[1];
      const hasDuration = durationArgument !== undefined && /^[+-]?\d+$/.test(durationArgument);
      const durationSeconds = hasDuration ? Number(durationArgument) : 600;

      if (
        !login ||
        (hasDuration &&
          (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 1209600))
      ) {
        this.showActionFeedback('Usage: /timeout <user> [seconds] [reason]', false);
        return true;
      }

      const reason = argumentsList.slice(hasDuration ? 2 : 1).join(' ');
      const succeeded = await this.runChatAction(
        this.localRuntimeClient
          .getUserIdByLogin(login)
          .then((userId) =>
            this.localRuntimeClient.timeoutUser(userId, durationSeconds, reason || undefined),
          ),
        `Timed out ${login} for ${durationSeconds} seconds.`,
        `Failed to time out ${login}.`,
      );
      this.clearDraftAfterSuccess(succeeded);
      return true;
    }

    if (command === 'vip') {
      if (!login || argumentsList.length !== 1) {
        this.showActionFeedback('Usage: /vip <user>', false);
        return true;
      }

      const succeeded = await this.runChatAction(
        this.localRuntimeClient
          .getUserIdByLogin(login)
          .then((userId) => this.localRuntimeClient.addChannelVip(userId)),
        `Added ${login} as a VIP.`,
        `Failed to add ${login} as a VIP.`,
      );
      this.clearDraftAfterSuccess(succeeded);
      return true;
    }

    if (command === 'shoutout' || command === 'so') {
      if (!login || argumentsList.length !== 1) {
        this.showActionFeedback(`Usage: /${command} <user>`, false);
        return true;
      }

      const succeeded = await this.runChatAction(
        this.localRuntimeClient
          .getUserIdByLogin(login)
          .then((userId) => this.localRuntimeClient.sendShoutout(userId)),
        `Sent a shoutout to ${login}.`,
        `Failed to send a shoutout to ${login}.`,
      );
      this.clearDraftAfterSuccess(succeeded);
      return true;
    }

    return false;
  }

  private async runChatSettingsSlashCommand(
    command: string,
    argumentsList: string[],
  ): Promise<boolean> {
    const modeCommand = chatModeCommands[command];

    if (modeCommand) {
      if (argumentsList.length > 0) {
        this.showActionFeedback(`Usage: /${command}`, false);
        return true;
      }

      const settings: ChatSettingsUpdate =
        modeCommand.setting === 'emoteMode'
          ? { emoteMode: modeCommand.enabled }
          : { subscriberMode: modeCommand.enabled };
      const succeeded = await this.runChatAction(
        this.localRuntimeClient.updateChatSettings(settings),
        `${modeCommand.enabled ? 'Enabled' : 'Disabled'} ${modeCommand.label} mode.`,
        `Failed to update ${modeCommand.label} mode.`,
      );
      this.clearDraftAfterSuccess(succeeded);
      return true;
    }

    if (command === 'slow') {
      const durationSeconds = argumentsList.length === 0 ? 30 : Number(argumentsList[0]);

      if (
        argumentsList.length > 1 ||
        !Number.isInteger(durationSeconds) ||
        durationSeconds < 1 ||
        durationSeconds > 120
      ) {
        this.showActionFeedback('Usage: /slow [seconds] (1-120)', false);
        return true;
      }

      const succeeded = await this.runChatAction(
        this.localRuntimeClient.updateChatSettings({
          slowMode: true,
          slowModeWaitTimeSeconds: durationSeconds,
        }),
        `Enabled slow mode (${durationSeconds} seconds).`,
        'Failed to enable slow mode.',
      );
      this.clearDraftAfterSuccess(succeeded);
      return true;
    }

    if (command === 'slowoff') {
      if (argumentsList.length > 0) {
        this.showActionFeedback('Usage: /slowoff', false);
        return true;
      }

      const succeeded = await this.runChatAction(
        this.localRuntimeClient.updateChatSettings({ slowMode: false }),
        'Disabled slow mode.',
        'Failed to disable slow mode.',
      );
      this.clearDraftAfterSuccess(succeeded);
      return true;
    }

    if (command === 'followers') {
      const durationMinutes = argumentsList.length === 0 ? 0 : Number(argumentsList[0]);

      if (
        argumentsList.length > 1 ||
        !Number.isInteger(durationMinutes) ||
        durationMinutes < 0 ||
        durationMinutes > 129600
      ) {
        this.showActionFeedback('Usage: /followers [minutes] (0-129600)', false);
        return true;
      }

      const succeeded = await this.runChatAction(
        this.localRuntimeClient.updateChatSettings({
          followerMode: true,
          followerModeDurationMinutes: durationMinutes,
        }),
        `Enabled follower-only mode (${durationMinutes} minute${durationMinutes === 1 ? '' : 's'}).`,
        'Failed to enable follower-only mode.',
      );
      this.clearDraftAfterSuccess(succeeded);
      return true;
    }

    if (command === 'followersoff') {
      if (argumentsList.length > 0) {
        this.showActionFeedback('Usage: /followersoff', false);
        return true;
      }

      const succeeded = await this.runChatAction(
        this.localRuntimeClient.updateChatSettings({ followerMode: false }),
        'Disabled follower-only mode.',
        'Failed to disable follower-only mode.',
      );
      this.clearDraftAfterSuccess(succeeded);
      return true;
    }

    return false;
  }

  private async runAnnouncementSlashCommand(
    command: string,
    argumentsList: string[],
  ): Promise<boolean> {
    const commandColor = announcementCommandColors[command];

    if (command !== 'announce' && !commandColor) {
      return false;
    }

    let color = commandColor;
    let messageArguments = argumentsList;

    if (command === 'announce') {
      const explicitColor = getAnnouncementColor(argumentsList[0]);

      if (explicitColor) {
        color = explicitColor;
        messageArguments = argumentsList.slice(1);
      }
    }

    const message = messageArguments.join(' ').trim();

    if (!message) {
      this.showActionFeedback(`Usage: /${command} [color] <message>`, false);
      return true;
    }

    const succeeded = await this.runChatAction(
      this.localRuntimeClient.sendAnnouncement(message, color),
      'Announcement sent.',
      'Failed to send announcement.',
    );
    this.clearDraftAfterSuccess(succeeded);
    return true;
  }

  async timeoutUser(duration: number): Promise<void> {
    if (!this.selectedUser) {
      return;
    }

    const user = this.selectedUser;

    this.closeUserActions();

    await this.runChatAction(
      this.localRuntimeClient.timeoutUser(user.userId, duration),
      `Timed out ${user.displayName} for ${duration} seconds.`,
      `Failed to time out ${user.displayName}.`,
    );
  }

  async banUser(): Promise<void> {
    if (!this.selectedUser) {
      return;
    }

    const user = this.selectedUser;

    this.closeUserActions();

    await this.runChatAction(
      this.localRuntimeClient.banUser(user.userId),
      `Banned ${user.displayName}.`,
      `Failed to ban ${user.displayName}.`,
    );
  }

  async unbanUser(): Promise<void> {
    if (!this.selectedUser) {
      return;
    }

    const user = this.selectedUser;

    this.closeUserActions();

    await this.runChatAction(
      this.localRuntimeClient.unbanUser(user.userId),
      `Unbanned ${user.displayName}.`,
      `Failed to unban ${user.displayName}.`,
    );
  }

  async deleteMessage(): Promise<void> {
    if (!this.selectedUser) {
      return;
    }

    const user = this.selectedUser;

    this.closeUserActions();

    await this.runChatAction(
      this.localRuntimeClient.deleteChatMessage(user.id),
      `Deleted ${user.displayName}'s message.`,
      `Failed to delete ${user.displayName}'s message.`,
    );
  }

  private async runChatAction(
    action: Promise<boolean>,
    successMessage: string,
    failureMessage: string,
  ): Promise<boolean> {
    try {
      const succeeded = await action;
      this.showActionFeedback(succeeded ? successMessage : failureMessage, succeeded);
      return succeeded;
    } catch (error) {
      this.showActionFeedback(`${failureMessage} ${getErrorMessage(error)}`, false);
      return false;
    }
  }

  private clearDraftAfterSuccess(succeeded: boolean): void {
    if (succeeded) {
      this.chatDraft = '';
    }
  }

  private showActionFeedback(message: string, success: boolean): void {
    this.moderationFeedback = { message, success };

    if (this.feedbackTimeout !== null) {
      clearTimeout(this.feedbackTimeout);
    }

    this.feedbackTimeout = setTimeout(() => {
      this.moderationFeedback = null;
      this.feedbackTimeout = null;
    }, 3000);
  }

  constructor(private readonly localRuntimeClient: LocalRuntimeClient) {}
}

function getAnnouncementColor(input: string | undefined): TwitchChatAnnouncementColor | undefined {
  switch (input?.toLowerCase()) {
    case 'blue':
      return 'blue';
    case 'green':
      return 'green';
    case 'orange':
      return 'orange';
    case 'primary':
      return 'primary';
    case 'purple':
      return 'purple';
    default:
      return undefined;
  }
}
