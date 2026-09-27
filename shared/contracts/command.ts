export const commandRoles = [
  'everyone',
  'subscriber',
  'vip',
  'moderator',
  'broadcaster',
] as const;

export type CommandRole = (typeof commandRoles)[number];

export interface CommandDefinition {
  aliases: string[];
  argumentPolicy: 'none' | 'optional' | 'required';
  cooldown?: CommandCooldown;
  enabled: boolean;
  id: string;
  name: string;
  requiredRole: CommandRole;
  targetAutomationId: string;
  version: 1;
}

export interface CommandCooldown {
  durationMs: number;
  scope: 'global' | 'user';
}
