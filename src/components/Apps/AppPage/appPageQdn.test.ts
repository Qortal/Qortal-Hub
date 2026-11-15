import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AppPageError,
  buildShotsZip,
  fetchAppFiles,
  fetchShotsManifest,
  findAppPageResources,
  publishAppPage,
  publishAppShots,
  republishAppDetails,
  shotImageUrl,
} from './appPageQdn';
import { EMPTY_APP_PAGE } from './appPageData';
import { blobBytes } from './blobBytes';
import { crc32 } from './zipStore';

const BASE = 'http://node';
const APP = { service: 'APP', name: 'Q-Blog' };

type Route = (url: string) => unknown;

/** fetch answering by URL; unknown URLs fail the test. */
const routeFetch = (routes: Record<string, Route | unknown>) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const key = Object.keys(routes).find((pattern) => url.includes(pattern));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    const value =
      typeof routes[key] === 'function'
        ? (routes[key] as Route)(url)
        : routes[key];
    if (value instanceof Response) return value;
    if (value === 404) return new Response('', { status: 404 });
    if (value instanceof Uint8Array) return new Response(value as BodyInit);
    return new Response(
      typeof value === 'string' ? value : JSON.stringify(value)
    );
  });

afterEach(() => {
  vi.restoreAllMocks();
});

/** File names in a stored zip, from its central directory. */
const zipNames = async (blob: Blob) => {
  const data = await blobBytes(blob);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = data.length - 22;
  let offset = view.getUint32(end + 16, true);
  const names: string[] = [];
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    const length = view.getUint16(offset + 28, true);
    names.push(
      new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + length))
    );
    offset += 46 + length;
  }
  return names;
};

describe('finding the page resources', () => {
  it("picks this service's page and screenshots of this name", async () => {
    routeFetch({
      // Without mode=ALL, Core keeps one resource per name and service, so
      // a newer JSON or IMAGE of the name would hide the page's.
      '/arbitrary/resources/search': (url: string) =>
        !url.includes('mode=ALL')
          ? 404
          : [
              {
                name: 'q-blog',
                service: 'JSON',
                identifier: 'qhub_app_page_v1_APP',
                latestSignature: 'S1',
                updated: 5,
              },
              {
                name: 'Q-Blog',
                service: 'IMAGE',
                identifier: 'qhub_app_shots_v1_APP',
                latestSignature: 'S2',
                created: 3,
              },
              {
                name: 'Q-Blog',
                service: 'JSON',
                identifier: 'qhub_app_page_v1_WEBSITE',
              },
              {
                name: 'Other',
                service: 'JSON',
                identifier: 'qhub_app_page_v1_APP',
              },
            ],
    });
    expect(await findAppPageResources(BASE, APP)).toEqual({
      page: { identifier: 'qhub_app_page_v1_APP', signature: 'S1', updated: 5 },
      shots: {
        identifier: 'qhub_app_shots_v1_APP',
        signature: 'S2',
        updated: 3,
      },
    });
  });
});

describe('reading the screenshots', () => {
  it('reads the list from the resource', async () => {
    routeFetch({
      '/arbitrary/resource/status/': { status: 'READY' },
      'filepath=shots.json': {
        v: 1,
        shots: [{ file: '1.webp', caption: 'Home' }],
        updated: 9,
      },
    });
    expect(await fetchShotsManifest(BASE, APP)).toEqual({
      shots: [{ file: '1.webp', caption: 'Home' }],
      updated: 9,
    });
  });

  it('reads a list-only resource, which QDN keeps as one file', async () => {
    routeFetch({
      '/arbitrary/resource/status/': { status: 'READY' },
      'filepath=shots.json': 404,
      '/arbitrary/IMAGE/Q-Blog/qhub_app_shots_v1_APP': {
        v: 1,
        shots: [],
        updated: 9,
      },
    });
    expect(await fetchShotsManifest(BASE, APP)).toEqual({
      shots: [],
      updated: 9,
    });
  });

  it('gives up on a resource that is not published', async () => {
    routeFetch({ '/arbitrary/resource/status/': { status: 'NOT_PUBLISHED' } });
    expect(await fetchShotsManifest(BASE, APP)).toBeNull();
  });

  it('builds image URLs with a version to avoid stale copies', () => {
    expect(
      shotImageUrl(
        BASE,
        { service: 'APP', name: 'My App' },
        '1.webp',
        'abcdefghijklmnopqrstuvwxyz'
      )
    ).toBe(
      'http://node/arbitrary/IMAGE/My%20App/qhub_app_shots_v1_APP?filepath=1.webp&v=abcdefghijklmnop'
    );
  });
});

