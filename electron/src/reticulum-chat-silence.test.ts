import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ReticulumChatManager,
  type ReticulumChatEvent,
  type ReticulumDmEvent,
} from './reticulum-chat';
import {
  ReticulumChatDatabase,
  reticulumDmConversationId,
} from './reticulum-chat-db';

const OWNER = 'QaU2XUB6iMgM9YUJnYRkxwVKJd322hJh91';
const PEER = 'QeLB8NZBjQkWYkRdw3renvRgB63DWR9E5E';
const GROUP_ID = 716;

function tempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-silence-test-'));
  return path.join(root, 'reticulum-chat.db');
}

function groupEvent(
  eventId: string,
  authorAddress: string,
  timestamp: number,
  eventType: ReticulumChatEvent['eventType'] = 'message'
): ReticulumChatEvent {
  const payload = `payload-${eventId}`;
  return {
    eventId,
    groupId: GROUP_ID,
    channelId: 'general',
    authorAddress,
    authorPublicKey: `public-key-${authorAddress}`,
    authorStreamId: authorAddress === OWNER ? 'a'.repeat(32) : 'b'.repeat(32),
    authorSeq: timestamp,
    timestamp,
    eventType,
    encryptedPayload: payload,
    payloadHash: `hash-${eventId}`,
    mentionAddressHashes: [],
    signature: `signature-${eventId}`,
  };
}

function directEvent(
  eventId: string,
  senderAddress: string,
  recipientAddress: string,
  timestamp: number,
  eventType: ReticulumDmEvent['eventType'] = 'message',
  targetEventId?: string
): ReticulumDmEvent {
  const payload = `payload-${eventId}`;
  return {
    eventId,
    conversationId: reticulumDmConversationId(OWNER, PEER),
    senderAddress,
    recipientAddress,
    senderPublicKey: `public-key-${senderAddress}`,
    senderSeq: timestamp,
    timestamp,
    eventType,
    targetEventId,
    payload,
    payloadHash: `hash-${eventId}`,
    signature: `signature-${eventId}`,
  };
}

