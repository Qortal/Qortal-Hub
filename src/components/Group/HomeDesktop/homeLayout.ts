import { useCallback, useEffect, useState } from 'react';
import {
  HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY,
  HOME_DASHBOARD_MODULE_VISIBILITY_CHANGE_EVENT,
  HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY,
  HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY,
  HOME_WIDGETS_VISIBLE_STORAGE_KEY,
} from './homeDesktopConstants';
import {
  type HomeGridItem,
  type HomeWindowId,
  type HomeWorkspaceCopyId,
  homeDefaultGrid,
  homeGridWithWindowUnder,
  homeWorkspaceCopyId,
  homeWorkspaceCopyKey,
  normalizeHomeGrid,
  sameHomeGrid,
} from './homeGrid';
import { parseHomeCustomizableCardsLayout } from './utils';

/**
 * What Home shows, and where, saved per account. The account card isn't
 * listed: it holds the settings, so switching it off would hide the way back.
 */
export type HomePanelId =
  | 'workspace'
  | 'qortino'
  | 'tools'
  | 'featured'
  | 'status'
  | 'wallet'
  | 'widgets'
  | 'groupActivity'
  | 'feed';

/** The full-width panels under the top part of the default layout. */
export type HomeStackPanelId = Extract<
  HomePanelId,
  'widgets' | 'groupActivity' | 'feed'
>;

/** The panels of the top part, in the order the settings list them. */
export const HOME_TOP_PANEL_IDS: readonly HomePanelId[] = [
  'workspace',
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
  /**
   * The full-width panels under the top part, top to bottom: where the
   * default grid puts them until the account arranges Home itself.
   */
  stack: HomeStackPanelId[];
  /**
   * Where every window is, hidden ones included (they come back where they
   * were), once the account has arranged Home (homeGrid.ts).
   */
  grid?: HomeGridItem[];
  /**
   * The Workspace's copies, made with Duplicate in Edit Home, oldest first:
   * the keys of their windows (homeWorkspaceCopyId). A copy is removed
   * rather than hidden.
   */
  workspaces?: string[];
  /** HOME_LAYOUT_VERSION: every layout read has it. */
  version?: number;
};

/**
 * What the stored layout means. 2: the Workspace and Qortino are windows of
 * their own. A layout stored without it is older: Qortino's switch hid both.
 */
export const HOME_LAYOUT_VERSION = 2;

/** Copies of the Workspace at the most, besides the Workspace itself. */
export const HOME_WORKSPACE_COPY_LIMIT = 8;

export const HOME_LAYOUT_DEFAULT: HomeLayout = {
  hidden: [],
  stack: [...HOME_STACK_PANEL_IDS],
  version: HOME_LAYOUT_VERSION,
};

export const homeLayoutStorageKey = (address: string) =>
  `home-layout-v1:${address}`;

const isHomePanelId = (value: unknown): value is HomePanelId =>
  typeof value === 'string' &&
  (HOME_PANEL_IDS as readonly string[]).includes(value);

const WORKSPACE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** The stored copies of the Workspace, cleaned: valid keys, no repeats. */
export const normalizeHomeWorkspaces = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const keys: string[] = [];
  for (const key of value) {
    if (
      typeof key !== 'string' ||
      !WORKSPACE_KEY_PATTERN.test(key) ||
      keys.includes(key)
    ) {
      continue;
    }
    keys.push(key);
    if (keys.length >= HOME_WORKSPACE_COPY_LIMIT) break;
  }
  return keys;
};

