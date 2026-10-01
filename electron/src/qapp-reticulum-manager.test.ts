import { describe, expect, it, vi } from 'vitest';
import {
  QAppReticulumError,
  QAppReticulumManager,
  type QAppReticulumNativeEvent,
  type QAppReticulumOwner,
  type QAppReticulumTransport,
} from './qapp-reticulum-manager';
import vectors from '../../protocol-v1-vectors.json';

class FakeTransport implements QAppReticulumTransport {
  listeners = new Set<(event: QAppReticulumNativeEvent) => void>();
  invoke = vi.fn(async (action: string, payload: Record<string, unknown>) => ({
    ok: true,
    payload:
      action === 'qapp_rns_request'
        ? {
            payloadBase64: Buffer.from(JSON.stringify({ ok: true })).toString(
              'base64'
            ),
            encoding: 'json',
          }
        : { messageId: '1', ...payload },
  }));
  onEvent(listener: (event: QAppReticulumNativeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const destination = '0123456789abcdef0123456789abcdef';
const alice: QAppReticulumOwner = {
  tabId: '1',
  name: 'Alice App',
  service: 'APP',
};
const bob: QAppReticulumOwner = {
  tabId: '2',
  name: 'Bob App',
  service: 'APP',
};

describe('QAppReticulumManager', () => {
  it('rejects a connect completed after navigation cleanup and preserves its replacement', async () => {
    const transport = new FakeTransport();
    let complete!: (value: any) => void;
    transport.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const manager = new QAppReticulumManager(transport);
    const pending = manager.connect(alice, destination);
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'RNS_CONNECTION_CLOSED',
    });
    await manager.cleanupOwner(alice);
    const fresh = await manager.connect(alice, destination);
    complete({ ok: true, payload: {} });
    await rejected;
    expect(manager.connectionOwnership(alice, fresh.connectionId)).toBe(
      'owned'
    );
    await expect(
      manager.send(alice, fresh.connectionId, { test: true })
    ).resolves.toBeDefined();
    expect(
      transport.invoke.mock.calls.filter(
        ([action]) => action === 'qapp_rns_close'
      )
    ).toHaveLength(2);
    manager.destroy();
  });

  it('does not overwrite a terminal native event with connected', async () => {
    const transport = new FakeTransport();
    transport.invoke.mockImplementationOnce(async (_action, payload) => {
      for (const listener of transport.listeners)
        listener({
          managerKey: String(payload.managerKey),
          connectionId: String(payload.connectionId),
          kind: 'state',
          state: 'DISCONNECTED',
        });
      return { ok: true, payload: {} };
    });
    const manager = new QAppReticulumManager(transport);
    await expect(manager.connect(alice, destination)).rejects.toMatchObject({
      code: 'RNS_CONNECTION_CLOSED',
    });
    manager.destroy();
  });

  it('reports connection ownership without exposing its destination', async () => {
    const manager = new QAppReticulumManager(new FakeTransport());
    const { connectionId } = await manager.connect(alice, destination);
    expect(manager.connectionOwnership(alice, connectionId)).toBe('owned');
    expect(manager.connectionOwnership(bob, connectionId)).toBe('not-owned');
    expect(manager.connectionOwnership(alice, 'missing')).toBe('missing');
  });

  it('uses the same isolated manager key for RPC and realtime', async () => {
    const transport = new FakeTransport();
    const manager = new QAppReticulumManager(transport);
    await manager.connect(alice, destination);
    await manager.request(alice, { destination, path: '/hello', payload: {} });
    const connectPayload = transport.invoke.mock.calls[0][1];
    const requestPayload = transport.invoke.mock.calls[1][1];
    expect(connectPayload.managerKey).toBe(requestPayload.managerKey);
  });

  it('binds reserved main-process RPCs to an owned logical connection', async () => {
    const transport = new FakeTransport();
    const manager = new QAppReticulumManager(transport);
    const { connectionId } = await manager.connect(alice, destination);
    await manager.request(alice, {
      destination,
      path: '/qortal/private-transport/bootstrap/v1',
      payload: {},
      connectionId,
    });
    expect(transport.invoke.mock.calls[1][1]).toMatchObject({
      logicalConnectionId: connectionId,
    });
    await expect(
      manager.request(bob, {
        destination,
        path: '/qortal/private-transport/bootstrap/v1',
        connectionId,
      })
    ).rejects.toMatchObject({ code: 'RNS_INVALID_CONNECTION' });
  });

  it('encodes the frozen RPC request payload and decodes its JSON response', async () => {
    const transport = new FakeTransport();
    const manager = new QAppReticulumManager(transport);
    const response = await manager.request(alice, {
      destination,
      path: '/hello',
      payload: vectors.rpc_request.application_json,
      requestId: vectors.rpc_request.request_id,
    });
    const request = transport.invoke.mock.calls[0][1];
    expect(request).toMatchObject({
      path: '/hello',
      requestId: vectors.rpc_request.request_id,
      encoding: 'json',
      payloadBase64: vectors.rpc_request.payload_base64,
    });
    expect(response).toEqual({ ok: true });
  });

  it('encodes RNS_SEND JSON and decodes RNS_MESSAGE JSON symmetrically', async () => {
    const transport = new FakeTransport();
    const manager = new QAppReticulumManager(transport);
    const listener = vi.fn();
    manager.on('event', listener);
    const connection = await manager.connect(alice, destination);
    await manager.send(
      alice,
      connection.connectionId,
      vectors.data_envelope.application_json
    );
    const sendPayload = transport.invoke.mock.calls[1][1];
    expect(sendPayload).toMatchObject({
      encoding: 'json',
      payloadBase64: vectors.data_envelope.payload_base64,
    });
    const managerKey = transport.invoke.mock.calls[0][1].managerKey as string;
    for (const callback of transport.listeners) {
      callback({
        managerKey,
        connectionId: connection.connectionId,
        kind: 'message',
        encoding: 'json',
        payloadBase64: vectors.data_envelope.payload_base64,
      });
    }
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RNS_MESSAGE',
        payload: vectors.data_envelope.application_json,
      })
    );
  });

  it('delivers a zero-length binary RNS_MESSAGE', async () => {
    const transport = new FakeTransport();
    const manager = new QAppReticulumManager(transport);
    const listener = vi.fn();
    manager.on('event', listener);
    const connection = await manager.connect(alice, destination);
    const managerKey = transport.invoke.mock.calls[0][1].managerKey as string;
    for (const callback of transport.listeners) {
      callback({
        managerKey,
        connectionId: connection.connectionId,
        kind: 'message',
        encoding: 'base64',
        payloadBase64: '',
      });
    }
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RNS_MESSAGE',
        payload: new Uint8Array(0),
      })
    );
  });

  it('rejects cross-Q-App send and close attempts', async () => {
    const manager = new QAppReticulumManager(new FakeTransport());
    const { connectionId } = await manager.connect(alice, destination);
    await expect(manager.send(bob, connectionId, {})).rejects.toMatchObject({
      code: 'RNS_INVALID_CONNECTION',
    });
    await expect(manager.close(bob, connectionId)).rejects.toBeInstanceOf(
      QAppReticulumError
    );
  });

  it('cleans every logical connection owned by a destroyed tab', async () => {
    const transport = new FakeTransport();
    const manager = new QAppReticulumManager(transport);
    await manager.connect(alice, destination);
    await manager.connect(alice, destination);
    await manager.cleanupOwner(alice);
    expect(
      transport.invoke.mock.calls.filter(
        ([action]) => action === 'qapp_rns_close'
      )
    ).toHaveLength(2);
  });

  it('drops native events whose manager ownership does not match', async () => {
    const transport = new FakeTransport();
    const manager = new QAppReticulumManager(transport);
    const listener = vi.fn();
    manager.on('event', listener);
    const connection = await manager.connect(alice, destination);
    for (const callback of transport.listeners) {
      callback({
        managerKey: 'attacker',
        connectionId: connection.connectionId,
        kind: 'message',
        payloadBase64: Buffer.from('{}').toString('base64'),
        encoding: 'json',
      });
    }
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not resurrect a connection closed while native events are pending', async () => {
    const transport = new FakeTransport();
    const manager = new QAppReticulumManager(transport);
    const listener = vi.fn();
    manager.on('event', listener);
    const connection = await manager.connect(alice, destination);
    const managerKey = transport.invoke.mock.calls[0][1].managerKey as string;
    await manager.close(alice, connection.connectionId);
    for (const callback of transport.listeners) {
      callback({
        managerKey,
        connectionId: connection.connectionId,
        kind: 'state',
        state: 'CONNECTED',
      });
    }
    expect(listener.mock.calls.map(([event]) => event.state)).toEqual([
      'CLOSING',
      'CLOSED',
    ]);
    await expect(
      manager.send(alice, connection.connectionId, {})
    ).rejects.toMatchObject({ code: 'RNS_INVALID_CONNECTION' });
  });

  it('rejects a raw payload whose Base64 DATA envelope exceeds the frame limit', async () => {
    const manager = new QAppReticulumManager(new FakeTransport());
    const connection = await manager.connect(alice, destination);
    await expect(
      manager.send(alice, connection.connectionId, new Uint8Array(256 * 1024))
    ).rejects.toMatchObject({ code: 'RNS_MESSAGE_TOO_LARGE' });
  });

  it('does not automatically replay an ambiguously failed RPC', async () => {
    const transport = new FakeTransport();
    transport.invoke = vi.fn(async () => ({
      ok: false,
      code: 'RNS_REQUEST_TIMEOUT',
    }));
    const manager = new QAppReticulumManager(transport);
    await expect(
      manager.request(alice, {
        destination,
        path: '/create-item',
        payload: { value: 1 },
        requestId: 'operation-1',
      })
    ).rejects.toMatchObject({ code: 'RNS_REQUEST_TIMEOUT' });
    expect(transport.invoke).toHaveBeenCalledTimes(1);
  });

  it('limits pending RPCs independently for each Q-App owner', async () => {
    const transport = new FakeTransport();
    const releases: Array<() => void> = [];
    transport.invoke = vi.fn(
      () =>
        new Promise((resolve) => {
          releases.push(() =>
            resolve({
              ok: true,
              payload: {
                payloadBase64: Buffer.from('{}').toString('base64'),
                encoding: 'json',
              },
            })
          );
        })
    );
    const manager = new QAppReticulumManager(transport);
    const pending = Array.from({ length: 8 }, (_, index) =>
      manager.request(alice, {
        destination,
        path: '/status',
        requestId: `pending-${index}`,
      })
    );

    await expect(
      manager.request(alice, { destination, path: '/status' })
    ).rejects.toMatchObject({ code: 'RNS_SEND_QUEUE_FULL' });
    const bobRequest = manager.request(bob, {
      destination,
      path: '/status',
    });

    for (const release of releases) release();
    await expect(Promise.all([...pending, bobRequest])).resolves.toHaveLength(
      9
    );
  });

  it('bounds pending RPCs across all Q-App owners', async () => {
    const transport = new FakeTransport();
    const releases: Array<() => void> = [];
    transport.invoke = vi.fn(
      () =>
        new Promise((resolve) => {
          releases.push(() =>
            resolve({
              ok: true,
              payload: {
                payloadBase64: Buffer.from('{}').toString('base64'),
                encoding: 'json',
              },
            })
          );
        })
    );
    const manager = new QAppReticulumManager(transport);
    const pending = Array.from({ length: 64 }, (_, index) =>
      manager.request(
        { ...alice, tabId: `global-rpc-${index}` },
        { destination, path: '/status' }
      )
    );

    await expect(
      manager.request(
        { ...alice, tabId: 'global-rpc-overflow' },
        { destination, path: '/status' }
      )
    ).rejects.toMatchObject({ code: 'RNS_SEND_QUEUE_FULL' });

    for (const release of releases) release();
    await expect(Promise.all(pending)).resolves.toHaveLength(64);
  });

  it('releases a logical connection slot when native connect rejects', async () => {
    const transport = new FakeTransport();
    transport.invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error('transport unavailable'))
      .mockResolvedValue({ ok: true, payload: {} });
    const manager = new QAppReticulumManager(transport);

    await expect(manager.connect(alice, destination)).rejects.toThrow(
      'transport unavailable'
    );
    await expect(
      Promise.all(
        Array.from({ length: 8 }, () => manager.connect(alice, destination))
      )
    ).resolves.toHaveLength(8);
  });

  it('limits logical realtime connections per Q-App owner', async () => {
    const manager = new QAppReticulumManager(new FakeTransport());
    await Promise.all(
      Array.from({ length: 8 }, () => manager.connect(alice, destination))
    );
    await expect(manager.connect(alice, destination)).rejects.toMatchObject({
      code: 'RNS_SEND_QUEUE_FULL',
    });
    await expect(manager.connect(bob, destination)).resolves.toMatchObject({
      state: 'CONNECTED',
    });
  });

  it('bounds logical realtime connections across all Q-App owners', async () => {
    const manager = new QAppReticulumManager(new FakeTransport());
    await Promise.all(
      Array.from({ length: 64 }, (_, index) =>
        manager.connect(
          { ...alice, tabId: `global-connection-${index}` },
          destination
        )
      )
    );

    await expect(
      manager.connect(
        { ...alice, tabId: 'global-connection-overflow' },
        destination
      )
    ).rejects.toMatchObject({ code: 'RNS_SEND_QUEUE_FULL' });
  });
});
