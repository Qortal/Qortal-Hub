import { useCallback, useEffect, useState } from 'react';

/**
 * The side panel (Home, Apps, Q-Chat, ...) as the account arranged it:
 * which buttons, in which order and how big, whether it waits at the left
 * edge or stays open beside the content, how much of its background shows,
 * and the edge handle that opens it. Saved per account, like Home's layout.
 *
 * Everything here but the hook is pure.
 */

/** The panel's own buttons; `divider` is the line between its two groups. */
export type SidePanelBuiltInKind =
  | 'home'
  | 'apps'
  | 'qchat'
  | 'dev'
  | 'divider'
  | 'info'
  | 'language'
  | 'theme';

export type SidePanelService = 'APP' | 'WEBSITE';

/** A Q-App or a website the account added. */
export type SidePanelQdnItem = {
  kind: 'qdn';
  service: SidePanelService;
  name: string;
};

/** One of the panel's own buttons; some can be hidden (SIDE_PANEL_HIDEABLE). */
export type SidePanelBuiltInItem = {
  kind: SidePanelBuiltInKind;
  hidden?: boolean;
};

export type SidePanelItem = SidePanelBuiltInItem | SidePanelQdnItem;

export type SidePanelSettings = {
  /** At the left edge until the pointer comes, or always, beside the content. */
  show: 'hover' | 'always';
  /**
   * A bar of buttons down the left edge, or a half circle with the buttons
   * round its rim, turned by scrolling over it.
   */
  layout: 'bar' | 'arc';
  /** How much of the panel's background shows: 0 (none) to 1 (all). */
  background: number;
  /** The buttons' size: 1 as designed, a bit smaller or bigger. */
  buttonSize: number;
  /**
   * The handle at the left edge that opens the panel. Without it, the whole
   * left edge does.
   */
  edgeHandle: boolean;
  /** The edge handle's height, in px. */
  handleHeight: number;
  /** How much of the edge handle's fill shows: 0 (its outline only) to 1. */
  handleBackground: number;
  items: SidePanelItem[];
};

/** A setting's range, in the steps its slider takes. */
export type SidePanelRange = { min: number; max: number; step: number };

export const SIDE_PANEL_BUTTON_SIZES: SidePanelRange = {
  min: 0.8,
  max: 1.25,
  step: 0.05,
};

export const SIDE_PANEL_HANDLE_HEIGHTS: SidePanelRange = {
  min: 40,
  max: 240,
  step: 4,
};

export const SIDE_PANEL_BUILT_INS: readonly SidePanelBuiltInKind[] = [
  'home',
  'apps',
  'qchat',
  'dev',
  'divider',
  'info',
  'language',
  'theme',
];

/**
 * The panel's own buttons that can be hidden: the language, the theme, and
 * the node's information, which the title bar shows on hover too.
 */
export const SIDE_PANEL_HIDEABLE: readonly SidePanelBuiltInKind[] = [
  'info',
  'language',
  'theme',
];

/** Q-Apps and websites the panel holds at most. */
export const SIDE_PANEL_ADDED_LIMIT = 12;

export const SIDE_PANEL_DEFAULT: SidePanelSettings = {
  show: 'hover',
  layout: 'bar',
  background: 1,
  buttonSize: 1,
  edgeHandle: true,
  handleHeight: 96,
  handleBackground: 1,
  items: SIDE_PANEL_BUILT_INS.map((kind) => ({ kind })),
};

export const SIDE_PANEL_SETTINGS_CHANGE_EVENT = 'side-panel-settings-change';

export const sidePanelStorageKey = (address: string) =>
  `side-panel-v1:${address}`;

export const isSidePanelQdnItem = (
  item: SidePanelItem
): item is SidePanelQdnItem => item.kind === 'qdn';

/** One key per button: its kind, or a Q-App's or website's service and name. */
export const sidePanelItemKey = (item: SidePanelItem): string =>
  isSidePanelQdnItem(item)
    ? `qdn:${item.service}:${item.name.toLowerCase()}`
    : item.kind;

