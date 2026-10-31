import Database, { type Database as DB, type Statement } from 'better-sqlite3';
import * as fs from 'fs';
import * as nodeCrypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { log as loggerLog, warn as loggerWarn } from './logger';
import { ReticulumResourceWorkerPool } from './reticulum-resource-worker-pool';

export const RETICULUM_RESOURCE_RANGE_SIZE = 1024 * 1024;
export const RETICULUM_RESOURCE_MAX_RANGE_SIZE = 1024 * 1024;
export const RETICULUM_RESOURCE_DEFAULT_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;
export const RETICULUM_RESOURCE_MIN_LIMIT_BYTES = 512 * 1024 * 1024;
export const RETICULUM_RESOURCE_MIN_FREE_DISK_BYTES = 1024 * 1024 * 1024;
export const RETICULUM_RESOURCE_FREE_DISK_RATIO = 0.05;
export const RETICULUM_RESOURCE_MAX_FREE_DISK_BYTES = 4 * 1024 * 1024 * 1024;

export class ReticulumResourceDiskSpaceError extends Error {
  constructor(requiredBytes: number, availableBytes: number, reserveBytes: number) {
    super(
      `Insufficient physical disk space for resource write: required=${requiredBytes} ` +
        `available=${availableBytes} reserve=${reserveBytes}`
    );
    this.name = 'ReticulumResourceDiskSpaceError';
  }
}

const DEFAULT_LOW_WATERMARK_RATIO = 0.8;
const DEFAULT_AUTHORED_CAP_RATIO = 0.5;
const DEFAULT_REMOTE_GUARANTEE_RATIO = 0.35;
const DEFAULT_TRANSFER_RESERVE_RATIO = 0.15;
const DEFAULT_STALE_PARTIAL_AGE_MS = 24 * 60 * 60_000;
const COMPLETED_DOWNLOAD_RETENTION_MS = 30 * 60_000;
export const RETICULUM_RESOURCE_AUTHORED_RECOVERY_MIN_IDLE_MS =
  30 * 24 * 60 * 60_000;
const ACCESS_TOUCH_INTERVAL_MS = 60_000;
const STORAGE_MAINTENANCE_INTERVAL_MS = 15 * 60_000;
const STARTUP_RECONCILE_BATCH_SIZE = 256;
const STARTUP_RECONCILE_RETRY_MS = 30_000;
const DISK_SPACE_CACHE_MS = 5_000;
const RESOURCE_SCHEMA_VERSION = 2;
const STORAGE_ACCOUNTING_VERSION = 2;
const RESOURCE_OPERATION_LEASE_MS = 15 * 60_000;

export type ReticulumResourceProvenance =
  | 'local_authored'
  | 'remote_downloaded'
  | 'replica';

export type ReticulumResourceReferenceState =
  | 'live'
  | 'deleted'
  | 'expired'
  | 'inaccessible';

export type ReticulumResourceReference = {
  fileHash: string;
  scopeType: 'group' | 'dm';
  scopeId: string;
  eventId: string;
  ownerId?: string;
  manifest: ReticulumResourceManifest;
  state: ReticulumResourceReferenceState;
  locallyAuthored: boolean;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
};

export type ReticulumResourceStoragePolicy = {
  limitBytes: number;
  lowWatermarkRatio: number;
  authoredCapRatio: number;
  remoteGuaranteeRatio: number;
  transferReserveRatio: number;
  stalePartialAgeMs: number;
};

export type ReticulumResourceStorageStatus = {
  limitBytes: number;
  lowWatermarkBytes: number;
  totalResidentBytes: number;
  authoredResidentBytes: number;
  remoteResidentBytes: number;
  partialResidentBytes: number;
  reservedBytes: number;
  protectedBytes: number;
  evictableBytes: number;
  blobCount: number;
  residentBlobCount: number;
  lastCleanupAt: number | null;
  lastCleanupFreedBytes: number;
  blockedAuthoredPublishes: number;
};

export type ReticulumResourceCleanupResult = {
  startedAt: number;
  completedAt: number;
  beforeBytes: number;
  afterBytes: number;
  freedBytes: number;
  evictedBlobs: number;
  reason: string;
};

export type ReticulumResourceManifest = {
  namespace: string;
  ownerId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  fileHash: string;
  encrypted: boolean;
  createdAt: number;
  metadata?: Record<string, unknown>;
  thumbnail?: {
    mimeType: string;
    sizeBytes: number;
    hash: string;
    width?: number;
    height?: number;
  };
};

export type ReticulumResourceByteRangeStatus = {
  fileHash: string;
  startByte: number;
  endByteExclusive: number;
  sizeBytes: number;
  status: 'complete';
  updatedAt: number;
};

export type ReticulumResourceGroupRef = {
  fileHash: string;
  groupId: number;
  eventId?: string;
  ownerId?: string;
  createdAt: number;
  updatedAt: number;
};

export type ReticulumResourceImportOptions = {
  sourcePath: string;
  namespace: string;
  ownerId?: string;
  fileName?: string;
  mimeType?: string;
  encrypted?: boolean;
  metadata?: Record<string, unknown>;
};

export type ReticulumResourceStoreOptions = {
  dbPath?: string;
  rootDir?: string;
  tempDir?: string;
  now?: () => number;
  policy?: Partial<ReticulumResourceStoragePolicy>;
};

type ResourceRow = {
  namespace: string;
  owner_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  file_hash: string;
  encrypted: number;
  status: string;
  assembled_path: string | null;
  partial_path: string | null;
  metadata: string | null;
  thumbnail: string | null;
  created_at: number;
  updated_at: number;
  final_verified_at: number | null;
  provenance: ReticulumResourceProvenance;
  resident_bytes: number;
  last_accessed_at: number | null;
  last_served_at: number | null;
  access_count: number;
  retention_until: number | null;
  managed: number;
};

type CleanupCandidate = ResourceRow & {
  live_ref_count: number;
  provider_count: number;
  active_lease_count: number;
};

type RangeRow = {
  file_hash: string;
  start_byte: number;
  end_byte_exclusive: number;
  status: string;
  updated_at: number;
};

type StorageStatsRow = {
  total_resident_bytes: number;
  authored_resident_bytes: number;
  remote_resident_bytes: number;
  partial_resident_bytes: number;
  reserved_bytes: number;
  protected_bytes: number;
  evictable_bytes: number;
  blob_count: number;
  resident_blob_count: number;
};

type CleanupStateRow = {
  file_hash: string;
  resident_bytes: number;
  live_ref_count: number;
  provider_count: number;
  active_lease_count: number;
  is_protected: number;
  cleanup_tier: number | null;
  sort_access_at: number;
  next_refresh_at: number | null;
};

type CleanupCursor = {
  tier: number;
  sortAccessAt: number;
  residentBytes: number;
  fileHash: string;
};

type CleanupCandidateItem = {
  row: CleanupCandidate;
  tier: number;
  cursor: CleanupCursor;
};

type PhysicalDiskSpace = {
  availableBytes: number;
  reserveBytes: number;
};

export function getReticulumResourceFreeDiskReserveBytes(totalBytes: number): number {
  const normalizedTotal = Number.isFinite(totalBytes)
    ? Math.max(0, Math.floor(totalBytes))
    : 0;
  return Math.max(
    RETICULUM_RESOURCE_MIN_FREE_DISK_BYTES,
    Math.min(
      RETICULUM_RESOURCE_MAX_FREE_DISK_BYTES,
      Math.floor(normalizedTotal * RETICULUM_RESOURCE_FREE_DISK_RATIO)
    )
  );
}

function defaultReticulumResourceRootDir(): string {
  return path.join(app.getPath('appData'), 'qortal-shared', 'reticulum-resources');
}

function defaultReticulumResourceDbPath(): string {
  return path.join(app.getPath('appData'), 'qortal-shared', 'reticulum-resources.db');
}

function safeFileName(value: string): string {
  const base = path.basename(value || 'resource.bin').replace(/[^\w.\- ()]+/g, '_');
  return base || 'resource.bin';
}

