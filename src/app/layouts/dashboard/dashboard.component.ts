import { CommonModule } from '@angular/common';
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
  TwitchChannelInfo,
  TwitchChannelStats,
  TwitchGameCategory,
  TwitchStreamInfo,
} from '../../../../shared/contracts/twitch-operations';
import { LocalRuntimeClient } from '../../core/runtime/local-runtime-client.service';

type DashboardSection = 'overview' | 'automations' | 'commands' | 'rewards' | 'operations';
type DashboardNotice = { message: string; tone: 'error' | 'success' };
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
  readonly now = signal(Date.now());
  readonly uptime = computed(() => {
    const startedAt = this.streamInfo()?.startedAt;

    return startedAt ? formatDuration(this.now() - Date.parse(startedAt)) : null;
  });
  readonly channelInfo = signal<TwitchChannelInfo | null>(null);
  readonly gameCategories = signal<TwitchGameCategory[]>([]);
  readonly loading = signal(false);
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
    const [streamInfo, channelStats] = await Promise.all([
      this.runtime.getStreamInfo().catch(() => undefined),
      this.runtime.getChannelStats().catch(() => undefined),
    ]);

    if (streamInfo !== undefined) {
      this.streamInfo.set(streamInfo);
    }
    if (channelStats !== undefined) {
      this.channelStats.set(channelStats);
    }
  }

  async refresh(): Promise<void> {
    this.loading.set(true);

    let channelError: unknown = null;

    try {
      const [automations, commands, rewards, mappings, streamInfo, channelInfo] = await Promise.all(
        [
          this.runtime.getAutomations(),
          this.runtime.getCommands(),
          this.runtime.getCustomRewards(),
          this.runtime.getRewardMappings(),
          this.runtime.getStreamInfo().catch(() => null),
          this.runtime.getChannelInfo().catch((error: unknown) => {
            channelError = error;
            return null;
          }),
        ],
      );
      this.automations.set(automations);
      this.commands.set(commands);
      this.rewards.set(rewards);
      this.rewardMappings.set(mappings);
      this.streamInfo.set(streamInfo);
      this.channelInfo.set(channelInfo);
      void this.refreshLive();
      if (channelInfo) {
        this.channelTitle = channelInfo.title;
        this.categorySearchQuery = channelInfo.gameName;
        this.selectedGameId = channelInfo.gameId;
      }
      if (channelError) {
        this.showError(channelError);
      } else {
        this.notice.set(null);
      }
    } catch (error) {
      this.showError(error);
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
      this.showNotice(`Poll created (${poll.id}).`, 'success');
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
      this.showNotice(`Prediction created (${prediction.id}).`, 'success');
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

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'The operation failed.';
    this.showNotice(message, 'error');
  }

  private showNotice(message: string, tone: DashboardNotice['tone']): void {
    this.notice.set({ message, tone });
  }
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