const isBuiltInKind = (value: unknown): value is SidePanelBuiltInKind =>
  typeof value === 'string' &&
  (SIDE_PANEL_BUILT_INS as readonly string[]).includes(value);

const toItem = (raw: unknown): SidePanelItem | null => {
  if (!raw || typeof raw !== 'object') return null;
  const { hidden, kind, name, service } = raw as Record<string, unknown>;
  if (isBuiltInKind(kind)) {
    return hidden === true && SIDE_PANEL_HIDEABLE.includes(kind)
      ? { hidden: true, kind }
      : { kind };
  }
  if (kind !== 'qdn') return null;
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const upper = typeof service === 'string' ? service.toUpperCase() : '';
  if (!trimmed || (upper !== 'APP' && upper !== 'WEBSITE')) return null;
  return {
    kind: 'qdn',
    name: trimmed.slice(0, 80),
    service: upper as SidePanelService,
  };
};

const clamp01 = (value: unknown, fallback: number) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

/** In the range, on one of its steps. */
export const toSidePanelStep = (
  value: unknown,
  { max, min, step }: SidePanelRange,
  fallback: number
) => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const steps = Math.round((Math.min(max, Math.max(min, n)) - min) / step);
  // Rounded, so 0.8 + 4 × 0.05 is 1 and not 1.0000000000000002.
  return Number((min + steps * step).toFixed(4));
};

/**
 * Settings from anything stored: unknown and repeated buttons dropped, a
 * built-in button it lacks (one added later) back after the button it
 * follows by default, at most SIDE_PANEL_ADDED_LIMIT added ones.
 */
export const normalizeSidePanel = (value: unknown): SidePanelSettings => {
  if (!value || typeof value !== 'object') {
    return { ...SIDE_PANEL_DEFAULT, items: [...SIDE_PANEL_DEFAULT.items] };
  }
  const {
    background,
    buttonSize,
    edgeHandle,
    handleBackground,
    handleHeight,
    items,
    layout,
    show,
  } = value as Record<string, unknown>;
  const result: SidePanelItem[] = [];
  const seen = new Set<string>();
  let added = 0;
  for (const raw of Array.isArray(items) ? items : []) {
    const item = toItem(raw);
    if (!item) continue;
    const key = sidePanelItemKey(item);
    if (seen.has(key)) continue;
    if (isSidePanelQdnItem(item)) {
      if (added >= SIDE_PANEL_ADDED_LIMIT) continue;
      added += 1;
    }
    seen.add(key);
    result.push(item);
  }
  SIDE_PANEL_BUILT_INS.forEach((kind, index) => {
    if (seen.has(kind)) return;
    let insertAt = 0;
    for (let before = index - 1; before >= 0; before -= 1) {
      const at = result.findIndex(
        (item) => item.kind === SIDE_PANEL_BUILT_INS[before]
      );
      if (at !== -1) {
        insertAt = at + 1;
        break;
      }
    }
    result.splice(insertAt, 0, { kind });
    seen.add(kind);
  });
  return {
    show: show === 'always' ? 'always' : 'hover',
    layout: layout === 'arc' ? 'arc' : 'bar',
    background: clamp01(background, SIDE_PANEL_DEFAULT.background),
    buttonSize: toSidePanelStep(
      buttonSize,
      SIDE_PANEL_BUTTON_SIZES,
      SIDE_PANEL_DEFAULT.buttonSize
    ),
    edgeHandle: edgeHandle !== false,
    handleHeight: toSidePanelStep(
      handleHeight,
      SIDE_PANEL_HANDLE_HEIGHTS,
      SIDE_PANEL_DEFAULT.handleHeight
    ),
    handleBackground: clamp01(
      handleBackground,
      SIDE_PANEL_DEFAULT.handleBackground
    ),
    items: result,
  };
};

/** Whether the panel shows this button (some of its own can be hidden). */
export const isSidePanelItemShown = (item: SidePanelItem) =>
  isSidePanelQdnItem(item) || !item.hidden;

