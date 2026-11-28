#!/usr/bin/env node
/**
 * Builds the ffmpeg and ffprobe that Home's Video publisher runs, from pinned
 * and checksummed sources, with only the parts it needs:
 *
 * - readers for MKV/WebM, MP4/MOV/3GP, AVI, WMV/ASF, FLV, MPEG-TS/PS, Ogg,
 *   MXF, DV and the usual sound and subtitle files;
 * - the common video, sound and subtitle decoders (AV1 through dav1d);
 * - SVT-AV1 and x264 (video), AAC, WebVTT/SRT and JPEG writers, and the MP4
 *   muxer;
 * - scaling, deinterlacing, rotation and overlay filters.
 *
 * ffmpeg with x264 is GPL (v2 or later), which fits Hub's GPL-3.0; SVT-AV1
 * is BSD-3-Clause-Clear with the AOMedia patent licence. The licences and
 * BUILD_INFO.json (versions, hashes, configure line) go next to the
 * binaries, in resources/ffmpeg/<platform>-<arch>/. No path of the machine
 * that built it is written into them (configure's paths are relative).
 *
 *   node scripts/build-ffmpeg.mjs [--target linux-x64|linux-arm64|win-x64|
 *     darwin-x64|darwin-arm64] [--release] [--if-needed] [--work <dir>]
 *     [--jobs <n>]
 *
 * It builds this machine's own target (Linux, macOS), or win-x64 on Linux
 * (cross-built with the x86_64-w64-mingw32 toolchain); see canBuildHere.
 * Needs a C toolchain and make. nasm and pkgconf are built here when they
 * are missing; dav1d needs meson and ninja and SVT-AV1 needs cmake (taken
 * from `uv` when present). Without them AV1 decoding, or AV1 writing, is
 * left out with a warning, and the window then offers H.264 only;
 * --release (packaging) stops instead. --if-needed keeps a folder this same
 * script built (its BUILD_INFO.json's recipe).
 */
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  canBuildHere,
  hostTarget,
  isFolderCurrent,
  recipeOf,
} from './ffmpeg-release.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(scriptDir, '..');

export const SOURCES = {
  nasm: {
    version: '2.16.03',
    url: 'https://www.nasm.us/pub/nasm/releasebuilds/2.16.03/nasm-2.16.03.tar.xz',
    sha256: '1412a1c760bbd05db026b6c0d1657affd6631cd0a63cddb6f73cc6d4aa616148',
  },
  pkgconf: {
    version: '2.3.0',
    url: 'https://distfiles.ariadne.space/pkgconf/pkgconf-2.3.0.tar.xz',
    sha256: '3a9080ac51d03615e7c1910a0a2a8df08424892b5f13b0628a204d3fcce0ea8b',
  },
  x264: {
    version: 'b35605ace3ddf7c1a5d67a2eb553f034aef41d55',
    url: 'https://code.videolan.org/videolan/x264/-/archive/b35605ace3ddf7c1a5d67a2eb553f034aef41d55/x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.bz2',
    sha256: '6eeb82934e69fd51e043bd8c5b0d152839638d1ce7aa4eea65a3fedcf83ff224',
  },
  svtav1: {
    version: '2.3.0',
    url: 'https://gitlab.com/AOMediaCodec/SVT-AV1/-/archive/v2.3.0/SVT-AV1-v2.3.0.tar.bz2',
    sha256: 'f65358499f572a47d6b076dda73681a8162b02c0b619a551bc2d62ead8ee719a',
  },
  dav1d: {
    version: '1.5.1',
    url: 'https://code.videolan.org/videolan/dav1d/-/archive/1.5.1/dav1d-1.5.1.tar.bz2',
    sha256: '4eddffd108f098e307b93c9da57b6125224dc5877b1b3d157b31be6ae8f1f093',
  },
  ffmpeg: {
    version: '8.0.1',
    url: 'https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz',
    sha256: '05ee0b03119b45c0bdb4df654b96802e909e0a752f72e4fe3794f487229e5a41',
  },
};

