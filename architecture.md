# Twitch Chat Pro Max Architecture

## Purpose

Twitch Chat Pro Max is a local streaming control application. Angular renders the browser-facing layouts, while a local Fastify companion is the only process that talks to Twitch. This prevents separate browser windows and OBS Browser Sources from creating duplicate EventSub connections or running the same automation more than once.

## End-State Shape

Twitch sends OAuth, EventSub, and Helix traffic to the companion runtime. The runtime normalizes inbound data, updates shared projections, runs commands and automations, and publishes browser-safe state to Angular. The three layouts consume the same local stream.

`Twitch -> Fastify companion -> application events -> state projectors and automation engine -> SSE/HTTP -> Overlay, Monitor, Dashboard`

The reverse direction is intentional UI input rather than direct Twitch access:

`Dashboard or Monitor -> localhost HTTP intent -> backend feature service -> Twitch Helix API`

## Runtime Responsibilities

### Angular Layouts

- `/overlay` is lightweight and read-only. It receives only overlay/chat/alert projections required by OBS.
- `/monitor` displays live operational state and sends moderation intent to the local runtime.
- `/dashboard` manages connection state, commands, automations, rewards, settings, polls, predictions, and stream controls.

Angular does not hold Twitch credentials, open EventSub sockets, execute automations, or contain Twitch business rules. Its local runtime client reads an initial snapshot, applies SSE updates to signal-backed state, and sends user intent through local HTTP endpoints. Development and production both use local runtime mode; when configured but unauthenticated, the app starts the backend OAuth flow.

### Fastify Companion

The companion runs on loopback, normally at `127.0.0.1:4300`. It owns:

- OAuth authorization-code callback, token validation, refresh, and secure persistence.
- One EventSub WebSocket connection and all EventSub subscription registration.
- Helix requests, including one refresh-and-retry after an HTTP 401 response.
- The `TwitchOperationsService` shared by automation handlers and UI intent routes.
- Shared runtime state and state projections.
- Commands, automations, cooldowns, timers, and reward mappings as they are implemented.
- Local REST endpoints and the SSE runtime stream.

The companion must remain running during a stream. `npm start` supervises the local development process group described below.

## Local Process Management

`npm start` runs `scripts/run-local.mjs`. The supervisor launches Fastify first and waits for `GET /api/health` before starting Angular. It creates a temporary proxy configuration for the selected runtime port, reports the local URLs, and stops both child processes when interrupted or when either child exits. A port conflict is reported; unrelated listeners are never killed. `TWITCH_RUNTIME_HOST`, `TWITCH_RUNTIME_PORT`, `TWITCH_FRONTEND_HOST`, and `TWITCH_FRONTEND_PORT` override the defaults. `start:angular` remains available for Angular-only work against the fixed `proxy.conf.json`.

The supervisor reads `.env` through dotenv. `.env.example` documents the Twitch OAuth values, callback/origin, listener overrides, and local persistence path. Server source changes require restarting `npm start`; Angular changes reload in the browser.

## Layouts

`/dashboard` is the configuration and operations surface for runtime status, recent events, automations, commands, reward mappings, chat settings, chat messages, shoutouts, polls, and predictions. `/monitor` is the live chat and moderation surface. `/overlay` is transparent and read-only, showing only the latest chat messages and alerts for OBS.

All three routes read the same Angular `LocalRuntimeClient` signal store. Every browser window may open its own SSE subscription, but only the Fastify companion owns Twitch OAuth, Helix, and EventSub. Monitor moderation responses are normalized as local application events and projected into shared `deletedMessageIds`, so chat deletion/timing effects stay consistent in every view without per-window message copies.

## Authentication and Connection Lifecycle

