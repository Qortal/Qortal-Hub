import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import {
  WIDGET_DEFAULT_H,
  WIDGET_DEFAULT_W,
  WIDGET_GRID_MAX_COLUMNS,
  clampRect,
  fitLayout,
  placeGridItem,
  removeGridItem,
  resizeGridItem,
  type GridItem,
  type GridRect,
} from './widgetGrid';

/**
 * Home widgets: small Q-Apps shown on the Home dashboard (a clock, the
 * weather, the latest posts of an app, ...). The same widgets run on the
 * widgets screen of Qortal GO, so they are found and loaded the same way.
 *
 * A Q-App is a widget when it is published as an APP resource tagged
 * `go-widget` (any letter case). An identifier starting with `go-widget`
 * (`go-widget-news`) is recommended on top: it lets a name publish its widget
 * next to its main app, and Core can filter it on the node (identifier prefix
 * search) where it cannot filter tags, so such widgets are found quickly.
 *
 * Republishing a widget without the tag retires it: it leaves the list, but
 * keeps loading for everyone who has already added it (a "moved" notice, for
 * example), since saved widgets are loaded by name and identifier.
 *
 * Nothing runs until the user adds it: Home shows only the widgets in the
 * saved list, and the list only takes what the user picked.
 */
export const WIDGET_TAG = 'go-widget';
export const WIDGET_IDENTIFIER_PREFIX = 'go-widget';

/** One QDN APP resource, as /arbitrary/resources/search lists it. */
export interface QdnAppResource {
  name?: string;
  service?: string;
  identifier?: string | null;
  metadata?: {
    title?: string;
    description?: string;
    tags?: unknown;
  } | null;
  created?: number;
  updated?: number;
}

/** A widget the picker offers. */
export interface HomeWidgetListing {
  name: string;
  /** null: the name's default APP resource. */
  identifier: string | null;
  title: string;
  description: string;
  updated: number;
}

/**
 * A widget on Home: where it sits on the grid (widgetGrid) and how big it
 * is. `sizedBy` says who chose the size: the default, the widget (asked
 * through GO_WIDGET_SET_SIZE) or the user (resized it), whose choice a
 * widget never overrides.
 */
export interface SavedHomeWidget extends GridRect {
  name: string;
  identifier: string | null;
  /** Shown while it loads and in arrange mode. */
  title?: string;
  sizedBy: 'default' | 'widget' | 'user';
}

/**
 * No more than this many widgets on Home. Each one is a running Q-App in an
 * isolated guest of its own.
 */
export const HOME_WIDGET_LIMIT = 8;

/** A stored identifier: null for the name's default APP resource. */
export const normalizeIdentifier = (identifier: unknown): string | null =>
  typeof identifier === 'string' &&
  identifier.trim() !== '' &&
  identifier !== 'default'
    ? identifier
    : null;

const hasWidgetTag = (tags: unknown): boolean =>
  Array.isArray(tags) &&
  tags.some(
    (tag) => typeof tag === 'string' && tag.trim().toLowerCase() === WIDGET_TAG
  );

/** The listing for `resource` when it is a widget, else null. */
export const toWidgetListing = (
  resource: QdnAppResource | null | undefined
): HomeWidgetListing | null => {
  if (!resource || resource.service !== 'APP') return null;
  const name = typeof resource.name === 'string' ? resource.name.trim() : '';
  if (!name) return null;
  if (!hasWidgetTag(resource.metadata?.tags)) return null;
  const identifier = normalizeIdentifier(resource.identifier);
  const title =
    typeof resource.metadata?.title === 'string' &&
    resource.metadata.title.trim()
      ? resource.metadata.title.trim()
      : name;
  const description =
    typeof resource.metadata?.description === 'string'
      ? resource.metadata.description.trim()
      : '';
  return {
    name,
    identifier,
    title,
    description,
    updated: Number(resource.updated ?? resource.created ?? 0) || 0,
  };
};

/** One key per widget: a name may publish several (by identifier). */
export const homeWidgetKey = (widget: {
  name: string;
  identifier: string | null;
}): string => `${widget.name}\u0000${widget.identifier ?? ''}`;

type Keyed = SavedHomeWidget & { key: string };
const withKeys = (list: readonly SavedHomeWidget[]): Keyed[] =>
  list.map((widget) => ({ ...widget, key: homeWidgetKey(widget) }));
const withoutKeys = (list: readonly Keyed[]): SavedHomeWidget[] =>
  list.map(({ key: _key, ...widget }) => widget);

