import { createStore } from 'jotai';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  HOME_WIDGETS_STORAGE_KEY,
  HOME_WIDGET_LIMIT,
  addSavedWidget,
  applyWidgetAskedSize,
  applyWidgetLayout,
  homeWidgetKey,
  layoutForColumns,
  normalizeSavedWidgets,
  removeSavedWidget,
  savedHomeWidgetsAtom,
  toWidgetListing,
} from './homeWidgets';

describe('toWidgetListing', () => {
  it('takes an APP tagged go-widget, in any letter case', () => {
    expect(
      toWidgetListing({
        name: 'Clock',
        service: 'APP',
        metadata: {
          title: 'Clock',
          description: 'The time',
          tags: ['time', ' GO-Widget '],
        },
        updated: 5,
      })
    ).toEqual({
      name: 'Clock',
      identifier: null,
      title: 'Clock',
      description: 'The time',
      updated: 5,
    });
  });

  it('takes a tagged APP under a go-widget identifier, next to its app', () => {
    expect(
      toWidgetListing({
        name: 'Torq',
        service: 'APP',
        identifier: 'go-widget-news',
        metadata: { tags: ['go-widget'] },
        created: 3,
      })
    ).toMatchObject({
      name: 'Torq',
      identifier: 'go-widget-news',
      title: 'Torq',
    });
  });

  it.each([
    [
      'an untagged app',
      { name: 'Q-Blog', service: 'APP', metadata: { tags: ['blog'] } },
    ],
    [
      'a website',
      { name: 'Site', service: 'WEBSITE', metadata: { tags: ['go-widget'] } },
    ],
    ['no name', { service: 'APP', metadata: { tags: ['go-widget'] } }],
    [
      'a tag that only contains it',
      { name: 'X', service: 'APP', metadata: { tags: ['not-go-widget'] } },
    ],
    [
      'an identifier that only contains it',
      { name: 'X', service: 'APP', identifier: 'my-go-widget' },
    ],
    [
      'a go-widget identifier without the tag',
      { name: 'Torq', service: 'APP', identifier: 'go-widget-news' },
    ],
    [
      'a retired widget (republished without the tag, e.g. "moved")',
      {
        name: 'Weather Now',
        service: 'APP',
        identifier: 'go-widget-now',
        metadata: { title: 'Moved to Q-Weather', tags: ['weather'] },
      },
    ],
    [
      'tags that are not a list',
      { name: 'X', service: 'APP', metadata: { tags: 'go-widget' } },
    ],
  ])('leaves out %s', (_label, resource) => {
    expect(toWidgetListing(resource as never)).toBeNull();
  });

  it("treats the 'default' identifier as the name's own app", () => {
    expect(
      toWidgetListing({
        name: 'Clock',
        service: 'APP',
        identifier: 'default',
        metadata: { tags: ['go-widget'] },
      })?.identifier
    ).toBeNull();
  });
});

