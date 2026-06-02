import { describe, expect, it } from 'vitest';
import {
  stepDecryptOverloadState,
  stepFailSafeState,
} from './gcallAudioEscalation';
import {
  PENDING_DECRYPT_OVERLOAD_ENTER,
  PENDING_DECRYPT_OVERLOAD_EXIT,
  PENDING_DECRYPT_OVERLOAD_EXIT_HOLD_MS,
  PENDING_DECRYPT_OVERLOAD_LONG_TASK_MIN_DEPTH,
  PENDING_DECRYPT_OVERLOAD_WARM_DEPTH,
} from './pendingDecryptLimits';

describe('stepDecryptOverloadState', () => {
  it('enters on depth above threshold', () => {
    const s = stepDecryptOverloadState(
      { active: false, exitBelowSinceMs: null },
      PENDING_DECRYPT_OVERLOAD_ENTER + 1,
      1000
    );
    expect(s.active).toBe(true);
  });

  it('enters on warm depth with rising trend', () => {
    const s = stepDecryptOverloadState(
      { active: false, exitBelowSinceMs: null },
      PENDING_DECRYPT_OVERLOAD_WARM_DEPTH + 1,
      1000,
      { risingTrend: true }
    );
    expect(s.active).toBe(true);
  });

  it('does not enter on warm depth without rising trend', () => {
    const s = stepDecryptOverloadState(
      { active: false, exitBelowSinceMs: null },
      PENDING_DECRYPT_OVERLOAD_WARM_DEPTH + 1,
      1000,
      { risingTrend: false }
    );
    expect(s.active).toBe(false);
  });

  it('enters on long-task pressure above min depth', () => {
    const s = stepDecryptOverloadState(
      { active: false, exitBelowSinceMs: null },
      PENDING_DECRYPT_OVERLOAD_LONG_TASK_MIN_DEPTH + 1,
      1000,
      { longTaskPressure: true }
    );
    expect(s.active).toBe(true);
  });

  it('exits only after hold below exit threshold', () => {
    let s = stepDecryptOverloadState(
      { active: true, exitBelowSinceMs: null },
      PENDING_DECRYPT_OVERLOAD_EXIT - 1,
      1000
    );
    expect(s.active).toBe(true);
    expect(s.exitBelowSinceMs).toBe(1000);
    s = stepDecryptOverloadState(s, PENDING_DECRYPT_OVERLOAD_EXIT - 1, 1000 + PENDING_DECRYPT_OVERLOAD_EXIT_HOLD_MS);
    expect(s.active).toBe(false);
  });
});

describe('stepFailSafeState', () => {
  it('stays off when disabled', () => {
    const s = stepFailSafeState(
      { active: false, overloadSinceMs: null, enteredAtMs: null },
      {
        failSafeEnabled: false,
        overloadActive: true,
        depth: 200,
        exitDepth: 50,
        nowMs: 10_000,
      }
    );
    expect(s.active).toBe(false);
  });
});
