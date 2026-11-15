import { describe, expect, it, vi } from 'vitest';
import {
  WIDGET_SLUG_MAX_LENGTH,
  cleanWidgetSlug,
  finalWidgetSlug,
  isValidWidgetSlug,
  loadNameWidgets,
  nameWidgetsFrom,
  nameWidgetsUrl,
  widgetIdentifier,
  widgetPublishTags,
  withoutWidgetTag,
} from './widgetPublish';

const NODE = 'http://127.0.0.1:12391';

describe('widget IDs', () => {
  it('keeps lowercase letters, digits and single dashes', () => {
    expect(cleanWidgetSlug('My Clock')).toBe('my-clock');
    expect(cleanWidgetSlug('Météo  2!')).toBe('meteo-2-');
    expect(cleanWidgetSlug('--news')).toBe('news');
    expect(cleanWidgetSlug('a__b')).toBe('a-b');
  });

  it('drops a pasted go-widget- prefix', () => {
    expect(cleanWidgetSlug('go-widget-weather')).toBe('weather');
    expect(cleanWidgetSlug('GO-WIDGET-Weather')).toBe('weather');
  });

  it('keeps a dash at the end while typing, but not when published', () => {
    expect(cleanWidgetSlug('my-')).toBe('my-');
    expect(finalWidgetSlug('my-')).toBe('my');
    expect(widgetIdentifier('my-')).toBe('go-widget-my');
  });

  it('fits Core’s 64-character identifiers', () => {
    const long = 'x'.repeat(100);
    expect(cleanWidgetSlug(long)).toHaveLength(WIDGET_SLUG_MAX_LENGTH);
    expect(widgetIdentifier(long)).toHaveLength(64);
  });

  it('gives no identifier until the ID is valid', () => {
    expect(widgetIdentifier('')).toBe('');
    expect(widgetIdentifier('-')).toBe('');
    expect(widgetIdentifier('clock')).toBe('go-widget-clock');
    expect(isValidWidgetSlug('a-b-c')).toBe(true);
    expect(isValidWidgetSlug('a--b')).toBe(false);
    expect(isValidWidgetSlug('A')).toBe(false);
  });
});

describe('widget tags', () => {
  it('puts go-widget first, then the filled-in own tags', () => {
    expect(widgetPublishTags(['', 'time', ' ', 'clock'])).toEqual([
      'go-widget',
      'time',
      'clock',
      '',
      '',
    ]);
  });

  it('never repeats go-widget and keeps five slots', () => {
    expect(widgetPublishTags(['Go-Widget', 'a', 'b', 'c', 'd', 'e'])).toEqual([
      'go-widget',
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('leaves go-widget out of the editable tags', () => {
    expect(withoutWidgetTag(['go-widget', 'news', 'GO-WIDGET '])).toEqual([
      'news',
    ]);
  });
});

describe("the name's widgets", () => {
  it('asks for the exact name and the go-widget prefix', () => {
    const url = new URL(nameWidgetsUrl(NODE, 'Q-Weather'));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      service: 'APP',
      name: 'Q-Weather',
      exactmatchnames: 'true',
      identifier: 'go-widget',
      prefix: 'true',
      includemetadata: 'true',
      mode: 'ALL',
      limit: '0',
    });
  });

  it("keeps the name's own widgets, newest first, each once", () => {
    const widgets = nameWidgetsFrom(
      [
        {
          name: 'q-weather',
          service: 'APP',
          identifier: 'go-widget-now',
          metadata: { title: 'Now', tags: ['go-widget'] },
          updated: 10,
        },
        {
          name: 'Q-Weather',
          service: 'APP',
          identifier: 'go-widget-meteogram',
          metadata: { title: '', tags: ['weather'] },
          created: 30,
        },
        {
          name: 'Q-Weather',
          service: 'APP',
          identifier: 'go-widget-now',
          metadata: { title: 'Now 2', tags: ['GO-WIDGET'] },
          updated: 20,
        },
        // Not this name, not a widget ID, not an APP.
        { name: 'Q-Weather Fan', identifier: 'go-widget-x', updated: 99 },
        { name: 'Q-Weather', identifier: 'default', updated: 99 },
        { name: 'Q-Weather', service: 'WEBSITE', identifier: 'go-widget-y' },
      ],
      'Q-Weather'
    );
    expect(widgets).toEqual([
      {
        identifier: 'go-widget-meteogram',
        title: 'go-widget-meteogram',
        updated: 30,
        listed: false,
      },
      {
        identifier: 'go-widget-now',
        title: 'Now 2',
        updated: 20,
        listed: true,
      },
    ]);
  });

  it('gives none when the node fails, and passes an abort on', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(
      loadNameWidgets(NODE, 'A', { fetchFn: failing })
    ).resolves.toEqual([]);
    await expect(
      loadNameWidgets(NODE, 'A', {
        fetchFn: async () => ({ ok: false, json: async () => [] }),
      })
    ).resolves.toEqual([]);

    const controller = new AbortController();
    controller.abort();
    await expect(
      loadNameWidgets(NODE, 'A', {
        fetchFn: failing,
        signal: controller.signal,
      })
    ).rejects.toThrow('offline');
  });
});
