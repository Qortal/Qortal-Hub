import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import type { PrivateChannelBootstrapProvider } from './private-channel-bootstrap';
import {
  PrivateTransportSidecarError,
  type PrivateSessionConfig,
} from './private-transport-sidecar';
import { QuicMasqueTransport } from './quic-masque-transport';
import { PrivateChannelError } from './private-channel-manager';

class SidecarStub extends EventEmitter {
  attempts: PrivateSessionConfig[] = [];

  async openPrivateSession(config: PrivateSessionConfig) {
    this.attempts.push(config);
    if (this.attempts.length === 1) {
      throw new PrivateTransportSidecarError('MASQUE_TUNNEL_FAILED');
    }
    return { sessionId: 'local-session' };
  }
}

class RecoveringSidecarStub extends EventEmitter {
  attempts: PrivateSessionConfig[] = [];
  closePrivateSession = vi.fn(async () => undefined);
  sendPrivateReliable = vi.fn(async () => undefined);
  sendPrivateDatagram = vi.fn(async () => undefined);

  async openPrivateSession(config: PrivateSessionConfig) {
    this.attempts.push(config);
    return { sessionId: `native-${this.attempts.length}` };
  }
}

describe('QUIC MASQUE transport', () => {
  it('preserves duplicate-connection rejection without retrying relays', async () => {
    const sidecar = new RecoveringSidecarStub();
    const getBootstrap = vi.fn(async () => {
      throw new PrivateChannelError('TRANSPORT_ALREADY_ATTACHED');
    });
    const relay = vi.fn(async () => ({
      relayAddress: '8.8.8.8:47322',
      relayServerName: 'relay.test',
      relayCertSha256: 'ab'.repeat(32),
    }));
    const transport = new QuicMasqueTransport(
      vi.fn(),
      sidecar as never,
      relay,
      { getBootstrap }
    );
    await expect(
      transport.open({
        owner: { tabId: 'tab', name: 'app', service: 'APP' },
        rnsConnectionId: 'rns',
        purpose: 'file-transfer',
      })
    ).rejects.toMatchObject({ code: 'TRANSPORT_ALREADY_ATTACHED' });
    expect(getBootstrap).toHaveBeenCalledTimes(1);
    expect(sidecar.attempts).toHaveLength(0);
    await transport.close();
  });
  it('falls back to the pinned same-host relay when public NAT hairpinning fails', async () => {
    const sidecar = new SidecarStub();
    const bootstrapProvider: PrivateChannelBootstrapProvider = {
      getBootstrap: vi.fn(async () => ({
        backendRnsDestination: 'ab'.repeat(16),
        backendTransportEndpoint: '127.0.0.1:4445',
        backendTransportServerName: 'backend.test',
        backendTransportCertSha256: 'cd'.repeat(32),
        logicalSessionId: 'logical-session',
        attachToken: 'attach-token',
        nonce: 'n'.repeat(32),
        ownerBindingHash: 'ef'.repeat(32),
        expiresAt: Date.now() + 10_000,
      })),
    };
    const transport = new QuicMasqueTransport(
      vi.fn(),
      sidecar as never,
      {
        relayAddress: '8.8.8.8:47322',
        relayServerName: 'relay.test',
        relayCertSha256: '12'.repeat(32),
        localFallbackAddress: '127.0.0.1:47322',
      },
      bootstrapProvider
    );

    await transport.open({
      owner: { tabId: 'tab', name: 'qapp-ui-call', service: 'APP' },
      rnsConnectionId: 'rns-connection',
      purpose: 'realtime',
    });

    expect(sidecar.attempts.map((attempt) => attempt.relayAddress)).toEqual([
      '8.8.8.8:47322',
      '127.0.0.1:47322',
    ]);
  });

  it('re-discovers another relay with fresh credentials without replacing the logical channel', async () => {
    const sidecar = new RecoveringSidecarStub();
    let bootstrapNumber = 0;
    const bootstrapProvider: PrivateChannelBootstrapProvider = {
      getBootstrap: vi.fn(async () => ({
        backendRnsDestination: 'ab'.repeat(16),
        backendTransportEndpoint: '127.0.0.1:4445',
        backendTransportServerName: 'backend.test',
        backendTransportCertSha256: 'cd'.repeat(32),
        logicalSessionId: `logical-${++bootstrapNumber}`,
        attachToken: `attach-token-${bootstrapNumber}`,
        nonce: `nonce-${bootstrapNumber}`,
        ownerBindingHash: 'ef'.repeat(32),
        expiresAt: Date.now() + 10_000,
      })),
    };
    const relayProvider = vi.fn(async (excluded?: ReadonlySet<string>) => ({
      relayAddress: excluded?.has('8.8.8.8:47322')
        ? '1.1.1.1:47322'
        : '8.8.8.8:47322',
      relayServerName: 'relay.test',
      relayCertSha256: '12'.repeat(32),
    }));
    const events = vi.fn();
    const transport = new QuicMasqueTransport(
      events,
      sidecar as never,
      relayProvider,
      bootstrapProvider
    );
    await transport.open({
      channelId: 'private-logical',
      owner: { tabId: 'tab', name: 'qapp-ui-call', service: 'APP' },
      rnsConnectionId: 'rns-connection',
      purpose: 'realtime',
      generation: 1,
    });

    sidecar.sendPrivateReliable.mockRejectedValueOnce(
      new PrivateTransportSidecarError('RELIABLE_SEND_NOT_STARTED')
    );
    await expect(transport.sendReliable({
      lane: 'reliable', messageId: 'not-started', data: new Uint8Array(70000), streamKey: 'bulk',
    })).rejects.toMatchObject({ code: 'RELIABLE_SEND_NOT_STARTED' });
    expect(sidecar.attempts).toHaveLength(1);
    expect(sidecar.closePrivateSession).not.toHaveBeenCalled();

    sidecar.emit('event', {
      event: 'error',
      sessionId: 'native-1',
      code: 'INNER_QUIC_FAILED',
      data: Buffer.alloc(0),
    });
    await transport.sendReliable({
      lane: 'reliable',
      messageId: 'after-recovery',
      data: { ok: true },
    });

    expect(sidecar.attempts.map((attempt) => attempt.relayAddress)).toEqual([
      '8.8.8.8:47322',
      '1.1.1.1:47322',
    ]);
    expect(sidecar.attempts.map((attempt) => attempt.attachToken)).toEqual([
      'attach-token-1',
      'attach-token-2',
    ]);
    expect(sidecar.sendPrivateReliable).toHaveBeenCalledWith(
      'native-2',
      'after-recovery',
      expect.any(Buffer),
      undefined,
      undefined
    );
    expect(events).not.toHaveBeenCalled();
  });
});
