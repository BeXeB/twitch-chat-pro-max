import { join } from 'node:path';

const twitchScopes = [
  'user:read:chat',
  'user:write:chat',
  'channel:bot',
  'channel:manage:broadcast',
  'channel:read:redemptions',
  'channel:manage:redemptions',
  'channel:read:subscriptions',
  'channel:manage:polls',
  'channel:manage:predictions',
  'bits:read',
  'moderator:read:followers',
  'moderator:read:chatters',
  'moderator:read:moderators',
  'moderator:manage:announcements',
  'moderator:manage:chat_messages',
  'moderator:manage:banned_users',
  'moderator:manage:shoutouts',
  'moderator:manage:chat_settings',
] as const;

export interface TwitchOAuthConfig {
  clientId: string;
  clientSecret: string;
  eventSubUrl: string;
  eventSubSubscriptionsUrl: string;
  frontendOrigin: string;
  helixUrl: string;
  redirectUri: string;
  scopes: readonly string[];
}

export interface RuntimeConfig {
  dataDirectory: string;
  twitchOAuth: TwitchOAuthConfig | null;
}

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const clientId = environment['TWITCH_CLIENT_ID'];
  const clientSecret = environment['TWITCH_CLIENT_SECRET'];
  const dataDirectory =
    environment['TWITCH_RUNTIME_DATA_DIR'] ?? join(process.cwd(), 'data');

  if (!clientId || !clientSecret) {
    return { dataDirectory, twitchOAuth: null };
  }

  const eventSubUrl =
    environment['TWITCH_EVENTSUB_URL'] ??
    'wss://eventsub.wss.twitch.tv/ws';
  const helixUrl =
    environment['TWITCH_HELIX_URL'] ?? 'https://api.twitch.tv/helix';

  return {
    dataDirectory,
    twitchOAuth: {
      clientId,
      clientSecret,
      eventSubUrl,
      eventSubSubscriptionsUrl: getEventSubSubscriptionsUrl(
        eventSubUrl,
        helixUrl,
      ),
      frontendOrigin:
        environment['TWITCH_FRONTEND_ORIGIN'] ?? 'http://localhost:4200',
      helixUrl,
      redirectUri:
        environment['TWITCH_REDIRECT_URI'] ??
        'http://127.0.0.1:4300/api/auth/twitch/callback',
      scopes: twitchScopes,
    },
  };
}

function getEventSubSubscriptionsUrl(
  eventSubUrl: string,
  helixUrl: string,
): string {
  const endpoint = new URL(eventSubUrl);

  if (endpoint.hostname === 'eventsub.wss.twitch.tv') {
    return `${helixUrl}/eventsub/subscriptions`;
  }

  const protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
  return `${protocol}//${endpoint.host}/eventsub/subscriptions`;
}
