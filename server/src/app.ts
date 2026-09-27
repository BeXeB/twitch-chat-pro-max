import Fastify, { FastifyInstance, FastifyReply } from 'fastify';

import { RuntimeStreamMessage } from '../../shared/contracts/runtime-events';
import { LocalRuntimeHealth } from '../../shared/contracts/runtime-status';
import { WindowsDpapiRefreshTokenStore } from './auth/refresh-token-store';
import { TwitchAuthError, TwitchAuthService } from './auth/twitch-auth.service';
import { loadRuntimeConfig } from './config/runtime-config';
import {
  FileAutomationRepository,
  isAutomationDefinition,
} from './features/automations/file-automation-repository';
import {
  CommandConfigurationError,
  FileCommandRepository,
  isCommandDefinition,
} from './features/commands/file-command-repository';
import { FileContinuationRepository } from './features/timers/file-continuation-repository';
import {
  FileRewardMappingRepository,
  isRewardAutomationMapping,
} from './features/rewards/file-reward-mapping-repository';
import { FileLeaderboardRepository } from './features/leaderboard/file-leaderboard-repository';
import { redemptionEventType } from '../../shared/contracts/rewards';
import { ChatSettingsUpdate } from '../../shared/contracts/automation';
import {
  CustomRewardCreateRequest,
  CustomRewardUpdateRequest,
} from '../../shared/contracts/twitch-operations';
import { LocalRuntimeService } from './runtime/local-runtime.service';
import { TwitchApiError } from './twitch/twitch-api.client';

interface TwitchAuthorizationCallbackQuery {
  code?: string;
  error?: string;
  error_description?: string;
  state?: string;
}

interface AutomationRouteParameters {
  automationId: string;
}

interface CommandRouteParameters {
  commandId: string;
}

interface TimerRouteParameters {
  timerId: string;
}

interface RewardRouteParameters {
  rewardId: string;
}

interface ResourceRouteParameters {
  resourceId: string;
}

interface UserRouteParameters {
  login: string;
}

