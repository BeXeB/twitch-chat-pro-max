import { Component } from '@angular/core';
import { AsyncPipe } from '@angular/common';

import { TwitchService } from '../../core/twitch/twitch.service';

@Component({
  selector: 'app-monitor',
  standalone: true,
  imports: [AsyncPipe],
  templateUrl: './monitor.component.html',
  styleUrls: ['./monitor.component.css'],
})
export class MonitorComponent {
  readonly messages$ = this.twitchService.messages$;

  readonly streamState$ = this.twitchService.streamState$;

  readonly follows$ = this.twitchService.follows$;

  readonly subscriptions$ = this.twitchService.subscriptions$;

  readonly giftSubscriptions$ = this.twitchService.giftSubscriptions$;

  readonly bits$ = this.twitchService.bits$;

  readonly raids$ = this.twitchService.raids$;

  readonly redemptions$ = this.twitchService.redemptions$;

  constructor(private readonly twitchService: TwitchService) {}
}
