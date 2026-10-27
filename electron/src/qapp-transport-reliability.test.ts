import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { QAppMoqTransportManager } from './moq-transport-manager';
import { QuicMasqueTransport } from './quic-masque-transport';
import {
  PrivateTransportSidecar,
  PrivateTransportSidecarError,
} from './private-transport-sidecar';

const owner = { tabId: 'audit', name: 'audit', service: 'APP' };
afterEach(() => vi.useRealTimers());
it('does not close a session when its first object arrives before subscribe resolves', async () => {
  let emit: any;
  const close = vi.fn(async () => {});
  const manager = new QAppMoqTransportManager(
    () => 'owned',
    (callback) => {
      emit = callback;
      return {
        open: async () => {},
        close,
        metrics: async () => ({}),
        publish: async () => {},
        subscribe: async (id, namespace, trackName) => {
          emit({
            kind: 'object',
            subscriptionId: id,
            namespace,
            trackName,
            groupId: 0,
            objectId: 0,
            payload: new Uint8Array([1]),
          });
        },
      };
    }
  );
  const events: any[] = [];
  manager.on('event', (e) => events.push(e));
  const { sessionId } = await manager.open(
    owner,
    'rns-test',
    ['test'],
    'track'
  );
  await manager.subscribe(owner, sessionId, 'first', ['test'], 'track');
  try {
    expect(close).not.toHaveBeenCalled();
    expect(events.some((e) => e.action === 'MOQ_OBJECT')).toBe(true);
  } finally {
    manager.destroy();
  }
});

it('does not kill the shared sidecar for a valid reply to an expired request', async () => {
  vi.useFakeTimers();
  const sidecar = new PrivateTransportSidecar({ requestTimeoutMs: 20 });
  const requests: any[] = [];
  const child = {
    stdin: {
      writable: true,
      write: (buffer: Buffer, callback: any) => {
        requests.push(JSON.parse(buffer.toString()));
        callback();
      },
    },
    kill: vi.fn(),
  };
  (sidecar as any).child = child;
  const pending = (sidecar as any)
    .request('health', {})
    .catch((e: any) => e.code);
  await vi.advanceTimersByTimeAsync(21);
  expect(await pending).toBe('SIDECAR_REQUEST_TIMEOUT');
  (sidecar as any).handleStdout(
    child,
    Buffer.from(
      JSON.stringify({
        version: 2,
        requestId: requests[0].requestId,
        ok: true,
        result: {},
      }) + '\n'
    )
  );
  expect(child.kill).not.toHaveBeenCalled();
  expect(sidecar.isRunning()).toBe(true);
});

it('does not replay a reliable message whose delivery is ambiguous after IPC timeout', async () => {
  const sidecar: any = new EventEmitter();
  let opens = 0;
  const delivered: string[] = [];
  sidecar.openPrivateSession = async () => ({
    sessionId: `session-${++opens}`,
  });
  sidecar.closePrivateSession = async () => {};
  sidecar.sendPrivateReliable = async (_session: string, id: string) => {
    delivered.push(id);
    if (delivered.length === 1)
      throw new PrivateTransportSidecarError('SIDECAR_REQUEST_TIMEOUT');
  };
  const transport = new QuicMasqueTransport(
    () => {},
    sidecar,
    {
      relayAddress: '127.0.0.1:1234',
      relayServerName: 'relay',
      relayCertSha256: 'ab'.repeat(32),
    },
    { getBootstrap: async () => ({ expiresAt: Date.now() + 60_000 }) as any }
  );
  await transport.open({
    owner,
    rnsConnectionId: 'rns-test',
    channelId: 'test',
    purpose: 'game',
    generation: 1,
  });
  await expect(
    transport.sendReliable({
      lane: 'reliable',
      messageId: 'operation-1',
      data: { increment: 1 },
    })
  ).rejects.toMatchObject({ code: 'RELIABLE_DELIVERY_UNKNOWN' });
  await transport.close();
  expect(delivered).toEqual(['operation-1']);
});

it('invalidates or restores logical ownership after the Python bridge loses native connections', async () => {
  const { QAppReticulumManager } = await import('./qapp-reticulum-manager');
  const native = new Set<string>();
  const manager = new QAppReticulumManager({
    onEvent: () => () => {},
    invoke: async (action, payload) => {
      if (action === 'qapp_rns_connect') {
        native.add(String(payload.connectionId));
        return { ok: true, payload: {} };
      }
      if (action === 'qapp_rns_send')
        return native.has(String(payload.connectionId))
          ? { ok: true, payload: { messageId: '1' } }
          : { ok: false, code: 'RNS_INVALID_CONNECTION' };
      return { ok: true, payload: {} };
    },
  });
  const events: any[] = [];
  manager.on('event', (event) => events.push(event));
  const { connectionId } = await manager.connect(owner, 'ab'.repeat(16));
  native.clear(); // State lost when the Python bridge process is replaced.
  await manager.send(owner, connectionId, { ping: true }).catch(() => {});
  try {
    expect(manager.connectionOwnership(owner, connectionId)).not.toBe('owned');
  } finally {
    manager.destroy();
  }
});
