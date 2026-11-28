/**
 * The Video publisher's bundled ffmpeg in packaged builds: which folders of
 * resources/ffmpeg a package carries, which of them this machine can build,
 * and whether one built earlier can go in as it is. Used by
 * build-ffmpeg.mjs and run-electron-package.mjs; the Linux Docker build
 * calls build-ffmpeg.mjs itself.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Set to 1 to package without the converter (run-electron-package.mjs stops
 * while a folder it would carry is there): Home then shows no window.
 */
export const SKIP_FFMPEG_ENV = 'QORTAL_SKIP_FFMPEG';

export function hostTarget(platform = process.platform, arch = process.arch) {
  const name =
    platform === 'win32' ? 'win' : platform === 'darwin' ? 'darwin' : 'linux';
  return `${name}-${arch === 'arm64' ? 'arm64' : 'x64'}`;
}

/** The ffmpeg folders the package of a run-electron-package.mjs mode carries. */
export function ffmpegTargetsFor(
  mode,
  platform = process.platform,
  arch = process.arch
) {
  switch (mode) {
    case 'lin':
      return ['linux-x64'];
    case 'arm':
      return ['linux-arm64'];
    case 'win':
      return ['win-x64'];
    case 'mac-universal':
    case 'mac-universal-unsigned':
      return ['darwin-arm64', 'darwin-x64'];
    default:
      // pack, local and mac: the machine's own.
      return [hostTarget(platform, arch)];
  }
}

/**
 * Whether build-ffmpeg.mjs can build that folder on this machine: Linux and
 * macOS their own processor's, and Linux Windows' (with the mingw-w64
 * cross compilers). Windows builds none: its folder is built on Linux.
 */
export function canBuildHere(
  target,
  platform = process.platform,
  arch = process.arch
) {
  if (platform === 'win32') return false;
  if (target === hostTarget(platform, arch)) return true;
  return platform === 'linux' && target === 'win-x64';
}

/**
 * What a build is made from: the build script's own text, its line endings
 * made alike (a Windows checkout may have CRLF). A folder built by another
 * version of the script is built again.
 */
export function recipeOf(scriptText) {
  return crypto
    .createHash('sha256')
    .update(String(scriptText).replace(/\r\n/g, '\n'))
    .digest('hex');
}

export const programName = (target, program) =>
  target.startsWith('win-') ? `${program}.exe` : program;

/**
 * Whether resources/ffmpeg/<target> holds both programs, built by this
 * recipe (its BUILD_INFO.json says so). With `release`, also with the AV1
 * parts a package carries (SVT-AV1 and dav1d): one built without them (no
 * --release, cmake or meson missing) is built again.
 */
export function isFolderCurrent(dir, target, recipe, { release = false } = {}) {
  try {
    const info = JSON.parse(
      fs.readFileSync(path.join(dir, 'BUILD_INFO.json'), 'utf8')
    );
    if (info?.target !== target || info?.recipe !== recipe) return false;
    if (release && !(info.sources?.svtav1 && info.sources?.dav1d)) {
      return false;
    }
    return ['ffmpeg', 'ffprobe'].every((program) =>
      fs.statSync(path.join(dir, programName(target, program))).isFile()
    );
  } catch {
    return false;
  }
}
