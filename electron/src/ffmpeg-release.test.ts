import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canBuildHere,
  ffmpegTargetsFor,
  hostTarget,
  isFolderCurrent,
  recipeOf,
} from '../scripts/ffmpeg-release.mjs';

describe('the ffmpeg folders a package carries', () => {
  it('is the platform of the package', () => {
    expect(ffmpegTargetsFor('lin', 'linux', 'x64')).toEqual(['linux-x64']);
    expect(ffmpegTargetsFor('arm', 'linux', 'arm64')).toEqual(['linux-arm64']);
    expect(ffmpegTargetsFor('win', 'win32', 'x64')).toEqual(['win-x64']);
    expect(ffmpegTargetsFor('mac', 'darwin', 'arm64')).toEqual([
      'darwin-arm64',
    ]);
  });

  it('is both processors for a universal macOS app', () => {
    for (const mode of ['mac-universal', 'mac-universal-unsigned']) {
      expect(ffmpegTargetsFor(mode, 'darwin', 'arm64')).toEqual([
        'darwin-arm64',
        'darwin-x64',
      ]);
    }
  });

  it("is this machine's own for a package of this machine", () => {
    expect(ffmpegTargetsFor('local', 'linux', 'arm64')).toEqual([
      'linux-arm64',
    ]);
    expect(ffmpegTargetsFor('pack', 'win32', 'x64')).toEqual(['win-x64']);
    expect(hostTarget('darwin', 'x64')).toBe('darwin-x64');
  });
});

describe('what this machine can build', () => {
  it("is its own processor's, on Linux and macOS", () => {
    expect(canBuildHere('linux-x64', 'linux', 'x64')).toBe(true);
    expect(canBuildHere('linux-arm64', 'linux', 'arm64')).toBe(true);
    expect(canBuildHere('darwin-arm64', 'darwin', 'arm64')).toBe(true);
    // No cross compilers for these: they'd be the wrong processor's.
    expect(canBuildHere('linux-arm64', 'linux', 'x64')).toBe(false);
    expect(canBuildHere('darwin-x64', 'darwin', 'arm64')).toBe(false);
  });

  it("is Windows' on Linux only, never on Windows itself", () => {
    expect(canBuildHere('win-x64', 'linux', 'x64')).toBe(true);
    expect(canBuildHere('win-x64', 'win32', 'x64')).toBe(false);
    expect(canBuildHere('win-x64', 'darwin', 'arm64')).toBe(false);
  });
});

describe('a folder built earlier', () => {
  let root: string;
  const recipe = recipeOf('script text\n');

  const folder = (target: string, info: object, programs: string[]) => {
    const dir = path.join(root, target);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'BUILD_INFO.json'), JSON.stringify(info));
    for (const program of programs) {
      writeFileSync(path.join(dir, program), '');
    }
    return dir;
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-release-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('goes in when this script built it, with both programs', () => {
    const dir = folder('linux-x64', { target: 'linux-x64', recipe }, [
      'ffmpeg',
      'ffprobe',
    ]);
    expect(isFolderCurrent(dir, 'linux-x64', recipe)).toBe(true);
  });

  it('is built again when another version of the script built it', () => {
    const dir = folder(
      'linux-x64',
      { target: 'linux-x64', recipe: recipeOf('older script\n') },
      ['ffmpeg', 'ffprobe']
    );
    expect(isFolderCurrent(dir, 'linux-x64', recipe)).toBe(false);
    // One from before recipes were kept, too.
    const old = folder('linux-arm64', { target: 'linux-arm64' }, [
      'ffmpeg',
      'ffprobe',
    ]);
    expect(isFolderCurrent(old, 'linux-arm64', recipe)).toBe(false);
  });

  it('is built again when a program is missing, or the folder is for another platform', () => {
    const half = folder('linux-x64', { target: 'linux-x64', recipe }, [
      'ffmpeg',
    ]);
    expect(isFolderCurrent(half, 'linux-x64', recipe)).toBe(false);
    const other = folder('darwin-x64', { target: 'linux-x64', recipe }, [
      'ffmpeg',
      'ffprobe',
    ]);
    expect(isFolderCurrent(other, 'darwin-x64', recipe)).toBe(false);
    expect(isFolderCurrent(path.join(root, 'none'), 'linux-x64', recipe)).toBe(
      false
    );
  });

  it('needs the AV1 parts in a folder a package carries', () => {
    const withAv1 = folder(
      'linux-x64',
      { target: 'linux-x64', recipe, sources: { svtav1: {}, dav1d: {} } },
      ['ffmpeg', 'ffprobe']
    );
    expect(
      isFolderCurrent(withAv1, 'linux-x64', recipe, { release: true })
    ).toBe(true);
    // Built without cmake or meson: H.264 only, and no AV1 reading.
    const h264Only = folder(
      'linux-arm64',
      { target: 'linux-arm64', recipe, sources: { x264: {}, ffmpeg: {} } },
      ['ffmpeg', 'ffprobe']
    );
    expect(isFolderCurrent(h264Only, 'linux-arm64', recipe)).toBe(true);
    expect(
      isFolderCurrent(h264Only, 'linux-arm64', recipe, { release: true })
    ).toBe(false);
  });

  it("looks for Windows' .exe programs", () => {
    const plain = folder('win-x64', { target: 'win-x64', recipe }, [
      'ffmpeg',
      'ffprobe',
    ]);
    expect(isFolderCurrent(plain, 'win-x64', recipe)).toBe(false);
    writeFileSync(path.join(plain, 'ffmpeg.exe'), '');
    writeFileSync(path.join(plain, 'ffprobe.exe'), '');
    expect(isFolderCurrent(plain, 'win-x64', recipe)).toBe(true);
  });

  it('gives a Windows checkout of the script the same recipe', () => {
    expect(recipeOf('one\r\ntwo\r\n')).toBe(recipeOf('one\ntwo\n'));
    expect(recipeOf('one\ntwo\n')).not.toBe(recipeOf('one\ntwo!\n'));
  });
});
