import { describe, expect, it } from 'vitest';
import {
  QAPP_ACTION_REQUEST_TIMEOUT_MS,
  QAPP_READ_REQUEST_TIMEOUT_MS,
  qappRequestTimeoutMs,
} from './qappRequestTimeout';

const MINUTE = 60 * 1000;

describe('qappRequestTimeoutMs', () => {
  it('waits for a request that can change something longer than an approval can take', () => {
    // The approval dialog stays open for a minute.
    expect(QAPP_ACTION_REQUEST_TIMEOUT_MS).toBeGreaterThan(2 * MINUTE);
    expect(qappRequestTimeoutMs('SEND_COIN', {}, false)).toBe(5 * MINUTE);
    expect(qappRequestTimeoutMs('REGISTER_NAME', {}, false)).toBe(5 * MINUTE);
    expect(qappRequestTimeoutMs('SEND_CHAT_MESSAGE', {}, false)).toBe(
      5 * MINUTE
    );
  });

  it('keeps 30 s for read-only requests', () => {
    expect(QAPP_READ_REQUEST_TIMEOUT_MS).toBe(30 * 1000);
    expect(qappRequestTimeoutMs('SEARCH_QDN_RESOURCES', {}, true)).toBe(
      30 * 1000
    );
    expect(qappRequestTimeoutMs('GET_LIST_ITEMS', {}, true)).toBe(30 * 1000);
  });

  it('never gives up before the app’s own qortalRequest does', () => {
    // Core's q-apps.js waits an hour for sign-in and two minutes for a balance.
    expect(qappRequestTimeoutMs('GET_USER_ACCOUNT', {}, true)).toBe(
      60 * MINUTE
    );
    expect(qappRequestTimeoutMs('GET_WALLET_BALANCE', {}, true)).toBe(
      2 * MINUTE
    );
    expect(qappRequestTimeoutMs('PUBLISH_QDN_RESOURCE', {}, false)).toBe(
      60 * MINUTE
    );
  });

  it('gives a batch of publishes 30 min for each resource', () => {
    const resources = (count: number) => ({
      resources: Array.from({ length: count }, () => ({})),
    });
    expect(
      qappRequestTimeoutMs(
        'PUBLISH_MULTIPLE_QDN_RESOURCES',
        resources(4),
        false
      )
    ).toBe(120 * MINUTE);
    expect(
      qappRequestTimeoutMs(
        'PUBLISH_MULTIPLE_QDN_RESOURCES',
        resources(1),
        false
      )
    ).toBe(60 * MINUTE);
  });

  it('only looks up real action names', () => {
    expect(qappRequestTimeoutMs('constructor', null, false)).toBe(5 * MINUTE);
    expect(qappRequestTimeoutMs(undefined, undefined, true)).toBe(30 * 1000);
  });
});
