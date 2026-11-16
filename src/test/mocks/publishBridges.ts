import { vi } from 'vitest';

/**
 * Fakes for what the desktop app's preload gives the publish forms:
 * `window.publishProfiles` (the saved publish profiles) and the file pickers
 * on `window.electron`. Profiles live in a Map, keyed like the main process
 * keys them (name in lower case, 'default' for no identifier).
 */

type Key = {
  address: string;
  service: string;
  name: string;
  identifier?: string | null;
};

export const publishProfileMapKey = (key: Key) =>
  [
    key.address,
    key.service,
    key.name.toLowerCase(),
    key.identifier || 'default',
  ].join('/');

export function installPublishBridges() {
  const profiles = new Map<string, Record<string, unknown>>();
  const publishProfiles = {
    get: vi.fn(
      async (key: Key) => profiles.get(publishProfileMapKey(key)) ?? null
    ),
    merge: vi.fn(async (key: Key, patch: Record<string, unknown>) => {
      const next = { ...profiles.get(publishProfileMapKey(key)), ...patch };
      profiles.set(publishProfileMapKey(key), next);
      return next;
    }),
  };
  const electron = {
    selectFile: vi.fn(async (): Promise<string | undefined> => undefined),
    readFile: vi.fn(async (): Promise<Uint8Array> => new Uint8Array()),
    selectAndZipDirectory: vi.fn(
      async (): Promise<{
        buffer: Uint8Array;
        directoryPath: string;
        changedFiles?: number;
      } | null> => null
    ),
    getPathForFile: vi.fn((): string => ''),
  };
  const host = window as unknown as Record<string, unknown>;
  const previous = {
    publishProfiles: host.publishProfiles,
    electron: host.electron,
  };
  host.publishProfiles = publishProfiles;
  host.electron = electron;

  return {
    publishProfiles,
    electron,
    profiles,
    seed: (key: Key, profile: Record<string, unknown>) =>
      profiles.set(publishProfileMapKey(key), profile),
    uninstall: () => {
      host.publishProfiles = previous.publishProfiles;
      host.electron = previous.electron;
    },
  };
}
