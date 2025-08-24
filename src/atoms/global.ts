import { atom } from 'jotai';
import { atomWithReset, atomFamily } from 'jotai/utils';
import { LOCALHOST } from '../constants/constants';

// Atoms (resettable)
export const sortablePinnedAppsAtom = atomWithReset([
  { name: 'Q-Tube', service: 'APP' },
  { name: 'Q-Mail', service: 'APP' },
  { name: 'Q-Share', service: 'APP' },
  { name: 'Q-Fund', service: 'APP' },
  { name: 'Q-Shop', service: 'APP' },
  { name: 'Q-Trade', service: 'APP' },
  { name: 'Q-Support', service: 'APP' },
  { name: 'Q-Manager', service: 'APP' },
  { name: 'Q-Blog', service: 'APP' },
  { name: 'Q-Mintership', service: 'APP' },
  { name: 'Q-Wallets', service: 'APP' },
  { name: 'Q-Search', service: 'APP' },
  { name: 'Q-Nodecontrol', service: 'APP' },
  { name: 'Names', service: 'APP' },
  { name: 'Q-Follow', service: 'APP' },
]);

export const addressInfoControllerAtom = atomWithReset({});
export const blobControllerAtom = atomWithReset({});
export const canSaveSettingToQdnAtom = atomWithReset(false);
export const enabledDevModeAtom = atomWithReset(false);
export const fullScreenAtom = atomWithReset(false);
export const groupAnnouncementsAtom = atomWithReset({});
export const groupChatTimestampsAtom = atomWithReset({});
export const groupsOwnerNamesAtom = atomWithReset({});
export const groupsPropertiesAtom = atomWithReset({});
export const hasSettingsChangedAtom = atomWithReset(false);
export const isDisabledEditorEnterAtom = atomWithReset(false);
export const isOpenBlockedModalAtom = atomWithReset(false);
export const isRunningPublicNodeAtom = atomWithReset(false);
export const isUsingImportExportSettingsAtom = atomWithReset(null);
export const lastPaymentSeenTimestampAtom = atomWithReset(null);
export const mailsAtom = atomWithReset([]);
export const memberGroupsAtom = atomWithReset([]);
export const mutedGroupsAtom = atomWithReset([]);
export const myGroupsWhereIAmAdminAtom = atomWithReset([]);
export const navigationControllerAtom = atomWithReset({});
export const oldPinnedAppsAtom = atomWithReset([]);
export const promotionsAtom = atomWithReset([]);
export const promotionTimeIntervalAtom = atomWithReset(0);
export const qMailLastEnteredTimestampAtom = atomWithReset(null);
export const resourceDownloadControllerAtom = atomWithReset({});
export const selectedGroupIdAtom = atomWithReset(null);
export const settingsLocalLastUpdatedAtom = atomWithReset(0);
export const settingsQDNLastUpdatedAtom = atomWithReset(-100);
export const timestampEnterDataAtom = atomWithReset({});
export const txListAtom = atomWithReset([]);

export const devServerDomainAtom = atomWithReset(LOCALHOST);
export const devServerPortAtom = atomWithReset('');
export const nodeInfosAtom = atomWithReset({});

// Atom Families (replacing selectorFamily)
export const resourceKeySelector = atomFamily((key) =>
  atom((get) => get(resourceDownloadControllerAtom)[key] || null)
);

export const blobKeySelector = atomFamily((key) =>
  atom((get) => get(blobControllerAtom)[key] || null)
);

export const addressInfoKeySelector = atomFamily((key) =>
  atom((get) => get(addressInfoControllerAtom)[key] || null)
);

export const groupsOwnerNamesSelector = atomFamily((key) =>
  atom((get) => get(groupsOwnerNamesAtom)[key] || null)
);

export const groupAnnouncementSelector = atomFamily((key) =>
  atom((get) => get(groupAnnouncementsAtom)[key] || null)
);

export const groupPropertySelector = atomFamily((key) =>
  atom((get) => get(groupsPropertiesAtom)[key] || null)
);

export const groupChatTimestampSelector = atomFamily((key) =>
  atom((get) => get(groupChatTimestampsAtom)[key] || null)
);

export const timestampEnterDataSelector = atomFamily((key) =>
  atom((get) => get(timestampEnterDataAtom)[key] || null)
);
