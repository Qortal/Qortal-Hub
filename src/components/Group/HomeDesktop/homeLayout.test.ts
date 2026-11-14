import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY,
  HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY,
  HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY,
  HOME_WIDGETS_VISIBLE_STORAGE_KEY,
} from './homeDesktopConstants';
import {
  HOME_LAYOUT_DEFAULT,
  completeHomeStack,
  homeLayoutStorageKey,
  homeQortinoTargetHeight,
  homeStackRows,
  homeWalletTargetHeight,
  moveHomeStackPanel,
  normalizeHomeLayout,
  readHomeLayout,
  saveHomeLayout,
  useHomeLayout,
  withHomePanelShown,
} from './homeLayout';

const ALICE = 'QaliceAddress00000000000000000000';
const BOB = 'QbobAddress0000000000000000000000';

afterEach(() => {
  localStorage.clear();
});

describe('normalizeHomeLayout', () => {
  it('keeps known panels only, once each, in a fixed order', () => {
    expect(
      normalizeHomeLayout({
        hidden: ['feed', 'nope', 'qortino', 'feed', 7],
        stack: ['feed', 'widgets', 'groupActivity'],
      })
    ).toEqual({
      hidden: ['qortino', 'feed'],
      stack: ['feed', 'widgets', 'groupActivity'],
    });
  });

  it('falls back for anything that is not a layout', () => {
    expect(normalizeHomeLayout(null)).toEqual(HOME_LAYOUT_DEFAULT);
    expect(normalizeHomeLayout('x')).toEqual(HOME_LAYOUT_DEFAULT);
    const fallback = { hidden: ['wallet' as const], stack: [] };
    expect(normalizeHomeLayout({}, fallback).hidden).toEqual(['wallet']);
  });

  it('puts a panel the stored order lacks back after its usual neighbour', () => {
    expect(completeHomeStack(['feed', 'widgets'])).toEqual([
      'feed',
      'widgets',
      'groupActivity',
    ]);
    expect(completeHomeStack(['groupActivity'])).toEqual([
      'widgets',
      'groupActivity',
      'feed',
    ]);
    expect(completeHomeStack(['feed', 'feed', 'x'])).toEqual([
      'widgets',
      'groupActivity',
      'feed',
    ]);
  });
});

describe('readHomeLayout', () => {
  it('starts an account from the switches kept for the whole PC', () => {
    localStorage.setItem(HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY, 'false');
    localStorage.setItem(HOME_WIDGETS_VISIBLE_STORAGE_KEY, 'true');
    localStorage.setItem(
      HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY,
      JSON.stringify({ heights: {}, order: ['quitter', 'groupActivity'] })
    );

    expect(readHomeLayout(ALICE)).toEqual({
      hidden: ['groupActivity'],
      stack: ['widgets', 'feed', 'groupActivity'],
    });
  });

  it('keeps each account to its own layout', () => {
    localStorage.setItem(HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY, 'false');
    saveHomeLayout(ALICE, { hidden: ['qortino'], stack: ['feed', 'widgets'] });

    expect(readHomeLayout(ALICE)).toEqual({
      hidden: ['qortino'],
      stack: ['feed', 'widgets', 'groupActivity'],
    });
    // Bob hasn't changed anything: he still starts from the PC's switches.
    expect(readHomeLayout(BOB)).toEqual({
      hidden: ['feed'],
      stack: ['widgets', 'groupActivity', 'feed'],
    });
    // Saving doesn't touch the PC-wide switches.
    expect(localStorage.getItem(HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY)).toBe(
      'false'
    );
  });

  it('ignores a damaged entry', () => {
    localStorage.setItem(homeLayoutStorageKey(ALICE), '{not json');
    expect(readHomeLayout(ALICE)).toEqual(HOME_LAYOUT_DEFAULT);
  });
});

describe('layout changes', () => {
  it('switches a panel off and on', () => {
    const off = withHomePanelShown(HOME_LAYOUT_DEFAULT, 'wallet', false);
    expect(off.hidden).toEqual(['wallet']);
    expect(withHomePanelShown(off, 'status', false).hidden).toEqual([
      'status',
      'wallet',
    ]);
    expect(withHomePanelShown(off, 'wallet', true).hidden).toEqual([]);
  });

  it('moves a stack panel one place, and not past either end', () => {
    const down = moveHomeStackPanel(HOME_LAYOUT_DEFAULT, 'widgets', 1);
    expect(down.stack).toEqual(['groupActivity', 'widgets', 'feed']);
    expect(moveHomeStackPanel(down, 'feed', -1).stack).toEqual([
      'groupActivity',
      'feed',
      'widgets',
    ]);
    expect(moveHomeStackPanel(HOME_LAYOUT_DEFAULT, 'widgets', -1)).toBe(
      HOME_LAYOUT_DEFAULT
    );
    expect(moveHomeStackPanel(HOME_LAYOUT_DEFAULT, 'feed', 1)).toBe(
      HOME_LAYOUT_DEFAULT
    );
  });
});

