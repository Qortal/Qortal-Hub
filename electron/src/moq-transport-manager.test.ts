import { describe, expect, it, vi } from 'vitest';
import {
  QAppMoqTransportManager,
  type ManagedMoqTransport,
} from './moq-transport-manager';
import type { MoqTransportEvent } from './moq-masque-transport';

const owner = { tabId: 'tab-1', name: 'call-app', service: 'APP' };

class FakeTransport implements ManagedMoqTransport {
  open = vi.fn(async () => undefined);
  subscribe = vi.fn(async () => undefined);
  publish = vi.fn(async () => undefined);
  metrics = vi.fn(async () => ({ objectsSent: 1 }));
  close = vi.fn(async () => undefined);

  constructor(readonly emit: (event: MoqTransportEvent) => void) {}
}

function setup(ownership: 'owned' | 'missing' | 'not-owned' = 'owned') {
  const transports: FakeTransport[] = [];
  const manager = new QAppMoqTransportManager(
    () => ownership,
    (emit) => {
      const transport = new FakeTransport(emit);
      transports.push(transport);
      return transport;
    }
  );
  const events: unknown[] = [];
  manager.on('event', (event) => events.push(event));
  return { manager, transports, events };
}

async function open(manager: QAppMoqTransportManager) {
  return manager.open(
    owner,
    'rns-1',
    ['qortal', 'call', 'room-123', 'QAlice123'],
    'audio'
  );
}

