import { app } from 'electron';
export const HOME_PATH = app.getPath('home');
export const DOWNLOAD_PATH = app.getPath('downloads');

const GITHUB_QORTAL_RELEASES_URL: string =
  'https://github.com/qortal/qortal/releases';

const DOWNLOAD_QORTAL_URL: string = 'https://download.qortal.online';
const CLOUD_QORTAL_URL: string = 'https://cloud.qortal.org/s';

export const winjar = String.raw`C:\Program Files\Qortal\qortal.jar`;
export const winurl =
  GITHUB_QORTAL_RELEASES_URL + '/latest/download/qortal.exe';
export const winexe = DOWNLOAD_PATH + '\\qortal.exe';
export const startWinCore = 'C:\\Program Files\\Qortal\\qortal.exe';

export const zipdir = HOME_PATH;
export const zipfile = HOME_PATH + '/qortal.zip';
export const zipurl =
  GITHUB_QORTAL_RELEASES_URL + '/latest/download/qortal.zip';

export const qortaldir = HOME_PATH + '/qortal/';
export const qortalWindir = 'C:\\Program Files\\Qortal';
export const qortaljar = HOME_PATH + '/qortal/qortal.jar';
export const qortalStopScriptLocation = HOME_PATH + '/qortal/stop.sh';
export const qortalsettings = HOME_PATH + '/qortal/settings.json';

export const javadir = HOME_PATH + '/jdk-17.0.2/';

export const linjavax64url =
  DOWNLOAD_QORTAL_URL + '/openjdk-17.0.2_linux-x64_bin.zip';
export const linjavax64urlbackup =
  CLOUD_QORTAL_URL +
  '/aSxDWTskG8kBR5T/download/openjdk-17.0.2_linux-x64_bin.zip';
export const linjavax64file = HOME_PATH + '/openjdk-17.0.2_linux-x64_bin.zip';
export const linjavax64bindir = HOME_PATH + '/jdk-17.0.2/bin';
export const linjavax64binfile = HOME_PATH + '/jdk-17.0.2/bin/java';

export const linjavaarmurl =
  DOWNLOAD_QORTAL_URL + '/openjdk-17.0.2_linux-arm_bin.zip';
export const linjavaarmurlbackup =
  CLOUD_QORTAL_URL +
  '/DAMFBEri469R3dj/download/openjdk-17.0.2_linux-arm_bin.zip';
export const linjavaarmfile = HOME_PATH + '/openjdk-17.0.2_linux-arm_bin.zip';
export const linjavaarmbindir = HOME_PATH + '/jdk-17.0.2/bin';
export const linjavaarmbinfile = HOME_PATH + '/jdk-17.0.2/bin/java';

export const linjavaarm64url =
  DOWNLOAD_QORTAL_URL + '/openjdk-17.0.2_linux-arm64_bin.zip';
export const linjavaarm64urlbackup =
  CLOUD_QORTAL_URL +
  '/t7Kk9ZpEAroFmg2/download/openjdk-17.0.2_linux-arm64_bin.zip';
export const linjavaarm64file =
  HOME_PATH + '/openjdk-17.0.2_linux-arm64_bin.zip';
export const linjavaarm64bindir = HOME_PATH + '/jdk-17.0.2/bin';
export const linjavaarm64binfile = HOME_PATH + '/jdk-17.0.2/bin/java';

export const macjavax64url =
  DOWNLOAD_QORTAL_URL + '/openjdk-17.0.2_macos-x64_bin.zip';
export const macjavax64urlbackup =
  CLOUD_QORTAL_URL +
  '/7t9d6xPfk8tsDxB/download/openjdk-17.0.2_macos-x64_bin.zip';
export const macjavax64file = HOME_PATH + '/openjdk-17.0.2_macos-x64_bin.zip';
export const macjavax64bindir = HOME_PATH + '/jdk-17.0.2/Contents/Home/bin';
export const macjavax64binfile =
  HOME_PATH + '/jdk-17.0.2/Contents/Home/bin/java';

export const macjavaaarch64url =
  DOWNLOAD_QORTAL_URL + '/openjdk-17.0.2_macos-aarch64_bin.zip';
export const macjavaaarch64urlbackup =
  CLOUD_QORTAL_URL +
  '/GRE3CGqMospwtZP/download/openjdk-17.0.2_macos-aarch64_bin.zip';
export const macjavaaarch64file =
  HOME_PATH + '/openjdk-17.0.2_macos-aarch64_bin.zip';
export const macjavaaarch64bindir = HOME_PATH + '/jdk-17.0.2/Contents/Home/bin';
export const macjavaaarch64binfile =
  HOME_PATH + '/jdk-17.0.2/Contents/Home/bin/java';