export const sameSidePanel = (a: SidePanelSettings, b: SidePanelSettings) =>
  a.show === b.show &&
  a.layout === b.layout &&
  a.background === b.background &&
  a.buttonSize === b.buttonSize &&
  a.edgeHandle === b.edgeHandle &&
  a.handleHeight === b.handleHeight &&
  a.handleBackground === b.handleBackground &&
  a.items.length === b.items.length &&
  a.items.every(
    (item, index) =>
      sidePanelItemKey(item) === sidePanelItemKey(b.items[index]) &&
      isSidePanelItemShown(item) === isSidePanelItemShown(b.items[index])
  );

/** One of the panel's own buttons shown or hidden, where it may be. */
export const withSidePanelItemShown = (
  settings: SidePanelSettings,
  kind: SidePanelBuiltInKind,
  shown: boolean
): SidePanelSettings =>
  SIDE_PANEL_HIDEABLE.includes(kind)
    ? {
        ...settings,
        items: settings.items.map((item) =>
          item.kind === kind
            ? shown
              ? { kind }
              : { hidden: true, kind }
            : item
        ),
      }
    : settings;

/** The button at `from` moved to `to` (indexes in `items`). */
export const moveSidePanelItem = (
  settings: SidePanelSettings,
  from: number,
  to: number
): SidePanelSettings => {
  const items = [...settings.items];
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) {
    return settings;
  }
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  return { ...settings, items };
};

/**
 * A Q-App or website added at the end of the first group (before the
 * divider), once. The same settings back when it's there or the panel is
 * full.
 */
export const withSidePanelQdnItem = (
  settings: SidePanelSettings,
  added: { service: string; name: string }
): SidePanelSettings => {
  const item = toItem({ ...added, kind: 'qdn' });
  if (!item) return settings;
  const key = sidePanelItemKey(item);
  const count = settings.items.filter(isSidePanelQdnItem).length;
  if (
    count >= SIDE_PANEL_ADDED_LIMIT ||
    settings.items.some((other) => sidePanelItemKey(other) === key)
  ) {
    return settings;
  }
  const items = [...settings.items];
  const divider = items.findIndex((other) => other.kind === 'divider');
  items.splice(divider === -1 ? items.length : divider, 0, item);
  return { ...settings, items };
};

/** An added Q-App or website taken off; the panel's own buttons stay. */
export const withoutSidePanelItem = (
  settings: SidePanelSettings,
  key: string
): SidePanelSettings => {
  const items = settings.items.filter(
    (item) => !isSidePanelQdnItem(item) || sidePanelItemKey(item) !== key
  );
  return items.length === settings.items.length
    ? settings
    : { ...settings, items };
};

export const readSidePanel = (
  address: string | null | undefined
): SidePanelSettings => {
  if (!address || typeof window === 'undefined') {
    return normalizeSidePanel(null);
  }
  try {
    const raw = window.localStorage.getItem(sidePanelStorageKey(address));
    return normalizeSidePanel(raw === null ? null : JSON.parse(raw));
  } catch {
    return normalizeSidePanel(null);
  }
};

export const saveSidePanel = (address: string, settings: SidePanelSettings) => {
  try {
    window.localStorage.setItem(
      sidePanelStorageKey(address),
      JSON.stringify(normalizeSidePanel(settings))
    );
  } catch (error) {
    console.warn('Unable to save the side panel settings.', error);
  }
  window.dispatchEvent(new CustomEvent(SIDE_PANEL_SETTINGS_CHANGE_EVENT));
};

/** The account's side panel, kept in step with the editor and other windows. */
export function useSidePanelSettings(address?: string | null) {
  const [settings, setSettings] = useState(() => readSidePanel(address));

  useEffect(() => {
    const sync = () => {
      const next = readSidePanel(address);
      setSettings((current) => (sameSidePanel(current, next) ? current : next));
    };
    sync();
    window.addEventListener(SIDE_PANEL_SETTINGS_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SIDE_PANEL_SETTINGS_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [address]);

  const updateSettings = useCallback(
    (change: (current: SidePanelSettings) => SidePanelSettings) => {
      if (!address) return;
      saveSidePanel(address, change(readSidePanel(address)));
    },
    [address]
  );

  return [settings, updateSettings] as const;
}
