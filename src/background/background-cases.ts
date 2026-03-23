import nacl from '../encryption/nacl-fast';
import ed2curve from '../encryption/ed2curve';
import { Sha256 } from 'asmcrypto.js';
import {
  addDataPublishes,
  addEnteredQmailTimestamp,
  addTimestampEnterChat,
  addTimestampGroupAnnouncement,
  addTimestampMention,
  addUserSettings,
  banFromGroup,
  cancelBan,
  cancelInvitationToGroup,
  checkLocalFunc,
  checkNewMessages,
  checkThreads,
  createEndpoint,
  createGroup,
  decryptDirectFunc,
  decryptSingleForPublishes,
  decryptSingleFunc,
  decryptWallet,
  findUsableApi,
  getApiKeyFromStorage,
  getBalanceInfo,
  getCustomNodesFromStorage,
  getDataPublishes,
  getEnteredQmailTimestamp,
  getGroupDataSingle,
  getKeyPair,
  getLTCBalance,
  getLastRef,
  getNameInfo,
  getTempPublish,
  getTimestampEnterChat,
  getTimestampGroupAnnouncement,
  getTimestampMention,
  getUserInfo,
  getUserSettings,
  handleActiveGroupDataFromSocket,
  inviteToGroup,
  joinGroup,
  kickFromGroup,
  leaveGroup,
  makeAdmin,
  notifyAdminRegenerateSecretKey,
  pauseAllQueues,
  processTransactionVersion2,
  registerName,
  removeAdmin,
  resumeAllQueues,
  saveTempPublish,
  sendChatDirect,
  sendChatGroup,
  sendChatNotification,
  sendCoin,
  setGroupData,
  updateThreadActivity,
  walletVersion,
} from '../background/background.ts';
import {
  decryptGroupEncryption,
  encryptAndPublishSymmetricKeyGroupChat,
  encryptAndPublishSymmetricKeyGroupChatForAdmins,
  publishGroupEncryptedResource,
  publishOnQDN,
} from '../encryption/encryption.ts';
import { PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY } from '../constants/constants';
import Base58 from '../encryption/Base58.ts';
import { encryptSingle } from '../qdn/encryption/group-encryption';
import { _createPoll, _voteOnPoll } from '../qortal/get.ts';
import { createTransaction } from '../transactions/transactions';
import { getData, storeData } from '../utils/chromeStorage';

export function versionCase(request, event) {
  event.source.postMessage(
    {
      requestId: request.requestId,
      action: 'version',
      payload: { version: '1.0' },
      type: 'backgroundMessageResponse',
    },
    event.origin
  );
}

export async function getWalletInfoCase(request, event) {
  try {
    const response = await getKeyPair();

    try {
      const walletInfo = await getData('walletInfo').catch((error) => null);

      if (walletInfo) {
        event.source.postMessage(
          {
            requestId: request.requestId,
            action: 'getWalletInfo',
            payload: { walletInfo, hasKeyPair: true },
            type: 'backgroundMessageResponse',
          },
          event.origin
        );
      } else {
        event.source.postMessage(
          {
            requestId: request.requestId,
            action: 'getWalletInfo',
            error: 'No wallet info found', // TODO translate
            type: 'backgroundMessageResponse',
          },
          event.origin
        );
      }
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: 'getWalletInfo',
          error: 'No wallet info found',
          type: 'backgroundMessageResponse',
        },
        event.origin
      );
    }
  } catch (error) {
    try {
      const walletInfo = await getData('walletInfo').catch((error) => null);

      if (walletInfo) {
        event.source.postMessage(
          {
            requestId: request.requestId,
            action: 'getWalletInfo',
            payload: { walletInfo, hasKeyPair: false },
            type: 'backgroundMessageResponse',
          },
          event.origin
        );
      } else {
        event.source.postMessage(
          {
            requestId: request.requestId,
            action: 'getWalletInfo',
            error: 'Wallet not authenticated',
            type: 'backgroundMessageResponse',
          },
          event.origin
        );
      }
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: 'getWalletInfo',
          error: 'Wallet not authenticated',
          type: 'backgroundMessageResponse',
        },
        event.origin
      );
    }
  }
}

