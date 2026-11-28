/**
 * What `npm run electron:make-lin` packages as the Video
 * publisher's ffmpeg. The real run-electron-package.mjs runs in a copy of
 * the scripts folder, with `npm` and `electron-builder` replaced by stubs
 * that only write down how they were called.
 */
import { spawnSync } from 'child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recipeOf } from '../scripts/ffmpeg-release.mjs';

const scripts = path.resolve(__dirname, '..', 'scripts');
const recipe = recipeOf(
  readFileSync(path.join(scripts, 'build-ffmpeg.mjs'), 'utf8')
);
const onLinuxX64 = process.platform === 'linux' && process.arch === 'x64';

describe.runIf(onLinuxX64)('electron:make-lin and the bundled ffmpeg', () => {
  let root: string;
  let log: string;
  let ffmpegDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-package-'));
    const copied = path.join(root, 'electron', 'scripts');
    mkdirSync(copied, { recursive: true });
    for (const name of [
      'run-electron-package.mjs',
      'ffmpeg-release.mjs',
      'build-ffmpeg.mjs',
    ]) {
      copyFileSync(path.join(scripts, name), path.join(copied, name));
    }
    ffmpegDir = path.join(root, 'electron', 'resources', 'ffmpeg', 'linux-x64');
    mkdirSync(ffmpegDir, { recursive: true });
    log = path.join(root, 'calls.log');
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    for (const name of ['npm', 'electron-builder']) {
      const stub = path.join(bin, name);
      writeFileSync(stub, `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit 0\n`);
      chmodSync(stub, 0o755);
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const folder = (info: object) => {
    writeFileSync(
      path.join(ffmpegDir, 'BUILD_INFO.json'),
      JSON.stringify({ target: 'linux-x64', ...info })
    );
    for (const program of ['ffmpeg', 'ffprobe']) {
      writeFileSync(path.join(ffmpegDir, program), '');
    }
  };

  const make = (env: Record<string, string> = {}) => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, 'electron', 'scripts', 'run-electron-package.mjs'),
        'lin',
      ],
      {
        cwd: path.join(root, 'electron'),
        encoding: 'utf8',
        env: {
          ...process.env,
          QORTAL_SKIP_FFMPEG: '',
          ...env,
          PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
        },
      }
    );
    const calls = existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n')
      : [];
    return { status: result.status, calls };
  };

  it('builds ffmpeg again (with --release) when the folder there was built without the AV1 parts', () => {
    // What `npm run build:ffmpeg` writes on a PC without cmake or meson:
    // this script's recipe, but neither SVT-AV1 nor dav1d among its sources.
    folder({
      recipe,
      sources: { nasm: {}, pkgconf: {}, x264: {}, ffmpeg: {} },
    });

    const { calls } = make();

    expect(calls).toContain(
      'npm run build:ffmpeg -- --target linux-x64 --release'
    );
  });

  it('does not package a stale ffmpeg folder when told to package without it', () => {
    // Built by an older version of the script: never checked against this
    // one, and QORTAL_SKIP_FFMPEG=1 says this package has no converter.
    folder({ recipe: recipeOf('an older build-ffmpeg.mjs\n'), sources: {} });

    const { status, calls } = make({ QORTAL_SKIP_FFMPEG: '1' });

    const packaged = calls.some((call) => call.startsWith('electron-builder'));
    // electron-builder.config.lin.json copies resources/ffmpeg/linux-x64
    // as it finds it: either the package isn't made, or the folder is gone.
    expect(packaged && status === 0 && existsSync(ffmpegDir)).toBe(false);
  });
});
