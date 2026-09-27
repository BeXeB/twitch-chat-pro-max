import { Component, DestroyRef, computed, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RuntimeAlert } from '../../../../shared/contracts/runtime-view-state';
import { LocalRuntimeClient } from '../../core/runtime/local-runtime-client.service';
import { overlayAlertPresets } from './overlay-alert-presets';

@Component({
  selector: 'app-overlay',
  standalone: true,
  templateUrl: './overlay.component.html',
  styleUrls: ['./overlay.component.css'],
})
export class OverlayComponent {
  readonly blackPreview = new URLSearchParams(window.location.search).get('preview') === 'black';

  readonly messages = computed(() => [...this.runtime.viewState().chatMessages].slice(-20));

  readonly activeAlert = signal<RuntimeAlert | null>(null);

  readonly alertPresets = overlayAlertPresets;

  private readonly alertQueue: RuntimeAlert[] = [];

  private alertTimeout: ReturnType<typeof setTimeout> | null = null;

  private activeSound: HTMLAudioElement | null = null;

  constructor(
    readonly runtime: LocalRuntimeClient,
    destroyRef: DestroyRef,
  ) {
    runtime.liveAlerts$.pipe(takeUntilDestroyed(destroyRef)).subscribe((alert) => {
      this.alertQueue.push(alert);
      this.showNextAlert();
    });

    destroyRef.onDestroy(() => {
      if (this.alertTimeout !== null) {
        clearTimeout(this.alertTimeout);
      }
      this.stopSound();
    });
  }

  alertTitle(alert: RuntimeAlert): string {
    switch (alert.type) {
      case 'automation':
        return alert.data.title ?? 'Automation';
      case 'bits':
        return 'Bits';
      case 'follow':
        return 'New follow';
      case 'gift-subscription':
        return 'Gift subscriptions';
      case 'raid':
        return 'Raid';
      case 'redemption':
        return 'Channel point redemption';
      case 'subscription':
        return 'New subscription';
    }
  }

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

  private showNextAlert(): void {
    if (this.activeAlert() !== null || this.alertQueue.length === 0) {
      return;
    }

    const alert = this.alertQueue.shift();

    if (!alert) {
      return;
    }

    const preset = this.alertPresets[alert.type];
    this.activeAlert.set(alert);
    this.playSound(preset.soundUrl);
    this.alertTimeout = setTimeout(() => {
      this.activeAlert.set(null);
      this.alertTimeout = null;
      this.stopSound();
      this.showNextAlert();
    }, preset.durationMs);
  }

  private playSound(soundUrl: string | null): void {
    this.stopSound();

    if (!soundUrl) {
      return;
    }

    const sound = new Audio(soundUrl);
    this.activeSound = sound;
    void sound.play().catch(() => {
      if (this.activeSound === sound) {
        this.activeSound = null;
      }
    });
  }

  private stopSound(): void {
    this.activeSound?.pause();
    this.activeSound = null;
  }
}
