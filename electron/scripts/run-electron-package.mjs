#!/usr/bin/env node
/**
 * Build/package Qortal Hub with a platform-native frozen Reticulum binary.
 *
 * Why this wrapper exists:
 * - `rnsd` must be frozen on the same OS/arch as the packaged app.
 * - Cross-packaging a Windows/macOS app from Linux would otherwise embed the wrong
 *   Reticulum binary and break end-user startup.
 *
 * Use the matching host OS for each target, or use the GitHub Actions matrix workflow.
 */
import { spawnSync } from 'child_process';

const mode = process.argv[2];

const configs = {
  pack: {
    description: 'current host unpacked app',
    allowed: [{ platform: 'linux' }, { platform: 'darwin' }, { platform: 'win32' }],
    builderArgs: ['build', '--dir', '-c', './electron-builder.config.json'],
  },
  local: {
    description: 'current host packaged app',
    allowed: [{ platform: 'linux' }, { platform: 'darwin' }, { platform: 'win32' }],
    builderArgs: ['build', '-c', './electron-builder.config.json', '--publish=never'],
  },
  lin: {
    description: 'Linux x64 package',
    allowed: [{ platform: 'linux', arch: 'x64' }],
    builderArgs: ['build', '-c', './electron-builder.config.lin.json', '--publish=never', '-l'],
  },
  arm: {
    description: 'Linux arm64 package',
    allowed: [{ platform: 'linux', arch: 'arm64' }],
    builderArgs: [
      'build',
      '-c',
      './electron-builder.config.arm.json',
      '--publish=never',
      '--linux',
      '--arm64',
    ],
  },
  win: {
    description: 'Windows package',
    allowed: [{ platform: 'win32' }],
    builderArgs: ['build', '-c', './electron-builder.config.win.json', '--publish=never', '-w'],
  },
  mac: {
    description: 'macOS package',
    allowed: [{ platform: 'darwin' }],
    builderArgs: [
      'build',
      '-c',
      './electron-builder.config.mac.json',
      '--publish=never',
      '--mac',
      'dmg',
      'pkg',
      'zip',
    ],
  },
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!mode || mode === 'all') {
  fail(
    [
      'Cross-platform packaging is no longer safe through a single local command,',
      'because Reticulum must be bundled as a native binary per OS/arch.',
      '',
      'Use one of:',
      '  npm run electron:make-lin   # on Linux x64',
      '  npm run electron:make-arm   # on Linux arm64',
      '  npm run electron:make-win   # on Windows',
      '  npm run electron:make-mac   # on macOS',
      '',
      'Or use the GitHub Actions workflow to build the supported OS matrix.',
    ].join('\n')
  );
}

const cfg = configs[mode];
if (!cfg) {
  fail(`Unknown packaging mode: ${mode}`);
}

const supportedHere = cfg.allowed.some(
  (rule) =>
    process.platform === rule.platform &&
    (rule.arch == null || process.arch === rule.arch)
);

if (!supportedHere) {
  const here = `${process.platform}-${process.arch}`;
  const expected = cfg.allowed
    .map((rule) => `${rule.platform}${rule.arch ? `-${rule.arch}` : ''}`)
    .join(' or ');
  fail(
    `Cannot build ${cfg.description} from ${here}. Build it on ${expected}, so the bundled Reticulum binary matches the packaged app.`
  );
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
  if (res.error) {
    console.error(`Failed to run ${cmd}:`, res.error.message);
    process.exit(1);
  }
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

run(npmCmd, ['run', 'build']);
run(npmCmd, ['run', 'bundle:reticulum']);

const electronBuilderCmd = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
run(electronBuilderCmd, cfg.builderArgs);
