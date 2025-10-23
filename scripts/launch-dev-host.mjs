import { spawnSync, spawn } from 'node:child_process';
import process from 'node:process';

function resolveCliFromEnv() {
  const cli = process.env.VSCODE_DEV_HOST_CLI?.trim();
  if (!cli) {
    return undefined;
  }
  return cli;
}

function which(command) {
  if (process.platform === 'win32') {
    return spawnSync('where', [command], { stdio: 'ignore' }).status === 0;
  }
  return spawnSync('which', [command], { stdio: 'ignore' }).status === 0;
}

function resolveCliCandidate() {
  const fromEnv = resolveCliFromEnv();
  if (fromEnv) {
    return fromEnv;
  }

  const candidates = process.platform === 'win32'
    ? ['code.cmd', 'code.exe', 'code-insiders.cmd', 'code-insiders.exe', 'cursor.cmd', 'cursor.exe']
    : ['code', 'code-insiders', 'cursor'];

  for (const candidate of candidates) {
    if (which(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function main() {
  const cli = resolveCliCandidate();
  if (!cli) {
    console.error('Unable to find the VS Code command-line interface.');
    console.error('Install the "code" command (Command Palette → "Shell Command: Install \"code\" command in PATH") or set VSCODE_DEV_HOST_CLI.');
    process.exit(1);
    return;
  }

  const args = [
    `--extensionDevelopmentPath=${process.cwd()}`,
    '--reuse-window',
    ...process.argv.slice(2),
  ];

  const child = spawn(cli, args, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
    cwd: process.cwd(),
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error(`Failed to launch ${cli}:`, error.message);
    process.exit(1);
  });
}

main();
