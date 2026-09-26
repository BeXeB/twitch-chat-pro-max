import { Component } from '@angular/core';
import { AsyncPipe } from '@angular/common';

import { environment } from '../environments/environment';
import { TwitchService } from './core/twitch/twitch.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  title = 'twitch-chat-pro-max';

  private readonly clientId = environment.twitchClientId;

  private readonly redirectUri = 'http://localhost:4200';

  accessToken: string | null = null;

  readonly messages$ = this.twitchService.messages$;

  constructor(private readonly twitchService: TwitchService) {
    this.readOAuthToken();
  }

  connectToTwitch(): void {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'token',
      scope: 'user:read:chat',
      state: crypto.randomUUID(),
    });

    window.location.href = `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  private async readOAuthToken(): Promise<void> {
    const hash = window.location.hash;

    if (!hash) {
      return;
    }

    const params = new URLSearchParams(hash.substring(1));

    this.accessToken = params.get('access_token');

    window.history.replaceState({}, document.title, window.location.pathname);

    if (!this.accessToken) {
      return;
    }

    await this.twitchService.connect(this.accessToken);
  }
}
