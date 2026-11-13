import { useCallback, useEffect, useState } from 'react';
import {
  HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY,
  HOME_DASHBOARD_MODULE_VISIBILITY_CHANGE_EVENT,
  HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY,
  HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY,
  HOME_WIDGETS_VISIBLE_STORAGE_KEY,
} from './homeDesktopConstants';
import { parseHomeCustomizableCardsLayout } from './utils';

/**
 * What Home shows, and the order of the full-width panels under its top part,
 * saved per account. The account card isn't listed: it holds the settings, so
 * switching it off would hide the way back.
 */
export type HomePanelId =
  | 'qortino'
  | 'tools'
  | 'featured'
  | 'status'
  | 'wallet'
  | 'widgets'
  | 'groupActivity'
  | 'feed';

/** The full-width panels under the top part, which can go in any order. */
export type HomeStackPanelId = Extract<
  HomePanelId,
  'widgets' | 'groupActivity' | 'feed'
>;

/** The panels of the top part, in the order the settings list them. */
export const HOME_TOP_PANEL_IDS: readonly HomePanelId[] = [
  'qortino',
  'tools',
  'featured',
  'status',
  'wallet',
];

export const HOME_STACK_PANEL_IDS: readonly HomeStackPanelId[] = [
  'widgets',
  'groupActivity',
  'feed',
];

const HOME_PANEL_IDS: readonly HomePanelId[] = [
  ...HOME_TOP_PANEL_IDS,
  ...HOME_STACK_PANEL_IDS,
];

export type HomeLayout = {
  /** The panels switched off, in HOME_PANEL_IDS order. */
  hidden: HomePanelId[];
  /** The full-width panels under the top part, top to bottom. */
  stack: HomeStackPanelId[];
};

export const HOME_LAYOUT_DEFAULT: HomeLayout = {
  hidden: [],
  stack: [...HOME_STACK_PANEL_IDS],
};

export const homeLayoutStorageKey = (address: string) =>
  `home-layout-v1:${address}`;

const isHomePanelId = (value: unknown): value is HomePanelId =>
  typeof value === 'string' &&
  (HOME_PANEL_IDS as readonly string[]).includes(value);

const isHomeStackPanelId = (value: unknown): value is HomeStackPanelId =>
  typeof value === 'string' &&
  (HOME_STACK_PANEL_IDS as readonly string[]).includes(value);

/**
 * A stored stack order made whole: unknown and repeated ids are dropped, and
 * a panel it doesn't list (one added later) goes back after the panel it
 * follows by default.
 */
export const completeHomeStack = (
  stored: readonly unknown[]
): HomeStackPanelId[] => {
  const result: HomeStackPanelId[] = [];
  stored.forEach((id) => {
    if (isHomeStackPanelId(id) && !result.includes(id)) result.push(id);
  });
  HOME_STACK_PANEL_IDS.forEach((id, index) => {
    if (result.includes(id)) return;
    let insertAt = 0;
    for (let before = index - 1; before >= 0; before -= 1) {
      const at = result.indexOf(HOME_STACK_PANEL_IDS[before]);
      if (at !== -1) {
        insertAt = at + 1;
        break;
      }
    }
    result.splice(insertAt, 0, id);
  });
  return result;
};

/** A layout from anything stored, with the fallback for what's missing. */
export const normalizeHomeLayout = (
  value: unknown,
  fallback: HomeLayout = HOME_LAYOUT_DEFAULT
): HomeLayout => {
  if (!value || typeof value !== 'object') {
    return { hidden: [...fallback.hidden], stack: [...fallback.stack] };
  }
  const { hidden, stack } = value as { hidden?: unknown; stack?: unknown };
  return {
    hidden: Array.isArray(hidden)
      ? HOME_PANEL_IDS.filter((id) => hidden.includes(id))
      : [...fallback.hidden],
    stack: Array.isArray(stack)
      ? completeHomeStack(stack)
      : [...fallback.stack],
  };
};

export const sameHomeLayout = (a: HomeLayout, b: HomeLayout) =>
  a.hidden.length === b.hidden.length &&
  a.hidden.every((id, index) => b.hidden[index] === id) &&
  a.stack.length === b.stack.length &&
  a.stack.every((id, index) => b.stack[index] === id);

const readDeviceSwitch = (key: string): boolean => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? true : JSON.parse(raw) !== false;
  } catch {
    return true;
  }
};

/**
 * Before layouts were kept per account, three switches and the Group Activity
 * / feed swap were kept for the whole PC. An account without a layout of its
 * own starts from them.
 */
export const readDeviceHomeLayout = (): HomeLayout => {
  if (typeof window === 'undefined') return normalizeHomeLayout(null);
  const hidden: HomePanelId[] = [];
  if (!readDeviceSwitch(HOME_WIDGETS_VISIBLE_STORAGE_KEY)) {
    hidden.push('widgets');
  }
  if (!readDeviceSwitch(HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY)) {
    hidden.push('groupActivity');
  }
  if (!readDeviceSwitch(HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY)) {
    hidden.push('feed');
  }
  let cards: string[] = [];
  try {
    cards = parseHomeCustomizableCardsLayout(
      window.localStorage.getItem(HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY)
    ).order;
  } catch {
    // The default order, then.
  }
  const feedFirst =
    cards.includes('quitter') &&
    cards.indexOf('quitter') < cards.indexOf('groupActivity');
  return normalizeHomeLayout({
    hidden,
    stack: feedFirst ? ['widgets', 'feed', 'groupActivity'] : undefined,
  });
};

