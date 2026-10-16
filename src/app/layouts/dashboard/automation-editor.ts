import {
  AutomationAction,
  AutomationCondition,
  AutomationDefinition,
} from '../../../../shared/contracts/automation';
import { ApplicationEvent } from '../../../../shared/contracts/runtime-events';

export type EditableActionType =
  | 'ban-user'
  | 'delay'
  | 'emit-runtime-event'
  | 'send-chat'
  | 'send-discord-webhook'
  | 'send-shoutout'
  | 'show-alert'
  | 'timeout-user'
  | 'unban-user';

export const editableActionTypes: { label: string; type: EditableActionType }[] = [
  { label: 'Show alert', type: 'show-alert' },
  { label: 'Send chat message', type: 'send-chat' },
  { label: 'Emit automation event', type: 'emit-runtime-event' },
  { label: 'Delay', type: 'delay' },
  { label: 'Send Discord webhook', type: 'send-discord-webhook' },
  { label: 'Shout out channel', type: 'send-shoutout' },
  { label: 'Timeout user', type: 'timeout-user' },
  { label: 'Ban user', type: 'ban-user' },
  { label: 'Unban user', type: 'unban-user' },
];

export type ConditionValueType = 'boolean' | 'number' | 'string';

export interface ConditionDraft {
  path: string;
  value: string;
  valueType: ConditionValueType;
}

export interface ActionDraft {
  // Actions without a form keep their original definition untouched.
  original: AutomationAction | null;
  duplicatePolicy: 'allow' | 'replace' | 'skip';
  number: number;
  reason: string;
  text: string;
  title: string;
  type: EditableActionType | 'other';
}

export interface AutomationDraft {
  actions: ActionDraft[];
  conditionMatch: 'all' | 'any';
  conditions: ConditionDraft[];
  // Conditions the form cannot represent are kept as-is until the user clears them.
  opaqueCondition: AutomationCondition | null;
  cooldownSeconds: number;
  enabled: boolean;
  id: string | null;
  name: string;
  scheduleEnabled: boolean;
  scheduleIntervalSeconds: number;
  scheduleOnlyWhileLive: boolean;
  trigger: ApplicationEvent['type'];
}

export function emptyActionDraft(type: EditableActionType = 'show-alert'): ActionDraft {
  return {
    duplicatePolicy: 'replace',
    number: type === 'delay' ? 5000 : type === 'timeout-user' ? 60 : 0,
    original: null,
    reason: '',
    text: '',
    title: '',
    type,
  };
}

export function emptyAutomationDraft(): AutomationDraft {
  return {
    actions: [emptyActionDraft()],
    conditionMatch: 'all',
    conditions: [],
    cooldownSeconds: 0,
    enabled: true,
    id: null,
    name: '',
    opaqueCondition: null,
    scheduleEnabled: false,
    scheduleIntervalSeconds: 900,
    scheduleOnlyWhileLive: true,
    trigger: 'twitch.channel.follow',
  };
}

export function draftFromAutomation(definition: AutomationDefinition): AutomationDraft {
  const conditions = readConditions(definition.conditions);

  return {
    actions: definition.actions.map(draftFromAction),
    conditionMatch: conditions?.match ?? 'all',
    conditions: conditions?.rows ?? [],
    cooldownSeconds: (definition.cooldown?.durationMs ?? 0) / 1000,
    enabled: definition.enabled,
    id: definition.id,
    name: definition.name,
    opaqueCondition: conditions ? null : definition.conditions,
    scheduleEnabled: definition.schedule !== undefined,
    scheduleIntervalSeconds: (definition.schedule?.intervalMs ?? 900000) / 1000,
    scheduleOnlyWhileLive: definition.schedule?.onlyWhileLive ?? true,
    trigger: definition.trigger.eventType,
  };
}

