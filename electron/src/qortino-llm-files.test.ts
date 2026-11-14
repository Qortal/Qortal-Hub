import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupStorage,
  DownloadCancelledError,
  downloadToFile,
  fetchKeepingKeyOnOrigin,
  isDownloadTarget,
  isLoadableModelPath,
  modelFileNameFromUrl,
  OTHER_MODELS_DIR,
  otherModelRelativePath,
  readPickedModels,
  rememberPickedModel,
  resolveInsideRoot,
  sha256File,
} from './qortino-llm-files';

let root: string;

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qortino-files-'));
});

afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});

const write = async (relative: string, content: string) => {
  const full = path.join(root, relative);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, content);
  return full;
};

/** A fetch that serves `body`, honouring Range like a node or a CDN. */
function servingFetch(
  body: Buffer,
  options: { cutAt?: number; ignoreRange?: boolean } = {}
) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    const range = /bytes=(\d+)-/.exec(headers.Range || '');
    const start = range && !options.ignoreRange ? Number(range[1]) : 0;
    if (start >= body.length && range) {
      return new Response(null, { status: 416 });
    }
    let slice = body.subarray(start);
    if (options.cutAt !== undefined && calls.length === 1) {
      slice = body.subarray(start, options.cutAt);
    }
    const responseHeaders: Record<string, string> = {
      'content-length': String(body.length - start),
    };
    if (start > 0) {
      responseHeaders['content-range'] =
        `bytes ${start}-${body.length - 1}/${body.length}`;
    }
    return new Response(slice, {
      status: start > 0 ? 206 : 200,
      headers: responseHeaders,
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('Qortino folder paths', () => {
  it('keeps paths inside the folder', () => {
    expect(resolveInsideRoot(root, 'models/a.gguf')).toBe(
      path.join(root, 'models', 'a.gguf')
    );
    for (const bad of [
      '',
      '../outside.gguf',
      'models/../../x',
      './models/a.gguf',
      '/etc/passwd',
      'C:\\Windows\\x',
      'models/a\u0000.gguf',
    ]) {
      expect(() => resolveInsideRoot(root, bad)).toThrow();
    }
  });

  it('names a linked model after its file, safely', () => {
    expect(
      modelFileNameFromUrl(
        'https://huggingface.co/x/y/resolve/main/Phi-4-mini-Q4_K_M.gguf?download=true'
      )
    ).toBe('Phi-4-mini-Q4_K_M.gguf');
    expect(modelFileNameFromUrl('https://example.com/a%20b/..%2Fevil')).toBe(
      '_evil.gguf'
    );
    expect(modelFileNameFromUrl('not a url')).toBe('model.gguf');
  });
});

describe('models added by link', () => {
  it('keeps the .gguf ending on a very long name', () => {
    const long = `${'a'.repeat(200)}.gguf`;
    const name = modelFileNameFromUrl(`https://e.com/${long}`);
    expect(name.endsWith('.gguf')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(155);
  });

  it('gives each link a folder of its own, the same one with or without a query', () => {
    const a = otherModelRelativePath('https://a.example/x/model-Q4_K_M.gguf');
    const b = otherModelRelativePath('https://b.example/y/model-Q4_K_M.gguf');
    const again = otherModelRelativePath(
      'https://a.example/x/model-Q4_K_M.gguf?download=true'
    );
    expect(a.filename).toBe('model-Q4_K_M.gguf');
    expect(a.relativePath).toMatch(
      new RegExp(`^${OTHER_MODELS_DIR}/[0-9a-f]{12}/model-Q4_K_M\\.gguf$`)
    );
    expect(b.relativePath).not.toBe(a.relativePath);
    expect(again.relativePath).toBe(a.relativePath);
    // A query that names another file is another file.
    expect(
      otherModelRelativePath('https://e.com/get.php?file=a.gguf').relativePath
    ).not.toBe(
      otherModelRelativePath('https://e.com/get.php?file=b.gguf').relativePath
    );
  });

  it('downloads only model files, into their own folders', () => {
    expect(isDownloadTarget('models/q-00001-of-00002.gguf')).toBe(true);
    expect(isDownloadTarget(`${OTHER_MODELS_DIR}/abc/phi.gguf`)).toBe(true);
    expect(isDownloadTarget('qortino-picked-models.json')).toBe(false);
    expect(isDownloadTarget('models/evil.json')).toBe(false);
    expect(isDownloadTarget('cache/x.gguf')).toBe(false);
  });
});

describe('which model files may be loaded', () => {
  it("allows Qortino's folder and files the user picked, nothing else", async () => {
    const inside = path.join(root, 'models', 'm.gguf');
    const pickedFile = path.join(os.tmpdir(), 'elsewhere', 'mine.gguf');
    const picked = readPickedModels(root);
    expect(isLoadableModelPath(root, picked, inside)).toBe(true);
    expect(isLoadableModelPath(root, picked, pickedFile)).toBe(false);
    await rememberPickedModel(root, picked, pickedFile);
    expect(isLoadableModelPath(root, picked, pickedFile)).toBe(true);
    // Remembered across restarts.
    expect(isLoadableModelPath(root, readPickedModels(root), pickedFile)).toBe(
      true
    );
    for (const bad of [
      'relative.gguf',
      path.join(root, 'models', 'm.bin'),
      path.join(root, '..', 'outside.gguf'),
      '//host/share/m.gguf',
      '/etc/passwd',
    ]) {
      expect(isLoadableModelPath(root, picked, bad)).toBe(false);
    }
  });
});

describe('cleaning up the Qortino folder', () => {
  it('deletes what is not kept, but never the models added by link', async () => {
    await write('models/part-1.gguf', 'aa');
    await write('models/old-pack.zip', 'bbbb');
    await write('cache/warmup.kv', 'c');
    await write(`${OTHER_MODELS_DIR}/phi.gguf`, 'phi');

    const result = await cleanupStorage(root, ['models/part-1.gguf']);
    expect(result).toEqual({ deletedFiles: 2, freedBytes: 5 });
    expect(fs.existsSync(path.join(root, 'models/part-1.gguf'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'cache'))).toBe(false);
    expect(fs.existsSync(path.join(root, OTHER_MODELS_DIR, 'phi.gguf'))).toBe(
      true
    );
  });
});

describe('hashing a model part', () => {
  it('gives the sha256 and reports progress', async () => {
    const file = await write('models/x.gguf', 'hello');
    const seen: number[] = [];
    const result = await sha256File(file, (read) => seen.push(read));
    expect(result).toEqual({
      sha256:
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      size: 5,
    });
    expect(seen.at(-1)).toBe(5);
  });
});

describe('downloading a model', () => {
  const body = Buffer.from('0123456789abcdefghij');

  it('saves through .part, sends the node key as a header and reports progress', async () => {
    const { impl, calls } = servingFetch(body);
    const target = path.join(root, 'models', 'm.gguf');
    const progress: number[] = [];
    const result = await downloadToFile({
      url: 'http://127.0.0.1:12391/arbitrary/FILE/Qortino%20AI/id',
      apiKey: 'secret',
      target,
      signal: new AbortController().signal,
      events: { onProgress: (received) => progress.push(received) },
      fetchImpl: impl,
    });
    expect(result).toEqual({ path: target, bytesWritten: body.length });
    expect(fs.readFileSync(target)).toEqual(body);
    expect(fs.existsSync(`${target}.part`)).toBe(false);
    expect(calls[0].headers['X-API-KEY']).toBe('secret');
    expect(calls[0].url).not.toContain('secret');
    expect(progress.at(-1)).toBe(body.length);
  });

  it('carries on from a .part a cut transfer left', async () => {
    const target = path.join(root, 'models', 'm.gguf');
    await write('models/m.gguf.part', body.subarray(0, 8).toString());
    const { impl, calls } = servingFetch(body);
    await downloadToFile({
      url: 'https://example.com/m.gguf',
      target,
      signal: new AbortController().signal,
      events: { onProgress: () => undefined },
      fetchImpl: impl,
    });
    expect(calls[0].headers.Range).toBe('bytes=8-');
    expect(fs.readFileSync(target)).toEqual(body);
  });

  it('starts over when the server ignores the range', async () => {
    const target = path.join(root, 'models', 'm.gguf');
    await write('models/m.gguf.part', 'garbage!');
    const { impl } = servingFetch(body, { ignoreRange: true });
    await downloadToFile({
      url: 'https://example.com/m.gguf',
      target,
      signal: new AbortController().signal,
      events: { onProgress: () => undefined },
      fetchImpl: impl,
    });
    expect(fs.readFileSync(target)).toEqual(body);
  });

  it('starts over when the server says the range is past the end', async () => {
    const target = path.join(root, 'models', 'm.gguf');
    await write('models/m.gguf.part', `${body.toString()}extra`);
    const { impl, calls } = servingFetch(body);
    await downloadToFile({
      url: 'https://example.com/m.gguf',
      target,
      signal: new AbortController().signal,
      events: { onProgress: () => undefined },
      fetchImpl: impl,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].headers.Range).toBeUndefined();
    expect(fs.readFileSync(target)).toEqual(body);
  });

  it('keeps the .part on a failure and deletes it on cancel', async () => {
    const target = path.join(root, 'models', 'm.gguf');
    const failing = (async () =>
      new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await write('models/m.gguf.part', 'kept');
    await expect(
      downloadToFile({
        url: 'https://example.com/m.gguf',
        target,
        signal: new AbortController().signal,
        events: { onProgress: () => undefined },
        fetchImpl: failing,
      })
    ).rejects.toThrow('HTTP 503');
    expect(fs.existsSync(`${target}.part`)).toBe(true);

    const controller = new AbortController();
    const aborting = (async () => {
      controller.abort();
      throw new Error('aborted');
    }) as unknown as typeof fetch;
    await expect(
      downloadToFile({
        url: 'https://example.com/m.gguf',
        target,
        signal: controller.signal,
        events: { onProgress: () => undefined },
        fetchImpl: aborting,
      })
    ).rejects.toBeInstanceOf(DownloadCancelledError);
    expect(fs.existsSync(`${target}.part`)).toBe(false);
  });

  it('refuses redirects for a keyed download it cannot follow hop by hop', async () => {
    const seen: string[] = [];
    const impl = (async (_url: string, init?: RequestInit) => {
      seen.push(String(init?.redirect));
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    await downloadToFile({
      url: 'http://127.0.0.1:12391/arbitrary/FILE/Qortino%20AI/id',
      apiKey: 'secret',
      target: path.join(root, 'models', 'k.gguf'),
      signal: new AbortController().signal,
      events: { onProgress: () => undefined },
      fetchImpl: impl,
    });
    expect(seen).toEqual(['error']);
  });

  it('only fetches web links', async () => {
    await expect(
      downloadToFile({
        url: 'file:///etc/passwd',
        target: path.join(root, 'x.gguf'),
        signal: new AbortController().signal,
        events: { onProgress: () => undefined },
      })
    ).rejects.toThrow('Only http and https');
  });
});

describe("the node's API key and redirects", () => {
  const ok = () => ({ response: new Response('ok', { status: 200 }) });

  it('keeps the key on the node, and drops it once a redirect leaves', async () => {
    const calls: Array<[string, Record<string, string>]> = [];
    const routes: Record<string, string> = {
      'http://127.0.0.1:12391/a': '/b',
      'http://127.0.0.1:12391/b': 'https://cdn.example/file',
      'https://cdn.example/file': 'http://127.0.0.1:12391/c',
    };
    await fetchKeepingKeyOnOrigin(
      'http://127.0.0.1:12391/a',
      { 'X-API-KEY': 'secret', Range: 'bytes=5-' },
      new AbortController().signal,
      async (url, headers) => {
        calls.push([url, headers]);
        return routes[url] ? { redirect: routes[url] } : ok();
      }
    );
    expect(calls.map(([url, headers]) => [url, headers['X-API-KEY']])).toEqual([
      ['http://127.0.0.1:12391/a', 'secret'],
      // Same origin: still the node.
      ['http://127.0.0.1:12391/b', 'secret'],
      // Another origin: no key, and none again after it.
      ['https://cdn.example/file', undefined],
      ['http://127.0.0.1:12391/c', undefined],
    ]);
    // Other headers go on as they were.
    expect(calls.every(([, headers]) => headers.Range === 'bytes=5-')).toBe(
      true
    );
  });

  it('treats another port or scheme as another origin, whatever the case of the header', async () => {
    const sent: Array<string | undefined> = [];
    await fetchKeepingKeyOnOrigin(
      'http://127.0.0.1:12391/a',
      { 'x-api-key': 'secret' },
      new AbortController().signal,
      async (url, headers) => {
        sent.push(headers['x-api-key']);
        if (url.endsWith('/a'))
          return { redirect: 'https://127.0.0.1:12391/b' };
        if (url.endsWith('/b')) return { redirect: 'https://127.0.0.1:9999/c' };
        return ok();
      }
    );
    expect(sent).toEqual(['secret', undefined, undefined]);
  });

  it('refuses a redirect to anything but a web link, and endless ones', async () => {
    await expect(
      fetchKeepingKeyOnOrigin(
        'http://127.0.0.1:12391/a',
        { 'X-API-KEY': 'secret' },
        new AbortController().signal,
        async () => ({ redirect: 'file:///etc/passwd' })
      )
    ).rejects.toThrow('not a web link');
    await expect(
      fetchKeepingKeyOnOrigin(
        'http://127.0.0.1:12391/a',
        {},
        new AbortController().signal,
        async (url) => ({ redirect: `${url}x` })
      )
    ).rejects.toThrow('Too many redirects');
  });

  it('downloads a keyed file through the hops', async () => {
    const seen: Array<string | undefined> = [];
    const target = path.join(root, 'models', 'h.gguf');
    await downloadToFile({
      url: 'http://127.0.0.1:12391/arbitrary/FILE/Qortino%20AI/id',
      apiKey: 'secret',
      target,
      signal: new AbortController().signal,
      events: { onProgress: () => undefined },
      hop: async (url, headers) => {
        seen.push(headers['X-API-KEY']);
        return url.includes('/arbitrary/')
          ? { redirect: 'https://mirror.example/id' }
          : { response: new Response('0123456789', { status: 200 }) };
      },
    });
    expect(seen).toEqual(['secret', undefined]);
    expect(fs.readFileSync(target, 'utf8')).toBe('0123456789');
  });
});
