import { CommandDefinition } from '../../../../shared/contracts/command';

export interface CommandRepository {
  list(): Promise<CommandDefinition[]>;
  listEnabled(): Promise<CommandDefinition[]>;
  remove(id: string): Promise<boolean>;
  upsert(definition: CommandDefinition): Promise<void>;
}

export class InMemoryCommandRepository implements CommandRepository {
  constructor(private readonly definitions: CommandDefinition[] = []) {}

  async list(): Promise<CommandDefinition[]> {
    return [...this.definitions];
  }

  async listEnabled(): Promise<CommandDefinition[]> {
    return this.definitions.filter((definition) => definition.enabled);
  }

  async remove(id: string): Promise<boolean> {
    const index = this.definitions.findIndex((definition) => definition.id === id);

    if (index === -1) {
      return false;
    }

    this.definitions.splice(index, 1);
    return true;
  }

  async upsert(definition: CommandDefinition): Promise<void> {
    const index = this.definitions.findIndex(
      (existingDefinition) => existingDefinition.id === definition.id,
    );

    if (index === -1) {
      this.definitions.push(definition);
      return;
    }

    this.definitions[index] = definition;
  }
}