describe('homeStackRows', () => {
  const all = () => true;

  it('pairs Group Activity and the feed when they are next to each other', () => {
    expect(homeStackRows(['widgets', 'groupActivity', 'feed'], all)).toEqual([
      ['widgets'],
      ['groupActivity', 'feed'],
    ]);
    expect(homeStackRows(['feed', 'groupActivity', 'widgets'], all)).toEqual([
      ['feed', 'groupActivity'],
      ['widgets'],
    ]);
  });

  it('gives each its own row when another panel stands between them', () => {
    expect(homeStackRows(['groupActivity', 'widgets', 'feed'], all)).toEqual([
      ['groupActivity'],
      ['widgets'],
      ['feed'],
    ]);
    // A switched-off panel between them doesn't count.
    expect(
      homeStackRows(
        ['groupActivity', 'widgets', 'feed'],
        (id) => id !== 'widgets'
      )
    ).toEqual([['groupActivity', 'feed']]);
  });

  it('leaves out switched-off panels', () => {
    expect(
      homeStackRows(['widgets', 'groupActivity', 'feed'], (id) => id === 'feed')
    ).toEqual([['feed']]);
  });
});

describe('wide layout heights', () => {
  const box = (bottom: number, height: number) => ({ bottom, height });

  it('ends the Qortino column where the account column ends', () => {
    // Account 380 + gap 20 + Featured 426, minus Quick Tools 250 and its gap.
    expect(
      homeQortinoTargetHeight({
        featured: box(0, 426),
        gap: 20,
        minHeight: 426,
        profile: box(0, 380),
        tools: box(0, 250),
      })
    ).toBe(556);
    // The same as before the panels could be switched off.
    expect(
      homeQortinoTargetHeight({
        featured: box(0, 426),
        gap: 20,
        minHeight: 0,
        profile: box(0, 380),
        tools: box(0, 250),
      })
    ).toBe(380 + 426 - 250);
  });

  it('takes the whole column without Quick Tools, and keeps a minimum', () => {
    expect(
      homeQortinoTargetHeight({
        featured: box(0, 426),
        gap: 20,
        minHeight: 426,
        profile: box(0, 380),
      })
    ).toBe(826);
    expect(
      homeQortinoTargetHeight({
        gap: 20,
        minHeight: 426,
        profile: box(0, 380),
        tools: box(0, 250),
      })
    ).toBe(426);
    expect(homeQortinoTargetHeight({ gap: 20, minHeight: 426 })).toBeNull();
  });

  it('ends Wallet Activity where the lowest panel on the left ends', () => {
    expect(homeWalletTargetHeight([900, 940, 920], 600, 260)).toBe(340);
    expect(homeWalletTargetHeight([], 600, 260)).toBeNull();
  });

  it('keeps Wallet Activity tall enough for its content', () => {
    // Only a short panel on the left: the card keeps its minimum.
    expect(homeWalletTargetHeight([558], 471, 260)).toBe(260);
    expect(homeWalletTargetHeight([500], 600, 260)).toBe(260);
  });
});

describe('useHomeLayout', () => {
  it('saves for the account and keeps every user of it in step', () => {
    const first = renderHook(() => useHomeLayout(ALICE));
    const second = renderHook(() => useHomeLayout(ALICE));
    const bob = renderHook(() => useHomeLayout(BOB));

    act(() => {
      first.result.current[1]((layout) =>
        withHomePanelShown(layout, 'featured', false)
      );
    });

    expect(second.result.current[0].hidden).toEqual(['featured']);
    expect(bob.result.current[0].hidden).toEqual([]);
    expect(
      JSON.parse(localStorage.getItem(homeLayoutStorageKey(ALICE)) ?? '{}')
    ).toEqual({
      hidden: ['featured'],
      stack: ['widgets', 'groupActivity', 'feed'],
    });
  });

  it('saves nothing without an account', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useHomeLayout(undefined));
    act(() => {
      result.current[1]((layout) =>
        withHomePanelShown(layout, 'featured', false)
      );
    });
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
