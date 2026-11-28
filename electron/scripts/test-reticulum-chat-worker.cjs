const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const nacl = require('tweetnacl');
const {
  ReticulumChatWorkerPool,
} = require('../build/src/reticulum-chat-worker-pool.js');

function digestHash(events) {
  const ids = [...events]
    .sort(
      (a, b) => a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
    )
    .map((event) => event.eventId);
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(ids), 'utf8')
    .digest('hex');
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rchat-worker-'));
  const dbPath = path.join(tempDir, 'chat.db');
  const db = new Database(dbPath);
  const pool = new ReticulumChatWorkerPool('digest-integration', 1, 8);
  const createdAt = Date.now();
  try {
    db.exec(`
      CREATE TABLE reticulum_chat_channels (
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        read_mode TEXT,
        PRIMARY KEY (group_id, channel_id)
      );
      CREATE TABLE reticulum_chat_events (
        event_id TEXT PRIMARY KEY,
        group_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        feed_timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        expires_at INTEGER
      );
    `);
    const insertChannel = db.prepare(
      'INSERT INTO reticulum_chat_channels (group_id, channel_id, read_mode) VALUES (?, ?, ?)'
    );
    insertChannel.run(716, 'testing', 'members');
    insertChannel.run(716, 'admin-private', 'admins');
    const insertEvent = db.prepare(`
      INSERT INTO reticulum_chat_events
        (event_id, group_id, channel_id, timestamp, feed_timestamp, event_type, expires_at)
      VALUES (?, 716, ?, ?, ?, ?, NULL)
    `);
    insertEvent.run(
      'public-message',
      'testing',
      createdAt - 300,
      createdAt - 300,
      'message'
    );
    insertEvent.run(
      'private-message',
      'admin-private',
      createdAt - 200,
      createdAt - 200,
      'message'
    );
    insertEvent.run(
      'private-metadata',
      'admin-private',
      createdAt - 100,
      createdAt - 100,
      'channel_update'
    );

    const result = await pool.run({
      kind: 'build_group_digest_state',
      dbPath,
      groupId: 716,
      createdAt,
    });
    if (!result || !result.ok || result.kind !== 'build_group_digest_state') {
      throw new Error(
        `Worker failed: ${result && !result.ok ? result.error : 'no result'}`
      );
    }
    const channelIds = result.state.channelHeads.map((head) => head.channelId);
    for (const expected of [
      'admin-private',
      'general',
      'qortal-land',
      'testing',
    ]) {
      if (!channelIds.includes(expected))
        throw new Error(`Missing channel head: ${expected}`);
    }
    const expectedDigest = digestHash([
      { eventId: 'public-message', timestamp: createdAt - 300 },
      { eventId: 'private-metadata', timestamp: createdAt - 100 },
    ]);
    if (result.state.snapshot.digestHash !== expectedDigest) {
      throw new Error(
        'Digest included private message content or omitted public metadata'
      );
    }
    if (result.state.snapshot.latest?.eventId !== 'private-metadata') {
      throw new Error('Latest digest cursor is incorrect');
    }
    const privateHead = result.state.channelHeads.find(
      (head) => head.channelId === 'admin-private'
    );
    if (privateHead?.latest?.eventId !== 'private-metadata') {
      throw new Error('Admin-private channel head is incorrect');
    }
    const landKeyPair = nacl.sign.keyPair();
    const landStateBytes = Buffer.from('qortal-land-state-worker-test', 'utf8');
    const landStateSignature = nacl.sign.detached(
      landStateBytes,
      landKeyPair.secretKey
    );
    const validLandState = await pool.run({
      kind: 'verify_land_state_signature',
      signedBytes: landStateBytes,
      signature: landStateSignature,
      publicKey: landKeyPair.publicKey,
    });
    if (
      !validLandState ||
      !validLandState.ok ||
      validLandState.kind !== 'verify_land_state_signature' ||
      !validLandState.valid
    ) {
      throw new Error('Worker rejected a valid QortalLand state signature');
    }
    const invalidLandState = await pool.run({
      kind: 'verify_land_state_signature',
      signedBytes: Buffer.from('tampered-qortal-land-state', 'utf8'),
      signature: landStateSignature,
      publicKey: landKeyPair.publicKey,
    });
    if (
      !invalidLandState ||
      !invalidLandState.ok ||
      invalidLandState.kind !== 'verify_land_state_signature' ||
      invalidLandState.valid
    ) {
      throw new Error('Worker accepted an invalid QortalLand state signature');
    }
    const malformedLandStateSignature = await pool.run({
      kind: 'verify_land_state_signature',
      signedBytes: landStateBytes,
      signature: landStateSignature.subarray(0, landStateSignature.length - 1),
      publicKey: landKeyPair.publicKey,
    });
    if (
      !malformedLandStateSignature ||
      !malformedLandStateSignature.ok ||
      malformedLandStateSignature.kind !== 'verify_land_state_signature' ||
      malformedLandStateSignature.valid
    ) {
      throw new Error('Worker accepted a malformed QortalLand state signature');
    }
    const malformedLandStatePublicKey = await pool.run({
      kind: 'verify_land_state_signature',
      signedBytes: landStateBytes,
      signature: landStateSignature,
      publicKey: landKeyPair.publicKey.subarray(
        0,
        landKeyPair.publicKey.length - 1
      ),
    });
    if (
      !malformedLandStatePublicKey ||
      !malformedLandStatePublicKey.ok ||
      malformedLandStatePublicKey.kind !== 'verify_land_state_signature' ||
      malformedLandStatePublicKey.valid
    ) {
      throw new Error('Worker accepted a malformed QortalLand public key');
    }
    console.log('reticulum chat worker integration: passed');
  } finally {
    pool.stop();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
