import { app } from 'electron';
export const homePath = app.getPath('home');
export const downloadPath = app.getPath('downloads');

export const winjar = String.raw`C:\Program Files\Qortal\qortal.jar`;
export const winurl =
  'https://github.com/Qortal/qortal/releases/latest/download/qortal.exe';
export const winexe = downloadPath + '\\qortal.exe';
export const startWinCore = 'C:\\Program Files\\Qortal\\qortal.exe';

export const zipdir = homePath;
export const zipfile = homePath + '/qortal.zip';
export const zipurl =
  'https://github.com/Qortal/qortal/releases/latest/download/qortal.zip';

export const qortaldir = homePath + '/qortal/';
export const qortalWindir = 'C:\\Program Files\\Qortal';
export const qortaljar = homePath + '/qortal/qortal.jar';
export const qortalsettings = homePath + '/qortal/settings.json';

export const javadir = homePath + '/jdk-17.0.2/';

export const linjavax64url =
  'https://download.qortal.online/openjdk-17.0.2_linux-x64_bin.zip';
export const linjavax64urlbackup =
  'https://cloud.qortal.org/s/aSxDWTskG8kBR5T/download/openjdk-17.0.2_linux-x64_bin.zip';
export const linjavax64file = homePath + '/openjdk-17.0.2_linux-x64_bin.zip';
export const linjavax64bindir = homePath + '/jdk-17.0.2/bin';
export const linjavax64binfile = homePath + '/jdk-17.0.2/bin/java';

export const linjavaarmurl =
  'https://download.qortal.online/openjdk-17.0.2_linux-arm_bin.zip';
export const linjavaarmurlbackup =
  'https://cloud.qortal.org/s/DAMFBEri469R3dj/download/openjdk-17.0.2_linux-arm_bin.zip';
export const linjavaarmfile = homePath + '/openjdk-17.0.2_linux-arm_bin.zip';
export const linjavaarmbindir = homePath + '/jdk-17.0.2/bin';
export const linjavaarmbinfile = homePath + '/jdk-17.0.2/bin/java';

export const linjavaarm64url =
  'https://download.qortal.online/openjdk-17.0.2_linux-arm64_bin.zip';
export const linjavaarm64urlbackup =
  'https://cloud.qortal.org/s/t7Kk9ZpEAroFmg2/download/openjdk-17.0.2_linux-arm64_bin.zip';
export const linjavaarm64file =
  homePath + '/openjdk-17.0.2_linux-arm64_bin.zip';
export const linjavaarm64bindir = homePath + '/jdk-17.0.2/bin';
export const linjavaarm64binfile = homePath + '/jdk-17.0.2/bin/java';

export const macjavax64url =
  'https://download.qortal.online/openjdk-17.0.2_macos-x64_bin.zip';
export const macjavax64urlbackup =
  'https://cloud.qortal.org/s/7t9d6xPfk8tsDxB/download/openjdk-17.0.2_macos-x64_bin.zip';
export const macjavax64file = homePath + '/openjdk-17.0.2_macos-x64_bin.zip';
export const macjavax64bindir = homePath + '/jdk-17.0.2/Contents/Home/bin';
export const macjavax64binfile =
  homePath + '/jdk-17.0.2/Contents/Home/bin/java';

export const macjavaaarch64url =
  'https://download.qortal.online/openjdk-17.0.2_macos-aarch64_bin.zip';
export const macjavaaarch64urlbackup =
  'https://cloud.qortal.org/s/GRE3CGqMospwtZP/download/openjdk-17.0.2_macos-aarch64_bin.zip';
export const macjavaaarch64file =
  homePath + '/openjdk-17.0.2_macos-aarch64_bin.zip';
export const macjavaaarch64bindir = homePath + '/jdk-17.0.2/Contents/Home/bin';
export const macjavaaarch64binfile =
  homePath + '/jdk-17.0.2/Contents/Home/bin/java';