/** The account's layout, or where it starts when it has none yet. */
export const readHomeLayout = (address?: string | null): HomeLayout => {
  const start = readDeviceHomeLayout();
  if (!address || typeof window === 'undefined') return start;
  try {
    const raw = window.localStorage.getItem(homeLayoutStorageKey(address));
    return raw === null ? start : normalizeHomeLayout(JSON.parse(raw), start);
  } catch {
    return start;
  }
};

export const saveHomeLayout = (address: string, layout: HomeLayout) => {
  try {
    window.localStorage.setItem(
      homeLayoutStorageKey(address),
      JSON.stringify(normalizeHomeLayout(layout))
    );
  } catch (error) {
    console.warn('Unable to save the Home layout.', error);
  }
  window.dispatchEvent(
    new CustomEvent(HOME_DASHBOARD_MODULE_VISIBILITY_CHANGE_EVENT)
  );
};

export const isHomePanelShown = (layout: HomeLayout, id: HomePanelId) =>
  !layout.hidden.includes(id);

export const withHomePanelShown = (
  layout: HomeLayout,
  id: HomePanelId,
  shown: boolean
): HomeLayout => ({
  ...layout,
  hidden: HOME_PANEL_IDS.filter((panel) =>
    panel === id ? !shown : layout.hidden.includes(panel)
  ),
});

/** Swaps a stack panel with its neighbour above (-1) or below (1). */
export const moveHomeStackPanel = (
  layout: HomeLayout,
  id: HomeStackPanelId,
  offset: -1 | 1
): HomeLayout => {
  const index = layout.stack.indexOf(id);
  const target = index + offset;
  if (index === -1 || target < 0 || target >= layout.stack.length) {
    return layout;
  }
  const stack = [...layout.stack];
  [stack[index], stack[target]] = [stack[target], stack[index]];
  return { ...layout, stack };
};

/**
 * The stack's rows as Home lays them out. Group Activity and the feed share a
 * row when nothing shown stands between them, as they always have; any other
 * panel gets a row of its own.
 */
export const homeStackRows = (
  stack: readonly HomeStackPanelId[],
  isShown: (id: HomeStackPanelId) => boolean
): HomeStackPanelId[][] => {
  const rows: HomeStackPanelId[][] = [];
  stack.filter(isShown).forEach((id) => {
    const last = rows[rows.length - 1];
    if (
      last?.length === 1 &&
      last[0] !== 'widgets' &&
      id !== 'widgets' &&
      last[0] !== id
    ) {
      last.push(id);
    } else {
      rows.push([id]);
    }
  });
  return rows;
};

type PanelBox = { bottom: number; height: number };

/**
 * Wide layout: the Qortino card's height that ends its column, with Quick
 * Tools under it when shown, where the account column (the account card, then
 * Featured Q-Apps when shown) ends. Never below `minHeight`.
 */
export const homeQortinoTargetHeight = ({
  featured,
  gap,
  minHeight,
  profile,
  tools,
}: {
  featured?: PanelBox;
  gap: number;
  minHeight: number;
  profile?: PanelBox;
  tools?: PanelBox;
}): number | null => {
  if (!profile) return null;
  const accountColumn = profile.height + (featured ? gap + featured.height : 0);
  const underQortino = tools ? gap + tools.height : 0;
  return Math.max(minHeight, Math.round(accountColumn - underQortino));
};

/**
 * Wide layout: Wallet Activity's height that ends the right column where the
 * lowest panel on the left ends, and never below `minHeight`.
 */
export const homeWalletTargetHeight = (
  leftBottoms: readonly number[],
  walletTop: number,
  minHeight: number
): number | null =>
  leftBottoms.length
    ? Math.max(minHeight, Math.max(...leftBottoms) - walletTop)
    : null;

/** The account's layout, kept in step with the settings and other windows. */
export function useHomeLayout(address?: string | null) {
  const [layout, setLayout] = useState(() => readHomeLayout(address));

  useEffect(() => {
    const sync = () => {
      const next = readHomeLayout(address);
      setLayout((current) => (sameHomeLayout(current, next) ? current : next));
    };
    sync();
    window.addEventListener(
      HOME_DASHBOARD_MODULE_VISIBILITY_CHANGE_EVENT,
      sync
    );
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(
        HOME_DASHBOARD_MODULE_VISIBILITY_CHANGE_EVENT,
        sync
      );
      window.removeEventListener('storage', sync);
    };
  }, [address]);

  const updateLayout = useCallback(
    (change: (current: HomeLayout) => HomeLayout) => {
      if (!address) return;
      saveHomeLayout(address, change(readHomeLayout(address)));
    },
    [address]
  );

  return [layout, updateLayout] as const;
}
