import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isSidePanelItemShown,
  moveSidePanelItem,
  normalizeSidePanel,
  readSidePanel,
  sameSidePanel,
  SIDE_PANEL_ADDED_LIMIT,
  SIDE_PANEL_BUILT_INS,
  SIDE_PANEL_BUTTON_SIZES,
  SIDE_PANEL_DEFAULT,
  sidePanelItemKey,
  sidePanelStorageKey,
  toSidePanelStep,
  useSidePanelSettings,
  withoutSidePanelItem,
  withSidePanelItemShown,
  withSidePanelQdnItem,
} from './sidePanel';

const ALICE = 'QaliceAddress00000000000000000000';
const keys = (settings: { items: Parameters<typeof sidePanelItemKey>[0][] }) =>
  settings.items.map(sidePanelItemKey);

afterEach(() => {
  localStorage.clear();
});

describe('normalizeSidePanel', () => {
  it('starts from the panel as it was: at the edge, solid, its own buttons', () => {
    expect(normalizeSidePanel(null)).toEqual(SIDE_PANEL_DEFAULT);
    expect(keys(normalizeSidePanel(undefined))).toEqual([
      ...SIDE_PANEL_BUILT_INS,
    ]);
  });

  it('keeps a stored order, without unknown or repeated buttons', () => {
    const settings = normalizeSidePanel({
      background: 0.4,
      items: [
        { kind: 'theme' },
        { kind: 'qdn', name: ' Q-Tube ', service: 'app' },
        { kind: 'home' },
        { kind: 'qdn', name: 'q-tube', service: 'APP' },
        { kind: 'qdn', name: '', service: 'APP' },
        { kind: 'qdn', name: 'Q-Mail', service: 'MAIL' },
        { kind: 'nope' },
        null,
        { kind: 'home' },
      ],
      show: 'always',
    });

    expect(settings.show).toBe('always');
    expect(settings.background).toBe(0.4);
    // Built-in buttons it lacked come back after the one they follow.
    expect(keys(settings)).toEqual([
      'theme',
      'qdn:APP:q-tube',
      'home',
      'apps',
      'qchat',
      'dev',
      'divider',
      'info',
      'language',
    ]);
    expect(settings.items[1]).toEqual({
      kind: 'qdn',
      name: 'Q-Tube',
      service: 'APP',
    });
  });

  it('keeps a half circle, and a bar otherwise', () => {
    expect(normalizeSidePanel({ layout: 'arc' }).layout).toBe('arc');
    expect(normalizeSidePanel({ layout: 'round' }).layout).toBe('bar');
    expect(normalizeSidePanel({}).layout).toBe('bar');
  });

  it('keeps the background between none and full', () => {
    expect(normalizeSidePanel({ background: -1 }).background).toBe(0);
    expect(normalizeSidePanel({ background: 7 }).background).toBe(1);
    expect(normalizeSidePanel({ background: 'x' }).background).toBe(1);
    expect(normalizeSidePanel({ show: 'sometimes' }).show).toBe('hover');
  });

  it('holds a limited number of Q-Apps and websites', () => {
    const items = Array.from(
      { length: SIDE_PANEL_ADDED_LIMIT + 3 },
      (_, i) => ({
        kind: 'qdn',
        name: `App ${i}`,
        service: 'APP',
      })
    );
    const settings = normalizeSidePanel({ items });
    expect(settings.items.filter((item) => item.kind === 'qdn')).toHaveLength(
      SIDE_PANEL_ADDED_LIMIT
    );
  });
});

describe('sizes', () => {
  it("keeps the buttons' size and the handle in range, on a step", () => {
    expect(
      normalizeSidePanel({
        buttonSize: 1.07,
        handleBackground: 3,
        handleHeight: 500,
      })
    ).toEqual(
      expect.objectContaining({
        buttonSize: 1.05,
        handleBackground: 1,
        handleHeight: 240,
      })
    );
    expect(
      normalizeSidePanel({
        buttonSize: 0.1,
        handleBackground: -1,
        handleHeight: 10,
      })
    ).toEqual(
      expect.objectContaining({
        buttonSize: 0.8,
        handleBackground: 0,
        handleHeight: 40,
      })
    );
  });

  it('reads settings stored without them as the panel was', () => {
    expect(normalizeSidePanel({ items: [], show: 'always' })).toEqual(
      expect.objectContaining({
        buttonSize: 1,
        handleBackground: 1,
        handleHeight: 96,
      })
    );
  });

  it('steps without rounding errors', () => {
    expect(toSidePanelStep(1, SIDE_PANEL_BUTTON_SIZES, 0)).toBe(1);
    expect(toSidePanelStep('1.2', SIDE_PANEL_BUTTON_SIZES, 0)).toBe(1.2);
    expect(toSidePanelStep(undefined, SIDE_PANEL_BUTTON_SIZES, 1)).toBe(1);
  });

  it('shows the edge handle unless it was switched off', () => {
    expect(normalizeSidePanel({ items: [] }).edgeHandle).toBe(true);
    expect(normalizeSidePanel({ edgeHandle: false }).edgeHandle).toBe(false);
    expect(normalizeSidePanel({ edgeHandle: 'no' }).edgeHandle).toBe(true);
    expect(
      sameSidePanel(
        { ...SIDE_PANEL_DEFAULT, edgeHandle: false },
        SIDE_PANEL_DEFAULT
      )
    ).toBe(false);
  });

  it('counts a new size as a change', () => {
    for (const change of [
      { buttonSize: 1.1 },
      { handleHeight: 120 },
      { handleBackground: 0 },
    ]) {
      expect(
        sameSidePanel({ ...SIDE_PANEL_DEFAULT, ...change }, SIDE_PANEL_DEFAULT)
      ).toBe(false);
    }
  });
});

