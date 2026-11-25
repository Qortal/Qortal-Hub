import { describe, expect, it } from 'vitest';
import {
  TEST_MODE_FLAG,
  TEST_PROFILE_DIR_ENV,
  isSuppressedInTestMode,
  parseTestMode,
  testModePaths,
} from './test-mode';

describe('parseTestMode', () => {
  it('stays off for a normal launch', () => {
    expect(parseTestMode({ argv: ['electron', '.'], env: {} })).toEqual({
      enabled: false,
    });
  });

  it('stays off when unrelated flags are present', () => {
    expect(
      parseTestMode({ argv: ['electron', '.', '--inspect=5858'], env: {} })
    ).toEqual({ enabled: false });
  });

  it('enables via the profile env var', () => {
    expect(
      parseTestMode({
        argv: ['electron', '.'],
        env: { [TEST_PROFILE_DIR_ENV]: '/tmp/profile' },
      })
    ).toEqual({ enabled: true, profileDir: '/tmp/profile' });
  });

  it('enables via --test-mode=<dir>', () => {
    expect(
      parseTestMode({
        argv: ['electron', '.', `${TEST_MODE_FLAG}=/tmp/p`],
        env: {},
      })
    ).toEqual({ enabled: true, profileDir: '/tmp/p' });
  });

  it('enables via --test-mode <dir>', () => {
    expect(
      parseTestMode({
        argv: ['electron', '.', TEST_MODE_FLAG, '/tmp/next'],
        env: {},
      })
    ).toEqual({ enabled: true, profileDir: '/tmp/next' });
  });

  it('refuses when the flag has no directory after it', () => {
    const result = parseTestMode({
      argv: ['electron', '.', TEST_MODE_FLAG, '--inspect'],
      env: {},
    });
    expect(result.enabled).toBe(false);
    expect('error' in result && result.error).toContain(TEST_PROFILE_DIR_ENV);
  });

  it('refuses when QORTAL_TEST_MODE=1 gives no directory', () => {
    const result = parseTestMode({
      argv: ['electron', '.'],
      env: { QORTAL_TEST_MODE: '1' },
    });
    expect(result.enabled).toBe(false);
    expect('error' in result && result.error).toContain('profile directory');
  });

  it('prefers the env var over the arg', () => {
    expect(
      parseTestMode({
        argv: ['electron', '.', `${TEST_MODE_FLAG}=/tmp/from-arg`],
        env: { [TEST_PROFILE_DIR_ENV]: '/tmp/from-env' },
      })
    ).toEqual({ enabled: true, profileDir: '/tmp/from-env' });
  });

  it('refuses in a packaged build', () => {
    const result = parseTestMode({
      argv: ['electron', '.'],
      env: { [TEST_PROFILE_DIR_ENV]: '/tmp/profile' },
      isPackaged: true,
    });
    expect(result.enabled).toBe(false);
    expect('error' in result && result.error).toContain('packaged');
  });

  it('normalises a whitespace-only directory to a refusal', () => {
    const result = parseTestMode({
      argv: ['electron', '.'],
      env: { [TEST_PROFILE_DIR_ENV]: '   ' },
    });
    expect(result.enabled).toBe(false);
  });
});

describe('isSuppressedInTestMode', () => {
  it('suppresses nothing on a normal launch', () => {
    expect(isSuppressedInTestMode(false, 'reticulumDaemon')).toBe(false);
    expect(isSuppressedInTestMode(false, 'updateChecks')).toBe(false);
    expect(isSuppressedInTestMode(false, 'tray')).toBe(false);
  });

  it('suppresses every listed subsystem in test mode', () => {
    for (const subsystem of [
      'reticulumDaemon',
      'reticulumDevVenvEnsure',
      'updateChecks',
      'tray',
      'audioSurfaceHttpsServer',
      'powerMonitor',
      'osNotificationPresentation',
    ] as const) {
      expect(isSuppressedInTestMode(true, subsystem)).toBe(true);
    }
  });
});

describe('testModePaths', () => {
  it('keeps every artefact under the profile directory', () => {
    expect(testModePaths('/tmp/run-1')).toEqual({
      userData: '/tmp/run-1',
      settingsDir: '/tmp/run-1',
    });
  });
});
