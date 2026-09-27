# Twitch Chat Pro Max Plan

## Goal

Replace the core Twitch and Streamer.bot workflow features with a local Angular application and a localhost companion runtime. The system must provide one Twitch connection, shared state for every layout, configurable commands, and trigger-condition-action automations without introducing cloud services or unrelated economy features.

## Architecture Decisions

- Angular provides the `/overlay`, `/monitor`, and `/dashboard` user interfaces.
- A loopback-only Fastify companion owns Twitch OAuth, token refresh, Helix calls, EventSub, shared runtime state, automation execution, and durable configuration.
- The browser never receives the Twitch client secret, access token, or refresh token.
- All layouts consume a shared snapshot and Server-Sent Event stream from the companion. They do not connect directly to Twitch.
- RxJS remains at transport boundaries. Angular signals hold client-side read models. NgRx is not planned.
- Twitch refresh tokens use Windows DPAPI. Non-secret configuration currently uses versioned JSON files behind repository interfaces so the storage implementation can later move to SQLite without changing feature services.

## Completed

### Twitch Runtime

- Fastify companion with loopback health and runtime-status endpoints.
- Confidential OAuth authorization-code callback flow.
- Windows DPAPI refresh-token persistence, startup restoration, proactive refresh, and one retry after a Helix 401 response.
- One EventSub WebSocket connection with subscription registration, duplicate event protection, keepalive watchdog, Twitch-directed reconnect, and bounded reconnect backoff.
- Typed Helix current-user lookup and structured API errors.

### Shared State

- Normalized application events with correlation and causation fields.
- Bounded backend chat, alert, stream-state, and recent-event projections.
- SSE snapshots and deltas for all browser windows and OBS sources.
- Angular local-runtime client and a compatibility path that mirrors projected chat, alerts, and stream state into the existing `TwitchService` observables when local mode is enabled.

### Automation Foundation

- Shared automation definition, trigger, condition, cooldown, and action contracts.
- Registry-based condition and action handlers.
- Bounded global cooldown tracking.
- Automation persistence and local CRUD endpoints.
- A first `emit-runtime-event` action that demonstrates the full event-to-automation-to-UI flow without a central action switch.
- A backend-owned `send-chat` action with constrained event-payload templates, Twitch message-length checks, and an operational `automation.chat-message-sent` event.
- A backend-owned `timeout-user` moderation action with constrained target/reason templates, Twitch duration validation, and an operational `automation.user-timed-out` event.

### Commands

- Versioned JSON command definitions with canonical names, aliases, enabled state, required role, argument policy, cooldown, and target automation.
- Backend-only parsing of `channel.chat.message` events with `!` commands, Twitch badge role mapping, and role hierarchy checks.
- `command.executed` events with chat-message correlation, parsed arguments, invoker details, and a selected automation target.
- Global and per-user command cooldowns, plus tests for aliases, permissions, argument policy, cooldowns, target routing, and persistence.

### Action Catalog and Timers

- Backend-owned typed Helix actions for chat, bans, unbans, message deletion, chat settings, shoutouts, redemption completion, polls, and predictions.
- A `show-alert` action that projects generated alerts into the shared, bounded alert feed for every layout.
- A `delay` action that persists the remaining action chain instead of blocking the runtime process.
- Timer listing and cancellation endpoints, plus `allow`, `replace`, and `skip` duplicate policies.
- Explicit restart behavior: continuations containing only idempotent local work resume; any continuation with a Twitch mutation is retained as `requires-review` and never replayed automatically.

### Channel Points

- Typed shared reward and redemption contracts.
- Manageable Twitch rewards synchronize through Helix on runtime connection and through a local refresh endpoint.
- Versioned reward-ID to redemption-triggered-automation mappings with one completion policy per reward: auto-fulfill, auto-cancel, or manual review.
- Mapped redemptions run only their selected automation. A successful policy update completes the redemption; missing/failed/manual cases emit review events and leave the redemption unchanged.

### Stream and Moderation Operations

- A shared backend `TwitchOperationsService` owns Helix calls used by automation actions and local HTTP intents.
- Local intent APIs cover chat, timeout/ban/unban, message deletion, chat settings, shoutouts, rewards/redemptions, polls, predictions, and stream metadata.
- Custom rewards support typed create/update/delete and refresh the synchronized reward catalog; deleting a reward also removes its mapping.
- Angular `LocalRuntimeClient` exposes typed operation methods. Monitor moderation controls now use it directly; the `TwitchService` compatibility methods forward to it in local mode.
- Development and production default to local runtime mode; the companion starts OAuth when configured but unauthenticated. Twitch API errors are returned as typed local HTTP errors.

### Layouts

- `/dashboard` provides runtime status, event history, automation and command configuration, reward mapping, chat settings, chat send, shoutout, poll, and prediction controls.
- `/overlay` is a transparent, read-only chat and alert projection suitable for OBS Browser Sources.
- `/monitor` reads chat, alerts, stream status, and deleted-message IDs from the shared runtime projection; moderation results fan out to all open windows.
- Dashboard, monitor, and overlay routes share the existing local runtime client and do not create Twitch connections.

### Local Process Group

- `npm start` launches the Fastify companion, waits for `/api/health`, then launches Angular with a temporary proxy targeting the selected companion port.
- Ctrl+C or either child exiting stops both processes; port conflicts fail without terminating pre-existing listeners.
- `.env.example` documents Twitch credentials, host/port overrides, OAuth redirect, and local data directory settings.
- The local runner and companion support graceful process shutdown.

## Remaining Stages

### 1. Operational Hardening

- Add an execution/connection status view, typed error feed, and bounded operational history.
- Expand EventSub payload fixtures and reconnect/revocation tests.
- Remove the dormant legacy browser OAuth/EventSub/Helix implementation after the remaining compatibility consumers are migrated.
- Move versioned JSON configuration repositories to SQLite only when queries, migrations, or cross-feature transactions justify it.
- Add browser-level responsive/layout tests and verify OBS transparency on target Chromium versions.

## Explicit Non-Goals

- Lootboxes, inventory, XP, currency, economy, or game systems.
- Cloud functions, external database servers, or a remote bot service.
- A general-purpose scripting language or execution of user-provided JavaScript.
- Multi-channel profiles, a plugin marketplace, or a large analytics/event-history database before the core workflow is reliable.

## Definition of Done

The core replacement is complete when one local companion can authenticate with Twitch, survive token and EventSub reconnects, serve all three layouts, execute persisted command/reward/event automations, expose moderation and stream controls, and recover predictable configuration/timer state after restart.
