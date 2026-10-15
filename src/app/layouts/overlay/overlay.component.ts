import { Component, computed } from '@angular/core';

import {
  ChatBorderStyle,
  ChatEntryEffect,
  ChatMessageFont,
  CosmeticSlot,
} from '../../../../shared/contracts/lootboxes';
import { LocalRuntimeClient } from '../../core/runtime/local-runtime-client.service';

export const CHAT_BORDER_CLASSES: Record<ChatBorderStyle, string> = {
  neon: 'overlay-message--border-neon',
  ornate: 'overlay-message--border-ornate',
  starlight: 'overlay-message--border-starlight',
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

  cosmeticsFor(userId: string): Partial<Record<CosmeticSlot, string>> {
    return this.runtime.chatCosmetics()[userId] ?? {};
  }

  borderClassFor(userId: string): string | null {
    const style = this.cosmeticsFor(userId)['border-style'] as ChatBorderStyle | undefined;
    return style ? CHAT_BORDER_CLASSES[style] : null;
  }

  messageFontFamilyFor(userId: string): string | null {
    const font = this.cosmeticsFor(userId)['message-font'] as ChatMessageFont | undefined;
    return font ? CHAT_MESSAGE_FONT_FAMILIES[font] : null;
  }

  entryAnimationFor(messageId: string, userId: string): string | null {
    if (this.runtime.animatedChatMessageId() !== messageId) {
      return null;
    }

    const effect = this.cosmeticsFor(userId)['entry-effect'] as ChatEntryEffect | undefined;
    return effect ? CHAT_ENTRY_ANIMATIONS[effect] : null;
  }
}
