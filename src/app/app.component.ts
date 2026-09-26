import { Component } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { RouterOutlet } from '@angular/router';

import { TwitchService } from './core/twitch/twitch.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  title = 'twitch-chat-pro-max';

  readonly messages$ = this.twitchService.messages$;

  readonly streamState$ = this.twitchService.streamState$;

  readonly connected$ = this.twitchService.connected$;

  constructor(private readonly twitchService: TwitchService) {
    this.twitchService.initialize();
  }

  connectToTwitch(): void {
    this.twitchService.connectToTwitch();
  }
}
