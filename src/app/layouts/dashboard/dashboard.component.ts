import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AutomationDefinition } from '../../../../shared/contracts/automation';
import {
  AutomationDraft,
  EditableActionType,
  automationFromDraft,
  describeAction,
  draftFromAutomation,
  editableActionTypes,
  emptyActionDraft,
  emptyAutomationDraft,
  validateDraft,
} from './automation-editor';
import { CommandDefinition, CommandRole, commandRoles } from '../../../../shared/contracts/command';
import { ApplicationEvent } from '../../../../shared/contracts/runtime-events';
import {
  ChannelPointReward,
  RedemptionCompletionPolicy,
  RewardAutomationMapping,
} from '../../../../shared/contracts/rewards';
import {
  CustomRewardCreateRequest,
  CustomRewardUpdateRequest,
  TwitchPollInfo,
  TwitchPredictionInfo,
  TwitchChannelInfo,
  TwitchChannelStats,
  TwitchGameCategory,
  TwitchStreamInfo,
} from '../../../../shared/contracts/twitch-operations';
import { LocalRuntimeClient } from '../../core/runtime/local-runtime-client.service';

type DashboardSection = 'overview' | 'automations' | 'commands' | 'rewards' | 'operations';
type DataSection = DashboardSection;
type DashboardNotice = {
  message: string;
  reconnectRequired?: boolean;
  tone: 'error' | 'success';
};
interface RewardEditDraft {
  cost: number;
  globalCooldownSeconds: number;
  id: string;
  isEnabled: boolean;
  maxPerStream: number;
  maxPerUserPerStream: number;
  prompt: string;
  title: string;
  userInputRequired: boolean;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  readonly sections: DashboardSection[] = [
    'overview',
    'automations',
    'commands',
    'rewards',
    'operations',
  ];
  readonly activeSection = signal<DashboardSection>('overview');
  readonly automations = signal<AutomationDefinition[]>([]);
  readonly commands = signal<CommandDefinition[]>([]);
  readonly rewards = signal<Awaited<ReturnType<LocalRuntimeClient['getCustomRewards']>>>([]);
  readonly rewardMappings = signal<RewardAutomationMapping[]>([]);
  readonly streamInfo = signal<TwitchStreamInfo | null>(null);
  readonly channelStats = signal<TwitchChannelStats | null>(null);
  readonly polls = signal<TwitchPollInfo[]>([]);
  readonly predictions = signal<TwitchPredictionInfo[]>([]);
  readonly predictionWinningOutcomeIds = signal<Record<string, string>>({});
  readonly now = signal(Date.now());
  readonly uptime = computed(() => {
    const startedAt = this.streamInfo()?.startedAt;

    return startedAt ? formatDuration(this.now() - Date.parse(startedAt)) : null;
  });
  readonly channelInfo = signal<TwitchChannelInfo | null>(null);
  readonly gameCategories = signal<TwitchGameCategory[]>([]);
  readonly loading = signal(false);
  readonly sectionLoading = signal<Record<DataSection, boolean>>({
    overview: false,
    automations: false,
    commands: false,
    rewards: false,
    operations: false,
  });
  readonly busy = signal(false);
  readonly categorySearchBusy = signal(false);
  readonly notice = signal<DashboardNotice | null>(null);
  readonly viewState = this.runtime.viewState;
  readonly runtimeStatus = this.runtime.status;
  readonly commandRoles = commandRoles;
  readonly completionPolicies: RedemptionCompletionPolicy[] = [
    'auto-fulfill',
    'auto-cancel',
    'manual-review',
  ];
  readonly triggerTypes: ApplicationEvent['type'][] = [
    'twitch.channel.follow',
    'twitch.channel.raid',
    'twitch.channel.cheer',
    'twitch.channel.subscribe',
    'twitch.channel.channel_points_custom_reward_redemption.add',
    'command.executed',
  ];
  readonly commandAutomations = computed(() =>
    this.automations().filter((automation) => automation.trigger.eventType === 'command.executed'),
  );
  readonly rewardAutomations = computed(() =>
    this.automations().filter(
      (automation) =>
        automation.trigger.eventType ===
        'twitch.channel.channel_points_custom_reward_redemption.add',
    ),
  );
  readonly activePolls = computed(() => this.polls().filter((poll) => poll.status === 'ACTIVE'));
  readonly activePredictions = computed(() =>
    this.predictions().filter(
      (prediction) => prediction.status === 'ACTIVE' || prediction.status === 'LOCKED',
    ),
  );

