import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as nodeCrypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  RETICULUM_RESOURCE_AUTHORED_RECOVERY_MIN_IDLE_MS,
  RETICULUM_RESOURCE_MIN_FREE_DISK_BYTES,
  RETICULUM_RESOURCE_MAX_FREE_DISK_BYTES,
  RETICULUM_RESOURCE_MIN_LIMIT_BYTES,
  ReticulumResourceStore,
  getReticulumResourceFreeDiskReserveBytes,
  type ReticulumResourceManifest,
} from './reticulum-resource-store';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-store-test-'));
}

function tempStore(): { dir: string; store: ReticulumResourceStore } {
  const dir = tempDir();
  return {
    dir,
    store: new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => 100_000,
    }),
  };
}

function cryptoHash(value: Buffer): string {
  return nodeCrypto.createHash('sha256').update(value).digest('hex');
}

describe('reticulum resource store', () => {
  const stores: ReticulumResourceStore[] = [];

  afterEach(() => {
    while (stores.length) stores.pop()?.close();
  });

  it('reserves at least 1 GiB, with a 4 GiB cap on large filesystems', () => {
    const gibibyte = 1024 * 1024 * 1024;

    expect(getReticulumResourceFreeDiskReserveBytes(10 * gibibyte)).toBe(
      RETICULUM_RESOURCE_MIN_FREE_DISK_BYTES
    );
    expect(getReticulumResourceFreeDiskReserveBytes(40 * gibibyte)).toBe(2 * gibibyte);
    expect(getReticulumResourceFreeDiskReserveBytes(100 * gibibyte)).toBe(
      RETICULUM_RESOURCE_MAX_FREE_DISK_BYTES
    );
    expect(getReticulumResourceFreeDiskReserveBytes(500 * gibibyte)).toBe(
      RETICULUM_RESOURCE_MAX_FREE_DISK_BYTES
    );
  });

  it('imports a local file as a verified assembled resource', () => {
    const { dir, store } = tempStore();
    stores.push(store);
    const sourcePath = path.join(dir, 'source.bin');
    const contents = Buffer.concat([
      Buffer.from('first range data'),
      Buffer.alloc(64, 7),
      Buffer.from('last range data'),
    ]);
    fs.writeFileSync(sourcePath, contents);

    const manifest = store.importLocalFile({
      sourcePath,
      namespace: 'test.feature',
      fileName: 'image.enc',
      mimeType: 'application/octet-stream',
      encrypted: true,
    });

    expect(manifest.namespace).toBe('test.feature');
    expect(manifest.encrypted).toBe(true);
    expect(manifest.fileHash).toBe(cryptoHash(contents));
    expect(store.getCompletedRanges(manifest.fileHash)).toEqual([]);

    const assembledPath = store.assembleResource(manifest.fileHash);
    expect(path.basename(assembledPath)).toBe('assembled.enc');
    expect(fs.readFileSync(assembledPath)).toEqual(contents);
    expect(store.getVerifiedAssembledPath(manifest.fileHash)).toBe(assembledPath);
  });

  it('imports and verifies a local file through the worker path', async () => {
    const { dir, store } = tempStore();
    stores.push(store);
    const sourcePath = path.join(dir, 'async-source.bin');
    const contents = Buffer.alloc(2 * 1024 * 1024, 23);
    fs.writeFileSync(sourcePath, contents);
    vi.spyOn((store as any).workerPool, 'run').mockImplementation(async (input: any) => {
      if (input.kind === 'hash_file') {
        return { id: 1, kind: input.kind, ok: true, hash: cryptoHash(contents), durationMs: 1 };
      }
      fs.mkdirSync(path.dirname(input.destinationPath), { recursive: true });
      fs.copyFileSync(input.sourcePath, input.destinationPath);
      return { id: 2, kind: input.kind, ok: true, hash: cryptoHash(contents), durationMs: 1 };
    });

    const manifest = await store.importLocalFileAsync({
      sourcePath,
      namespace: 'reticulum-group-resource',
      ownerId: '716:author',
      fileName: 'async-source.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
      metadata: { groupId: 716 },
    });

    expect(manifest.fileHash).toBe(cryptoHash(contents));
    const imported = fs.readFileSync(store.getVerifiedAssembledPath(manifest.fileHash)!);
    expect(imported.length).toBe(contents.length);
    expect(cryptoHash(imported)).toBe(cryptoHash(contents));
  });

  it('tracks peer serving separately from local attachment access', () => {
    const dir = tempDir();
    let now = 100_000;
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => now,
    });
    stores.push(store);
    const sourcePath = path.join(dir, 'served.bin');
    const contents = Buffer.from('served attachment bytes');
    fs.writeFileSync(sourcePath, contents);
    const manifest = store.importLocalFile({
      sourcePath,
      namespace: 'reticulum-group-resource',
      fileName: 'served.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
    });
    const rawDb = (store as unknown as { db: BetterSqliteDatabase }).db;
    now += 2 * 60_000;

    store.readByteRange(manifest.fileHash, 0, contents.length);

    const row = rawDb.prepare(`
      SELECT last_accessed_at, last_served_at
      FROM reticulum_resources WHERE file_hash = ?
    `).get(manifest.fileHash) as {
      last_accessed_at: number | null;
      last_served_at: number | null;
    };
    expect(row.last_accessed_at).toBeNull();
    expect(row.last_served_at).toBe(now);
  });

  it('keeps separate group references for the same file hash', () => {
    const { dir, store } = tempStore();
    stores.push(store);
    const sourcePath = path.join(dir, 'shared.bin');
    const contents = Buffer.from('same bytes posted in two groups');
    fs.writeFileSync(sourcePath, contents);

    const firstManifest = store.importLocalFile({
      sourcePath,
      namespace: 'reticulum-chat-file',
      ownerId: '81:sender',
      fileName: 'shared.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
      metadata: { groupId: 81, eventId: 'event-group-81' },
    });
    const secondManifest = store.importLocalFile({
      sourcePath,
      namespace: 'reticulum-chat-file',
      ownerId: '82:sender',
      fileName: 'shared-copy.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
      metadata: { groupId: 82, eventId: 'event-group-82' },
    });
    store.recordReference({
      manifest: firstManifest,
      scopeType: 'group',
      scopeId: 81,
      eventId: 'event-group-81',
      locallyAuthored: true,
    });
    store.recordReference({
      manifest: secondManifest,
      scopeType: 'group',
      scopeId: 82,
      eventId: 'event-group-82',
      locallyAuthored: true,
    });

    expect(store.getManifest(firstManifest.fileHash)?.fileHash).toBe(firstManifest.fileHash);
    expect(store.listReferences(firstManifest.fileHash)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileHash: firstManifest.fileHash,
          scopeType: 'group',
          scopeId: '81',
          eventId: 'event-group-81',
        }),
        expect.objectContaining({
          fileHash: firstManifest.fileHash,
          scopeType: 'group',
          scopeId: '82',
          eventId: 'event-group-82',
        }),
      ])
    );
    expect(
      store.getReferenceManifest(firstManifest.fileHash, 'group', 81, 'event-group-81')
        ?.metadata?.groupId
    ).toBe(81);
    expect(
      store.getReferenceManifest(firstManifest.fileHash, 'group', 82, 'event-group-82')
        ?.metadata?.groupId
    ).toBe(82);
    const assembledPath = store.assembleResource(firstManifest.fileHash);
    expect(path.basename(assembledPath)).toBe('shared.bin');
    expect(fs.readFileSync(assembledPath)).toEqual(contents);
    expect(
      fs.existsSync(
        path.join(
          dir,
          'resources',
          'blobs',
          firstManifest.fileHash,
          'assembled',
          'shared-copy.bin'
        )
      )
    ).toBe(false);
  });

  it('does not partially register a group reference when its supplied manifest hash differs', () => {
    const { store } = tempStore();
    stores.push(store);
    const fileHash = cryptoHash(Buffer.from('expected-reference-file'));
    const mismatchedManifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'wrong.webp',
      mimeType: 'image/webp',
      sizeBytes: 10,
      fileHash: cryptoHash(Buffer.from('different-reference-file')),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 1144 },
    };

    expect(() =>
      store.recordGroupReference({
        fileHash,
        groupId: 1144,
        eventId: 'calendar:event-a',
        manifest: mismatchedManifest,
      })
    ).toThrow(/manifest hash mismatch/);
    expect(store.listGroupReferences(fileHash)).toEqual([]);
  });

  it('rejects conflicting physical metadata for the same content hash', () => {
    const { store } = tempStore();
    stores.push(store);
    const contents = Buffer.from('manifest identity');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'manifest.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
    };
    store.storeManifest(manifest);

    expect(() =>
      store.storeManifest({ ...manifest, sizeBytes: manifest.sizeBytes + 1 })
    ).toThrow(/size conflicts/);
    expect(() =>
      store.storeManifest({ ...manifest, encrypted: true })
    ).toThrow(/encryption conflicts/);
  });

  it('keeps cleanup bookkeeping idempotent across repeated resource updates', () => {
    const { store } = tempStore();
    stores.push(store);
    const contents = Buffer.from('repeat resource request');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:remote',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 716 },
    };

    store.storeManifest(manifest, { provenance: 'remote_downloaded' });
    expect(() =>
      store.storeManifest(manifest, { provenance: 'remote_downloaded' })
    ).not.toThrow();

    const reference = {
      manifest,
      scopeType: 'group' as const,
      scopeId: 716,
      eventId: 'event-repeat-resource',
    };
    store.recordReference(reference);
    expect(() => store.recordReference(reference)).not.toThrow();

    store.acquireLease(manifest.fileHash, 'viewer');
    expect(() => store.acquireLease(manifest.fileHash, 'viewer')).not.toThrow();

    const receipt = {
      fileHash: manifest.fileHash,
      providerId: 'provider-a',
      scopeType: 'group' as const,
      scopeId: 716,
      retentionUntil: 200_000,
    };
    store.recordProviderReceipt(receipt);
    expect(() => store.recordProviderReceipt(receipt)).not.toThrow();
  });

  it('reinstalls corrected cleanup triggers when an existing store reopens', () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'resources.db');
    const rootDir = path.join(dir, 'resources');
    const first = new ReticulumResourceStore({ dbPath, rootDir, now: () => 100_000 });
    const contents = Buffer.from('existing resource database');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'existing.webp',
      mimeType: 'image/webp',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
    };
    first.storeManifest(manifest, { provenance: 'remote_downloaded' });
    const rawDb = (first as unknown as { db: BetterSqliteDatabase }).db;
    rawDb.exec(`
      DROP TRIGGER trg_reticulum_resource_dirty_update;
      CREATE TRIGGER trg_reticulum_resource_dirty_update
      AFTER UPDATE OF updated_at ON reticulum_resources
      BEGIN
        INSERT OR IGNORE INTO reticulum_resource_cleanup_dirty(file_hash)
        VALUES (NEW.file_hash);
      END;
      UPDATE reticulum_resource_meta SET value = '1' WHERE key = 'schema_version';
    `);
    first.close();

    const reopened = new ReticulumResourceStore({ dbPath, rootDir, now: () => 100_000 });
    stores.push(reopened);

    expect(() =>
      reopened.storeManifest(manifest, { provenance: 'remote_downloaded' })
    ).not.toThrow();
  });

  it('does not trust manifest metadata as a live chat reference', () => {
    const { store } = tempStore();
    stores.push(store);
    const contents = Buffer.from('untrusted manifest reference');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:sender',
      fileName: 'untrusted.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 716, eventId: 'unvalidated-event' },
    };

    store.storeManifest(manifest);

    expect(store.hasLiveReference(manifest.fileHash, 'group', 716)).toBe(false);
    expect(store.listReferences(manifest.fileHash)).toEqual([]);
  });

  it('enforces the authored pool when reusing an existing remote blob', () => {
    const dir = tempDir();
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => 100_000,
      policy: {
        limitBytes: RETICULUM_RESOURCE_MIN_LIMIT_BYTES,
        authoredCapRatio: 0.2,
      },
    });
    stores.push(store);
    const remotePath = path.join(dir, 'remote.bin');
    const authoredPath = path.join(dir, 'authored.bin');
    fs.writeFileSync(remotePath, Buffer.from('existing remote bytes'));
    fs.writeFileSync(authoredPath, Buffer.from('authored pool seed'));
    const remoteManifest = store.importLocalFile({
      sourcePath: remotePath,
      namespace: 'reticulum-group-resource',
      fileName: 'remote.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
    });
    const authoredManifest = store.importLocalFile({
      sourcePath: authoredPath,
      namespace: 'reticulum-group-resource',
      fileName: 'authored.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
    });
    const rawDb = (store as unknown as { db: BetterSqliteDatabase }).db;
    rawDb.prepare(`
      UPDATE reticulum_resources SET provenance = 'remote_downloaded'
      WHERE file_hash = ?
    `).run(remoteManifest.fileHash);
    const authoredCap = Math.floor(RETICULUM_RESOURCE_MIN_LIMIT_BYTES * 0.2);
    rawDb.prepare(`
      UPDATE reticulum_resources SET resident_bytes = ? WHERE file_hash = ?
    `).run(
      authoredCap - remoteManifest.sizeBytes + 1,
      authoredManifest.fileHash
    );

    expect(() =>
      store.importLocalFile({
        sourcePath: remotePath,
        namespace: 'reticulum-group-resource',
        fileName: 'remote.bin',
        mimeType: 'application/octet-stream',
        encrypted: false,
      })
    ).toThrow(/reserved for authored files is full/);
  });

  it('shrinks active transfer reservations as bytes arrive', () => {
    const { store } = tempStore();
    stores.push(store);
    const reservationId = store.reserveCapacity({
      sizeBytes: 100,
      provenance: 'remote_downloaded',
    });
    expect(store.getStorageStatus().reservedBytes).toBe(100);

    expect(store.updateReservation(reservationId, 35)).toBe(true);
    expect(store.getStorageStatus().reservedBytes).toBe(35);
  });

  it('treats the configured limit as soft for incoming downloads', () => {
    const { store } = tempStore();
    stores.push(store);
    store.setStoragePolicy({ limitBytes: 512 * 1024 * 1024 });
    const existingSize = 500 * 1024 * 1024;
    const incomingSize = 100 * 1024 * 1024;
    const existingManifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'existing-remote.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: existingSize,
      fileHash: cryptoHash(Buffer.from('existing remote cache for soft limit')),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 716 },
    };
    store.storeManifest(existingManifest, {
      provenance: 'remote_downloaded',
      residentBytes: existingSize,
    });

    expect(() =>
      store.reserveCapacity({
        provenance: 'remote_downloaded',
        sizeBytes: incomingSize,
      })
    ).not.toThrow();
    expect(store.getStorageStatus().reservedBytes).toBe(incomingSize);
  });

  it('does not immediately evict a download completed above the soft limit', async () => {
    const dir = tempDir();
    let now = 100_000;
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => now,
      policy: { limitBytes: 512 * 1024 * 1024 },
    });
    stores.push(store);
    const existingSize = 512 * 1024 * 1024;
    const existingManifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'old-cache.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: existingSize,
      fileHash: cryptoHash(Buffer.from('old cache entry for download grace')),
      encrypted: false,
      createdAt: now - 60_000,
      metadata: { groupId: 716 },
    };
    store.storeManifest(existingManifest, {
      provenance: 'remote_downloaded',
      residentBytes: existingSize,
    });
    const contents = Buffer.from('newly downloaded attachment');
    const downloadedManifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'downloaded.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: now,
      metadata: { groupId: 716 },
    };
    store.storeManifest(downloadedManifest, { provenance: 'remote_downloaded' });
    store.storeByteRange(downloadedManifest.fileHash, 0, contents.length, contents);
    store.assembleResource(downloadedManifest.fileHash);

    await store.cleanupStorage('completed-download-grace');

    expect(store.getVerifiedAssembledPath(downloadedManifest.fileHash)).toBeTruthy();
    expect(store.getStorageStatus().totalResidentBytes).toBe(contents.length);
    now += 30 * 60_000 + 1;
    await store.cleanupStorage('completed-download-grace-expired');
    expect(store.getVerifiedAssembledPath(downloadedManifest.fileHash)).toBe(null);
  });

  it('preserves transfer-reserved capacity when admitting local attachments', () => {
    const { dir, store } = tempStore();
    stores.push(store);
    store.setStoragePolicy({ limitBytes: 512 * 1024 * 1024 });
    store.reserveCapacity({
      provenance: 'remote_downloaded',
      sizeBytes: 450 * 1024 * 1024,
    });
    const sourcePath = path.join(dir, 'local.bin');
    fs.writeFileSync(sourcePath, Buffer.from('local attachment'));

    expect(() =>
      store.importLocalFile({
        sourcePath,
        namespace: 'reticulum-group-resource',
        fileName: 'local.bin',
        mimeType: 'application/octet-stream',
        encrypted: false,
        metadata: { groupId: 716 },
      })
    ).toThrow(/preserving capacity for incoming downloads/);
    expect(store.getStorageStatus().blockedAuthoredPublishes).toBe(1);
  });

  it('treats the hard quota as authoritative over the remote cache floor', async () => {
    const { store } = tempStore();
    stores.push(store);
    store.setStoragePolicy({ limitBytes: 512 * 1024 * 1024 });
    const remoteSize = 550 * 1024 * 1024;
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'oversized-remote.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: remoteSize,
      fileHash: cryptoHash(Buffer.from('oversized-remote-cache')),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 716 },
    };
    store.storeManifest(manifest, {
      provenance: 'remote_downloaded',
      residentBytes: remoteSize,
    });
    store.recordGroupReference({
      fileHash: manifest.fileHash,
      groupId: 716,
      eventId: 'event-oversized-remote',
    });

    const result = await store.cleanupStorage('hard-quota');

    expect(result.freedBytes).toBe(remoteSize);
    expect(store.getStorageStatus().totalResidentBytes).toBe(0);
    expect(store.hasLiveReference(manifest.fileHash, 'group', 716)).toBe(true);
  });

  it('tracks direct-message references independently from the physical blob', () => {
    const { dir, store } = tempStore();
    stores.push(store);
    const sourcePath = path.join(dir, 'direct.bin');
    fs.writeFileSync(sourcePath, Buffer.from('direct attachment'));
    const manifest = store.importLocalFile({
      sourcePath,
      namespace: 'reticulum-dm-resource',
      ownerId: 'dm:conversation-a:sender',
      fileName: 'direct.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
      metadata: { conversationId: 'conversation-a' },
    });

    store.recordDirectReference({
      manifest,
      conversationId: 'conversation-a',
      eventId: 'event-direct-a',
      locallyAuthored: true,
    });

    expect(
      store.hasLiveReference(manifest.fileHash, 'dm', 'conversation-a', 'event-direct-a')
    ).toBe(true);
    expect(store.listReferences(manifest.fileHash)).toEqual([
      expect.objectContaining({
        scopeType: 'dm',
        scopeId: 'conversation-a',
        eventId: 'event-direct-a',
        locallyAuthored: true,
        state: 'live',
      }),
    ]);
  });

  it('stores received byte ranges and assembles after final file hash verification', () => {
    const { store } = tempStore();
    stores.push(store);
    const first = Buffer.from('a'.repeat(16 * 1024));
    const second = Buffer.from('second');
    const contents = Buffer.concat([first, second]);
    const manifest: ReticulumResourceManifest = {
      namespace: 'test.feature',
      fileName: 'payload.enc',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: true,
      createdAt: 100_000,
    };

    store.storeManifest(manifest);
    const partialPath = store.ensurePartialFile(manifest.fileHash);
    expect(fs.statSync(partialPath).size).toBe(0);
    expect(store.getManifest(manifest.fileHash)?.fileHash).toBe(manifest.fileHash);
    expect(() => store.assembleResource(manifest.fileHash)).toThrow(/missing byte ranges/);

    store.storeByteRange(manifest.fileHash, first.length, contents.length, second);
    expect(store.getCompletedBytes(manifest.fileHash)).toBe(second.length);
    expect(() => store.assembleResource(manifest.fileHash)).toThrow(/missing byte ranges/);

    store.storeByteRange(manifest.fileHash, 0, first.length, first);
    const assembledPath = store.assembleResource(manifest.fileHash);
    expect(fs.readFileSync(assembledPath)).toEqual(contents);
  });

  it('updates completed-byte accounting incrementally without range-state rewrites', () => {
    const { dir, store } = tempStore();
    stores.push(store);
    const first = Buffer.alloc(1024 * 1024, 1);
    const second = Buffer.alloc(1024 * 1024, 2);
    const third = Buffer.alloc(1024 * 1024, 3);
    const contents = Buffer.concat([first, second, third]);
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'incremental.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 716 },
    };
    store.storeManifest(manifest, { provenance: 'remote_downloaded' });

    store.storeByteRange(manifest.fileHash, 0, first.length, first);
    expect(store.getCompletedBytes(manifest.fileHash)).toBe(first.length);
    store.storeByteRange(
      manifest.fileHash,
      first.length + second.length,
      contents.length,
      third
    );
    expect(store.getCompletedBytes(manifest.fileHash)).toBe(first.length + third.length);
    store.storeByteRange(manifest.fileHash, first.length, first.length + second.length, second);
    expect(store.getCompletedBytes(manifest.fileHash)).toBe(contents.length);
    expect(store.getCompletedRanges(manifest.fileHash)).toEqual([
      expect.objectContaining({ startByte: 0, endByteExclusive: contents.length }),
    ]);

    store.storeByteRange(manifest.fileHash, first.length, first.length + second.length, second);
    expect(store.getCompletedBytes(manifest.fileHash)).toBe(contents.length);
    expect(
      fs.existsSync(path.join(dir, 'resources', 'blobs', manifest.fileHash, 'ranges.json'))
    ).toBe(false);
  });

  it('removes obsolete partial bytes when the same resource is imported locally', () => {
    const { dir, store } = tempStore();
    stores.push(store);
    const contents = Buffer.from('complete local copy replaces partial download');
    const sourcePath = path.join(dir, 'complete.bin');
    fs.writeFileSync(sourcePath, contents);
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'complete.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
    };
    store.storeManifest(manifest);
    store.storeByteRange(manifest.fileHash, 0, 8, contents.subarray(0, 8));
    const partialPath = store.getPartialPath(manifest.fileHash);
    expect(partialPath).toBeTruthy();
    expect(fs.existsSync(partialPath!)).toBe(true);

    store.importLocalFile({
      sourcePath,
      namespace: manifest.namespace,
      fileName: manifest.fileName,
      mimeType: manifest.mimeType,
      encrypted: manifest.encrypted,
    });

    expect(store.getPartialPath(manifest.fileHash)).toBeNull();
    expect(store.getCompletedRanges(manifest.fileHash)).toEqual([]);
    expect(fs.existsSync(partialPath!)).toBe(false);
    expect(fs.readFileSync(store.getVerifiedAssembledPath(manifest.fileHash)!)).toEqual(contents);
  });

  it('rejects invalid received byte ranges before writing to the partial file', () => {
    const { store } = tempStore();
    stores.push(store);
    const contents = Buffer.from('valid bytes');
    const manifest: ReticulumResourceManifest = {
      namespace: 'test.feature',
      fileName: 'payload.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
    };

    store.storeManifest(manifest);
    expect(() => store.storeByteRange(manifest.fileHash, 0, 5, Buffer.from('no'))).toThrow(
      /Range size mismatch/
    );
    expect(() =>
      store.storeByteRange(manifest.fileHash, 0, contents.length + 1, Buffer.alloc(contents.length + 1))
    ).toThrow(/Invalid byte range/);
    expect(store.getCompletedRanges(manifest.fileHash)).toEqual([]);
  });

  it('reuses an existing assembled resource instead of rebuilding it', () => {
    const { dir, store } = tempStore();
    stores.push(store);
    const sourcePath = path.join(dir, 'source.bin');
    const contents = Buffer.from('reuse assembled bytes');
    fs.writeFileSync(sourcePath, contents);

    const manifest = store.importLocalFile({
      sourcePath,
      namespace: 'test.feature',
      fileName: 'reuse.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
    });

    const assembledPath = store.assembleResource(manifest.fileHash);
    const oldTime = new Date(10_000);
    fs.utimesSync(assembledPath, oldTime, oldTime);

    expect(store.getVerifiedAssembledPath(manifest.fileHash)).toBe(assembledPath);
    expect(store.assembleResource(manifest.fileHash)).toBe(assembledPath);
    expect(fs.readFileSync(assembledPath)).toEqual(contents);
    expect(fs.statSync(assembledPath).mtimeMs).toBe(10_000);
  });

  it('does not report a verified assembled path when the verified file is missing', () => {
    const { dir, store } = tempStore();
    stores.push(store);
    const sourcePath = path.join(dir, 'source.bin');
    const contents = Buffer.from('missing assembled path');
    fs.writeFileSync(sourcePath, contents);

    const manifest = store.importLocalFile({
      sourcePath,
      namespace: 'test.feature',
      fileName: 'missing.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
    });
    const assembledPath = store.getVerifiedAssembledPath(manifest.fileHash);
    expect(assembledPath).toBeTruthy();

    fs.rmSync(assembledPath!, { force: true });

    expect(store.getVerifiedAssembledPath(manifest.fileHash)).toBe(null);
    expect(() => store.assembleResource(manifest.fileHash)).toThrow(/partial file/);
  });

  it('reconciles missing resident bytes when the store reopens', async () => {
    const { dir, store } = tempStore();
    const sourcePath = path.join(dir, 'restart-source.bin');
    fs.writeFileSync(sourcePath, Buffer.from('restart reconciliation'));
    const manifest = store.importLocalFile({
      sourcePath,
      namespace: 'reticulum-group-resource',
      ownerId: '716:author',
      fileName: 'restart-source.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
    });
    const assembledPath = store.getVerifiedAssembledPath(manifest.fileHash);
    expect(assembledPath).toBeTruthy();
    store.close();
    fs.rmSync(assembledPath!, { force: true });

    const reopened = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => 100_000,
    });
    stores.push(reopened);

    expect(reopened.getVerifiedAssembledPath(manifest.fileHash)).toBe(null);
    await vi.waitFor(() => {
      expect(reopened.getStorageStatus().totalResidentBytes).toBe(0);
    });
    expect(reopened.getManifest(manifest.fileHash)).toBeTruthy();
  });

  it('recovers a verified assembled file left before the completion transaction', async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'resources.db');
    const rootDir = path.join(dir, 'resources');
    const contents = Buffer.from('crash-safe completed resource');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'crash-safe.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 716 },
    };
    const first = new ReticulumResourceStore({ dbPath, rootDir, now: () => 100_000 });
    first.storeManifest(manifest, { provenance: 'remote_downloaded' });
    first.recordReference({
      manifest,
      scopeType: 'group',
      scopeId: 716,
      eventId: 'crash-safe-event',
    });
    first.close();
    const assembledPath = path.join(
      rootDir,
      'blobs',
      manifest.fileHash,
      'assembled',
      manifest.fileName
    );
    fs.mkdirSync(path.dirname(assembledPath), { recursive: true });
    fs.writeFileSync(assembledPath, contents);

    const reopened = new ReticulumResourceStore({ dbPath, rootDir, now: () => 100_000 });
    stores.push(reopened);

    await vi.waitFor(() => {
      expect(reopened.getVerifiedAssembledPath(manifest.fileHash)).toBe(assembledPath);
      expect(reopened.getStorageStatus().totalResidentBytes).toBe(contents.length);
    });
  });

  it('assembles public resources to the original safe filename', () => {
    const { dir, store } = tempStore();
    stores.push(store);
    const sourcePath = path.join(dir, 'public-image.png');
    const contents = Buffer.from('public image bytes');
    fs.writeFileSync(sourcePath, contents);

    const manifest = store.importLocalFile({
      sourcePath,
      namespace: 'test.public',
      fileName: 'public-image.png',
      mimeType: 'image/png',
      encrypted: false,
    });

    const assembledPath = store.assembleResource(manifest.fileHash);
    expect(path.basename(assembledPath)).toBe('public-image.png');
    expect(path.basename(path.dirname(assembledPath))).toBe('assembled');
    expect(fs.readFileSync(assembledPath)).toEqual(contents);
  });

  it('creates the plaintext temp directory before returning a temp path', () => {
    const dir = tempDir();
    const tempRoot = path.join(dir, 'missing-temp-root');
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      tempDir: tempRoot,
      now: () => 100_000,
    });
    stores.push(store);
    const tempPath = store.createPlaintextTempPath(cryptoHash(Buffer.from('resource')), '.range.bin');

    expect(path.dirname(tempPath)).toBe(path.join(tempRoot, 'qortal-reticulum-resources'));
    fs.writeFileSync(tempPath, Buffer.from('ok'));
    expect(fs.readFileSync(tempPath, 'utf8')).toBe('ok');
  });

  it('discards downloaded byte ranges while keeping the manifest retryable', async () => {
    const { store } = tempStore();
    stores.push(store);
    const first = Buffer.from('a'.repeat(16 * 1024));
    const second = Buffer.from('b'.repeat(16 * 1024));
    const contents = Buffer.concat([first, second]);
    const manifest: ReticulumResourceManifest = {
      namespace: 'test.feature',
      fileName: 'payload.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
    };

    store.storeManifest(manifest);
    store.storeByteRange(manifest.fileHash, 0, first.length, first);
    const partialPath = store.getPartialPath(manifest.fileHash);
    expect(partialPath && fs.existsSync(partialPath)).toBe(true);

    await store.discardResourceDataAsync(manifest.fileHash);

    expect(store.getManifest(manifest.fileHash)?.fileHash).toBe(manifest.fileHash);
    expect(store.getCompletedRanges(manifest.fileHash)).toEqual([]);
    expect(partialPath && fs.existsSync(partialPath)).toBe(false);
  });

  it('keeps live authored attachments after temporary provider receipts expire', async () => {
    const { dir, store } = tempStore();
    stores.push(store);
    const sourcePath = path.join(dir, 'authored.bin');
    fs.writeFileSync(sourcePath, Buffer.from('authored attachment'));
    const manifest = store.importLocalFile({
      sourcePath,
      namespace: 'reticulum-group-resource',
      ownerId: '716:author',
      fileName: 'authored.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
      metadata: { groupId: 716 },
    });
    store.recordGroupReference({
      fileHash: manifest.fileHash,
      groupId: 716,
      eventId: 'event-authored-live',
      ownerId: manifest.ownerId,
    });
    store.recordProviderReceipt({
      fileHash: manifest.fileHash,
      providerId: 'temporary-provider',
      scopeType: 'group',
      scopeId: 716,
      retentionUntil: 200_000,
    });
    (store as any).physicalReclaimBytes = 1;

    const result = await store.cleanupStorage('test');

    expect(result.freedBytes).toBe(0);
    expect(store.getVerifiedAssembledPath(manifest.fileHash)).toBeTruthy();
    expect(store.getStorageStatus()).toMatchObject({
      protectedBytes: Buffer.byteLength('authored attachment'),
      evictableBytes: 0,
    });
  });

  it('serializes physical disk reservations across concurrent downloads', async () => {
    const { store } = tempStore();
    stores.push(store);
    vi.spyOn(store as any, 'getPhysicalDiskSpace').mockReturnValue({
      availableBytes: RETICULUM_RESOURCE_MIN_FREE_DISK_BYTES + 100,
      reserveBytes: RETICULUM_RESOURCE_MIN_FREE_DISK_BYTES,
    });
    vi.spyOn(store, 'cleanupStorage').mockResolvedValue({
      startedAt: 100_000,
      completedAt: 100_000,
      beforeBytes: 0,
      afterBytes: 0,
      freedBytes: 0,
      evictedBlobs: 0,
      reason: 'test',
    });

    const releaseFirst = await (store as any).reservePhysicalDisk(80);
    await expect((store as any).reservePhysicalDisk(30)).rejects.toThrow(
      /Insufficient physical disk space/
    );
    releaseFirst(false);

    const releaseAfterCapacityReturns = await (store as any).reservePhysicalDisk(30);
    releaseAfterCapacityReturns(false);
  });

  it('reclaims the full physical reserve deficit before admitting a write', async () => {
    const { store } = tempStore();
    stores.push(store);
    let availableBytes = 500;
    const reserveBytes = 1_000;
    vi.spyOn(store as any, 'getPhysicalDiskSpace').mockImplementation(() => ({
      availableBytes,
      reserveBytes,
    }));
    const reclaimTargets: number[] = [];
    vi.spyOn(store, 'cleanupStorage').mockImplementation(async (reason) => {
      const reclaimed = Number((store as any).physicalReclaimBytes || 0);
      reclaimTargets.push(reclaimed);
      availableBytes += reclaimed;
      return {
        startedAt: 100_000,
        completedAt: 100_000,
        beforeBytes: reclaimed,
        afterBytes: 0,
        freedBytes: reclaimed,
        evictedBlobs: reclaimed > 0 ? 1 : 0,
        reason,
      };
    });

    const release = await (store as any).reservePhysicalDisk(100);

    expect(reclaimTargets).toEqual([600]);
    release(false);
  });

  it('includes pending writes in the full physical reclaim target', () => {
    const { store } = tempStore();
    stores.push(store);
    vi.spyOn(store as any, 'getPhysicalDiskSpace').mockReturnValue({
      availableBytes: 100,
      reserveBytes: 1_000,
    });
    (store as any).pendingPhysicalWriteBytes = 200;

    expect((store as any).getPhysicalWriteCapacity(10)).toEqual({
      writableBytes: 0,
      reclaimBytes: 1_110,
      reserveBytes: 1_000,
    });
  });

  it('protects worker assembly from cleanup for the full operation', async () => {
    const { store } = tempStore();
    stores.push(store);
    const contents = Buffer.from('assembly protected from cleanup');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'assembly.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 716 },
    };
    store.storeManifest(manifest, { provenance: 'remote_downloaded' });
    store.recordReference({
      manifest,
      scopeType: 'group',
      scopeId: 716,
      eventId: 'assembly-event',
    });
    store.storeByteRange(manifest.fileHash, 0, contents.length, contents);

    let continueAssembly!: () => void;
    const assemblyGate = new Promise<void>((resolve) => {
      continueAssembly = resolve;
    });
    vi.spyOn((store as any).workerPool, 'run').mockImplementation(async (input: any) => {
      if (input.kind !== 'finalize_resource') {
        throw new Error(`Unexpected worker task ${input.kind}`);
      }
      await assemblyGate;
      fs.mkdirSync(path.dirname(input.destinationPath), { recursive: true });
      fs.renameSync(input.sourcePath, input.destinationPath);
      return {
        id: 1,
        kind: input.kind,
        ok: true,
        hash: manifest.fileHash,
        durationMs: 1,
      };
    });

    const assembly = store.assembleResourceAsync(manifest.fileHash);
    await new Promise<void>((resolve) => setImmediate(resolve));
    (store as any).physicalReclaimBytes = 1;
    expect((await store.cleanupStorage('during-assembly')).freedBytes).toBe(0);
    expect(store.getCompletedRanges(manifest.fileHash)).not.toEqual([]);
    (store as any).physicalReclaimBytes = 0;

    continueAssembly();
    await expect(assembly).resolves.toBeTruthy();
  });

  it('runs resource discard asynchronously while keeping the manifest retryable', async () => {
    const { store } = tempStore();
    stores.push(store);
    const contents = Buffer.from('async discarded resource');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'discard.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
    };
    store.storeManifest(manifest);
    store.storeByteRange(manifest.fileHash, 0, contents.length, contents);

    await store.discardResourceDataAsync(manifest.fileHash);

    expect(store.getManifest(manifest.fileHash)).toBeTruthy();
    expect(store.getCompletedRanges(manifest.fileHash)).toEqual([]);
    expect(store.getStorageStatus().totalResidentBytes).toBe(0);
  });

  it('does not rebuild maintained storage accounting on every startup', () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'resources.db');
    const rootDir = path.join(dir, 'resources');
    const first = new ReticulumResourceStore({ dbPath, rootDir, now: () => 100_000 });
    expect((first as any).getResourceMeta('schema_version')).toBe('2');
    expect((first as any).getResourceMeta('accounting_version')).toBe('2');
    first.close();
    const rebuild = vi.spyOn(
      ReticulumResourceStore.prototype as any,
      'rebuildStorageAccounting'
    );

    const reopened = new ReticulumResourceStore({ dbPath, rootDir, now: () => 100_000 });
    stores.push(reopened);

    expect(rebuild).not.toHaveBeenCalled();
    rebuild.mockRestore();
  });

  it('creates legacy-column indexes only after their columns are ensured', () => {
    const dir = tempDir();
    const calls: string[] = [];
    const prototype = ReticulumResourceStore.prototype as any;
    const originalEnsureResourceColumn = prototype.ensureResourceColumn;
    const originalEnsureReferenceColumn = prototype.ensureReferenceColumn;
    const originalCreatePostMigrationIndexes = prototype.createPostMigrationIndexes;
    const resourceColumnSpy = vi
      .spyOn(prototype, 'ensureResourceColumn')
      .mockImplementation(function (
        this: ReticulumResourceStore,
        name: string,
        definition: string
      ) {
        calls.push(`resource:${name}`);
        return originalEnsureResourceColumn.call(this, name, definition);
      });
    const referenceColumnSpy = vi
      .spyOn(prototype, 'ensureReferenceColumn')
      .mockImplementation(function (
        this: ReticulumResourceStore,
        name: string,
        definition: string
      ) {
        calls.push(`reference:${name}`);
        return originalEnsureReferenceColumn.call(this, name, definition);
      });
    const indexesSpy = vi
      .spyOn(prototype, 'createPostMigrationIndexes')
      .mockImplementation(function (this: ReticulumResourceStore) {
        calls.push('indexes');
        return originalCreatePostMigrationIndexes.call(this);
      });

    try {
      const store = new ReticulumResourceStore({
        dbPath: path.join(dir, 'resources.db'),
        rootDir: path.join(dir, 'resources'),
        now: () => 100_000,
      });
      stores.push(store);

      expect(calls.indexOf('resource:managed')).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf('reference:expires_at')).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf('indexes')).toBeGreaterThan(calls.indexOf('resource:managed'));
      expect(calls.indexOf('indexes')).toBeGreaterThan(calls.indexOf('reference:expires_at'));
    } finally {
      resourceColumnSpy.mockRestore();
      referenceColumnSpy.mockRestore();
      indexesSpy.mockRestore();
    }
  });

  it('does not resurrect deleted or expired references from duplicate manifests', () => {
    const { store } = tempStore();
    stores.push(store);
    const contents = Buffer.from('terminal reference state');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:sender',
      fileName: 'terminal.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 716 },
    };
    store.storeManifest(manifest);
    store.recordReference({
      manifest,
      scopeType: 'group',
      scopeId: 716,
      eventId: 'deleted-event',
    });
    store.setReferenceState({
      scopeType: 'group',
      scopeId: 716,
      eventId: 'deleted-event',
      state: 'deleted',
    });
    store.recordReference({
      manifest,
      scopeType: 'group',
      scopeId: 716,
      eventId: 'deleted-event',
    });
    store.recordReference({
      manifest,
      scopeType: 'group',
      scopeId: 716,
      eventId: 'expired-event',
    });
    store.setReferenceState({
      scopeType: 'group',
      scopeId: 716,
      eventId: 'expired-event',
      state: 'expired',
    });
    store.recordReference({
      manifest,
      scopeType: 'group',
      scopeId: 716,
      eventId: 'expired-event',
    });

    expect(store.listReferences(manifest.fileHash)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: 'deleted-event', state: 'deleted' }),
        expect.objectContaining({ eventId: 'expired-event', state: 'expired' }),
      ])
    );
  });

  it('keeps the earliest resource reference expiry', () => {
    const { store } = tempStore();
    stores.push(store);
    const contents = Buffer.from('expiring reference');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:sender',
      fileName: 'expiring.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 716 },
    };
    store.storeManifest(manifest);
    for (const expiresAt of [200_000, 300_000, 150_000]) {
      store.recordReference({
        manifest,
        scopeType: 'group',
        scopeId: 716,
        eventId: 'expiring-event',
        expiresAt,
      });
    }

    expect(store.listReferences(manifest.fileHash)[0]?.expiresAt).toBe(150_000);
  });

  it('replaces a resource reference expiry when channel policy changes', () => {
    const { store } = tempStore();
    stores.push(store);
    const firstExpiry = 200_000;
    const laterExpiry = firstExpiry + 100_000;
    const contents = Buffer.from('pending expiry reference');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:sender',
      fileName: 'pending-expiry.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 716 },
    };
    store.storeManifest(manifest);
    store.recordReference({
      manifest,
      scopeType: 'group',
      scopeId: 716,
      eventId: 'pending-expiry-event',
    });

    expect(
      store.setReferenceExpiry({
        scopeType: 'group',
        scopeId: 716,
        eventId: 'pending-expiry-event',
        expiresAt: firstExpiry,
      })
    ).toBe(1);
    expect(store.listReferences(manifest.fileHash)[0]?.expiresAt).toBe(firstExpiry);

    store.setReferenceExpiry({
      scopeType: 'group',
      scopeId: 716,
      eventId: 'pending-expiry-event',
      expiresAt: laterExpiry,
    });
    expect(store.listReferences(manifest.fileHash)[0]?.expiresAt).toBe(laterExpiry);

    store.setReferenceExpiry({
      scopeType: 'group',
      scopeId: 716,
      eventId: 'pending-expiry-event',
      expiresAt: null,
    });
    expect(store.listReferences(manifest.fileHash)[0]?.expiresAt).toBeUndefined();
  });

  it('evicts bytes after the last message reference is deleted but keeps the manifest', async () => {
    const { dir, store } = tempStore();
    stores.push(store);
    const sourcePath = path.join(dir, 'deleted.bin');
    const contents = Buffer.from('deleted attachment bytes');
    fs.writeFileSync(sourcePath, contents);
    const manifest = store.importLocalFile({
      sourcePath,
      namespace: 'reticulum-group-resource',
      ownerId: '716:author',
      fileName: 'deleted.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
      metadata: { groupId: 716 },
    });
    store.recordGroupReference({
      fileHash: manifest.fileHash,
      groupId: 716,
      eventId: 'event-deleted-resource',
    });
    store.setReferenceState({
      scopeType: 'group',
      scopeId: 716,
      eventId: 'event-deleted-resource',
      state: 'deleted',
    });

    const result = await store.cleanupStorage('test');

    expect(result.freedBytes).toBe(contents.length);
    expect(store.getVerifiedAssembledPath(manifest.fileHash)).toBe(null);
    expect(store.getManifest(manifest.fileHash)?.fileHash).toBe(manifest.fileHash);
    expect(store.listReferences(manifest.fileHash)[0]?.state).toBe('deleted');
  });

  it('evicts bytes after the last message reference expires', async () => {
    const dir = tempDir();
    let now = 100_000;
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => now,
    });
    stores.push(store);
    const sourcePath = path.join(dir, 'expiring.bin');
    const contents = Buffer.from('expiring attachment bytes');
    fs.writeFileSync(sourcePath, contents);
    const manifest = store.importLocalFile({
      sourcePath,
      namespace: 'reticulum-group-resource',
      ownerId: '716:author',
      fileName: 'expiring.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
      metadata: { groupId: 716 },
    });
    store.recordGroupReference({
      fileHash: manifest.fileHash,
      groupId: 716,
      eventId: 'event-expiring-resource',
      expiresAt: now + 1_000,
    });

    now += 2_000;
    expect(
      store.hasLiveReference(
        manifest.fileHash,
        'group',
        716,
        'event-expiring-resource'
      )
    ).toBe(false);
    expect(
      store.getReferenceManifest(
        manifest.fileHash,
        'group',
        716,
        'event-expiring-resource'
      )
    ).toBe(null);
    const result = await store.cleanupStorage('expired-reference');

    expect(result.freedBytes).toBe(contents.length);
    expect(store.listReferences(manifest.fileHash)[0]?.state).toBe('expired');
    expect(store.getManifest(manifest.fileHash)).toBeTruthy();
  });

  it('protects an evictable resource while an active lease exists', async () => {
    const dir = tempDir();
    let now = 100_000;
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => now,
    });
    stores.push(store);
    const contents = Buffer.from('downloaded attachment');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:remote',
      fileName: 'remote.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 716 },
    };
    store.storeManifest(manifest, { provenance: 'remote_downloaded' });
    store.storeByteRange(manifest.fileHash, 0, contents.length, contents);
    store.assembleResource(manifest.fileHash);
    const leaseId = store.acquireLease(manifest.fileHash, 'viewer', 60 * 60_000);
    now += 30 * 60_000 + 1;
    (store as any).physicalReclaimBytes = 1;

    expect((await store.cleanupStorage('test')).freedBytes).toBe(0);
    expect(store.getVerifiedAssembledPath(manifest.fileHash)).toBeTruthy();

    store.releaseLease(leaseId);
    expect((await store.cleanupStorage('test-after-release')).freedBytes).toBe(contents.length);
    expect(store.getManifest(manifest.fileHash)).toBeTruthy();
  });

  it('allows physical disk pressure to reclaim retained remote cache bytes', async () => {
    const { store } = tempStore();
    stores.push(store);
    const contents = Buffer.from('retained remote attachment');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:remote',
      fileName: 'retained.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 716 },
    };
    store.storeManifest(manifest, { provenance: 'remote_downloaded' });
    store.recordReference({
      manifest,
      scopeType: 'group',
      scopeId: 716,
      eventId: 'event-retained-remote',
      locallyAuthored: false,
    });
    store.storeByteRange(manifest.fileHash, 0, contents.length, contents);
    await store.assembleResourceAsync(manifest.fileHash);
    await store.cleanupStorage('refresh-retained-state');
    expect(store.getStorageStatus().protectedBytes).toBe(contents.length);

    (store as any).physicalReclaimBytes = 1;
    const result = await store.cleanupStorage('physical-disk-test');

    expect(result.freedBytes).toBe(contents.length);
    expect(store.getVerifiedAssembledPath(manifest.fileHash)).toBeNull();
    expect(store.getManifest(manifest.fileHash)).toBeTruthy();
  });

  it('records distinct active providers from signed receipt results', () => {
    const { store } = tempStore();
    stores.push(store);
    const contents = Buffer.from('replicated attachment');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'replicated.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 716 },
    };
    store.storeManifest(manifest, { provenance: 'local_authored' });
    store.recordProviderReceipt({
      fileHash: manifest.fileHash,
      providerId: 'peer-a',
      scopeType: 'group',
      scopeId: 716,
      retentionUntil: 200_000,
    });
    store.recordProviderReceipt({
      fileHash: manifest.fileHash,
      providerId: 'peer-b',
      scopeType: 'group',
      scopeId: 716,
      retentionUntil: 200_000,
    });

    expect(store.countActiveProviders(manifest.fileHash)).toBe(2);
  });

  it('reclaims old authored attachments only after a confirmed replica exists', async () => {
    const dir = tempDir();
    const now = RETICULUM_RESOURCE_AUTHORED_RECOVERY_MIN_IDLE_MS + 10 * 24 * 60 * 60_000;
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => now,
      policy: {
        limitBytes: RETICULUM_RESOURCE_MIN_LIMIT_BYTES,
        authoredCapRatio: 0.2,
      },
    });
    stores.push(store);
    const sizeBytes = 100 * 1024 * 1024;
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:author',
      fileName: 'recoverable.bin',
      mimeType: 'application/octet-stream',
      sizeBytes,
      fileHash: cryptoHash(Buffer.from('old recoverable authored attachment')),
      encrypted: false,
      createdAt: now - RETICULUM_RESOURCE_AUTHORED_RECOVERY_MIN_IDLE_MS - 1,
      metadata: { groupId: 716 },
    };
    store.storeManifest(manifest, {
      status: 'complete',
      provenance: 'local_authored',
      residentBytes: sizeBytes,
    });
    store.recordReference({
      manifest,
      scopeType: 'group',
      scopeId: 716,
      eventId: 'event-recoverable',
      locallyAuthored: true,
    });
    store.recordProviderReceipt({
      fileHash: manifest.fileHash,
      providerId: 'peer-a',
      scopeType: 'group',
      scopeId: 716,
      retentionUntil: now + 24 * 60 * 60_000,
    });

    const result = await store.cleanupStorage('authored-recovery');

    expect(result.freedBytes).toBe(sizeBytes);
    expect(store.getManifest(manifest.fileHash)).toBeTruthy();
    expect(store.hasLiveReference(manifest.fileHash, 'group', 716)).toBe(true);
    expect(store.getStorageStatus().authoredResidentBytes).toBe(0);
  });

  it('never reclaims the sole known live authored copy', async () => {
    const dir = tempDir();
    const now = RETICULUM_RESOURCE_AUTHORED_RECOVERY_MIN_IDLE_MS + 10 * 24 * 60 * 60_000;
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => now,
      policy: {
        limitBytes: RETICULUM_RESOURCE_MIN_LIMIT_BYTES,
        authoredCapRatio: 0.2,
      },
    });
    stores.push(store);
    const sizeBytes = 100 * 1024 * 1024;
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:author',
      fileName: 'sole-copy.bin',
      mimeType: 'application/octet-stream',
      sizeBytes,
      fileHash: cryptoHash(Buffer.from('sole authored attachment copy')),
      encrypted: false,
      createdAt: now - RETICULUM_RESOURCE_AUTHORED_RECOVERY_MIN_IDLE_MS - 1,
      metadata: { groupId: 716 },
    };
    store.storeManifest(manifest, {
      status: 'complete',
      provenance: 'local_authored',
      residentBytes: sizeBytes,
    });
    store.recordReference({
      manifest,
      scopeType: 'group',
      scopeId: 716,
      eventId: 'event-sole-copy',
      locallyAuthored: true,
    });
    (store as any).physicalReclaimBytes = 1;

    const result = await store.cleanupStorage('authored-sole-copy');

    expect(result.freedBytes).toBe(0);
    expect(store.getStorageStatus().authoredResidentBytes).toBe(sizeBytes);
  });

  it('prefers authored attachments with two replicas and preserves recently used files', async () => {
    const dir = tempDir();
    const now = RETICULUM_RESOURCE_AUTHORED_RECOVERY_MIN_IDLE_MS + 10 * 24 * 60 * 60_000;
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => now,
      policy: {
        limitBytes: RETICULUM_RESOURCE_MIN_LIMIT_BYTES,
        authoredCapRatio: 0.2,
      },
    });
    stores.push(store);
    const rawDb = (store as unknown as { db: BetterSqliteDatabase }).db;
    const sizeBytesByIndex = [30, 30, 40].map((megabytes) => megabytes * 1024 * 1024);
    const oldCreatedAt = now - RETICULUM_RESOURCE_AUTHORED_RECOVERY_MIN_IDLE_MS - 1;
    const manifests = ['two-replicas', 'one-replica', 'recently-used'].map(
      (name, index): ReticulumResourceManifest => ({
        namespace: 'reticulum-group-resource',
        ownerId: '716:author',
        fileName: `${name}.bin`,
        mimeType: 'application/octet-stream',
        sizeBytes: sizeBytesByIndex[index],
        fileHash: cryptoHash(Buffer.from(`authored attachment ${name}`)),
        encrypted: false,
        createdAt: oldCreatedAt,
        metadata: { groupId: 716 },
      })
    );
    for (const [index, manifest] of manifests.entries()) {
      store.storeManifest(manifest, {
        status: 'complete',
        provenance: 'local_authored',
        residentBytes: manifest.sizeBytes,
      });
      store.recordReference({
        manifest,
        scopeType: 'group',
        scopeId: 716,
        eventId: `event-authored-${index}`,
        locallyAuthored: true,
      });
      store.recordProviderReceipt({
        fileHash: manifest.fileHash,
        providerId: 'peer-a',
        scopeType: 'group',
        scopeId: 716,
        retentionUntil: now + 24 * 60 * 60_000,
      });
    }
    store.recordProviderReceipt({
      fileHash: manifests[0].fileHash,
      providerId: 'peer-b',
      scopeType: 'group',
      scopeId: 716,
      retentionUntil: now + 24 * 60 * 60_000,
    });
    rawDb.prepare(`
      UPDATE reticulum_resources SET last_accessed_at = ? WHERE file_hash = ?
    `).run(now - 24 * 60 * 60_000, manifests[2].fileHash);

    const result = await store.cleanupStorage('authored-replica-priority');
    const residentBytes = (fileHash: string) => Number((rawDb.prepare(`
      SELECT resident_bytes FROM reticulum_resources WHERE file_hash = ?
    `).get(fileHash) as { resident_bytes: number }).resident_bytes);

    expect(result.freedBytes).toBe(sizeBytesByIndex[0]);
    expect(residentBytes(manifests[0].fileHash)).toBe(0);
    expect(residentBytes(manifests[1].fileHash)).toBe(sizeBytesByIndex[1]);
    expect(residentBytes(manifests[2].fileHash)).toBe(sizeBytesByIndex[2]);
  });

  it('keeps discard ordered behind an in-flight asynchronous range write', async () => {
    const { store } = tempStore();
    stores.push(store);
    const contents = Buffer.from('range write cancellation');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      fileName: 'range.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: cryptoHash(contents),
      encrypted: false,
      createdAt: 100_000,
    };
    store.storeManifest(manifest, { provenance: 'remote_downloaded' });

    let markWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    let continueWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      continueWrite = resolve;
    });
    const openSpy = vi.spyOn(fs.promises, 'open').mockResolvedValue({
      write: async () => {
        markWriteStarted();
        await writeGate;
        return { bytesWritten: contents.length, buffer: contents };
      },
      close: async () => undefined,
    } as any);

    try {
      const write = store.storeByteRangeAsync(
        manifest.fileHash,
        0,
        contents.length,
        contents
      );
      await writeStarted;
      const discard = store.discardResourceDataAsync(manifest.fileHash);
      await vi.waitFor(() => {
        expect((store as any).evictingFileHashes.has(manifest.fileHash)).toBe(true);
      });

      continueWrite();
      await expect(write).rejects.toThrow(/reclaimed/);
      await discard;

      expect(store.getCompletedRanges(manifest.fileHash)).toEqual([]);
      expect(store.getStorageStatus().totalResidentBytes).toBe(0);
    } finally {
      openSpy.mockRestore();
    }
  });

  it('reserves authored quota across concurrent imports without double-counting a hash', () => {
    const dir = tempDir();
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => 100_000,
      policy: {
        limitBytes: RETICULUM_RESOURCE_MIN_LIMIT_BYTES,
        authoredCapRatio: 0.2,
      },
    });
    stores.push(store);
    const firstHash = cryptoHash(Buffer.from('first pending authored import'));
    const secondHash = cryptoHash(Buffer.from('second pending authored import'));
    const importSize = 60 * 1024 * 1024;

    const releaseFirst = (store as any).reserveAuthoredImport(
      firstHash,
      importSize,
      importSize
    );
    const releaseDuplicate = (store as any).reserveAuthoredImport(
      firstHash,
      importSize,
      importSize
    );

    expect((store as any).pendingAuthoredImportBytes).toBe(importSize);
    expect(() =>
      (store as any).reserveAuthoredImport(secondHash, importSize, importSize)
    ).toThrow(/reserved for authored files is full/);

    releaseFirst();
    expect((store as any).pendingAuthoredImportBytes).toBe(importSize);
    releaseDuplicate();
    expect((store as any).pendingAuthoredImportBytes).toBe(0);
  });

  it('prunes expired reservations before rebuilding startup accounting', () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'resources.db');
    const rootDir = path.join(dir, 'resources');
    let now = 100_000;
    const first = new ReticulumResourceStore({ dbPath, rootDir, now: () => now });
    first.reserveCapacity({
      provenance: 'remote_downloaded',
      sizeBytes: 4_096,
    });
    (first as any).setResourceMeta('accounting_version', '1');
    first.close();
    now = 2_000_000;

    const startupCalls: string[] = [];
    const prototype = ReticulumResourceStore.prototype as any;
    const originalPrune = prototype.pruneTransientState;
    const originalRebuild = prototype.rebuildStorageAccounting;
    const pruneSpy = vi.spyOn(prototype, 'pruneTransientState').mockImplementation(function (
      this: ReticulumResourceStore
    ) {
      startupCalls.push('prune');
      return originalPrune.call(this);
    });
    const rebuildSpy = vi.spyOn(prototype, 'rebuildStorageAccounting').mockImplementation(function (
      this: ReticulumResourceStore
    ) {
      startupCalls.push('rebuild');
      return originalRebuild.call(this);
    });

    try {
      const reopened = new ReticulumResourceStore({ dbPath, rootDir, now: () => now });
      stores.push(reopened);

      expect(startupCalls.indexOf('prune')).toBeGreaterThanOrEqual(0);
      expect(startupCalls.indexOf('rebuild')).toBeGreaterThan(startupCalls.indexOf('prune'));
    } finally {
      pruneSpy.mockRestore();
      rebuildSpy.mockRestore();
    }
  });

  it('does not skip cleanup candidates when prior batches mutate resident rows', async () => {
    const { store } = tempStore();
    stores.push(store);
    const rawDb = (store as unknown as { db: BetterSqliteDatabase }).db;
    for (let index = 0; index < 130; index += 1) {
      const contents = Buffer.from(`cleanup-candidate-${index}`);
      store.storeManifest({
        namespace: 'reticulum-group-resource',
        fileName: `candidate-${index}.bin`,
        mimeType: 'application/octet-stream',
        sizeBytes: 1,
        fileHash: cryptoHash(contents),
        encrypted: false,
        createdAt: 100_000,
      }, {
        provenance: 'remote_downloaded',
        residentBytes: 1,
      });
    }
    vi.spyOn(store as any, 'readStorageStats').mockReturnValue(null);
    vi.spyOn(store as any, 'evictResidentBytes').mockImplementation(async (row: any) => {
      rawDb.prepare(`
        UPDATE reticulum_resources SET resident_bytes = 0 WHERE file_hash = ?
      `).run(row.file_hash);
      return Number(row.resident_bytes || 0);
    });
    (store as any).physicalReclaimBytes = 130;

    const result = await store.cleanupStorage('mutable-cleanup-pages');

    expect(result.evictedBlobs).toBe(130);
    expect(result.freedBytes).toBe(130);
    expect(store.getStorageStatus().residentBlobCount).toBe(0);
  });
});
