import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { LocalRuntimeClient } from './core/runtime/local-runtime-client.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  constructor(
    private readonly localRuntimeClient: LocalRuntimeClient,
  ) {}

  ngOnInit(): void {
    void this.localRuntimeClient
      .refreshStatus()
      .then(() => {
        const runtimeStatus = this.localRuntimeClient.status();

        if (runtimeStatus?.authorizationState === 'unauthenticated') {
          window.location.href = '/api/auth/twitch/login';
          return;
        }

        this.localRuntimeClient.openEventStream();
      })
      .catch(() => undefined);
  }
}