export function createApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof TwitchApiError) {
      const statusCode =
        error.status !== null && error.status >= 400 && error.status < 500 ? error.status : 502;

      return reply.code(statusCode).send({
        error: 'twitch_operation_failed',
        message: error.message,
        twitchStatus: error.status,
      });
    }

    app.log.error({ error }, 'Local runtime request failed.');
    return reply.send(error);
  });

  const config = loadRuntimeConfig();
  const refreshTokenStore = new WindowsDpapiRefreshTokenStore(
    `${config.dataDirectory}/twitch-refresh-token.dat`,
  );
  const twitchAuth = new TwitchAuthService(config.twitchOAuth, refreshTokenStore);
  const automationRepository = new FileAutomationRepository(
    `${config.dataDirectory}/automations.json`,
  );
  const commandRepository = new FileCommandRepository(`${config.dataDirectory}/commands.json`);
  const continuationRepository = new FileContinuationRepository(
    `${config.dataDirectory}/timer-continuations.json`,
  );
  const rewardMappingRepository = new FileRewardMappingRepository(
    `${config.dataDirectory}/reward-mappings.json`,
  );
  const leaderboardRepository = new FileLeaderboardRepository(
    `${config.dataDirectory}/waste-leaderboard.json`,
  );
  const localRuntime = new LocalRuntimeService(
    twitchAuth,
    config.twitchOAuth,
    automationRepository,
    commandRepository,
    continuationRepository,
    rewardMappingRepository,
    config.discordStreamWebhookUrl,
    leaderboardRepository,
  );

  app.addHook('onReady', async () => {
    try {
      await localRuntime.start();

      if (!(await twitchAuth.restoreSession())) {
        return;
      }

      await localRuntime.connect();
    } catch (error) {
      app.log.warn({ error }, 'Unable to restore the Twitch runtime session.');
    }
  });

  app.get(
    '/api/health',
    async (): Promise<LocalRuntimeHealth> => ({
      service: 'twitch-runtime',
      status: 'ok',
    }),
  );

  app.get('/api/runtime/status', async () => localRuntime.getStatus());

  app.get('/api/automations', async () => automationRepository.list());

  app.put<{ Body: unknown; Params: AutomationRouteParameters }>(
    '/api/automations/:automationId',
    async (request, reply) => {
      if (
        !isAutomationDefinition(request.body) ||
        request.body.id !== request.params.automationId
      ) {
        return reply.code(400).send({
          error: 'invalid_automation',
          message: 'The automation definition is invalid.',
        });
      }

      await automationRepository.upsert(request.body);
      return request.body;
    },
  );

  app.delete<{ Params: AutomationRouteParameters }>(
    '/api/automations/:automationId',
    async (request, reply) => {
      const removed = await automationRepository.remove(request.params.automationId);

      return removed ? reply.code(204).send() : reply.code(404).send();
    },
  );

  app.get('/api/commands', async () => commandRepository.list());

  app.put<{ Body: unknown; Params: CommandRouteParameters }>(
    '/api/commands/:commandId',
    async (request, reply) => {
      if (!isCommandDefinition(request.body) || request.body.id !== request.params.commandId) {
        return reply.code(400).send({
          error: 'invalid_command',
          message: 'The command definition is invalid.',
        });
      }

      const definition = request.body;

      const targetExists = (await automationRepository.list()).some(
        (automation) => automation.id === definition.targetAutomationId,
      );

      if (!targetExists) {
        return reply.code(400).send({
          error: 'unknown_automation',
          message: 'The command target automation does not exist.',
        });
      }

      try {
        await commandRepository.upsert(definition);
        return definition;
      } catch (error) {
        if (error instanceof CommandConfigurationError) {
          return reply.code(400).send({
            error: 'conflicting_command',
            message: error.message,
          });
        }

        throw error;
      }
    },
  );

  app.delete<{ Params: CommandRouteParameters }>(
    '/api/commands/:commandId',
    async (request, reply) => {
      const removed = await commandRepository.remove(request.params.commandId);

      return removed ? reply.code(204).send() : reply.code(404).send();
    },
  );

  app.get('/api/timers', async () => localRuntime.listContinuations());

  app.delete<{ Params: TimerRouteParameters }>('/api/timers/:timerId', async (request, reply) => {
    const removed = await localRuntime.cancelContinuation(request.params.timerId);

    return removed ? reply.code(204).send() : reply.code(404).send();
  });

  app.get('/api/rewards', async () => localRuntime.listRewards());

  app.get('/api/rewards/all', async () => localRuntime.listAllRewards());

  app.post('/api/rewards/sync', async () => localRuntime.syncRewards());

  app.get('/api/reward-mappings', async () => rewardMappingRepository.list());

  app.put<{ Body: unknown; Params: RewardRouteParameters }>(
    '/api/reward-mappings/:rewardId',
    async (request, reply) => {
      if (
        !isRewardAutomationMapping(request.body) ||
        request.body.rewardId !== request.params.rewardId
      ) {
        return reply.code(400).send({
          error: 'invalid_reward_mapping',
          message: 'The reward mapping is invalid.',
        });
      }

      const mapping = request.body;

      const rewardExists = localRuntime
        .listRewards()
        .some((reward) => reward.id === mapping.rewardId);

      if (!rewardExists) {
        return reply.code(400).send({
          error: 'unknown_reward',
          message: 'The reward must exist in the synchronized reward catalog.',
        });
      }

      const automation = (await automationRepository.list()).find(
        (definition) => definition.id === mapping.automationId,
      );

      if (!automation || automation.trigger.eventType !== redemptionEventType) {
        return reply.code(400).send({
          error: 'invalid_redemption_automation',
          message: 'The mapping must target a redemption-triggered automation.',
        });
      }

      await rewardMappingRepository.upsert(mapping);
      return mapping;
    },
  );

  app.delete<{ Params: RewardRouteParameters }>(
    '/api/reward-mappings/:rewardId',
    async (request, reply) => {
      const removed = await rewardMappingRepository.remove(request.params.rewardId);

      return removed ? reply.code(204).send() : reply.code(404).send();
    },
  );

  app.get('/api/stream', async () => localRuntime.getStreamInfo());

  app.get<{ Params: UserRouteParameters }>('/api/users/by-login/:login', async (request, reply) => {
    if (!/^[a-zA-Z0-9_]{1,25}$/.test(request.params.login)) {
      return sendInvalidIntent(reply, 'invalid_twitch_login');
    }

    return { userId: await localRuntime.getUserIdByLogin(request.params.login) };
  });

  app.post<{ Body: unknown }>('/api/chat/messages', async (request, reply) => {
    if (!isRecord(request.body) || !isText(request.body['message'], 500)) {
      return sendInvalidIntent(reply, 'invalid_chat_message');
    }

    await localRuntime.sendChatMessage(request.body['message']);
    return reply.code(204).send();
  });

  app.patch<{ Body: unknown }>('/api/chat/settings', async (request, reply) => {
    if (!isChatSettingsUpdate(request.body)) {
      return sendInvalidIntent(reply, 'invalid_chat_settings');
    }

    await localRuntime.updateChatSettings(request.body);
    return reply.code(204).send();
  });

  app.post<{ Body: unknown }>('/api/chat/shoutouts', async (request, reply) => {
    if (!isRecord(request.body) || !isText(request.body['targetBroadcasterId'])) {
      return sendInvalidIntent(reply, 'invalid_shoutout');
    }

    await localRuntime.sendShoutout(request.body['targetBroadcasterId']);
    return reply.code(204).send();
  });

  app.post<{ Body: unknown }>('/api/moderation/timeouts', async (request, reply) => {
    if (!isTimeoutIntent(request.body)) {
      return sendInvalidIntent(reply, 'invalid_timeout');
    }

    await localRuntime.timeoutUser(
      request.body.userId,
      request.body.durationSeconds,
      request.body.reason,
    );
    return reply.code(204).send();
  });

  app.post<{ Body: unknown }>('/api/moderation/bans', async (request, reply) => {
    if (!isBanIntent(request.body)) {
      return sendInvalidIntent(reply, 'invalid_ban');
    }

    await localRuntime.banUser(request.body.userId, request.body.reason);
    return reply.code(204).send();
  });

  app.delete<{ Params: ResourceRouteParameters }>(
    '/api/moderation/bans/:resourceId',
    async (request, reply) => {
      if (!isText(request.params.resourceId)) {
        return sendInvalidIntent(reply, 'invalid_user_id');
      }

      await localRuntime.unbanUser(request.params.resourceId);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: ResourceRouteParameters }>(
    '/api/moderation/chat/:resourceId',
    async (request, reply) => {
      if (!isText(request.params.resourceId)) {
        return sendInvalidIntent(reply, 'invalid_message_id');
      }

      await localRuntime.deleteChatMessage(request.params.resourceId);
      return reply.code(204).send();
    },
  );

  app.post<{ Body: unknown }>('/api/rewards', async (request, reply) => {
    if (!isCustomRewardCreateRequest(request.body)) {
      return sendInvalidIntent(reply, 'invalid_reward');
    }

    return localRuntime.createCustomReward(request.body);
  });

  app.patch<{ Body: unknown; Params: RewardRouteParameters }>(
    '/api/rewards/:rewardId',
    async (request, reply) => {
      if (!isText(request.params.rewardId) || !isCustomRewardUpdateRequest(request.body)) {
        return sendInvalidIntent(reply, 'invalid_reward_update');
      }

      return localRuntime.updateCustomReward(request.params.rewardId, request.body);
    },
  );

  app.delete<{ Params: RewardRouteParameters }>(
    '/api/rewards/:rewardId',
    async (request, reply) => {
      if (!isText(request.params.rewardId)) {
        return sendInvalidIntent(reply, 'invalid_reward_id');
      }

      await localRuntime.deleteCustomReward(request.params.rewardId);
      return reply.code(204).send();
    },
  );

  app.patch<{ Body: unknown; Params: RewardRouteParameters }>(
    '/api/rewards/:rewardId/redemptions',
    async (request, reply) => {
      if (!isRedemptionUpdate(request.body)) {
        return sendInvalidIntent(reply, 'invalid_redemption_update');
      }

      await localRuntime.updateRedemptionStatus(
        request.params.rewardId,
        request.body.redemptionIds,
        request.body.status,
      );
      return reply.code(204).send();
    },
  );

  app.post<{ Body: unknown }>('/api/polls', async (request, reply) => {
    if (!isCreatePollIntent(request.body)) {
      return sendInvalidIntent(reply, 'invalid_poll');
    }

    const pollId = await localRuntime.createPoll(
      request.body.title,
      request.body.choices,
      request.body.durationSeconds,
    );
    return reply.code(201).send({ id: pollId });
  });

  app.patch<{ Body: unknown; Params: ResourceRouteParameters }>(
    '/api/polls/:resourceId',
    async (request, reply) => {
      if (!isPollEndIntent(request.body)) {
        return sendInvalidIntent(reply, 'invalid_poll_update');
      }

      await localRuntime.endPoll(request.params.resourceId, request.body.status);
      return reply.code(204).send();
    },
  );

  app.post<{ Body: unknown }>('/api/predictions', async (request, reply) => {
    if (!isCreatePredictionIntent(request.body)) {
      return sendInvalidIntent(reply, 'invalid_prediction');
    }

    const predictionId = await localRuntime.createPrediction(
      request.body.title,
      request.body.outcomes,
      request.body.durationSeconds,
    );
    return reply.code(201).send({ id: predictionId });
  });

  app.patch<{ Body: unknown; Params: ResourceRouteParameters }>(
    '/api/predictions/:resourceId',
    async (request, reply) => {
      if (!isPredictionUpdateIntent(request.body)) {
        return sendInvalidIntent(reply, 'invalid_prediction_update');
      }

      await localRuntime.resolvePrediction(
        request.params.resourceId,
        request.body.status,
        request.body.winningOutcomeId,
      );
      return reply.code(204).send();
    },
  );

  app.get('/api/runtime/events', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    });

    const unsubscribe = localRuntime.subscribe((message) => {
      writeRuntimeStreamMessage(reply, message);
    });
    const keepalive = setInterval(() => {
      reply.raw.write(': keepalive\n\n');
    }, 25000);

    request.raw.on('close', () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  });

  app.get('/api/auth/twitch/login', async (_request, reply) => {
    try {
      return reply.redirect(twitchAuth.createAuthorizationUrl());
    } catch (error) {
      return sendTwitchAuthError(reply, error);
    }
  });

  app.get<{ Querystring: TwitchAuthorizationCallbackQuery }>(
    '/api/auth/twitch/callback',
    async (request, reply) => {
      const { code, error, error_description: errorDescription, state } = request.query;

      if (error) {
        return reply.code(400).send({
          error,
          message: errorDescription ?? 'Twitch authorization was denied.',
        });
      }

      if (!code || !state) {
        return reply.code(400).send({
          error: 'invalid_callback',
          message: 'Twitch did not return an authorization code and state.',
        });
      }

      try {
        await twitchAuth.completeAuthorization(code, state);
        await localRuntime.connect();
        return reply.redirect(config.twitchOAuth?.frontendOrigin ?? '/');
      } catch (callbackError) {
        return sendTwitchAuthError(reply, callbackError);
      }
    },
  );

  return app;
}

