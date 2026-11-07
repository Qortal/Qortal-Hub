import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const durationSeconds = process.env.QORTAL_RENDERER_PROFILE_SECONDS || '900';
const delaySeconds = process.env.QORTAL_RENDERER_PROFILE_DELAY_SECONDS || '60';
const child = spawn(
  electronPath,
  [
    '.',
    `--profile-renderer=${durationSeconds}`,
    `--profile-renderer-delay=${delaySeconds}`,
  ],
  {
    cwd: dirname(dirname(fileURLToPath(import.meta.url))),
    env: environment,
    stdio: 'inherit',
  }
);

const handlers = new Map();
for (const signal of ['SIGINT', 'SIGTERM']) {
  const handler = () => child.kill(signal);
  handlers.set(signal, handler);
  process.on(signal, handler);
}
const cleanup = () => {
  for (const [signal, handler] of handlers)
    process.removeListener(signal, handler);
};

child.once('error', (error) => {
  cleanup();
  console.error('Could not start the renderer profiling instance:', error);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  cleanup();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
