/**
 * Read-watermark clamping.
 *
 * A watermark is compared against `event.timestamp`, which is stamped by the
 * sender's clock. A caller passing the local wall clock can therefore place the
 * watermark ahead of messages from a sender whose clock runs fast. Those
 * messages satisfy `timestamp > watermark` forever, so they stay unread and the
 * badge never appears even though the notification fired.
 *
 * `markChannelsRead` clamps every request to the newest stored event for the
 * channel and rejects requests that have nothing to anchor to. These tests pin
 * that behaviour at the database boundary, so a future caller cannot reopen the
 * bug by passing `Date.now()`.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ReticulumChatDatabase,
  type ReticulumChatEvent,
} from './reticulum-chat-db';

const TEST_STREAM_ID = 'a'.repeat(32);
const GROUP_ID = 7;
const MY_ADDRESS = 'Qme';

const roots: string[] = [];
const dbs: ReticulumChatDatabase[] = [];

function openDb(): ReticulumChatDatabase {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-watermark-'));
  roots.push(root);
  const db = new ReticulumChatDatabase(path.join(root, 'reticulum-chat.db'));
  dbs.push(db);
  return db;
}

function base58Encode(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = '';
  while (value > 0n) {
    out = alphabet[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = alphabet[0] + out;
  }
  return out || alphabet[0];
}

function makeEvent(
  overrides: Partial<ReticulumChatEvent> = {}
): ReticulumChatEvent {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  return {
    eventId: `event-${Math.random().toString(16).slice(2)}`,
    groupId: GROUP_ID,
    channelId: 'general',
    authorAddress: 'Qsender',
    authorPublicKey: publicKey,
    authorStreamId: TEST_STREAM_ID,
    authorSeq: 1,
    timestamp: 1_000,
    eventType: 'message',
    encryptedPayload: 'ciphertext',
    payloadHash: 'hash',
    mentionAddressHashes: [],
    signature: 'signature',
    ...overrides,
  };
}

afterEach(() => {
  while (dbs.length > 0) {
    try {
      dbs.pop()!.close();
    } catch {
      // already closed
    }
  }
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('getNewestEventTimestamp', () => {
  it('returns the newest stored event timestamp for the channel', () => {
    const db = openDb();
    db.insertEvent(makeEvent({ timestamp: 1_000, authorSeq: 1 }), false);
    db.insertEvent(makeEvent({ timestamp: 5_000, authorSeq: 2 }), false);
    db.insertEvent(makeEvent({ timestamp: 3_000, authorSeq: 3 }), false);
    expect(db.getNewestEventTimestamp(GROUP_ID, 'general')).toBe(5_000);
  });

  it('returns 0 for a channel with no events', () => {
    const db = openDb();
    expect(db.getNewestEventTimestamp(GROUP_ID, 'empty')).toBe(0);
  });

  it('does not leak timestamps across channels', () => {
    const db = openDb();
    db.insertEvent(
      makeEvent({ channelId: 'general', timestamp: 9_000 }),
      false
    );
    expect(db.getNewestEventTimestamp(GROUP_ID, 'other')).toBe(0);
  });
});

describe('markChannelsRead watermark clamping', () => {
  it('clamps a future-dated watermark to the newest event', () => {
    const db = openDb();
    db.insertEvent(makeEvent({ timestamp: 1_000, authorSeq: 1 }), false);

    // The reported bug: the local clock is ahead of the sender's timestamps.
    const requested = Date.now() + 60 * 60_000;
    db.markRead(GROUP_ID, 'general', requested, MY_ADDRESS);

    expect(db.getReadWatermark(GROUP_ID, 'general', MY_ADDRESS)).toBe(1_000);
  });

  it('never leaves the watermark ahead of the newest event, so later reads can advance', () => {
    const db = openDb();
    const senderAddress = 'Qsender';
    db.insertEvent(
      makeEvent({
        authorAddress: senderAddress,
        timestamp: 1_000,
        authorSeq: 1,
        eventId: 'm1',
      }),
      false
    );
    // A message from a sender whose clock runs ahead of the reader's.
    const futureTimestamp = Date.now() + 30 * 60_000;
    db.insertEvent(
      makeEvent({
        authorAddress: senderAddress,
        timestamp: futureTimestamp,
        authorSeq: 2,
        eventId: 'm2',
      }),
      false
    );

    // Simulate the old bug: a caller sending a wall clock far in the future.
    db.markRead(GROUP_ID, 'general', Date.now() + 5 * 60 * 60_000, MY_ADDRESS);

    const newest = db.getNewestEventTimestamp(GROUP_ID, 'general');
    const watermark = db.getReadWatermark(GROUP_ID, 'general', MY_ADDRESS);
    // The invariant: a watermark can never sit above the newest stored event.
    // If it could, every future message stamped before it would be stranded.
    expect(watermark).toBeLessThanOrEqual(newest);
    expect(watermark).toBe(futureTimestamp);

    // A subsequent read of the newest event still advances correctly.
    db.markRead(GROUP_ID, 'general', newest, MY_ADDRESS);
    expect(db.getReadWatermark(GROUP_ID, 'general', MY_ADDRESS)).toBe(newest);
  });

  it('accepts a watermark at or below the newest event unchanged', () => {
    const db = openDb();
    db.insertEvent(makeEvent({ timestamp: 5_000, authorSeq: 1 }), false);

    db.markRead(GROUP_ID, 'general', 2_000, MY_ADDRESS);
    expect(db.getReadWatermark(GROUP_ID, 'general', MY_ADDRESS)).toBe(2_000);
  });

  it('ignores a read for a channel with no events', () => {
    const db = openDb();
    db.markRead(GROUP_ID, 'empty', Date.now(), MY_ADDRESS);
    expect(db.getReadWatermark(GROUP_ID, 'empty', MY_ADDRESS)).toBe(0);
  });

  it('never moves the watermark backwards', () => {
    const db = openDb();
    db.insertEvent(makeEvent({ timestamp: 5_000, authorSeq: 1 }), false);
    db.markRead(GROUP_ID, 'general', 5_000, MY_ADDRESS);
    db.markRead(GROUP_ID, 'general', 1_000, MY_ADDRESS);
    expect(db.getReadWatermark(GROUP_ID, 'general', MY_ADDRESS)).toBe(5_000);
  });
});