function sendTwitchAuthError(reply: FastifyReply, error: unknown): FastifyReply {
  const message =
    error instanceof TwitchAuthError || error instanceof TwitchApiError
      ? error.message
      : 'Unable to complete Twitch authorization.';

  return reply.code(503).send({
    error: 'twitch_authorization_unavailable',
    message,
  });
}

function writeRuntimeStreamMessage(reply: FastifyReply, message: RuntimeStreamMessage): void {
  reply.raw.write(`event: ${message.kind}\ndata: ${JSON.stringify(message)}\n\n`);
}

function sendInvalidIntent(reply: FastifyReply, error: string): FastifyReply {
  return reply.code(400).send({
    error,
    message: 'The operation request is invalid.',
  });
}

function isBanIntent(value: unknown): value is { reason?: string; userId: string } {
  return isRecord(value) && isText(value['userId']) && isOptionalText(value['reason'], 500);
}

function isChatSettingsUpdate(value: unknown): value is ChatSettingsUpdate {
  if (!isRecord(value)) {
    return false;
  }

  const knownKeys = [
    'emoteMode',
    'followerMode',
    'followerModeDurationMinutes',
    'slowMode',
    'slowModeWaitTimeSeconds',
    'subscriberMode',
  ];

  return (
    knownKeys.some((key) => value[key] !== undefined) &&
    Object.keys(value).every((key) => knownKeys.includes(key)) &&
    isOptionalBoolean(value['emoteMode']) &&
    isOptionalBoolean(value['followerMode']) &&
    isOptionalIntegerInRange(value['followerModeDurationMinutes'], 0, 129600) &&
    isOptionalBoolean(value['slowMode']) &&
    isOptionalIntegerInRange(value['slowModeWaitTimeSeconds'], 1, 120) &&
    isOptionalBoolean(value['subscriberMode'])
  );
}