1. A dashboard login request reaches the local `/api/auth/twitch/login` endpoint.
2. The companion creates a short-lived OAuth state value and redirects to Twitch.
3. Twitch redirects to the registered loopback callback with an authorization code.
4. The companion validates the state, exchanges the code using the server-only client secret, and persists the refresh token with Windows DPAPI.
5. The companion obtains the broadcaster identity through Helix and opens the EventSub WebSocket.
6. On EventSub welcome, it creates subscriptions for chat, stream status, follows, subscriptions, gifts, bits, raids, redemptions, and hype trains.
7. A token nearing expiry refreshes before use. A Helix 401 refreshes once and retries once. An invalid refresh token clears the protected local token and requires a new login.
8. A Twitch-directed EventSub reconnect uses Twitch's supplied URL. A genuine lost socket creates a new session and re-registers subscriptions with bounded backoff.

## Inbound Event Flow

1. `EventSubClient` parses the WebSocket envelope and validates its basic shape.
2. `LocalRuntimeService` converts the payload into an `ApplicationEvent` with an ID, source, type, timestamp, payload, and optional correlation/causation IDs.
3. `ApplicationEventDispatcher` drops recently seen IDs to prevent duplicate delivery.
4. State projectors update bounded chat, alert, stream, and recent-event read models.
5. For `twitch.channel.chat.message`, the command service parses the message once. A recognized, authorized command that passes its argument and cooldown policy emits a correlated `command.executed` event.
6. For a mapped channel-point redemption, the reward router invokes only the mapping's redemption-triggered automation, then follows its completion policy.
7. The automation engine evaluates matching definitions. A command event specifies its target automation ID, so only that definition runs. It uses trigger, condition, cooldown, and action registries instead of a central action switch.
8. The runtime broadcasts each event and its updated view state to all SSE clients.
9. Angular signal stores apply the snapshot or delta. The monitor derives its chat and alert streams directly from the shared view signal; other legacy consumers can still use the `TwitchService` compatibility facade.

## Commands

Commands are persisted configuration rather than browser code. Each definition has a lowercase canonical name, optional aliases, enabled state, required Twitch role, argument policy, optional global or per-user cooldown, and one target automation ID.

Chat messages beginning with `!` are parsed by the companion. Twitch badges determine the caller's effective role: `everyone`, `subscriber`, `vip`, `moderator`, or `broadcaster`. On success, the companion emits `command.executed` with the parsed argument list, original message correlation, and caller data. The event's target automation ID prevents unrelated command automations from running.

## Automation Model

An automation is persisted as an `AutomationDefinition`.

- A trigger matches an application event type.
- Conditions can be `always`, compare an event payload field, or compose child conditions with `all`, `any`, and `not`.
- An optional global cooldown reserves execution after conditions pass.
- Actions are registered by their `type`. New action classes are added to the action registry, not to a growing central switch statement.
- Each action receives an immutable source event and an emit callback. Derived events carry causation and correlation information.

`emit-runtime-event` proves the event flow by publishing a derived `automation.*` event. Twitch mutation actions now cover chat, bans, unbans, message deletion, chat settings, shoutouts, redemption status, polls, and predictions. String fields use explicit `{{event.payload.path}}` placeholders, and typed action validation rejects invalid Twitch limits before execution. Each successful operation emits an auditable derived event. `show-alert` additionally projects a custom alert into the shared alert feed. Derived events cannot trigger automations recursively.

`delay` is a continuation boundary, not a blocking sleep. When reached, the engine atomically persists the source event and only the actions still to run, then stops the current execution. The scheduler supports `allow`, `replace`, and `skip` duplicate policies and exposes local list/cancel operations. On restart, continuations containing only idempotent local work resume at or after their due time. A continuation with a Twitch mutation is marked `requires-review` and emits an operational event instead of being replayed blindly.

## Channel Points

The companion synchronizes manageable channel-point rewards from Helix after connecting and on an explicit local refresh request. Each persisted reward mapping links one reward ID to one automation whose trigger is the redemption EventSub type, and selects `auto-fulfill`, `auto-cancel`, or `manual-review` completion.

On redemption, the router runs only the mapped automation. It updates Twitch only after a completed result: auto-fulfill and auto-cancel issue one typed redemption-status update, while manual, missing, failed, disabled, or mismatched mappings emit `automation.redemption-requires-review` and leave the redemption pending. Unmapped redemptions retain ordinary event automation behavior.

## Local Operations

