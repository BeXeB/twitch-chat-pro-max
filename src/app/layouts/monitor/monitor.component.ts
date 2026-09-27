import { Component, HostListener } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { map } from 'rxjs';

import { LocalRuntimeClient } from '../../core/runtime/local-runtime-client.service';
import { LinkifyPipe } from '../../core/pipes/linkify.pipe';
import { ChatMessage } from '../../core/twitch/models/chat-message.model';

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
      const sent = await this.runModerationAction(
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
    const [command = '', login, ...argumentsList] = commandText
      .slice(1)
      .trim()
      .split(/\s+/);
    const normalizedCommand = command.toLowerCase();

    if (normalizedCommand === 'help') {
      this.showActionFeedback(
        'Commands: /ban <user> [reason], /unban <user>, /timeout <user> <seconds> [reason], /untimeout <user>.',
        true,
      );
      this.chatDraft = '';
      return;
    }

    if (normalizedCommand === 'unban' || normalizedCommand === 'untimeout') {
      if (!login || argumentsList.length > 0) {
        this.showActionFeedback(`Usage: /${normalizedCommand} <user>`, false);
        return;
      }

      const actionName =
        normalizedCommand === 'untimeout' ? 'Removed timeout from' : 'Unbanned';
      const succeeded = await this.runModerationAction(
        this.localRuntimeClient
          .getUserIdByLogin(login)
          .then((userId) => this.localRuntimeClient.unbanUser(userId)),
        `${actionName} ${login}.`,
        `Failed to remove timeout or ban from ${login}.`,
      );

      if (succeeded) {
        this.chatDraft = '';
      }

      return;
    }

    if (normalizedCommand === 'ban') {
      if (!login) {
        this.showActionFeedback('Usage: /ban <user> [reason]', false);
        return;
      }

      const reason = argumentsList.join(' ');
      const succeeded = await this.runModerationAction(
        this.localRuntimeClient
          .getUserIdByLogin(login)
          .then((userId) =>
            this.localRuntimeClient.banUser(userId, reason || undefined),
          ),
        `Banned ${login}.`,
        `Failed to ban ${login}.`,
      );

      if (succeeded) {
        this.chatDraft = '';
      }

      return;
    }

    if (normalizedCommand === 'timeout') {
      const durationSeconds = Number(argumentsList[0]);

      if (
        !login ||
        !Number.isInteger(durationSeconds) ||
        durationSeconds < 1 ||
        durationSeconds > 1209600
      ) {
        this.showActionFeedback(
          'Usage: /timeout <user> <seconds> [reason]',
          false,
        );
        return;
      }

      const reason = argumentsList.slice(1).join(' ');
      const succeeded = await this.runModerationAction(
        this.localRuntimeClient
          .getUserIdByLogin(login)
          .then((userId) =>
            this.localRuntimeClient.timeoutUser(
              userId,
              durationSeconds,
              reason || undefined,
            ),
          ),
        `Timed out ${login} for ${durationSeconds} seconds.`,
        `Failed to time out ${login}.`,
      );

      if (succeeded) {
        this.chatDraft = '';
      }

      return;
    }

    this.showActionFeedback(
      `Unknown command /${normalizedCommand}. Use /help for supported commands.`,
      false,
    );
  }

  async timeoutUser(duration: number): Promise<void> {
    if (!this.selectedUser) {
      return;
    }

    const user = this.selectedUser;

    this.closeUserActions();

    await this.runModerationAction(
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

    await this.runModerationAction(
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

    await this.runModerationAction(
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

    await this.runModerationAction(
      this.localRuntimeClient.deleteChatMessage(user.id),
      `Deleted ${user.displayName}'s message.`,
      `Failed to delete ${user.displayName}'s message.`,
    );
  }

  private async runModerationAction(
    action: Promise<boolean>,
    successMessage: string,
    failureMessage: string,
  ): Promise<boolean> {
    let succeeded = false;

    try {
      succeeded = await action;
    } catch {
      succeeded = false;
    }

    this.showActionFeedback(succeeded ? successMessage : failureMessage, succeeded);

    return succeeded;
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

  constructor(
    private readonly localRuntimeClient: LocalRuntimeClient,
  ) {}
}
