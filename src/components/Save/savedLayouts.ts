import { atom } from 'jotai';
import {
  isSidePanelQdnItem,
  normalizeSidePanel,
  readSidePanel,
  sameSidePanel,
  saveSidePanel,
  type SidePanelSettings,
  sidePanelStorageKey,
  withSidePanelQdnItem,
} from '../Desktop/sidePanel';
import {
  type HomeLayout,
  homeLayoutStorageKey,
  normalizeHomeLayout,
  readHomeLayout,
  sameHomeLayout,
  saveHomeLayout,
} from '../Group/HomeDesktop/homeLayout';

/**
 * Home's layout and the side panel in the settings the account saves on QDN
 * (`DOCUMENT_PRIVATE` `ext_saved_settings`, encrypted to the account), next
 * to the pins and the launcher:
 *
 * - `homeLayout`: `{ v: 1, layout, changedAt }`, Home's windows and switches;
 * - `sidePanel`: `{ v: 1, settings, changedAt }`, the side panel.
 *
 * `changedAt` is when that layout last changed on the device that saved it:
 * it tells one saved layout from another. Both are optional, and a Hub that
 * does not know them leaves them alone.
 */
export const SAVED_LAYOUTS_VERSION = 1;

export type SavedLayoutPart = 'homeLayout' | 'sidePanel';

export const SAVED_LAYOUT_PARTS: readonly SavedLayoutPart[] = [
  'homeLayout',
  'sidePanel',
];

type PartValue = {
  homeLayout: HomeLayout;
  sidePanel: SidePanelSettings;
};

/** A layout as saved: what it is, and when it last changed. */
export type SavedPart<P extends SavedLayoutPart> = {
  value: PartValue[P];
  changedAt: number;
};

export type SavedLayouts = {
  [P in SavedLayoutPart]: SavedPart<P> | null;
};

export const NO_SAVED_LAYOUTS: SavedLayouts = {
  homeLayout: null,
  sidePanel: null,
};

const timeOf = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const withoutChangedAt = <T extends { changedAt?: number }>(value: T) => {
  const { changedAt: _ignored, ...rest } = value;
  return rest as T;
};

const partOf = (raw: unknown, field: 'layout' | 'settings') => {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  if (entry.v !== SAVED_LAYOUTS_VERSION) return null;
  const value = entry[field];
  if (!value || typeof value !== 'object') return null;
  return { value, changedAt: timeOf(entry.changedAt) };
};

/** The layouts in saved settings; what doesn't have the right shape is left out. */
export const readSavedLayouts = (settings: unknown): SavedLayouts => {
  const fields =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>)
      : {};
  const home = partOf(fields.homeLayout, 'layout');
  const side = partOf(fields.sidePanel, 'settings');
  return {
    homeLayout: home
      ? {
          value: withoutChangedAt(normalizeHomeLayout(home.value)),
          changedAt: home.changedAt,
        }
      : null,
    sidePanel: side
      ? {
          value: withoutChangedAt(normalizeSidePanel(side.value)),
          changedAt: side.changedAt,
        }
      : null,
  };
};

/** What this device has: its layouts, and whether it has its own at all. */
export type LocalLayouts = {
  homeLayout: HomeLayout;
  sidePanel: SidePanelSettings;
  /** Stored for the account (a layout never changed here isn't). */
  stored: { [P in SavedLayoutPart]: boolean };
};