describe('Q-App generic MOQT manager', () => {
  it('admits bounded reliable objects without relaxing datagram limits', async () => {
    const { manager, transports } = setup();
    const opened = await manager.open(
      owner,
      'rns-1',
      ['opaque'],
      ['objects', 'urgent']
    );
    const objects = [new Uint8Array(128 * 1024)];
    const delivery = {
      priority: 1,
      maxQueueAgeMillis: 1500,
      groupId: 7,
      objectId: 1,
    };
    await expect(
      manager.publish(owner, opened.sessionId, {
        trackName: 'objects',
        objects,
        delivery,
      })
    ).resolves.toMatchObject({ accepted: true });
    expect(transports[0].publish).toHaveBeenCalledWith(
      objects[0],
      'objects',
      objects,
      delivery
    );
    await expect(
      manager.publish(owner, opened.sessionId, {
        trackName: 'objects',
        objects,
      })
    ).rejects.toMatchObject({ code: 'MOQ_OBJECT_TOO_LARGE' });
    for (const bad of [
      { ...delivery, groupId: -1 },
      { ...delivery, objectId: undefined },
      { ...delivery, groupId: Infinity },
    ]) {
      await expect(
        manager.publish(owner, opened.sessionId, {
          trackName: 'objects',
          objects,
          delivery: bad,
        })
      ).rejects.toMatchObject({ code: 'INVALID_MOQ_CONFIG' });
    }
    await expect(
      manager.publish(owner, opened.sessionId, {
        trackName: 'objects',
        objects: [new Uint8Array(1024 * 1024 + 1)],
        delivery,
      })
    ).rejects.toMatchObject({ code: 'MOQ_OBJECT_TOO_LARGE' });
  });
  it('validates opaque delivery policy before admission and forwards it unchanged', async () => {
    const { manager, transports } = setup();
    const opened = await manager.open(owner, 'rns-1', ['opaque'], ['live']);
    const objects = [new Uint8Array([1])];
    for (const delivery of [
      null,
      {},
      { priority: -1, maxQueueAgeMillis: 100 },
      { priority: 3, maxQueueAgeMillis: 100 },
      { priority: 0, maxQueueAgeMillis: Infinity },
      { priority: 0, maxQueueAgeMillis: 2001 },
    ]) {
      await expect(
        manager.publish(owner, opened.sessionId, {
          trackName: 'live',
          objects,
          delivery,
        })
      ).rejects.toMatchObject({ code: 'INVALID_MOQ_CONFIG' });
    }
    expect(transports[0].publish).not.toHaveBeenCalled();
    const delivery = { priority: 0, maxQueueAgeMillis: 120 };
    await manager.publish(owner, opened.sessionId, {
      trackName: 'live',
      objects,
      delivery,
    });
    expect(transports[0].publish).toHaveBeenCalledWith(
      objects[0],
      'live',
      objects,
      delivery
    );
  });
  it('isolates bounded publication batches by track and rejects undeclared tracks', async () => {
    const { manager, transports } = setup();
    const opened = await manager.open(
      owner,
      'rns-1',
      ['example'],
      ['fast', 'bulk']
    );
    const objects = [new Uint8Array([1]), new Uint8Array([2])];
    await manager.publish(owner, opened.sessionId, {
      trackName: 'bulk',
      objects,
    });
    expect(transports[0].publish).toHaveBeenCalledWith(
      objects[0],
      'bulk',
      objects,
      undefined
    );
    await expect(
      manager.publish(owner, opened.sessionId, {
        trackName: 'undeclared',
        objects,
      })
    ).rejects.toMatchObject({ code: 'INVALID_MOQ_CONFIG' });
    await expect(
      manager.publish(owner, opened.sessionId, {
        trackName: 'bulk',
        objects: Array(9).fill(objects[0]),
      })
    ).rejects.toMatchObject({ code: 'MOQ_OBJECT_TOO_LARGE' });
    await expect(
      manager.open(owner, 'rns-1', ['example'], ['same', 'same'])
    ).rejects.toMatchObject({ code: 'INVALID_MOQ_CONFIG' });
  });
  it('reserves independent queue capacity when a bulk track is blocked', async () => {
    const { manager, transports } = setup();
    const opened = await manager.open(
      owner,
      'rns-1',
      ['example'],
      ['fast', 'bulk']
    );
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    transports[0].publish.mockImplementation(() => blocked);
    const request = {
      trackName: 'bulk',
      objects: Array.from({ length: 8 }, () => new Uint8Array(1024)),
    };
    const one = manager.publish(owner, opened.sessionId, request);
    const two = manager.publish(owner, opened.sessionId, request);
    await expect(
      manager.publish(owner, opened.sessionId, request)
    ).rejects.toMatchObject({ code: 'MOQ_QUEUE_LIMIT' });
    transports[0].publish.mockImplementation(async () => undefined);
    await expect(
      manager.publish(owner, opened.sessionId, {
        trackName: 'fast',
        objects: [new Uint8Array([1])],
      })
    ).resolves.toMatchObject({ accepted: true });
    release();
    await Promise.all([one, two]);
  });
  it('binds a session to the Q-App-owned Reticulum connection', async () => {
    const { manager, transports } = setup();
    const opened = await open(manager);
    expect(opened.state).toBe('OPEN');
    expect(transports[0].open).toHaveBeenCalledWith({
      owner,
      rnsConnectionId: 'rns-1',
      publicationNamespace: ['qortal', 'call', 'room-123', 'QAlice123'],
      publicationTrack: 'audio',
    });

    const missing = setup('missing');
    await expect(open(missing.manager)).rejects.toMatchObject({
      code: 'INVALID_RNS_CONNECTION',
    });
  });

  it('subscribes and carries only bounded opaque binary objects', async () => {
    const { manager, transports, events } = setup();
    const opened = await open(manager);
    await manager.subscribe(
      owner,
      opened.sessionId,
      'peer-QBob456',
      ['qortal', 'call', 'room-123', 'QBob456'],
      'audio'
    );
    await manager.publish(owner, opened.sessionId, new Uint8Array([1, 2, 3]));
    expect(transports[0].publish).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3])
    );

    transports[0].emit({
      kind: 'object',
      subscriptionId: 'peer-QBob456',
      namespace: ['qortal', 'call', 'room-123', 'QBob456'],
      trackName: 'audio',
      groupId: 0,
      objectId: 1,
      payload: new Uint8Array([7, 8]),
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        action: 'MOQ_OBJECT',
        sessionId: opened.sessionId,
        payload: new Uint8Array([7, 8]),
      })
    );
    await expect(
      manager.publish(owner, opened.sessionId, new Uint8Array(1025))
    ).rejects.toMatchObject({ code: 'MOQ_OBJECT_TOO_LARGE' });
  });

  it('isolates owners and closes sessions with their Reticulum connection', async () => {
    const { manager, transports } = setup();
    const opened = await open(manager);
    await expect(
      manager.metrics({ ...owner, tabId: 'other-tab' }, opened.sessionId)
    ).rejects.toMatchObject({ code: 'MOQ_SESSION_NOT_OWNED' });
    await manager.cleanupRnsConnection(owner, 'rns-1');
    expect(transports[0].close).toHaveBeenCalledOnce();
    await expect(
      manager.metrics(owner, opened.sessionId)
    ).rejects.toMatchObject({ code: 'MOQ_SESSION_CLOSED' });
  });
});
