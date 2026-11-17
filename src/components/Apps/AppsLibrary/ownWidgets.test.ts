import { describe, expect, it, vi } from 'vitest';
import {
  PUBLISHED_OWN_WIDGET_WAIT_MS,
  loadOwnWidgets,
  ownWidgetsFrom,
  ownWidgetsUrl,
  publishedOwnWidgetInPlace,
  withPublishedOwnWidget,
  withPublishedOwnWidgets,
  type OwnWidget,
} from './ownWidgets';

const resource = (overrides: Record<string, unknown> = {}) => ({
  name: 'Alice',
  service: 'APP',
  identifier: 'go-widget-clock',
  metadata: {
    title: 'Clock',
    description: 'The time',
    tags: ['go-widget', 'time'],
    category: '9',
    categoryName: 'Tools',
  },
  created: 10,
  updated: 20,
  ...overrides,
});

const titles = (widgets: OwnWidget[]) => widgets.map((widget) => widget.title);

describe('ownWidgetsFrom', () => {
  it("keeps the names' widgets as library widgets: listed when tagged go-widget", () => {
    const [clock] = ownWidgetsFrom([resource()], ['Alice']);
    expect(clock).toEqual({
      kind: 'widget',
      service: 'APP',
      name: 'Alice',
      identifier: 'go-widget-clock',
      title: 'Clock',
      description: 'The time',
      category: '9',
      categoryName: 'Tools',
      tags: ['time'],
      created: 10,
      updated: 20,
      listed: true,
    });
  });

  it('keeps a retired widget, not listed, but not every APP of the name', () => {
    const widgets = ownWidgetsFrom(
      [
        // Retired: its go-widget identifier, without the tag.
        resource({
          identifier: 'go-widget-old',
          metadata: { title: 'Old', tags: ['time'] },
          updated: 5,
        }),
        // The name's own app, not a widget.
        resource({ identifier: undefined, metadata: { title: 'App' } }),
        // Another APP of the name, not a widget either.
        resource({ identifier: 'beta', metadata: { title: 'Beta' } }),
      ],
      ['Alice']
    );
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({ title: 'Old', listed: false });
  });

  it("counts the name's own app when it is tagged as a widget", () => {
    const widgets = ownWidgetsFrom(
      [
        resource({ identifier: undefined }),
        // Core's search cache says "default" for a fresh one.
        resource({ name: 'Bob', identifier: 'default' }),
      ],
      ['Alice', 'Bob']
    );
    expect(widgets.map((widget) => [widget.name, widget.identifier])).toEqual([
      ['Alice', null],
      ['Bob', null],
    ]);
  });

  it("keeps only the names' widgets, matching names in any case", () => {
    const widgets = ownWidgetsFrom(
      [
        resource({ name: 'ALICE' }),
        resource({ name: 'Mallory', identifier: 'go-widget-x' }),
        resource({ service: 'WEBSITE', identifier: 'go-widget-site' }),
        null,
        'nonsense',
      ],
      ['alice']
    );
    expect(widgets.map((widget) => widget.name)).toEqual(['ALICE']);
  });

  it('lists each widget once, its newest version, newest first', () => {
    const widgets = ownWidgetsFrom(
      [
        resource({ metadata: { title: 'Clock v1', tags: ['go-widget'] } }),
        resource({
          identifier: 'go-widget-news',
          metadata: { title: 'News', tags: ['go-widget'] },
          updated: 30,
        }),
        resource({
          metadata: { title: 'Clock v2', tags: ['go-widget'] },
          updated: 40,
        }),
      ],
      ['Alice']
    );
    expect(titles(widgets)).toEqual(['Clock v2', 'News']);
  });
});

describe('loadOwnWidgets', () => {
  const answering =
    (byName: Record<string, unknown>, ok = true) =>
    async (url: string) => ({
      ok,
      json: async () => byName[new URL(url).searchParams.get('name') ?? ''],
    });

  it('asks for every APP of each name, with its metadata, and puts the answers together', async () => {
    const fetchFn = vi.fn(
      answering({
        Alice: [resource()],
        Bob: [
          resource({
            name: 'Bob',
            identifier: 'go-widget-news',
            metadata: { title: 'News', tags: ['go-widget'] },
            updated: 30,
          }),
        ],
      })
    );
    const widgets = await loadOwnWidgets('http://node', ['Alice', 'Bob'], {
      fetchFn,
    });

    expect(titles(widgets)).toEqual(['News', 'Clock']);
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      ownWidgetsUrl('http://node', 'Alice'),
      ownWidgetsUrl('http://node', 'Bob'),
    ]);
    const params = new URL(ownWidgetsUrl('http://node', 'Alice')).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      service: 'APP',
      name: 'Alice',
      exactmatchnames: 'true',
      includemetadata: 'true',
      mode: 'ALL',
      limit: '0',
    });
  });

  it("fails when the node can't answer for one of the names, instead of finding none", async () => {
    const failing = vi.fn(async (url: string) => ({
      ok: !url.includes('Bob'),
      json: async () => [],
    }));
    await expect(
      loadOwnWidgets('http://node', ['Alice', 'Bob'], { fetchFn: failing })
    ).rejects.toThrow();

    // An answer that isn't a list is no answer either.
    await expect(
      loadOwnWidgets('http://node', ['Alice'], {
        fetchFn: answering({ Alice: { error: 1 } }),
      })
    ).rejects.toThrow();
  });

  it('passes the abort signal on', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(answering({ Alice: [] }));
    await loadOwnWidgets('http://node', ['Alice'], {
      fetchFn,
      signal: controller.signal,
    });
    expect(fetchFn).toHaveBeenCalledWith(expect.any(String), {
      signal: controller.signal,
    });
  });
});