export const readLocalLayouts = (address: string): LocalLayouts => {
  const has = (key: string) => {
    try {
      return window.localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  };
  return {
    homeLayout: readHomeLayout(address),
    sidePanel: readSidePanel(address),
    stored: {
      homeLayout: has(homeLayoutStorageKey(address)),
      sidePanel: has(sidePanelStorageKey(address)),
    },
  };
};

/**
 * When a layout last changed on this device: 0 for never. One stored before
 * changes were timed counts as changed, at an unknown time, so it's never
 * replaced unasked.
 */
export const localChangedAt = (
  local: LocalLayouts,
  part: SavedLayoutPart
): number => local[part].changedAt || (local.stored[part] ? 1 : 0);

export const sameLayoutPart = <P extends SavedLayoutPart>(
  part: P,
  a: PartValue[P],
  b: PartValue[P]
) =>
  part === 'homeLayout'
    ? sameHomeLayout(a as HomeLayout, b as HomeLayout)
    : sameSidePanel(a as SidePanelSettings, b as SidePanelSettings);

/**
 * The fields for the settings being saved. A layout never changed here goes
 * as it was saved (the settings are saved as a whole, so leaving it out
 * would remove it), and isn't there when it never was.
 */
export const toSavedLayoutSettings = (
  local: LocalLayouts,
  saved: SavedLayouts
) => {
  const fields: Record<string, unknown> = {};
  const homeChanged = localChangedAt(local, 'homeLayout');
  const home = homeChanged
    ? { value: local.homeLayout, changedAt: homeChanged }
    : saved.homeLayout;
  if (home) {
    fields.homeLayout = {
      v: SAVED_LAYOUTS_VERSION,
      layout: withoutChangedAt(home.value),
      changedAt: home.changedAt,
    };
  }
  const sideChanged = localChangedAt(local, 'sidePanel');
  const side = sideChanged
    ? { value: local.sidePanel, changedAt: sideChanged }
    : saved.sidePanel;
  if (side) {
    fields.sidePanel = {
      v: SAVED_LAYOUTS_VERSION,
      settings: withoutChangedAt(side.value),
      changedAt: side.changedAt,
    };
  }
  return fields;
};

/**
 * When this device last saved a layout or took one in: which saved layout
 * that was (its `changedAt`), and when the layout here had last changed.
 */
export type PartSyncMark = { changedAt: number; localAt: number };

/**
 * What to do with a layout found on QDN.
 *
 * - `keep`: none there, the same as here, or the one this device last saved
 *   or took in.
 * - `replace`: this device never changed its layout, or hasn't since it last
 *   saved or took one in; the saved one takes its place.
 * - `offer`: both changed. This device keeps its own, and the saved one is
 *   offered.
 */
export const chooseSavedPartUse = ({
  saved,
  same,
  localAt,
  mark,
}: {
  saved: { changedAt: number } | null;
  same: boolean;
  localAt: number;
  mark: PartSyncMark | null;
}): 'keep' | 'replace' | 'offer' => {
  if (!saved || same) return 'keep';
  if (mark && saved.changedAt === mark.changedAt) return 'keep';
  if (!localAt) return 'replace';
  if (mark && localAt <= mark.localAt) return 'replace';
  return 'offer';
};

const MARK_KEY = 'ext_layouts_qdn';

export const savedLayoutsMarkKey = (address: string) =>
  `${MARK_KEY}:${address}`;

export const loadLayoutMarks = (
  address: string
): Partial<Record<SavedLayoutPart, PartSyncMark>> => {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(savedLayoutsMarkKey(address)) || '{}'
    );
    const marks: Partial<Record<SavedLayoutPart, PartSyncMark>> = {};
    for (const part of SAVED_LAYOUT_PARTS) {
      const mark = stored?.[part];
      if (
        typeof mark?.changedAt === 'number' &&
        typeof mark?.localAt === 'number'
      ) {
        marks[part] = { changedAt: mark.changedAt, localAt: mark.localAt };
      }
    }
    return marks;
  } catch {
    return {};
  }
};

export const saveLayoutMark = (
  address: string,
  part: SavedLayoutPart,
  mark: PartSyncMark
) => {
  try {
    window.localStorage.setItem(
      savedLayoutsMarkKey(address),
      JSON.stringify({ ...loadLayoutMarks(address), [part]: mark })
    );
  } catch (error) {
    console.warn('Unable to save the layouts sync mark.', error);
  }
};

/** What the account's QDN settings hold for its layouts, as last seen here. */
export type SavedLayoutsState = {
  address: string | null;
  /** `unknown` until the settings were read (or found missing). */
  status: 'unknown' | 'read';
  saved: SavedLayouts;
  /** The layouts that changed both here and on QDN: offered to restore. */
  offer: SavedLayoutPart[];
};

export const savedLayoutsAtom = atom<SavedLayoutsState>({
  address: null,
  status: 'unknown',
  saved: NO_SAVED_LAYOUTS,
  offer: [],
});

/** Puts a saved layout in this device's place, keeping its time. */
const applySavedPart = <P extends SavedLayoutPart>(
  address: string,
  part: P,
  saved: SavedPart<P>
) => {
  // A layout saved before it was ever changed has no time: it gets one, so
  // this device can tell it apart from the next.
  const changedAt = saved.changedAt || 1;
  if (part === 'homeLayout') {
    saveHomeLayout(address, saved.value as HomeLayout, { changedAt });
  } else {
    saveSidePanel(address, saved.value as SidePanelSettings, { changedAt });
  }
  saveLayoutMark(address, part, {
    changedAt: saved.changedAt,
    localAt: changedAt,
  });
};

/**
 * Takes in the layouts of the account's QDN settings (`settings` null when
 * it has none): each is kept, put in place, or offered, as
 * `chooseSavedPartUse` decides.
 */
export const takeInSavedLayouts = (
  address: string,
  settings: unknown | null
): SavedLayoutsState => {
  const saved = settings ? readSavedLayouts(settings) : NO_SAVED_LAYOUTS;
  const local = readLocalLayouts(address);
  const marks = loadLayoutMarks(address);
  const offer: SavedLayoutPart[] = [];
  for (const part of SAVED_LAYOUT_PARTS) {
    const found = saved[part];
    if (!found) continue;
    const localAt = localChangedAt(local, part);
    const same = sameLayoutPart(part, local[part], found.value);
    const use = chooseSavedPartUse({
      saved: found,
      same,
      localAt,
      mark: marks[part] ?? null,
    });
    if (use === 'replace') {
      applySavedPart(address, part, found as SavedPart<typeof part>);
    } else if (use === 'offer') {
      offer.push(part);
    } else if (same) {
      saveLayoutMark(address, part, { changedAt: found.changedAt, localAt });
    }
  }
  return { address, status: 'read', saved, offer };
};

