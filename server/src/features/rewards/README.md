# Reward Automations

This feature connects a Twitch Channel Points reward to backend automation. The reward definition lives in Twitch; its behavior lives in the companion. Use the app's Twitch Client ID to create and manage rewards. Seeing a reward in the unfiltered catalog does not mean this app can edit it.

## Waste Walkthrough

The app-managed `Waste` reward has ID `2df00252-acb6-49e1-8e65-03830732dd6f`, costs 515 points, has a 9,999 per-stream limit, and has no cooldown. Twitch chose its background color. Its redemption is mapped to `automation-waste-redemption` in the local reward-mapping data.

When EventSub delivers `twitch.channel.channel_points_custom_reward_redemption.add`:

1. `RedemptionAutomationRouter` reads `event.payload.reward.id` and selects that reward's mapped automation.
2. The automation also checks that the event's reward ID matches Waste. This guard keeps ordinary, unmapped redemptions from accidentally running Waste behavior.
3. `add-leaderboard-points` reads the redeemer's `user_id` and the cost charged for this redemption from `reward.cost`. `FileLeaderboardRepository` adds the points to that user's total in `data/waste-leaderboard.json`, serializing concurrent writes and replacing the file atomically. The initial file preserves the previous leaderboard totals.
4. `increase-custom-reward-cost` reads Waste's current cost from Twitch and updates it by 1. Updates for the same reward are serialized, so rapid redemptions each increase the price.
5. The mapping auto-fulfills the redemption only after both actions complete. If an action fails, the router emits `automation.redemption-requires-review` and does not fulfill it.

Thus the first redemption awards 515 leaderboard points and raises the next cost to 516. The next awards 516 and raises the price to 517. The `!leaderboard` command is separate; this automation only records totals.

## Add an Event Automation

First decide whether you need a new _reaction_ to an event the companion already receives, or a new Twitch EventSub _subscription_. The usual case needs only an automation: EventSub notifications become application events named `twitch.<subscription type>` (for example, `stream.online` becomes `twitch.stream.online`). You can inspect received payloads and event names in the monitor or `/api/runtime/events`. Use actual payload field names when writing conditions or templates.

1. Pick an event type already listed in `server/src/twitch/eventsub.client.ts`, or an existing command/manual event. Create a unique automation ID in the version-1 `data/automations.json` document (or `PUT /api/automations/:automationId`). For example, this sends a public chat message when the stream comes online:

   ```json
   {
     "actions": [{ "message": "Stream is live!", "type": "send-chat" }],
     "conditions": { "type": "always" },
     "enabled": true,
     "id": "automation-stream-online-chat",
     "name": "Stream online chat announcement",
     "trigger": { "eventType": "twitch.stream.online", "type": "application-event" },
     "version": 1
   }
   ```

2. Replace `always` with `event-field-equals` when only some events should run the action. Its `path` starts inside `event.payload`, so `"path": "reward.id"` matches `event.payload.reward.id`. Multiple definitions can listen to the same event. For Channel Point redemptions, match the exact reward ID and also add a mapping in `data/reward-mappings.json` (or `PUT /api/reward-mappings/:rewardId`) to select that automation and control fulfillment. Other events do not need a reward mapping. See the lootbox example below.

3. Reuse an existing action type when possible. For new behavior, add the action to `AutomationAction` in `shared/contracts/automation.ts`, validate its persisted shape in `server/src/features/automations/file-automation-repository.ts`, implement an `AutomationActionHandler`, and register it in `LocalRuntimeService`. Add tests for its behavior and failure path; persist state that must survive a restart. An emitted `automation.*` event is observable but will **not** trigger another automation, to prevent loops.

If the event is **not** yet subscribed to, first add its Twitch subscription type, version, and required condition IDs to `getEventSubSubscriptionDefinitions` in `server/src/twitch/eventsub.client.ts`. Check Twitch's EventSub requirements for OAuth scopes and update `server/src/config/runtime-config.ts` if needed; reconnect/re-authorize for new scopes. Notifications are dispatched by `LocalRuntimeService` as `twitch.<subscription type>` with the raw Twitch event as payload. Add a subscription-definition test in `server/test/eventsub.client.test.ts`; if the UI should display the event specially, update the relevant runtime view projector and tests. The local mock omits some subscriptions (currently chat and Hype Train), so verify support before using it for a new type.

Run `npm run server:test` and `npm run server:check`, then restart the companion after editing local JSON or server source (repositories cache file contents). Check EventSub connection status and `/api/runtime/events` for the incoming event and automation results before testing externally. For redemptions, `automation.redemption-requires-review` means the redemption was not auto-completed; inspect `data/inventories.json` for any recorded opening before retrying. Testing a live Channel Point reward spends points.