`TwitchOperationsService` is the backend feature boundary for Helix mutations and stream metadata reads. Automation action handlers and Fastify intent routes both use this service, so the dashboard and automations share the same connected broadcaster identity, token refresh behavior, and error handling.

The Angular `LocalRuntimeClient` provides typed methods for chat messages/settings, timeout/ban/unban, chat deletion, shoutouts, custom reward CRUD, redemption completion, polls, predictions, and stream information. The monitor's current moderation controls use these methods. `TwitchService` remains as a read-model compatibility facade and forwards its operation methods to the local client in the default local mode; it does not expose the backend token.

## Persistence

### Credentials

The refresh token is encrypted with Windows DPAPI and stored under the ignored local data directory. It can be decrypted only by the current Windows user. The client secret exists only in the companion environment configuration.

### Configuration

Automation definitions, scheduled continuations, and reward mappings are stored in separate versioned JSON documents under the local data directory. Their repository interfaces isolate feature services from this storage detail. Writes are atomic, and the storage can move to SQLite later without changing automation handlers or HTTP contracts.

Browser `localStorage` remains appropriate only for non-sensitive per-window preferences such as layout filters and theme. It is not used for Twitch tokens or shared business configuration.

## Current Local API

- `GET /api/health` reports companion liveness.
- `GET /api/runtime/status` returns safe connection status.
- `GET /api/runtime/events` is the SSE stream of snapshots and deltas.
- `GET /api/auth/twitch/login` starts Twitch authorization.
- `GET /api/auth/twitch/callback` receives the Twitch OAuth callback.
- `GET /api/automations` lists persisted automations.
- `PUT /api/automations/:automationId` creates or updates a validated automation.
- `DELETE /api/automations/:automationId` removes an automation.
- `GET /api/commands` lists persisted commands.
- `PUT /api/commands/:commandId` creates or updates a validated command whose target automation exists.
- `DELETE /api/commands/:commandId` removes a command.
- `GET /api/timers` lists scheduled and review-required continuations.
- `DELETE /api/timers/:timerId` cancels a pending continuation.
- `GET /api/rewards` returns the current synchronized reward catalog.
- `POST /api/rewards/sync` refreshes the reward catalog through Helix.
- `GET /api/reward-mappings` lists persisted reward mappings.
- `PUT /api/reward-mappings/:rewardId` creates or updates a validated reward mapping.
- `DELETE /api/reward-mappings/:rewardId` removes a reward mapping.
- `GET /api/stream` reads current broadcaster stream metadata.
- `POST /api/chat/messages`, `PATCH /api/chat/settings`, and `POST /api/chat/shoutouts` send chat intent.
- `POST /api/moderation/timeouts`, `POST /api/moderation/bans`, `DELETE /api/moderation/bans/:resourceId`, and `DELETE /api/moderation/chat/:resourceId` perform moderation intents.
- `POST /api/rewards`, `PATCH /api/rewards/:rewardId`, and `DELETE /api/rewards/:rewardId` manage custom rewards.
- `PATCH /api/rewards/:rewardId/redemptions` updates redemption status.
- `POST /api/polls` and `PATCH /api/polls/:resourceId` manage polls.
- `POST /api/predictions` and `PATCH /api/predictions/:resourceId` manage predictions.

## Current State and Next Work

Implemented now: confidential OAuth, encrypted refresh-token persistence, active token refresh, Helix identity lookup, EventSub lifecycle management, normalized events, SSE fan-out, Angular compatibility state, persisted commands with role/cooldown enforcement, the full initial Twitch action catalog, generated alerts, durable timer continuations, synchronized channel-point rewards, policy-aware redemption automation, backend-owned Twitch operations, and automation/command/timer/reward mapping CRUD.

Next: remove the dormant legacy browser OAuth/EventSub/Helix implementation and expand operational status/error history and reconnect coverage. The local development process group is launched with `npm start`; a native installer or desktop shell is not currently planned.

## Security Boundary

Fastify is bound to loopback. The browser receives status, projected events, and operation results only. It never receives the Twitch client secret, access token, refresh token, or authorization headers. The local application is intended for a trusted Windows account; loopback binding does not protect against malware or an untrusted local user account.
