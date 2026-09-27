import { ApplicationEvent } from '../../../../shared/contracts/runtime-events';

export function renderEventPayloadTemplate(template: string, event: ApplicationEvent): string {
  return template.replace(/{{\s*event\.payload\.([a-zA-Z0-9_.]+)\s*}}/g, (_match, path: string) => {
    const value = readPayloadValue(event.payload, path);

    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';
  });
}

function readPayloadValue(payload: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }

    return (value as Record<string, unknown>)[segment];
  }, payload);
}