describe('saved widgets', () => {
  const clock = { name: 'Clock', identifier: null };
  const news = { name: 'Torq', identifier: 'go-widget-news', title: 'News' };
  const place = (list: ReturnType<typeof addSavedWidget>) =>
    list.map((w) => [w.name, w.x, w.y, w.w, w.h, w.sizedBy]);

  it('adds once each, filling a wide row before starting the next', () => {
    let list = addSavedWidget([], clock, 15);
    list = addSavedWidget(list, news, 15);
    list = addSavedWidget(list, clock, 15);
    expect(place(list)).toEqual([
      ['Clock', 0, 0, 4, 5, 'default'],
      ['Torq', 4, 0, 4, 5, 'default'],
    ]);
    expect(list[1].title).toBe('News');
  });

  it('adds under the last one when the row is full', () => {
    const list = addSavedWidget(addSavedWidget([], clock, 4), news, 4);
    expect(place(list)).toEqual([
      ['Clock', 0, 0, 4, 5, 'default'],
      ['Torq', 0, 5, 4, 5, 'default'],
    ]);
  });

  it('closes the gap a removed widget leaves', () => {
    const list = addSavedWidget(addSavedWidget([], clock, 4), news, 4);
    expect(place(removeSavedWidget(list, homeWidgetKey(clock)))).toEqual([
      ['Torq', 0, 0, 4, 5, 'default'],
    ]);
  });

  it('keeps a name’s widgets apart by identifier', () => {
    const other = { name: 'Torq', identifier: 'go-widget-weather' };
    expect(
      addSavedWidget(addSavedWidget([], news, 15), other, 15)
    ).toHaveLength(2);
  });

  it('stops at the limit', () => {
    let list = addSavedWidget([], clock, 15);
    for (let i = 0; i < HOME_WIDGET_LIMIT + 2; i += 1) {
      list = addSavedWidget(list, { name: `W${i}`, identifier: null }, 15);
    }
    expect(list).toHaveLength(HOME_WIDGET_LIMIT);
  });

  it('takes the places from an arranged grid', () => {
    const list = addSavedWidget(addSavedWidget([], clock, 4), news, 4);
    const arranged = applyWidgetLayout(list, [
      { key: homeWidgetKey(clock), x: 2, y: 0, w: 2, h: 3, sizedBy: 'user' },
      { key: homeWidgetKey(news), x: 0, y: 0, w: 2, h: 5 },
    ]);
    expect(place(arranged)).toEqual([
      ['Clock', 2, 0, 2, 3, 'user'],
      ['Torq', 0, 0, 2, 5, 'default'],
    ]);
  });

  it('takes the size a widget asks for until the user sizes it', () => {
    let list = addSavedWidget(addSavedWidget([], clock, 4), news, 4);
    list = applyWidgetAskedSize(list, homeWidgetKey(clock), { w: 2, h: 3 }, 4);
    expect(place(list)[0]).toEqual(['Clock', 0, 0, 2, 3, 'widget']);
    // The news widget below moved up into the rows the clock gave back.
    expect(place(list)[1]).toEqual(['Torq', 0, 3, 4, 5, 'default']);
    // Asking for the same again changes nothing (nothing to save).
    expect(
      applyWidgetAskedSize(list, homeWidgetKey(clock), { w: 2, h: 3 }, 4)
    ).toBe(list);
    // Once the user has sized it, the widget no longer can.
    const userSized = applyWidgetLayout(list, [
      { key: homeWidgetKey(clock), x: 0, y: 0, w: 4, h: 2, sizedBy: 'user' },
    ]);
    expect(
      applyWidgetAskedSize(userSized, homeWidgetKey(clock), { w: 1, h: 9 }, 4)
    ).toBe(userSized);
  });

  it('never gives an asking widget more columns than the panel has', () => {
    const list = addSavedWidget([], clock, 4);
    const asked = applyWidgetAskedSize(
      list,
      homeWidgetKey(clock),
      { w: 4, h: 3 },
      2
    );
    expect(place(asked)[0]).toEqual(['Clock', 0, 0, 2, 3, 'widget']);
  });

  it('shows a saved layout inside fewer columns without changing it', () => {
    const list = addSavedWidget(addSavedWidget([], clock, 15), news, 15);
    expect(place(layoutForColumns(list, 4))).toEqual([
      ['Clock', 0, 0, 4, 5, 'default'],
      ['Torq', 0, 5, 4, 5, 'default'],
    ]);
    expect(place(list)[1]).toEqual(['Torq', 4, 0, 4, 5, 'default']);
  });

  it('cleans what it reads back: fields, duplicates, overlaps', () => {
    expect(
      normalizeSavedWidgets([
        {
          name: ' Clock ',
          identifier: '',
          x: 0,
          y: 0,
          w: 4,
          h: 3,
          title: ' T ',
        },
        { name: 'Clock', identifier: null },
        { name: '' },
        'junk',
        {
          name: 'Torq',
          identifier: 'go-widget-news',
          x: 0,
          y: 1,
          w: 9,
          h: 1,
          sizedBy: 'odd',
        },
      ])
    ).toEqual([
      {
        name: 'Clock',
        identifier: null,
        x: 0,
        y: 0,
        w: 4,
        h: 3,
        sizedBy: 'default',
        title: 'T',
      },
      {
        name: 'Torq',
        identifier: 'go-widget-news',
        x: 0,
        y: 3,
        w: 9,
        h: 2,
        sizedBy: 'default',
      },
    ]);
    expect(normalizeSavedWidgets({})).toEqual([]);
  });
});

describe('savedHomeWidgetsAtom', () => {
  beforeEach(() => {
    window.localStorage.removeItem(HOME_WIDGETS_STORAGE_KEY);
  });

  it('saves the list cleaned, and updates it from the current one', () => {
    const store = createStore();
    store.set(savedHomeWidgetsAtom, (list) =>
      addSavedWidget(list, { name: 'Clock', identifier: null }, 4)
    );
    store.set(savedHomeWidgetsAtom, (list) =>
      addSavedWidget(list, { name: 'Torq', identifier: 'go-widget-news' }, 4)
    );
    expect(
      JSON.parse(window.localStorage.getItem(HOME_WIDGETS_STORAGE_KEY)!).map(
        (w: { name: string; y: number }) => [w.name, w.y]
      )
    ).toEqual([
      ['Clock', 0],
      ['Torq', 5],
    ]);
    expect(store.get(savedHomeWidgetsAtom)).toHaveLength(2);
  });
});
