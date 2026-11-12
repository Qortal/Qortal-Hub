import { describe, expect, it, vi } from 'vitest';
import {
  buildPrefillMetadataUrl,
  buildPrefillSearchUrl,
  findOwnDefaultResource,
  loadPublishPrefill,
  prefillFromMetadata,
  tagsFromMetadata,
} from './appPublishPrefill';

const NODE = 'http://127.0.0.1:12391';

const reply = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) });

describe('buildPrefillSearchUrl', () => {
  it("asks for the exact name's default resource only", () => {
    const url = new URL(buildPrefillSearchUrl(NODE, 'APP', 'Q-Node'));
    expect(url.pathname).toBe('/arbitrary/resources/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      service: 'APP',
      name: 'Q-Node',
      exactmatchnames: 'true',
      default: 'true',
      includemetadata: 'true',
      mode: 'ALL',
      limit: '1',
    });
  });

  it('encodes the name', () => {
    const url = buildPrefillSearchUrl(NODE, 'WEBSITE', 'My Site & Co');
    expect(new URL(url).searchParams.get('name')).toBe('My Site & Co');
    expect(url).not.toContain('My Site & Co');
  });
});

describe('buildPrefillMetadataUrl', () => {
  it("points at the name's default metadata", () => {
    expect(buildPrefillMetadataUrl(NODE, 'APP', 'GO Clock')).toBe(
      `${NODE}/arbitrary/metadata/APP/GO%20Clock/default`
    );
  });
});

describe('findOwnDefaultResource', () => {
  const own = { name: 'Q-Node', service: 'APP', identifier: null };

  it('skips another name that contains this one', () => {
    const other = { name: 'Q-Nodecontrol', service: 'APP', identifier: null };
    expect(findOwnDefaultResource([other, own], 'APP', 'Q-Node')).toBe(own);
    expect(findOwnDefaultResource([other], 'APP', 'Q-Node')).toBeNull();
  });

  it('skips non-default identifiers and other services', () => {
    expect(
      findOwnDefaultResource(
        [
          { name: 'Q-Node', service: 'APP', identifier: 'beta' },
          { name: 'Q-Node', service: 'WEBSITE', identifier: null },
        ],
        'APP',
        'Q-Node'
      )
    ).toBeNull();
  });

  it('ignores case, as names are unique regardless of case', () => {
    expect(findOwnDefaultResource([own], 'APP', 'q-node')).toBe(own);
  });

  it('accepts the ways Core writes the default identifier', () => {
    for (const identifier of [undefined, null, '', 'default']) {
      const resource = { name: 'Q-Node', service: 'APP', identifier };
      expect(findOwnDefaultResource([resource], 'APP', 'Q-Node')).toBe(
        resource
      );
    }
  });

  it('copes with answers that are not lists', () => {
    expect(findOwnDefaultResource(null, 'APP', 'Q-Node')).toBeNull();
    expect(findOwnDefaultResource({ error: 1 }, 'APP', 'Q-Node')).toBeNull();
  });
});

describe('tagsFromMetadata and prefillFromMetadata', () => {
  it('reads tags as a list or as a comma-separated string', () => {
    expect(tagsFromMetadata(['a', 'b'])).toEqual(['a', 'b']);
    expect(tagsFromMetadata(' a, b ,, c')).toEqual(['a', 'b', 'c']);
    expect(tagsFromMetadata(null)).toEqual([]);
    expect(tagsFromMetadata(['a', 5, null])).toEqual(['a']);
  });

  it('fills every field, with empty text for anything missing', () => {
    expect(prefillFromMetadata({ title: 'T', tags: ['x'] })).toEqual({
      title: 'T',
      description: '',
      category: '',
      tags: ['x'],
    });
    expect(prefillFromMetadata(undefined).title).toBe('');
  });
});

describe('loadPublishPrefill', () => {
  const metadata = {
    title: 'Q-Node',
    description: 'Qortal Node Management App',
    category: 'TOOLS',
    tags: ['Node Management'],
  };

  it("uses the metadata in the search result for the name's own app", async () => {
    const fetchFn = vi.fn(() =>
      reply([
        { name: 'Q-Nodecontrol', service: 'APP', metadata: { title: 'No' } },
        { name: 'Q-Node', service: 'APP', metadata },
      ])
    );

    await expect(
      loadPublishPrefill(NODE, 'APP', 'Q-Node', { fetchFn })
    ).resolves.toEqual({
      kind: 'found',
      prefill: {
        title: 'Q-Node',
        description: 'Qortal Node Management App',
        category: 'TOOLS',
        tags: ['Node Management'],
      },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falls back to the metadata endpoint when the search has none', async () => {
    const fetchFn = vi.fn((url: string) =>
      url.includes('/arbitrary/metadata/')
        ? reply(metadata)
        : reply([{ name: 'Q-Node', service: 'APP', metadata: null }])
    );

    const result = await loadPublishPrefill(NODE, 'APP', 'Q-Node', {
      fetchFn,
    });
    expect(result).toEqual(expect.objectContaining({ kind: 'found' }));
    expect(fetchFn).toHaveBeenLastCalledWith(
      `${NODE}/arbitrary/metadata/APP/Q-Node/default`,
      expect.anything()
    );
  });

  it("reports 'none' when the name has no app yet", async () => {
    const fetchFn = vi.fn(() =>
      reply([{ name: 'Q-Nodecontrol', service: 'APP', metadata }])
    );
    await expect(
      loadPublishPrefill(NODE, 'APP', 'Q-Node', { fetchFn })
    ).resolves.toEqual({ kind: 'none' });
  });

  it("reports 'unavailable' when the details can't be loaded", async () => {
    const noMetadata = vi.fn((url: string) =>
      url.includes('/arbitrary/metadata/')
        ? reply({ error: 'not found' }, false)
        : reply([{ name: 'Q-Node', service: 'APP', metadata: null }])
    );
    await expect(
      loadPublishPrefill(NODE, 'APP', 'Q-Node', { fetchFn: noMetadata })
    ).resolves.toEqual({ kind: 'unavailable' });

    const failing = vi.fn(() => Promise.reject(new Error('offline')));
    await expect(
      loadPublishPrefill(NODE, 'APP', 'Q-Node', { fetchFn: failing })
    ).resolves.toEqual({ kind: 'unavailable' });

    const notOk = vi.fn(() => reply(null, false));
    await expect(
      loadPublishPrefill(NODE, 'APP', 'Q-Node', { fetchFn: notOk })
    ).resolves.toEqual({ kind: 'unavailable' });
  });

  it('passes an abort on, so a newer name wins', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    await expect(
      loadPublishPrefill(NODE, 'APP', 'Q-Node', {
        fetchFn,
        signal: controller.signal,
      })
    ).rejects.toThrow('aborted');
  });
});
