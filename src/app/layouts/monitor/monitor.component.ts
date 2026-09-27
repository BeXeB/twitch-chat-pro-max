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

  readonly messages$ = this.twitchService.messages$;

  readonly streamState$ = this.twitchService.streamState$;

  readonly alerts$ = this.twitchService.alerts$.pipe(
    map((alerts) => [...alerts].reverse()),
  );

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

  timeoutUser(duration: number): void {
    if (!this.selectedUser) {
      return;
    }

    this.twitchService.timeoutUser(this.selectedUser.userId, duration);

    this.closeUserActions();
  }

  banUser(): void {
    if (!this.selectedUser) {
      return;
    }

    this.twitchService.banUser(this.selectedUser.userId);

    this.closeUserActions();
  }

  deleteMessage(): void {
    if (!this.selectedUser) {
      return;
    }

    this.twitchService.deleteChatMessage(this.selectedUser.id);

    this.closeUserActions();
  }

  constructor(private readonly twitchService: TwitchService) {}
}