function isCreatePollIntent(
  value: unknown,
): value is { choices: string[]; durationSeconds: number; title: string } {
  return (
    isRecord(value) &&
    isText(value['title'], 60) &&
    isTextList(value['choices'], 2, 5, 25) &&
    isIntegerInRange(value['durationSeconds'], 15, 1800)
  );
}

function isCreatePredictionIntent(
  value: unknown,
): value is { durationSeconds: number; outcomes: string[]; title: string } {
  return (
    isRecord(value) &&
    isText(value['title'], 45) &&
    isTextList(value['outcomes'], 2, 10, 25) &&
    isIntegerInRange(value['durationSeconds'], 1, 1800)
  );
}

function isCustomRewardCreateRequest(value: unknown): value is CustomRewardCreateRequest {
  return (
    isRecord(value) &&
    isText(value['title'], 45) &&
    isIntegerInRange(value['cost'], 1, 1000000000) &&
    isCustomRewardOptions(value, true)
  );
}

function isCustomRewardUpdateRequest(value: unknown): value is CustomRewardUpdateRequest {
  return (
    isRecord(value) &&
    Object.keys(value).length > 0 &&
    (value['title'] === undefined || isText(value['title'], 45)) &&
    (value['cost'] === undefined || isIntegerInRange(value['cost'], 1, 1000000000)) &&
    isCustomRewardOptions(value, false)
  );
}

