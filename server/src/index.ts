import 'dotenv/config';

import { createApp } from './app';

const app = createApp();
const host = process.env['TWITCH_RUNTIME_HOST'] ?? '127.0.0.1';
const port = Number.parseInt(process.env['TWITCH_RUNTIME_PORT'] ?? '4300', 10);
let isClosing = false;

async function start(): Promise<void> {
  try {
    await app.listen({ host, port });
  } catch (error) {
    app.log.error({ error }, 'Unable to start the Twitch runtime.');
    process.exitCode = 1;
    await app.close();
  }
}

async function stop(): Promise<void> {
  if (isClosing) {
    return;
  }

  isClosing = true;
  await app.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stop().catch((error: unknown) => {
      app.log.error({ error }, 'Unable to stop the Twitch runtime cleanly.');
      process.exitCode = 1;
    });
  });
}

void start();
