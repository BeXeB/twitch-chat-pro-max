import { Component, HostListener } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { map } from 'rxjs';

import { TwitchService } from '../../core/twitch/twitch.service';
import { LinkifyPipe } from '../../core/pipes/linkify.pipe';
import { ChatMessage } from '../../core/twitch/models/chat-message.model';

@Component({
  selector: 'app-monitor',
  standalone: true,
  imports: [AsyncPipe, LinkifyPipe],
  templateUrl: './monitor.component.html',
  styleUrls: ['./monitor.component.css'],
})
export class MonitorComponent {
  @HostListener('document:click')
  onDocumentClick(): void {
    this.closeUserActions();
  }

  private currentMessages: ChatMessage[] = [];

  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly messages$ = this.twitchService.messages$.pipe(
    map((messages) => {
      this.currentMessages = messages;
      return [...messages].reverse();
    }),
  );

  readonly streamState$ = this.twitchService.streamState$;

  readonly alerts$ = this.twitchService.alerts$.pipe(
    map((alerts) => [...alerts].reverse()),
  );

  moderationFeedback: { message: string; success: boolean } | null = null;

  deletedMessageIds = new Set<string>();

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

  async timeoutUser(duration: number): Promise<void> {
    if (!this.selectedUser) {
      return;
    }

    const user = this.selectedUser;

    this.closeUserActions();

    const succeeded = await this.runModerationAction(
      this.twitchService.timeoutUser(user.userId, duration),
      `Timed out ${user.displayName} for ${duration} seconds.`,
      `Failed to time out ${user.displayName}.`,
    );

    if (succeeded) {
      this.markUserMessagesDeleted(user.userId);
    }
  }

  async banUser(): Promise<void> {
    if (!this.selectedUser) {
      return;
    }

    const user = this.selectedUser;

    this.closeUserActions();

    const succeeded = await this.runModerationAction(
      this.twitchService.banUser(user.userId),
      `Banned ${user.displayName}.`,
      `Failed to ban ${user.displayName}.`,
    );

    if (succeeded) {
      this.markUserMessagesDeleted(user.userId);
    }
  }

  async unbanUser(): Promise<void> {
    if (!this.selectedUser) {
      return;
    }

    const user = this.selectedUser;

    this.closeUserActions();

    await this.runModerationAction(
      this.twitchService.unbanUser(user.userId),
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

    const succeeded = await this.runModerationAction(
      this.twitchService.deleteChatMessage(user.id),
      `Deleted ${user.displayName}'s message.`,
      `Failed to delete ${user.displayName}'s message.`,
    );

    if (succeeded) {
      this.deletedMessageIds = new Set(this.deletedMessageIds).add(user.id);
    }
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

    this.moderationFeedback = {
      message: succeeded ? successMessage : failureMessage,
      success: succeeded,
    };

    if (this.feedbackTimeout !== null) {
      clearTimeout(this.feedbackTimeout);
    }

    this.feedbackTimeout = setTimeout(() => {
      this.moderationFeedback = null;
      this.feedbackTimeout = null;
    }, 3000);

    return succeeded;
  }

  private markUserMessagesDeleted(userId: string): void {
    const messageIds = this.currentMessages
      .filter((message) => message.userId === userId)
      .map((message) => message.id);

    this.deletedMessageIds = new Set([...this.deletedMessageIds, ...messageIds]);
  }

  constructor(private readonly twitchService: TwitchService) {}
}