## Automation JSON Reference

`data/automations.json` is a versioned document, not a list of individual JSON files. Add a definition to its `automations` array, leaving existing definitions intact:

```json
{
  "version": 1,
  "automations": [
    {
      "version": 1,
      "id": "automation-stream-online-chat",
      "name": "Stream online chat announcement",
      "enabled": true,
      "trigger": { "type": "application-event", "eventType": "twitch.stream.online" },
      "conditions": { "type": "always" },
      "actions": [{ "type": "send-chat", "message": "Stream is live!" }]
    }
  ]
}
```

An automation requires `version: 1`, string `id` and `name`, boolean `enabled`, one `trigger`, one `conditions` tree, and an `actions` array (which may be empty). `trigger.type` must be `application-event`; `eventType` starts with `twitch.`, `command.`, `manual.`, or `automation.`. Twitch notifications arrive as `twitch.<EventSub subscription type>`; `automation.*` emissions are visible but do not trigger further automations. Optional `cooldown: { "durationMs": 60000 }` suppresses repeats per automation in memory (finite milliseconds, at least 0). Optional `schedule: { "intervalMs": 900000, "onlyWhileLive": true }` runs the same actions periodically; the interval is an integer from 1000 to 2147483647 milliseconds. A schedule's trigger still names an application event, but scheduled runs supply a synthetic payload rather than a Twitch notification.

Conditions are `{ "type": "always" }`, `{ "type": "event-field-equals", "path": "reward.id", "value": "REWARD_ID" }`, or groups such as `{ "type": "not", "children": [{ "type": "always" }] }`. Group types are `all`, `any`, and `not`. The path starts inside `event.payload` and equality compares a string, number, or boolean without converting types. Group conditions recurse; `not` means none of its children match. Use a reward-ID condition on redemption automations even when a mapping selects them, to keep unmapped redemptions from running them.

Each action is an object with a `type` and the fields below. All listed fields are required unless marked optional. Text means a nonempty string; limits are character counts before rendering. `[]` means an array, and numeric values in JSON must be numbers rather than quoted strings.

