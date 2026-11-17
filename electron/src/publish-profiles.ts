import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { basename, dirname, isAbsolute, join } from 'path';

/**
 * Saved publish profiles: what this PC remembers about a resource the account
 * publishes, so the next update starts where the last one ended. They stay in
 * userData and are never published.
 *
 * A profile holds only what QDN can't give back: where the files came from,
 * when they were published, the metadata sent, and for a private app its
 * group, app name and a hash of its logo. The fields are whitelisted, so
 * anything else a caller sends (keys, group secrets, the node's API key, the
 * app, its logo or the encrypted bytes) is dropped and never written.
 */

export const PUBLISH_PROFILES_FILE = 'publish-profiles.json';

const STORE_VERSION = 1;

export type PublishProfileKey = {
  address: string;
  service: string;
  name: string;
  /** Empty or missing for a name's default resource. */
  identifier?: string | null;
};

export type PublishProfileSource = {
  path: string;
  kind: 'folder' | 'zip';
  /** When the files were read for the last publish. */
  takenAt?: number;
};

export type PublishProfileMetadata = {
  title: string;
  description: string;
  category: string;
  tags: string[];
};

export type PublishProfilePrivateApp = {
  groupId: number;
  appName: string;
  /** SHA-256 of the logo's bytes, as hex. */
  logoHash?: string;
};

export type PublishProfile = {
  source?: PublishProfileSource;
  publishedAt?: number;
  metadata?: PublishProfileMetadata;
  privateApp?: PublishProfilePrivateApp;
  signature?: string;
};

type StoredProfile = PublishProfile & { updatedAt?: number };

const ADDRESS = /^Q[1-9A-HJ-NP-Za-km-z]{32,34}$/;
const SERVICE = /^[A-Z][A-Z0-9_]{0,39}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const keyPart = (value: unknown, max: number): string | null =>
  typeof value === 'string' &&
  value.length <= max &&
  !CONTROL_CHARACTERS.test(value)
    ? value
    : null;

/**
 * The store's key for one resource of one account. Names are unique
 * regardless of case, so the name is compared in lower case.
 */
export const publishProfileKey = (key: unknown): string => {
  if (!isRecord(key)) throw new Error('Invalid publish profile key');
  const address = keyPart(key.address, 34);
  const service = keyPart(key.service, 40);
  const name = keyPart(key.name, 80);
  const identifier =
    key.identifier == null || key.identifier === ''
      ? 'default'
      : keyPart(key.identifier, 64);
  if (
    !address ||
    !ADDRESS.test(address) ||
    !service ||
    !SERVICE.test(service) ||
    !name?.trim() ||
    !identifier
  ) {
    throw new Error('Invalid publish profile key');
  }
  return [address, service, name.toLowerCase(), identifier]
    .map(encodeURIComponent)
    .join('/');
};

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && !value.includes('\0')
    ? value.slice(0, max)
    : undefined;

const positiveInteger = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : undefined;

const sanitizeSource = (value: unknown): PublishProfileSource | undefined => {
  if (!isRecord(value)) return undefined;
  const { path, kind } = value;
  if (
    typeof path !== 'string' ||
    path.length > 4096 ||
    path.includes('\0') ||
    !isAbsolute(path) ||
    (kind !== 'folder' && kind !== 'zip')
  ) {
    return undefined;
  }
  const takenAt = positiveInteger(value.takenAt);
  return takenAt ? { path, kind, takenAt } : { path, kind };
};

const sanitizeMetadata = (
  value: unknown
): PublishProfileMetadata | undefined => {
  if (!isRecord(value)) return undefined;
  const tags = Array.isArray(value.tags)
    ? value.tags
        .map((tag) => text(tag, 100))
        .filter((tag): tag is string => !!tag)
        .slice(0, 10)
    : [];
  return {
    title: text(value.title, 200) ?? '',
    description: text(value.description, 1000) ?? '',
    category: text(value.category, 100) ?? '',
    tags,
  };
};

const sanitizePrivateApp = (
  value: unknown
): PublishProfilePrivateApp | undefined => {
  if (!isRecord(value)) return undefined;
  const groupId = positiveInteger(value.groupId);
  const appName = text(value.appName, 200);
  if (!groupId || appName === undefined) return undefined;
  const logoHash =
    typeof value.logoHash === 'string' && SHA256_HEX.test(value.logoHash)
      ? value.logoHash
      : undefined;
  return logoHash ? { groupId, appName, logoHash } : { groupId, appName };
};

