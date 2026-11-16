import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import {
  loadPublishProfile,
  logoHash,
  prefillFromProfile,
  profileChangedSince,
  publishProfileKey,
  publishSignature,
  savePublishProfile,
} from '../publishProfiles';
import { installPublishBridges } from '../../../test/mocks/publishBridges';

describe('publish profiles in the renderer', () => {
  let bridges: ReturnType<typeof installPublishBridges> | null = null;

  afterEach(() => {
    bridges?.uninstall();
    bridges = null;
    vi.restoreAllMocks();
  });

  it("keys a name's default resource as 'default'", () => {
    expect(publishProfileKey('Qaddr', 'APP', 'Q-Notes')).toEqual({
      address: 'Qaddr',
      service: 'APP',
      name: 'Q-Notes',
      identifier: 'default',
    });
    expect(publishProfileKey('Qaddr', 'DOCUMENT', 'alice', 'q-notes')).toEqual(
      expect.objectContaining({ identifier: 'q-notes' })
    );
    expect(publishProfileKey(null, 'APP', 'Q-Notes')).toBeNull();
    expect(publishProfileKey('Qaddr', 'APP', '')).toBeNull();
  });

  it('has no profile without the desktop app', async () => {
    expect(
      await loadPublishProfile(publishProfileKey('Qaddr', 'APP', 'Q-Notes'))
    ).toBeNull();
    await expect(
      savePublishProfile(publishProfileKey('Qaddr', 'APP', 'Q-Notes'), {
        publishedAt: 1,
      })
    ).resolves.toBeUndefined();
  });

  it('reads and merges through the bridge', async () => {
    bridges = installPublishBridges();
    const key = publishProfileKey('Qaddr', 'APP', 'Q-Notes');
    await savePublishProfile(key, { publishedAt: 5 });
    expect(bridges.publishProfiles.merge).toHaveBeenCalledWith(key, {
      publishedAt: 5,
    });
    expect(await loadPublishProfile(key)).toEqual({ publishedAt: 5 });
  });

  it('treats a store that fails as no profile, and never throws', async () => {
    bridges = installPublishBridges();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    bridges.publishProfiles.get.mockRejectedValue(new Error('corrupt'));
    bridges.publishProfiles.merge.mockRejectedValue(new Error('disk full'));
    const key = publishProfileKey('Qaddr', 'APP', 'Q-Notes');

    expect(await loadPublishProfile(key)).toBeNull();
    await expect(
      savePublishProfile(key, { publishedAt: 1 })
    ).resolves.toBeUndefined();
    bridges.publishProfiles.get.mockResolvedValue('not a profile' as never);
    expect(await loadPublishProfile(key)).toBeNull();
  });

  it('hashes the logo bytes instead of keeping the logo', () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const base64 = btoa(String.fromCharCode(...bytes));
    expect(logoHash(base64)).toBe(bytesToHex(sha256(bytes)));
    expect(logoHash(null)).toBeUndefined();
    expect(logoHash('%%%')).toBeUndefined();
  });

  it('counts changes from when the files were read, else from the publish', () => {
    expect(
      profileChangedSince({
        publishedAt: 2000,
        source: { path: '/a', kind: 'folder', takenAt: 1000 },
      })
    ).toBe(1000);
    expect(profileChangedSince({ publishedAt: 2000 })).toBe(2000);
    expect(profileChangedSince(null)).toBeNull();
  });

  it('turns the last metadata sent into a form prefill', () => {
    expect(
      prefillFromProfile({
        metadata: {
          title: 'Q-Notes',
          description: 'Notes',
          category: 'tools',
          tags: ['a', 'b'],
        },
      })
    ).toEqual({
      title: 'Q-Notes',
      description: 'Notes',
      category: 'tools',
      tags: ['a', 'b'],
    });
    expect(prefillFromProfile({ publishedAt: 1 })).toBeNull();
  });

  it("finds the transaction signature in a publish's answer", () => {
    expect(publishSignature({ signature: 'abc' })).toBe('abc');
    expect(publishSignature('ok')).toBeUndefined();
    expect(publishSignature(null)).toBeUndefined();
  });
});