| Action `type`                 | Fields and accepted values                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send-chat`                   | `message`: text, up to 500 characters.                                                                                                                                                                              |
| `send-discord-webhook`        | `content`: text up to 2000; optional `username`: text up to 80; optional `allowedRoleId`: 17-20 digit string.                                                                                                       |
| `show-alert`                  | `message`: text up to 500; optional `title`: text up to 100.                                                                                                                                                        |
| `emit-runtime-event`          | `eventType`: string beginning `automation.`; `payload`: JSON object. Does not trigger another automation.                                                                                                           |
| `open-lootbox`                | `lootboxId`: catalog box ID, lowercase letters/digits followed by up to 63 lowercase letters/digits/`_`/`-`. Only valid on a Channel Point redemption.                                                              |
| `add-leaderboard-points`      | `userId`: text; `points`: text that renders to a positive safe integer (for example, `"{{event.payload.reward.cost}}"`).                                                                                            |
| `add-channel-vip`             | `targetUserId`: text.                                                                                                                                                                                               |
| `ban-user`                    | `targetUserId`: text; optional `reason`: text up to 500.                                                                                                                                                            |
| `timeout-user`                | `targetUserId`: text; `durationSeconds`: integer 1-1209600; optional `reason`: text up to 500.                                                                                                                      |
| `unban-user`                  | `targetUserId`: text.                                                                                                                                                                                               |
| `delete-chat-message`         | `messageId`: text.                                                                                                                                                                                                  |
| `send-shoutout`               | `targetBroadcasterId`: text.                                                                                                                                                                                        |
| `update-chat-settings`        | `settings`: object containing at least one of `emoteMode`, `followerMode`, `slowMode`, `subscriberMode` (booleans), `followerModeDurationMinutes` (integer 0-129600), or `slowModeWaitTimeSeconds` (integer 1-120). |
| `increase-custom-reward-cost` | `rewardId`: text; `amount`: integer 1-1000000000.                                                                                                                                                                   |
| `update-redemption-status`    | `rewardId`: text; `redemptionIds`: 1-50 nonempty strings; `status`: `CANCELED` or `FULFILLED`. Avoid combining this with an auto-completion mapping for the same redemption.                                        |
| `create-poll`                 | `title`: text up to 60; `choices`: 2-5 nonempty strings, each up to 25; `durationSeconds`: integer 15-1800.                                                                                                         |
| `end-poll`                    | `pollId`: text; `status`: `ARCHIVED` or `TERMINATED`.                                                                                                                                                               |
| `create-prediction`           | `title`: text up to 45; `outcomes`: 2-10 nonempty strings, each up to 25; `durationSeconds`: integer 1-1800.                                                                                                        |
| `resolve-prediction`          | `predictionId`: text; `status`: `CANCELED`, `LOCKED`, or `RESOLVED`; optional `winningOutcomeId`: text, required when status is `RESOLVED`.                                                                         |
| `delay`                       | `durationMs`: integer 100-604800000; `duplicatePolicy`: `allow`, `replace`, or `skip`. Must have at least one following action. See `architecture.md` for restart/review behavior.                                  |

Only handler-rendered strings support placeholders such as `{{event.payload.user_id}}` and `{{event.payload.reward.id}}`. These read nested fields of the incoming event payload; missing or non-scalar values render as empty text. Text fields in the table generally render (including poll choices and redemption ID lists), but `open-lootbox.lootboxId`, `send-discord-webhook.allowedRoleId`, enum fields, numeric fields, and `emit-runtime-event.payload` are **literal**, not templates. The validator checks the JSON shape before execution, and handlers validate rendered values again where needed. It does not generally reject extra keys, so misspelled optional fields may be silently ignored. The definitive types and runtime constraints live in `shared/contracts/automation.ts` and `server/src/features/automations/file-automation-repository.ts`.

For rewards, `data/reward-mappings.json` is a separate version-1 document with a `mappings` array. Each mapping has `version: 1`, `rewardId` (Twitch reward ID), `automationId` (an enabled definition's ID), and `completionPolicy`: `auto-fulfill`, `auto-cancel`, or `manual-review`. The mapping selects one automation for that reward and controls Twitch redemption completion. Other EventSub events need no mapping. Prefer the dashboard or the `PUT /api/automations/:automationId` and `PUT /api/reward-mappings/:rewardId` endpoints over hand-editing files while the companion is running; after direct JSON edits, restart it to reload cached data.

## Lootbox Redemptions

The companion seeds `data/lootbox-catalog.json` with a `Chat Style Cache` (`common-lootbox`) when the overlay first requests cosmetics or a box is opened. Its rarity weights are Common 40, Uncommon 25, Rare 20, Epic 10, and Legendary 5. Items within a selected rarity have equal odds. Edit this local catalog to change cosmetics and rarity weights; an existing catalog is never replaced. Opening a box adds the cosmetic to `data/inventories.json`, stacking duplicate item IDs. Equipped cosmetic slots are persisted for later `!equip` support. The OBS overlay reads `/api/chat/cosmetics` and renders equipped message/username colors, border colors/styles, and entry effects. Items are not equipped automatically when won.

Entry effects use the `ChatEntryEffect` type and `CHAT_ENTRY_EFFECTS` registry in `shared/contracts/lootboxes.ts`; the overlay maps each effect to a keyframe in `CHAT_ENTRY_ANIMATIONS` and CSS in `src/app/layouts/overlay/overlay.component.css`. Adding an effect means registering its ID, mapping it to a keyframe, and defining that keyframe. Border styles follow the corresponding `ChatBorderStyle`, `CHAT_BORDER_STYLES`, and `CHAT_BORDER_CLASSES` registries. The types make missing renderer registrations a compile-time error.

### Catalog JSON Reference

`data/lootbox-catalog.json` contains `version: 1`, a nonempty `items` array, and a nonempty `lootboxes` array. To add another box, add any new cosmetics to `items`, then add a box to `lootboxes` with weights for the rarities it can award. For example, append this item and box **inside their respective arrays** (do not replace the existing entries):

```json
{
  "cosmetic": { "slot": "message-color", "value": "#6BCADB" },
  "id": "ocean-text",
  "name": "Ocean Text",
  "rarity": "uncommon"
}
```

```json
{
  "id": "ocean-cache",
  "itemIds": ["ocean-text", "ember-text"],
  "name": "Ocean Cache",
  "rarityWeights": {
    "common": 3,
    "uncommon": 1
  }
}
```

Item and box IDs must be unique lowercase IDs (start with a letter or digit, then up to 63 letters/digits/`_`/`-`); names must be nonblank and at most 80 characters. Rarities are `common`, `uncommon`, `rare`, `epic`, and `legendary`. Each box needs a nonempty `itemIds` list of unique IDs from `items` and a nonempty `rarityWeights` object. Every listed item's rarity must have a weight, and every weighted rarity must have at least one listed item. Weights are positive safe integers totaling no more than 1,000,000,000. In this example, common has a 3/4 chance and uncommon has a 1/4 chance; each listed item within a selected rarity is equally likely. Weights need not sum to 100.

Each item's `cosmetic` has a `slot` and `value`: `message-color`, `username-color`, and `border-color` take `#RRGGBB` colors; `border-style` takes `neon`, `ornate`, or `starlight`; `entry-effect` takes `bounce-in`, `drift-up`, `fade-in`, or `slide-in`. For a new effect or border style value, add it to `shared/contracts/lootboxes.ts` and its renderer mapping/CSS before using it in JSON. A file that exists but fails validation is rejected, not replaced by the starter catalog. Editing the catalog requires restarting the companion because it caches the loaded file. Finally, create a Twitch reward, add an `open-lootbox` automation using the new box ID and that reward's ID condition, and map the reward to the automation as described below. The stored opening result survives retries; changing the catalog does not reroll prior redemptions.

