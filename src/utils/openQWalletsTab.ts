import { executeEvent } from './events';

export const openQWalletsTab = () => {
  executeEvent('addTab', {
    data: {
      name: 'Q-Wallets',
      navigateIfAlreadyOpen: true,
      path: 'qortal?authOnMount=true',
      service: 'APP',
    },
  });
  executeEvent('open-apps-mode', {});
};