const list = (text) => text.trim().split(/\s+/).join(',');

/**
 * configure's own names (the source's ff_<name>_<type>), which aren't always
 * the names ffmpeg prints: the MP4 text decoder is `movtext` here and
 * `mov_text` in -decoders. configure drops a name it doesn't know without a
 * word, so checkComponents fails the build on one.
 */
export const COMPONENTS = {
  demuxer: list(`
    matroska mov avi asf flv live_flv mpegts mpegps mpegvideo m4v h264 hevc
    ogg wav mp3 aac ac3 eac3 dts dtshd truehd flac mxf dv amr
    srt ass webvtt subviewer subviewer1 microdvd sami mpl2 realtext vplayer
    pjs stl jacosub vobsub sup`),
  decoder: list(`
    h264 hevc vp8 vp9 mpeg4 msmpeg4v1 msmpeg4v2 msmpeg4v3 mpeg1video
    mpeg2video mjpeg prores dnxhd vc1 wmv1 wmv2 wmv3 theora flv h263 h263p
    dvvideo rawvideo png svq3
    aac aac_latm ac3 eac3 dca truehd mlp mp1 mp2 mp3 mp1float mp2float
    mp3float opus vorbis flac alac wmav1 wmav2 wmapro amrnb amrwb
    pcm_s16le pcm_s16be pcm_s24le pcm_s24be pcm_s32le pcm_f32le pcm_f64le
    pcm_u8 pcm_alaw pcm_mulaw pcm_dvd pcm_bluray adpcm_ima_wav adpcm_ms
    adpcm_ima_qt
    ssa ass subrip srt webvtt movtext text microdvd subviewer subviewer1
    sami mpl2 realtext vplayer pjs stl jacosub dvdsub pgssub dvbsub xsub`),
  encoder: list(`libx264 aac webvtt subrip srt mjpeg`),
  muxer: list(`mp4 webvtt srt image2 null`),
  parser: list(`
    h264 hevc vp8 vp9 av1 mpeg4video mpegvideo mpegaudio aac aac_latm ac3
    dca flac opus vorbis mjpeg vc1 dvdsub dvbsub png h263 dvd_nav`),
  bsf: list(`
    aac_adtstoasc h264_mp4toannexb hevc_mp4toannexb extract_extradata
    vp9_superframe_split av1_frame_split av1_frame_merge null`),
  protocol: list(`file pipe`),
  // buffer, buffersink, abuffer and abuffersink are always built in.
  filter: list(`
    format aformat scale aresample pan
    overlay yadif bwdif idet fps setsar setdar pad crop null anull copy acopy
    trim atrim select thumbnail transpose hflip vflip split asplit volume
    setpts asetpts colorspace`),
};

/**
 * The listed components configure didn't enable (an unknown name, or one
 * whose dependencies are missing), from its config_components.h.
 */
export function missingComponents(configComponentsH, components = COMPONENTS) {
  const enabled = new Set(
    [...configComponentsH.matchAll(/^#define CONFIG_(\w+) 1$/gm)].map(
      (match) => match[1]
    )
  );
  const missing = [];
  for (const [type, names] of Object.entries(components)) {
    for (const name of names.split(',').filter(Boolean)) {
      const define = `${name}_${type}`.toUpperCase();
      if (!enabled.has(define)) missing.push(`${type} ${name}`);
    }
  }
  return missing;
}

function checkComponents(ffmpegDir, extra = {}) {
  const header = path.join(ffmpegDir, 'config_components.h');
  const missing = missingComponents(fs.readFileSync(header, 'utf8'), {
    ...COMPONENTS,
    ...extra,
  });
  if (missing.length) {
    throw new Error(
      `configure left out listed components (misspelt, or missing a dependency): ${missing.join(', ')}`
    );
  }
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--target') out.target = argv[++index];
    else if (key === '--work') out.work = argv[++index];
    else if (key === '--jobs') out.jobs = Number(argv[++index]);
    else if (key === '--release') out.release = true;
    else if (key === '--if-needed') out.ifNeeded = true;
  }
  return out;
}

