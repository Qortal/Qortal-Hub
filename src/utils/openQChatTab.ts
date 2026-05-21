import { executeEvent } from './events';

export const QCHAT_INTERNAL_TAB_ID = 'q-chat';

// Q-Chat is still backed by Hub's built-in chat state, but it should live in
// the Q-App tab strip so users can switch between it and regular Q-Apps.
export const openQChatTab = () => {
  executeEvent('addTab', {
    data: {
      internal: QCHAT_INTERNAL_TAB_ID,
      name: 'Q-Chat',
      service: 'INTERNAL',
    },
  });
  executeEvent('open-apps-mode', {});
};