describe('Reticulum chat silence', () => {
  const databases: ReticulumChatDatabase[] = [];
  const managers: ReticulumChatManager[] = [];

  afterEach(() => {
    while (managers.length) managers.pop()?.close();
    while (databases.length) databases.pop()?.close();
    vi.useRealTimers();
  });

  it('filters silenced group messages before limits without losing stored events', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    databases.push(db);
    const base = Date.now() - 10_000;
    const ownEvents = [
      groupEvent('own-1', OWNER, base + 1),
      groupEvent('own-2', OWNER, base + 2),
    ];
    const peerEvents = [
      groupEvent('peer-1', PEER, base + 3),
      groupEvent('peer-2', PEER, base + 4),
      groupEvent('peer-3', PEER, base + 5),
    ];
    for (const event of [...ownEvents, ...peerEvents]) {
      expect(db.insertEvent(event, event.authorAddress === OWNER)).toBe(true);
    }

    db.setSilence(OWNER, PEER, 'group', String(GROUP_ID), null, base + 6);

    expect(
      db
        .getRecentMessageEvents(GROUP_ID, 2, 'general', [PEER])
        .map((event) => event.eventId)
    ).toEqual(['own-1', 'own-2']);
    expect(db.hasEvent('peer-3')).toBe(true);
  });

  it('does not resurrect group unread state after unsilencing', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    databases.push(db);
    const base = Date.now() - 10_000;
    db.insertEvent(groupEvent('own', OWNER, base + 1), true);
    db.setSilence(OWNER, PEER, 'group', String(GROUP_ID), null, base + 2);
    db.insertEvent(groupEvent('hidden-peer', PEER, base + 3), false);

    let summary = db.getChatSummaries(OWNER)[0];
    expect(summary.lastEvent?.eventId).toBe('own');
    expect(summary.unreadCount).toBe(0);

    db.clearSilence(OWNER, PEER, 'group', String(GROUP_ID), base + 4);
    summary = db.getChatSummaries(OWNER)[0];
    expect(summary.lastEvent?.eventId).toBe('hidden-peer');
    expect(summary.unreadCount).toBe(0);

    db.insertEvent(groupEvent('new-peer', PEER, base + 5), false);
    summary = db.getChatSummaries(OWNER)[0];
    expect(summary.unreadCount).toBe(1);
  });

  it('counts only incoming DM messages as unread', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    databases.push(db);
    const base = Date.now() - 10_000;
    const incomingMessage = directEvent(
      'incoming-message',
      PEER,
      OWNER,
      base + 1
    );
    expect(db.insertDirectEvent(incomingMessage, false)).toBe(true);
    expect(db.getDirectSummaries(OWNER)[0]?.unreadCount).toBe(1);
    expect(
      db.insertDirectEvent(
        directEvent(
          'incoming-reaction',
          PEER,
          OWNER,
          base + 2,
          'reaction_add',
          incomingMessage.eventId
        ),
        false
      )
    ).toBe(true);
    expect(db.getDirectSummaries(OWNER)[0]?.unreadCount).toBe(1);
    expect(
      db.insertDirectEvent(
        directEvent(
          'incoming-edit',
          PEER,
          OWNER,
          base + 3,
          'edit',
          incomingMessage.eventId
        ),
        false
      )
    ).toBe(true);

    expect(db.getDirectSummaries(OWNER)[0]?.unreadCount).toBe(1);

    db.markDirectRead(
      incomingMessage.conversationId,
      OWNER,
      incomingMessage.timestamp
    );
    expect(db.getDirectSummaries(OWNER)[0]?.unreadCount).toBe(0);

    expect(
      db.insertDirectEvent(
        directEvent(
          'incoming-reaction-remove',
          PEER,
          OWNER,
          base + 4,
          'reaction_remove',
          incomingMessage.eventId
        ),
        false
      )
    ).toBe(true);
    expect(db.getDirectSummaries(OWNER)[0]?.unreadCount).toBe(0);

    expect(
      db.insertDirectEvent(
        directEvent(
          'incoming-delete',
          PEER,
          OWNER,
          base + 5,
          'delete',
          incomingMessage.eventId
        ),
        false
      )
    ).toBe(true);
    expect(db.getDirectSummaries(OWNER)[0]?.unreadCount).toBe(0);
  });

  it('uses the actual clear time when a timed silence is ended early', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    databases.push(db);
    const base = Date.now() - 10_000;
    db.insertEvent(groupEvent('before-silence', OWNER, base + 1), true);
    db.setSilence(
      OWNER,
      PEER,
      'group',
      String(GROUP_ID),
      24 * 60 * 60 * 1000,
      base + 2
    );
    db.insertEvent(groupEvent('hidden-peer', PEER, base + 3), false);
    db.clearSilence(OWNER, PEER, 'group', String(GROUP_ID), base + 4);
    db.insertEvent(groupEvent('visible-peer', PEER, base + 5), false);

    const summary = db.getChatSummaries(OWNER)[0];
    expect(summary.lastEvent?.eventId).toBe('visible-peer');
    expect(summary.unreadCount).toBe(1);
  });

  it('suppresses semantic mentions from an actively silenced author', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    databases.push(db);
    const base = Date.now() - 10_000;
    const mention = groupEvent('everyone-mention', PEER, base + 2);
    mention.mentionTargets = [{ type: 'everyone', groupId: GROUP_ID }];
    db.insertEvent(groupEvent('own-visible', OWNER, base), true);
    db.setSilence(OWNER, PEER, 'group', String(GROUP_ID), null, base + 1);
    db.insertEvent(mention, false);

    const summary = db.getChatSummaries(OWNER)[0];
    expect(summary.unreadCount).toBe(0);
    expect(summary.mentionCount).toBe(0);
  });

  it('filters generic history before applying its requested limit', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    managers.push(manager);
    manager.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: OWNER },
    ]);
    const db = (manager as unknown as { db: ReticulumChatDatabase }).db;
    const base = Date.now() - 10_000;
    db.insertEvent(groupEvent('own-visible', OWNER, base + 1), true);
    db.insertEvent(groupEvent('peer-hidden-1', PEER, base + 2), false);
    db.insertEvent(groupEvent('peer-hidden-2', PEER, base + 3), false);
    manager.setSilence(OWNER, PEER, 'group', null, GROUP_ID);

    expect(
      manager
        .getHistory(GROUP_ID, 'general', 1, { repairNetwork: false })
        .map((event) => event.eventId)
    ).toEqual(['own-visible']);
  });

  it('lists only active silences for the requested local group', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    managers.push(manager);
    manager.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: OWNER },
    ]);
    manager.setSilence(OWNER, PEER, 'group', null, GROUP_ID);

    expect(
      manager
        .listSilences(OWNER, 'group', GROUP_ID)
        .map((silence) => silence.targetAddress)
    ).toEqual([PEER]);

    manager.clearSilence(OWNER, PEER, 'group', GROUP_ID);
    expect(manager.listSilences(OWNER, 'group', GROUP_ID)).toEqual([]);
  });

  it('uses the authoritative group owner when renderer context is stale', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    managers.push(manager);
    manager.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: OWNER },
    ]);
    const staleOwner = 'Qstale-renderer-owner';
    const changes: Array<{ ownerAddress: string; active: boolean }> = [];
    manager.on('silenceChanged', ({ ownerAddress, active }) => {
      changes.push({ ownerAddress, active });
    });

    const hidden = manager.setSilence(
      staleOwner,
      PEER,
      'group',
      null,
      GROUP_ID
    );

    expect(hidden.ownerAddress).toBe(OWNER);
    expect(
      manager.getSilence(staleOwner, PEER, 'group', GROUP_ID)?.active
    ).toBe(true);
    expect(
      manager
        .listSilences(staleOwner, 'group', GROUP_ID)
        .map((silence) => silence.targetAddress)
    ).toEqual([PEER]);

    const cleared = manager.clearSilence(staleOwner, PEER, 'group', GROUP_ID);
    expect(cleared?.ownerAddress).toBe(OWNER);
    expect(changes).toEqual([
      { ownerAddress: OWNER, active: true },
      { ownerAddress: OWNER, active: false },
    ]);
  });

  it('uses the registered local identity while group address hydration catches up', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    managers.push(manager);
    manager.setLocalGroupMemberships([GROUP_ID]);
    manager.setLocalDmAddresses([OWNER]);

    const hidden = manager.setSilence(OWNER, PEER, 'group', null, GROUP_ID);

    expect(hidden.ownerAddress).toBe(OWNER);
    expect(manager.getSilence(OWNER, PEER, 'group', GROUP_ID)?.active).toBe(
      true
    );
  });

  it('keeps DM traffic stored while hiding it from history and summaries', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    managers.push(manager);
    manager.setLocalDmAddresses([OWNER]);
    const db = (manager as unknown as { db: ReticulumChatDatabase }).db;
    const base = Date.now() - 10_000;
    db.insertDirectEvent(directEvent('own', OWNER, PEER, base + 1), true);
    manager.setSilence(OWNER, PEER, 'dm', null);
    db.insertDirectEvent(
      directEvent('hidden-peer', PEER, OWNER, base + 2),
      false
    );

    expect(
      manager.getDirectHistory(OWNER, PEER, 20).map((event) => event.eventId)
    ).toEqual(['own']);
    let summary = manager.getDirectSummaries(OWNER)[0];
    expect(summary.lastEvent?.eventId).toBe('own');
    expect(summary.updatedAt).toBe(base + 1);
    expect(summary.unreadCount).toBe(0);

    manager.clearSilence(OWNER, PEER, 'dm');
    summary = manager.getDirectSummaries(OWNER)[0];
    expect(summary.lastEvent?.eventId).toBe('hidden-peer');
    expect(summary.unreadCount).toBe(0);
    expect(db.hasDirectEvent('hidden-peer')).toBe(true);
  });

  it('keeps metadata visible while suppressing silenced message events', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    managers.push(manager);
    manager.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: OWNER },
    ]);
    manager.setSilence(OWNER, PEER, 'group', null, GROUP_ID);
    const emitted: string[] = [];
    manager.on('event', ({ event }) => emitted.push(event.eventId));
    const base = Date.now() - 1000;

    (
      manager as unknown as {
        emitGroupEventIfVisible: (event: ReticulumChatEvent) => void;
      }
    ).emitGroupEventIfVisible(
      groupEvent('metadata', PEER, base + 1, 'channel_update')
    );
    (
      manager as unknown as {
        emitGroupEventIfVisible: (event: ReticulumChatEvent) => void;
      }
    ).emitGroupEventIfVisible(groupEvent('message', PEER, base + 2));

    expect(emitted).toEqual(['metadata']);
  });

  it('automatically refreshes silence state when a timed silence expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00Z'));
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    managers.push(manager);
    manager.setLocalGroupMemberships([
      { groupId: GROUP_ID, localAddress: OWNER },
    ]);
    const changes: boolean[] = [];
    manager.on('silenceChanged', ({ active }) => changes.push(active));

    manager.setSilence(OWNER, PEER, 'group', 60_000, GROUP_ID);
    expect(manager.getSilence(OWNER, PEER, 'group', GROUP_ID)?.active).toBe(
      true
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(manager.getSilence(OWNER, PEER, 'group', GROUP_ID)?.active).toBe(
      false
    );
    expect(changes).toEqual([true, false]);
  });
});
