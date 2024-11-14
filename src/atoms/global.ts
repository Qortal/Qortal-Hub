import { atom } from 'recoil';


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