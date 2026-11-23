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
 *
 * The package also carries the Video publisher's ffmpeg
 * (resources/ffmpeg/<platform>-<arch>, see scripts/build-ffmpeg.mjs): it is
 * built here when it's missing or was built by another version of the
 * script, where this machine can build it. Where it can't (Windows, the
 * other processor of a macOS universal app), the folder has to be copied
 * in first. QORTAL_SKIP_FFMPEG=1 packages without it (and stops while a
 * folder it would carry is still there): Home then shows no Video publisher.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  SKIP_FFMPEG_ENV,
  canBuildHere,
  ffmpegTargetsFor,
  hostTarget,
  isFolderCurrent,
  recipeOf,
} from './ffmpeg-release.mjs';

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
  'mac-universal': {
    description: 'macOS universal package',
    allowed: [{ platform: 'darwin' }],
    universal: true,
    builderArgs: [
      'build',
      '-c',
      './electron-builder.config.mac.json',
      '--publish=never',
      '--mac',
      'dmg',
      'pkg',
      'zip',
      '--universal',
    ],
  },
  'mac-universal-unsigned': {
    description: 'unsigned macOS universal package',
    allowed: [{ platform: 'darwin' }],
    universal: true,
    builderEnv: {
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    },
    builderArgs: [
      'build',
      '-c',
      './electron-builder.config.mac-unsigned.json',
      '--publish=never',
      '--mac',
      'dmg',
      'pkg',
      'zip',
      '--universal',
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
      '  npm run electron:make-mac-universal # on macOS, universal app',
      '  npm run electron:make-mac-universal-unsigned # on macOS, unsigned universal app',
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
  // Windows: npm.cmd / electron-builder.cmd are cmd shims; spawn without a shell can
  // fail with EINVAL. Running through the default shell matches how npm invokes scripts.
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
    ...(process.platform === 'win32' ? { shell: true } : {}),
  });
  if (res.error) {
    console.error(`Failed to run ${cmd}:`, res.error.message);
    process.exit(1);
  }
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

function runWithEnv(cmd, args, envExtra) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...envExtra },
    windowsHide: true,
    ...(process.platform === 'win32' ? { shell: true } : {}),
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

/** The Video publisher's ffmpeg for each platform the package carries. */
function ensureFfmpeg() {
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const folderOf = (target) =>
    path.resolve(scriptsDir, '..', 'resources', 'ffmpeg', target);
  if (process.env[SKIP_FFMPEG_ENV] === '1') {
    // electron-builder copies resources/ffmpeg as it finds it: a folder left
    // there would go in all the same, unchecked.
    const left = ffmpegTargetsFor(mode).map(folderOf).filter(fs.existsSync);
    if (left.length) {
      fail(
        `${SKIP_FFMPEG_ENV}=1, but ${left.join(', ')} would still be packaged: remove it first.`
      );
    }
    console.warn(
      `${SKIP_FFMPEG_ENV}=1: packaging without ffmpeg. This package's Hub shows no Video publisher.`
    );
    return;
  }
  const recipe = recipeOf(
    fs.readFileSync(path.join(scriptsDir, 'build-ffmpeg.mjs'), 'utf8')
  );
  for (const target of ffmpegTargetsFor(mode)) {
    const dir = folderOf(target);
    if (isFolderCurrent(dir, target, recipe, { release: true })) continue;
    if (!canBuildHere(target)) {
      fail(
        [
          `No current ffmpeg for ${target} in ${dir}, and ${hostTarget()} can't build it.`,
          target === 'win-x64'
            ? 'Build it on Linux (needs the mingw-w64 cross compilers): npm run build:ffmpeg -- --target win-x64 --release'
            : `Build it on a ${target} machine: npm run build:ffmpeg -- --release`,
          `and copy electron/resources/ffmpeg/${target} here, or set ${SKIP_FFMPEG_ENV}=1 to package without the Video publisher.`,
        ].join('\n')
      );
    }
    run(npmCmd, ['run', 'build:ffmpeg', '--', '--target', target, '--release']);
  }
}

// First, so a package that can't get its ffmpeg stops before the long build.
ensureFfmpeg();
run(npmCmd, ['run', 'build']);
if (cfg.universal) {
  runWithEnv(npmCmd, ['run', 'build:private-transport'], {
    QORTAL_PRIVATE_TRANSPORT_GOOS: 'darwin',
    QORTAL_PRIVATE_TRANSPORT_GOARCH: 'arm64',
  });
  runWithEnv(npmCmd, ['run', 'build:private-transport'], {
    QORTAL_PRIVATE_TRANSPORT_GOOS: 'darwin',
    QORTAL_PRIVATE_TRANSPORT_GOARCH: 'amd64',
  });
  runWithEnv(npmCmd, ['run', 'bundle:reticulum'], {
    QORTAL_RETICULUM_OUTPUT_DIR: 'resources/reticulum/darwin-arm64',
  });
  runWithEnv(npmCmd, ['run', 'bundle:reticulum'], {
    QORTAL_RETICULUM_BUILD_ARCH: 'x64',
    QORTAL_RETICULUM_OUTPUT_DIR: 'resources/reticulum/darwin-x64',
  });
} else {
  run(npmCmd, ['run', 'build:private-transport']);
  run(npmCmd, ['run', 'bundle:reticulum']);
}

const electronBuilderCmd = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
runWithEnv(electronBuilderCmd, cfg.builderArgs, cfg.builderEnv ?? {});
