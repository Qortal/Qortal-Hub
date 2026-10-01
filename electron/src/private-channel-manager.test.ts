import { describe, expect, it, vi } from 'vitest';
import {
  MockPrivateTransport,
  PRIVATE_CHANNEL_LIMITS,
  PrivateChannelManager,
  type PrivateTransport,
  type PrivateTransportContext,
  type PrivateTransportEvent,
  type PrivateTransportMessage,
} from './private-channel-manager';
import type {
  QAppReticulumConnectionOwnership,
  QAppReticulumOwner,
} from './qapp-reticulum-manager';

const alice: QAppReticulumOwner = {
  tabId: 'tab-a',
  name: 'alice-app',
  service: 'APP',
};
const bob: QAppReticulumOwner = {
  tabId: 'tab-b',
  name: 'bob-app',
  service: 'APP',
};
const aliceRns = 'rns-alice';
const bobRns = 'rns-bob';

function ownership(
  owner: QAppReticulumOwner,
  connectionId: string
): QAppReticulumConnectionOwnership {
  if (connectionId === aliceRns) {
    return owner.tabId === alice.tabId ? 'owned' : 'not-owned';
  }
  if (connectionId === bobRns) {
    return owner.tabId === bob.tabId ? 'owned' : 'not-owned';
  }
  return 'missing';
}

class BlockingTransport implements PrivateTransport {
  releases: Array<() => void> = [];
  open = vi.fn(async (_context: PrivateTransportContext) => undefined);
  close = vi.fn(async () => undefined);
  sendReliable = vi.fn((_message: PrivateTransportMessage) => this.block());
  sendDatagram = vi.fn((_message: PrivateTransportMessage) => this.block());

  private block(): Promise<void> {
    return new Promise((resolve) => this.releases.push(resolve));
  }
}

