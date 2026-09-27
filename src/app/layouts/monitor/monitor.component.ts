import { Component, HostListener } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { LocalRuntimeClient } from '../../core/runtime/local-runtime-client.service';
import { LinkifyPipe } from '../../core/pipes/linkify.pipe';
import { ChatMessage } from '../../core/twitch/models/chat-message.model';

@Component({
  selector: 'app-monitor',
  standalone: true,
  imports: [AsyncPipe, LinkifyPipe, RouterLink],
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

  readonly streamState$ = toObservable(this.localRuntimeClient.viewState).pipe(
    map((viewState) => viewState.streamState),
  );

  readonly alerts$ = toObservable(this.localRuntimeClient.viewState).pipe(
    map((viewState) => [...viewState.alerts].reverse()),
  );

  moderationFeedback: { message: string; success: boolean } | null = null;

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

  constructor(
    private readonly localRuntimeClient: LocalRuntimeClient,
  ) {}
}