export function validateDraft(draft: AutomationDraft): string | null {
  if (!draft.name.trim()) {
    return 'Give the automation a name.';
  }
  if (draft.cooldownSeconds < 0 || !Number.isFinite(draft.cooldownSeconds)) {
    return 'Cooldown must be zero or more seconds.';
  }
  if (
    draft.scheduleEnabled &&
    !(draft.scheduleIntervalSeconds >= 1 && draft.scheduleIntervalSeconds <= 2147483)
  ) {
    return 'Schedule interval must be between 1 and 2147483 seconds.';
  }

  for (const condition of draft.conditions) {
    if (!condition.path.trim()) {
      return 'Every condition needs a payload field path.';
    }
    if (condition.valueType === 'number' && !Number.isFinite(Number(condition.value))) {
      return `Condition "${condition.path}" needs a numeric value.`;
    }
    if (
      condition.valueType === 'boolean' &&
      condition.value !== 'true' &&
      condition.value !== 'false'
    ) {
      return `Condition "${condition.path}" needs true or false.`;
    }
  }

  for (const [index, action] of draft.actions.entries()) {
    const error = validateAction(action);

    if (error) {
      return `Action ${index + 1}: ${error}`;
    }
    if (action.type === 'delay' && index === draft.actions.length - 1) {
      return 'A delay cannot be the last action.';
    }
  }

  return null;
}

export function automationFromDraft(draft: AutomationDraft, id: string): AutomationDefinition {
  const definition: AutomationDefinition = {
    actions: draft.actions.map(actionFromDraft),
    conditions: conditionFromDraft(draft),
    enabled: draft.enabled,
    id,
    name: draft.name.trim(),
    trigger: { eventType: draft.trigger, type: 'application-event' },
    version: 1,
  };

  if (draft.cooldownSeconds > 0) {
    definition.cooldown = { durationMs: Math.round(draft.cooldownSeconds * 1000) };
  }
  if (draft.scheduleEnabled) {
    definition.schedule = {
      intervalMs: Math.round(draft.scheduleIntervalSeconds * 1000),
      onlyWhileLive: draft.scheduleOnlyWhileLive,
    };
  }

  return definition;
}

export function describeAction(action: AutomationAction): string {
  return action.type.replace(/-/g, ' ');
}

function conditionFromDraft(draft: AutomationDraft): AutomationCondition {
  if (draft.opaqueCondition) {
    return draft.opaqueCondition;
  }

  const rows = draft.conditions.map(
    (condition): AutomationCondition => ({
      path: condition.path.trim(),
      type: 'event-field-equals',
      value:
        condition.valueType === 'number'
          ? Number(condition.value)
          : condition.valueType === 'boolean'
            ? condition.value === 'true'
            : condition.value,
    }),
  );

  if (rows.length === 0) {
    return { type: 'always' };
  }
  if (rows.length === 1) {
    return rows[0];
  }

  return { children: rows, type: draft.conditionMatch };
}

function readConditions(
  condition: AutomationCondition,
): { match: 'all' | 'any'; rows: ConditionDraft[] } | null {
  if (condition.type === 'always') {
    return { match: 'all', rows: [] };
  }
  if (condition.type === 'event-field-equals') {
    return { match: 'all', rows: [conditionRow(condition)] };
  }
  if (
    (condition.type === 'all' || condition.type === 'any') &&
    condition.children.every((child) => child.type === 'event-field-equals')
  ) {
    return {
      match: condition.type,
      rows: condition.children.map((child) =>
        conditionRow(child as Extract<AutomationCondition, { type: 'event-field-equals' }>),
      ),
    };
  }

  return null;
}

function conditionRow(
  condition: Extract<AutomationCondition, { type: 'event-field-equals' }>,
): ConditionDraft {
  return {
    path: condition.path,
    value: String(condition.value),
    valueType: typeof condition.value as ConditionValueType,
  };
}

