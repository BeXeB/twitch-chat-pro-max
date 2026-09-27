import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface RefreshTokenStore {
  clear(): Promise<void>;
  load(): Promise<string | null>;
  save(refreshToken: string): Promise<void>;
}

const protectCommand = `
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$inputData = [Console]::In.ReadToEnd().Trim()
$plainBytes = [Convert]::FromBase64String($inputData)
$protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
  $plainBytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($protectedBytes))
`;

const unprotectCommand = `
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$inputData = [Console]::In.ReadToEnd().Trim()
$protectedBytes = [Convert]::FromBase64String($inputData)
$plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
  $protectedBytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($plainBytes))
`;

export class WindowsDpapiRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly filePath: string) {}

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }

  async load(): Promise<string | null> {
    this.assertWindows();

    let protectedToken: string;

    try {
      protectedToken = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw error;
    }

    const encodedToken = await runPowerShell(unprotectCommand, protectedToken);
    const refreshToken = Buffer.from(encodedToken, 'base64').toString('utf8');

    return refreshToken || null;
  }

  async save(refreshToken: string): Promise<void> {
    this.assertWindows();

    const encodedToken = Buffer.from(refreshToken, 'utf8').toString('base64');
    const protectedToken = await runPowerShell(protectCommand, encodedToken);

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, protectedToken, { encoding: 'utf8', mode: 0o600 });
  }

  private assertWindows(): void {
    if (process.platform !== 'win32') {
      throw new Error('Windows DPAPI refresh-token storage requires Windows.');
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function runPowerShell(command: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      'pwsh.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true },
    );
    let standardError = '';
    let standardOutput = '';

    process.stdout.on('data', (chunk: Buffer) => {
      standardOutput += chunk.toString();
    });
    process.stderr.on('data', (chunk: Buffer) => {
      standardError += chunk.toString();
    });
    process.on('error', reject);
    process.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(
          new Error(
            `Windows DPAPI operation failed with code ${exitCode}: ${standardError.trim()}`,
          ),
        );
        return;
      }

      resolve(standardOutput.trim());
    });

    process.stdin.end(input);
  });
}
