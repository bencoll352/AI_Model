import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT ?? '5173';

const server = spawn(
  process.execPath,
  [
    resolve(packageDirectory, 'node_modules/vite/bin/vite.js'),
    '--config',
    'vite.config.ts',
    '--host',
    '127.0.0.1',
  ],
  {
    cwd: packageDirectory,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: port,
      BASE_PATH: '/',
      VITE_FINCH_LOCAL_RUNTIME: 'true',
    },
  },
);

server.on('error', (error) => {
  console.error(
    `Could not start Finch Local Chat. Make sure pnpm is installed and dependencies have been installed from the workspace root.\n${error.message}`,
  );
  process.exitCode = 1;
});

server.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