describe('publishing the page', () => {
  it('publishes the page as JSON under the app name', async () => {
    const send = vi.fn().mockResolvedValue({ signature: 'x' });
    window.sendMessage = send;
    await publishAppPage(APP, { ...EMPTY_APP_PAGE, about: 'Hello' }, 77);
    const payload = send.mock.calls[0][1];
    expect(payload).toMatchObject({
      service: 'JSON',
      identifier: 'qhub_app_page_v1_APP',
      name: 'Q-Blog',
      uploadType: 'base64',
    });
    expect(JSON.parse(atob(payload.data))).toMatchObject({
      v: 1,
      about: 'Hello',
      updated: 77,
    });
  });

  it('fits the longest page the editor allows in one JSON resource', async () => {
    const send = vi.fn().mockResolvedValue({});
    window.sendMessage = send;
    await publishAppPage(APP, {
      ...EMPTY_APP_PAGE,
      about: '"日'.repeat(2000),
      whatsNew: '日'.repeat(1500),
      version: '日'.repeat(32),
      links: {
        website: `https://example.com/${'a'.repeat(270)}`,
        source: `https://example.com/${'b'.repeat(270)}`,
        support: `qortal://APP/${'c'.repeat(280)}`,
      },
    });
    const bytes = atob(send.mock.calls[0][1].data).length;
    expect(bytes).toBeLessThanOrEqual(25 * 1024);
  });

  it('puts the screenshots and their list in one zip', async () => {
    const zip = buildShotsZip(
      APP,
      [
        {
          data: new Uint8Array([1, 2, 3]),
          caption: 'Home',
          width: 1280,
          height: 800,
        },
        { data: new Uint8Array([4]), caption: '' },
      ],
      123
    );
    expect(await zipNames(zip)).toEqual(['shots.json', '1.webp', '2.webp']);
    const data = await blobBytes(zip);
    expect(crc32(data)).not.toBe(0);
  });

  it('publishes the zip as one IMAGE resource', async () => {
    const send = vi.fn().mockResolvedValue({});
    window.sendMessage = send;
    await publishAppShots(APP, [{ data: new Uint8Array([1]), caption: '' }]);
    const payload = send.mock.calls[0][1];
    expect(payload).toMatchObject({
      service: 'IMAGE',
      identifier: 'qhub_app_shots_v1_APP',
      name: 'Q-Blog',
      uploadType: 'zip',
    });
    expect(payload.data.name).toBe('screenshots.zip');
  });
});

describe('publishing new listing details', () => {
  const files = {
    '/arbitrary/resource/status/': { status: 'READY' },
    '/arbitrary/metadata/APP/Q-Blog/default': {
      files: ['index.html', 'assets/app.js'],
    },
    'filepath=index.html': '<html></html>',
    'filepath=assets%2Fapp.js': 'console.log(1)',
  };

  it('reads every file of the app back from the node', async () => {
    routeFetch(files);
    const progress = vi.fn();
    const entries = await fetchAppFiles(BASE, APP, { onProgress: progress });
    expect(entries.map((entry) => entry.path)).toEqual([
      'index.html',
      'assets/app.js',
    ]);
    expect(new TextDecoder().decode(entries[1].data)).toBe('console.log(1)');
    expect(progress).toHaveBeenLastCalledWith({ done: 2, total: 2 });
  });

  it('stops instead of publishing an app with a missing file', async () => {
    routeFetch({ ...files, 'filepath=assets%2Fapp.js': 404 });
    await expect(fetchAppFiles(BASE, APP, {})).rejects.toMatchObject({
      code: 'FILE_MISSING',
    });
  });

  it("stops when the node doesn't list the files", async () => {
    routeFetch({
      ...files,
      '/arbitrary/metadata/APP/Q-Blog/default': { title: 'x' },
    });
    await expect(fetchAppFiles(BASE, APP, {})).rejects.toBeInstanceOf(
      AppPageError
    );
  });

  it('publishes the same files with the new details', async () => {
    routeFetch(files);
    const send = vi.fn().mockResolvedValue({ signature: 'NEW' });
    window.sendMessage = send;
    const response = await republishAppDetails(BASE, APP, {
      title: 'Q-Blog',
      description: 'Blogs',
      category: 'SOCIAL',
      tags: ['blog', '', 'posts'],
    });
    expect(response).toEqual({ signature: 'NEW' });
    const payload = send.mock.calls[0][1];
    expect(payload).toMatchObject({
      service: 'APP',
      name: 'Q-Blog',
      title: 'Q-Blog',
      description: 'Blogs',
      category: 'SOCIAL',
      tag1: 'blog',
      tag2: 'posts',
      tag3: undefined,
      uploadType: 'zip',
    });
    expect(await zipNames(payload.data)).toEqual([
      'index.html',
      'assets/app.js',
    ]);
  });
});
