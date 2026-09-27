import { Component, computed } from '@angular/core';

import { LocalRuntimeClient } from '../../core/runtime/local-runtime-client.service';

@Component({
  selector: 'app-overlay',
  standalone: true,
  templateUrl: './overlay.component.html',
  styleUrls: ['./overlay.component.css'],
})
export class OverlayComponent {
  readonly blackPreview = new URLSearchParams(window.location.search).get('preview') === 'black';

  readonly messages = computed(() => [...this.runtime.viewState().chatMessages].slice(-20));

  constructor(readonly runtime: LocalRuntimeClient) {}
}