function isCustomRewardOptions(value: Record<string, unknown>, allowBaseFields: boolean): boolean {
  const fields: Record<string, (field: unknown) => boolean> = {
    backgroundColor: (field) => typeof field === 'string' && /^#[0-9a-fA-F]{6}$/.test(field),
    enabled: (field) => typeof field === 'boolean',
    globalCooldownSeconds: (field) => isIntegerInRange(field, 0, 604800),
    isGlobalCooldownEnabled: (field) => typeof field === 'boolean',
    isMaxPerStreamEnabled: (field) => typeof field === 'boolean',
    isMaxPerUserPerStreamEnabled: (field) => typeof field === 'boolean',
    maxPerStream: (field) => isIntegerInRange(field, 1, 1000000),
    maxPerUserPerStream: (field) => isIntegerInRange(field, 1, 1000000),
    prompt: (field) => typeof field === 'string' && field.length <= 200,
    userInputRequired: (field) => typeof field === 'boolean',
  };
  const allowedFields = new Set([
    ...Object.keys(fields),
    ...(allowBaseFields ? ['cost', 'title'] : []),
  ]);

  return (
    Object.keys(value).every((key) => allowedFields.has(key)) &&
    Object.entries(fields).every(
      ([key, validate]) => value[key] === undefined || validate(value[key]),
    )
  );
}

function isPollEndIntent(value: unknown): value is { status: 'ARCHIVED' | 'TERMINATED' } {
  return isRecord(value) && (value['status'] === 'ARCHIVED' || value['status'] === 'TERMINATED');
}

function isPredictionUpdateIntent(value: unknown): value is {
  status: 'CANCELED' | 'LOCKED' | 'RESOLVED';
  winningOutcomeId?: string;
} {
  if (
    !isRecord(value) ||
    (value['status'] !== 'CANCELED' &&
      value['status'] !== 'LOCKED' &&
      value['status'] !== 'RESOLVED') ||
    !isOptionalText(value['winningOutcomeId'])
  ) {
    return false;
  }

  return value['status'] !== 'RESOLVED' || isText(value['winningOutcomeId']);
}

function isRedemptionUpdate(
  value: unknown,
): value is { redemptionIds: string[]; status: 'CANCELED' | 'FULFILLED' } {
  return (
    isRecord(value) &&
    isTextList(value['redemptionIds'], 1, 50) &&
    (value['status'] === 'CANCELED' || value['status'] === 'FULFILLED')
  );
}

function isTimeoutIntent(
  value: unknown,
): value is { durationSeconds: number; reason?: string; userId: string } {
  return (
    isRecord(value) &&
    isText(value['userId']) &&
    isIntegerInRange(value['durationSeconds'], 1, 1209600) &&
    isOptionalText(value['reason'], 500)
  );
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
  );
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalIntegerInRange(value: unknown, minimum: number, maximum: number): boolean {
  return value === undefined || isIntegerInRange(value, minimum, maximum);
}

function isOptionalText(value: unknown, maximumLength?: number): boolean {
  return value === undefined || isText(value, maximumLength);
}

function isText(value: unknown, maximumLength?: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    (maximumLength === undefined || value.length <= maximumLength)
  );
}

function isTextList(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
  itemMaximumLength?: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimumLength &&
    value.length <= maximumLength &&
    value.every((item) => isText(item, itemMaximumLength))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