/** The saved list, cleaned: known fields, no duplicates, no overlaps. */
export const normalizeSavedWidgets = (value: unknown): SavedHomeWidget[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SavedHomeWidget[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<SavedHomeWidget>;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) continue;
    const widget: SavedHomeWidget = {
      name,
      identifier: normalizeIdentifier(entry.identifier),
      ...clampRect(entry),
      sizedBy:
        entry.sizedBy === 'user' || entry.sizedBy === 'widget'
          ? entry.sizedBy
          : 'default',
    };
    if (typeof entry.title === 'string' && entry.title.trim()) {
      widget.title = entry.title.trim().slice(0, 80);
    }
    const key = homeWidgetKey(widget);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(widget);
    if (out.length >= HOME_WIDGET_LIMIT) break;
  }
  return withoutKeys(fitLayout(withKeys(out), WIDGET_GRID_MAX_COLUMNS));
};

/** The saved widgets as a panel with `columns` columns shows them. */
export const layoutForColumns = (
  list: readonly SavedHomeWidget[],
  columns: number
): SavedHomeWidget[] => withoutKeys(fitLayout(withKeys(list), columns));

/**
 * Added in the first free spot (reading from the top left), at a phone's
 * full width, until it or the user sizes it.
 */
export const addSavedWidget = (
  list: readonly SavedHomeWidget[],
  widget: { name: string; identifier: string | null; title?: string },
  columns: number
): SavedHomeWidget[] => {
  const key = homeWidgetKey(widget);
  if (list.some((saved) => homeWidgetKey(saved) === key)) return [...list];
  if (list.length >= HOME_WIDGET_LIMIT) return [...list];
  const added: Keyed = {
    key,
    name: widget.name,
    identifier: widget.identifier,
    ...(widget.title ? { title: widget.title } : {}),
    x: 0,
    y: 0,
    w: WIDGET_DEFAULT_W,
    h: WIDGET_DEFAULT_H,
    sizedBy: 'default',
  };
  return withoutKeys(
    placeGridItem(fitLayout(withKeys(list), columns), added, columns)
  );
};

export const removeSavedWidget = (
  list: readonly SavedHomeWidget[],
  key: string
): SavedHomeWidget[] => withoutKeys(removeGridItem(withKeys(list), key));

/** Every widget's place from a laid-out grid (an arrange drag's result). */
export const applyWidgetLayout = (
  list: readonly SavedHomeWidget[],
  layout: readonly (GridItem & Partial<Pick<SavedHomeWidget, 'sizedBy'>>)[]
): SavedHomeWidget[] => {
  const byKey = new Map(layout.map((item) => [item.key, item]));
  return list.map((widget) => {
    const placed = byKey.get(homeWidgetKey(widget));
    if (!placed) return widget;
    return {
      ...widget,
      x: placed.x,
      y: placed.y,
      w: placed.w,
      h: placed.h,
      sizedBy: placed.sizedBy ?? widget.sizedBy,
    };
  });
};

/**
 * The size a widget asks for (GO_WIDGET_SET_SIZE), taken only while nobody
 * but the default or the widget itself has sized it; the user's size always
 * stays. The same list back when nothing changes (nothing to save).
 */
export const applyWidgetAskedSize = (
  list: readonly SavedHomeWidget[],
  key: string,
  asked: { w?: number | null; h: number },
  columns: number
): SavedHomeWidget[] => {
  const shown = layoutForColumns(list, columns);
  const widget = shown.find((saved) => homeWidgetKey(saved) === key);
  if (!widget || widget.sizedBy === 'user') return list as SavedHomeWidget[];
  const w = Math.min(asked.w ?? widget.w, columns);
  if (widget.w === w && widget.h === asked.h) return list as SavedHomeWidget[];
  const resized = resizeGridItem(withKeys(shown), key, w, asked.h, columns).map(
    (item) =>
      item.key === key ? { ...item, sizedBy: 'widget' as const } : item
  );
  return withoutKeys(resized);
};

/** Device-wide, like the other Home dashboard preferences. */
export const HOME_WIDGETS_STORAGE_KEY = 'home-dashboard-widgets-v1';

// Read on init, so the first Home frame after login has the saved widgets.
const savedWidgetsStoredAtom = atomWithStorage<unknown>(
  HOME_WIDGETS_STORAGE_KEY,
  [],
  undefined,
  { getOnInit: true }
);

/** The widgets on Home, with their places. */
export const savedHomeWidgetsAtom = atom(
  (get): SavedHomeWidget[] =>
    normalizeSavedWidgets(get(savedWidgetsStoredAtom)),
  (
    get,
    set,
    update:
      | SavedHomeWidget[]
      | ((current: SavedHomeWidget[]) => SavedHomeWidget[])
  ) => {
    const current = normalizeSavedWidgets(get(savedWidgetsStoredAtom));
    const next = typeof update === 'function' ? update(current) : update;
    if (next === current) return;
    set(savedWidgetsStoredAtom, normalizeSavedWidgets(next));
  }
);
