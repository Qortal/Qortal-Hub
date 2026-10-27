import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { QAppReticulumBridgeTransport } from './qapp-reticulum-bridge-transport';
import { QAppReticulumManager } from './qapp-reticulum-manager';

const owner = { tabId: 'tab-1', name: 'backend-client', service: 'APP' };
class Bridge extends EventEmitter {
  invokeQAppReticulum = vi.fn(
    async (_action: string, _payload: Record<string, unknown>) => ({
      ok: true,
      payload: {},
    })
  );
}

describe('Q-App bridge lifecycle', () => {
  it.each(['degraded', 'stopped'])(
    'invalidates quiet connections on %s, including dependent transports',
    async (event) => {
      const bridge = new Bridge();
      const manager = new QAppReticulumManager(
        new QAppReticulumBridgeTransport(async () => bridge)
      );
      const cleanup = vi.fn();
      const events = vi.fn();
      manager.on('connection-closed', cleanup);
      manager.on('event', events);
      const first = await manager.connect(owner, 'ab'.repeat(16));
      const second = await manager.connect(owner, 'ab'.repeat(16));
      bridge.emit(event);
      bridge.emit(event);
      for (const { connectionId } of [first, second]) {
        expect(manager.connectionOwnership(owner, connectionId)).toBe(
          'missing'
        );
        expect(cleanup).toHaveBeenCalledWith(owner, connectionId);
        expect(events).toHaveBeenCalledWith(
          expect.objectContaining({
            connectionId,
            state: 'CLOSED',
            reason: 'RNS_TRANSPORT_RESET',
          })
        );
      }
      expect(cleanup).toHaveBeenCalledTimes(2);
      const replacement = await manager.connect(owner, 'ab'.repeat(16));
      expect(manager.connectionOwnership(owner, replacement.connectionId)).toBe(
        'owned'
      );
      manager.destroy();
      for (const name of ['qapp-rns', 'stopped', 'degraded'])
        expect(bridge.listenerCount(name)).toBe(0);
    }
  );

  it('closes a late native connect after a reset instead of returning dead ownership', async () => {
    const bridge = new Bridge();
    let finish!: () => void;
    bridge.invokeQAppReticulum.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ ok: true, payload: {} });
        })
    );
    const manager = new QAppReticulumManager(
      new QAppReticulumBridgeTransport(async () => bridge)
    );
    const connecting = manager.connect(owner, 'ab'.repeat(16));
    const rejected = expect(connecting).rejects.toMatchObject({
      code: 'RNS_CONNECTION_CLOSED',
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    bridge.emit('degraded');
    finish();
    await rejected;
    expect(bridge.invokeQAppReticulum).toHaveBeenLastCalledWith(
      'qapp_rns_close',
      expect.objectContaining({ connectionId: expect.any(String) })
    );
    manager.destroy();
  });

  it('detaches the replaced bridge and does not attach after destruction', async () => {
    const first = new Bridge();
    let current = first;
    const transport = new QAppReticulumBridgeTransport(async () => current);
    const manager = new QAppReticulumManager(transport);
    const connected = await manager.connect(owner, 'ab'.repeat(16));
    current = new Bridge();
    await transport.invoke('qapp_rns_request', {});
    expect(manager.connectionOwnership(owner, connected.connectionId)).toBe(
      'missing'
    );
    expect(first.listenerCount('qapp-rns')).toBe(0);
    expect(current.listenerCount('qapp-rns')).toBe(1);
    manager.destroy();
    await transport.invoke('qapp_rns_close', {});
    expect(current.listenerCount('qapp-rns')).toBe(0);
  });

  it('removes only the peer-closed connection and ignores duplicate close events', async () => {
    const bridge = new Bridge();
    const manager = new QAppReticulumManager(
      new QAppReticulumBridgeTransport(async () => bridge)
    );
    const cleanup = vi.fn();
    manager.on('connection-closed', cleanup);
    const first = await manager.connect(owner, 'ab'.repeat(16));
    const second = await manager.connect(owner, 'ab'.repeat(16));
    const payload = bridge.invokeQAppReticulum.mock.calls[0][1];
    bridge.emit('qapp-rns', { ...payload, kind: 'state', state: 'CLOSED' });
    bridge.emit('qapp-rns', { ...payload, kind: 'state', state: 'CLOSED' });
    expect(manager.connectionOwnership(owner, first.connectionId)).toBe(
      'missing'
    );
    expect(manager.connectionOwnership(owner, second.connectionId)).toBe(
      'owned'
    );
    expect(cleanup).toHaveBeenCalledOnce();
    manager.destroy();
  });
});
