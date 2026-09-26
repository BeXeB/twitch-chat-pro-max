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

  readonly alerts$ = this.twitchService.alerts$;

  constructor(private readonly twitchService: TwitchService) {}
}