describe('widgets published from this Hub', () => {
  const NOW = 1_000_000;
  const clock = {
    name: 'Alice',
    identifier: 'go-widget-clock',
    title: 'Clock',
    description: 'The time',
    updated: 0,
  };
  const fromNode = (overrides: Partial<OwnWidget> = {}): OwnWidget => ({
    kind: 'widget',
    service: 'APP',
    ...clock,
    title: 'Clock on the node',
    updated: 500,
    listed: true,
    ...overrides,
  });

  it('show at once, as published, until the node lists them', () => {
    const published = withPublishedOwnWidget([], clock, { now: NOW });

    const before = withPublishedOwnWidgets([], published, ['Alice'], NOW + 1);
    expect(before).toEqual([
      expect.objectContaining({
        kind: 'widget',
        title: 'Clock',
        updated: NOW,
        listed: true,
      }),
    ]);

    const after = withPublishedOwnWidgets(
      [fromNode()],
      published,
      ['Alice'],
      NOW + 2
    );
    expect(titles(after)).toEqual(['Clock on the node']);
  });

  it('show an update in place of the version it replaced, until the node has a newer one', () => {
    const published = withPublishedOwnWidget(
      [],
      { ...clock, title: 'Clock, renamed' },
      { now: NOW, replaces: 500 }
    );
    const old = fromNode({ title: 'Clock', updated: 500, listed: false });

    const waiting = withPublishedOwnWidgets([old], published, ['Alice'], NOW);
    expect(waiting).toEqual([
      expect.objectContaining({ title: 'Clock, renamed', listed: true }),
    ]);

    const newer = fromNode({ title: 'Clock, renamed', updated: NOW - 30 });
    expect(withPublishedOwnWidgets([newer], published, ['Alice'], NOW)).toEqual(
      [newer]
    );
  });

  it("stop showing once the wait is over, and never under another account's names", () => {
    const published = withPublishedOwnWidget([], clock, { now: NOW });
    expect(
      withPublishedOwnWidgets(
        [],
        published,
        ['Alice'],
        NOW + PUBLISHED_OWN_WIDGET_WAIT_MS + 1
      )
    ).toEqual([]);
    expect(withPublishedOwnWidgets([], published, ['Bob'], NOW)).toEqual([]);
  });

  it('keep the latest publish of a widget, and drop the ones whose wait is over', () => {
    let list = withPublishedOwnWidget([], clock, { now: NOW });
    list = withPublishedOwnWidget(
      list,
      { ...clock, identifier: 'go-widget-news', title: 'News' },
      { now: NOW + 10 }
    );
    list = withPublishedOwnWidget(
      list,
      { ...clock, title: 'Clock again' },
      { now: NOW + 20 }
    );
    expect(list.map((item) => item.title)).toEqual(['Clock again', 'News']);

    const later = withPublishedOwnWidget(
      list,
      { ...clock, identifier: 'go-widget-x', title: 'X' },
      { now: NOW + 20 + PUBLISHED_OWN_WIDGET_WAIT_MS + 1 }
    );
    expect(later.map((item) => item.title)).toEqual(['X']);
  });

  it('keep a later update in place of an earlier one from here once the node lists the earlier one', () => {
    // Two forms filled in from the node's version 500: one publishes, then
    // the other.
    let list = withPublishedOwnWidget(
      [],
      { ...clock, title: 'Clock 2' },
      { now: NOW, replaces: 500 }
    );
    list = withPublishedOwnWidget(
      list,
      { ...clock, title: 'Clock 3' },
      { now: NOW + 10, replaces: 500 }
    );
    expect(list).toEqual([
      expect.objectContaining({ title: 'Clock 3', replaces: NOW }),
    ]);

    // The node lists the first one, made before its publish ended.
    const first = fromNode({ title: 'Clock 2', updated: NOW - 1 });
    expect(
      titles(withPublishedOwnWidgets([first], list, ['Alice'], NOW + 20))
    ).toEqual(['Clock 3']);
    expect(
      publishedOwnWidgetInPlace(list, clock, NOW - 1, NOW + 20)?.title
    ).toBe('Clock 3');
    // A version newer than the earlier publish still stands.
    const newer = fromNode({ title: 'Elsewhere', updated: NOW + 5 });
    expect(
      titles(withPublishedOwnWidgets([newer], list, ['Alice'], NOW + 20))
    ).toEqual(['Elsewhere']);
  });

  it("give the publish form the widget that stands in place of the node's version, by the same rule", () => {
    const published = withPublishedOwnWidget(
      [],
      { ...clock, title: 'Clock, renamed' },
      { now: NOW, replaces: 500 }
    );
    const widget = { name: 'alice', identifier: 'go-widget-clock' };
    const inPlace = (nodeUpdated: number, now = NOW + 1) =>
      publishedOwnWidgetInPlace(published, widget, nodeUpdated, now)?.title ??
      null;

    // The node has the version it replaced, or none it gives a time for.
    expect(inPlace(500)).toBe('Clock, renamed');
    expect(inPlace(0)).toBe('Clock, renamed');
    // The node has a newer one.
    expect(inPlace(501)).toBeNull();
    // The wait is over.
    expect(inPlace(500, NOW + PUBLISHED_OWN_WIDGET_WAIT_MS + 1)).toBeNull();
    // Another widget of the name, and another name's.
    expect(
      publishedOwnWidgetInPlace(
        published,
        { name: 'Alice', identifier: 'go-widget-news' },
        500,
        NOW
      )
    ).toBeNull();
    expect(
      publishedOwnWidgetInPlace(
        published,
        { name: 'Bob', identifier: 'go-widget-clock' },
        500,
        NOW
      )
    ).toBeNull();
  });
});
