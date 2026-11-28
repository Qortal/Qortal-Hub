import { describe, expect, it, vi } from 'vitest';
import real from './__fixtures__/subscreen-credits.json';
import {
  findSubscreenPerson,
  readSubscreenPersonName,
  subscreenPersonSearchUrl,
} from './subscreenPeople';

const NODE = 'http://node.test:12391';

type Hit = {
  name: string;
  identifier: string;
  size?: number;
  created?: number;
  metadata?: { title?: string; description?: string };
};

/** A node with these search hits and documents (by "name/identifier"). */
const fakeNode = (hits: Hit[], documents: Record<string, string>) => {
  const fetch = vi.fn(async (url: string) => {
    const path = url.slice(NODE.length);
    if (path.startsWith('/arbitrary/resources/search?')) {
      return new Response(JSON.stringify(hits), { status: 200 });
    }
    const match = /^\/arbitrary\/DOCUMENT\/([^/]+)\/([^/?]+)$/.exec(path);
    const key = match
      ? `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`
      : '';
    return key in documents
      ? new Response(documents[key], { status: 200 })
      : new Response('{"error":1401}', { status: 404 });
  });
  return fetch;
};
const reads = (fetch: ReturnType<typeof fakeNode>) =>
  fetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/arbitrary/DOCUMENT/'));

describe('subscreenPersonSearchUrl', () => {
  it('asks as Subscreen does', () => {
    const url = new URL(subscreenPersonSearchUrl(NODE, 'Rob Fenn'));
    expect(url.pathname).toBe('/arbitrary/resources/search');
    expect([...url.searchParams.entries()]).toEqual([
      ['mode', 'ALL'],
      ['service', 'DOCUMENT'],
      ['limit', '80'],
      ['offset', '0'],
      ['reverse', 'true'],
      ['includemetadata', 'true'],
      ['excludeblocked', 'true'],
      ['exactmatchnames', 'true'],
      ['identifier', 'subscreen_person_'],
      ['query', 'Rob Fenn'],
    ]);
  });
});

describe('readSubscreenPersonName', () => {
  it('reads a real person', () => {
    expect(readSubscreenPersonName(JSON.stringify(real.person.data))).toBe(
      'Nora Vale'
    );
  });

  it.each([
    'D',
    'RA==',
    '{"deleted":true,"displayName":"X"}',
    '{}',
    'nope',
    '',
  ])('finds no one in %j', (text) => {
    expect(readSubscreenPersonName(text)).toBeNull();
  });

  it('keeps 80 characters, trimmed', () => {
    expect(
      readSubscreenPersonName(
        JSON.stringify({ displayName: ` ${'x'.repeat(90)}` })
      )
    ).toBe('x'.repeat(80));
  });
});

