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