export const homeWorkspaceCopyIds = (layout: HomeLayout) =>
  (layout.workspaces ?? []).map(homeWorkspaceCopyId);

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
    return {
      hidden: [...fallback.hidden],
      stack: [...fallback.stack],
      ...(fallback.grid ? { grid: [...fallback.grid] } : {}),
      ...(fallback.workspaces?.length
        ? { workspaces: [...fallback.workspaces] }
        : {}),
      version: HOME_LAYOUT_VERSION,
    };
  }
  const { grid, hidden, stack, version, workspaces } = value as {
    grid?: unknown;
    hidden?: unknown;
    stack?: unknown;
    version?: unknown;
    workspaces?: unknown;
  };
  // Stored before the Workspace was a window of its own, when Qortino's
  // switch hid it too.
  const older = !(Number(version) >= HOME_LAYOUT_VERSION);
  const normalStack = Array.isArray(stack)
    ? completeHomeStack(stack)
    : [...fallback.stack];
  const normalWorkspaces = Array.isArray(workspaces)
    ? normalizeHomeWorkspaces(workspaces)
    : [...(fallback.workspaces ?? [])];
  const normalHidden = Array.isArray(hidden)
    ? HOME_PANEL_IDS.filter(
        (id) =>
          hidden.includes(id) ||
          (older && id === 'workspace' && hidden.includes('qortino'))
      )
    : [...fallback.hidden];
  // The hidden panels don't move the shown ones (normalizeHomeGrid).
  const normalGrid =
    normalizeHomeGrid(
      grid,
      normalStack,
      normalWorkspaces.map(homeWorkspaceCopyId),
      normalHidden
    ) ?? fallback.grid;
  return {
    hidden: normalHidden,
    stack: normalStack,
    ...(normalGrid ? { grid: [...normalGrid] } : {}),
    ...(normalWorkspaces.length ? { workspaces: normalWorkspaces } : {}),
    version: HOME_LAYOUT_VERSION,
  };
};

export const sameHomeLayout = (a: HomeLayout, b: HomeLayout) =>
  a.hidden.length === b.hidden.length &&
  a.hidden.every((id, index) => b.hidden[index] === id) &&
  a.stack.length === b.stack.length &&
  a.stack.every((id, index) => b.stack[index] === id) &&
  (a.workspaces ?? []).join('\n') === (b.workspaces ?? []).join('\n') &&
  sameHomeGrid(a.grid, b.grid);

/**
 * Where every window is: the account's arrangement, or the default one, with
 * the copies of the Workspace it lacks under everything.
 */
export const homeLayoutGrid = (layout: HomeLayout): HomeGridItem[] => {
  const grid = layout.grid ?? homeDefaultGrid(layout.stack);
  const copies = homeWorkspaceCopyIds(layout);
  if (copies.every((id) => grid.some((item) => item.key === id))) {
    return grid;
  }
  return normalizeHomeGrid(grid, layout.stack, copies, layout.hidden) ?? grid;
};

const newWorkspaceKey = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Duplicate: a new, empty copy of the Workspace right under `under` (the
 * Workspace or a copy of it), as big as it. Shown windows in its way go down
 * to make room; hidden ones keep their places. The same layout back at the
 * HOME_WORKSPACE_COPY_LIMIT.
 */
export const withHomeWorkspaceCopy = (
  layout: HomeLayout,
  under: HomeWindowId,
  key: string = newWorkspaceKey()
): HomeLayout => {
  const current = layout.workspaces ?? [];
  if (
    current.length >= HOME_WORKSPACE_COPY_LIMIT ||
    current.includes(key) ||
    !WORKSPACE_KEY_PATTERN.test(key)
  ) {
    return layout;
  }
  return {
    ...layout,
    grid: homeGridWithWindowUnder(
      homeLayoutGrid(layout),
      under,
      homeWorkspaceCopyId(key),
      layout.hidden
    ),
    workspaces: [...current, key],
  };
};

/** A copy of the Workspace taken off Home; the shown windows under it rise. */
export const withoutHomeWorkspaceCopy = (
  layout: HomeLayout,
  id: HomeWorkspaceCopyId
): HomeLayout => {
  const key = homeWorkspaceCopyKey(id);
  return normalizeHomeLayout({
    ...layout,
    grid: layout.grid?.filter((item) => item.key !== id),
    version: HOME_LAYOUT_VERSION,
    workspaces: (layout.workspaces ?? []).filter((other) => other !== key),
  });
};

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

/** Saves the account's layout: what Home saves is in the current format. */
export const saveHomeLayout = (address: string, layout: HomeLayout) => {
  try {
    window.localStorage.setItem(
      homeLayoutStorageKey(address),
      JSON.stringify(
        normalizeHomeLayout({ ...layout, version: HOME_LAYOUT_VERSION })
      )
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

/**
 * Whether a window shows on Home now. While Getting started shows (in
 * Qortino's window, which grows with it) the Workspace makes way, so the
 * rest of Home stays where it is. That isn't saved in the layout: the
 * Workspace comes back where it was once Getting started is done.
 */
export const isHomePanelShownNow = (
  layout: HomeLayout,
  id: HomePanelId,
  { gettingStarted = false }: { gettingStarted?: boolean } = {}
) =>
  isHomePanelShown(layout, id) &&
  !(
    id === 'workspace' &&
    gettingStarted &&
    isHomePanelShown(layout, 'qortino')
  );

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
