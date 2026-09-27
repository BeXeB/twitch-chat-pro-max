import { Component, computed } from '@angular/core';

import { RuntimeAlert } from '../../../../shared/contracts/runtime-view-state';
import { LocalRuntimeClient } from '../../core/runtime/local-runtime-client.service';

@Component({
  selector: 'app-overlay',
  standalone: true,
  templateUrl: './overlay.component.html',
  styleUrls: ['./overlay.component.css'],
})
export class OverlayComponent {
  readonly messages = computed(() =>
    [...this.runtime.viewState().chatMessages].slice(-14),
  );

  readonly alerts = computed(() =>
    [...this.runtime.viewState().alerts].slice(-5).reverse(),
  );

  constructor(readonly runtime: LocalRuntimeClient) {}

  describeAlert(alert: RuntimeAlert): string {
    switch (alert.type) {
      case 'automation':
        return alert.data.message;
      case 'bits':
        return `${alert.data.displayName ?? 'Someone'} cheered ${alert.data.bits} bits`;
      case 'follow':
        return `${alert.data.displayName} followed`;
      case 'gift-subscription':
        return `${alert.data.displayName ?? 'Someone'} gifted ${alert.data.total} subscriptions`;
      case 'raid':
        return `${alert.data.displayName} raided with ${alert.data.viewers} viewers`;
      case 'redemption':
        return `${alert.data.displayName} redeemed ${alert.data.rewardTitle}`;
      case 'subscription':
        return `${alert.data.displayName} subscribed`;
    }
  }
}