  draft: AutomationDraft = emptyAutomationDraft();
  readonly editableActionTypes = editableActionTypes;
  readonly describeAction = describeAction;
  commandName = '';
  editingCommand: CommandDefinition | null = null;
  rewardEdit: RewardEditDraft | null = null;
  commandAliases = '';
  commandRole: CommandRole = 'everyone';
  commandArgumentPolicy: CommandDefinition['argumentPolicy'] = 'optional';
  commandAutomationId = '';
  commandCooldownSeconds = 0;
  commandCooldownScope: 'global' | 'user' = 'user';
  selectedRewardId = '';
  rewardAutomationId = '';
  rewardCompletionPolicy: RedemptionCompletionPolicy = 'manual-review';
  rewardTitle = '';
  rewardCost = 1000;
  chatMessage = '';
  shoutoutBroadcasterId = '';
  slowMode = false;
  slowModeWaitTimeSeconds = 30;
  followerMode = false;
  followerModeDurationMinutes = 10;
  pollTitle = '';
  pollChoices = '';
  pollDurationSeconds = 60;
  predictionTitle = '';
  predictionOutcomes = '';
  predictionDurationSeconds = 120;
  channelTitle = '';
  categorySearchQuery = '';
  selectedGameId = '';

  private livePollTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly runtime: LocalRuntimeClient) {}

  ngOnInit(): void {
    void this.refresh();
    this.clockTimer = setInterval(() => this.now.set(Date.now()), 1000);
    this.livePollTimer = setInterval(() => {
      if (!document.hidden && this.activeSection() === 'overview') {
        void this.refreshLive();
      }
    }, 30000);
  }

  ngOnDestroy(): void {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
    }
    if (this.livePollTimer) {
      clearInterval(this.livePollTimer);
    }
  }

  async refreshLive(): Promise<void> {
    const results = await Promise.allSettled([
      this.runtime.getStreamInfo(),
      this.runtime.getChannelStats(),
    ]);

    if (results[0].status === 'fulfilled') {
      this.streamInfo.set(results[0].value);
    } else if (isAuthorizationError(results[0].reason)) {
      this.showError(results[0].reason);
    }
    if (results[1].status === 'fulfilled') {
      this.channelStats.set(results[1].value);
    } else if (isAuthorizationError(results[1].reason)) {
      this.showError(results[1].reason);
    }
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    const errors: unknown[] = [];
    this.sectionLoading.set({
      overview: true,
      automations: true,
      commands: true,
      rewards: true,
      operations: true,
    });

    const loadSection = async (section: DataSection, load: () => Promise<void>): Promise<void> => {
      try {
        await load();
      } catch (error) {
        errors.push(error);
      } finally {
        this.sectionLoading.update((states) => ({ ...states, [section]: false }));
      }
    };

    try {
      await Promise.all([
        loadSection('overview', async () => {
          const [streamInfo, channelInfo, channelStats] = await Promise.all([
            this.runtime.getStreamInfo(),
            this.runtime.getChannelInfo(),
            this.runtime.getChannelStats(),
          ]);
          this.streamInfo.set(streamInfo);
          this.channelStats.set(channelStats);
          this.channelInfo.set(channelInfo);
          this.channelTitle = channelInfo.title;
          this.categorySearchQuery = channelInfo.gameName;
          this.selectedGameId = channelInfo.gameId;
        }),
        loadSection('automations', async () => {
          this.automations.set(await this.runtime.getAutomations());
        }),
        loadSection('commands', async () => {
          this.commands.set(await this.runtime.getCommands());
        }),
        loadSection('rewards', async () => {
          const [rewards, mappings] = await Promise.all([
            this.runtime.getCustomRewards(),
            this.runtime.getRewardMappings(),
          ]);
          this.rewards.set(rewards);
          this.rewardMappings.set(mappings);
        }),
        loadSection('operations', () => this.loadOperations()),
      ]);
      if (errors.length > 0) {
        this.showError(errors[0]);
      } else {
        this.notice.set(null);
      }
    } finally {
      this.loading.set(false);
    }
  }

  async saveAutomationDraft(): Promise<void> {
    const draft = this.draft;
    const error = validateDraft(draft);

    if (error) {
      this.showNotice(error, 'error');
      return;
    }

    const definition = automationFromDraft(draft, draft.id ?? crypto.randomUUID());
    const wasEditing = draft.id !== null;

    await this.runOperation(async () => {
      await this.runtime.saveAutomation(definition);
      this.draft = emptyAutomationDraft();
      await this.refresh();
      this.showNotice(
        `${wasEditing ? 'Updated' : 'Created'} automation "${definition.name}".`,
        'success',
      );
    });
  }

  triggerOptions(): ApplicationEvent['type'][] {
    return this.triggerTypes.includes(this.draft.trigger)
      ? this.triggerTypes
      : [this.draft.trigger, ...this.triggerTypes];
  }

  editAutomation(definition: AutomationDefinition): void {
    this.draft = draftFromAutomation(definition);
  }

  cancelAutomationEdit(): void {
    this.draft = emptyAutomationDraft();
  }

  addDraftAction(): void {
    this.draft.actions.push(emptyActionDraft());
  }

  removeDraftAction(index: number): void {
    this.draft.actions.splice(index, 1);
  }

  moveDraftAction(index: number, offset: -1 | 1): void {
    const target = index + offset;
    const actions = this.draft.actions;

    if (target >= 0 && target < actions.length) {
      [actions[index], actions[target]] = [actions[target], actions[index]];
    }
  }

  changeDraftActionType(index: number, type: EditableActionType): void {
    this.draft.actions[index] = emptyActionDraft(type);
  }

  addDraftCondition(): void {
    this.draft.opaqueCondition = null;
    this.draft.conditions.push({ path: '', value: '', valueType: 'string' });
  }

  removeDraftCondition(index: number): void {
    this.draft.conditions.splice(index, 1);
  }

  clearOpaqueCondition(): void {
    this.draft.opaqueCondition = null;
  }

  async toggleAutomation(definition: AutomationDefinition): Promise<void> {
    await this.runOperation(async () => {
      await this.runtime.saveAutomation({
        ...definition,
        enabled: !definition.enabled,
      });
      await this.refresh();
      this.showNotice(
        `${definition.name} ${definition.enabled ? 'disabled' : 'enabled'}.`,
        'success',
      );
    });
  }

  async deleteAutomation(definition: AutomationDefinition): Promise<void> {
    if (!window.confirm(`Delete automation "${definition.name}"? This cannot be undone.`)) {
      return;
    }

    await this.runOperation(async () => {
      await this.runtime.deleteAutomation(definition.id);
      await this.refresh();
      this.showNotice(`Deleted automation "${definition.name}".`, 'success');
    });
  }

  editCommand(command: CommandDefinition): void {
    this.editingCommand = command;
    this.commandName = command.name;
    this.commandAliases = command.aliases.join(', ');
    this.commandRole = command.requiredRole;
    this.commandArgumentPolicy = command.argumentPolicy;
    this.commandAutomationId = command.targetAutomationId;
    this.commandCooldownSeconds = (command.cooldown?.durationMs ?? 0) / 1000;
    this.commandCooldownScope = command.cooldown?.scope ?? 'user';
  }

  cancelCommandEdit(): void {
    this.editingCommand = null;
    this.commandName = '';
    this.commandAliases = '';
    this.commandCooldownSeconds = 0;
    this.commandAutomationId = '';
  }

  async createCommand(): Promise<void> {
    const name = slug(this.commandName);
    const target = this.commandAutomations().find(
      (automation) => automation.id === this.commandAutomationId,
    );

    if (!name || !target) {
      this.showNotice('Choose a command name and command-triggered automation.', 'error');
      return;
    }

    const editing = this.editingCommand;
    const cooldownSeconds = Number(this.commandCooldownSeconds);
    const definition: CommandDefinition = {
      aliases: this.commandAliases
        .split(',')
        .map((alias) => slug(alias))
        .filter(Boolean),
      argumentPolicy: this.commandArgumentPolicy,
      ...(cooldownSeconds > 0
        ? {
            cooldown: {
              durationMs: cooldownSeconds * 1000,
              scope: this.commandCooldownScope,
            },
          }
        : {}),
      enabled: editing?.enabled ?? true,
      id: editing?.id ?? crypto.randomUUID(),
      name,
      requiredRole: this.commandRole,
      targetAutomationId: target.id,
      version: 1,
    };

    await this.runOperation(async () => {
      await this.runtime.saveCommand(definition);
      this.cancelCommandEdit();
      await this.refresh();
      this.showNotice(`${editing ? 'Updated' : 'Created'} !${name}.`, 'success');
    });
  }

  async toggleCommand(definition: CommandDefinition): Promise<void> {
    await this.runOperation(async () => {
      await this.runtime.saveCommand({ ...definition, enabled: !definition.enabled });
      await this.refresh();
    });
  }

  async deleteCommand(definition: CommandDefinition): Promise<void> {
    if (!window.confirm(`Delete !${definition.name}? This cannot be undone.`)) {
      return;
    }

    await this.runOperation(async () => {
      await this.runtime.deleteCommand(definition.id);
      await this.refresh();
      this.showNotice(`Deleted !${definition.name}.`, 'success');
    });
  }

  editReward(reward: ChannelPointReward): void {
    this.rewardEdit = {
      cost: reward.cost,
      globalCooldownSeconds: reward.globalCooldownSeconds ?? 0,
      id: reward.id,
      isEnabled: reward.isEnabled,
      maxPerStream: reward.maxPerStream ?? 0,
      maxPerUserPerStream: reward.maxPerUserPerStream ?? 0,
      prompt: reward.prompt ?? '',
      title: reward.title,
      userInputRequired: reward.isUserInputRequired,
    };
  }

  cancelRewardEdit(): void {
    this.rewardEdit = null;
  }

  async saveRewardEdit(): Promise<void> {
    const edit = this.rewardEdit;

    if (!edit) {
      return;
    }

    const title = edit.title.trim();
    const integer = (value: unknown, min: number, max: number): boolean =>
      Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;

    if (
      !title ||
      title.length > 45 ||
      !integer(edit.cost, 1, 1000000000) ||
      !integer(edit.globalCooldownSeconds, 0, 604800) ||
      !integer(edit.maxPerStream, 0, 1000000) ||
      !integer(edit.maxPerUserPerStream, 0, 1000000) ||
      edit.prompt.length > 200
    ) {
      this.showNotice('Check the reward fields: title, cost and limits are out of range.', 'error');
      return;
    }

    const globalCooldown = Number(edit.globalCooldownSeconds);
    const perStream = Number(edit.maxPerStream);
    const perUser = Number(edit.maxPerUserPerStream);
    const updates: CustomRewardUpdateRequest = {
      cost: Number(edit.cost),
      enabled: edit.isEnabled,
      isGlobalCooldownEnabled: globalCooldown > 0,
      isMaxPerStreamEnabled: perStream > 0,
      isMaxPerUserPerStreamEnabled: perUser > 0,
      prompt: edit.prompt,
      title,
      userInputRequired: edit.userInputRequired,
      ...(globalCooldown > 0 ? { globalCooldownSeconds: globalCooldown } : {}),
      ...(perStream > 0 ? { maxPerStream: perStream } : {}),
      ...(perUser > 0 ? { maxPerUserPerStream: perUser } : {}),
    };

    await this.runOperation(async () => {
      const updated = await this.runtime.updateCustomReward(edit.id, updates);
      this.rewards.update((rewards) =>
        rewards.map((reward) => (reward.id === updated.id ? updated : reward)),
      );
      this.rewardEdit = null;
      this.showNotice(`Updated reward "${updated.title}".`, 'success');
    });
  }

  async deleteReward(reward: ChannelPointReward): Promise<void> {
    await this.runOperation(async () => {
      await this.runtime.deleteCustomReward(reward.id);
      this.rewards.update((rewards) => rewards.filter((item) => item.id !== reward.id));
      if (this.rewardEdit?.id === reward.id) {
        this.rewardEdit = null;
      }
      await this.refresh();
      this.showNotice(`Deleted reward "${reward.title}".`, 'success');
    });
  }

  async syncRewards(): Promise<void> {
    await this.runOperation(async () => {
      this.rewards.set(await this.runtime.syncCustomRewards());
      this.showNotice('Reward catalog synchronized.', 'success');
    });
  }

  async searchGameCategories(): Promise<void> {
    const query = this.categorySearchQuery.trim();

    if (!query) {
      this.showNotice('Enter a category name to search.', 'error');
      return;
    }

    this.categorySearchBusy.set(true);

    try {
      this.gameCategories.set(await this.runtime.searchGameCategories(query));
    } catch (error) {
      this.showError(error);
    } finally {
      this.categorySearchBusy.set(false);
    }
  }

  async saveChannelInfo(): Promise<void> {
    const title = this.channelTitle.trim();
    const currentChannel = this.channelInfo();
    const gameId =
      this.selectedGameId && this.selectedGameId !== currentChannel?.gameId
        ? this.selectedGameId
        : undefined;

    if (!title) {
      this.showNotice('A stream title is required.', 'error');
      return;
    }

    await this.runOperation(async () => {
      await this.runtime.updateChannelInfo({
        ...(gameId ? { gameId } : {}),
        title,
      });
      const updatedChannel = await this.runtime.getChannelInfo();
      this.channelInfo.set(updatedChannel);
      this.channelTitle = updatedChannel.title;
      this.categorySearchQuery = updatedChannel.gameName;
      this.selectedGameId = updatedChannel.gameId;
      this.showNotice('Stream information updated.', 'success');
    });
  }

  async createReward(): Promise<void> {
    const title = this.rewardTitle.trim();

    if (!title || !Number.isInteger(Number(this.rewardCost)) || Number(this.rewardCost) < 1) {
      this.showNotice('Provide a reward title and positive integer cost.', 'error');
      return;
    }

    const request: CustomRewardCreateRequest = {
      cost: Number(this.rewardCost),
      title,
    };

    await this.runOperation(async () => {
      const created = await this.runtime.createCustomReward(request);
      this.rewards.update((rewards) => [...rewards, created]);
      this.rewardTitle = '';
      this.showNotice(`Created reward "${title}".`, 'success');
    });
  }

  async saveRewardMapping(): Promise<void> {
    const reward = this.rewards().find((item) => item.id === this.selectedRewardId);

    if (!reward || !this.rewardAutomationId) {
      this.showNotice('Select a reward and redemption automation.', 'error');
      return;
    }

    const mapping: RewardAutomationMapping = {
      automationId: this.rewardAutomationId,
      completionPolicy: this.rewardCompletionPolicy,
      rewardId: reward.id,
      version: 1,
    };

    await this.runOperation(async () => {
      await this.runtime.saveRewardMapping(mapping);
      this.rewardMappings.update((mappings) => [
        ...mappings.filter((item) => item.rewardId !== mapping.rewardId),
        mapping,
      ]);
      this.showNotice(`Mapped "${reward.title}" to its automation.`, 'success');
    });
  }

  async deleteRewardMapping(mapping: RewardAutomationMapping): Promise<void> {
    const rewardTitle = this.rewardTitleFor(mapping.rewardId);
    const automationName = this.automationNameFor(mapping.automationId);

    if (
      !window.confirm(
        `Remove the mapping from "${rewardTitle}" to "${automationName}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    await this.runOperation(async () => {
      await this.runtime.deleteRewardMapping(mapping.rewardId);
      this.rewardMappings.update((items) =>
        items.filter((item) => item.rewardId !== mapping.rewardId),
      );
      this.showNotice('Reward mapping removed.', 'success');
    });
  }

  async sendChat(): Promise<void> {
    const message = this.chatMessage.trim();

    if (!message) {
      return;
    }

    await this.runOperation(async () => {
      await this.runtime.sendChatMessage(message);
      this.chatMessage = '';
      this.showNotice('Message sent.', 'success');
    });
  }

  async saveChatSettings(): Promise<void> {
    await this.runOperation(async () => {
      await this.runtime.updateChatSettings({
        followerMode: this.followerMode,
        ...(this.followerMode
          ? { followerModeDurationMinutes: Number(this.followerModeDurationMinutes) }
          : {}),
        slowMode: this.slowMode,
        ...(this.slowMode ? { slowModeWaitTimeSeconds: Number(this.slowModeWaitTimeSeconds) } : {}),
      });
      this.showNotice('Chat settings updated.', 'success');
    });
  }

  async sendShoutout(): Promise<void> {
    const targetId = this.shoutoutBroadcasterId.trim();

    if (!targetId) {
      return;
    }

    await this.runOperation(async () => {
      await this.runtime.sendShoutout(targetId);
      this.shoutoutBroadcasterId = '';
      this.showNotice('Shoutout sent.', 'success');
    });
  }

  async createPoll(): Promise<void> {
    const choices = splitList(this.pollChoices);

    await this.runOperation(async () => {
      const poll = await this.runtime.createPoll(
        this.pollTitle.trim(),
        choices,
        Number(this.pollDurationSeconds),
      );
      this.pollTitle = '';
      this.pollChoices = '';
      await this.refreshPolls(`Poll created (${poll.id}).`);
    });
  }

  async createPrediction(): Promise<void> {
    const outcomes = splitList(this.predictionOutcomes);

    await this.runOperation(async () => {
      const prediction = await this.runtime.createPrediction(
        this.predictionTitle.trim(),
        outcomes,
        Number(this.predictionDurationSeconds),
      );
      this.predictionTitle = '';
      this.predictionOutcomes = '';
      await this.refreshPredictions(`Prediction created (${prediction.id}).`);
    });
  }

  async refreshOperations(successMessage?: string): Promise<void> {
    await this.refreshOperationData(
      () => this.loadOperations(),
      successMessage,
      'The active polls and predictions could not be refreshed.',
    );
  }

  async endActivePoll(poll: TwitchPollInfo): Promise<void> {
    if (!window.confirm(`End the poll "${poll.title}" now?`)) {
      return;
    }

    await this.runOperation(async () => {
      await this.runtime.endPoll(poll.id, 'TERMINATED');
      await this.refreshPolls(`Ended poll "${poll.title}".`);
    });
  }

  async lockPrediction(prediction: TwitchPredictionInfo): Promise<void> {
    await this.runOperation(async () => {
      await this.runtime.resolvePrediction(prediction.id, 'LOCKED');
      await this.refreshPredictions(`Locked prediction "${prediction.title}".`);
    });
  }

  async cancelPrediction(prediction: TwitchPredictionInfo): Promise<void> {
    if (!window.confirm(`Cancel the prediction "${prediction.title}"?`)) {
      return;
    }

    await this.runOperation(async () => {
      await this.runtime.resolvePrediction(prediction.id, 'CANCELED');
      await this.refreshPredictions(`Canceled prediction "${prediction.title}".`);
    });
  }

  async resolveActivePrediction(prediction: TwitchPredictionInfo): Promise<void> {
    const winningOutcomeId = this.predictionWinningOutcomeIds()[prediction.id];

    if (!winningOutcomeId) {
      this.showNotice('Choose a winning outcome before resolving the prediction.', 'error');
      return;
    }

    await this.runOperation(async () => {
      await this.runtime.resolvePrediction(prediction.id, 'RESOLVED', winningOutcomeId);
      await this.refreshPredictions(`Resolved prediction "${prediction.title}".`);
    });
  }

  mappingFor(rewardId: string): RewardAutomationMapping | undefined {
    return this.rewardMappings().find((mapping) => mapping.rewardId === rewardId);
  }

  automationNameFor(automationId: string): string {
    return (
      this.automations().find((automation) => automation.id === automationId)?.name ??
      'Unknown automation'
    );
  }

  rewardTitleFor(rewardId: string): string {
    return this.rewards().find((reward) => reward.id === rewardId)?.title ?? rewardId;
  }

  setPredictionWinner(predictionId: string, outcomeId: string): void {
    this.predictionWinningOutcomeIds.update((selections) => ({
      ...selections,
      [predictionId]: outcomeId,
    }));
  }

  pollChoiceTitles(poll: TwitchPollInfo): string {
    return poll.choices.map((choice) => choice.title).join(' · ');
  }

  predictionOutcomeTitles(prediction: TwitchPredictionInfo): string {
    return prediction.outcomes.map((outcome) => outcome.title).join(' · ');
  }

  eventTypeLabel(eventType: string): string {
    return eventType.replace(/^(twitch|command|manual|automation)\./, '');
  }

  private async runOperation(operation: () => Promise<void>): Promise<void> {
    this.busy.set(true);

    try {
      await operation();
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }

  private async loadOperations(): Promise<void> {
    const [pollsResult, predictionsResult] = await Promise.allSettled([
      this.runtime.getPolls(),
      this.runtime.getPredictions(),
    ]);

    if (pollsResult.status === 'fulfilled') {
      this.polls.set(pollsResult.value);
    }
    if (predictionsResult.status === 'fulfilled') {
      this.predictions.set(predictionsResult.value);
    }

    const errors: unknown[] = [];
    if (pollsResult.status === 'rejected') {
      errors.push(pollsResult.reason);
    }
    if (predictionsResult.status === 'rejected') {
      errors.push(predictionsResult.reason);
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      const authorizationError = errors.find(isAuthorizationError);
      if (authorizationError) {
        throw authorizationError;
      }
      throw new Error(errors.map(errorMessage).join(' '));
    }
  }

  private async refreshPolls(successMessage: string): Promise<void> {
    await this.refreshOperationData(
      async () => {
        this.polls.set(await this.runtime.getPolls());
      },
      successMessage,
      'The active poll list could not be refreshed.',
    );
  }

  private async refreshPredictions(successMessage: string): Promise<void> {
    await this.refreshOperationData(
      async () => {
        this.predictions.set(await this.runtime.getPredictions());
      },
      successMessage,
      'The active predictions list could not be refreshed.',
    );
  }

  private async refreshOperationData(
    load: () => Promise<void>,
    successMessage: string | undefined,
    errorContext: string,
  ): Promise<void> {
    this.sectionLoading.update((states) => ({ ...states, operations: true }));

    try {
      await load();
      if (successMessage) {
        this.showNotice(successMessage, 'success');
      }
    } catch (error) {
      this.showError(error, successMessage ? `${successMessage} ${errorContext}` : undefined);
    } finally {
      this.sectionLoading.update((states) => ({ ...states, operations: false }));
    }
  }

  private showError(error: unknown, context?: string): void {
    const reconnectRequired = isAuthorizationError(error);
    const reason = reconnectRequired
      ? 'Twitch authorization is missing or expired. Reconnect Twitch to continue.'
      : errorMessage(error);
    const message = context ? `${context} ${reason}` : reason;
    this.notice.set({ message, reconnectRequired, tone: 'error' });
  }

  private showNotice(message: string, tone: DashboardNotice['tone']): void {
    this.notice.set({ message, tone });
  }
}

function isAuthorizationError(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403);
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error;
    if (
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string'
    ) {
      return body.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'The operation failed.';
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^!+/, '')
    .replace(/[^a-z0-9_-]+/g, '-');
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