describe('PrivateChannelManager', () => {
  it('bounds binary bulk independently and leaves control capacity available', async () => {
    const transport = new BlockingTransport();
    const manager = new PrivateChannelManager(ownership, () => transport);
    const channel = await manager.open(alice, aliceRns, 'file-transfer');
    const payload = new Uint8Array(700 * 1024);
    const sends = [0, 1].map((i) =>
      manager.send(
        alice,
        channel.channelId,
        'reliable',
        `large-${i}`,
        payload,
        { streamKey: 'bulk' }
      )
    );
    await expect(
      manager.send(alice, channel.channelId, 'reliable', 'overflow', payload, {
        streamKey: 'bulk',
      })
    ).rejects.toMatchObject({ code: 'QUEUE_LIMIT_REACHED' });
    const control = manager.send(
      alice,
      channel.channelId,
      'reliable',
      'control',
      { ping: true },
      { streamKey: 'control' }
    );
    expect(transport.sendReliable).toHaveBeenCalledTimes(3);
    transport.releases.splice(0).forEach((release) => release());
    await Promise.all([...sends, control]);
    const retry = manager.send(
      alice,
      channel.channelId,
      'reliable',
      'retry',
      payload,
      { streamKey: 'bulk' }
    );
    transport.releases.splice(0).forEach((release) => release());
    await retry;
    await manager.close(alice, channel.channelId);
  });
  it('bounds one stream without consuming the control stream queue and validates options', async () => {
    const transport = new BlockingTransport();
    const manager = new PrivateChannelManager(ownership, () => transport);
    const channel = await manager.open(alice, aliceRns, 'file-transfer');
    await expect(
      manager.send(
        alice,
        channel.channelId,
        'reliable',
        'invalid',
        {},
        { streamKey: '../bad' }
      )
    ).rejects.toMatchObject({ code: 'INVALID_STREAM_OPTIONS' });
    const sends = [0, 1, 2].map((i) =>
      manager.send(
        alice,
        channel.channelId,
        'reliable',
        `bulk-${i}`,
        new Uint8Array(64 * 1024),
        { streamKey: 'bulk' }
      )
    );
    await expect(
      manager.send(
        alice,
        channel.channelId,
        'reliable',
        'overflow',
        new Uint8Array(1),
        { streamKey: 'bulk' }
      )
    ).rejects.toMatchObject({ code: 'QUEUE_LIMIT_REACHED' });
    const control = manager.send(
      alice,
      channel.channelId,
      'reliable',
      'control',
      { ping: true },
      { streamKey: 'control' }
    );
    expect(transport.sendReliable).toHaveBeenLastCalledWith(
      expect.objectContaining({ streamKey: 'control' })
    );
    transport.releases.forEach((release) => release());
    await Promise.all([...sends, control]);
  });
  it('opens an owner-scoped mock channel with an opaque unique handle', async () => {
    const manager = new PrivateChannelManager(ownership);
    const first = await manager.open(alice, aliceRns, 'game');
    const second = await manager.open(alice, aliceRns, 'realtime');

    expect(first).toMatchObject({ state: 'OPEN', purpose: 'game' });
    expect(first.channelId).toMatch(/^private-[0-9a-f-]{36}$/);
    expect(second.channelId).not.toBe(first.channelId);
    expect(first).not.toHaveProperty('rnsConnectionId');
    expect(first).not.toHaveProperty('destination');
  });

  it('rejects missing and cross-owner Reticulum connections', async () => {
    const manager = new PrivateChannelManager(ownership);
    await expect(manager.open(alice, 'missing', 'game')).rejects.toMatchObject({
      code: 'INVALID_RNS_CONNECTION',
    });
    await expect(manager.open(bob, aliceRns, 'game')).rejects.toMatchObject({
      code: 'RNS_CONNECTION_NOT_OWNED',
    });
  });

  it('validates purpose and canonical owner identity', async () => {
    const manager = new PrivateChannelManager(ownership);
    await expect(manager.open(alice, aliceRns, 'video')).rejects.toMatchObject({
      code: 'INVALID_PURPOSE',
    });
    await expect(
      manager.open({ ...alice, name: 'Alice-App' }, aliceRns, 'game')
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('prevents another Q-App from using or closing a channel', async () => {
    const manager = new PrivateChannelManager(ownership);
    const { channelId } = await manager.open(alice, aliceRns, 'game');
    await expect(
      manager.send(bob, channelId, 'reliable', '1', 'hello')
    ).rejects.toMatchObject({ code: 'CHANNEL_NOT_OWNED' });
    await expect(manager.close(bob, channelId)).rejects.toMatchObject({
      code: 'CHANNEL_NOT_OWNED',
    });
  });

  it('echoes binary-friendly mock messages only to the owning event key', async () => {
    const manager = new PrivateChannelManager(ownership);
    const listener = vi.fn();
    manager.on('event', listener);
    const { channelId } = await manager.open(alice, aliceRns, 'realtime');
    listener.mockClear();
    const data = new Uint8Array([1, 2, 3]);

    await manager.send(alice, channelId, 'datagram', 'message-1', data);

    expect(listener).toHaveBeenCalledWith({
      ownerKey: 'tab-a\u0000APP\u0000alice-app',
      channelId,
      action: 'PRIVATE_CHANNEL_MESSAGE',
      lane: 'datagram',
      messageId: 'message-1',
      data,
    });
  });

  it('enforces per-owner and global channel limits', async () => {
    const manager = new PrivateChannelManager(() => 'owned');
    for (
      let index = 0;
      index < PRIVATE_CHANNEL_LIMITS.maxChannelsPerOwner;
      index += 1
    ) {
      await manager.open(alice, aliceRns, 'game');
    }
    await expect(manager.open(alice, aliceRns, 'game')).rejects.toMatchObject({
      code: 'CHANNEL_LIMIT_REACHED',
    });

    const globalManager = new PrivateChannelManager(() => 'owned');
    for (
      let index = 0;
      index < PRIVATE_CHANNEL_LIMITS.maxChannelsGlobal;
      index += 1
    ) {
      await globalManager.open(
        { tabId: `tab-${index}`, name: `app-${index}`, service: 'APP' },
        `rns-${index}`,
        'game'
      );
    }
    await expect(
      globalManager.open(
        { tabId: 'overflow', name: 'overflow', service: 'APP' },
        'rns-overflow',
        'game'
      )
    ).rejects.toMatchObject({ code: 'CHANNEL_LIMIT_REACHED' });
  });

  it('rejects oversized messages', async () => {
    const manager = new PrivateChannelManager(ownership);
    const { channelId } = await manager.open(alice, aliceRns, 'game');
    await expect(
      manager.send(
        alice,
        channelId,
        'reliable',
        'large',
        new Uint8Array(PRIVATE_CHANNEL_LIMITS.maxBinaryMessageBytes + 1)
      )
    ).rejects.toMatchObject({ code: 'MESSAGE_TOO_LARGE' });
  });

  it('rejects values outside the bounded JSON or binary message model', async () => {
    const manager = new PrivateChannelManager(ownership);
    const { channelId } = await manager.open(alice, aliceRns, 'game');
    await expect(
      manager.send(alice, channelId, 'reliable', 'map', new Map([['x', 1]]))
    ).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
    await expect(
      manager.send(alice, channelId, 'reliable', 'infinite', {
        value: Number.POSITIVE_INFINITY,
      })
    ).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
  });

  it('enforces channel and owner queued-byte limits while sends are pending', async () => {
    const transports: BlockingTransport[] = [];
    const manager = new PrivateChannelManager(ownership, () => {
      const transport = new BlockingTransport();
      transports.push(transport);
      return transport;
    });
    const first = await manager.open(alice, aliceRns, 'game');
    const second = await manager.open(alice, aliceRns, 'realtime');
    const payload = new Uint8Array(PRIVATE_CHANNEL_LIMITS.maxMessageBytes);
    const pending: Array<Promise<unknown>> = [];

    for (let index = 0; index < 4; index += 1) {
      pending.push(
        manager.send(alice, first.channelId, 'reliable', `a-${index}`, payload)
      );
    }
    await expect(
      manager.send(
        alice,
        first.channelId,
        'reliable',
        'channel-overflow',
        payload
      )
    ).rejects.toMatchObject({ code: 'QUEUE_LIMIT_REACHED' });

    for (let index = 0; index < 4; index += 1) {
      pending.push(
        manager.send(alice, second.channelId, 'reliable', `b-${index}`, payload)
      );
    }
    const third = await manager.open(alice, aliceRns, 'file-transfer');
    await expect(
      manager.send(
        alice,
        third.channelId,
        'reliable',
        'owner-overflow',
        payload
      )
    ).rejects.toMatchObject({ code: 'QUEUE_LIMIT_REACHED' });

    for (const transport of transports) {
      for (const release of transport.releases) release();
    }
    await Promise.all(pending);
  });

  it('invalidates closed handles and makes close idempotent', async () => {
    const manager = new PrivateChannelManager(ownership);
    const { channelId } = await manager.open(alice, aliceRns, 'game');
    await expect(manager.close(alice, channelId)).resolves.toEqual({
      channelId,
      state: 'CLOSED',
    });
    await expect(manager.close(alice, channelId)).resolves.toEqual({
      channelId,
      state: 'CLOSED',
    });
    expect(manager.status(alice, channelId).state).toBe('CLOSED');
    await expect(
      manager.send(alice, channelId, 'reliable', 'after-close', 'x')
    ).rejects.toMatchObject({ code: 'CHANNEL_CLOSED' });
  });

  it('cleans all channels for an owner without affecting another owner', async () => {
    const manager = new PrivateChannelManager(ownership);
    const first = await manager.open(alice, aliceRns, 'game');
    const second = await manager.open(alice, aliceRns, 'realtime');
    const other = await manager.open(bob, bobRns, 'game');
    await manager.cleanupOwner(alice);

    expect(manager.status(alice, first.channelId).state).toBe('CLOSED');
    expect(manager.status(alice, second.channelId).state).toBe('CLOSED');
    expect(manager.status(bob, other.channelId).state).toBe('OPEN');
  });

  it('closes channels when their Reticulum control connection closes', async () => {
    const manager = new PrivateChannelManager(ownership);
    const first = await manager.open(alice, aliceRns, 'game');
    const second = await manager.open(alice, aliceRns, 'realtime');
    const other = await manager.open(bob, bobRns, 'game');

    await manager.cleanupRnsConnection(alice, aliceRns);

    expect(manager.status(alice, first.channelId).state).toBe('CLOSED');
    expect(manager.status(alice, second.channelId).state).toBe('CLOSED');
    expect(manager.status(bob, other.channelId).state).toBe('OPEN');
  });

  it('drops late transport events after channel cleanup', async () => {
    let emit: ((event: PrivateTransportEvent) => void) | undefined;
    const manager = new PrivateChannelManager(ownership, (listener) => {
      emit = listener;
      return new MockPrivateTransport(listener);
    });
    const listener = vi.fn();
    manager.on('event', listener);
    const { channelId } = await manager.open(alice, aliceRns, 'game');
    await manager.cleanupOwner(alice);
    listener.mockClear();

    emit?.({
      kind: 'message',
      lane: 'reliable',
      messageId: 'late',
      data: 'ignored',
    });
    expect(listener).not.toHaveBeenCalled();
    expect(() => manager.status(alice, channelId)).not.toThrow();
  });
});
