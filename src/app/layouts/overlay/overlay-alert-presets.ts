import { RuntimeAlert } from '../../../../shared/contracts/runtime-view-state';

export interface OverlayAlertPreset {
  durationMs: number;
  imageUrl: string;
  soundUrl: string | null;
}

export const overlayAlertPresets: Record<RuntimeAlert['type'], OverlayAlertPreset> = {
  automation: {
    durationMs: 5500,
    imageUrl: 'assets/overlay-alerts/automation.png',
    soundUrl: null,
  },
  bits: {
    durationMs: 5000,
    imageUrl: 'assets/overlay-alerts/bits.png',
    soundUrl: null,
  },
  follow: {
    durationMs: 5000,
    imageUrl: 'assets/overlay-alerts/follow.png',
    soundUrl: null,
  },
  'gift-subscription': {
    durationMs: 6000,
    imageUrl: 'assets/overlay-alerts/gift-subscription.png',
    soundUrl: null,
  },
  raid: {
    durationMs: 6000,
    imageUrl: 'assets/overlay-alerts/raid.png',
    soundUrl: null,
  },
  redemption: {
    durationMs: 5000,
    imageUrl: 'assets/overlay-alerts/redemption.png',
    soundUrl: null,
  },
  subscription: {
    durationMs: 5500,
    imageUrl: 'assets/overlay-alerts/subscription.png',
    soundUrl: null,
  },
};