describe('hiding buttons', () => {
  it('hides only the language, the theme and the node information', () => {
    const settings = normalizeSidePanel({
      items: [
        { hidden: true, kind: 'home' },
        { hidden: true, kind: 'info' },
        { hidden: true, kind: 'qdn', name: 'Q-Tube', service: 'APP' },
      ],
    });
    expect(settings.items.find((item) => item.kind === 'home')).toEqual({
      kind: 'home',
    });
    expect(settings.items.find((item) => item.kind === 'info')).toEqual({
      hidden: true,
      kind: 'info',
    });
    expect(
      settings.items
        .filter((item) => item.kind === 'qdn')
        .every(isSidePanelItemShown)
    ).toBe(true);
  });

  it('counts hiding as a change, and shows the button again', () => {
    const hidden = withSidePanelItemShown(SIDE_PANEL_DEFAULT, 'theme', false);
    expect(sameSidePanel(hidden, SIDE_PANEL_DEFAULT)).toBe(false);
    expect(withSidePanelItemShown(hidden, 'theme', true)).toEqual(
      SIDE_PANEL_DEFAULT
    );
    expect(withSidePanelItemShown(SIDE_PANEL_DEFAULT, 'home', false)).toBe(
      SIDE_PANEL_DEFAULT
    );
  });
});

describe('changing the buttons', () => {
  it('moves a button', () => {
    const moved = moveSidePanelItem(SIDE_PANEL_DEFAULT, 0, 2);
    expect(keys(moved).slice(0, 3)).toEqual(['apps', 'qchat', 'home']);
    expect(moveSidePanelItem(SIDE_PANEL_DEFAULT, 0, 99)).toBe(
      SIDE_PANEL_DEFAULT
    );
  });

  it('adds a Q-App or website before the divider, once', () => {
    const added = withSidePanelQdnItem(SIDE_PANEL_DEFAULT, {
      name: 'Q-Tube',
      service: 'APP',
    });
    const site = withSidePanelQdnItem(added, {
      name: 'Qortal Wiki',
      service: 'website',
    });

    expect(keys(site).slice(3, 7)).toEqual([
      'dev',
      'qdn:APP:q-tube',
      'qdn:WEBSITE:qortal wiki',
      'divider',
    ]);
    expect(withSidePanelQdnItem(site, { name: 'q-tube', service: 'APP' })).toBe(
      site
    );
    expect(withSidePanelQdnItem(site, { name: 'X', service: 'MAIL' })).toBe(
      site
    );
  });

  it('removes only what was added', () => {
    const added = withSidePanelQdnItem(SIDE_PANEL_DEFAULT, {
      name: 'Q-Tube',
      service: 'APP',
    });
    expect(withoutSidePanelItem(added, 'qdn:APP:q-tube')).toEqual(
      SIDE_PANEL_DEFAULT
    );
    expect(withoutSidePanelItem(SIDE_PANEL_DEFAULT, 'home')).toBe(
      SIDE_PANEL_DEFAULT
    );
  });
});

describe('useSidePanelSettings', () => {
  it('saves per account and follows changes', () => {
    const { result } = renderHook(() => useSidePanelSettings(ALICE));
    expect(result.current[0]).toEqual(SIDE_PANEL_DEFAULT);

    act(() => result.current[1]((current) => ({ ...current, show: 'always' })));

    expect(result.current[0].show).toBe('always');
    expect(
      JSON.parse(localStorage.getItem(sidePanelStorageKey(ALICE)) ?? '{}').show
    ).toBe('always');
    expect(readSidePanel('QsomeoneElse').show).toBe('hover');
  });

  it('changes nothing without an account', () => {
    const { result } = renderHook(() => useSidePanelSettings(null));
    act(() => result.current[1]((current) => ({ ...current, show: 'always' })));
    expect(result.current[0].show).toBe('hover');
    expect(localStorage.length).toBe(0);
  });
});
