import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { PublishPrefill } from './appPublishPrefill';

/**
 * The publish forms' side of the saved publish profiles: what this PC
 * remembers about a resource after publishing it. The profiles live in
 * Electron's main process (electron/src/publish-profiles.ts), which keeps only
 * whitelisted fields. Without Electron, or when the store can't be read,
 * there is no profile and publishing works as before.
 */

export const DEFAULT_IDENTIFIER = 'default';

export type PublishProfileKey = {
  address: string;
  service: string;
  name: string;
  identifier: string;
};

export type PublishProfileSource = {
  path: string;
  kind: 'folder' | 'zip';
  takenAt?: number;
};

export type PublishProfile = {
  source?: PublishProfileSource;
  publishedAt?: number;
  metadata?: {
    title: string;
    description: string;
    category: string;
    tags: string[];
  };
  privateApp?: { groupId: number; appName: string; logoHash?: string };
  signature?: string;
};

export const publishProfileKey = (
  address: string | null | undefined,
  service: string | null | undefined,
  name: string | null | undefined,
  identifier?: string | null
): PublishProfileKey | null =>
  address && service && name
    ? { address, service, name, identifier: identifier || DEFAULT_IDENTIFIER }
    : null;

/** This PC's profile for the resource, or null. Never throws. */
export const loadPublishProfile = async (
  key: PublishProfileKey | null
): Promise<PublishProfile | null> => {
  if (!key || !window.publishProfiles) return null;
  try {
    const profile = await window.publishProfiles.get(key);
    return profile && typeof profile === 'object' ? profile : null;
  } catch (error) {
    console.warn('Publish profile could not be read', error);
    return null;
  }
};

/** Saves what a publish used. A failure here never affects the publish. */
export const savePublishProfile = async (
  key: PublishProfileKey | null,
  patch: PublishProfile
): Promise<void> => {
  if (!key || !window.publishProfiles) return;
  try {
    await window.publishProfiles.merge(key, patch);
  } catch (error) {
    console.warn('Publish profile could not be saved', error);
  }
};

/** SHA-256 of a base64 logo's bytes, as hex: the profile keeps this, not the logo. */
export const logoHash = (base64Logo: unknown) => {
  if (typeof base64Logo !== 'string' || !base64Logo) return undefined;
  try {
    const bytes = Uint8Array.from(atob(base64Logo), (char) =>
      char.charCodeAt(0)
    );
    return bytesToHex(sha256(bytes));
  } catch {
    return undefined;
  }
};

/** The time files are compared with to count what changed since the last publish. */
export const profileChangedSince = (profile: PublishProfile | null) =>
  profile?.source?.takenAt ?? profile?.publishedAt ?? null;

/** The metadata sent with the last publish from this PC, as a form prefill. */
export const prefillFromProfile = (
  profile: PublishProfile | null
): PublishPrefill | null => {
  const metadata = profile?.metadata;
  if (!metadata) return null;
  return {
    title: metadata.title ?? '',
    description: metadata.description ?? '',
    category: metadata.category ?? '',
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
  };
};

/** The transaction signature in a publish's answer, when it has one. */
export const publishSignature = (response: unknown): string | undefined => {
  const signature = (response as { signature?: unknown } | null)?.signature;
  return typeof signature === 'string' && signature ? signature : undefined;
};