export async function validApiCase(request, event) {
  try {
    const usableApi = await findUsableApi();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'validApi',
        payload: usableApi,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'validApi',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function nameCase(request, event) {
  try {
    const response = await getNameInfo();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'name',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'name',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function userInfoCase(request, event) {
  try {
    const response = await getUserInfo();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'userInfo',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'userInfo',
        error: 'User not authenticated',
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function decryptWalletCase(request, event) {
  try {
    const { password, wallet } = request.payload;
    const response = await decryptWallet({
      password,
      wallet,
      walletVersion: wallet?.version || walletVersion,
    });
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'decryptWallet',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'decryptWallet',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function balanceCase(request, event) {
  try {
    const response = await getBalanceInfo();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'balance',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'balance',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}
export async function ltcBalanceCase(request, event) {
  try {
    const response = await getLTCBalance();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'ltcBalance',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'ltcBalance',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function sendCoinCase(request, event) {
  try {
    const { receiver, password, amount } = request.payload;
    const { res } = await sendCoin({ receiver, password, amount });
    if (!res?.success) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: 'sendCoin',
          error: res?.data?.message,
          type: 'backgroundMessageResponse',
        },
        event.origin
      );
      return;
    }
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'sendCoin',
        payload: true,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'sendCoin',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function inviteToGroupCase(request, event) {
  try {
    const {
      groupId,
      qortalAddress,
      inviteTime,
      txGroupId = 0,
    } = request.payload;
    const response = await inviteToGroup({
      groupId,
      qortalAddress,
      inviteTime,
      txGroupId,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'inviteToGroup',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'inviteToGroup',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function saveTempPublishCase(request, event) {
  try {
    const { data, key } = request.payload;
    const response = await saveTempPublish({ data, key });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'saveTempPublish',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'saveTempPublish',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function getTempPublishCase(request, event) {
  try {
    const response = await getTempPublish();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getTempPublish',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getTempPublish',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function createGroupCase(request, event) {
  try {
    const {
      groupName,
      groupDescription,
      groupType,
      groupApprovalThreshold,
      minBlock,
      maxBlock,
    } = request.payload;
    const response = await createGroup({
      groupName,
      groupDescription,
      groupType,
      groupApprovalThreshold,
      minBlock,
      maxBlock,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'createGroup',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'createGroup',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function cancelInvitationToGroupCase(request, event) {
  try {
    const { groupId, qortalAddress, txGroupId = 0 } = request.payload;
    const response = await cancelInvitationToGroup({
      groupId,
      qortalAddress,
      txGroupId,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'cancelInvitationToGroup',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'cancelInvitationToGroup',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function leaveGroupCase(request, event) {
  try {
    const { groupId } = request.payload;
    const response = await leaveGroup({ groupId });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'leaveGroup',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'leaveGroup',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function joinGroupCase(request, event) {
  try {
    const { groupId } = request.payload;
    const response = await joinGroup({ groupId });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'joinGroup',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'joinGroup',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function kickFromGroupCase(request, event) {
  try {
    const {
      groupId,
      qortalAddress,
      rBanReason,
      txGroupId = 0,
    } = request.payload;
    const response = await kickFromGroup({
      groupId,
      qortalAddress,
      rBanReason,
      txGroupId,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'kickFromGroup',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'kickFromGroup',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function banFromGroupCase(request, event) {
  try {
    const {
      groupId,
      qortalAddress,
      rBanReason,
      rBanTime,
      txGroupId = 0,
    } = request.payload;
    const response = await banFromGroup({
      groupId,
      qortalAddress,
      rBanReason,
      rBanTime,
      txGroupId,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'banFromGroup',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'banFromGroup',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function addDataPublishesCase(request, event) {
  try {
    const { data, groupId, type } = request.payload;
    const response = await addDataPublishes(data, groupId, type);

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'addDataPublishes',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'addDataPublishes',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function getDataPublishesCase(request, event) {
  try {
    const { groupId, type } = request.payload;
    const response = await getDataPublishes(groupId, type);

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getDataPublishes',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getDataPublishes',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}
export async function addUserSettingsCase(request, event) {
  try {
    const { keyValue } = request.payload;
    const response = await addUserSettings({ keyValue });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'addUserSettings',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'addUserSettings',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function getUserSettingsCase(request, event) {
  try {
    const { key } = request.payload;
    const response = await getUserSettings({ key });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getUserSettings',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getUserSettings',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function cancelBanCase(request, event) {
  try {
    const { groupId, qortalAddress, txGroupId = 0 } = request.payload;
    const response = await cancelBan({ groupId, qortalAddress, txGroupId });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'cancelBan',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'cancelBan',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function registerNameCase(request, event) {
  try {
    const { name } = request.payload;
    const response = await registerName({ name });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'registerName',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'registerName',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}
export async function createPollCase(request, event) {
  try {
    const { pollName, pollDescription, pollOptions } = request.payload;
    const resCreatePoll = await _createPoll(
      {
        pollName,
        pollDescription,
        options: pollOptions,
      },
      true,
      true // skip permission
    );

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'registerName',
        payload: resCreatePoll,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'registerName',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}
export async function voteOnPollCase(request, event) {
  try {
    const res = await _voteOnPoll(request.payload, true, true);

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'registerName',
        payload: res,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'registerName',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function makeAdminCase(request, event) {
  try {
    const { groupId, qortalAddress, txGroupId = 0 } = request.payload;
    const response = await makeAdmin({ groupId, qortalAddress, txGroupId });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'makeAdmin',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'makeAdmin',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function removeAdminCase(request, event) {
  try {
    const { groupId, qortalAddress, txGroupId = 0 } = request.payload;
    const response = await removeAdmin({ groupId, qortalAddress, txGroupId });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'removeAdmin',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'removeAdmin',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function addTimestampEnterChatCase(request, event) {
  try {
    const { groupId, timestamp } = request.payload;
    const response = await addTimestampEnterChat({ groupId, timestamp });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'addTimestampEnterChat',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'addTimestampEnterChat',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function setLocalApiKeyNotElectronCase(localApiKey) {
  storeData('localApiKey', localApiKey);
}

export async function getLocalApiKeyNotElectronCase() {
  return await getData('localApiKey').catch((error) => null);
}

export async function setApiKeyCase(request, event) {
  try {
    const payload = request.payload;

    storeData('apiKey', payload);
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'setApiKey',
        payload: true,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'setApiKey',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}
export async function setCustomNodesCase(request, event) {
  try {
    const nodes = request.payload;
    if (window?.walletStorage) {
      await window.walletStorage.set('customNodes', nodes);
    } else {
      storeData('customNodes', nodes);
    }

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'setCustomNodes',
        payload: true,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'setCustomNodes',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function getApiKeyCase(request, event) {
  try {
    const response = await getApiKeyFromStorage();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getApiKey',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getApiKey',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function getCustomNodesFromStorageCase(request, event) {
  try {
    const response = await getCustomNodesFromStorage();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getCustomNodesFromStorage',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getCustomNodesFromStorage',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function notifyAdminRegenerateSecretKeyCase(request, event) {
  try {
    const { groupName, adminAddress } = request.payload;
    const response = await notifyAdminRegenerateSecretKey({
      groupName,
      adminAddress,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'notifyAdminRegenerateSecretKey',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'notifyAdminRegenerateSecretKey',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function addGroupNotificationTimestampCase(request, event) {
  try {
    const { groupId, timestamp } = request.payload;
    const response = await addTimestampGroupAnnouncement({
      groupId,
      timestamp,
      seenTimestamp: true,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'addGroupNotificationTimestamp',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'addGroupNotificationTimestamp',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}
export async function addEnteredQmailTimestampCase(request, event) {
  try {
    const response = await addEnteredQmailTimestamp();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'addEnteredQmailTimestamp',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'addEnteredQmailTimestamp',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}
export async function getEnteredQmailTimestampCase(request, event) {
  try {
    const response = await getEnteredQmailTimestamp();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getEnteredQmailTimestamp',
        payload: { timestamp: response },
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getEnteredQmailTimestamp',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function setGroupDataCase(request, event) {
  try {
    const { groupId, secretKeyData, secretKeyResource, admins } =
      request.payload;
    const response = await setGroupData({
      groupId,
      secretKeyData,
      secretKeyResource,
      admins,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'setGroupData',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'setGroupData',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function getGroupDataSingleCase(request, event) {
  try {
    const { groupId } = request.payload;
    const response = await getGroupDataSingle(groupId);

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getGroupDataSingle',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getGroupDataSingle',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function getTimestampEnterChatCase(request, event) {
  try {
    const response = await getTimestampEnterChat();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getTimestampEnterChat',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getTimestampEnterChat',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function listActionsCase(request, event) {
  try {
    const { type, listName = '', items = [] } = request.payload;
    let responseData;

    if (type === 'get') {
      const url = await createEndpoint(`/lists/${listName}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch');

      responseData = await response.json();
    } else if (type === 'remove') {
      const url = await createEndpoint(`/lists/${listName}`);
      const body = {
        items: items,
      };
      const bodyToString = JSON.stringify(body);
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: bodyToString,
      });

      if (!response.ok) throw new Error('Failed to remove from list');
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      responseData = res;
    } else if (type === 'add') {
      const url = await createEndpoint(`/lists/${listName}`);
      const body = {
        items: items,
      };
      const bodyToString = JSON.stringify(body);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: bodyToString,
      });

      if (!response.ok) throw new Error('Failed to add to list');
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      responseData = res;
    }

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'listActions',
        payload: responseData,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'listActions',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function getTimestampMentionCase(request, event) {
  try {
    const response = await getTimestampMention();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getTimestampMention',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getTimestampMention',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function addTimestampMentionCase(request, event) {
  try {
    const { groupId, timestamp } = request.payload;
    const response = await addTimestampMention({ groupId, timestamp });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'addTimestampMention',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'addTimestampMention',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function getGroupNotificationTimestampCase(request, event) {
  try {
    const response = await getTimestampGroupAnnouncement();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getGroupNotificationTimestamp',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getGroupNotificationTimestamp',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function encryptAndPublishSymmetricKeyGroupChatCase(
  request,
  event
) {
  try {
    const { groupId, previousData, isOwner, addKey } = request.payload;
    let addKeyVar = false;
    if (isOwner && addKey) {
      addKeyVar = true;
    }
    const { data, numberOfMembers } =
      await encryptAndPublishSymmetricKeyGroupChat({
        groupId,
        previousData,
        addKey: addKeyVar,
      });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'encryptAndPublishSymmetricKeyGroupChat',
        payload: data,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
    if (!previousData) {
      try {
        sendChatGroup({
          groupId,
          typeMessage: undefined,
          chatReference: undefined,
          messageText: PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY,
        });
      } catch (error) {
        // error in sending chat message
      }
    }
    try {
      sendChatNotification(data, groupId, previousData, numberOfMembers);
    } catch (error) {
      // error in sending notification
    }
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'encryptAndPublishSymmetricKeyGroupChat',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function encryptAndPublishSymmetricKeyGroupChatForAdminsCase(
  request,
  event
) {
  try {
    const { groupId, previousData, admins } = request.payload;
    const { data, numberOfMembers } =
      await encryptAndPublishSymmetricKeyGroupChatForAdmins({
        groupId,
        previousData,
        admins,
      });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'encryptAndPublishSymmetricKeyGroupChatForAdmins',
        payload: data,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'encryptAndPublishSymmetricKeyGroupChat',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function publishGroupEncryptedResourceCase(request, event) {
  try {
    const { encryptedData, identifier } = request.payload;
    const response = await publishGroupEncryptedResource({
      encryptedData,
      identifier,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'publishGroupEncryptedResource',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'publishGroupEncryptedResource',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function publishOnQDNCase(request, event) {
  try {
    const {
      data,
      name = '',
      identifier,
      service,
      title,
      description,
      category,
      tag1,
      tag2,
      tag3,
      tag4,
      tag5,
      uploadType,
    } = request.payload;

    const response = await publishOnQDN({
      data,
      name,
      identifier,
      service,
      title,
      description,
      category,
      tag1,
      tag2,
      tag3,
      tag4,
      tag5,
      uploadType,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'publishOnQDN',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'publishOnQDN',
        error: error?.message || 'Unable to publish',
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function handleActiveGroupDataFromSocketCase(request, event) {
  try {
    const { groups, directs } = request.payload;
    const response = await handleActiveGroupDataFromSocket({ groups, directs });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'handleActiveGroupDataFromSocket',
        payload: true,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'handleActiveGroupDataFromSocket',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function getThreadActivityCase(request, event) {
  try {
    const response = await checkThreads(true);

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getThreadActivity',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getThreadActivity',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function updateThreadActivityCase(request, event) {
  try {
    const { threadId, qortalName, groupId, thread } = request.payload;
    const response = await updateThreadActivity({
      threadId,
      qortalName,
      groupId,
      thread,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'updateThreadActivity',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'updateThreadActivity',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function decryptGroupEncryptionCase(request, event) {
  try {
    const { data } = request.payload;
    const response = await decryptGroupEncryption({ data });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'decryptGroupEncryption',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'decryptGroupEncryption',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function encryptSingleCase(request, event) {
  try {
    const { data, secretKeyObject, typeNumber } = request.payload;
    const response = await encryptSingle({
      data64: data,
      secretKeyObject,
      typeNumber,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'encryptSingle',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'encryptSingle',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function decryptSingleCase(request, event) {
  try {
    const { data, secretKeyObject, skipDecodeBase64 } = request.payload;

    const response = await decryptSingleFunc({
      messages: data,
      secretKeyObject,
      skipDecodeBase64,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'decryptSingle',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'decryptSingle',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function pauseAllQueuesCase(request, event) {
  try {
    await pauseAllQueues();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'pauseAllQueues',
        payload: true,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'pauseAllQueues',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function resumeAllQueuesCase(request, event) {
  try {
    await resumeAllQueues();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'resumeAllQueues',
        payload: true,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'resumeAllQueues',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function checkLocalCase(request, event) {
  try {
    const response = await checkLocalFunc();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'pauseAllQueues',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'checkLocal',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function decryptSingleForPublishesCase(request, event) {
  try {
    const { data, secretKeyObject, skipDecodeBase64 } = request.payload;
    const response = await decryptSingleForPublishes({
      messages: data,
      secretKeyObject,
      skipDecodeBase64,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'decryptSingleForPublishes',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'decryptSingle',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function decryptDirectCase(request, event) {
  try {
    const { data, involvingAddress } = request.payload;
    const response = await decryptDirectFunc({
      messages: data,
      involvingAddress,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'decryptDirect',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'decryptDirect',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function sendChatGroupCase(request, event) {
  try {
    const {
      groupId,
      typeMessage = undefined,
      chatReference = undefined,
      messageText,
    } = request.payload;
    const response = await sendChatGroup({
      groupId,
      typeMessage,
      chatReference,
      messageText,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'sendChatGroup',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'sendChatGroup',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function sendChatDirectCase(request, event) {
  try {
    const {
      directTo,
      typeMessage = undefined,
      chatReference = undefined,
      messageText,
      publicKeyOfRecipient,
      address,
      otherData,
    } = request.payload;
    const response = await sendChatDirect({
      directTo,
      chatReference,
      messageText,
      typeMessage,
      publicKeyOfRecipient,
      address,
      otherData,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'sendChatDirect',
        payload: response,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'sendChatDirect',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function setupGroupWebsocketCase(request, event) {
  try {
    checkNewMessages();
    checkThreads();
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'sendChatDirect',
        payload: true,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'sendChatDirect',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function createRewardShareCase(request, event) {
  try {
    const { recipientPublicKey } = request.payload;
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };
    let lastRef = await getLastRef();

    const tx = await createTransaction(38, keyPair, {
      recipientPublicKey,
      percentageShare: 0,
      lastReference: lastRef,
    });

    const signedBytes = Base58.encode(tx.signedBytes);

    const res = await processTransactionVersion2(signedBytes);
    if (!res?.signature)
      throw new Error('Transaction was not able to be processed');
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'createRewardShare',
        payload: res,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'createRewardShare',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function removeRewardShareCase(request, event) {
  try {
    const { rewardShareKeyPairPublicKey, recipient, percentageShare } =
      request.payload;
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };
    let lastRef = await getLastRef();

    const tx = await createTransaction(381, keyPair, {
      rewardShareKeyPairPublicKey,
      recipient,
      percentageShare,
      lastReference: lastRef,
    });

    const signedBytes = Base58.encode(tx.signedBytes);
    const res = await processTransactionVersion2(signedBytes);

    if (!res?.signature)
      throw new Error('Transaction was not able to be processed');
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'removeRewardShare',
        payload: res,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'removeRewardShare',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

export async function getRewardSharePrivateKeyCase(request, event) {
  try {
    const { recipientPublicKey } = request.payload;
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };
    let lastRef = await getLastRef();

    const tx = await createTransaction(38, keyPair, {
      recipientPublicKey,
      percentageShare: 0,
      lastReference: lastRef,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getRewardSharePrivateKey',
        payload: tx?._base58RewardShareSeed,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'getRewardSharePrivateKey',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

/**
 * Signs a presence message payload using the authenticated user's Ed25519
 * private key. The renderer passes the fields to sign; this case canonicalises
 * them (sorted keys → JSON → UTF-8) and returns a Base58-encoded signature.
 *
 * Expected request.payload shape:
 *   { type, address, publicKey, sessionId, timestamp, clientVersion? }
 */
export async function signPresenceMessageCase(request, event) {
  try {
    const resKeyPair = await getKeyPair();
    const privateKeyBytes = Base58.decode(resKeyPair.privateKey);

    // Build canonical signed data — keys sorted alphabetically, then
    // JSON-stringify and UTF-8 encode. Must match canonicalizeForSigning()
    // in electron/src/presence.ts exactly.
    const fields = request.payload as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(fields).sort()) {
      sorted[key] = fields[key];
    }
    const messageBytes = new TextEncoder().encode(JSON.stringify(sorted));
    const signature = nacl.sign.detached(messageBytes, privateKeyBytes);
    const signatureBase58 = Base58.encode(signature);

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'signPresenceMessage',
        payload: { signature: signatureBase58 },
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'signPresenceMessage',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

// ── Support Chat encryption ───────────────────────────────────────────────────
//
// One shared support keypair drives the encryption for the support chat.
//
// User side (no QORT, no core, no QDN required):
//   ECDH( userPrivKey,       SUPPORT_PUBLIC_KEY  ) → sharedSecret
//   Encrypt outgoing, decrypt incoming agent replies.
//
// Agent side (hard-coded key for testing; production: fetch from QDN group resource):
//   ECDH( SUPPORT_PRIVATE_KEY, userPublicKey ) → identical sharedSecret
//   Decrypt user messages, encrypt replies.
//
// SUPPORT_PUBLIC_KEY is baked into the app binary — key rotation = app update.
// SUPPORT_PRIVATE_KEY is kept out of the binary in production; see plan notes.

const SUPPORT_PUBLIC_KEY = 'Ecg4aNUYHonfGjC77BnJZ5dw3s6wYGoKUT2JXfMzQgtn';
const SUPPORT_PRIVATE_KEY = '2PJdmgbhkWu1zNuU3bk8jL3eTiAn3Fq9aPSqGHpq8uWE2SPLan1XdxMGvek9z6twwtG7iduQBNCc697pRff3emv6';

/**
 * Derives the 32-byte symmetric encryption key shared between the user and
 * the support team via ECDH (Ed25519→Curve25519) + SHA-256.
 * SHA-256 is applied to the raw Diffie-Hellman output to produce a proper
 * symmetric key, matching the pattern used elsewhere in the codebase.
 */
function deriveSupportSharedKey(
  privateKeyBytes: Uint8Array,
  publicKeyBytes: Uint8Array
): Uint8Array {
  const convertedPrivKey = ed2curve.convertSecretKey(privateKeyBytes);
  const convertedPubKey = ed2curve.convertPublicKey(publicKeyBytes);
  const rawSecret = new Uint8Array(32);
  nacl.lowlevel.crypto_scalarmult(rawSecret, convertedPrivKey, convertedPubKey);
  return new Sha256().process(rawSecret).finish().result as Uint8Array;
}

/**
 * Encodes a Uint8Array to a Base64 string without using spread (safe for large arrays).
 */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Encrypts a plaintext string for the support channel.
 *
 * User mode (isAgent not set):
 *   sharedKey = ECDH( userPrivKey, SUPPORT_PUBLIC_KEY )
 *
 * Agent mode (isAgent: true AND recipientPublicKey provided):
 *   sharedKey = ECDH( SUPPORT_PRIVATE_KEY, recipientPublicKey )
 *
 * Wire format: base64( nonce[24] || nacl.secretbox_ciphertext )
 *
 * Expected request.payload: { text: string, isAgent?: boolean, recipientPublicKey?: string }
 */
export async function encryptSupportMessageCase(request, event) {
  try {
    const { text, isAgent, recipientPublicKey } = request.payload as {
      text: string;
      isAgent?: boolean;
      recipientPublicKey?: string;
    };

    let encKey: Uint8Array;

    if (isAgent && recipientPublicKey) {
      // Agent mode: encrypt using the shared support private key.
      const supportPrivBytes = Base58.decode(SUPPORT_PRIVATE_KEY);
      const recipientPubBytes = Base58.decode(recipientPublicKey);
      encKey = deriveSupportSharedKey(supportPrivBytes, recipientPubBytes);
    } else {
      // User mode: encrypt using the user's own key pair + the hard-coded
      // support public key. No core, QDN, or QORT required.
      const resKeyPair = await getKeyPair();
      const userPrivBytes = Base58.decode(resKeyPair.privateKey);
      const supportPubBytes = Base58.decode(SUPPORT_PUBLIC_KEY);
      encKey = deriveSupportSharedKey(userPrivBytes, supportPubBytes);
    }

    const textBytes = new TextEncoder().encode(text);
    const nonce = nacl.randomBytes(24);
    const ciphertext = nacl.secretbox(textBytes, nonce, encKey);

    const combined = new Uint8Array(24 + ciphertext.length);
    combined.set(nonce, 0);
    combined.set(ciphertext, 24);
    const encryptedData = uint8ToBase64(combined);

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'encryptSupportMessage',
        payload: { encryptedData },
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'encryptSupportMessage',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}

/**
 * Decrypts a support-channel ciphertext.
 *
 * User mode (isAgent not set):
 *   sharedKey = ECDH( userPrivKey, SUPPORT_PUBLIC_KEY )
 *   senderPublicKey is ignored — the shared secret does not depend on who sent.
 *
 * Agent mode (isAgent: true):
 *   sharedKey = ECDH( SUPPORT_PRIVATE_KEY, senderPublicKey )
 *   senderPublicKey must be the user's Base58 Ed25519 public key.
 *
 * Expected request.payload: { encryptedData: string, senderPublicKey: string, isAgent?: boolean }
 */
export async function decryptSupportMessageCase(request, event) {
  try {
    const { encryptedData, senderPublicKey, isAgent } = request.payload as {
      encryptedData: string;
      senderPublicKey: string;
      isAgent?: boolean;
    };

    let encKey: Uint8Array;

    if (isAgent) {
      // Agent mode: derive key using the shared support private key and the
      // sender's (user's) public key from the message.
      const supportPrivBytes = Base58.decode(SUPPORT_PRIVATE_KEY);
      const senderPubBytes = Base58.decode(senderPublicKey);
      encKey = deriveSupportSharedKey(supportPrivBytes, senderPubBytes);
    } else {
      // User mode: derive key using the user's own private key and the
      // hard-coded support public key.
      const resKeyPair = await getKeyPair();
      const userPrivBytes = Base58.decode(resKeyPair.privateKey);
      const supportPubBytes = Base58.decode(SUPPORT_PUBLIC_KEY);
      encKey = deriveSupportSharedKey(userPrivBytes, supportPubBytes);
    }

    // Base64-decode the wire format: nonce[0:24] || ciphertext[24:]
    const decoded = atob(encryptedData);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i);
    }

    const nonce = bytes.slice(0, 24);
    const ciphertext = bytes.slice(24);

    const decryptedBytes = nacl.secretbox.open(ciphertext, nonce, encKey);
    if (!decryptedBytes) {
      throw new Error('Decryption failed: authentication tag mismatch');
    }

    const decryptedText = new TextDecoder().decode(decryptedBytes);

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'decryptSupportMessage',
        payload: { decryptedText },
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: 'decryptSupportMessage',
        error: error?.message,
        type: 'backgroundMessageResponse',
      },
      event.origin
    );
  }
}
