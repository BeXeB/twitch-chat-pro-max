import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ChatMessage } from './models/chat-message.model';
import { TwitchUser } from './models/twitch-user.model';
import { StreamState } from './models/stream-state.model';

@Injectable({
  providedIn: 'root',
})
export class TwitchService {
  private readonly clientId = environment.twitchClientId;

  private accessToken: string | null = null;

  private socket: WebSocket | null = null;

  private currentUser: TwitchUser | null = null;

  private readonly messagesSubject = new BehaviorSubject<ChatMessage[]>([]);

  readonly messages$ = this.messagesSubject.asObservable();

  private readonly streamStateSubject = new BehaviorSubject<StreamState>(
    'offline',
  );

  readonly streamState$ = this.streamStateSubject.asObservable();

  async connect(accessToken: string): Promise<void> {
    this.accessToken = accessToken;

    const user = await this.getCurrentUser();

    if (!user) {
      throw new Error('Unable to get Twitch user.');
    }

    this.currentUser = user;

    this.connectToEventSub();
  }

  private async getCurrentUser(): Promise<TwitchUser | null> {
    if (!this.accessToken) {
      return null;
    }

    const response = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId,
      },
    });

    if (!response.ok) {
      console.error('Failed to get Twitch user:', await response.text());

      return null;
    }

    const data = await response.json();

    const user = data.data[0];

    return {
      id: user.id,
      login: user.login,
      displayName: user.display_name,
      profileImageUrl: user.profile_image_url,
    };
  }

  private connectToEventSub(): void {
    this.socket = new WebSocket('wss://eventsub.wss.twitch.tv/ws');

    this.socket.onopen = () => {
      console.log('Connected to Twitch EventSub.');
    };

    this.socket.onmessage = (event) => {
      this.handleEventSubMessage(JSON.parse(event.data));
    };

    this.socket.onerror = (error) => {
      console.error('Twitch EventSub WebSocket error:', error);
    };

    this.socket.onclose = () => {
      console.log('Twitch EventSub WebSocket closed.');

      this.socket = null;
    };
  }

  private async handleEventSubMessage(message: any): Promise<void> {
    const messageType = message.metadata?.message_type;

    switch (messageType) {
      case 'session_welcome':
        await this.subscribeToEvents(message.payload.session.id);
        break;

      case 'notification':
        this.handleNotification(message);
        break;

      case 'session_keepalive':
        break;

      case 'session_reconnect':
        console.log('Twitch requested a reconnect.');
        break;

      default:
        console.log('Unhandled EventSub message:', message);
    }
  }

  private async subscribeToEvents(sessionId: string): Promise<void> {
    if (!this.accessToken || !this.currentUser) {
      return;
    }

    const subscriptions = [
      {
        type: 'channel.chat.message',
        version: '1',
        condition: {
          broadcaster_user_id: this.currentUser.id,
          user_id: this.currentUser.id,
        },
      },
      {
        type: 'stream.online',
        version: '1',
        condition: {
          broadcaster_user_id: this.currentUser.id,
        },
      },
      {
        type: 'stream.offline',
        version: '1',
        condition: {
          broadcaster_user_id: this.currentUser.id,
        },
      },
    ];

    for (const subscription of subscriptions) {
      const response = await fetch(
        'https://api.twitch.tv/helix/eventsub/subscriptions',
        {
          method: 'POST',

          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Client-Id': this.clientId,
            'Content-Type': 'application/json',
          },

          body: JSON.stringify({
            ...subscription,
            transport: {
              method: 'websocket',
              session_id: sessionId,
            },
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        console.error(`Failed to subscribe to ${subscription.type}:`, data);

        continue;
      }

      console.log(`Subscribed to ${subscription.type}`);
    }
  }

  private handleNotification(message: any): void {
    const subscription = message.payload?.subscription;

    switch (subscription?.type) {
      case 'channel.chat.message':
        this.handleChatMessage(message);
        break;

      case 'stream.online':
        this.handleStreamOnline(message);
        break;

      case 'stream.offline':
        this.handleStreamOffline(message);
        break;

      default:
        console.log('Unhandled Twitch notification:', subscription?.type);
    }
  }

  private handleChatMessage(message: any): void {
    const event = message.payload.event;

    const chatMessage: ChatMessage = {
      id: event.message_id,
      userId: event.chatter_user_id,
      username: event.chatter_user_login,
      displayName: event.chatter_user_name,
      message: event.message.text,
      timestamp: message.metadata.message_timestamp,
    };

    const messages = this.messagesSubject.value;

    this.messagesSubject.next([...messages, chatMessage]);
  }

  private handleStreamOnline(message: any): void {
    console.log('Stream went online:', message.payload.event);

    this.streamStateSubject.next('online');
  }

  private handleStreamOffline(message: any): void {
    console.log('Stream went offline:', message.payload.event);

    this.streamStateSubject.next('offline');
  }

  getUser(): TwitchUser | null {
    return this.currentUser;
  }

  disconnect(): void {
    this.socket?.close();

    this.socket = null;
    this.accessToken = null;
    this.currentUser = null;
  }
}
