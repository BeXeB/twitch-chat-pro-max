# Twitch Chat Pro Max

A local Angular control panel and Fastify companion for Twitch chat, moderation, commands, automations, channel points, and OBS layouts. The companion is the only process that owns Twitch OAuth, Helix, and EventSub.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env`, then set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`. Register the callback URL in the Twitch developer console.
3. Run `npm start`.

The launcher starts the Fastify companion first, waits for its health endpoint, then starts Angular with an API proxy. It stops both child processes together when interrupted. Open `http://127.0.0.1:4200`.

If the credentials are not configured, both processes still start, but Twitch operations remain unavailable. Refresh and configuration data are stored under the ignored `data/` directory by default; Windows DPAPI protects the refresh token.

### Ports and local data

Defaults are `127.0.0.1:4300` for Fastify and `127.0.0.1:4200` for Angular. Override them with `TWITCH_RUNTIME_HOST`, `TWITCH_RUNTIME_PORT`, `TWITCH_FRONTEND_HOST`, and `TWITCH_FRONTEND_PORT`. When changing ports, update `TWITCH_REDIRECT_URI` and `TWITCH_FRONTEND_ORIGIN` to match. The launcher generates a temporary Angular proxy configuration for the selected companion port. `TWITCH_RUNTIME_DATA_DIR` changes the local persistence directory.

Angular reloads browser code as it changes. The companion runs directly under the supervisor; restart `npm start` after editing server code.

## Layouts

- `/dashboard` configures commands, automations, reward mappings, and common chat operations.
- `/monitor` shows live chat and alerts and provides moderation controls.
- `/overlay` is a transparent, read-only chat and alert view for OBS Browser Sources.

## Checks

- `npm run build` builds Angular.
- `npm run server:check` type-checks the companion.
- `npm run server:build` builds the companion.
- `npm run server:test` runs companion tests.
- `npm run start:angular` starts only Angular with the fixed proxy in `proxy.conf.json`.