function parseJsonObject(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function sha256File(filePath: string): string {
  const hash = nodeCrypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function normalizeManifest(manifest: ReticulumResourceManifest): ReticulumResourceManifest {
  return {
    ...manifest,
    fileHash:
      typeof manifest.fileHash === 'string'
        ? manifest.fileHash.trim().toLowerCase()
        : '',
    fileName: safeFileName(manifest.fileName),
    mimeType: manifest.mimeType || 'application/octet-stream',
    encrypted: manifest.encrypted === true,
  };
}

function isManagedResourceNamespace(namespace: string): boolean {
  return namespace === 'reticulum-group-resource' || namespace === 'reticulum-dm-resource';
}

function rowToManifest(row: ResourceRow): ReticulumResourceManifest {
  return {
    namespace: row.namespace,
    ...(row.owner_id ? { ownerId: row.owner_id } : {}),
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    fileHash: row.file_hash,
    encrypted: row.encrypted === 1,
    createdAt: row.created_at,
    ...(parseJsonObject(row.metadata) ? { metadata: parseJsonObject(row.metadata) } : {}),
    ...(parseJsonObject(row.thumbnail)
      ? { thumbnail: parseJsonObject(row.thumbnail) as ReticulumResourceManifest['thumbnail'] }
      : {}),
  };
}

export class ReticulumResourceStore {
  private readonly db: DB;
  private readonly rootDir: string;
  private readonly tempDir: string;
  private readonly now: () => number;
  private readonly stmtUpsertResource: Statement;
  private readonly stmtGetResource: Statement;
  private readonly stmtUpdateResourceStatus: Statement;
  private readonly stmtUpdatePartialPath: Statement;
  private readonly stmtDeleteRanges: Statement;
  private readonly stmtInsertRange: Statement;
  private readonly stmtGetRanges: Statement;
  private readonly stmtUpsertGroupRef: Statement;
  private readonly stmtHasGroupRef: Statement;
  private readonly stmtListGroupRefs: Statement;
  private policy: ReticulumResourceStoragePolicy;
  private readonly lastAccessTouch = new Map<string, number>();
  private readonly evictingFileHashes = new Set<string>();
  private readonly activeResourceOperations = new Map<string, number>();
  private readonly workerPool = new ReticulumResourceWorkerPool();
  private readonly pendingAssemblies = new Map<string, Promise<string>>();
  private readonly pendingDiscards = new Map<string, Promise<void>>();
  private reconciliationPending = false;
  private reconciliationReady = true;
  private reconciliationPromise: Promise<void> | null = null;
  private reconciliationRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private diskSpaceCache: {
    checkedAt: number;
    space: PhysicalDiskSpace | null;
  } | null = null;
  private diskAdmissionTail: Promise<void> = Promise.resolve();
  private pendingPhysicalWriteBytes = 0;
  private readonly pendingAuthoredImports = new Map<
    string,
    { sizeBytes: number; residentBytes: number; references: number }
  >();
  private pendingAuthoredImportBytes = 0;
  private pendingAuthoredResidentBytes = 0;
  private cleanupPromise: Promise<ReticulumResourceCleanupResult> | null = null;
  private cleanupStateRefreshPromise: Promise<void> | null = null;
  private cleanupScheduled = false;
  private closed = false;
  private readonly maintenanceTimer: ReturnType<typeof setInterval>;
  private expirationTimer: ReturnType<typeof setTimeout> | null = null;
  private nextExpirationAt: number | null = null;
  private lastCleanupAt: number | null = null;
  private lastCleanupFreedBytes = 0;
  private blockedAuthoredPublishes = 0;
  private physicalReclaimBytes = 0;

  constructor(options: ReticulumResourceStoreOptions = {}) {
    this.rootDir = options.rootDir ?? defaultReticulumResourceRootDir();
    this.tempDir = options.tempDir ?? os.tmpdir();
    this.now = options.now ?? Date.now;
    this.policy = this.normalizePolicy(options.policy);
    const dbPath = options.dbPath ?? defaultReticulumResourceDbPath();
    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = NORMAL');
    const accountingRebuildRequired = this.initSchema();

    this.stmtUpsertResource = this.db.prepare(`
      INSERT INTO reticulum_resources
        (file_hash, namespace, owner_id, file_name, mime_type, size_bytes,
         encrypted, status, assembled_path, partial_path, metadata, thumbnail,
         created_at, updated_at, final_verified_at, provenance, resident_bytes,
         last_accessed_at, last_served_at, access_count, retention_until, managed)
      VALUES
        (@file_hash, @namespace, @owner_id, @file_name, @mime_type, @size_bytes,
         @encrypted, @status, @assembled_path, @partial_path, @metadata, @thumbnail,
         @created_at, @updated_at, @final_verified_at, @provenance, @resident_bytes,
         @last_accessed_at, @last_served_at, @access_count, @retention_until, @managed)
      ON CONFLICT(file_hash) DO UPDATE SET
        namespace = reticulum_resources.namespace,
        owner_id = COALESCE(reticulum_resources.owner_id, excluded.owner_id),
        file_name = reticulum_resources.file_name,
        mime_type = reticulum_resources.mime_type,
        size_bytes = reticulum_resources.size_bytes,
        encrypted = reticulum_resources.encrypted,
        status = CASE
          WHEN reticulum_resources.status = 'complete' THEN reticulum_resources.status
          ELSE excluded.status
        END,
        assembled_path = CASE
          WHEN reticulum_resources.status = 'complete' THEN reticulum_resources.assembled_path
          ELSE COALESCE(excluded.assembled_path, reticulum_resources.assembled_path)
        END,
        partial_path = CASE
          WHEN excluded.status = 'complete' THEN excluded.partial_path
          ELSE COALESCE(excluded.partial_path, reticulum_resources.partial_path)
        END,
        metadata = COALESCE(reticulum_resources.metadata, excluded.metadata),
        thumbnail = COALESCE(reticulum_resources.thumbnail, excluded.thumbnail),
        updated_at = excluded.updated_at,
        final_verified_at = COALESCE(excluded.final_verified_at, reticulum_resources.final_verified_at),
        provenance = CASE
          WHEN reticulum_resources.provenance = 'local_authored'
            OR excluded.provenance = 'local_authored' THEN 'local_authored'
          WHEN reticulum_resources.provenance = 'replica'
            OR excluded.provenance = 'replica' THEN 'replica'
          ELSE 'remote_downloaded'
        END,
        resident_bytes = MAX(reticulum_resources.resident_bytes, excluded.resident_bytes),
        last_accessed_at = COALESCE(excluded.last_accessed_at, reticulum_resources.last_accessed_at),
        last_served_at = COALESCE(excluded.last_served_at, reticulum_resources.last_served_at),
        access_count = MAX(reticulum_resources.access_count, excluded.access_count),
        retention_until = MAX(COALESCE(reticulum_resources.retention_until, 0), COALESCE(excluded.retention_until, 0)),
        managed = MAX(reticulum_resources.managed, excluded.managed)
    `);
    this.stmtGetResource = this.db.prepare(
      'SELECT * FROM reticulum_resources WHERE file_hash = ? LIMIT 1'
    );
    this.stmtUpdateResourceStatus = this.db.prepare(`
      UPDATE reticulum_resources
      SET status = ?, assembled_path = ?, partial_path = ?, updated_at = ?, final_verified_at = ?
      WHERE file_hash = ?
    `);
    this.stmtUpdatePartialPath = this.db.prepare(`
      UPDATE reticulum_resources
      SET partial_path = ?, updated_at = ?
      WHERE file_hash = ?
    `);
    this.stmtDeleteRanges = this.db.prepare(`
      DELETE FROM reticulum_resource_ranges
      WHERE file_hash = ?
    `);
    this.stmtInsertRange = this.db.prepare(`
      INSERT OR REPLACE INTO reticulum_resource_ranges
        (file_hash, start_byte, end_byte_exclusive, status, updated_at)
      VALUES (?, ?, ?, 'complete', ?)
    `);
    this.stmtGetRanges = this.db.prepare(`
      SELECT * FROM reticulum_resource_ranges
      WHERE file_hash = ? AND status = 'complete'
      ORDER BY start_byte ASC, end_byte_exclusive ASC
    `);
    this.stmtUpsertGroupRef = this.db.prepare(`
      INSERT INTO reticulum_resource_group_refs
        (file_hash, group_id, event_id, owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_hash, group_id, event_id) DO UPDATE SET
        owner_id = COALESCE(excluded.owner_id, reticulum_resource_group_refs.owner_id),
        updated_at = excluded.updated_at
    `);
    this.stmtHasGroupRef = this.db.prepare(`
      SELECT 1 FROM reticulum_resource_group_refs
      WHERE file_hash = ? AND group_id = ?
      LIMIT 1
    `);
    this.stmtListGroupRefs = this.db.prepare(`
      SELECT file_hash, group_id, event_id, owner_id, created_at, updated_at
      FROM reticulum_resource_group_refs
      WHERE file_hash = ?
      ORDER BY group_id ASC, event_id ASC
    `);
    this.pruneTransientState();
    this.reconcileResidentState();
    if (accountingRebuildRequired) {
      this.rebuildStorageAccounting();
    } else {
      this.markDueCleanupStateDirty();
      this.scheduleCleanupStateRefresh();
    }
    this.maintenanceTimer = setInterval(() => {
      if (this.closed) return;
      void this.cleanupStorage('periodic_maintenance').catch((error) => {
        loggerWarn('[ReticulumResourceStore] periodic_cleanup_failed', error);
      });
    }, STORAGE_MAINTENANCE_INTERVAL_MS);
    this.maintenanceTimer.unref?.();
    this.scheduleNextExpirationMaintenance();
    if (!this.reconciliationPending) this.scheduleCleanup('startup_maintenance');
  }

  close(): void {
    this.closed = true;
    clearInterval(this.maintenanceTimer);
    if (this.expirationTimer) clearTimeout(this.expirationTimer);
    if (this.reconciliationRetryTimer) clearTimeout(this.reconciliationRetryTimer);
    this.expirationTimer = null;
    this.reconciliationRetryTimer = null;
    this.nextExpirationAt = null;
    this.workerPool.stop();
    this.db.close();
  }

  setStoragePolicy(policy: Partial<ReticulumResourceStoragePolicy>): void {
    const next = this.normalizePolicy({ ...this.policy, ...policy });
    if (
      next.limitBytes === this.policy.limitBytes &&
      next.lowWatermarkRatio === this.policy.lowWatermarkRatio &&
      next.authoredCapRatio === this.policy.authoredCapRatio &&
      next.remoteGuaranteeRatio === this.policy.remoteGuaranteeRatio &&
      next.transferReserveRatio === this.policy.transferReserveRatio &&
      next.stalePartialAgeMs === this.policy.stalePartialAgeMs
    ) return;
    this.policy = next;
    this.db.exec(`
      INSERT OR IGNORE INTO reticulum_resource_cleanup_dirty(file_hash)
      SELECT file_hash FROM reticulum_resources WHERE managed = 1;
    `);
    if (this.expirationTimer) clearTimeout(this.expirationTimer);
    this.expirationTimer = null;
    this.nextExpirationAt = null;
    this.scheduleNextExpirationMaintenance();
    this.scheduleCleanup('policy_updated');
  }

  getStoragePolicy(): ReticulumResourceStoragePolicy {
    return { ...this.policy };
  }

  importLocalFile(options: ReticulumResourceImportOptions): ReticulumResourceManifest {
    const sourcePath = path.resolve(options.sourcePath);
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) throw new Error('sourcePath must be a file');
    const now = this.now();
    const digest = sha256File(sourcePath);
    const normalized = this.buildLocalImportManifest(options, sourcePath, stat.size, digest, now);
    const prepared = this.prepareLocalImport(normalized);
    const releaseAuthoredReservation = prepared.requiresAuthoredAdmission
      ? this.reserveAuthoredImport(
          normalized.fileHash,
          normalized.sizeBytes,
          prepared.existingPath ? 0 : normalized.sizeBytes
        )
      : null;
    try {
      if (!prepared.existingPath) {
        fs.mkdirSync(path.dirname(prepared.assembledPath), { recursive: true });
        fs.copyFileSync(sourcePath, prepared.assembledPath);
      }
      return this.commitLocalImport(normalized, prepared, now);
    } finally {
      releaseAuthoredReservation?.();
    }
  }

  async importLocalFileAsync(
    options: ReticulumResourceImportOptions
  ): Promise<ReticulumResourceManifest> {
    const sourcePath = path.resolve(options.sourcePath);
    const stat = await fs.promises.stat(sourcePath);
    if (!stat.isFile()) throw new Error('sourcePath must be a file');
    const hashResult = await this.workerPool.run({ kind: 'hash_file', path: sourcePath }, 1);
    if (!hashResult) throw new Error('Resource worker unavailable during import');
    if (hashResult.ok === false) throw new Error(hashResult.error);
    if (!hashResult.hash || !/^[0-9a-f]{64}$/i.test(hashResult.hash)) {
      throw new Error('Resource worker returned an invalid file hash');
    }
    const now = this.now();
    const normalized = this.buildLocalImportManifest(
      options,
      sourcePath,
      stat.size,
      hashResult.hash,
      now
    );
    const releaseOperation = this.beginResourceOperation(normalized.fileHash);
    let releaseAuthoredReservation: (() => void) | null = null;
    try {
      const prepared = this.prepareLocalImport(normalized);
      if (prepared.requiresAuthoredAdmission) {
        releaseAuthoredReservation = this.reserveAuthoredImport(
          normalized.fileHash,
          normalized.sizeBytes,
          prepared.existingPath ? 0 : normalized.sizeBytes
        );
      }
      if (!prepared.existingPath) {
        const releaseDiskReservation = await this.reservePhysicalDisk(normalized.sizeBytes);
        let committed = false;
        try {
          const finalizeResult = await this.workerPool.run(
            {
              kind: 'finalize_resource',
              sourcePath,
              destinationPath: prepared.assembledPath,
              expectedHash: normalized.fileHash,
              expectedSize: normalized.sizeBytes,
            },
            1
          );
          if (!finalizeResult) throw new Error('Resource worker unavailable during import');
          if (finalizeResult.ok === false) throw new Error(finalizeResult.error);
          committed = true;
        } finally {
          releaseDiskReservation(committed);
        }
      }
      if (this.closed) throw new Error('Resource store closed during import');
      if (this.evictingFileHashes.has(normalized.fileHash)) {
        throw new Error('Resource was reclaimed during import');
      }
      return this.commitLocalImport(normalized, prepared, now);
    } finally {
      releaseAuthoredReservation?.();
      releaseOperation();
    }
  }

  private buildLocalImportManifest(
    options: ReticulumResourceImportOptions,
    sourcePath: string,
    sizeBytes: number,
    fileHash: string,
    createdAt: number
  ): ReticulumResourceManifest {
    const normalized = normalizeManifest({
      namespace: options.namespace,
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      fileName: safeFileName(options.fileName || sourcePath),
      mimeType: options.mimeType || 'application/octet-stream',
      sizeBytes,
      fileHash,
      encrypted: options.encrypted ?? true,
      createdAt,
      ...(options.metadata ? { metadata: options.metadata } : {}),
    });
    this.validateManifest(normalized);
    return normalized;
  }

  private prepareLocalImport(normalized: ReticulumResourceManifest): {
    existingPath: string | null;
    assembledPath: string;
    stalePartialPath: string;
    requiresAuthoredAdmission: boolean;
  } {
    if (this.evictingFileHashes.has(normalized.fileHash)) {
      throw new Error('Resource is currently being reclaimed; retry the import');
    }
    const existingManifest = this.getManifest(normalized.fileHash);
    const existingRow = this.stmtGetResource.get(normalized.fileHash) as
      | ResourceRow
      | undefined;
    if (existingManifest && existingManifest.sizeBytes !== normalized.sizeBytes) {
      throw new Error('Resource manifest size conflicts with its content hash');
    }
    if (existingManifest && existingManifest.encrypted !== normalized.encrypted) {
      throw new Error('Resource manifest encryption conflicts with its content hash');
    }
    const existingPath = this.getVerifiedAssembledPath(normalized.fileHash);
    return {
      existingPath,
      assembledPath: existingPath ?? this.assembledPath(normalized),
      stalePartialPath: existingRow?.partial_path ?? this.partialPath(normalized),
      requiresAuthoredAdmission:
        this.getProvenance(normalized.fileHash) !== 'local_authored',
    };
  }

  private commitLocalImport(
    normalized: ReticulumResourceManifest,
    prepared: {
      existingPath: string | null;
      assembledPath: string;
      stalePartialPath: string;
      requiresAuthoredAdmission: boolean;
    },
    now: number
  ): ReticulumResourceManifest {
    this.storeManifest(normalized, {
      status: 'complete',
      assembledPath: prepared.assembledPath,
      partialPath: null,
      finalVerifiedAt: now,
      provenance: 'local_authored',
      residentBytes: normalized.sizeBytes,
      retentionUntil: now + 30 * 60_000,
    });
    if (!prepared.existingPath) {
      this.stmtDeleteRanges.run(normalized.fileHash);
      fs.rmSync(this.rangeStatePath(normalized.fileHash), { force: true });
      if (prepared.stalePartialPath !== prepared.assembledPath) {
        fs.rmSync(prepared.stalePartialPath, { force: true });
      }
    }
    return normalized;
  }

  storeManifest(
    manifest: ReticulumResourceManifest,
    options: {
      status?: 'pending' | 'complete';
      assembledPath?: string | null;
      partialPath?: string | null;
      finalVerifiedAt?: number | null;
      provenance?: ReticulumResourceProvenance;
      residentBytes?: number;
      retentionUntil?: number | null;
    } = {}
  ): void {
    const normalized = normalizeManifest(manifest);
    this.validateManifest(normalized);
    const now = this.now();
    const existing = this.stmtGetResource.get(normalized.fileHash) as ResourceRow | undefined;
    if (existing && existing.size_bytes !== normalized.sizeBytes) {
      throw new Error('Resource manifest size conflicts with its content hash');
    }
    if (existing && (existing.encrypted === 1) !== normalized.encrypted) {
      throw new Error('Resource manifest encryption conflicts with its content hash');
    }
    this.stmtUpsertResource.run({
      namespace: normalized.namespace,
      owner_id: normalized.ownerId ?? null,
      file_name: safeFileName(normalized.fileName),
      mime_type: normalized.mimeType,
      size_bytes: normalized.sizeBytes,
      file_hash: normalized.fileHash,
      encrypted: normalized.encrypted ? 1 : 0,
      status: existing?.status === 'complete' ? 'complete' : options.status ?? 'pending',
      assembled_path:
        options.assembledPath !== undefined
          ? options.assembledPath
          : existing?.assembled_path ?? null,
      partial_path:
        options.partialPath !== undefined
          ? options.partialPath
          : existing?.partial_path ?? null,
      metadata: normalized.metadata ? JSON.stringify(normalized.metadata) : null,
      thumbnail: normalized.thumbnail ? JSON.stringify(normalized.thumbnail) : null,
      created_at: normalized.createdAt || now,
      updated_at: now,
      final_verified_at: options.finalVerifiedAt ?? existing?.final_verified_at ?? null,
      provenance: options.provenance ?? existing?.provenance ?? 'remote_downloaded',
      resident_bytes: Math.max(
        0,
        options.residentBytes ?? existing?.resident_bytes ?? 0
      ),
      last_accessed_at: existing?.last_accessed_at ?? null,
      last_served_at: existing?.last_served_at ?? null,
      access_count: existing?.access_count ?? 0,
      retention_until: options.retentionUntil ?? existing?.retention_until ?? null,
      managed:
        existing?.managed === 1 || isManagedResourceNamespace(normalized.namespace) ? 1 : 0,
    });
    const stored = this.stmtGetResource.get(normalized.fileHash) as ResourceRow | undefined;
    if (!stored) throw new Error('Resource manifest was not stored');
    if (Number.isFinite(options.retentionUntil)) {
      this.considerExpirationAt(Number(options.retentionUntil));
    }
    if (stored.status !== 'complete' && stored.resident_bytes > 0) {
      this.considerExpirationAt(stored.updated_at + this.policy.stalePartialAgeMs);
    }
    if ((options.residentBytes ?? 0) > 0) this.scheduleCleanup('resource_stored');
  }

  getManifest(fileHash: string): ReticulumResourceManifest | null {
    const row = this.stmtGetResource.get(String(fileHash || '').trim().toLowerCase()) as
      | ResourceRow
      | undefined;
    return row ? rowToManifest(row) : null;
  }

  getCompletedRanges(fileHash: string): ReticulumResourceByteRangeStatus[] {
    const normalizedFileHash = String(fileHash || '').trim().toLowerCase();
    return (this.stmtGetRanges.all(normalizedFileHash) as RangeRow[])
      .map((row) => ({
        fileHash: row.file_hash,
        startByte: row.start_byte,
        endByteExclusive: row.end_byte_exclusive,
        sizeBytes: Math.max(0, row.end_byte_exclusive - row.start_byte),
        status: 'complete' as const,
        updatedAt: row.updated_at,
      }));
  }

  getCompletedBytes(fileHash: string): number {
    const row = this.stmtGetResource.get(String(fileHash || '').trim().toLowerCase()) as
      | ResourceRow
      | undefined;
    if (!row) return 0;
    return Math.max(0, Math.min(row.size_bytes, Number(row.resident_bytes || 0)));
  }

  hasCompletedRange(
    fileHash: string,
    startByte: number,
    endByteExclusive: number
  ): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM reticulum_resource_ranges
      WHERE file_hash = ? AND status = 'complete'
        AND start_byte <= ? AND end_byte_exclusive >= ?
      LIMIT 1
    `).get(
      String(fileHash || '').trim().toLowerCase(),
      Math.floor(startByte),
      Math.floor(endByteExclusive)
    );
    return Boolean(row);
  }

  getLatestRangeUpdatedAt(fileHash: string): number | null {
    const row = this.db.prepare(`
      SELECT MAX(updated_at) AS updated_at
      FROM reticulum_resource_ranges
      WHERE file_hash = ? AND status = 'complete'
    `).get(String(fileHash || '').trim().toLowerCase()) as
      | { updated_at?: number | null }
      | undefined;
    if (Number.isFinite(row?.updated_at)) return Number(row?.updated_at);
    return this.getCompletedRanges(fileHash).reduce(
      (latest: number | null, range) =>
        latest == null ? range.updatedAt : Math.max(latest, range.updatedAt),
      null
    );
  }

  getVerifiedAssembledPath(fileHash: string, recordAccess = true): string | null {
    const row = this.stmtGetResource.get(String(fileHash || '').trim().toLowerCase()) as
      | ResourceRow
      | undefined;
    if (!row || row.status !== 'complete' || !row.final_verified_at || !row.assembled_path) {
      return null;
    }
    try {
      const stat = fs.statSync(row.assembled_path);
      if (!stat.isFile() || stat.size !== row.size_bytes) return null;
      if (recordAccess) this.touchAccess(row.file_hash);
      return row.assembled_path;
    } catch {
      return null;
    }
  }

  getPartialPath(fileHash: string): string | null {
    const row = this.stmtGetResource.get(String(fileHash || '').trim().toLowerCase()) as
      | ResourceRow
      | undefined;
    if (!row) return null;
    if (row.partial_path && fs.existsSync(row.partial_path)) return row.partial_path;
    const candidate = this.partialPath(rowToManifest(row));
    return fs.existsSync(candidate) ? candidate : null;
  }

  recordGroupReference(input: {
    fileHash: string;
    groupId: number;
    eventId?: string;
    ownerId?: string;
    createdAt?: number;
    expiresAt?: number;
    manifest?: ReticulumResourceManifest;
  }): void {
    const fileHash = String(input.fileHash || '').trim().toLowerCase();
    const groupId = Number(input.groupId);
    if (!/^[0-9a-f]{64}$/i.test(fileHash)) throw new Error('Invalid file hash');
    if (!Number.isInteger(groupId) || groupId <= 0) throw new Error('Invalid group id');
    const eventId =
      typeof input.eventId === 'string' && input.eventId.trim()
        ? input.eventId.trim()
        : '';
    const ownerId =
      typeof input.ownerId === 'string' && input.ownerId.trim()
        ? input.ownerId.trim()
        : null;
    const referenceManifest = input.manifest
      ? normalizeManifest(input.manifest)
      : this.getManifest(fileHash);
    if (referenceManifest) {
      this.validateManifest(referenceManifest);
      if (referenceManifest.fileHash.toLowerCase() !== fileHash) {
        throw new Error('Resource reference manifest hash mismatch');
      }
    }
    const now = this.now();
    this.stmtUpsertGroupRef.run(
      fileHash,
      groupId,
      eventId,
      ownerId,
      Number.isFinite(input.createdAt) ? Number(input.createdAt) : now,
      now
    );
    if (referenceManifest && eventId) {
      this.recordReference({
        manifest: referenceManifest,
        scopeType: 'group',
        scopeId: String(groupId),
        eventId,
        ownerId: ownerId ?? undefined,
        locallyAuthored: this.getProvenance(fileHash) === 'local_authored',
        createdAt: Number.isFinite(input.createdAt) ? Number(input.createdAt) : now,
        expiresAt: input.expiresAt,
      });
    }
  }

  hasGroupReference(fileHash: string, groupId: number): boolean {
    const normalizedFileHash = String(fileHash || '').trim().toLowerCase();
    const normalizedGroupId = Number(groupId);
    if (!/^[0-9a-f]{64}$/i.test(normalizedFileHash)) return false;
    if (!Number.isInteger(normalizedGroupId) || normalizedGroupId <= 0) return false;
    return !!this.stmtHasGroupRef.get(normalizedFileHash, normalizedGroupId);
  }

  listGroupReferences(fileHash: string): ReticulumResourceGroupRef[] {
    const normalizedFileHash = String(fileHash || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(normalizedFileHash)) return [];
    return this.listDbGroupReferences(normalizedFileHash);
  }

  recordReference(input: {
    manifest: ReticulumResourceManifest;
    scopeType: 'group' | 'dm';
    scopeId: string | number;
    eventId?: string;
    ownerId?: string;
    state?: ReticulumResourceReferenceState;
    locallyAuthored?: boolean;
    createdAt?: number;
    expiresAt?: number;
  }): void {
    const manifest = normalizeManifest(input.manifest);
    this.validateManifest(manifest);
    const scopeId = String(input.scopeId ?? '').trim();
    if (!scopeId) throw new Error('Invalid resource scope');
    const eventId = String(input.eventId || '').trim();
    if (!eventId) throw new Error('Resource references require an event id');
    const state = input.state ?? 'live';
    const now = this.now();
    if (!this.getManifest(manifest.fileHash)) {
      this.storeManifest(manifest, {
        provenance: input.locallyAuthored ? 'local_authored' : undefined,
      });
    } else if (input.locallyAuthored) {
      this.db.prepare(`
        UPDATE reticulum_resources
        SET provenance = 'local_authored', retention_until = NULL,
            managed = MAX(managed, ?), updated_at = ?
        WHERE file_hash = ?
      `).run(isManagedResourceNamespace(manifest.namespace) ? 1 : 0, now, manifest.fileHash);
    } else if (isManagedResourceNamespace(manifest.namespace)) {
      this.db.prepare(`
        UPDATE reticulum_resources SET managed = 1, updated_at = ? WHERE file_hash = ?
      `).run(now, manifest.fileHash);
    }
    this.db.prepare(`
      INSERT INTO reticulum_resource_refs
        (file_hash, scope_type, scope_id, event_id, owner_id, namespace, file_name,
         mime_type, size_bytes, encrypted, metadata, thumbnail, state,
         locally_authored, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_hash, scope_type, scope_id, event_id) DO UPDATE SET
        owner_id = COALESCE(excluded.owner_id, reticulum_resource_refs.owner_id),
        namespace = excluded.namespace,
        file_name = excluded.file_name,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        encrypted = excluded.encrypted,
        metadata = excluded.metadata,
        thumbnail = excluded.thumbnail,
        state = CASE
          WHEN reticulum_resource_refs.state IN ('deleted', 'expired')
            THEN reticulum_resource_refs.state
          ELSE excluded.state
        END,
        locally_authored = MAX(reticulum_resource_refs.locally_authored, excluded.locally_authored),
        updated_at = excluded.updated_at,
        expires_at = CASE
          WHEN reticulum_resource_refs.expires_at IS NULL THEN excluded.expires_at
          WHEN excluded.expires_at IS NULL THEN reticulum_resource_refs.expires_at
          ELSE MIN(reticulum_resource_refs.expires_at, excluded.expires_at)
        END
    `).run(
      manifest.fileHash,
      input.scopeType,
      scopeId,
      eventId,
      input.ownerId ?? manifest.ownerId ?? null,
      manifest.namespace,
      manifest.fileName,
      manifest.mimeType,
      manifest.sizeBytes,
      manifest.encrypted ? 1 : 0,
      manifest.metadata ? JSON.stringify(manifest.metadata) : null,
      manifest.thumbnail ? JSON.stringify(manifest.thumbnail) : null,
      state,
      input.locallyAuthored ? 1 : 0,
      Number.isFinite(input.createdAt) ? Number(input.createdAt) : manifest.createdAt || now,
      now,
      Number.isFinite(input.expiresAt) ? Math.floor(Number(input.expiresAt)) : null
    );
    if (Number.isFinite(input.expiresAt)) {
      this.considerExpirationAt(Math.floor(Number(input.expiresAt)));
    }
  }

  recordDirectReference(input: {
    manifest: ReticulumResourceManifest;
    conversationId: string;
    eventId?: string;
    ownerId?: string;
    locallyAuthored?: boolean;
    createdAt?: number;
    expiresAt?: number;
  }): void {
    this.recordReference({
      ...input,
      scopeType: 'dm',
      scopeId: input.conversationId,
    });
  }

  setReferenceState(input: {
    fileHash?: string;
    scopeType: 'group' | 'dm';
    scopeId: string | number;
    eventId: string;
    state: ReticulumResourceReferenceState;
  }): number {
    const values: unknown[] = [input.state, this.now(), input.scopeType, String(input.scopeId), input.eventId];
    let sql = `
      UPDATE reticulum_resource_refs
      SET state = ?, updated_at = ?
      WHERE scope_type = ? AND scope_id = ? AND event_id = ?
    `;
    if (input.fileHash) {
      sql += ' AND file_hash = ?';
      values.push(String(input.fileHash).trim().toLowerCase());
    }
    const result = this.db.prepare(sql).run(...values);
    if (result.changes > 0) this.scheduleCleanup(`reference_${input.state}`);
    return Number(result.changes);
  }

  setLegacyCalendarCoverReferenceState(input: {
    groupId: number;
    eventId: string;
    state: ReticulumResourceReferenceState;
  }): number {
    const groupId = Number(input.groupId);
    const eventId = String(input.eventId || '').trim().toLowerCase();
    if (!Number.isInteger(groupId) || groupId <= 0 || !eventId) return 0;
    const result = this.db
      .prepare(
        `UPDATE reticulum_resource_refs
            SET state = ?, updated_at = ?
          WHERE scope_type = 'group'
            AND scope_id = ?
            AND event_id = ?
            AND namespace = 'reticulum-group-resource'
            AND metadata IS NOT NULL
            AND json_valid(metadata) = 1
            AND json_extract(metadata, '$.feature') = 'reticulum-calendar-cover'`
      )
      .run(input.state, this.now(), String(groupId), eventId);
    if (result.changes > 0) {
      this.scheduleCleanup(`calendar_reference_${input.state}`);
    }
    return Number(result.changes);
  }

  setReferenceExpiry(input: {
    scopeType: 'group' | 'dm';
    scopeId: string | number;
    eventId: string;
    expiresAt: number | null;
  }): number {
    return this.setReferenceExpiries({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      references: [{ eventId: input.eventId, expiresAt: input.expiresAt }],
    });
  }

  setReferenceExpiries(input: {
    scopeType: 'group' | 'dm';
    scopeId: string | number;
    references: Array<{ eventId: string; expiresAt: number | null }>;
  }): number {
    const scopeId = String(input.scopeId ?? '').trim();
    if (!scopeId || !Array.isArray(input.references) || input.references.length === 0) {
      return 0;
    }
    const references = input.references
      .map((reference) => ({
        eventId: String(reference.eventId || '').trim(),
        expiresAt:
          reference.expiresAt === null
            ? null
            : Math.floor(Number(reference.expiresAt)),
      }))
      .filter(
        (reference) =>
          !!reference.eventId &&
          (reference.expiresAt === null ||
            (Number.isFinite(reference.expiresAt) && reference.expiresAt > 0))
      );
    if (references.length === 0) return 0;
    const update = this.db.prepare(`
      UPDATE reticulum_resource_refs
      SET expires_at = ?, updated_at = ?
      WHERE scope_type = ? AND scope_id = ? AND event_id = ?
        AND state = 'live'
    `);
    const updatedAt = this.now();
    const tx = this.db.transaction(() => {
      let changes = 0;
      for (const reference of references) {
        changes += Number(
          update.run(
            reference.expiresAt,
            updatedAt,
            input.scopeType,
            scopeId,
            reference.eventId
          ).changes
        );
      }
      return changes;
    });
    const changes = tx();
    if (changes > 0) {
      const nextExpiry = references.reduce<number | null>(
        (earliest, reference) =>
          reference.expiresAt === null
            ? earliest
            : earliest === null
              ? reference.expiresAt
              : Math.min(earliest, reference.expiresAt),
        null
      );
      if (nextExpiry !== null) this.considerExpirationAt(nextExpiry);
    }
    return changes;
  }

  hasLiveReference(
    fileHash: string,
    scopeType: 'group' | 'dm',
    scopeId: string | number,
    eventId?: string
  ): boolean {
    const normalizedHash = String(fileHash || '').trim().toLowerCase();
    const normalizedScopeId = String(scopeId ?? '').trim();
    if (!normalizedHash || !normalizedScopeId) return false;
    const row = eventId
      ? this.db.prepare(`
          SELECT 1 FROM reticulum_resource_refs
          WHERE file_hash = ? AND scope_type = ? AND scope_id = ?
            AND event_id = ? AND event_id <> '' AND state = 'live'
            AND (expires_at IS NULL OR expires_at > ?)
          LIMIT 1
        `).get(normalizedHash, scopeType, normalizedScopeId, eventId, this.now())
      : this.db.prepare(`
          SELECT 1 FROM reticulum_resource_refs
          WHERE file_hash = ? AND scope_type = ? AND scope_id = ?
            AND event_id <> '' AND state = 'live'
            AND (expires_at IS NULL OR expires_at > ?)
          LIMIT 1
        `).get(normalizedHash, scopeType, normalizedScopeId, this.now());
    return !!row;
  }

  getReferenceManifest(
    fileHash: string,
    scopeType: 'group' | 'dm',
    scopeId: string | number,
    eventId?: string
  ): ReticulumResourceManifest | null {
    const params: unknown[] = [String(fileHash || '').trim().toLowerCase(), scopeType, String(scopeId)];
    let sql = `
      SELECT namespace, owner_id, file_name, mime_type, size_bytes, file_hash,
             encrypted, metadata, thumbnail, created_at
      FROM reticulum_resource_refs
      WHERE file_hash = ? AND scope_type = ? AND scope_id = ?
        AND event_id <> '' AND state = 'live'
        AND (expires_at IS NULL OR expires_at > ?)
    `;
    params.push(this.now());
    if (eventId) {
      sql += ' AND event_id = ?';
      params.push(eventId);
    }
    sql += ' ORDER BY updated_at DESC LIMIT 1';
    const row = this.db.prepare(sql).get(...params) as Pick<
      ResourceRow,
      | 'namespace'
      | 'owner_id'
      | 'file_name'
      | 'mime_type'
      | 'size_bytes'
      | 'file_hash'
      | 'encrypted'
      | 'metadata'
      | 'thumbnail'
      | 'created_at'
    > | undefined;
    if (!row) return null;
    return rowToManifest({
      ...row,
      status: 'pending',
      assembled_path: null,
      partial_path: null,
      updated_at: row.created_at,
      final_verified_at: null,
      provenance: 'remote_downloaded',
      resident_bytes: 0,
      last_accessed_at: null,
      last_served_at: null,
      access_count: 0,
      retention_until: null,
      managed: 1,
    });
  }

  listReferences(fileHash: string): ReticulumResourceReference[] {
    const rows = this.db.prepare(`
      SELECT * FROM reticulum_resource_refs
      WHERE file_hash = ?
      ORDER BY scope_type, scope_id, event_id
    `).all(String(fileHash || '').trim().toLowerCase()) as Array<{
      file_hash: string;
      scope_type: 'group' | 'dm';
      scope_id: string;
      event_id: string;
      owner_id: string | null;
      namespace: string;
      file_name: string;
      mime_type: string;
      size_bytes: number;
      encrypted: number;
      metadata: string | null;
      thumbnail: string | null;
      state: ReticulumResourceReferenceState;
      locally_authored: number;
      created_at: number;
      updated_at: number;
      expires_at: number | null;
    }>;
    return rows.map((row) => ({
      fileHash: row.file_hash,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      eventId: row.event_id,
      ...(row.owner_id ? { ownerId: row.owner_id } : {}),
      manifest: {
        namespace: row.namespace,
        ...(row.owner_id ? { ownerId: row.owner_id } : {}),
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        fileHash: row.file_hash,
        encrypted: row.encrypted === 1,
        createdAt: row.created_at,
        ...(parseJsonObject(row.metadata) ? { metadata: parseJsonObject(row.metadata) } : {}),
        ...(parseJsonObject(row.thumbnail)
          ? { thumbnail: parseJsonObject(row.thumbnail) as ReticulumResourceManifest['thumbnail'] }
          : {}),
      },
      state: row.state,
      locallyAuthored: row.locally_authored === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.expires_at != null ? { expiresAt: row.expires_at } : {}),
    }));
  }

  acquireLease(
    fileHash: string,
    leaseType: 'transfer' | 'viewer' | 'seed' | 'save' | 'assembly',
    ttlMs = 10 * 60_000
  ): string {
    const normalizedHash = String(fileHash || '').trim().toLowerCase();
    if (!this.getManifest(normalizedHash)) throw new Error('Unknown resource manifest');
    if (this.evictingFileHashes.has(normalizedHash)) {
      throw new Error('Resource is currently being reclaimed');
    }
    const now = this.now();
    const leaseId =
      leaseType === 'viewer'
        ? `viewer:${normalizedHash}`
        : nodeCrypto.randomUUID();
    this.db.prepare(`
      INSERT INTO reticulum_resource_leases
        (lease_id, file_hash, lease_type, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(lease_id) DO UPDATE SET
        file_hash = excluded.file_hash,
        lease_type = excluded.lease_type,
        expires_at = excluded.expires_at
    `).run(leaseId, normalizedHash, leaseType, now + Math.max(1_000, ttlMs), now);
    this.considerExpirationAt(now + Math.max(1_000, ttlMs));
    return leaseId;
  }

  renewLease(leaseId: string, ttlMs = 10 * 60_000): boolean {
    const expiresAt = this.now() + Math.max(1_000, ttlMs);
    const result = this.db.prepare(`
      UPDATE reticulum_resource_leases SET expires_at = ? WHERE lease_id = ?
    `).run(expiresAt, leaseId);
    if (result.changes > 0) this.considerExpirationAt(expiresAt);
    return result.changes > 0;
  }

  releaseLease(leaseId: string): void {
    this.db.prepare('DELETE FROM reticulum_resource_leases WHERE lease_id = ?').run(leaseId);
  }

  private beginResourceOperation(fileHash: string): () => void {
    const normalizedHash = String(fileHash || '').trim().toLowerCase();
    if (!normalizedHash) throw new Error('Invalid resource hash');
    if (this.evictingFileHashes.has(normalizedHash)) {
      throw new Error('Resource is currently being reclaimed');
    }
    this.activeResourceOperations.set(
      normalizedHash,
      (this.activeResourceOperations.get(normalizedHash) ?? 0) + 1
    );
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.activeResourceOperations.get(normalizedHash) ?? 1) - 1;
      if (remaining <= 0) this.activeResourceOperations.delete(normalizedHash);
      else this.activeResourceOperations.set(normalizedHash, remaining);
    };
  }

  reserveCapacity(input: {
    fileHash?: string;
    sizeBytes: number;
    provenance: ReticulumResourceProvenance;
    ttlMs?: number;
  }): string {
    const sizeBytes = Math.max(0, Math.floor(input.sizeBytes));
    this.assertAdmissionCapacity(sizeBytes, input.provenance);
    const reservationId = nodeCrypto.randomUUID();
    const now = this.now();
    const expiresAt = now + Math.max(60_000, input.ttlMs ?? 30 * 60_000);
    this.db.prepare(`
      INSERT INTO reticulum_resource_reservations
        (reservation_id, file_hash, provenance, size_bytes, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      reservationId,
      input.fileHash ? String(input.fileHash).trim().toLowerCase() : null,
      input.provenance,
      sizeBytes,
      expiresAt,
      now
    );
    this.considerExpirationAt(expiresAt);
    return reservationId;
  }

  updateReservation(
    reservationId: string,
    sizeBytes: number,
    ttlMs = 30 * 60_000
  ): boolean {
    const expiresAt = this.now() + Math.max(60_000, ttlMs);
    const result = this.db.prepare(`
      UPDATE reticulum_resource_reservations
      SET size_bytes = ?, expires_at = ?
      WHERE reservation_id = ?
    `).run(
      Math.max(0, Math.floor(sizeBytes)),
      expiresAt,
      reservationId
    );
    if (result.changes > 0) this.considerExpirationAt(expiresAt);
    return result.changes > 0;
  }

  releaseReservation(reservationId: string): void {
    this.db.prepare(
      'DELETE FROM reticulum_resource_reservations WHERE reservation_id = ?'
    ).run(reservationId);
  }

  recordProviderReceipt(input: {
    fileHash: string;
    providerId: string;
    scopeType: 'group' | 'dm';
    scopeId: string | number;
    retentionUntil: number;
    receiptAt?: number;
  }): void {
    const fileHash = String(input.fileHash || '').trim().toLowerCase();
    const providerId = String(input.providerId || '').trim().toLowerCase();
    if (!this.getManifest(fileHash) || !providerId) return;
    const now = this.now();
    const receiptAt = Number.isFinite(input.receiptAt) ? Number(input.receiptAt) : now;
    const retentionUntil = Math.max(now, Math.floor(input.retentionUntil));
    this.db.prepare(`
      INSERT INTO reticulum_resource_providers
        (file_hash, provider_id, scope_type, scope_id, receipt_at,
         retention_until, last_confirmed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_hash, provider_id, scope_type, scope_id) DO UPDATE SET
        receipt_at = excluded.receipt_at,
        retention_until = MAX(reticulum_resource_providers.retention_until, excluded.retention_until),
        last_confirmed_at = excluded.last_confirmed_at
    `).run(
      fileHash,
      providerId,
      input.scopeType,
      String(input.scopeId),
      receiptAt,
      retentionUntil,
      now
    );
    this.considerExpirationAt(retentionUntil);
    this.scheduleCleanup('provider_receipt');
  }

  countActiveProviders(fileHash: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(DISTINCT provider_id) AS count
      FROM reticulum_resource_providers
      WHERE file_hash = ? AND retention_until > ?
    `).get(String(fileHash || '').trim().toLowerCase(), this.now()) as { count: number };
    return Number(row?.count || 0);
  }

  markReplicaRetention(fileHash: string, retentionUntil: number): void {
    const normalizedRetentionUntil = Math.max(this.now(), Math.floor(retentionUntil));
    this.db.prepare(`
      UPDATE reticulum_resources
      SET provenance = CASE
            WHEN provenance = 'local_authored' THEN provenance
            ELSE 'replica'
          END,
          retention_until = MAX(COALESCE(retention_until, 0), ?),
          updated_at = ?
      WHERE file_hash = ?
    `).run(
      normalizedRetentionUntil,
      this.now(),
      String(fileHash || '').trim().toLowerCase()
    );
    this.considerExpirationAt(normalizedRetentionUntil);
  }

  getStorageStatus(): ReticulumResourceStorageStatus {
    const stats = this.readStorageStats();
    if (stats) {
      this.scheduleCleanupStateRefresh();
      return this.storageStatusFromStats(stats);
    }
    this.pruneTransientState();
    return this.getLegacyStorageStatus();
  }

  private getLegacyStorageStatus(): ReticulumResourceStorageStatus {
    const rows = this.getManagedRowsWithState();
    const reserved = this.db.prepare(`
      SELECT COALESCE(SUM(size_bytes), 0) AS bytes
      FROM reticulum_resource_reservations WHERE expires_at > ?
    `).get(this.now()) as { bytes: number };
    let totalResidentBytes = 0;
    let authoredResidentBytes = 0;
    let remoteResidentBytes = 0;
    let partialResidentBytes = 0;
    let protectedBytes = 0;
    let evictableBytes = 0;
    let residentBlobCount = 0;
    for (const row of rows) {
      const bytes = Math.max(0, Number(row.resident_bytes || 0));
      totalResidentBytes += bytes;
      if (row.provenance === 'local_authored') authoredResidentBytes += bytes;
      else remoteResidentBytes += bytes;
      if (row.status !== 'complete') partialResidentBytes += bytes;
      if (bytes > 0) residentBlobCount += 1;
      const tier = this.cleanupTier(row);
      if (this.isProtectedCandidate(row) || (bytes > 0 && tier == null)) {
        protectedBytes += bytes;
      } else if (tier != null) {
        evictableBytes += bytes;
      }
    }
    return {
      limitBytes: this.policy.limitBytes,
      lowWatermarkBytes: Math.floor(this.policy.limitBytes * this.policy.lowWatermarkRatio),
      totalResidentBytes,
      authoredResidentBytes,
      remoteResidentBytes,
      partialResidentBytes,
      reservedBytes: Math.max(0, Number(reserved?.bytes || 0)),
      protectedBytes,
      evictableBytes,
      blobCount: rows.length,
      residentBlobCount,
      lastCleanupAt: this.lastCleanupAt,
      lastCleanupFreedBytes: this.lastCleanupFreedBytes,
      blockedAuthoredPublishes: this.blockedAuthoredPublishes,
    };
  }

  cleanupStorage(reason = 'manual'): Promise<ReticulumResourceCleanupResult> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.cleanupPromise = this.runCleanup(reason).finally(() => {
      this.cleanupPromise = null;
    });
    return this.cleanupPromise;
  }

  private listDbGroupReferences(fileHash: string): ReticulumResourceGroupRef[] {
    return (this.stmtListGroupRefs.all(fileHash) as Array<{
      file_hash: string;
      group_id: number;
      event_id: string | null;
      owner_id: string | null;
      created_at: number;
      updated_at: number;
    }>).map((row) => ({
      fileHash: row.file_hash,
      groupId: row.group_id,
      ...(row.event_id ? { eventId: row.event_id } : {}),
      ...(row.owner_id ? { ownerId: row.owner_id } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  ensurePartialFile(fileHash: string): string {
    const manifest = this.getManifest(fileHash);
    if (!manifest) throw new Error('Unknown resource manifest');
    const row = this.stmtGetResource.get(manifest.fileHash) as ResourceRow | undefined;
    const existingPath = row?.partial_path || this.partialPath(manifest);
    fs.mkdirSync(path.dirname(existingPath), { recursive: true });
    const fd = fs.openSync(existingPath, 'a');
    try {
      const stat = fs.fstatSync(fd);
      if (stat.size > manifest.sizeBytes) fs.ftruncateSync(fd, manifest.sizeBytes);
    } finally {
      fs.closeSync(fd);
    }
    this.stmtUpdatePartialPath.run(existingPath, this.now(), manifest.fileHash);
    return existingPath;
  }

  storeByteRange(
    fileHash: string,
    startByte: number,
    endByteExclusive: number,
    bytes: Buffer
  ): void {
    const manifest = this.getManifest(fileHash);
    if (!manifest) throw new Error('Unknown resource manifest');
    if (this.evictingFileHashes.has(manifest.fileHash)) {
      throw new Error('Resource is currently being reclaimed');
    }
    this.validateRange(manifest, startByte, endByteExclusive);
    if (bytes.length !== endByteExclusive - startByte) {
      throw new Error('Range size mismatch');
    }
    const partialPath = this.ensurePartialFile(manifest.fileHash);
    const fd = fs.openSync(partialPath, 'r+');
    try {
      fs.writeSync(fd, bytes, 0, bytes.length, startByte);
    } finally {
      fs.closeSync(fd);
    }
    const completedBytes = this.recordCompletedRange(
      manifest.fileHash,
      startByte,
      endByteExclusive
    );
    this.db.prepare(`
      UPDATE reticulum_resources
      SET resident_bytes = ?, updated_at = ?
      WHERE file_hash = ?
    `).run(completedBytes, this.now(), manifest.fileHash);
  }

  async storeByteRangeAsync(
    fileHash: string,
    startByte: number,
    endByteExclusive: number,
    bytes: Buffer
  ): Promise<void> {
    const manifest = this.getManifest(fileHash);
    if (!manifest) throw new Error('Unknown resource manifest');
    if (this.evictingFileHashes.has(manifest.fileHash)) {
      throw new Error('Resource is currently being reclaimed');
    }
    this.validateRange(manifest, startByte, endByteExclusive);
    if (bytes.length !== endByteExclusive - startByte) {
      throw new Error('Range size mismatch');
    }
    const releaseOperation = this.beginResourceOperation(manifest.fileHash);
    try {
      const releaseDiskReservation = await this.reservePhysicalDisk(bytes.length);
      let committed = false;
      try {
        if (this.evictingFileHashes.has(manifest.fileHash)) {
          throw new Error('Resource is currently being reclaimed');
        }
        const partialPath = this.ensurePartialFile(manifest.fileHash);
        const file = await fs.promises.open(partialPath, 'r+');
        try {
          await file.write(bytes, 0, bytes.length, startByte);
        } finally {
          await file.close();
        }
        committed = true;
      } finally {
        releaseDiskReservation(committed);
      }
      if (this.closed) throw new Error('Resource store closed while writing byte range');
      if (this.evictingFileHashes.has(manifest.fileHash)) {
        throw new Error('Resource is currently being reclaimed');
      }
      const completedBytes = this.recordCompletedRange(
        manifest.fileHash,
        startByte,
        endByteExclusive
      );
      this.db.prepare(`
        UPDATE reticulum_resources SET resident_bytes = ?, updated_at = ? WHERE file_hash = ?
      `).run(completedBytes, this.now(), manifest.fileHash);
    } finally {
      releaseOperation();
    }
  }

  private async ensurePhysicalDiskCapacity(additionalBytes: number): Promise<void> {
    const required = Math.max(0, Math.floor(additionalBytes));
    if (required <= 0) return;
    const initialCapacity = this.getPhysicalWriteCapacity(required);
    if (initialCapacity == null || initialCapacity.writableBytes >= required) return;
    try {
      this.physicalReclaimBytes = Math.max(
        this.physicalReclaimBytes,
        initialCapacity.reclaimBytes
      );
      await this.cleanupStorage('physical_disk_pressure');
      this.diskSpaceCache = null;
      let afterCleanup = this.getPhysicalWriteCapacity(required);
      if (afterCleanup != null && afterCleanup.writableBytes < required) {
        this.physicalReclaimBytes = Math.max(
          this.physicalReclaimBytes,
          afterCleanup.reclaimBytes
        );
        await this.cleanupStorage('physical_disk_pressure_retry');
        this.diskSpaceCache = null;
        afterCleanup = this.getPhysicalWriteCapacity(required);
      }
      if (afterCleanup != null && afterCleanup.writableBytes < required) {
        throw new ReticulumResourceDiskSpaceError(
          required,
          afterCleanup.writableBytes,
          afterCleanup.reserveBytes
        );
      }
    } finally {
      this.physicalReclaimBytes = 0;
    }
  }

  private async reservePhysicalDisk(
    additionalBytes: number
  ): Promise<(committed: boolean) => void> {
    const required = Math.max(0, Math.floor(additionalBytes));
    let unlockAdmission!: () => void;
    const previousAdmission = this.diskAdmissionTail;
    this.diskAdmissionTail = new Promise<void>((resolve) => {
      unlockAdmission = resolve;
    });
    await previousAdmission;
    try {
      await this.ensurePhysicalDiskCapacity(required);
      this.pendingPhysicalWriteBytes += required;
    } finally {
      unlockAdmission();
    }
    let released = false;
    return (committed: boolean) => {
      if (released) return;
      released = true;
      this.pendingPhysicalWriteBytes = Math.max(
        0,
        this.pendingPhysicalWriteBytes - required
      );
      if (!committed) {
        this.diskSpaceCache = null;
        return;
      }
      if (this.diskSpaceCache?.space != null) {
        this.diskSpaceCache.space.availableBytes = Math.max(
          0,
          this.diskSpaceCache.space.availableBytes - required
        );
      }
    };
  }

  private getPhysicalWriteCapacity(requiredBytes: number): {
    writableBytes: number;
    reclaimBytes: number;
    reserveBytes: number;
  } | null {
    const space = this.getPhysicalDiskSpace();
    if (space == null) return null;
    const availableAfterPending = space.availableBytes - this.pendingPhysicalWriteBytes;
    const required = Math.max(0, Math.floor(requiredBytes));
    return {
      writableBytes: Math.max(0, availableAfterPending - space.reserveBytes),
      reclaimBytes: Math.max(
        0,
        required + space.reserveBytes - availableAfterPending
      ),
      reserveBytes: space.reserveBytes,
    };
  }

  private getPhysicalDiskSpace(): PhysicalDiskSpace | null {
    const now = this.now();
    if (this.diskSpaceCache && now - this.diskSpaceCache.checkedAt < DISK_SPACE_CACHE_MS) {
      return this.diskSpaceCache.space;
    }
    let space: PhysicalDiskSpace | null = null;
    try {
      const stats = fs.statfsSync(this.rootDir);
      const blockSize = Math.max(0, Number(stats.bsize));
      const totalBytes = Math.max(0, Number(stats.blocks) * blockSize);
      space = {
        availableBytes: Math.max(0, Number(stats.bavail) * blockSize),
        reserveBytes: getReticulumResourceFreeDiskReserveBytes(totalBytes),
      };
    } catch {
      space = null;
    }
    this.diskSpaceCache = { checkedAt: now, space };
    return space;
  }

  async readAndHashFile(filePath: string): Promise<{ bytes: Buffer; hash: string }> {
    const workerResult = await this.workerPool.run(
      { kind: 'read_and_hash_file', path: filePath },
      1
    );
    if (workerResult?.ok && workerResult.bytes && workerResult.hash) {
      return { bytes: Buffer.from(workerResult.bytes), hash: workerResult.hash };
    }
    if (workerResult?.ok === false) throw new Error(workerResult.error);
    throw new Error('Resource worker unavailable while reading transfer data');
  }

  readByteRange(fileHash: string, startByte: number, endByteExclusive: number): {
    path: string;
    sizeBytes: number;
    sha256: string;
  } {
    const manifest = this.getManifest(fileHash);
    if (!manifest) throw new Error('Unknown resource manifest');
    const leaseId = this.acquireLease(manifest.fileHash, 'seed', 60_000);
    try {
      this.validateRange(manifest, startByte, endByteExclusive);
      const sourcePath = this.assembleResource(manifest.fileHash, false);
      this.touchServed(manifest.fileHash);
      const sizeBytes = endByteExclusive - startByte;
      const tempPath = this.createPlaintextTempPath(
        manifest.fileHash,
        `.range-${startByte}-${endByteExclusive}.bin`
      );
      const source = fs.openSync(sourcePath, 'r');
      const out = fs.openSync(tempPath, 'w');
      const hash = nodeCrypto.createHash('sha256');
      const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, sizeBytes)));
      let remaining = sizeBytes;
      let offset = startByte;
      try {
        while (remaining > 0) {
          const readSize = Math.min(buffer.length, remaining);
          const bytesRead = fs.readSync(source, buffer, 0, readSize, offset);
          if (bytesRead <= 0) throw new Error('Unexpected EOF while reading range');
          const slice = buffer.subarray(0, bytesRead);
          fs.writeSync(out, slice);
          hash.update(slice);
          remaining -= bytesRead;
          offset += bytesRead;
        }
      } finally {
        fs.closeSync(source);
        fs.closeSync(out);
      }
      return {
        path: tempPath,
        sizeBytes,
        sha256: hash.digest('hex'),
      };
    } finally {
      if (!this.closed) this.releaseLease(leaseId);
    }
  }

  async readByteRangeAsync(
    fileHash: string,
    startByte: number,
    endByteExclusive: number
  ): Promise<{ path: string; sizeBytes: number; sha256: string }> {
    const manifest = this.getManifest(fileHash);
    if (!manifest) throw new Error('Unknown resource manifest');
    const leaseId = this.acquireLease(manifest.fileHash, 'seed', 60_000);
    let tempPath = '';
    try {
      this.validateRange(manifest, startByte, endByteExclusive);
      const sourcePath = await this.assembleResourceAsync(manifest.fileHash, false);
      this.touchServed(manifest.fileHash);
      tempPath = this.createPlaintextTempPath(
        manifest.fileHash,
        `.range-${startByte}-${endByteExclusive}.bin`
      );
      const workerResult = await this.workerPool.run(
        {
          kind: 'write_range_file',
          sourcePath,
          destinationPath: tempPath,
          startByte,
          endByteExclusive,
        },
        1
      );
      if (!workerResult) throw new Error('Resource worker unavailable while serving byte range');
      if (workerResult.ok === false) throw new Error(workerResult.error);
      if (!workerResult.hash || workerResult.sizeBytes !== endByteExclusive - startByte) {
        throw new Error('Resource worker returned an invalid byte range');
      }
      return {
        path: tempPath,
        sizeBytes: workerResult.sizeBytes,
        sha256: workerResult.hash,
      };
    } catch (error) {
      if (tempPath) await fs.promises.rm(tempPath, { force: true });
      throw error;
    } finally {
      if (!this.closed) this.releaseLease(leaseId);
    }
  }

  discardResourceDataAsync(fileHash: string): Promise<void> {
    const normalizedHash = String(fileHash || '').trim().toLowerCase();
    if (!normalizedHash) return Promise.resolve();
    const existing = this.pendingDiscards.get(normalizedHash);
    if (existing) return existing;
    const pending = this.discardResourceDataWithWorker(normalizedHash).finally(() => {
      this.pendingDiscards.delete(normalizedHash);
    });
    this.pendingDiscards.set(normalizedHash, pending);
    return pending;
  }

  private async discardResourceDataWithWorker(fileHash: string): Promise<void> {
    while (!this.closed && this.evictingFileHashes.has(fileHash)) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    if (this.closed) return;
    const manifest = this.getManifest(fileHash);
    if (!manifest) return;
    const row = this.stmtGetResource.get(manifest.fileHash) as ResourceRow | undefined;
    this.evictingFileHashes.add(manifest.fileHash);
    try {
      while (!this.closed && (this.activeResourceOperations.get(manifest.fileHash) ?? 0) > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      if (this.closed) return;
      const paths = new Set<string>([
        this.blobDir(manifest.fileHash),
        ...(row?.partial_path ? [row.partial_path] : []),
        ...(row?.assembled_path ? [row.assembled_path] : []),
      ]);
      const workerResult = await this.workerPool.run(
        { kind: 'delete_paths', paths: [...paths] },
        1
      );
      if (!workerResult || workerResult.ok === false) {
        for (const candidatePath of paths) {
          await fs.promises.rm(candidatePath, { recursive: true, force: true });
        }
      }
      if (this.closed) return;
      const now = this.now();
      this.db.transaction(() => {
        this.stmtDeleteRanges.run(manifest.fileHash);
        this.stmtUpdateResourceStatus.run('pending', null, null, now, null, manifest.fileHash);
        this.db.prepare(`
          UPDATE reticulum_resources SET resident_bytes = 0, updated_at = ? WHERE file_hash = ?
        `).run(now, manifest.fileHash);
      })();
    } finally {
      this.evictingFileHashes.delete(manifest.fileHash);
    }
  }

  assembleResource(fileHash: string, recordAccess = true): string {
    const manifest = this.getManifest(fileHash);
    if (!manifest) throw new Error('Unknown resource manifest');
    if (this.evictingFileHashes.has(manifest.fileHash)) {
      throw new Error('Resource is currently being reclaimed');
    }
    const row = this.stmtGetResource.get(manifest.fileHash) as ResourceRow | undefined;
    const verifiedPath = this.getVerifiedAssembledPath(
      manifest.fileHash,
      recordAccess
    );
    if (verifiedPath) return verifiedPath;
    if (row?.assembled_path && fs.existsSync(row.assembled_path)) {
      try {
        const stat = fs.statSync(row.assembled_path);
        if (stat.isFile() && stat.size === manifest.sizeBytes) {
          const actualFileHash = sha256File(row.assembled_path);
          if (actualFileHash === manifest.fileHash.toLowerCase()) {
            const now = this.now();
            this.stmtUpdateResourceStatus.run(
              'complete',
              row.assembled_path,
              null,
              now,
              row.final_verified_at ?? now,
              manifest.fileHash
            );
            this.db.prepare(`
              UPDATE reticulum_resources SET resident_bytes = ?, updated_at = ? WHERE file_hash = ?
            `).run(manifest.sizeBytes, now, manifest.fileHash);
            if (recordAccess) this.touchAccess(manifest.fileHash);
            return row.assembled_path;
          }
        }
      } catch {
        // Fall through and verify the partial file if present.
      }
    }
    const partialPath = row?.partial_path || this.partialPath(manifest);
    if (!fs.existsSync(partialPath)) {
      throw new Error('Resource has no partial file');
    }
    const ranges = this.getCompletedRanges(manifest.fileHash);
    if (!this.rangesCoverFile(ranges, manifest.sizeBytes)) {
      throw new Error('Resource has missing byte ranges');
    }
    const stat = fs.statSync(partialPath);
    if (!stat.isFile() || stat.size !== manifest.sizeBytes) {
      throw new Error('Partial file size mismatch');
    }
    const actualFileHash = sha256File(partialPath);
    if (actualFileHash !== manifest.fileHash.toLowerCase()) {
      throw new Error('Assembled file hash mismatch');
    }
    const assembledPath = this.assembledPath(manifest);
    const tempPath = `${assembledPath}.${process.pid}.${Date.now()}.tmp`;
    fs.mkdirSync(path.dirname(assembledPath), { recursive: true });
    fs.copyFileSync(partialPath, tempPath);
    fs.renameSync(tempPath, assembledPath);
    fs.rmSync(partialPath, { force: true });
    this.stmtUpdateResourceStatus.run(
      'complete',
      assembledPath,
      null,
      this.now(),
      this.now(),
      manifest.fileHash
    );
    this.db.prepare(`
      UPDATE reticulum_resources
      SET retention_until = MAX(COALESCE(retention_until, 0), ?)
      WHERE file_hash = ? AND provenance <> 'local_authored'
    `).run(this.now() + COMPLETED_DOWNLOAD_RETENTION_MS, manifest.fileHash);
    this.db.prepare(`
      UPDATE reticulum_resources SET resident_bytes = ?, updated_at = ? WHERE file_hash = ?
    `).run(manifest.sizeBytes, this.now(), manifest.fileHash);
    this.scheduleCleanup('resource_assembled');
    if (recordAccess) this.touchAccess(manifest.fileHash);
    return assembledPath;
  }

  assembleResourceAsync(fileHash: string, recordAccess = true): Promise<string> {
    const normalizedHash = String(fileHash || '').trim().toLowerCase();
    const existing = this.pendingAssemblies.get(normalizedHash);
    const pending =
      existing ??
      this.finalizeResourceWithProtection(normalizedHash).finally(() => {
        this.pendingAssemblies.delete(normalizedHash);
      });
    if (!existing) this.pendingAssemblies.set(normalizedHash, pending);
    return pending.then((assembledPath) => {
      if (recordAccess) this.touchAccess(normalizedHash);
      return assembledPath;
    });
  }

  private async finalizeResourceWithProtection(fileHash: string): Promise<string> {
    const releaseOperation = this.beginResourceOperation(fileHash);
    let leaseId: string | null = null;
    try {
      leaseId = this.acquireLease(fileHash, 'assembly', RESOURCE_OPERATION_LEASE_MS);
      return await this.finalizeResourceWithWorker(fileHash);
    } finally {
      if (leaseId && !this.closed) this.releaseLease(leaseId);
      releaseOperation();
    }
  }

  private async finalizeResourceWithWorker(fileHash: string): Promise<string> {
    const manifest = this.getManifest(fileHash);
    if (!manifest) throw new Error('Unknown resource manifest');
    if (this.evictingFileHashes.has(manifest.fileHash)) {
      throw new Error('Resource is currently being reclaimed');
    }
    const verifiedPath = this.getVerifiedAssembledPath(manifest.fileHash, false);
    if (verifiedPath) return verifiedPath;
    const row = this.stmtGetResource.get(manifest.fileHash) as ResourceRow | undefined;
    const sourcePath = row?.assembled_path && fs.existsSync(row.assembled_path)
      ? row.assembled_path
      : row?.partial_path || this.partialPath(manifest);
    if (!fs.existsSync(sourcePath)) throw new Error('Resource has no partial file');
    if (sourcePath !== row?.assembled_path) {
      const ranges = this.getCompletedRanges(manifest.fileHash);
      if (!this.rangesCoverFile(ranges, manifest.sizeBytes)) {
        throw new Error('Resource has missing byte ranges');
      }
    }
    const assembledPath = this.assembledPath(manifest);
    const workerResult = await this.workerPool.run(
      {
        kind: 'finalize_resource',
        sourcePath,
        destinationPath: assembledPath,
        expectedHash: manifest.fileHash,
        expectedSize: manifest.sizeBytes,
        moveSource: sourcePath !== assembledPath,
      },
      1
    );
    if (!workerResult) throw new Error('Resource worker unavailable during assembly');
    if (workerResult.ok === false) throw new Error(workerResult.error);
    if (sourcePath !== assembledPath) {
      await fs.promises.rm(sourcePath, { force: true });
    }
    if (this.closed) throw new Error('Resource store closed during assembly');
    if (this.evictingFileHashes.has(manifest.fileHash)) {
      throw new Error('Resource was reclaimed during assembly');
    }
    const now = this.now();
    this.db.transaction(() => {
      this.stmtUpdateResourceStatus.run(
        'complete',
        assembledPath,
        null,
        now,
        now,
        manifest.fileHash
      );
      this.db.prepare(`
        UPDATE reticulum_resources
        SET resident_bytes = ?,
            retention_until = CASE
              WHEN provenance = 'local_authored' THEN retention_until
              ELSE MAX(COALESCE(retention_until, 0), ?)
            END,
            updated_at = ?
        WHERE file_hash = ?
      `).run(
        manifest.sizeBytes,
        now + COMPLETED_DOWNLOAD_RETENTION_MS,
        now,
        manifest.fileHash
      );
      this.stmtDeleteRanges.run(manifest.fileHash);
    })();
    this.scheduleCleanup('resource_assembled');
    return assembledPath;
  }

  createPlaintextTempPath(fileHash: string, extension = ''): string {
    const manifest = this.getManifest(fileHash);
    const suffix = extension || path.extname(manifest?.fileName || '') || '.bin';
    const safeSuffix = suffix.startsWith('.') ? suffix : `.${suffix}`;
    const tempDir = path.join(this.tempDir, 'qortal-reticulum-resources');
    fs.mkdirSync(tempDir, { recursive: true });
    return path.join(
      tempDir,
      `${fileHash}-${nodeCrypto.randomBytes(6).toString('hex')}${safeSuffix}`
    );
  }

  private reconcileResidentState(): void {
    if (this.closed || this.reconciliationPending) return;
    const hasResources = this.db.prepare(
      'SELECT 1 AS present FROM reticulum_resources LIMIT 1'
    ).get() as { present?: number } | undefined;
    if (!hasResources) return;
    this.reconciliationReady = false;
    this.reconciliationPending = true;
    let succeeded = false;
    this.reconciliationPromise = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.reconcileResidentStateInWorker())
      .then(() => {
        succeeded = true;
        this.reconciliationReady = true;
      })
      .catch((error) => {
        loggerWarn('[ReticulumResourceStore] resident_reconcile_worker_failed', error);
      }).finally(() => {
        this.reconciliationPending = false;
        this.reconciliationPromise = null;
        if (this.closed) return;
        if (succeeded) {
          this.scheduleCleanup('startup_maintenance');
          return;
        }
        this.reconciliationRetryTimer = setTimeout(() => {
          this.reconciliationRetryTimer = null;
          this.reconcileResidentState();
        }, STARTUP_RECONCILE_RETRY_MS);
        this.reconciliationRetryTimer.unref?.();
      });
  }

  private async reconcileResidentStateInWorker(): Promise<void> {
    let corrected = 0;
    let afterFileHash = '';
    while (!this.closed) {
      const rows = this.db.prepare(`
        SELECT * FROM reticulum_resources
        WHERE file_hash > ?
        ORDER BY file_hash LIMIT ?
      `).all(afterFileHash, STARTUP_RECONCILE_BATCH_SIZE) as ResourceRow[];
      if (rows.length === 0) break;
      const entries = rows.map((row) => {
        const manifest = rowToManifest(row);
        return {
          fileHash: row.file_hash,
          assembledPath: row.assembled_path || this.assembledPath(manifest),
          partialPath: row.partial_path || this.partialPath(manifest),
          expectedSize: manifest.sizeBytes,
          expectedHash: manifest.fileHash,
          expectComplete: row.status === 'complete' && Boolean(row.final_verified_at),
        };
      });
      const result = await this.workerPool.run({ kind: 'inspect_paths', entries }, 3);
      if (this.closed) return;
      if (!result || result.ok === false || !result.inspections) {
        throw new Error(
          result?.ok === false ? result.error : 'Resource worker unavailable during reconciliation'
        );
      }
      const inspections = new Map(result.inspections.map((item) => [item.fileHash, item]));
      for (const row of rows) {
        const inspection = inspections.get(row.file_hash);
        if (!inspection) continue;
        corrected += this.applyResidentInspection(
          row,
          inspection.assembledValid,
          inspection.partialExists
        );
      }
      afterFileHash = rows[rows.length - 1]?.file_hash ?? afterFileHash;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (corrected > 0) {
      loggerLog(`[ReticulumResourceStore] resident_state_reconciled resources=${corrected}`);
    }
  }

  private applyResidentInspection(
    row: ResourceRow,
    assembledValid: boolean,
    partialExists: boolean
  ): number {
    const manifest = rowToManifest(row);
    const assembledPath = row.assembled_path || this.assembledPath(manifest);
    if (assembledValid) {
      if (
        row.assembled_path === assembledPath &&
        row.partial_path === null &&
        Number(row.resident_bytes || 0) === manifest.sizeBytes
      ) return 0;
      const now = this.now();
      this.stmtUpdateResourceStatus.run(
        'complete', assembledPath, null, now, row.final_verified_at ?? now, row.file_hash
      );
      this.db.prepare(`
        UPDATE reticulum_resources SET resident_bytes = ?, updated_at = ? WHERE file_hash = ?
      `).run(manifest.sizeBytes, now, row.file_hash);
      this.stmtDeleteRanges.run(row.file_hash);
      const stalePaths = [this.rangeStatePath(row.file_hash)];
      if (row.partial_path && row.partial_path !== assembledPath) stalePaths.push(row.partial_path);
      void this.workerPool.run({ kind: 'delete_paths', paths: stalePaths }, 4);
      return 1;
    }
    const partialPath = row.partial_path || this.partialPath(manifest);
    if (!partialExists) this.stmtDeleteRanges.run(row.file_hash);
    const rangeTotal = partialExists
      ? this.db.prepare(`
          SELECT COALESCE(SUM(end_byte_exclusive - start_byte), 0) AS bytes
          FROM reticulum_resource_ranges
          WHERE file_hash = ? AND status = 'complete'
        `).get(row.file_hash) as { bytes?: number } | undefined
      : undefined;
    const residentBytes = partialExists
      ? Math.min(manifest.sizeBytes, Math.max(0, Number(rangeTotal?.bytes || 0)))
      : 0;
    const nextPartialPath = partialExists ? partialPath : null;
    if (
      row.status === 'pending' && row.assembled_path === null &&
      row.partial_path === nextPartialPath && row.final_verified_at === null &&
      Number(row.resident_bytes || 0) === residentBytes
    ) return 0;
    const now = this.now();
    this.stmtUpdateResourceStatus.run(
      'pending', null, nextPartialPath, now, null, row.file_hash
    );
    this.db.prepare(`
      UPDATE reticulum_resources SET resident_bytes = ?, updated_at = ? WHERE file_hash = ?
    `).run(residentBytes, now, row.file_hash);
    return 1;
  }

  private normalizePolicy(
    policy: Partial<ReticulumResourceStoragePolicy> = {}
  ): ReticulumResourceStoragePolicy {
    const limitBytes = Math.max(
      RETICULUM_RESOURCE_MIN_LIMIT_BYTES,
      Math.floor(Number(policy.limitBytes) || RETICULUM_RESOURCE_DEFAULT_LIMIT_BYTES)
    );
    const lowWatermarkRatio = Math.min(
      0.95,
      Math.max(0.5, Number(policy.lowWatermarkRatio) || DEFAULT_LOW_WATERMARK_RATIO)
    );
    const authoredCapRatio = Math.min(
      0.8,
      Math.max(0.2, Number(policy.authoredCapRatio) || DEFAULT_AUTHORED_CAP_RATIO)
    );
    const remoteGuaranteeRatio = Math.min(
      0.6,
      Math.max(0.1, Number(policy.remoteGuaranteeRatio) || DEFAULT_REMOTE_GUARANTEE_RATIO)
    );
    const transferReserveRatio = Math.min(
      0.3,
      Math.max(0.05, Number(policy.transferReserveRatio) || DEFAULT_TRANSFER_RESERVE_RATIO)
    );
    return {
      limitBytes,
      lowWatermarkRatio,
      authoredCapRatio,
      remoteGuaranteeRatio,
      transferReserveRatio,
      stalePartialAgeMs: Math.max(
        60 * 60_000,
        Math.floor(Number(policy.stalePartialAgeMs) || DEFAULT_STALE_PARTIAL_AGE_MS)
      ),
    };
  }

  private getProvenance(fileHash: string): ReticulumResourceProvenance | null {
    const row = this.db.prepare(`
      SELECT provenance FROM reticulum_resources WHERE file_hash = ?
    `).get(fileHash) as { provenance: ReticulumResourceProvenance } | undefined;
    return row?.provenance ?? null;
  }

  private touchAccess(fileHash: string): void {
    const now = this.now();
    const last = this.lastAccessTouch.get(fileHash) ?? 0;
    if (now - last < ACCESS_TOUCH_INTERVAL_MS) return;
    this.lastAccessTouch.set(fileHash, now);
    this.db.prepare(`
      UPDATE reticulum_resources
      SET last_accessed_at = ?, access_count = access_count + 1
      WHERE file_hash = ?
    `).run(now, fileHash);
  }

  private touchServed(fileHash: string): void {
    const now = this.now();
    // Serving is tracked separately from a local open. The receiver confirms
    // its complete replica after transfer, so treating that transfer as local
    // use would make the 30-day recovery threshold and 24-hour confirmation
    // window mutually exclusive.
    this.db.prepare(`
      UPDATE reticulum_resources
      SET last_served_at = ?, access_count = access_count + 1
      WHERE file_hash = ?
    `).run(now, fileHash);
  }

  private pruneTransientState(): void {
    const now = this.now();
    this.db.prepare('DELETE FROM reticulum_resource_leases WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM reticulum_resource_reservations WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM reticulum_resource_providers WHERE retention_until <= ?').run(now);
    this.db.prepare(`
      UPDATE reticulum_resources SET retention_until = NULL
      WHERE retention_until IS NOT NULL AND retention_until <= ?
    `).run(now);
    this.db.prepare(`
      UPDATE reticulum_resource_refs
      SET state = 'expired', updated_at = ?
      WHERE state = 'live' AND expires_at IS NOT NULL AND expires_at <= ?
    `).run(now, now);
  }

  private assertAdmissionCapacity(
    sizeBytes: number,
    provenance: ReticulumResourceProvenance,
    residentDeltaBytes = sizeBytes
  ): void {
    if (sizeBytes <= 0) return;
    const stats = this.readStorageStats();
    const status = stats
      ? this.storageStatusFromStats(stats)
      : this.getLegacyStorageStatus();
    const alreadyReserved = status.reservedBytes;
    const totalAfter =
      status.totalResidentBytes +
      alreadyReserved +
      this.pendingAuthoredResidentBytes +
      Math.max(0, Math.floor(residentDeltaBytes));
    if (provenance !== 'local_authored') {
      if (totalAfter > this.policy.limitBytes) {
        this.scheduleCleanup('incoming_download_soft_limit');
      }
      return;
    }
    const authoredCap = Math.floor(this.policy.limitBytes * this.policy.authoredCapRatio);
    if (
      status.authoredResidentBytes +
        this.pendingAuthoredImportBytes +
        sizeBytes > authoredCap
    ) {
      this.blockedAuthoredPublishes += 1;
      this.scheduleCleanup('authored_admission_blocked');
      throw new Error(
        'Reticulum attachment storage reserved for authored files is full. ' +
          'Remove old attachments or increase the storage limit.'
      );
    }
    const localAdmissionCeiling = Math.floor(
      this.policy.limitBytes * (1 - this.policy.transferReserveRatio)
    );
    if (totalAfter > localAdmissionCeiling) {
      this.blockedAuthoredPublishes += 1;
      this.scheduleCleanup('transfer_reserve_protected');
      throw new Error(
        'Reticulum attachment storage is preserving capacity for incoming downloads. ' +
          'Remove old attachments or increase the storage limit.'
      );
    }
    if (totalAfter > this.policy.limitBytes) {
      this.blockedAuthoredPublishes += 1;
      this.scheduleCleanup('storage_admission_blocked');
      throw new Error('Reticulum attachment storage limit reached');
    }
  }

  private reserveAuthoredImport(
    fileHash: string,
    sizeBytes: number,
    residentBytes: number
  ): () => void {
    const normalizedHash = String(fileHash || '').trim().toLowerCase();
    const existing = this.pendingAuthoredImports.get(normalizedHash);
    if (existing) {
      existing.references += 1;
      return this.authoredImportRelease(normalizedHash);
    }
    const normalizedSize = Math.max(0, Math.floor(sizeBytes));
    const normalizedResident = Math.max(0, Math.floor(residentBytes));
    this.assertAdmissionCapacity(normalizedSize, 'local_authored', normalizedResident);
    this.pendingAuthoredImports.set(normalizedHash, {
      sizeBytes: normalizedSize,
      residentBytes: normalizedResident,
      references: 1,
    });
    this.pendingAuthoredImportBytes += normalizedSize;
    this.pendingAuthoredResidentBytes += normalizedResident;
    return this.authoredImportRelease(normalizedHash);
  }

  private authoredImportRelease(fileHash: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const pending = this.pendingAuthoredImports.get(fileHash);
      if (!pending) return;
      pending.references -= 1;
      if (pending.references > 0) return;
      this.pendingAuthoredImports.delete(fileHash);
      this.pendingAuthoredImportBytes = Math.max(
        0,
        this.pendingAuthoredImportBytes - pending.sizeBytes
      );
      this.pendingAuthoredResidentBytes = Math.max(
        0,
        this.pendingAuthoredResidentBytes - pending.residentBytes
      );
    };
  }

  private getManagedRowsWithState(): CleanupCandidate[] {
    const now = this.now();
    return this.db.prepare(`
      SELECT r.*,
        (SELECT COUNT(*) FROM reticulum_resource_refs ref
          WHERE ref.file_hash = r.file_hash AND ref.event_id <> '' AND ref.state = 'live'
            AND (ref.expires_at IS NULL OR ref.expires_at > ?)) AS live_ref_count,
        (SELECT COUNT(DISTINCT p.provider_id) FROM reticulum_resource_providers p
          WHERE p.file_hash = r.file_hash AND p.retention_until > ?) AS provider_count,
        (SELECT COUNT(*) FROM reticulum_resource_leases l
          WHERE l.file_hash = r.file_hash AND l.expires_at > ?) AS active_lease_count
      FROM reticulum_resources r
      WHERE r.managed = 1
    `).all(now, now, now) as CleanupCandidate[];
  }

  private getManagedRowWithState(fileHash: string): CleanupCandidate | null {
    const now = this.now();
    const row = this.db.prepare(`
      SELECT r.*,
        (SELECT COUNT(*) FROM reticulum_resource_refs ref
          WHERE ref.file_hash = r.file_hash AND ref.event_id <> '' AND ref.state = 'live'
            AND (ref.expires_at IS NULL OR ref.expires_at > ?)) AS live_ref_count,
        (SELECT COUNT(DISTINCT p.provider_id) FROM reticulum_resource_providers p
          WHERE p.file_hash = r.file_hash AND p.retention_until > ?) AS provider_count,
        (SELECT COUNT(*) FROM reticulum_resource_leases l
          WHERE l.file_hash = r.file_hash AND l.expires_at > ?) AS active_lease_count
      FROM reticulum_resources r
      WHERE r.file_hash = ? AND r.managed = 1
      LIMIT 1
    `).get(now, now, now, fileHash) as CleanupCandidate | undefined;
    return row ?? null;
  }

  private isProtectedCandidate(row: CleanupCandidate): boolean {
    const now = this.now();
    return (
      row.active_lease_count > 0 ||
      Number(row.retention_until || 0) > now
    );
  }

  private cleanupTier(row: CleanupCandidate): number | null {
    if (row.resident_bytes <= 0) return null;
    const now = this.now();
    if (
      row.status !== 'complete' &&
      now - row.updated_at >= this.policy.stalePartialAgeMs
    ) return 1;
    if (row.live_ref_count === 0) return 2;
    if (row.provenance !== 'local_authored' && !row.last_accessed_at) return 4;
    if (row.provenance !== 'local_authored' && row.provider_count > 0) return 5;
    if (row.provenance !== 'local_authored') return 6;
    const authoredLastUseAt = Math.max(
      Number(row.created_at || 0),
      Number(row.last_accessed_at || 0)
    );
    if (
      row.status === 'complete' &&
      row.provider_count > 0 &&
      now - authoredLastUseAt >=
        RETICULUM_RESOURCE_AUTHORED_RECOVERY_MIN_IDLE_MS
    ) {
      // Provider receipts are short-lived confirmations that another peer has
      // the complete bytes. Prefer two or more replicas; one remains the final
      // cleanup tier after all remote-cache candidates.
      return row.provider_count >= 2 ? 7 : 8;
    }
    return null;
  }

  private cleanupSortAccessAt(row: CleanupCandidate): number {
    if (row.provenance === 'local_authored') {
      return Math.max(
        Number(row.created_at || 0),
        Number(row.last_accessed_at || 0)
      );
    }
    return Number(row.last_accessed_at || row.updated_at || 0);
  }

  private scheduleCleanup(reason: string): void {
    if (
      this.closed ||
      this.reconciliationPending ||
      this.cleanupPromise ||
      this.cleanupScheduled
    ) return;
    this.cleanupScheduled = true;
    setImmediate(() => {
      this.cleanupScheduled = false;
      if (this.closed) return;
      void this.cleanupStorage(reason).catch((error) => {
        loggerWarn(`[ReticulumResourceStore] cleanup_failed reason=${reason}`, error);
      });
    });
  }

  private considerExpirationAt(expiresAt: number): void {
    if (this.closed || !Number.isFinite(expiresAt) || expiresAt <= 0) return;
    if (this.nextExpirationAt != null && this.nextExpirationAt <= expiresAt) return;
    if (this.expirationTimer) clearTimeout(this.expirationTimer);
    this.nextExpirationAt = expiresAt;
    const delay = Math.max(1_000, Math.min(2_147_000_000, expiresAt - this.now()));
    this.expirationTimer = setTimeout(() => {
      this.expirationTimer = null;
      this.nextExpirationAt = null;
      if (this.closed) return;
      void this.cleanupStorage('expiry_maintenance').finally(() => {
        if (!this.closed) this.scheduleNextExpirationMaintenance();
      });
    }, delay);
    this.expirationTimer.unref?.();
  }

  private scheduleNextExpirationMaintenance(): void {
    const row = this.db.prepare(`
      SELECT MIN(expiry_at) AS expiry_at FROM (
        SELECT MIN(expires_at) AS expiry_at FROM reticulum_resource_leases
        UNION ALL
        SELECT MIN(expires_at) AS expiry_at FROM reticulum_resource_reservations
        UNION ALL
        SELECT MIN(expires_at) AS expiry_at FROM reticulum_resource_refs
          WHERE state = 'live' AND expires_at IS NOT NULL
        UNION ALL
        SELECT MIN(retention_until) AS expiry_at FROM reticulum_resource_providers
        UNION ALL
        SELECT MIN(retention_until) AS expiry_at FROM reticulum_resources
          WHERE managed = 1 AND retention_until IS NOT NULL
        UNION ALL
        SELECT MIN(updated_at + ?) AS expiry_at FROM reticulum_resources
          WHERE managed = 1 AND status <> 'complete' AND resident_bytes > 0
            AND updated_at + ? > ?
      ) WHERE expiry_at IS NOT NULL
    `).get(
      this.policy.stalePartialAgeMs,
      this.policy.stalePartialAgeMs,
      this.now()
    ) as { expiry_at?: number | null } | undefined;
    if (Number.isFinite(row?.expiry_at)) this.considerExpirationAt(Number(row?.expiry_at));
  }

  private async runCleanup(reason: string): Promise<ReticulumResourceCleanupResult> {
    if (this.reconciliationPromise) await this.reconciliationPromise;
    const startedAt = this.now();
    if (!this.reconciliationReady) {
      const bytes = this.getStorageStatus().totalResidentBytes;
      return {
        startedAt,
        completedAt: this.now(),
        beforeBytes: bytes,
        afterBytes: bytes,
        freedBytes: 0,
        evictedBlobs: 0,
        reason,
      };
    }
    this.pruneTransientState();
    this.markDueCleanupStateDirty();
    await this.ensureCleanupStateFresh();
    const initial = this.getStorageStatus();
    const targetBytes = Math.floor(this.policy.limitBytes * this.policy.lowWatermarkRatio);
    const authoredTargetBytes = Math.floor(
      this.policy.limitBytes * this.policy.authoredCapRatio * 0.9
    );
    const remoteFloor = Math.floor(this.policy.limitBytes * this.policy.remoteGuaranteeRatio);
    let currentBytes = initial.totalResidentBytes;
    let authoredBytes = initial.authoredResidentBytes;
    let remoteBytes = initial.remoteResidentBytes;
    let freedBytes = 0;
    let evictedBlobs = 0;
    let candidateCursor: CleanupCursor | null = null;
    let finished = false;
    for (;;) {
      const candidates = this.getCleanupCandidateBatch(candidateCursor, 64);
      if (candidates.length === 0) break;
      candidateCursor = candidates[candidates.length - 1].cursor;
      for (const candidate of candidates) {
        if (this.closed) break;
        const row = this.getManagedRowWithState(candidate.row.file_hash);
        const physicalCleanupNeeded = freedBytes < this.physicalReclaimBytes;
        if (
          !row ||
          row.active_lease_count > 0 ||
          (!physicalCleanupNeeded && Number(row.retention_until || 0) > this.now())
        ) continue;
        const tier = this.cleanupTier(row);
        if (tier == null) continue;
        const staleOrUnreferenced = tier <= 2;
        const isRemote = row.provenance !== 'local_authored';
        const authoredCleanupNeeded = authoredBytes > authoredTargetBytes;
        const authoredPoolNeedsCleanup =
          !isRemote && row.provider_count > 0 && authoredCleanupNeeded;
        if (
          !staleOrUnreferenced &&
          currentBytes <= targetBytes &&
          !authoredCleanupNeeded &&
          !physicalCleanupNeeded
        ) {
          finished = true;
          break;
        }
        if (
          !staleOrUnreferenced &&
          !physicalCleanupNeeded &&
          currentBytes <= targetBytes &&
          !authoredPoolNeedsCleanup
        ) {
          continue;
        }
        if (
          isRemote &&
          !staleOrUnreferenced &&
          !physicalCleanupNeeded &&
          currentBytes <= this.policy.limitBytes &&
          remoteBytes - row.resident_bytes < remoteFloor
        ) continue;
        const removed = await this.evictResidentBytes(row);
        if (removed <= 0) continue;
        currentBytes = Math.max(0, currentBytes - removed);
        if (isRemote) remoteBytes = Math.max(0, remoteBytes - removed);
        else authoredBytes = Math.max(0, authoredBytes - removed);
        freedBytes += removed;
        evictedBlobs += 1;
      }
      if (this.closed || finished || candidates.length < 64) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.physicalReclaimBytes = Math.max(0, this.physicalReclaimBytes - freedBytes);
    this.markDueCleanupStateDirty();
    await this.ensureCleanupStateFresh();
    const completedAt = this.now();
    this.lastCleanupAt = completedAt;
    this.lastCleanupFreedBytes = freedBytes;
    if (freedBytes > 0 || initial.totalResidentBytes > this.policy.limitBytes) {
      loggerLog(
        `[ReticulumResourceStore] cleanup_complete reason=${reason} ` +
          `before=${initial.totalResidentBytes} after=${currentBytes} ` +
          `freed=${freedBytes} blobs=${evictedBlobs}`
      );
    }
    return {
      startedAt,
      completedAt,
      beforeBytes: initial.totalResidentBytes,
      afterBytes: currentBytes,
      freedBytes,
      evictedBlobs,
      reason,
    };
  }

  private getCleanupCandidateBatch(
    cursor: CleanupCursor | null,
    limit: number
  ): CleanupCandidateItem[] {
    if (this.readStorageStats()) {
      const protectionClause = this.physicalReclaimBytes > 0
        ? 's.active_lease_count = 0'
        : 's.is_protected = 0';
      const cursorClause = cursor
        ? `AND (
            s.cleanup_tier > @cursorTier
            OR (s.cleanup_tier = @cursorTier AND s.sort_access_at > @cursorAccess)
            OR (s.cleanup_tier = @cursorTier AND s.sort_access_at = @cursorAccess
                AND s.resident_bytes < @cursorResident)
            OR (s.cleanup_tier = @cursorTier AND s.sort_access_at = @cursorAccess
                AND s.resident_bytes = @cursorResident AND s.file_hash > @cursorHash)
          )`
        : '';
      const parameters = cursor
        ? {
            cursorTier: cursor.tier,
            cursorAccess: cursor.sortAccessAt,
            cursorResident: cursor.residentBytes,
            cursorHash: cursor.fileHash,
            limit: Math.max(1, Math.floor(limit)),
          }
        : { limit: Math.max(1, Math.floor(limit)) };
      const rows = this.db.prepare(`
        SELECT r.*, s.live_ref_count, s.provider_count, s.active_lease_count,
               s.cleanup_tier, s.sort_access_at AS cleanup_sort_access_at,
               s.resident_bytes AS cleanup_resident_bytes
        FROM reticulum_resource_cleanup_state s
        JOIN reticulum_resources r ON r.file_hash = s.file_hash
        WHERE ${protectionClause} AND s.cleanup_tier IS NOT NULL
          AND s.resident_bytes > 0
          ${cursorClause}
        ORDER BY s.cleanup_tier ASC, s.sort_access_at ASC,
                 s.resident_bytes DESC, s.file_hash ASC
        LIMIT @limit
      `).all(parameters) as Array<
        CleanupCandidate & {
          cleanup_tier: number;
          cleanup_sort_access_at: number;
          cleanup_resident_bytes: number;
        }
      >;
      return rows.map((row) => ({
        row,
        tier: Number(row.cleanup_tier),
        cursor: {
          tier: Number(row.cleanup_tier),
          sortAccessAt: Number(row.cleanup_sort_access_at),
          residentBytes: Number(row.cleanup_resident_bytes),
          fileHash: row.file_hash,
        },
      }));
    }
    return this.getManagedRowsWithState()
      .filter((row) =>
        row.active_lease_count === 0 &&
        (this.physicalReclaimBytes > 0 || !this.isProtectedCandidate(row))
      )
      .map((row) => {
        const tier = this.cleanupTier(row);
        return {
          row,
          tier,
          cursor: tier == null ? null : {
            tier,
            sortAccessAt: this.cleanupSortAccessAt(row),
            residentBytes: Number(row.resident_bytes || 0),
            fileHash: row.file_hash,
          },
        };
      })
      .filter(
        (item): item is CleanupCandidateItem => item.tier != null && item.cursor != null
      )
      .sort(
        (a, b) =>
          this.compareCleanupCursors(a.cursor, b.cursor)
      )
      .filter((item) => !cursor || this.compareCleanupCursors(item.cursor, cursor) > 0)
      .slice(0, limit);
  }

  private compareCleanupCursors(a: CleanupCursor, b: CleanupCursor): number {
    return (
      a.tier - b.tier ||
      a.sortAccessAt - b.sortAccessAt ||
      b.residentBytes - a.residentBytes ||
      a.fileHash.localeCompare(b.fileHash)
    );
  }

  private async evictResidentBytes(row: CleanupCandidate): Promise<number> {
    if (
      this.evictingFileHashes.has(row.file_hash) ||
      (this.activeResourceOperations.get(row.file_hash) ?? 0) > 0
    ) return 0;
    this.evictingFileHashes.add(row.file_hash);
    try {
      const expectedBytes = Math.max(0, Number(row.resident_bytes || 0));
      const manifest = rowToManifest(row);
      const paths = new Set<string>([
        this.blobDir(row.file_hash),
        ...(row.partial_path ? [row.partial_path] : []),
        ...(row.assembled_path ? [row.assembled_path] : []),
      ]);
      const pathList = [...paths];
      const workerResult = await this.workerPool.run(
        { kind: 'delete_paths', paths: pathList },
        4
      );
      if (!workerResult || !workerResult.ok) {
        for (const candidatePath of pathList) {
          try {
            await fs.promises.rm(candidatePath, { recursive: true, force: true });
          } catch (error) {
            loggerWarn(
              `[ReticulumResourceStore] cleanup_remove_failed file=${row.file_hash.slice(0, 12)}`,
              error
            );
          }
        }
      }
      const remainingDataPaths = new Set<string>();
      if (row.partial_path) remainingDataPaths.add(row.partial_path);
      if (row.assembled_path) remainingDataPaths.add(row.assembled_path);
      remainingDataPaths.add(this.partialPath(manifest));
      remainingDataPaths.add(this.assembledPath(manifest));
      if ([...remainingDataPaths].some((candidatePath) => fs.existsSync(candidatePath))) {
        return 0;
      }
      if (this.closed) return 0;
      const now = this.now();
      this.db.transaction(() => {
        this.stmtDeleteRanges.run(row.file_hash);
        this.stmtUpdateResourceStatus.run('pending', null, null, now, null, row.file_hash);
        this.db.prepare(`
          UPDATE reticulum_resources SET resident_bytes = 0, updated_at = ? WHERE file_hash = ?
        `).run(now, row.file_hash);
      })();
      return expectedBytes;
    } finally {
      this.evictingFileHashes.delete(row.file_hash);
    }
  }

  private initSchema(): boolean {
    const existing = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reticulum_resources'")
      .get() as { name: string } | undefined;
    if (existing) {
      const columns = this.db
        .prepare('PRAGMA table_info(reticulum_resources)')
        .all() as Array<{ name: string }>;
      const names = new Set(columns.map((column) => column.name));
      if (names.has('chunk_hashes') || !names.has('partial_path')) {
        this.db.exec(`
          DROP TABLE IF EXISTS reticulum_resource_chunks;
          DROP TABLE IF EXISTS reticulum_resource_ranges;
          DROP TABLE IF EXISTS reticulum_resources;
        `);
      }
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reticulum_resources (
        file_hash TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        owner_id TEXT,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        encrypted INTEGER NOT NULL,
        status TEXT NOT NULL,
        assembled_path TEXT,
        partial_path TEXT,
        metadata TEXT,
        thumbnail TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        final_verified_at INTEGER,
        provenance TEXT NOT NULL DEFAULT 'remote_downloaded',
        resident_bytes INTEGER NOT NULL DEFAULT 0,
        last_accessed_at INTEGER,
        last_served_at INTEGER,
        access_count INTEGER NOT NULL DEFAULT 0,
        retention_until INTEGER,
        managed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_reticulum_resources_namespace
        ON reticulum_resources(namespace, updated_at DESC);
      CREATE TABLE IF NOT EXISTS reticulum_resource_ranges (
        file_hash TEXT NOT NULL,
        start_byte INTEGER NOT NULL,
        end_byte_exclusive INTEGER NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(file_hash, start_byte, end_byte_exclusive),
        FOREIGN KEY(file_hash) REFERENCES reticulum_resources(file_hash) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_reticulum_resource_ranges_status
        ON reticulum_resource_ranges(file_hash, status, start_byte);
      CREATE INDEX IF NOT EXISTS idx_reticulum_resource_ranges_updated
        ON reticulum_resource_ranges(file_hash, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS reticulum_resource_group_refs (
        file_hash TEXT NOT NULL,
        group_id INTEGER NOT NULL,
        event_id TEXT NOT NULL DEFAULT '',
        owner_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(file_hash, group_id, event_id),
        FOREIGN KEY(file_hash) REFERENCES reticulum_resources(file_hash) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_reticulum_resource_group_refs_group
        ON reticulum_resource_group_refs(group_id, file_hash);
      CREATE TABLE IF NOT EXISTS reticulum_resource_refs (
        file_hash TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        owner_id TEXT,
        namespace TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        encrypted INTEGER NOT NULL,
        metadata TEXT,
        thumbnail TEXT,
        state TEXT NOT NULL DEFAULT 'live',
        locally_authored INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY(file_hash, scope_type, scope_id, event_id),
        FOREIGN KEY(file_hash) REFERENCES reticulum_resources(file_hash) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_reticulum_resource_refs_scope
        ON reticulum_resource_refs(scope_type, scope_id, state, event_id);
      CREATE INDEX IF NOT EXISTS idx_reticulum_resource_refs_file_state
        ON reticulum_resource_refs(file_hash, state);
      CREATE TABLE IF NOT EXISTS reticulum_resource_leases (
        lease_id TEXT PRIMARY KEY,
        file_hash TEXT NOT NULL,
        lease_type TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(file_hash) REFERENCES reticulum_resources(file_hash) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_reticulum_resource_leases_file
        ON reticulum_resource_leases(file_hash, expires_at);
      CREATE INDEX IF NOT EXISTS idx_reticulum_resource_leases_expiry
        ON reticulum_resource_leases(expires_at);
      CREATE TABLE IF NOT EXISTS reticulum_resource_reservations (
        reservation_id TEXT PRIMARY KEY,
        file_hash TEXT,
        provenance TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reticulum_resource_reservations_expiry
        ON reticulum_resource_reservations(expires_at);
      CREATE TABLE IF NOT EXISTS reticulum_resource_providers (
        file_hash TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        receipt_at INTEGER NOT NULL,
        retention_until INTEGER NOT NULL,
        last_confirmed_at INTEGER NOT NULL,
        PRIMARY KEY(file_hash, provider_id, scope_type, scope_id),
        FOREIGN KEY(file_hash) REFERENCES reticulum_resources(file_hash) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_reticulum_resource_providers_file
        ON reticulum_resource_providers(file_hash, retention_until);
      CREATE INDEX IF NOT EXISTS idx_reticulum_resource_providers_expiry
        ON reticulum_resource_providers(retention_until);
      CREATE TABLE IF NOT EXISTS reticulum_resource_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reticulum_resource_storage_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total_resident_bytes INTEGER NOT NULL DEFAULT 0,
        authored_resident_bytes INTEGER NOT NULL DEFAULT 0,
        remote_resident_bytes INTEGER NOT NULL DEFAULT 0,
        partial_resident_bytes INTEGER NOT NULL DEFAULT 0,
        reserved_bytes INTEGER NOT NULL DEFAULT 0,
        protected_bytes INTEGER NOT NULL DEFAULT 0,
        evictable_bytes INTEGER NOT NULL DEFAULT 0,
        blob_count INTEGER NOT NULL DEFAULT 0,
        resident_blob_count INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO reticulum_resource_storage_stats (id) VALUES (1);
      CREATE TABLE IF NOT EXISTS reticulum_resource_cleanup_state (
        file_hash TEXT PRIMARY KEY,
        resident_bytes INTEGER NOT NULL DEFAULT 0,
        live_ref_count INTEGER NOT NULL DEFAULT 0,
        provider_count INTEGER NOT NULL DEFAULT 0,
        active_lease_count INTEGER NOT NULL DEFAULT 0,
        is_protected INTEGER NOT NULL DEFAULT 0,
        cleanup_tier INTEGER,
        sort_access_at INTEGER NOT NULL DEFAULT 0,
        next_refresh_at INTEGER,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(file_hash) REFERENCES reticulum_resources(file_hash) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_reticulum_resource_cleanup_candidates
        ON reticulum_resource_cleanup_state(
          is_protected, cleanup_tier, sort_access_at, resident_bytes DESC, file_hash
        );
      CREATE INDEX IF NOT EXISTS idx_reticulum_resource_cleanup_refresh
        ON reticulum_resource_cleanup_state(next_refresh_at);
      CREATE TABLE IF NOT EXISTS reticulum_resource_cleanup_dirty (
        file_hash TEXT PRIMARY KEY
      );
    `);
    this.ensureResourceColumn('provenance', "TEXT NOT NULL DEFAULT 'remote_downloaded'");
    this.ensureResourceColumn('resident_bytes', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureResourceColumn('last_accessed_at', 'INTEGER');
    this.ensureResourceColumn('last_served_at', 'INTEGER');
    this.ensureResourceColumn('access_count', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureResourceColumn('retention_until', 'INTEGER');
    this.ensureResourceColumn('managed', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureReferenceColumn('expires_at', 'INTEGER');
    this.createPostMigrationIndexes();
    const schemaVersion = Number(this.getResourceMeta('schema_version') || 0);
    if (schemaVersion !== RESOURCE_SCHEMA_VERSION) {
      this.db.exec(`
        UPDATE reticulum_resources
        SET resident_bytes = CASE
          WHEN status = 'complete' THEN size_bytes
          ELSE COALESCE((
            SELECT SUM(end_byte_exclusive - start_byte)
            FROM reticulum_resource_ranges rr
            WHERE rr.file_hash = reticulum_resources.file_hash AND rr.status = 'complete'
          ), 0)
        END
        WHERE resident_bytes = 0;
        UPDATE reticulum_resources
        SET managed = 1
        WHERE namespace IN ('reticulum-group-resource', 'reticulum-dm-resource')
           OR EXISTS (
             SELECT 1 FROM reticulum_resource_refs ref
             WHERE ref.file_hash = reticulum_resources.file_hash
               AND ref.namespace IN ('reticulum-group-resource', 'reticulum-dm-resource')
           );
        INSERT OR IGNORE INTO reticulum_resource_refs
          (file_hash, scope_type, scope_id, event_id, owner_id, namespace, file_name,
           mime_type, size_bytes, encrypted, metadata, thumbnail, state,
           locally_authored, created_at, updated_at)
        SELECT r.file_hash, 'group', CAST(g.group_id AS TEXT), g.event_id, g.owner_id,
               r.namespace, r.file_name, r.mime_type, r.size_bytes, r.encrypted,
               r.metadata, r.thumbnail, 'live',
               CASE WHEN r.provenance = 'local_authored' THEN 1 ELSE 0 END,
               g.created_at, g.updated_at
        FROM reticulum_resource_group_refs g
        JOIN reticulum_resources r ON r.file_hash = g.file_hash
        WHERE g.event_id <> '';
        DELETE FROM reticulum_resource_refs WHERE event_id = '';
      `);
      this.initStorageAccountingTriggers();
      this.setResourceMeta('schema_version', String(RESOURCE_SCHEMA_VERSION));
    }
    const accountingVersion = Number(this.getResourceMeta('accounting_version') || 0);
    return accountingVersion !== STORAGE_ACCOUNTING_VERSION;
  }

  private createPostMigrationIndexes(): void {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_reticulum_resource_refs_expiry
        ON reticulum_resource_refs(state, expires_at);
      CREATE INDEX IF NOT EXISTS idx_reticulum_resources_retention
        ON reticulum_resources(managed, retention_until);
    `);
  }

  private getResourceMeta(key: string): string | null {
    const row = this.db.prepare(
      'SELECT value FROM reticulum_resource_meta WHERE key = ? LIMIT 1'
    ).get(key) as { value?: string } | undefined;
    return typeof row?.value === 'string' ? row.value : null;
  }

  private setResourceMeta(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO reticulum_resource_meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  private ensureResourceColumn(name: string, definition: string): void {
    const columns = this.db.prepare('PRAGMA table_info(reticulum_resources)').all() as Array<{
      name: string;
    }>;
    if (columns.some((column) => column.name === name)) return;
    this.db.exec(`ALTER TABLE reticulum_resources ADD COLUMN ${name} ${definition}`);
  }

  private ensureReferenceColumn(name: string, definition: string): void {
    const columns = this.db.prepare('PRAGMA table_info(reticulum_resource_refs)').all() as Array<{
      name: string;
    }>;
    if (columns.some((column) => column.name === name)) return;
    this.db.exec(`ALTER TABLE reticulum_resource_refs ADD COLUMN ${name} ${definition}`);
  }

  private rebuildStorageAccounting(): void {
    try {
      this.db.exec(`
        DELETE FROM reticulum_resource_cleanup_state;
        DELETE FROM reticulum_resource_cleanup_dirty;
      `);
      this.db.prepare(`
        UPDATE reticulum_resource_storage_stats SET
          total_resident_bytes = COALESCE((
            SELECT SUM(resident_bytes) FROM reticulum_resources WHERE managed = 1
          ), 0),
          authored_resident_bytes = COALESCE((
            SELECT SUM(resident_bytes) FROM reticulum_resources
            WHERE managed = 1 AND provenance = 'local_authored'
          ), 0),
          remote_resident_bytes = COALESCE((
            SELECT SUM(resident_bytes) FROM reticulum_resources
            WHERE managed = 1 AND provenance <> 'local_authored'
          ), 0),
          partial_resident_bytes = COALESCE((
            SELECT SUM(resident_bytes) FROM reticulum_resources
            WHERE managed = 1 AND status <> 'complete'
          ), 0),
          reserved_bytes = COALESCE((
            SELECT SUM(size_bytes) FROM reticulum_resource_reservations WHERE expires_at > ?
          ), 0),
          protected_bytes = 0,
          evictable_bytes = 0,
          blob_count = (SELECT COUNT(*) FROM reticulum_resources WHERE managed = 1),
          resident_blob_count = (
            SELECT COUNT(*) FROM reticulum_resources WHERE managed = 1 AND resident_bytes > 0
          )
        WHERE id = 1
      `).run(this.now());
      this.db.exec(`
        INSERT OR IGNORE INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT file_hash FROM reticulum_resources WHERE managed = 1;
      `);
      this.refreshDirtyCleanupState(16);
      this.scheduleCleanupStateRefresh();
      this.setResourceMeta('accounting_version', String(STORAGE_ACCOUNTING_VERSION));
    } catch (error) {
      loggerWarn('[ReticulumResourceStore] storage_accounting_rebuild_failed', error);
    }
  }

  private readStorageStats(): StorageStatsRow | null {
    const row = this.db.prepare(`
      SELECT total_resident_bytes, authored_resident_bytes, remote_resident_bytes,
             partial_resident_bytes, reserved_bytes, protected_bytes,
             evictable_bytes, blob_count, resident_blob_count
      FROM reticulum_resource_storage_stats WHERE id = 1
    `).get() as StorageStatsRow | undefined;
    return row ?? null;
  }

  private storageStatusFromStats(stats: StorageStatsRow): ReticulumResourceStorageStatus {
    return {
      limitBytes: this.policy.limitBytes,
      lowWatermarkBytes: Math.floor(this.policy.limitBytes * this.policy.lowWatermarkRatio),
      totalResidentBytes: Math.max(0, Number(stats.total_resident_bytes || 0)),
      authoredResidentBytes: Math.max(0, Number(stats.authored_resident_bytes || 0)),
      remoteResidentBytes: Math.max(0, Number(stats.remote_resident_bytes || 0)),
      partialResidentBytes: Math.max(0, Number(stats.partial_resident_bytes || 0)),
      reservedBytes: Math.max(0, Number(stats.reserved_bytes || 0)),
      protectedBytes: Math.max(0, Number(stats.protected_bytes || 0)),
      evictableBytes: Math.max(0, Number(stats.evictable_bytes || 0)),
      blobCount: Math.max(0, Number(stats.blob_count || 0)),
      residentBlobCount: Math.max(0, Number(stats.resident_blob_count || 0)),
      lastCleanupAt: this.lastCleanupAt,
      lastCleanupFreedBytes: this.lastCleanupFreedBytes,
      blockedAuthoredPublishes: this.blockedAuthoredPublishes,
    };
  }

  private markDueCleanupStateDirty(): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO reticulum_resource_cleanup_dirty(file_hash)
      SELECT file_hash FROM reticulum_resource_cleanup_state
      WHERE next_refresh_at IS NOT NULL AND next_refresh_at <= ?
    `).run(this.now());
  }

  private refreshDirtyCleanupState(limit = 16): number {
    const dirty = this.db.prepare(`
      SELECT file_hash FROM reticulum_resource_cleanup_dirty
      ORDER BY file_hash LIMIT ?
    `).all(Math.max(1, Math.floor(limit))) as Array<{ file_hash: string }>;
    if (dirty.length === 0) return 0;
    const upsert = this.db.prepare(`
      INSERT INTO reticulum_resource_cleanup_state
        (file_hash, resident_bytes, live_ref_count, provider_count, active_lease_count,
         is_protected, cleanup_tier, sort_access_at, next_refresh_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_hash) DO UPDATE SET
        resident_bytes = excluded.resident_bytes,
        live_ref_count = excluded.live_ref_count,
        provider_count = excluded.provider_count,
        active_lease_count = excluded.active_lease_count,
        is_protected = excluded.is_protected,
        cleanup_tier = excluded.cleanup_tier,
        sort_access_at = excluded.sort_access_at,
        next_refresh_at = excluded.next_refresh_at,
        updated_at = excluded.updated_at
    `);
    const deleteState = this.db.prepare(
      'DELETE FROM reticulum_resource_cleanup_state WHERE file_hash = ?'
    );
    const clearDirty = this.db.prepare(
      'DELETE FROM reticulum_resource_cleanup_dirty WHERE file_hash = ?'
    );
    const now = this.now();
    for (const item of dirty) {
      const row = this.getManagedRowWithState(item.file_hash);
      if (!row) {
        deleteState.run(item.file_hash);
        clearDirty.run(item.file_hash);
        continue;
      }
      const tier = this.cleanupTier(row);
      const isProtected = this.isProtectedCandidate(row);
      const refreshTimes: number[] = [];
      if (Number(row.retention_until || 0) > now) {
        refreshTimes.push(Number(row.retention_until));
      }
      if (row.status !== 'complete' && now - row.updated_at < this.policy.stalePartialAgeMs) {
        refreshTimes.push(row.updated_at + this.policy.stalePartialAgeMs);
      }
      if (
        row.provenance === 'local_authored' &&
        row.status === 'complete' &&
        row.provider_count > 0
      ) {
        const authoredRecoveryEligibleAt =
          this.cleanupSortAccessAt(row) +
          RETICULUM_RESOURCE_AUTHORED_RECOVERY_MIN_IDLE_MS;
        if (authoredRecoveryEligibleAt > now) {
          refreshTimes.push(authoredRecoveryEligibleAt);
        }
      }
      upsert.run(
        row.file_hash,
        Math.max(0, Number(row.resident_bytes || 0)),
        Math.max(0, Number(row.live_ref_count || 0)),
        Math.max(0, Number(row.provider_count || 0)),
        Math.max(0, Number(row.active_lease_count || 0)),
        isProtected ? 1 : 0,
        tier,
        this.cleanupSortAccessAt(row),
        refreshTimes.length > 0 ? Math.min(...refreshTimes) : null,
        now
      );
      clearDirty.run(item.file_hash);
    }
    return dirty.length;
  }

  private scheduleCleanupStateRefresh(): void {
    if (this.closed || this.cleanupStateRefreshPromise) return;
    this.cleanupStateRefreshPromise = new Promise<void>((resolve) => {
      setImmediate(resolve);
    }).then(() => this.refreshAllDirtyCleanupState()).finally(() => {
      this.cleanupStateRefreshPromise = null;
    });
  }

  private async refreshAllDirtyCleanupState(): Promise<void> {
    for (;;) {
      if (this.closed) return;
      const refreshed = this.refreshDirtyCleanupState(16);
      if (refreshed === 0) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  private async ensureCleanupStateFresh(): Promise<void> {
    const pending = this.cleanupStateRefreshPromise;
    if (pending) await pending;
    // Rows can become dirty after a scheduled refresh has selected its final
    // batch. Drain once more before making quota or eviction decisions.
    await this.refreshAllDirtyCleanupState();
  }

  private initStorageAccountingTriggers(): void {
    this.db.exec(`
      DROP TRIGGER IF EXISTS trg_reticulum_resource_stats_insert;
      DROP TRIGGER IF EXISTS trg_reticulum_resource_stats_update;
      DROP TRIGGER IF EXISTS trg_reticulum_resource_stats_delete;
      DROP TRIGGER IF EXISTS trg_reticulum_reservation_stats_insert;
      DROP TRIGGER IF EXISTS trg_reticulum_reservation_stats_update;
      DROP TRIGGER IF EXISTS trg_reticulum_reservation_stats_delete;
      DROP TRIGGER IF EXISTS trg_reticulum_cleanup_state_stats_insert;
      DROP TRIGGER IF EXISTS trg_reticulum_cleanup_state_stats_update;
      DROP TRIGGER IF EXISTS trg_reticulum_cleanup_state_stats_delete;
      DROP TRIGGER IF EXISTS trg_reticulum_resource_dirty_insert;
      DROP TRIGGER IF EXISTS trg_reticulum_resource_dirty_update;
      DROP TRIGGER IF EXISTS trg_reticulum_ref_dirty_insert;
      DROP TRIGGER IF EXISTS trg_reticulum_ref_dirty_update;
      DROP TRIGGER IF EXISTS trg_reticulum_ref_dirty_delete;
      DROP TRIGGER IF EXISTS trg_reticulum_lease_dirty_insert;
      DROP TRIGGER IF EXISTS trg_reticulum_lease_dirty_update;
      DROP TRIGGER IF EXISTS trg_reticulum_lease_dirty_delete;
      DROP TRIGGER IF EXISTS trg_reticulum_provider_dirty_insert;
      DROP TRIGGER IF EXISTS trg_reticulum_provider_dirty_update;
      DROP TRIGGER IF EXISTS trg_reticulum_provider_dirty_delete;

      CREATE TRIGGER trg_reticulum_resource_stats_insert
      AFTER INSERT ON reticulum_resources WHEN NEW.managed = 1
      BEGIN
        UPDATE reticulum_resource_storage_stats SET
          total_resident_bytes = total_resident_bytes + NEW.resident_bytes,
          authored_resident_bytes = authored_resident_bytes +
            CASE WHEN NEW.provenance = 'local_authored' THEN NEW.resident_bytes ELSE 0 END,
          remote_resident_bytes = remote_resident_bytes +
            CASE WHEN NEW.provenance <> 'local_authored' THEN NEW.resident_bytes ELSE 0 END,
          partial_resident_bytes = partial_resident_bytes +
            CASE WHEN NEW.status <> 'complete' THEN NEW.resident_bytes ELSE 0 END,
          blob_count = blob_count + 1,
          resident_blob_count = resident_blob_count + CASE WHEN NEW.resident_bytes > 0 THEN 1 ELSE 0 END
        WHERE id = 1;
      END;

      CREATE TRIGGER trg_reticulum_resource_stats_update
      AFTER UPDATE OF managed, resident_bytes, provenance, status ON reticulum_resources
      BEGIN
        UPDATE reticulum_resource_storage_stats SET
          total_resident_bytes = total_resident_bytes
            - CASE WHEN OLD.managed = 1 THEN OLD.resident_bytes ELSE 0 END
            + CASE WHEN NEW.managed = 1 THEN NEW.resident_bytes ELSE 0 END,
          authored_resident_bytes = authored_resident_bytes
            - CASE WHEN OLD.managed = 1 AND OLD.provenance = 'local_authored' THEN OLD.resident_bytes ELSE 0 END
            + CASE WHEN NEW.managed = 1 AND NEW.provenance = 'local_authored' THEN NEW.resident_bytes ELSE 0 END,
          remote_resident_bytes = remote_resident_bytes
            - CASE WHEN OLD.managed = 1 AND OLD.provenance <> 'local_authored' THEN OLD.resident_bytes ELSE 0 END
            + CASE WHEN NEW.managed = 1 AND NEW.provenance <> 'local_authored' THEN NEW.resident_bytes ELSE 0 END,
          partial_resident_bytes = partial_resident_bytes
            - CASE WHEN OLD.managed = 1 AND OLD.status <> 'complete' THEN OLD.resident_bytes ELSE 0 END
            + CASE WHEN NEW.managed = 1 AND NEW.status <> 'complete' THEN NEW.resident_bytes ELSE 0 END,
          blob_count = blob_count - CASE WHEN OLD.managed = 1 THEN 1 ELSE 0 END
            + CASE WHEN NEW.managed = 1 THEN 1 ELSE 0 END,
          resident_blob_count = resident_blob_count
            - CASE WHEN OLD.managed = 1 AND OLD.resident_bytes > 0 THEN 1 ELSE 0 END
            + CASE WHEN NEW.managed = 1 AND NEW.resident_bytes > 0 THEN 1 ELSE 0 END
        WHERE id = 1;
      END;

      CREATE TRIGGER trg_reticulum_resource_stats_delete
      AFTER DELETE ON reticulum_resources WHEN OLD.managed = 1
      BEGIN
        UPDATE reticulum_resource_storage_stats SET
          total_resident_bytes = total_resident_bytes - OLD.resident_bytes,
          authored_resident_bytes = authored_resident_bytes -
            CASE WHEN OLD.provenance = 'local_authored' THEN OLD.resident_bytes ELSE 0 END,
          remote_resident_bytes = remote_resident_bytes -
            CASE WHEN OLD.provenance <> 'local_authored' THEN OLD.resident_bytes ELSE 0 END,
          partial_resident_bytes = partial_resident_bytes -
            CASE WHEN OLD.status <> 'complete' THEN OLD.resident_bytes ELSE 0 END,
          blob_count = blob_count - 1,
          resident_blob_count = resident_blob_count - CASE WHEN OLD.resident_bytes > 0 THEN 1 ELSE 0 END
        WHERE id = 1;
      END;

      CREATE TRIGGER trg_reticulum_reservation_stats_insert
      AFTER INSERT ON reticulum_resource_reservations
      BEGIN
        UPDATE reticulum_resource_storage_stats
        SET reserved_bytes = reserved_bytes + NEW.size_bytes WHERE id = 1;
      END;
      CREATE TRIGGER trg_reticulum_reservation_stats_update
      AFTER UPDATE OF size_bytes ON reticulum_resource_reservations
      BEGIN
        UPDATE reticulum_resource_storage_stats
        SET reserved_bytes = reserved_bytes - OLD.size_bytes + NEW.size_bytes WHERE id = 1;
      END;
      CREATE TRIGGER trg_reticulum_reservation_stats_delete
      AFTER DELETE ON reticulum_resource_reservations
      BEGIN
        UPDATE reticulum_resource_storage_stats
        SET reserved_bytes = reserved_bytes - OLD.size_bytes WHERE id = 1;
      END;

      CREATE TRIGGER trg_reticulum_cleanup_state_stats_insert
      AFTER INSERT ON reticulum_resource_cleanup_state
      BEGIN
        UPDATE reticulum_resource_storage_stats SET
          protected_bytes = protected_bytes +
            CASE WHEN NEW.is_protected = 1 THEN NEW.resident_bytes ELSE 0 END,
          evictable_bytes = evictable_bytes +
            CASE WHEN NEW.is_protected = 0 AND NEW.cleanup_tier IS NOT NULL
              THEN NEW.resident_bytes ELSE 0 END
        WHERE id = 1;
      END;
      CREATE TRIGGER trg_reticulum_cleanup_state_stats_update
      AFTER UPDATE OF resident_bytes, is_protected, cleanup_tier ON reticulum_resource_cleanup_state
      BEGIN
        UPDATE reticulum_resource_storage_stats SET
          protected_bytes = protected_bytes
            - CASE WHEN OLD.is_protected = 1 THEN OLD.resident_bytes ELSE 0 END
            + CASE WHEN NEW.is_protected = 1 THEN NEW.resident_bytes ELSE 0 END,
          evictable_bytes = evictable_bytes
            - CASE WHEN OLD.is_protected = 0 AND OLD.cleanup_tier IS NOT NULL
                THEN OLD.resident_bytes ELSE 0 END
            + CASE WHEN NEW.is_protected = 0 AND NEW.cleanup_tier IS NOT NULL
                THEN NEW.resident_bytes ELSE 0 END
        WHERE id = 1;
      END;
      CREATE TRIGGER trg_reticulum_cleanup_state_stats_delete
      AFTER DELETE ON reticulum_resource_cleanup_state
      BEGIN
        UPDATE reticulum_resource_storage_stats SET
          protected_bytes = protected_bytes -
            CASE WHEN OLD.is_protected = 1 THEN OLD.resident_bytes ELSE 0 END,
          evictable_bytes = evictable_bytes -
            CASE WHEN OLD.is_protected = 0 AND OLD.cleanup_tier IS NOT NULL
              THEN OLD.resident_bytes ELSE 0 END
        WHERE id = 1;
      END;

      CREATE TRIGGER trg_reticulum_resource_dirty_insert
      AFTER INSERT ON reticulum_resources WHEN NEW.managed = 1
      BEGIN
        INSERT INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT NEW.file_hash
        WHERE NOT EXISTS (
          SELECT 1 FROM reticulum_resource_cleanup_dirty WHERE file_hash = NEW.file_hash
        );
      END;
      CREATE TRIGGER trg_reticulum_resource_dirty_update
      AFTER UPDATE OF managed, resident_bytes, status, provenance, updated_at,
        last_accessed_at, retention_until ON reticulum_resources
      BEGIN
        INSERT INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT NEW.file_hash
        WHERE NOT EXISTS (
          SELECT 1 FROM reticulum_resource_cleanup_dirty WHERE file_hash = NEW.file_hash
        );
      END;
      CREATE TRIGGER trg_reticulum_ref_dirty_insert
      AFTER INSERT ON reticulum_resource_refs
      BEGIN
        INSERT INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT NEW.file_hash
        WHERE NOT EXISTS (
          SELECT 1 FROM reticulum_resource_cleanup_dirty WHERE file_hash = NEW.file_hash
        );
      END;
      CREATE TRIGGER trg_reticulum_ref_dirty_update
      AFTER UPDATE OF state, expires_at ON reticulum_resource_refs
      BEGIN
        INSERT INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT NEW.file_hash
        WHERE NOT EXISTS (
          SELECT 1 FROM reticulum_resource_cleanup_dirty WHERE file_hash = NEW.file_hash
        );
      END;
      CREATE TRIGGER trg_reticulum_ref_dirty_delete
      AFTER DELETE ON reticulum_resource_refs
      BEGIN
        INSERT INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT OLD.file_hash
        WHERE NOT EXISTS (
          SELECT 1 FROM reticulum_resource_cleanup_dirty WHERE file_hash = OLD.file_hash
        );
      END;
      CREATE TRIGGER trg_reticulum_lease_dirty_insert
      AFTER INSERT ON reticulum_resource_leases
      BEGIN
        INSERT INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT NEW.file_hash
        WHERE NOT EXISTS (
          SELECT 1 FROM reticulum_resource_cleanup_dirty WHERE file_hash = NEW.file_hash
        );
      END;
      CREATE TRIGGER trg_reticulum_lease_dirty_update
      AFTER UPDATE OF file_hash, expires_at ON reticulum_resource_leases
      BEGIN
        INSERT INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT OLD.file_hash
        WHERE NOT EXISTS (
          SELECT 1 FROM reticulum_resource_cleanup_dirty WHERE file_hash = OLD.file_hash
        );
        INSERT INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT NEW.file_hash
        WHERE NOT EXISTS (
          SELECT 1 FROM reticulum_resource_cleanup_dirty WHERE file_hash = NEW.file_hash
        );
      END;
      CREATE TRIGGER trg_reticulum_lease_dirty_delete
      AFTER DELETE ON reticulum_resource_leases
      BEGIN
        INSERT INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT OLD.file_hash
        WHERE NOT EXISTS (
          SELECT 1 FROM reticulum_resource_cleanup_dirty WHERE file_hash = OLD.file_hash
        );
      END;
      CREATE TRIGGER trg_reticulum_provider_dirty_insert
      AFTER INSERT ON reticulum_resource_providers
      BEGIN
        INSERT INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT NEW.file_hash
        WHERE NOT EXISTS (
          SELECT 1 FROM reticulum_resource_cleanup_dirty WHERE file_hash = NEW.file_hash
        );
      END;
      CREATE TRIGGER trg_reticulum_provider_dirty_update
      AFTER UPDATE OF file_hash, retention_until ON reticulum_resource_providers
      BEGIN
        INSERT INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT OLD.file_hash
        WHERE NOT EXISTS (
          SELECT 1 FROM reticulum_resource_cleanup_dirty WHERE file_hash = OLD.file_hash
        );
        INSERT INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT NEW.file_hash
        WHERE NOT EXISTS (
          SELECT 1 FROM reticulum_resource_cleanup_dirty WHERE file_hash = NEW.file_hash
        );
      END;
      CREATE TRIGGER trg_reticulum_provider_dirty_delete
      AFTER DELETE ON reticulum_resource_providers
      BEGIN
        INSERT INTO reticulum_resource_cleanup_dirty(file_hash)
        SELECT OLD.file_hash
        WHERE NOT EXISTS (
          SELECT 1 FROM reticulum_resource_cleanup_dirty WHERE file_hash = OLD.file_hash
        );
      END;
    `);
  }

  private validateManifest(manifest: ReticulumResourceManifest): void {
    if (!manifest.fileHash || !manifest.namespace) throw new Error('Invalid resource identity');
    if (!manifest.fileName || !manifest.mimeType) throw new Error('Invalid resource metadata');
    if (!Number.isInteger(manifest.sizeBytes) || manifest.sizeBytes < 0) {
      throw new Error('Invalid resource size');
    }
    if (!/^[0-9a-f]{64}$/i.test(manifest.fileHash)) throw new Error('Invalid file hash');
  }

  private validateRange(
    manifest: ReticulumResourceManifest,
    startByte: number,
    endByteExclusive: number
  ): void {
    if (!Number.isInteger(startByte) || !Number.isInteger(endByteExclusive)) {
      throw new Error('Invalid byte range');
    }
    if (startByte < 0 || endByteExclusive <= startByte || endByteExclusive > manifest.sizeBytes) {
      throw new Error('Invalid byte range');
    }
    if (endByteExclusive - startByte > RETICULUM_RESOURCE_MAX_RANGE_SIZE) {
      throw new Error('Byte range too large');
    }
  }

  private recordCompletedRange(
    fileHash: string,
    startByte: number,
    endByteExclusive: number
  ): number {
    const now = this.now();
    let completedBytes = 0;
    this.db.transaction(() => {
      const overlaps = this.db.prepare(`
        SELECT * FROM reticulum_resource_ranges
        WHERE file_hash = ? AND status = 'complete'
          AND start_byte <= ? AND end_byte_exclusive >= ?
        ORDER BY start_byte ASC
      `).all(fileHash, endByteExclusive, startByte) as RangeRow[];
      let mergedStart = startByte;
      let mergedEnd = endByteExclusive;
      let replacedBytes = 0;
      for (const row of overlaps) {
        mergedStart = Math.min(mergedStart, row.start_byte);
        mergedEnd = Math.max(mergedEnd, row.end_byte_exclusive);
        replacedBytes += Math.max(0, row.end_byte_exclusive - row.start_byte);
      }
      this.db.prepare(`
        DELETE FROM reticulum_resource_ranges
        WHERE file_hash = ? AND status = 'complete'
          AND start_byte <= ? AND end_byte_exclusive >= ?
      `).run(fileHash, endByteExclusive, startByte);
      this.stmtInsertRange.run(fileHash, mergedStart, mergedEnd, now);
      const resource = this.stmtGetResource.get(fileHash) as ResourceRow | undefined;
      completedBytes = Math.min(
        Number(resource?.size_bytes || mergedEnd),
        Math.max(
          0,
          Number(resource?.resident_bytes || 0) +
            (mergedEnd - mergedStart) -
            replacedBytes
        )
      );
    })();
    return completedBytes;
  }

  private mergeRanges(
    ranges: ReticulumResourceByteRangeStatus[]
  ): ReticulumResourceByteRangeStatus[] {
    const sorted = ranges
      .filter(
        (range) =>
          Number.isInteger(range.startByte) &&
          Number.isInteger(range.endByteExclusive) &&
          range.startByte >= 0 &&
          range.endByteExclusive > range.startByte
      )
      .sort((a, b) => a.startByte - b.startByte || a.endByteExclusive - b.endByteExclusive);
    const merged: ReticulumResourceByteRangeStatus[] = [];
    for (const range of sorted) {
      const previous = merged[merged.length - 1];
      if (previous && range.startByte <= previous.endByteExclusive) {
        previous.endByteExclusive = Math.max(previous.endByteExclusive, range.endByteExclusive);
        previous.sizeBytes = previous.endByteExclusive - previous.startByte;
        previous.updatedAt = Math.max(previous.updatedAt, range.updatedAt);
      } else {
        merged.push({ ...range });
      }
    }
    return merged;
  }

  private rangesCoverFile(
    ranges: ReticulumResourceByteRangeStatus[],
    sizeBytes: number
  ): boolean {
    if (sizeBytes === 0) return true;
    const merged = this.mergeRanges(ranges);
    return (
      merged.length === 1 &&
      merged[0]?.startByte === 0 &&
      merged[0]?.endByteExclusive === sizeBytes
    );
  }

  private blobDir(fileHash: string): string {
    return path.join(this.rootDir, 'blobs', fileHash);
  }

  private rangeStatePath(fileHash: string): string {
    return path.join(this.blobDir(fileHash), 'ranges.json');
  }

  private partialPath(manifest: ReticulumResourceManifest): string {
    return path.join(this.blobDir(manifest.fileHash), 'download.partial');
  }

  private assembledPath(manifest: ReticulumResourceManifest): string {
    if (manifest.encrypted) {
      return path.join(this.blobDir(manifest.fileHash), 'assembled.enc');
    }
    return path.join(
      this.blobDir(manifest.fileHash),
      'assembled',
      safeFileName(manifest.fileName)
    );
  }

}
