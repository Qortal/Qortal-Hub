import { useCallback, useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useTranslation } from 'react-i18next';
import { sortablePinnedAppsAtom } from '../../../atoms/global';
import { useLauncherBookmarks } from '../../Apps/AppsLauncher/useLauncherBookmarks';
import { useLauncherView } from '../../Apps/AppsLauncher/useLauncherView';
import { buildAppsBarItems } from './appsBarItems';
import {
  APPS_BAR_STORAGE_KEY,
  appsBarSettingsOf,
  withAppsBarSettings,
  withItemName,
  type AppsBarSettings,
  type AppsBarSettingsByAddress,
} from './appsBarSettings';

/**
 * The bar's settings for every account on this device. They are read at once,
 * not after the first render, so a window whose bar is on never opens
 * without it.
 */
export const appsBarByAddressAtom = atomWithStorage<AppsBarSettingsByAddress>(
  APPS_BAR_STORAGE_KEY,
  {},
  undefined,
  { getOnInit: true }
);

/**
 * What is stored now. The storage is the browser's own and answers at once,
 * so what the setter hands back is never still on its way.
 */
const asStore = (
  value: AppsBarSettingsByAddress | Promise<AppsBarSettingsByAddress>
) => (value instanceof Promise ? {} : value);

/**
 * How the bar is set up for an account, and how to change it. The bar and
 * the bookmarks menu both use this, so turning it on in the menu shows it at
 * once.
 */
export const useAppsBarSettings = (address: string | null | undefined) => {
  const [byAddress, setByAddress] = useAtom(appsBarByAddressAtom);

  const settings = useMemo(
    () => appsBarSettingsOf(byAddress, address),
    [address, byAddress]
  );

  const change = useCallback(
    (next: Partial<AppsBarSettings>) => {
      if (!address) return;
      setByAddress((current) =>
        withAppsBarSettings(asStore(current), address, next)
      );
    },
    [address, setByAddress]
  );

  const rename = useCallback(
    (id: string, name: string | null) => {
      if (!address) return;
      setByAddress((current) => {
        const stored = asStore(current);
        return withAppsBarSettings(
          stored,
          address,
          withItemName(appsBarSettingsOf(stored, address), id, name)
        );
      });
    },
    [address, setByAddress]
  );

  return { settings, change, rename };
};

/**
 * What the bar shows: the launcher's tiles as it last arranged them, with the
 * names the user gave them here. The bookmarks are read while the bar is
 * shown, and again whenever the store is saved somewhere else; the
 * arrangement comes from the launcher's own view, so moving a tile there
 * moves it here.
 */
export const useAppsBarItems = (
  address: string | null | undefined,
  isShown: boolean
) => {
  const { t } = useTranslation(['core']);
  const pins = useAtomValue(sortablePinnedAppsAtom);
  const { data } = useLauncherBookmarks(address, isShown);
  const [view] = useLauncherView(address);
  const { settings } = useAppsBarSettings(address);
  const privateAppLabel = t('core:app_private', {
    postProcess: 'capitalizeFirstChar',
  });

  return useMemo(
    () => buildAppsBarItems(pins, data, view, settings.names, privateAppLabel),
    [data, pins, privateAppLabel, settings.names, view]
  );
};