/** Only the whitelisted fields, each checked; anything else is dropped. */
export const sanitizePublishProfile = (value: unknown): PublishProfile => {
  if (!isRecord(value)) return {};
  const profile: PublishProfile = {};
  const source = sanitizeSource(value.source);
  if (source) profile.source = source;
  const publishedAt = positiveInteger(value.publishedAt);
  if (publishedAt) profile.publishedAt = publishedAt;
  const metadata = sanitizeMetadata(value.metadata);
  if (metadata) profile.metadata = metadata;
  const privateApp = sanitizePrivateApp(value.privateApp);
  if (privateApp) profile.privateApp = privateApp;
  if (typeof value.signature === 'string' && SIGNATURE.test(value.signature)) {
    profile.signature = value.signature;
  }
  return profile;
};

const isEmpty = (profile: PublishProfile) => Object.keys(profile).length === 0;

export function createPublishProfileStore(
  getFilePath: () => string,
  onError: (error: unknown) => void = () => undefined
) {
  // One read-modify-write at a time, so two saves can't undo each other.
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  /** Missing, unreadable or corrupt data reads as an empty store. */
  const readAll = async (): Promise<Record<string, StoredProfile>> => {
    let raw: string;
    try {
      raw = await fs.readFile(getFilePath(), 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') onError(error);
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      onError(error);
      return {};
    }
    if (
      !isRecord(parsed) ||
      parsed.version !== STORE_VERSION ||
      !isRecord(parsed.profiles)
    ) {
      return {};
    }
    const profiles: Record<string, StoredProfile> = {};
    Object.entries(parsed.profiles).forEach(([key, stored]) => {
      const profile = sanitizePublishProfile(stored);
      if (isEmpty(profile)) return;
      const updatedAt = isRecord(stored)
        ? positiveInteger(stored.updatedAt)
        : undefined;
      profiles[key] = updatedAt ? { ...profile, updatedAt } : profile;
    });
    return profiles;
  };

  const writeAll = async (profiles: Record<string, StoredProfile>) => {
    const filePath = getFilePath();
    const directory = dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
    // Write a sibling file, then rename it over the store in one step.
    const temporary = join(
      directory,
      `.${basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    );
    try {
      await fs.writeFile(
        temporary,
        JSON.stringify({ version: STORE_VERSION, profiles }, null, 2),
        { encoding: 'utf8', mode: 0o600 }
      );
      await fs.rename(temporary, filePath);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  const save = async (
    key: unknown,
    build: (current: PublishProfile | undefined) => PublishProfile
  ): Promise<PublishProfile> => {
    const storeKey = publishProfileKey(key);
    return serialize(async () => {
      const profiles = await readAll();
      const current = profiles[storeKey];
      const next = sanitizePublishProfile(
        build(current ? sanitizePublishProfile(current) : undefined)
      );
      profiles[storeKey] = { ...next, updatedAt: Date.now() };
      await writeAll(profiles);
      return next;
    });
  };

  return {
    /** The saved profile, or null when there is none. */
    get: async (key: unknown): Promise<PublishProfile | null> => {
      const storeKey = publishProfileKey(key);
      return serialize(async () => {
        const stored = (await readAll())[storeKey];
        return stored ? sanitizePublishProfile(stored) : null;
      });
    },
    /** Replaces the profile. */
    set: (key: unknown, profile: unknown) =>
      save(key, () => sanitizePublishProfile(profile)),
    /** Adds the fields given; the others keep their saved values. */
    merge: (key: unknown, patch: unknown) =>
      save(key, (current) => ({
        ...current,
        ...sanitizePublishProfile(patch),
      })),
  };
}

export function registerPublishProfileIpc({
  ipcMain,
  checkSender,
  getFilePath,
  onError,
}: {
  ipcMain: Pick<IpcMain, 'handle'>;
  checkSender: (event: IpcMainInvokeEvent) => void;
  getFilePath: () => string;
  onError?: (error: unknown) => void;
}) {
  const store = createPublishProfileStore(getFilePath, onError);
  ipcMain.handle('publishProfiles:get', async (event, key) => {
    checkSender(event);
    return store.get(key);
  });
  ipcMain.handle('publishProfiles:merge', async (event, key, patch) => {
    checkSender(event);
    return store.merge(key, patch);
  });
  return store;
}
