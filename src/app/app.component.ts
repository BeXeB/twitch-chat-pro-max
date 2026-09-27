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
  constructor(readonly localRuntimeClient: LocalRuntimeClient) {}

  ngOnInit(): void {
    void this.localRuntimeClient
      .refreshStatus()
      .then(() => {
        this.localRuntimeClient.openEventStream();
      })
      .catch(() => undefined);
  }
}
