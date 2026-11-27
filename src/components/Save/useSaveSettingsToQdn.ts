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
import { serializePinnedAppsForQdn } from '../../utils/pinnedAppsSettings';
import {
  loadSavedAppsBase,
  useSavedAppsSync,
} from '../Apps/AppsLauncher/savedAppsSync';
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
 * Saves the account's settings to QDN: the pinned apps, folders and bookmarks
 * (saved apps, with the fields older Hubs and GO read), Home's layout and the
 * side panel.
 *
 * - Settings saved on another device since they were read here are taken
 *   in first, item by item, so a save never undoes what another device did:
 *   an app pinned or removed there stays so, unless changed here since. They
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
  const setOldPinnedApps = useSetAtom(oldPinnedAppsAtom);
  const setSettingsQdnLastUpdated = useSetAtom(settingsQDNLastUpdatedAtom);
  const savedApps = useSavedAppsSync();
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

      // The layouts as saved, as last read: a layout never changed here
      // goes as it was saved.
      let layoutsSaved: SavedLayouts =
        savedLayouts.address === address
          ? savedLayouts.saved
          : NO_SAVED_LAYOUTS;
      if (address && name && !overwrite) {
        const record = await getPublishRecord(name);
        // Only a copy newer than the one read here: a node that is behind
        // may answer with an older one.
        const known = loadSavedAppsBase(address)?.updated ?? null;
        if (
          record.hasPublishRecord &&
          (known === null || record.timestamp > known)
        ) {
          const settings = await getPublish(name);
          // Settings that cannot be read are not written over unasked.
          if (!settings) throw new Error(failure);
          // Taken in item by item: they become what Revert goes back to.
          const taken = await savedApps.takeIn(address, {
            settings,
            updated: record.timestamp,
          });
          if (!taken) throw new Error(failure);
          const layouts = takeInSavedLayouts(address, settings);
          setSavedLayouts(layouts);
          layoutsSaved = layouts.saved;
        }
      }
      // A side panel changed both here and in the copy offered to restore
      // keeps the Q-Apps and websites added there.
      if (address) takeInSavedSidePanelItems(address, layoutsSaved);
      const localLayouts = address ? readLocalLayouts(address) : null;

      // The pins, folders and bookmarks with this device's latest changes.
      const prepared = address ? await savedApps.forSave(address) : null;
      if (address && !prepared) throw new Error(failure);
      const data64 = await objectToBase64({
        ...(prepared
          ? prepared.fields
          : { sortablePinnedApps: serializePinnedAppsForQdn(pinnedApps) }),
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

      setSettingsQdnLastUpdated(Date.now());
      if (address && localLayouts) {
        setSavedLayouts(markLayoutsSaved(address, localLayouts, layoutsSaved));
      }
      // What was published is what QDN holds now.
      if (address && prepared) {
        await savedApps.markPublished(address, prepared.apps);
      } else {
        setOldPinnedApps(pinnedApps);
      }
      return 'saved';
    },
    [
      address,
      name,
      pinnedApps,
      savedApps,
      savedLayouts,
      setOldPinnedApps,
      setSavedLayouts,
      setSettingsQdnLastUpdated,
      show,
      t,
    ]
  );
};
