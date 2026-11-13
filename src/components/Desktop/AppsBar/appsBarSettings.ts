/**
 * What the apps bar remembers, per account, on this device.
 *
 * The bar shows the pinned apps and the bookmarks, and both are kept
 * elsewhere: the pin list and the bookmarks store. Only whether the bar
 * shows, whether names show beside the pictures, and the names the user gave
 * its items live here. They stay on the device, like the window's own
 * furniture.
 */

export const APPS_BAR_STORAGE_KEY = 'qortal_apps_bar_by_address';

export type AppsBarSettings = {
  /** Whether the bar shows along the top of the window. */
  enabled: boolean;
  /** Whether a name shows beside each picture. */
  showNames: boolean;
  /** The names the user gave, by item id. An empty one shows no name. */
  names: Record<string, string>;
};

export type AppsBarSettingsByAddress = Record<string, AppsBarSettings>;

export const EMPTY_APPS_BAR_SETTINGS: AppsBarSettings = {
  enabled: false,
  showNames: true,
  names: {},
};

/** How long a name can be typed for an item of the bar. */
export const APPS_BAR_NAME_MAX_LENGTH = 24;

function parseNames(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const names: Record<string, string> = {};
  for (const [id, name] of Object.entries(value as Record<string, unknown>)) {
    if (typeof name === 'string') {
      names[id] = name.slice(0, APPS_BAR_NAME_MAX_LENGTH);
    }
  }
  return names;
}

/** What was stored, keeping only what has the right shape. */
export function parseAppsBarSettings(value: unknown): AppsBarSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return EMPTY_APPS_BAR_SETTINGS;
  }

  const stored = value as Partial<AppsBarSettings>;
  return {
    enabled: stored.enabled === true,
    // Names show unless they were turned off.
    showNames: stored.showNames !== false,
    names: parseNames(stored.names),
  };
}

/** An account's settings, as they are stored, or the empty ones. */
export function appsBarSettingsOf(
  byAddress: AppsBarSettingsByAddress | null | undefined,
  address: string | null | undefined
): AppsBarSettings {
  if (!byAddress || !address) return EMPTY_APPS_BAR_SETTINGS;
  return parseAppsBarSettings(byAddress[address]);
}

/** The whole store with one account's settings changed. */
export function withAppsBarSettings(
  byAddress: AppsBarSettingsByAddress | null | undefined,
  address: string | null | undefined,
  change: Partial<AppsBarSettings>
): AppsBarSettingsByAddress {
  const current = byAddress && typeof byAddress === 'object' ? byAddress : {};
  if (!address) return current;

  return {
    ...current,
    [address]: { ...appsBarSettingsOf(current, address), ...change },
  };
}

/**
 * The name the user gave an item. It is trimmed and cut to what fits; an
 * empty name is kept and shows the picture alone. `null` gives the item its
 * own name back.
 */
export function withItemName(
  settings: AppsBarSettings,
  id: string,
  name: string | null
): AppsBarSettings {
  if (!id) return settings;

  const names = { ...settings.names };
  if (name === null) {
    if (!(id in names)) return settings;
    delete names[id];
  } else {
    names[id] = name.trim().slice(0, APPS_BAR_NAME_MAX_LENGTH);
  }

  return { ...settings, names };
}
