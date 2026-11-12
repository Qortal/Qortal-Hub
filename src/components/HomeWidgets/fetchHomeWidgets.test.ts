import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHomeWidgetCacheForTests,
  fetchHomeWidgets,
  mergeWidgetResults,
  widgetSearchUrls,
} from './fetchHomeWidgets';

const BASE = 'https://node.example';

const ok = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

const byIdentifier = [
  {
    name: 'Torq',
    service: 'APP',
    identifier: 'go-widget-news',
    metadata: { tags: ['go-widget'] },
    updated: 30,
  },
  // A retired widget: still under its identifier, no longer tagged.
  {
    name: 'Old',
    service: 'APP',
    identifier: 'go-widget-old',
    metadata: { title: 'Moved', tags: ['weather'] },
    updated: 40,
  },
];
const all = [
  { name: 'Q-Blog', service: 'APP', metadata: { tags: ['blog'] }, updated: 99 },
  {
    name: 'Clock',
    service: 'APP',
    metadata: { title: 'Clock', tags: ['go-widget'] },
    updated: 10,
  },
  // The same widget the identifier search found, an older copy.
  {
    name: 'Torq',
    service: 'APP',
    identifier: 'go-widget-news',
    metadata: { tags: ['go-widget'] },
    updated: 20,
  },
];

describe('fetchHomeWidgets', () => {
  beforeEach(() => clearHomeWidgetCacheForTests());

  it('asks the node for go-widget identifiers (filtered there) and for all apps', () => {
    const urls = widgetSearchUrls(BASE);
    expect(urls.byIdentifier).toContain('identifier=go-widget&prefix=true');
    expect(urls.byIdentifier).toContain('excludeblocked=true');
    expect(urls.byTag).toContain(
      'service=APP&mode=ALL&limit=0&includemetadata=true'
    );
    expect(urls.byTag).not.toContain('identifier=');
  });

  it('merges both answers, one tagged entry per widget, newest first', async () => {
    const fetcher = vi.fn((url: string) =>
      ok(url.includes('identifier=go-widget') ? byIdentifier : all)
    );
    const widgets = await fetchHomeWidgets(BASE, { fetcher });
    expect(widgets.map((w) => [w.name, w.identifier, w.updated])).toEqual([
      ['Torq', 'go-widget-news', 30],
      ['Clock', null, 10],
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps a full answer for a while, and asks again when told', async () => {
    const fetcher = vi.fn((url: string) =>
      ok(url.includes('identifier=go-widget') ? byIdentifier : all)
    );
    await fetchHomeWidgets(BASE, { fetcher, now: 1000 });
    await fetchHomeWidgets(BASE, { fetcher, now: 2000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await fetchHomeWidgets(BASE, { fetcher, now: 3000, fresh: true });
    expect(fetcher).toHaveBeenCalledTimes(4);
    await fetchHomeWidgets(BASE, { fetcher, now: 3000 + 11 * 60_000 });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('shows what one search found when the other fails, without keeping it', async () => {
    const fetcher = vi.fn((url: string) =>
      url.includes('identifier=go-widget')
        ? ok(byIdentifier)
        : Promise.resolve(new Response('', { status: 502 }))
    );
    const widgets = await fetchHomeWidgets(BASE, { fetcher });
    expect(widgets.map((w) => w.name)).toEqual(['Torq']);
    await fetchHomeWidgets(BASE, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('asks again next time when none are published yet', async () => {
    const fetcher = vi.fn(() => ok([]));
    expect(await fetchHomeWidgets(BASE, { fetcher })).toEqual([]);
    await fetchHomeWidgets(BASE, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('fails when both fail', async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error('offline')));
    await expect(fetchHomeWidgets(BASE, { fetcher })).rejects.toThrow(
      'offline'
    );
  });

  it('ignores empty answers', () => {
    expect(mergeWidgetResults([], [])).toEqual([]);
  });
});
