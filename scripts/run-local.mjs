import 'dotenv/config';

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const runtimeHost = process.env['TWITCH_RUNTIME_HOST'] ?? '127.0.0.1';
const runtimePort = readPort('TWITCH_RUNTIME_PORT', 4300);
const frontendHost = process.env['TWITCH_FRONTEND_HOST'] ?? '127.0.0.1';
const frontendPort = readPort('TWITCH_FRONTEND_PORT', 4200);
const publicRuntimeHost = runtimeHost === '0.0.0.0' ? '127.0.0.1' : runtimeHost;
const publicFrontendHost = frontendHost === '0.0.0.0' ? '127.0.0.1' : frontendHost;
const runtimeUrl = `http://${publicRuntimeHost}:${runtimePort}`;
const frontendUrl = `http://${publicFrontendHost}:${frontendPort}`;
const startupTimeoutMs = readInteger(
  'LOCAL_STARTUP_TIMEOUT_MS',
  60000,
  1000,
  300000,
);
const tsxCli = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const angularCli = join(
  projectRoot,
  'node_modules',
  '@angular',
  'cli',
  'bin',
  'ng.js',
);

let proxyDirectory;
let companion;
let frontend;
let interrupted = false;

const signalPromise = new Promise((resolve) => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      interrupted = true;
      resolve(signal);
    });
  }
});

try {
  proxyDirectory = await mkdtemp(join(tmpdir(), 'twitch-chat-proxy-'));
  const proxyPath = join(proxyDirectory, 'proxy.json');
  await writeFile(
    proxyPath,
    JSON.stringify({
      '/api': {
        target: `${runtimeUrl}`,
        secure: false,
        changeOrigin: true,
      },
    }),
    'utf8',
  );

  const companionEnvironment = {
    ...process.env,
    TWITCH_RUNTIME_HOST: runtimeHost,
    TWITCH_RUNTIME_PORT: String(runtimePort),
    TWITCH_FRONTEND_ORIGIN:
      process.env['TWITCH_FRONTEND_ORIGIN'] ?? frontendUrl,
    TWITCH_REDIRECT_URI:
      process.env['TWITCH_REDIRECT_URI'] ??
      `${runtimeUrl}/api/auth/twitch/callback`,
  };

  companion = spawnNode(tsxCli, ['server/src/index.ts'], companionEnvironment);
  const companionExit = watchExit(companion);
  await waitForHttp(
    `${runtimeUrl}/api/health`,
    companionExit,
    startupTimeoutMs,
    'Twitch companion',
  );

  if (interrupted) {
    process.exitCode = 130;
  } else {
    frontend = spawnNode(
      angularCli,
      [
        'serve',
        '--host',
        frontendHost,
        '--port',
        String(frontendPort),
        '--proxy-config',
        proxyPath,
      ],
      process.env,
    );
    const frontendExit = watchExit(frontend);
    await waitForHttp(frontendUrl, frontendExit, startupTimeoutMs, 'Angular app');

    console.log(`Local app ready: ${frontendUrl}`);
    console.log(`Twitch companion: ${runtimeUrl}`);
    console.log('Press Ctrl+C to stop both processes.');

    const outcome = await Promise.race([
      companionExit.then((result) => ({ name: 'Twitch companion', result })),
      frontendExit.then((result) => ({ name: 'Angular app', result })),
      signalPromise.then((signal) => ({ signal })),
    ]);

    if ('signal' in outcome) {
      interrupted = true;
      process.exitCode = outcome.signal === 'SIGINT' ? 130 : 143;
    } else {
      process.exitCode = outcome.result.code ?? 1;
      console.error(
        `${outcome.name} exited${outcome.result.signal ? ` on ${outcome.result.signal}` : ''}. Stopping the other process.`,
      );
    }
  }
} catch (error) {
  process.exitCode = 1;
  console.error(
    error instanceof Error ? error.message : 'Unable to start the local app.',
  );
} finally {
  await stopChild(frontend);
  await stopChild(companion);

  if (proxyDirectory) {
    await rm(proxyDirectory, { force: true, recursive: true });
  }
}

function readPort(name, defaultValue) {
  const rawValue = process.env[name];
  const value = rawValue === undefined ? defaultValue : Number(rawValue);

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }

  return value;
}

function readInteger(name, defaultValue, minimum, maximum) {
  const rawValue = process.env[name];
  const value = rawValue === undefined ? defaultValue : Number(rawValue);

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }

  return value;
}

function spawnNode(scriptPath, argumentsList, environment) {
  return spawn(process.execPath, [scriptPath, ...argumentsList], {
    cwd: projectRoot,
    detached: process.platform !== 'win32',
    env: environment,
    stdio: 'inherit',
  });
}

function watchExit(child) {
  return new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: 1, error, signal: null }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function waitForHttp(url, childExit, timeoutMs, serviceName) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (interrupted) {
      return;
    }

    if (companion?.exitCode !== null && companion?.exitCode !== undefined) {
      const result = await childExit;
      throw new Error(`${serviceName} exited before becoming ready (code ${result.code ?? result.signal}).`);
    }

    if (frontend && frontend.exitCode !== null) {
      const result = await childExit;
      throw new Error(`${serviceName} exited before becoming ready (code ${result.code ?? result.signal}).`);
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });

      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `${serviceName} did not become ready at ${url} within ${timeoutMs} ms.`,
  );
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = watchExit(child);

  try {
    if (process.platform === 'win32') {
      child.kill('SIGINT');
    } else if (child.pid) {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    return;
  }

  const gracefulExit = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);

  if (gracefulExit || !child.pid) {
    return;
  }

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      return;
    }
  }

  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}
