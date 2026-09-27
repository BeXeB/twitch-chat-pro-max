import { randomUUID } from 'node:crypto';

import { TwitchAuthorizationState } from '../../../shared/contracts/runtime-status';
import { TwitchOAuthConfig } from '../config/runtime-config';
import { RefreshTokenStore } from './refresh-token-store';

interface PendingAuthorization {
  expiresAt: number;
}

interface TwitchTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string[];
  token_type: string;
}

interface ActiveTwitchToken extends TwitchTokenResponse {
  expiresAt: number;
}

export class TwitchAuthError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export class TwitchAuthService {
  private readonly pendingAuthorizations = new Map<string, PendingAuthorization>();

  private refreshPromise: Promise<string | null> | null = null;

  private token: ActiveTwitchToken | null = null;

  constructor(
    private readonly config: TwitchOAuthConfig | null,
    private readonly refreshTokenStore: RefreshTokenStore,
  ) {}

  getAuthorizationState(): TwitchAuthorizationState {
    if (!this.config) {
      return 'unconfigured';
    }

    return this.token ? 'authorized' : 'unauthenticated';
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.token) {
      return null;
    }

    if (this.token.expiresAt > Date.now() + 60 * 1000) {
      return this.token.access_token;
    }

    return this.refreshAccessToken();
  }

  createAuthorizationUrl(): string {
    if (!this.config) {
      throw new TwitchAuthError('Twitch OAuth is not configured.');
    }

    this.removeExpiredAuthorizations();

    const state = randomUUID();
    this.pendingAuthorizations.set(state, {
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const parameters = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      force_verify: 'true',
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
    });

    return `https://id.twitch.tv/oauth2/authorize?${parameters.toString()}`;
  }

  async completeAuthorization(code: string, state: string): Promise<void> {
    if (!this.config) {
      throw new TwitchAuthError('Twitch OAuth is not configured.');
    }

    const pendingAuthorization = this.pendingAuthorizations.get(state);
    this.pendingAuthorizations.delete(state);

    if (!pendingAuthorization || pendingAuthorization.expiresAt < Date.now()) {
      throw new TwitchAuthError('The Twitch authorization request is invalid or expired.');
    }

    const token = await this.requestToken({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri,
    });

    await this.storeToken(token);
  }

  async restoreSession(): Promise<boolean> {
    if (!this.config) {
      return false;
    }

    const refreshToken = await this.refreshTokenStore.load();

    if (!refreshToken) {
      return false;
    }

    try {
      return (await this.refreshStoredToken(refreshToken)) !== null;
    } catch {
      return false;
    }
  }

  async refreshAccessToken(): Promise<string | null> {
    if (!this.token) {
      return null;
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refreshStoredToken(this.token.refresh_token).finally(
      () => {
        this.refreshPromise = null;
      },
    );

    return this.refreshPromise;
  }

  private async requestToken(
    parameters: Record<string, string>,
  ): Promise<TwitchTokenResponse> {
    let response: Response;

    try {
      response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(parameters),
      });
    } catch {
      throw new TwitchAuthError('Unable to reach the Twitch OAuth service.');
    }

    if (!response.ok) {
      throw new TwitchAuthError(
        `Twitch token exchange failed with status ${response.status}.`,
        response.status,
      );
    }

    const token = (await response.json()) as Partial<TwitchTokenResponse>;

    if (
      !token.access_token ||
      !token.refresh_token ||
      !token.token_type ||
      !Array.isArray(token.scope) ||
      typeof token.expires_in !== 'number'
    ) {
      throw new TwitchAuthError('Twitch returned an invalid token response.');
    }

    return {
      access_token: token.access_token,
      expires_in: token.expires_in,
      refresh_token: token.refresh_token,
      scope: token.scope,
      token_type: token.token_type,
    };
  }

  private removeExpiredAuthorizations(): void {
    const now = Date.now();

    for (const [state, pendingAuthorization] of this.pendingAuthorizations) {
      if (pendingAuthorization.expiresAt < now) {
        this.pendingAuthorizations.delete(state);
      }
    }
  }

  private async refreshStoredToken(
    refreshToken: string,
  ): Promise<string | null> {
    if (!this.config) {
      return null;
    }

    try {
      const token = await this.requestToken({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });

      await this.storeToken(token);
      return this.token?.access_token ?? null;
    } catch (error) {
      if (
        error instanceof TwitchAuthError &&
        (error.status === 400 || error.status === 401)
      ) {
        this.token = null;
        await this.refreshTokenStore.clear();
        return null;
      }

      throw error;
    }
  }

  private async storeToken(token: TwitchTokenResponse): Promise<void> {
    await this.refreshTokenStore.save(token.refresh_token);
    this.token = {
      ...token,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
  }
}