To connect a Channel Point reward, add an automation like this to the version-1 `data/automations.json` document, replacing the reward ID with the ID of a synchronized reward:

```json
{
  "actions": [{ "lootboxId": "common-lootbox", "type": "open-lootbox" }],
  "conditions": {
    "path": "reward.id",
    "type": "event-field-equals",
    "value": "YOUR_TWITCH_REWARD_ID"
  },
  "enabled": true,
  "id": "open-common-lootbox",
  "name": "Open Common Lootbox",
  "trigger": {
    "eventType": "twitch.channel.channel_points_custom_reward_redemption.add",
    "type": "application-event"
  },
  "version": 1
}
```

Then map that Twitch reward to `open-common-lootbox` through the existing reward-mapping flow and choose `auto-fulfill`. The action posts `@viewer opened Chat Style Cache and found Ember Text.` (with the actual viewer and cosmetic) in public chat. A failed chat send leaves the redemption pending for review; retrying the same redemption reuses the recorded drop. Restart the companion after editing local JSON. `!inventory` and `!equip` are not included in this phase.

## Add Another Reward

1. Create the reward through the app (`POST /api/rewards`) or its reward-management UI, and save the returned ID. For example:

   ```json
   {
     "title": "New reward",
     "cost": 500,
     "prompt": "Optional viewer-facing description",
     "userInputRequired": false,
     "enabled": true,
     "isMaxPerStreamEnabled": true,
     "maxPerStream": 9999
   }
   ```

   Omit `backgroundColor` to let Twitch choose it. Set cooldown and usage-limit fields to match the intended reward. Twitch ties management to the creating Client ID; an existing reward owned by another app cannot be adopted or edited here. Rename it through its original owner before creating a same-title replacement.

2. Decide the redemption behavior and find the fields it needs in the raw EventSub payload. Common fields include `user_id`, `user_name`, `user_input`, `reward.id`, and `reward.cost`. Templates use the form `{{event.payload.path}}`.

3. Add an automation to `data/automations.json` (or use `PUT /api/automations/:automationId`). Use the redemption event type and a condition matching the exact reward ID. Reuse existing actions where possible. For durable state, use a repository rather than keeping totals only in handler memory.

4. If the behavior needs a new action, add its type to `AutomationAction` in `shared/contracts/automation.ts`, validate it in `file-automation-repository.ts`, implement its handler, and register it in `LocalRuntimeService`. For new Twitch operations, add the typed Helix request and method to `TwitchApiClient` and `TwitchOperationsService`; add any required OAuth scope and verify authorization after re-consent.

5. Add a reward mapping with `PUT /api/reward-mappings/:rewardId`. Point it to the automation and choose a completion policy: `auto-fulfill` after success, `auto-cancel`, or `manual-review`. Do not enable an unfiltered redemption automation that could run for every reward.

6. Test the action handler, input validation, persistence and failure behavior. Run `npm run server:test` and `npm run server:check`. Restart `npm start` after companion source changes, then verify the reward, automation, mapping, and EventSub connection before testing a live redemption.

## Code Locations

- Redemption routing: `redemption-automation-router.ts`
- Action handlers: `../automations/twitch-action-handlers.ts`
- Action validation: `../automations/file-automation-repository.ts`
- Twitch operations: `../twitch-operations/twitch-operations.service.ts`
- Runtime handler registration: `../../runtime/local-runtime.service.ts`
- Automation and mapping data: `../../../../data/automations.json` and `../../../../data/reward-mappings.json`
