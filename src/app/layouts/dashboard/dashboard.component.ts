import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import {
  AutomationAction,
  AutomationDefinition,
} from '../../../../shared/contracts/automation';
import {
  CommandDefinition,
  CommandRole,
  commandRoles,
} from '../../../../shared/contracts/command';
import {
  ApplicationEvent,
} from '../../../../shared/contracts/runtime-events';
import {
  RedemptionCompletionPolicy,
  RewardAutomationMapping,
} from '../../../../shared/contracts/rewards';
import {
  CustomRewardCreateRequest,
  TwitchStreamInfo,
} from '../../../../shared/contracts/twitch-operations';
import { LocalRuntimeClient } from '../../core/runtime/local-runtime-client.service';

type DashboardSection = 'overview' | 'automations' | 'commands' | 'rewards' | 'operations';
type DashboardNotice = { message: string; tone: 'error' | 'success' };
type BuilderActionType = 'emit-runtime-event' | 'send-chat' | 'show-alert';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})
export class DashboardComponent implements OnInit {
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
  readonly loading = signal(false);
  readonly busy = signal(false);
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
    this.automations().filter(
      (automation) => automation.trigger.eventType === 'command.executed',
    ),
  );
  readonly rewardAutomations = computed(() =>
    this.automations().filter(
      (automation) =>
        automation.trigger.eventType ===
        'twitch.channel.channel_points_custom_reward_redemption.add',
    ),
  );

  automationName = '';
  automationTrigger: ApplicationEvent['type'] = 'twitch.channel.follow';
  automationActionType: BuilderActionType = 'show-alert';
  automationActionValue = 'A new follow';
  commandName = '';
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

  constructor(readonly runtime: LocalRuntimeClient) {}

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);

    try {
      const [automations, commands, rewards, mappings, streamInfo] =
        await Promise.all([
          this.runtime.getAutomations(),
          this.runtime.getCommands(),
          this.runtime.getCustomRewards(),
          this.runtime.getRewardMappings(),
          this.runtime.getStreamInfo().catch(() => null),
        ]);
      this.automations.set(automations);
      this.commands.set(commands);
      this.rewards.set(rewards);
      this.rewardMappings.set(mappings);
      this.streamInfo.set(streamInfo);
      this.notice.set(null);
    } catch (error) {
      this.showError(error);
    } finally {
      this.loading.set(false);
    }
  }

  async createAutomation(): Promise<void> {
    const name = this.automationName.trim();
    const actionValue = this.automationActionValue.trim();

    if (!name || !actionValue) {
      this.showNotice('Add an automation name and action value.', 'error');
      return;
    }

    let action: AutomationAction;

    switch (this.automationActionType) {
      case 'emit-runtime-event':
        action = {
          eventType: `automation.${slug(name)}`,
          payload: { name },
          type: 'emit-runtime-event',
        };
        break;
      case 'send-chat':
        action = { message: actionValue, type: 'send-chat' };
        break;
      case 'show-alert':
        action = { message: actionValue, title: name, type: 'show-alert' };
        break;
    }

    const definition: AutomationDefinition = {
      actions: [action],
      conditions: { type: 'always' },
      enabled: true,
      id: crypto.randomUUID(),
      name,
      trigger: {
        eventType: this.automationTrigger,
        type: 'application-event',
      },
      version: 1,
    };

    await this.runOperation(async () => {
      await this.runtime.saveAutomation(definition);
      this.automationName = '';
      await this.refresh();
      this.showNotice(`Created automation "${name}".`, 'success');
    });
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

  async createCommand(): Promise<void> {
    const name = slug(this.commandName);
    const target = this.commandAutomations().find(
      (automation) => automation.id === this.commandAutomationId,
    );

    if (!name || !target) {
      this.showNotice('Choose a command name and command-triggered automation.', 'error');
      return;
    }

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
      enabled: true,
      id: crypto.randomUUID(),
      name,
      requiredRole: this.commandRole,
      targetAutomationId: target.id,
      version: 1,
    };

    await this.runOperation(async () => {
      await this.runtime.saveCommand(definition);
      this.commandName = '';
      this.commandAliases = '';
      await this.refresh();
      this.showNotice(`Created !${name}.`, 'success');
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

  async syncRewards(): Promise<void> {
    await this.runOperation(async () => {
      this.rewards.set(await this.runtime.syncCustomRewards());
      this.showNotice('Reward catalog synchronized.', 'success');
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
        ...(this.slowMode
          ? { slowModeWaitTimeSeconds: Number(this.slowModeWaitTimeSeconds) }
          : {}),
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
    return this.automations().find((automation) => automation.id === automationId)?.name ?? 'Unknown automation';
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