describe('findSubscreenPerson', () => {
  const nora = real.person.resource;

  it('reuses the person with the same name, whoever published it', async () => {
    const fetch = fakeNode(
      [
        // A profile page is never a person.
        {
          name: 'Someone',
          identifier: 'subscreen_person_profile_4c177548705b1b26',
          size: 544,
          metadata: { title: 'Nora Vale', description: 'Nora Vale' },
        },
        // Someone else whose name contains it: not even read.
        {
          name: 'Other',
          identifier: 'subscreen_person_nora-vale-jr_aaaaa',
          size: 50,
          metadata: { title: 'Nora Vale Jr', description: 'Nora Vale Jr' },
        },
        // Removed ("D"): left out by its size.
        {
          name: 'Gone',
          identifier: 'subscreen_person_nora-vale_ggggg',
          size: 1,
          metadata: { title: 'Nora Vale', description: 'Nora Vale' },
        },
        nora,
      ],
      {
        [`${nora.name}/${nora.identifier}`]: JSON.stringify(real.person.data),
      }
    );
    await expect(
      findSubscreenPerson('  nora   VALE ', { baseUrl: NODE, fetch })
    ).resolves.toEqual({
      name: 'Publisher',
      identifier: 'subscreen_person_nora-vale_bBg3e',
      service: 'DOCUMENT',
    });
    // Searched with the name as typed, cleaned.
    const search = new URL(String(fetch.mock.calls[0][0]));
    expect(search.searchParams.get('query')).toBe('nora VALE');
    expect(reads(fetch)).toEqual([
      `${NODE}/arbitrary/DOCUMENT/Publisher/subscreen_person_nora-vale_bBg3e`,
    ]);
  });

  it('takes the newest of several', async () => {
    const hit = (name: string, created: number) => ({
      name,
      identifier: `subscreen_person_jane-doe_${name}`,
      size: 40,
      created,
      metadata: { title: 'Jane Doe', description: 'Jane Doe' },
    });
    const fetch = fakeNode([hit('a', 100), hit('b', 300), hit('c', 200)], {
      'a/subscreen_person_jane-doe_a': '{"displayName":"Jane Doe"}',
      'b/subscreen_person_jane-doe_b': '{"displayName":"jane doe"}',
      'c/subscreen_person_jane-doe_c': '{"displayName":"Jane Doe"}',
    });
    await expect(
      findSubscreenPerson('Jane Doe', { baseUrl: NODE, fetch })
    ).resolves.toMatchObject({ name: 'b' });
  });

  it('reads a hit without metadata, and checks the name it holds', async () => {
    const fetch = fakeNode(
      [
        { name: 'x', identifier: 'subscreen_person_jane-doe_xxxxx', size: 40 },
        { name: 'y', identifier: 'subscreen_person_jane-doe_yyyyy', size: 40 },
      ],
      {
        'x/subscreen_person_jane-doe_xxxxx': '{"displayName":"Jane Doerr"}',
        'y/subscreen_person_jane-doe_yyyyy': '{"displayName":"Jane  Doe"}',
      }
    );
    await expect(
      findSubscreenPerson('Jane Doe', { baseUrl: NODE, fetch })
    ).resolves.toMatchObject({ name: 'y' });
    expect(reads(fetch)).toHaveLength(2);
  });

  it('finds no one when the only match was deleted or is unreadable', async () => {
    const fetch = fakeNode(
      [
        {
          name: 'x',
          identifier: 'subscreen_person_jane-doe_xxxxx',
          size: 40,
          metadata: { description: 'Jane Doe' },
        },
        {
          name: 'y',
          identifier: 'subscreen_person_jane-doe_yyyyy',
          size: 40,
          metadata: { description: 'Jane Doe' },
        },
      ],
      { 'x/subscreen_person_jane-doe_xxxxx': '{"deleted":true}' }
    );
    await expect(
      findSubscreenPerson('Jane Doe', { baseUrl: NODE, fetch })
    ).resolves.toBeNull();
  });

  it('finds no one when the node fails or answers oddly', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      findSubscreenPerson('Jane Doe', { baseUrl: NODE, fetch: down })
    ).resolves.toBeNull();
    const refusing = vi.fn(async () => new Response('', { status: 500 }));
    await expect(
      findSubscreenPerson('Jane Doe', { baseUrl: NODE, fetch: refusing })
    ).resolves.toBeNull();
    const odd = vi.fn(async () => new Response('{"error":1}'));
    await expect(
      findSubscreenPerson('Jane Doe', { baseUrl: NODE, fetch: odd })
    ).resolves.toBeNull();
  });

  it('asks nothing for an empty name, and stops on a cancel', async () => {
    const fetch = fakeNode([], {});
    await expect(
      findSubscreenPerson('   ', { baseUrl: NODE, fetch })
    ).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    const abort = new AbortController();
    const slow = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        )
    );
    const finding = findSubscreenPerson('Jane Doe', {
      baseUrl: NODE,
      fetch: slow as unknown as typeof fetch,
      signal: abort.signal,
    });
    abort.abort();
    await expect(finding).resolves.toBeNull();
  });
});
