import { SendDiscordWebhookAction } from '../../../../shared/contracts/automation';

export type DiscordWebhookMessage = Omit<SendDiscordWebhookAction, 'type'>;

export type DiscordWebhookFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status'>>;

export class DiscordWebhookClient {
  constructor(
    private readonly webhookUrl: string | null,
    private readonly fetcher: DiscordWebhookFetch = (input, init) => fetch(input, init),
  ) {}

  async send(message: DiscordWebhookMessage): Promise<void> {
    if (!this.webhookUrl || !isDiscordWebhookUrl(this.webhookUrl)) {
      throw new Error('A valid Discord webhook URL is not configured.');
    }

    let response: Pick<Response, 'ok' | 'status'>;

    try {
      response = await this.fetcher(this.webhookUrl, {
        body: JSON.stringify({
          allowed_mentions: {
            parse: [],
            roles: message.allowedRoleId ? [message.allowedRoleId] : [],
          },
          content: message.content,
          ...(message.username ? { username: message.username } : {}),
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
    } catch {
      throw new Error('Discord webhook request failed.');
    }

    if (!response.ok) {
      throw new Error(`Discord webhook request failed with status ${response.status}.`);
    }
  }
}

function isDiscordWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      url.protocol === 'https:' &&
      url.hostname === 'discord.com' &&
      /^\/api\/webhooks\/\d+\/[^/]+\/?$/.test(url.pathname) &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
