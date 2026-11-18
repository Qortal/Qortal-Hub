import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHomeWidgetCacheForTests,
  fetchHomeWidgets,
  mergeWidgetResults,
  rememberPublishedWidget,
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

  it('asks again until the node lists a widget published from this Hub', async () => {
    // Published at 1,500, as remembered below.
    const fresh = {
      name: 'Tester',
      service: 'APP',
      identifier: 'go-widget-clock',
      metadata: { tags: ['go-widget'] },
      updated: 1500,
    };
    let listed = false;
    const fetcher = vi.fn((url: string) =>
      ok(
        url.includes('identifier=go-widget')
          ? [...byIdentifier, ...(listed ? [fresh] : [])]
          : all
      )
    );
    await fetchHomeWidgets(BASE, { fetcher, now: 1000 });
    rememberPublishedWidget(
      { name: 'Tester', identifier: 'go-widget-clock' },
      1500
    );
    // Kept, but without the new widget: the node is asked again.
    await fetchHomeWidgets(BASE, { fetcher, now: 2000 });
    expect(fetcher).toHaveBeenCalledTimes(4);
    listed = true;
    const widgets = await fetchHomeWidgets(BASE, { fetcher, now: 3000 });
    expect(widgets.map((w) => w.identifier)).toContain('go-widget-clock');
    // Listed now: what was kept is used again.
    await fetchHomeWidgets(BASE, { fetcher, now: 4000 });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('stops waiting for a published widget after a while', async () => {
    const fetcher = vi.fn((url: string) =>
      ok(url.includes('identifier=go-widget') ? byIdentifier : all)
    );
    rememberPublishedWidget({ name: 'Gone', identifier: 'go-widget-x' }, 0);
    await fetchHomeWidgets(BASE, { fetcher, now: 16 * 60_000 });
    await fetchHomeWidgets(BASE, { fetcher, now: 16 * 60_000 + 1000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
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

const clock = (title: string, updated: number) => ({
  name: 'Tester',
  service: 'APP',
  identifier: 'go-widget-clock',
  metadata: { title, tags: ['go-widget'] },
  updated,
});

describe('fetchHomeWidgets – an update published from this Hub', () => {
  beforeEach(() => clearHomeWidgetCacheForTests());

  it('shows the new version once the node lists it, not the one kept from before', async () => {
    // The node lists "Clock" until the update to "Clock 2" (published at
    // 5,000) is in.
    let version = clock('Clock', 1000);
    const fetcher = vi.fn((url: string) =>
      ok(url.includes('identifier=go-widget') ? [version] : [])
    );
    // The picker was opened before the update.
    await fetchHomeWidgets(BASE, { fetcher, now: 2000 });

    rememberPublishedWidget(
      { name: 'Tester', identifier: 'go-widget-clock' },
      5000
    );
    // A minute later the node lists the update.
    version = clock('Clock 2', 5000);
    const widgets = await fetchHomeWidgets(BASE, { fetcher, now: 65_000 });

    expect(widgets.map((widget) => widget.title)).toEqual(['Clock 2']);
  });

  it('keeps asking while the node still lists the version the update replaced', async () => {
    let version = clock('Clock', 1000);
    const fetcher = vi.fn((url: string) =>
      ok(url.includes('identifier=go-widget') ? [version] : [])
    );
    rememberPublishedWidget(
      { name: 'Tester', identifier: 'go-widget-clock' },
      5000
    );
    // Opened right after the publish: the node has the old version yet.
    await fetchHomeWidgets(BASE, { fetcher, now: 6000 });
    version = clock('Clock 2', 5000);
    const widgets = await fetchHomeWidgets(BASE, { fetcher, now: 65_000 });

    expect(widgets.map((widget) => widget.title)).toEqual(['Clock 2']);
  });
});
