import { describe, expect, it } from 'vitest';
import {
  getPrivateTransportFactory,
  readTrustedRelayConfig,
} from './private-transport-runtime';

describe('private transport runtime selection', () => {
  it('uses Reticulum discovery by default without a feature flag', () => {
    expect(
      getPrivateTransportFactory({} as never, () => null, {})
    ).toBeTypeOf('function');
  });

  it('requires pinned relay values in explicit test mode', () => {
    expect(() =>
      getPrivateTransportFactory({} as never, () => null, {
        QORTAL_PRIVATE_TRANSPORT: 'masque-test',
      })
    ).toThrow('Incomplete MASQUE prototype configuration');
  });

  it('parses the explicit test-mode relay boundary', () => {
    expect(
      readTrustedRelayConfig({
        QORTAL_MASQUE_TEST_RELAY_ADDRESS: '127.0.0.1:47322',
        QORTAL_MASQUE_TEST_RELAY_SERVER_NAME: 'relay.test',
        QORTAL_MASQUE_TEST_RELAY_CERT_SHA256: 'ab'.repeat(32),
      })
    ).toEqual({
      relayAddress: '127.0.0.1:47322',
      relayServerName: 'relay.test',
      relayCertSha256: 'ab'.repeat(32),
    });
  });
});
