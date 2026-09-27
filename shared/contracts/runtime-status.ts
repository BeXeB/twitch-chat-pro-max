export type TwitchConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reauth-required';

export type TwitchAuthorizationState = 'unconfigured' | 'unauthenticated' | 'authorized';

export interface LocalRuntimeStatus {
  authorizationState: TwitchAuthorizationState;
  connectionState: TwitchConnectionState;
  broadcaster: {
    id: string;
    displayName: string;
  } | null;
  startedAt: string;
}

export interface LocalRuntimeHealth {
  service: 'twitch-runtime';
  status: 'ok';
}
