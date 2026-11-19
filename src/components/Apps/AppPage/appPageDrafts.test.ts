import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkShotsCurrent,
  draftsFromManifest,
  heldAfterPublish,
  manifestOfHeld,
  shotDraftsChanged,
  uploadsFromDrafts,
} from './appPageDrafts';
import type { ShotsManifest } from './appPageData';
import type { ShotDraft } from './ScreenshotsEditor';
import { blobBytes } from './blobBytes';

const BASE = 'http://node';
const APP = { service: 'APP', name: 'Publisher' };
const MANIFEST: ShotsManifest = {
  shots: [
    { file: '1.webp', caption: 'Home' },
    { file: '2.webp', caption: 'Feed' },
  ],
  updated: 1,
};

/** What the node's search lists for the app's screenshots, or that it fails. */
let listed: string | null | 'fails' = 'S1';
const searches = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).includes('/resources/search'));
const pictureReads = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).includes('filepath='));

beforeEach(() => {
  listed = 'S1';
  URL.createObjectURL = vi.fn(() => 'blob:held');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/resources/search')) {
      if (listed === 'fails') return new Response('', { status: 500 });
      return new Response(
        JSON.stringify(
          listed
            ? [
                {
                  name: 'Publisher',
                  service: 'IMAGE',
                  identifier: 'qhub_app_shots_v1_APP',
                  latestSignature: listed,
                },
              ]
            : []
        )
      );
    }
    const file = new URL(url).searchParams.get('filepath');
    return new Response(new Uint8Array(file === '1.webp' ? [1, 1] : [2, 2]));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const readFromS1 = () => draftsFromManifest(BASE, APP, MANIFEST, 'S1');
const newPicture = (): ShotDraft => ({
  id: 'file-new',
  url: 'blob:new',
  caption: 'New',
  blob: new Blob([new Uint8Array([7])]),
});

describe('checkShotsCurrent', () => {
  it('passes screenshots read from the set the node lists now', async () => {
    await expect(
      checkShotsCurrent(BASE, APP, readFromS1())
    ).resolves.toBeUndefined();
  });

  it('refuses screenshots read from a set replaced since', async () => {
    listed = 'S2';
    await expect(
      checkShotsCurrent(BASE, APP, readFromS1())
    ).rejects.toMatchObject({ code: 'SHOTS_CHANGED' });
  });

  it("refuses them when the node can't say what it has now", async () => {
    listed = 'fails';
    await expect(
      checkShotsCurrent(BASE, APP, readFromS1())
    ).rejects.toMatchObject({ code: 'SHOTS_UNVERIFIED' });
  });

  it('refuses them when the node lists none although they were read from one', async () => {
    listed = null;
    await expect(
      checkShotsCurrent(BASE, APP, readFromS1())
    ).rejects.toMatchObject({ code: 'SHOTS_UNVERIFIED' });
  });

  it("refuses published ones that don't say which set they were read from", async () => {
    await expect(
      checkShotsCurrent(BASE, APP, draftsFromManifest(BASE, APP, MANIFEST))
    ).rejects.toMatchObject({ code: 'SHOTS_UNVERIFIED' });
  });

  it('asks the node nothing when no picture is read back', async () => {
    listed = 'fails';
    await expect(
      checkShotsCurrent(BASE, APP, [newPicture()])
    ).resolves.toBeUndefined();
    await expect(checkShotsCurrent(BASE, APP, [])).resolves.toBeUndefined();
    expect(searches()).toHaveLength(0);
  });
});

describe('uploadsFromDrafts', () => {
  it('reads no picture back from a set replaced since', async () => {
    listed = 'S2';
    await expect(
      uploadsFromDrafts(BASE, APP, readFromS1())
    ).rejects.toMatchObject({ code: 'SHOTS_CHANGED' });
    expect(pictureReads()).toHaveLength(0);
  });

  it('refuses pictures read back while the set was being replaced', async () => {
    // The other set is confirmed right after the node answers the first check.
    let checked = false;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (!String(input).includes('/resources/search')) {
        return new Response(new Uint8Array(checked ? [9, 9] : [1, 1]));
      }
      const signature = checked ? 'S2' : 'S1';
      checked = true;
      return new Response(
        JSON.stringify([
          {
            name: 'Publisher',
            service: 'IMAGE',
            identifier: 'qhub_app_shots_v1_APP',
            latestSignature: signature,
          },
        ])
      );
    });
    await expect(
      uploadsFromDrafts(BASE, APP, readFromS1())
    ).rejects.toMatchObject({ code: 'SHOTS_CHANGED' });
  });

  it('reads them back from the current set', async () => {
    const uploads = await uploadsFromDrafts(BASE, APP, [
      ...readFromS1(),
      newPicture(),
    ]);
    expect(uploads.map((upload) => Array.from(upload.data))).toEqual([
      [1, 1],
      [2, 2],
      [7],
    ]);
  });
});

describe('heldAfterPublish', () => {
  it('holds the published pictures under their new file names', async () => {
    // The first one was taken off: the node numbers the rest anew.
    const published = [readFromS1()[1], newPicture()];
    const uploads = await uploadsFromDrafts(BASE, APP, published);
    const { held } = heldAfterPublish(published, uploads);

    expect(held.map((shot) => [shot.id, shot.caption])).toEqual([
      ['existing-1.webp', 'Feed'],
      ['existing-2.webp', 'New'],
    ]);
    expect(Array.from(await blobBytes(held[0].blob!))).toEqual([2, 2]);
    expect(held[0].url).toBe('blob:held');
    expect(held[0].readFrom).toBeUndefined();
    expect(held[1].blob).toBe(published[1].blob);
    // Nothing of it needs the node again.
    listed = 'fails';
    await expect(checkShotsCurrent(BASE, APP, held)).resolves.toBeUndefined();
  });

  it('keeps edits made meanwhile when it moves a list onto them', async () => {
    const published = readFromS1();
    const uploads = await uploadsFromDrafts(BASE, APP, published);
    const { held, move } = heldAfterPublish(published, uploads);
    const added = newPicture();
    // Edited while it uploaded: a caption changed, the order swapped, and a
    // picture added.
    const edited = [{ ...published[1], caption: 'News' }, published[0], added];

    expect(move(edited)).toEqual([
      { ...held[1], caption: 'News' },
      held[0],
      added,
    ]);
  });

  it('leaves out pictures of the old set that were taken off', async () => {
    // All of them were taken off: the list the form still holds is gone.
    const { held, move } = heldAfterPublish([], []);
    expect(held).toEqual([]);
    expect(move(readFromS1())).toEqual([]);
    const added = newPicture();
    expect(move([...readFromS1(), added])).toEqual([added]);
  });

  it('counts as unchanged against what it published', async () => {
    const published = [readFromS1()[1], newPicture()];
    const uploads = await uploadsFromDrafts(BASE, APP, published);
    const { held } = heldAfterPublish(published, uploads);
    const manifest = manifestOfHeld(held);

    expect(manifest.shots).toEqual([
      { file: '1.webp', caption: 'Feed' },
      { file: '2.webp', caption: 'New' },
    ]);
    expect(shotDraftsChanged(held, manifest)).toBe(false);
    expect(
      shotDraftsChanged([{ ...held[0], caption: 'News' }, held[1]], manifest)
    ).toBe(true);
    expect(shotDraftsChanged([held[1], held[0]], manifest)).toBe(true);
    expect(shotDraftsChanged([...held, newPicture()], manifest)).toBe(true);
  });
});
