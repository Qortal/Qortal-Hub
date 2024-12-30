import { atom, selectorFamily } from 'recoil';


export const sortablePinnedAppsAtom = atom({
  key: 'sortablePinnedAppsFromAtom', 
  default: [{
    name: 'Q-Tube',
    service: 'APP'
  }, {
    name: 'Q-Mail',
    service: 'APP'
  },  {
    name: 'Q-Share',
    service: 'APP'
  }, {
    name: 'qombo',
    service: 'APP'
  }, {
    name: 'Q-Fund',
    service: 'APP'
  }, {
    name: 'Q-Shop',
    service: 'APP'
  },{
    name: 'Qombo',
    service: 'APP'
  },
  {
    name: 'Q-Trade',
    service: 'APP'
  },
  {
    name: 'Q-Support',
    service: 'APP'
  },
  {
    name: 'NodeInfo',
    service: 'APP'
  },
  {
    name: 'Q-Manager',
    service: 'APP'
  },
  {
    name: 'Q-Blog',
    service: 'APP'
  },
  {
    name: 'Q-Mintership',
    service: 'APP'
  }
], 
});

export const canSaveSettingToQdnAtom = atom({
  key: 'canSaveSettingToQdnAtom', 
  default: false, 
});

export const settingsQDNLastUpdatedAtom = atom({
  key: 'settingsQDNLastUpdatedAtom', 
  default: -100, 
});

export const settingsLocalLastUpdatedAtom = atom({
  key: 'settingsLocalLastUpdatedAtom', 
  default: 0, 
});

export const oldPinnedAppsAtom = atom({
  key: 'oldPinnedAppsAtom', 
  default: [], 
});
export const isUsingImportExportSettingsAtom = atom({
  key: 'isUsingImportExportSettingsAtom', 
  default: null, 
});


export const fullScreenAtom = atom({
  key: 'fullScreenAtom', 
  default: false, 
});

export const hasSettingsChangedAtom = atom({
  key: 'hasSettingsChangedAtom', 
  default: false, 
});

export const navigationControllerAtom = atom({
  key: 'navigationControllerAtom', 
  default: {}, 
});

export const enabledDevModeAtom = atom({
  key: 'enabledDevModeAtom', 
  default: false, 
});

export const myGroupsWhereIAmAdminAtom = atom({
  key: 'myGroupsWhereIAmAdminAtom', 
  default: [], 
});

export const promotionTimeIntervalAtom = atom({
  key: 'promotionTimeIntervalAtom', 
  default: 0, 
});

export const promotionsAtom = atom({
  key: 'promotionsAtom', 
  default: [], 
});

export const resourceDownloadControllerAtom = atom({
  key: 'resourceDownloadControllerAtom', 
  default: {}, 
});

export const resourceKeySelector = selectorFamily({
  key: 'resourceKeySelector',
  get: (key) => ({ get }) => {
    const resources = get(resourceDownloadControllerAtom);
    return resources[key] || null; // Return the value for the key or null if not found
  },
});

export const blobControllerAtom = atom({
  key: 'blobControllerAtom', 
  default: {}, 
});

export const blobKeySelector = selectorFamily({
  key: 'blobKeySelector',
  get: (key) => ({ get }) => {
    const blobs = get(blobControllerAtom);
    return blobs[key] || null; // Return the value for the key or null if not found
  },
});

export const selectedGroupIdAtom = atom({
  key: 'selectedGroupIdAtom', 
  default: null, 
});

export const addressInfoControllerAtom = atom({
  key: 'addressInfoControllerAtom', 
  default: {}, 
});

export const addressInfoKeySelector = selectorFamily({
  key: 'addressInfoKeySelector',
  get: (key) => ({ get }) => {
    const userInfo = get(addressInfoControllerAtom);
    return userInfo[key] || null; // Return the value for the key or null if not found
  },
});