/** The saved layouts put in this device's place; they're no longer offered. */
export const restoreSavedLayouts = (
  address: string,
  state: SavedLayoutsState,
  parts: readonly SavedLayoutPart[]
): SavedLayoutsState => {
  for (const part of parts) {
    const found = state.saved[part];
    if (found) applySavedPart(address, part, found as SavedPart<typeof part>);
  }
  return {
    ...state,
    offer: state.offer.filter((part) => !parts.includes(part)),
  };
};

/**
 * This device's layouts kept, the saved ones set aside: those aren't offered
 * again. A newer one saved elsewhere is offered, not put in place: this
 * device's layout isn't in step with QDN.
 */
export const keepLocalLayouts = (
  address: string,
  state: SavedLayoutsState,
  parts: readonly SavedLayoutPart[]
): SavedLayoutsState => {
  for (const part of parts) {
    const found = state.saved[part];
    if (found) {
      saveLayoutMark(address, part, { changedAt: found.changedAt, localAt: 0 });
    }
  }
  return {
    ...state,
    offer: state.offer.filter((part) => !parts.includes(part)),
  };
};

/**
 * Revert: each layout saved on QDN put back in this device's place. One with
 * no saved copy stays as it is, since there is nothing to go back to. Before
 * the settings are read, nothing changes.
 */
export const revertToSavedLayouts = (
  address: string,
  state: SavedLayoutsState
): SavedLayoutsState =>
  state.address === address && state.status === 'read'
    ? restoreSavedLayouts(
        address,
        state,
        SAVED_LAYOUT_PARTS.filter((part) => state.saved[part])
      )
    : state;

/**
 * This device's side panel with the Q-Apps and websites that only `saved`
 * has, after its own (as many as fit). Its arrangement and settings stay.
 */
export const withSavedSidePanelItems = (
  local: SidePanelSettings,
  saved: SidePanelSettings
): SidePanelSettings =>
  saved.items
    .filter(isSidePanelQdnItem)
    .reduce((merged, item) => withSidePanelQdnItem(merged, item), local);

/**
 * Before a save, when the side panel changed both here and in a saved copy
 * this device hasn't taken in (the one offered to restore): the Q-Apps and
 * websites added there are added here too, so saving this device's side
 * panel doesn't remove them, as with the pins. Home's layout has nothing to
 * add, so this device's goes as it is. A copy this device took in, or set
 * aside with "Keep this device's", adds nothing. Whether it added any.
 */
export const takeInSavedSidePanelItems = (
  address: string,
  saved: SavedLayouts
): boolean => {
  const found = saved.sidePanel;
  if (!found) return false;
  const local = readLocalLayouts(address);
  if (!localChangedAt(local, 'sidePanel')) return false;
  const mark = loadLayoutMarks(address).sidePanel;
  if (mark && mark.changedAt === found.changedAt) return false;
  const merged = withSavedSidePanelItems(local.sidePanel, found.value);
  if (sameSidePanel(merged, local.sidePanel)) return false;
  saveSidePanel(address, merged);
  return true;
};

/** After a save: what was saved is now this device's latest. */
export const markLayoutsSaved = (
  address: string,
  local: LocalLayouts,
  previous: SavedLayouts
): SavedLayoutsState => {
  const saved: SavedLayouts = { ...previous };
  for (const part of SAVED_LAYOUT_PARTS) {
    const changedAt = localChangedAt(local, part);
    if (!changedAt) continue;
    if (part === 'homeLayout') {
      saved.homeLayout = {
        value: withoutChangedAt(local.homeLayout),
        changedAt,
      };
    } else {
      saved.sidePanel = { value: withoutChangedAt(local.sidePanel), changedAt };
    }
    saveLayoutMark(address, part, { changedAt, localAt: changedAt });
  }
  return { address, status: 'read', saved, offer: [] };
};

/**
 * This device's layouts that differ from what's saved: the Save button
 * offers to save them. A layout never changed here, with none saved, doesn't.
 */
export const unsavedLayoutParts = (
  state: SavedLayoutsState,
  address: string | null | undefined,
  local: LocalLayouts
): SavedLayoutPart[] => {
  if (!address || state.address !== address || state.status !== 'read') {
    return [];
  }
  return SAVED_LAYOUT_PARTS.filter((part) => {
    const found = state.saved[part];
    return found
      ? !sameLayoutPart(part, local[part], found.value)
      : !!localChangedAt(local, part);
  });
};

/** Whether any of this device's layouts differs from what's saved. */
export const hasUnsavedLayouts = (
  state: SavedLayoutsState,
  address: string | null | undefined,
  local: LocalLayouts
): boolean => unsavedLayoutParts(state, address, local).length > 0;