/** The oldest macOS the programs run on: the first with Apple silicon. */
const MACOS_DEPLOYMENT_TARGET = '11.0';

const TARGETS = [
  'linux-x64',
  'linux-arm64',
  'win-x64',
  'darwin-x64',
  'darwin-arm64',
];

function run(command, args, options = {}) {
  console.info(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? result.error})`);
  }
}

function has(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

async function fetchSource(name, srcDir) {
  const source = SOURCES[name];
  const file = path.join(srcDir, path.basename(new URL(source.url).pathname));
  if (!fs.existsSync(file)) {
    console.info(`Downloading ${source.url}`);
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const hash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
  if (hash !== source.sha256) {
    fs.rmSync(file, { force: true });
    throw new Error(`${name}: checksum mismatch (${hash})`);
  }
  return file;
}

function unpack(archive, buildDir) {
  const before = new Set(fs.readdirSync(buildDir));
  run('tar', ['-xf', archive, '-C', buildDir]);
  const added = fs.readdirSync(buildDir).filter((entry) => !before.has(entry));
  if (added.length !== 1) {
    // Already unpacked by an earlier run: find it by its archive name.
    const stem = path.basename(archive).replace(/\.tar\.(xz|bz2|gz)$/, '');
    const existing = path.join(buildDir, stem);
    if (fs.existsSync(existing)) return existing;
    throw new Error(`Could not find the unpacked ${archive}`);
  }
  return path.join(buildDir, added[0]);
}

function freshUnpack(archive, buildDir) {
  const stem = path.basename(archive).replace(/\.tar\.(xz|bz2|gz)$/, '');
  fs.rmSync(path.join(buildDir, stem), { recursive: true, force: true });
  return unpack(archive, buildDir);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target || hostTarget();
  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown target ${target}: one of ${TARGETS.join(', ')}`);
  }
  if (!canBuildHere(target)) {
    throw new Error(
      `ffmpeg for ${target} can't be built on ${hostTarget()}: build it on ` +
        (target === 'win-x64'
          ? 'Linux (with the mingw-w64 cross compilers)'
          : `a ${target} machine`) +
        ` and copy electron/resources/ffmpeg/${target} here.`
    );
  }
  const [platform] = target.split('-');
  const outDir = path.join(electronRoot, 'resources', 'ffmpeg', target);
  const recipe = recipeOf(
    fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
  );
  if (args.ifNeeded && isFolderCurrent(outDir, target, recipe)) {
    console.info(`ffmpeg for ${target} is up to date in ${outDir}`);
    return;
  }
  const jobs = String(args.jobs || Math.max(1, os.cpus().length));
  // make can't handle spaces in paths, so the default lives in ~/.cache.
  const work = path.resolve(
    args.work || path.join(os.homedir(), '.cache', 'qortal-hub-ffmpeg-build')
  );
  if (/\s/.test(work)) {
    throw new Error(`The build folder can't contain spaces: ${work}`);
  }
  const srcDir = path.join(work, 'src');
  const buildDir = path.join(work, `build-${target}`);
  const prefix = path.join(work, `prefix-${target}`);
  const tools = path.join(work, 'tools');
  for (const dir of [srcDir, buildDir, prefix, tools]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const env = {
    ...process.env,
    PATH: `${path.join(tools, 'bin')}${path.delimiter}${process.env.PATH}`,
    PKG_CONFIG_PATH: path.join(prefix, 'lib', 'pkgconfig'),
    PKG_CONFIG_LIBDIR: path.join(prefix, 'lib', 'pkgconfig'),
    // Without it, clang builds for the building Mac's own macOS, and the
    // programs may not start on older ones. clang, CMake and meson read it.
    ...(platform === 'darwin'
      ? { MACOSX_DEPLOYMENT_TARGET: MACOS_DEPLOYMENT_TARGET }
      : {}),
  };
  const make = 'make';
  const cross =
    platform === 'win' && process.platform !== 'win32'
      ? 'x86_64-w64-mingw32-'
      : '';

  // Tools: nasm (x264's and dav1d's assembly), pkgconf (ffmpeg finds libs).
  if (spawnSync('nasm', ['-v'], { env, stdio: 'ignore' }).status !== 0) {
    const dir = freshUnpack(await fetchSource('nasm', srcDir), buildDir);
    run('./configure', [`--prefix=${tools}`], { cwd: dir, env });
    run(make, ['-j', jobs], { cwd: dir, env });
    run(make, ['install'], { cwd: dir, env });
  }
  let pkgConfig = 'pkg-config';
  if (
    spawnSync('pkg-config', ['--version'], { env, stdio: 'ignore' }).status !==
    0
  ) {
    if (
      spawnSync('pkgconf', ['--version'], { env, stdio: 'ignore' }).status !== 0
    ) {
      const dir = freshUnpack(await fetchSource('pkgconf', srcDir), buildDir);
      run('./configure', [`--prefix=${tools}`, '--disable-shared'], {
        cwd: dir,
        env,
      });
      run(make, ['-j', jobs], { cwd: dir, env });
      run(make, ['install'], { cwd: dir, env });
    }
    pkgConfig = 'pkgconf';
  }

  // x264
  {
    const dir = freshUnpack(await fetchSource('x264', srcDir), buildDir);
    const flags = [
      `--prefix=${prefix}`,
      '--enable-static',
      '--disable-cli',
      '--enable-pic',
      '--disable-opencl',
      '--disable-lavf',
      '--disable-swscale',
      '--disable-ffms',
      '--disable-gpac',
      '--disable-lsmash',
    ];
    if (cross)
      flags.push('--host=x86_64-w64-mingw32', `--cross-prefix=${cross}`);
    run('./configure', flags, { cwd: dir, env });
    run(make, ['-j', jobs], { cwd: dir, env });
    run(make, ['install'], { cwd: dir, env });
  }

  // dav1d (AV1), needs meson + ninja.
  let withDav1d = false;
  const venv = path.join(tools, 'pyenv');
  {
    let meson = has('meson') ? ['meson'] : null;
    let ninjaDir = has('ninja') ? null : undefined;
    if ((!meson || ninjaDir === undefined) && has('uv')) {
      if (!fs.existsSync(path.join(venv, 'bin', 'meson'))) {
        if (!fs.existsSync(venv)) run('uv', ['venv', venv], { env });
        run('uv', ['pip', 'install', '--python', venv, 'meson', 'ninja'], {
          env,
        });
      }
      meson = [path.join(venv, 'bin', 'meson')];
      ninjaDir = path.join(venv, 'bin');
    }
    if (meson && ninjaDir !== undefined) {
      const dav1dEnv = ninjaDir
        ? { ...env, PATH: `${ninjaDir}${path.delimiter}${env.PATH}` }
        : env;
      const dir = freshUnpack(await fetchSource('dav1d', srcDir), buildDir);
      const setup = [
        'setup',
        'build',
        `--prefix=${prefix}`,
        '--libdir=lib',
        '--default-library=static',
        '--buildtype=release',
        '-Denable_tools=false',
        '-Denable_tests=false',
      ];
      if (cross) {
        const crossFile = path.join(
          dir,
          'package',
          'crossfiles',
          'x86_64-w64-mingw32.meson'
        );
        setup.push(`--cross-file=${crossFile}`);
      }
      run(meson[0], setup, { cwd: dir, env: dav1dEnv });
      run('ninja', ['-C', 'build', 'install'], { cwd: dir, env: dav1dEnv });
      withDav1d = true;
    } else if (args.release) {
      throw new Error(
        'meson and ninja (or uv) are needed for AV1 decoding (dav1d).'
      );
    } else {
      console.warn('meson/ninja not found: building without AV1 decoding.');
    }
  }

  // SVT-AV1 (the AV1 writer), needs cmake.
  let withSvtAv1 = false;
  {
    let cmake = has('cmake') ? 'cmake' : null;
    if (!cmake && has('uv')) {
      if (!fs.existsSync(path.join(venv, 'bin', 'cmake'))) {
        if (!fs.existsSync(venv)) run('uv', ['venv', venv], { env });
        run('uv', ['pip', 'install', '--python', venv, 'cmake'], { env });
      }
      cmake = path.join(venv, 'bin', 'cmake');
    }
    if (cmake) {
      const dir = freshUnpack(await fetchSource('svtav1', srcDir), buildDir);
      const flags = [
        '-S',
        '.',
        '-B',
        'build-hub',
        '-DCMAKE_BUILD_TYPE=Release',
        `-DCMAKE_INSTALL_PREFIX=${prefix}`,
        '-DCMAKE_INSTALL_LIBDIR=lib',
        '-DBUILD_SHARED_LIBS=OFF',
        '-DBUILD_APPS=OFF',
        '-DBUILD_TESTING=OFF',
        // CMake 4 refuses the old minimum of SVT-AV1's bundled cpuinfo.
        '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
        // Its messages quote their source files: by name in SVT-AV1, not by
        // the build machine's path.
        `-DCMAKE_C_FLAGS=-ffile-prefix-map=${dir}=SVT-AV1`,
        `-DCMAKE_CXX_FLAGS=-ffile-prefix-map=${dir}=SVT-AV1`,
      ];
      if (cross) {
        flags.push(
          '-DCMAKE_SYSTEM_NAME=Windows',
          `-DCMAKE_C_COMPILER=${cross}gcc`,
          `-DCMAKE_CXX_COMPILER=${cross}g++`,
          `-DCMAKE_RC_COMPILER=${cross}windres`
        );
      }
      run(cmake, flags, { cwd: dir, env });
      run(cmake, ['--build', 'build-hub', '-j', jobs], { cwd: dir, env });
      run(cmake, ['--install', 'build-hub'], { cwd: dir, env });
      withSvtAv1 = true;
    } else if (args.release) {
      throw new Error('cmake (or uv) is needed for the AV1 writer (SVT-AV1).');
    } else {
      console.warn('cmake not found: building without the AV1 writer.');
    }
  }

  // ffmpeg
  const ffmpegArchive = await fetchSource('ffmpeg', srcDir);
  const dir = freshUnpack(ffmpegArchive, buildDir);
  const decoders = withDav1d
    ? `${COMPONENTS.decoder},libdav1d`
    : COMPONENTS.decoder;
  const encoders = withSvtAv1
    ? `${COMPONENTS.encoder},libsvtav1`
    : COMPONENTS.encoder;
  // ffmpeg keeps its configure line in the binary (-buildconf): relative
  // paths and a placeholder prefix (never installed to) leave the build
  // machine's folders out of it.
  const fromFfmpeg = (to) => path.relative(dir, to);
  const configure = [
    '--prefix=/opt/qortal-hub-ffmpeg',
    `--pkg-config=${pkgConfig}`,
    '--pkg-config-flags=--static',
    `--extra-cflags=-I${fromFfmpeg(path.join(prefix, 'include'))}`,
    `--extra-ldflags=-L${fromFfmpeg(path.join(prefix, 'lib'))}`,
    '--enable-gpl',
    '--enable-static',
    '--disable-shared',
    '--disable-autodetect',
    '--disable-debug',
    '--disable-doc',
    '--disable-ffplay',
    '--disable-network',
    '--disable-everything',
    '--enable-ffmpeg',
    '--enable-ffprobe',
    '--enable-avfilter',
    '--enable-swscale',
    '--enable-swresample',
    '--enable-libx264',
    `--enable-demuxer=${COMPONENTS.demuxer}`,
    `--enable-decoder=${decoders}`,
    `--enable-encoder=${encoders}`,
    `--enable-muxer=${COMPONENTS.muxer}`,
    `--enable-parser=${COMPONENTS.parser}`,
    `--enable-bsf=${COMPONENTS.bsf}`,
    `--enable-protocol=${COMPONENTS.protocol}`,
    `--enable-filter=${COMPONENTS.filter}`,
  ];
  if (withDav1d) configure.push('--enable-libdav1d');
  if (withSvtAv1) configure.push('--enable-libsvtav1');
  // MKV's compressed headers and PNG need zlib on every platform.
  configure.push('--enable-zlib');
  if (platform === 'linux') {
    configure.push('--extra-ldflags=-static-libgcc');
  }
  if (cross) {
    configure.push(
      '--target-os=mingw32',
      '--arch=x86_64',
      `--cross-prefix=${cross}`,
      '--extra-ldflags=-static'
    );
  }
  run('./configure', configure, { cwd: dir, env });
  checkComponents(dir, withSvtAv1 ? { encoder: 'libsvtav1' } : {});
  run(make, ['-j', jobs], { cwd: dir, env });

  // ffprobe on its own, with readers only: from the build above it would
  // carry every writer too (SVT-AV1 alone is ~8 MB).
  const probeBuildDir = path.join(buildDir, 'probe');
  fs.mkdirSync(probeBuildDir, { recursive: true });
  const probeDir = freshUnpack(ffmpegArchive, probeBuildDir);
  const fromProbe = (to) => path.relative(probeDir, to);
  const probeConfigure = [
    '--prefix=/opt/qortal-hub-ffmpeg',
    `--pkg-config=${pkgConfig}`,
    '--pkg-config-flags=--static',
    `--extra-cflags=-I${fromProbe(path.join(prefix, 'include'))}`,
    `--extra-ldflags=-L${fromProbe(path.join(prefix, 'lib'))}`,
    '--enable-static',
    '--disable-shared',
    '--disable-autodetect',
    '--disable-debug',
    '--disable-doc',
    '--disable-network',
    '--disable-everything',
    '--disable-ffmpeg',
    '--disable-ffplay',
    '--enable-ffprobe',
    '--disable-avfilter',
    '--disable-swscale',
    // The Opus decoder needs swresample.
    '--enable-swresample',
    `--enable-demuxer=${COMPONENTS.demuxer}`,
    `--enable-decoder=${decoders}`,
    `--enable-parser=${COMPONENTS.parser}`,
    `--enable-bsf=${COMPONENTS.bsf}`,
    `--enable-protocol=${COMPONENTS.protocol}`,
    '--enable-zlib',
  ];
  if (withDav1d) probeConfigure.push('--enable-libdav1d');
  if (platform === 'linux') {
    probeConfigure.push('--extra-ldflags=-static-libgcc');
  }
  if (cross) {
    probeConfigure.push(
      '--target-os=mingw32',
      '--arch=x86_64',
      `--cross-prefix=${cross}`,
      '--extra-ldflags=-static'
    );
  }
  run('./configure', probeConfigure, { cwd: probeDir, env });
  const { demuxer, decoder, parser, bsf, protocol } = COMPONENTS;
  const missingInProbe = missingComponents(
    fs.readFileSync(path.join(probeDir, 'config_components.h'), 'utf8'),
    { demuxer, decoder, parser, bsf, protocol }
  );
  if (missingInProbe.length) {
    throw new Error(`ffprobe left out: ${missingInProbe.join(', ')}`);
  }
  run(make, ['-j', jobs, `ffprobe${platform === 'win' ? '.exe' : ''}`], {
    cwd: probeDir,
    env,
  });

  const exe = platform === 'win' ? '.exe' : '';
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const [program, from] of [
    ['ffmpeg', dir],
    ['ffprobe', probeDir],
  ]) {
    const out = path.join(outDir, program + exe);
    fs.copyFileSync(path.join(from, program + exe), out);
    fs.chmodSync(out, 0o755);
    const strip = cross ? `${cross}strip` : 'strip';
    spawnSync(strip, [out], { stdio: 'inherit' });
  }
  // Each part's licence goes beside the programs (a missing one stops the
  // build), with a NOTICE.txt saying what they are and where the source is.
  const svtDir = path.join(buildDir, `SVT-AV1-v${SOURCES.svtav1.version}`);
  const dav1dDir = path.join(buildDir, `dav1d-${SOURCES.dav1d.version}`);
  const parts = [
    {
      name: 'ffmpeg',
      title: `ffmpeg ${SOURCES.ffmpeg.version}`,
      licence: 'GPL-2.0-or-later (built with --enable-gpl)',
      files: [
        [dir, 'COPYING.GPLv2', 'ffmpeg-COPYING.GPLv2'],
        [dir, 'LICENSE.md', 'ffmpeg-LICENSE.md'],
      ],
    },
    {
      name: 'x264',
      title: `x264 (${SOURCES.x264.version.slice(0, 12)})`,
      licence: 'GPL-2.0-or-later',
      files: [
        [
          path.join(buildDir, `x264-${SOURCES.x264.version}`),
          'COPYING',
          'x264-COPYING',
        ],
      ],
    },
    ...(withSvtAv1
      ? [
          {
            name: 'svtav1',
            title: `SVT-AV1 ${SOURCES.svtav1.version}`,
            licence:
              'BSD-3-Clause-Clear, with the Alliance for Open Media Patent License 1.0',
            files: [
              [svtDir, 'LICENSE.md', 'svtav1-LICENSE.md'],
              [svtDir, 'PATENTS.md', 'svtav1-PATENTS.md'],
            ],
          },
        ]
      : []),
    ...(withDav1d
      ? [
          {
            name: 'dav1d',
            title: `dav1d ${SOURCES.dav1d.version}`,
            licence: 'BSD-2-Clause',
            files: [[dav1dDir, 'COPYING', 'dav1d-COPYING']],
          },
        ]
      : []),
  ];
  for (const part of parts) {
    for (const [from, file, to] of part.files) {
      fs.copyFileSync(path.join(from, file), path.join(outDir, to));
    }
  }
  fs.writeFileSync(
    path.join(outDir, 'NOTICE.txt'),
    [
      `ffmpeg and ffprobe for Qortal Hub's Video publisher (${target})`,
      '',
      'Qortal Hub (GPL-3.0) runs these two programs to convert videos. They',
      "were built by electron/scripts/build-ffmpeg.mjs, in Qortal Hub's source",
      'code, from the source archives below, each checked against the SHA-256',
      'in BUILD_INFO.json, which also holds both configure lines.',
      ...parts.flatMap((part) => [
        '',
        part.title,
        `  Licence: ${part.licence}`,
        `  Licence files: ${part.files.map(([, , to]) => to).join(', ')}`,
        `  Source: ${SOURCES[part.name].url}`,
      ]),
      ...(cross
        ? [
            '',
            'Also linked in: zlib (zlib licence) and parts of the mingw-w64',
            "runtime, from the build machine's mingw-w64 packages.",
          ]
        : []),
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(outDir, 'BUILD_INFO.json'),
    `${JSON.stringify(
      {
        target,
        // build-ffmpeg.mjs's own hash: --if-needed keeps only what it built.
        recipe,
        sources: Object.fromEntries(
          Object.entries(SOURCES)
            .filter(([name]) => name !== 'dav1d' || withDav1d)
            .filter(([name]) => name !== 'svtav1' || withSvtAv1)
            .map(([name, source]) => [name, source])
        ),
        configure,
        ffprobeConfigure: probeConfigure,
      },
      null,
      2
    )}\n`
  );
  console.info(`ffmpeg and ffprobe for ${target} are in ${outDir}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