function draftFromAction(action: AutomationAction): ActionDraft {
  const draft = emptyActionDraft();

  switch (action.type) {
    case 'show-alert':
      return { ...draft, text: action.message, title: action.title ?? '', type: action.type };
    case 'send-chat':
      return { ...draft, text: action.message, type: action.type };
    case 'emit-runtime-event':
      return {
        ...draft,
        original: action,
        text: action.eventType.replace(/^automation\./, ''),
        type: action.type,
      };
    case 'delay':
      return {
        ...draft,
        duplicatePolicy: action.duplicatePolicy,
        number: action.durationMs,
        type: action.type,
      };
    case 'send-discord-webhook':
      return {
        ...draft,
        original: action,
        text: action.content,
        title: action.username ?? '',
        type: action.type,
      };
    case 'send-shoutout':
      return { ...draft, text: action.targetBroadcasterId, type: action.type };
    case 'timeout-user':
      return {
        ...draft,
        number: action.durationSeconds,
        reason: action.reason ?? '',
        text: action.targetUserId,
        type: action.type,
      };
    case 'ban-user':
      return {
        ...draft,
        reason: action.reason ?? '',
        text: action.targetUserId,
        type: action.type,
      };
    case 'unban-user':
      return { ...draft, text: action.targetUserId, type: action.type };
    default:
      return { ...draft, original: action, type: 'other' };
  }
}

function actionFromDraft(draft: ActionDraft): AutomationAction {
  const text = draft.text.trim();
  const reason = draft.reason.trim();

  switch (draft.type) {
    case 'show-alert':
      return {
        message: text,
        ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
        type: 'show-alert',
      };
    case 'send-chat':
      return { message: text, type: 'send-chat' };
    case 'emit-runtime-event':
      return {
        eventType: `automation.${text}`,
        payload: draft.original?.type === 'emit-runtime-event' ? draft.original.payload : {},
        type: 'emit-runtime-event',
      };
    case 'delay':
      return {
        duplicatePolicy: draft.duplicatePolicy,
        durationMs: Math.round(draft.number),
        type: 'delay',
      };
    case 'send-discord-webhook': {
      const previous = draft.original?.type === 'send-discord-webhook' ? draft.original : null;

      return {
        ...(previous?.allowedRoleId ? { allowedRoleId: previous.allowedRoleId } : {}),
        content: text,
        ...(draft.title.trim() ? { username: draft.title.trim() } : {}),
        type: 'send-discord-webhook',
      };
    }
    case 'send-shoutout':
      return { targetBroadcasterId: text, type: 'send-shoutout' };
    case 'timeout-user':
      return {
        durationSeconds: Math.round(draft.number),
        ...(reason ? { reason } : {}),
        targetUserId: text,
        type: 'timeout-user',
      };
    case 'ban-user':
      return { ...(reason ? { reason } : {}), targetUserId: text, type: 'ban-user' };
    case 'unban-user':
      return { targetUserId: text, type: 'unban-user' };
    case 'other':
      return draft.original as AutomationAction;
  }
}

function validateAction(action: ActionDraft): string | null {
  const text = action.text.trim();

  switch (action.type) {
    case 'show-alert':
    case 'send-chat':
      return text && text.length <= 500 ? null : 'Message is required (max 500 characters).';
    case 'emit-runtime-event':
      return text ? null : 'Event name is required.';
    case 'delay':
      return action.number >= 100 && action.number <= 604800000
        ? null
        : 'Delay must be between 100 and 604800000 ms.';
    case 'send-discord-webhook':
      return text && text.length <= 2000 ? null : 'Content is required (max 2000 characters).';
    case 'send-shoutout':
    case 'unban-user':
    case 'ban-user':
      return text ? null : 'A user or channel ID is required.';
    case 'timeout-user':
      if (!text) {
        return 'A user ID is required.';
      }
      return action.number >= 1 && action.number <= 1209600
        ? null
        : 'Timeout must be between 1 and 1209600 seconds.';
    case 'other':
      return null;
  }
}
