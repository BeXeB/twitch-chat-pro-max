import { AutomationDefinition } from '../../../../shared/contracts/automation';

export interface AutomationRepository {
  list(): Promise<AutomationDefinition[]>;
  listEnabled(): Promise<AutomationDefinition[]>;
  remove(id: string): Promise<boolean>;
  upsert(definition: AutomationDefinition): Promise<void>;
}

export class InMemoryAutomationRepository implements AutomationRepository {
  constructor(private readonly definitions: AutomationDefinition[] = []) {}

  async list(): Promise<AutomationDefinition[]> {
    return [...this.definitions];
  }

  async listEnabled(): Promise<AutomationDefinition[]> {
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

  async upsert(definition: AutomationDefinition): Promise<void> {
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
