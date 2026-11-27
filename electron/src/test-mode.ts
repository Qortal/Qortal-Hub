/**
 * Test mode for headless scenario runs.
 *
 * Parsing and the "what do we suppress" decisions live here, free of Electron
 * imports, so they can be unit tested without booting the app. `index.ts` applies
 * them at startup.
 *
 * Two rules matter and are both enforced here rather than at call sites:
 *
 *  - A profile directory is required. `app-settings.json` is read from a
 *    *shared* path (`getSharedSettingsFilePath`), not a per-instance one, and it
 *    is read before the window exists. Falling back to the default path would
 *    either read a developer's real settings or race a second instance, so
 *    test mode refuses to start instead of guessing.
 *  - Test mode never activates in a packaged build. The flag therefore cannot
 *    turn a shipped binary into a scenario runner.
 */

export const TEST_MODE_FLAG = '--test-mode';
export const TEST_PROFILE_DIR_ENV = 'QORTAL_TEST_PROFILE_DIR';

export type TestModeRefusal =
  | { enabled: false }
  | { enabled: true; profileDir: string }
  | { enabled: false; error: string };

export interface ParseTestModeOptions {
  argv?: string[];
  env?: Record<string, string | undefined>;
  isPackaged?: boolean;
}

/**
 * Decide whether this launch is a test-mode launch.
 *
 * Returns `{ enabled: false }` for a normal launch, `{ enabled: true, profileDir }`
 * when the gate is satisfied, and `{ enabled: false, error }` when test mode was
 * requested but cannot be honoured — the caller must treat `error` as fatal.
 */
export function parseTestMode(
  options: ParseTestModeOptions = {}
): TestModeRefusal {
  const argv = options.argv ?? process.argv;
  const env = options.env ?? process.env;

  // `--test-mode=/dir` is not an exact match for `--test-mode`, so check the
  // prefix too. Missing this made the flag silently inert.
  const wantsTestMode =
    argv.some(
      (arg) => arg === TEST_MODE_FLAG || arg.startsWith(`${TEST_MODE_FLAG}=`)
    ) ||
    env[TEST_PROFILE_DIR_ENV] != null ||
    env.QORTAL_TEST_MODE === '1';
  if (!wantsTestMode) return { enabled: false };

  // A packaged build must never become a scenario runner, whatever the caller
  // passes. This is the one check that is not negotiable.
  if (
    options.isPackaged === true ||
    env.QORTAL_TEST_MODE_FORCE_PACKAGED === '1'
  ) {
    return {
      enabled: false,
      error: 'test mode is not available in a packaged build',
    };
  }

  const fromEnv = (env[TEST_PROFILE_DIR_ENV] ?? '').trim();
  const fromArgv = readArgvValue(argv, TEST_MODE_FLAG);
  const profileDir = (fromEnv || fromArgv).trim();

  if (!profileDir) {
    return {
      enabled: false,
      error: `test mode requires a profile directory via ${TEST_PROFILE_DIR_ENV} or ${TEST_MODE_FLAG}=<dir>`,
    };
  }

  return { enabled: true, profileDir };
}

/** Supports both `--test-mode=/dir` and `--test-mode /dir`. */
function readArgvValue(argv: string[], flag: string): string {
  const withEquals = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (withEquals) return withEquals.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  if (index < 0) return '';
  const next = argv[index + 1];
  // Do not consume another flag as the value.
  return next && !next.startsWith('--') ? next : '';
}

/**
 * Subsystems that must not start in test mode, with the reason recorded so a
 * later reader does not "restore" one and reintroduce a hang.
 */
export const TEST_MODE_SUPPRESSIONS = {
  reticulumDaemon:
    'downloads or spawns the Python runtime; hangs on a clean machine',
  reticulumDevVenvEnsure: 'same download path as reticulumDaemon',
  updateChecks: 'phone home and schedule a 24h interval',
  tray: 'notifications tray icon owns OS state a headless run must not touch',
  audioSurfaceHttpsServer: 'binds a port and needs a certificate',
  powerMonitor: 'suspend/resume events never fire headlessly',
  osNotificationPresentation:
    'must register entries without showing them on the desktop',
} as const;

export type TestModeSuppression = keyof typeof TEST_MODE_SUPPRESSIONS;

/**
 * Everything is suppressed in test mode. The table above exists for the reason
 * strings; this function exists so call sites read as a question rather than a
 * scattered set of `if (testMode)` branches.
 */
export function isSuppressedInTestMode(
  testMode: boolean,
  subsystem: TestModeSuppression
): boolean {
  if (!testMode) return false;
  return subsystem in TEST_MODE_SUPPRESSIONS;
}

/** The `userData` and shared-settings directories a test run must use. */
export function testModePaths(profileDir: string): {
  userData: string;
  settingsDir: string;
} {
  return {
    userData: profileDir,
    // `getSharedSettingsFilePath` writes `<appData>/qortal-hub/<file>`, so a
    // profile dir must own its own appData root. Using the profile dir directly
    // keeps every artefact under the one directory the caller named.
    settingsDir: profileDir,
  };
}
