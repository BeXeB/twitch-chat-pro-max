import { Component, computed } from '@angular/core';

import {
  ChatBorderStyle,
  ChatBackgroundPreset,
  ChatEntryEffect,
  ChatMessageFont,
  CosmeticValuesBySlot,
  isChatBorderColor,
  isChatBorderStyle,
  isChatBackgroundPreset,
} from '../../../../shared/contracts/lootboxes';
import { LocalRuntimeClient } from '../../core/runtime/local-runtime-client.service';

export const CHAT_BORDER_CLASSES: Record<ChatBorderStyle, string> = {
  neon: 'overlay-message--border-neon',
  ornate: 'overlay-message--border-ornate',
  starlight: 'overlay-message--border-starlight',
};

export const CHAT_BACKGROUND_CLASSES: Record<ChatBackgroundPreset, string> = {
  'split-contrast-blue': 'overlay-message--background-split-contrast-blue',
};

export const CHAT_ENTRY_ANIMATIONS: Record<ChatEntryEffect, string> = {
  'bounce-in': 'overlay-bounce-in',
  'drift-up': 'overlay-drift-up',
  'fade-in': 'overlay-fade-in',
  'slide-in': 'overlay-slide-in',
};

export const CHAT_MESSAGE_FONT_FAMILIES: Record<ChatMessageFont, string> = {
  'jetbrains-mono': "'JetBrains Mono', monospace",
};

@Component({
  selector: 'app-overlay',
  standalone: true,
  templateUrl: './overlay.component.html',
  styleUrls: ['./overlay.component.css'],
})
export class OverlayComponent {
  readonly blackPreview = new URLSearchParams(window.location.search).get('preview') === 'black';

  readonly messages = computed(() => [...this.runtime.viewState().chatMessages].slice(-30));

  constructor(readonly runtime: LocalRuntimeClient) {
    void this.runtime.loadChatCosmetics().catch(() => undefined);
  }

  cosmeticsFor(userId: string): Partial<CosmeticValuesBySlot> {
    return this.runtime.chatCosmetics()[userId] ?? {};
  }

  borderClassFor(userId: string): string | null {
    const border = this.cosmeticsFor(userId).border;
    return isChatBorderStyle(border) ? CHAT_BORDER_CLASSES[border] : null;
  }

  borderColorFor(userId: string): string | null {
    const border = this.cosmeticsFor(userId).border;
    return isChatBorderColor(border) ? border : null;
  }

  backgroundClassFor(userId: string): string | null {
    const background = this.cosmeticsFor(userId)['background-color'];
    return isChatBackgroundPreset(background) ? CHAT_BACKGROUND_CLASSES[background] : null;
  }

  backgroundColorFor(userId: string): string | null {
    const background = this.cosmeticsFor(userId)['background-color'];
    return typeof background === 'string' && /^#[\da-fA-F]{6}$/.test(background)
      ? background
      : null;
  }

  messageFontFamilyFor(userId: string): string | null {
    const font = this.cosmeticsFor(userId)['message-font'];
    return font ? CHAT_MESSAGE_FONT_FAMILIES[font] : null;
  }

  entryAnimationFor(messageId: string, userId: string): string | null {
    if (this.runtime.animatedChatMessageId() !== messageId) {
      return null;
    }

    const effect = this.cosmeticsFor(userId)['entry-effect'];
    return effect ? CHAT_ENTRY_ANIMATIONS[effect] : null;
  }
}
