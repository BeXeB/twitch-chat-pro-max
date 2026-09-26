import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { TwitchService } from './core/twitch/twitch.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  constructor(private readonly twitchService: TwitchService) {}

  ngOnInit(): void {
    this.twitchService.initialize();
  }
}
