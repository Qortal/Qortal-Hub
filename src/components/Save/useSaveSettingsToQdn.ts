import { useCallback, useContext } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { QORTAL_APP_CONTEXT } from '../../App';
import {
  oldPinnedAppsAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../atoms/global';
import { getFee } from '../../background/background';
import { TIME_MINUTES_1_IN_MILLISECONDS } from '../../constants/constants';
import {
  getPublish,
  getPublishRecord,
} from '../../hooks/useQortalGetSaveSettings';
import { objectToBase64 } from '../../qdn/encryption/group-encryption';
import {
  mergePinnedApps,
  type PinnedApp,
  removeBrokenPinnedApps,
  serializePinnedAppsForQdn,
} from '../../utils/pinnedAppsSettings';
import { PINNED_APPS_STORAGE_KEY } from '../../utils/pinnedAppsStorage';
import { loadBookmarksForAddress } from '../Apps/AppBookmarks/bookmarkStorage';
import type { AppBookmarksForAddress } from '../Apps/AppBookmarks/bookmarkTypes';
import { loadLauncherView } from '../Apps/AppsLauncher/launcherItems';
import { saveToLocalStorage } from '../Apps/AppsNavBarDesktop';
import {
  type SavedLauncher,
  saveLauncherSyncMark,
  toSavedBookmarks,
  toSavedLauncherSettings,
} from '../Apps/AppsLauncher/launcherQdn';
import {
  savedLauncherAtom,
  useTakeInSavedLauncher,
} from '../Apps/AppsLauncher/launcherQdnSync';
import {
  markLayoutsSaved,
  NO_SAVED_LAYOUTS,
  readLocalLayouts,
  savedLayoutsAtom,
  type SavedLayouts,
  takeInSavedLayouts,
  takeInSavedSidePanelItems,
  toSavedLayoutSettings,
} from './savedLayouts';

/** The account's settings on QDN: one encrypted file, saved as a whole. */
export const SETTINGS_IDENTIFIER = 'ext_saved_settings';
export const SETTINGS_SERVICE = 'DOCUMENT_PRIVATE';

export type SaveSettingsOutcome = 'saved' | 'canceled';

/** What the background answers; `window.sendMessage` is untyped. */
type MessageAnswer = {
  error?: unknown;
  message?: unknown;
  identifier?: unknown;
} | null;

const sendMessage = (
  action: string,
  payload: unknown,
  timeout?: number
): Promise<MessageAnswer> =>
  (
    window.sendMessage as (
      action: string,
      payload: unknown,
      timeout?: number
    ) => Promise<MessageAnswer>
  )(action, payload, timeout);

const errorOf = (reason: unknown, fallback: string) => {
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string' && reason) return new Error(reason);
  const message = (reason as { message?: unknown } | null)?.message;
  return new Error(typeof message === 'string' && message ? message : fallback);
};

/**
 * Saves the account's settings to QDN: the pinned apps, and with them the
 * bookmarks, the bookmark folders, the order of the launcher's tiles, Home's
 * layout and the side panel.
 *
 * - Settings saved on another device since they were read here are taken
 *   in first, so they are not written over: their bookmarks and arrangement
 *   are taken in, and the pins they hold are added to this device's own, so
 *   an app pinned there is not removed by saving a change made here. They
 *   also become what Revert goes back to, even if this save is called off.
 *   With `overwrite`, settings that could not be read are written over.
 * - Home's layout and the side panel go as this device has them. When one
 *   changed both here and on another device (it's offered to restore), this
 *   device's is saved, and a side panel keeps the Q-Apps and websites added
 *   there.
 * - It asks to confirm, with the fee, before it publishes. `canceled` means
 *   that was declined; a failure throws, with a message to show.
 */
export const useSaveSettingsToQdn = (
  address: string | null | undefined,
  name: string | null | undefined
) => {
  const pinnedApps = useAtomValue(sortablePinnedAppsAtom);
  const setPinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setOldPinnedApps = useSetAtom(oldPinnedAppsAtom);
  const setSettingsQdnLastUpdated = useSetAtom(settingsQDNLastUpdatedAtom);
  const savedLauncher = useAtomValue(savedLauncherAtom);
  const setSavedLauncher = useSetAtom(savedLauncherAtom);
  const takeIn = useTakeInSavedLauncher();
  const savedLayouts = useAtomValue(savedLayoutsAtom);
  const setSavedLayouts = useSetAtom(savedLayoutsAtom);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const { t } = useTranslation(['core']);

  return useCallback(
    async ({
      overwrite = false,
    }: { overwrite?: boolean } = {}): Promise<SaveSettingsOutcome> => {
      const failure = t('core:message.error.save_qdn', {
        postProcess: 'capitalizeFirstChar',
      });

      let pins = pinnedApps;
      // The layouts as saved, as last read: a layout never changed here
      // goes as it was saved.
      let layoutsSaved: SavedLayouts =
        savedLayouts.address === address
          ? savedLayouts.saved
          : NO_SAVED_LAYOUTS;
      if (address && name && !overwrite) {
        const known =
          savedLauncher.address === address ? savedLauncher.savedAt : 0;
        const record = await getPublishRecord(name);
        if (record.hasPublishRecord && record.timestamp > known) {
          const settings = await getPublish(name);
          // Settings that cannot be read are not written over unasked.
          if (!settings) throw new Error(failure);
          await takeIn(address, { settings, savedAt: record.timestamp });
          const theirPins = (settings as { sortablePinnedApps?: PinnedApp[] })
            ?.sortablePinnedApps;
          if (Array.isArray(theirPins)) {
            const saved = removeBrokenPinnedApps(theirPins);
            // The list QDN holds now, so Revert goes back to that and not to
            // the one read at sign-in, which has none of its pins.
            setOldPinnedApps(saved);
            // An app pinned on another device is kept: it would otherwise be
            // removed by publishing this device's older list.
            const merged = mergePinnedApps(pins, saved);
            if (merged.length !== pins.length) {
              pins = merged;
              setPinnedApps(merged);
              // Kept here too, so the next sign-in starts from the whole list.
              saveToLocalStorage(
                PINNED_APPS_STORAGE_KEY,
                'sortablePinnedApps',
                merged
              );
            }
          }
          const layouts = takeInSavedLayouts(address, settings);
          setSavedLayouts(layouts);
          layoutsSaved = layouts.saved;
        }
      }
      // A side panel changed both here and in the copy offered to restore
      // keeps the Q-Apps and websites added there.
      if (address) takeInSavedSidePanelItems(address, layoutsSaved);
      const localLayouts = address ? readLocalLayouts(address) : null;

      let bookmarks: AppBookmarksForAddress | null = null;
      if (address) {
        try {
          bookmarks = await loadBookmarksForAddress(address);
        } catch (error) {
          console.error(error);
        }
      }
      // Bookmarks that cannot be read now are saved as they were saved.
      const launcher: SavedLauncher | null = bookmarks
        ? {
            bookmarks: toSavedBookmarks(bookmarks),
            order: loadLauncherView(address).order,
          }
        : savedLauncher.address === address
          ? savedLauncher.launcher
          : null;

      const data64 = await objectToBase64({
        sortablePinnedApps: serializePinnedAppsForQdn(pins),
        ...(launcher ? toSavedLauncherSettings(launcher) : {}),
        ...(localLayouts
          ? toSavedLayoutSettings(localLayouts, layoutsSaved)
          : {}),
      });
      const encrypted = await sendMessage(
        'ENCRYPT_DATA',
        { data64 },
        TIME_MINUTES_1_IN_MILLISECONDS
      ).then((response) => {
        if (!response || response.error) {
          throw errorOf(response?.message || response?.error, failure);
        }
        return response;
      });

      const fee = await getFee('ARBITRARY');
      try {
        await show({
          message: t('core:message.question.publish_qdn', {
            postProcess: 'capitalizeFirstChar',
          }),
          publishFee: `${fee.fee} QORT`,
        });
      } catch (reason) {
        if ((reason as { isCanceled?: boolean } | null)?.isCanceled) {
          return 'canceled';
        }
        throw errorOf(reason, failure);
      }

      const response = await sendMessage('publishOnQDN', {
        data: encrypted,
        identifier: SETTINGS_IDENTIFIER,
        service: SETTINGS_SERVICE,
        uploadType: 'base64',
      }).then(
        (answer) => {
          if (answer?.error) throw errorOf(answer.error, failure);
          return answer;
        },
        (reason) => {
          throw errorOf(reason, failure);
        }
      );
      if (!response?.identifier) throw new Error(failure);

      const savedAt = Date.now();
      setOldPinnedApps(pins);
      setSettingsQdnLastUpdated(savedAt);
      if (address && localLayouts) {
        setSavedLayouts(markLayoutsSaved(address, localLayouts, layoutsSaved));
      }
      if (address && launcher) {
        setSavedLauncher({ address, status: 'saved', launcher, savedAt });
        if (bookmarks) {
          saveLauncherSyncMark(address, {
            savedAt,
            localAt: bookmarks.updatedAt,
            order: launcher.order,
            // Everything this device has is now saved.
            unsaved: false,
          });
        }
      }
      return 'saved';
    },
    [
      address,
      name,
      pinnedApps,
      savedLauncher,
      savedLayouts,
      setOldPinnedApps,
      setPinnedApps,
      setSavedLauncher,
      setSavedLayouts,
      setSettingsQdnLastUpdated,
      show,
      t,
      takeIn,
    ]
  );
};
