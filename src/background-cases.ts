import {
  addDataPublishes,
  addTimestampEnterChat,
  addTimestampGroupAnnouncement,
  addUserSettings,
  banFromGroup,
  cancelBan,
  cancelInvitationToGroup,
  checkLocalFunc,
  checkNewMessages,
  checkThreads,
  clearAllNotifications,
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
  getGroupDataSingle,
  getKeyPair,
  getLTCBalance,
  getNameInfo,
  getTempPublish,
  getTimestampEnterChat,
  getTimestampGroupAnnouncement,
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
  registerName,
  removeAdmin,
  resumeAllQueues,
  saveTempPublish,
  sendChatDirect,
  sendChatGroup,
  sendChatNotification,
  sendCoin,
  setChatHeads,
  setGroupData,
  updateThreadActivity,
  walletVersion,
} from "./background";
import { decryptGroupEncryption, encryptAndPublishSymmetricKeyGroupChat, publishGroupEncryptedResource, publishOnQDN } from "./backgroundFunctions/encryption";
import { PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY } from "./constants/codes";
import { encryptSingle } from "./qdn/encryption/group-encryption";
import { getData, storeData } from "./utils/chromeStorage";

export function versionCase(request, event) {
  event.source.postMessage(
    {
      requestId: request.requestId,
      action: "version",
      payload: { version: "1.0" },
      type: "backgroundMessageResponse",
    },
    event.origin
  );
}

export async function getWalletInfoCase(request, event) {
  try {
    const response = await getKeyPair();

    try {
      const walletInfo = await getData('walletInfo').catch((error)=> null)
      if(walletInfo){
        event.source.postMessage(
          {
            requestId: request.requestId,
            action: "getWalletInfo",
            payload: { walletInfo, hasKeyPair: true },
            type: "backgroundMessageResponse",
          },
          event.origin
        );
      } else {
        event.source.postMessage(
          {
            requestId: request.requestId,
            action: "getWalletInfo",
            error: "No wallet info found",
            type: "backgroundMessageResponse",
          },
          event.origin
        );
      }
   
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "getWalletInfo",
          error: "No wallet info found",
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
   
  } catch (error) {
    try {
      const walletInfo = await getData('walletInfo').catch((error)=> null)
      if(walletInfo){
        event.source.postMessage(
          {
            requestId: request.requestId,
            action: "getWalletInfo",
            payload: { walletInfo, hasKeyPair: false },
            type: "backgroundMessageResponse",
          },
          event.origin
        );
      } else {
        event.source.postMessage(
          {
            requestId: request.requestId,
            action: "getWalletInfo",
            error: "Wallet not authenticated",
            type: "backgroundMessageResponse",
          },
          event.origin
        );
      }
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "getWalletInfo",
          error: "Wallet not authenticated",
          type: "backgroundMessageResponse",
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
        action: "validApi",
        payload: usableApi,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "validApi",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "name",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "name",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "userInfo",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "userInfo",
        error: "User not authenticated",
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function decryptWalletCase(request, event) {
  try { 
    const { password, wallet } = request.payload;
    const response = await decryptWallet({password, wallet, walletVersion});
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "decryptWallet",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "decryptWallet",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "balance",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "balance",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "ltcBalance",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "ltcBalance",
        error: error?.message,
        type: "backgroundMessageResponse",
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
          action: "sendCoin",
          error: res?.data?.message,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
      return;
    }
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "sendCoin",
        payload: true,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "sendCoin",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function inviteToGroupCase(request, event) {
  try {
    const { groupId, qortalAddress, inviteTime } = request.payload;
    const response = await inviteToGroup({
      groupId,
      qortalAddress,
      inviteTime,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "inviteToGroup",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "inviteToGroup",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "saveTempPublish",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "saveTempPublish",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "getTempPublish",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "getTempPublish",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "createGroup",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "createGroup",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function cancelInvitationToGroupCase(request, event) {
  try {
    const { groupId, qortalAddress } = request.payload;
    const response = await cancelInvitationToGroup({ groupId, qortalAddress });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "cancelInvitationToGroup",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "cancelInvitationToGroup",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function leaveGroupCase(request, event) {
  try {
    const { groupId, qortalAddress } = request.payload;
    const response = await leaveGroup({ groupId, qortalAddress });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "leaveGroup",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "leaveGroup",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "joinGroup",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "joinGroup",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function kickFromGroupCase(request, event) {
  try {
    const { groupId, qortalAddress, rBanReason } = request.payload;
    const response = await kickFromGroup({
      groupId,
      qortalAddress,
      rBanReason,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "kickFromGroup",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "kickFromGroup",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function banFromGroupCase(request, event) {
  try {
    const { groupId, qortalAddress, rBanReason, rBanTime } = request.payload;
    const response = await banFromGroup({
      groupId,
      qortalAddress,
      rBanReason,
      rBanTime,
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "banFromGroup",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "banFromGroup",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function addDataPublishesCase(request, event) {
  try {
    const { data, groupId, type } = request.payload;
    const response = await addDataPublishes({ data, groupId, type });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "addDataPublishes",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "addDataPublishes",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function getDataPublishesCase(request, event) {
  try {
    const { groupId, type } = request.payload;
    const response = await getDataPublishes({ groupId, type });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "getDataPublishes",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "getDataPublishes",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "addUserSettings",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "addUserSettings",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "getUserSettings",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "getUserSettings",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function cancelBanCase(request, event) {
  try {
    const { groupId, qortalAddress } = request.payload;
    const response = await cancelBan({ groupId, qortalAddress });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "cancelBan",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "cancelBan",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "registerName",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "registerName",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function makeAdminCase(request, event) {
  try {
    const { groupId, qortalAddress } = request.payload;
    const response = await makeAdmin({ groupId, qortalAddress });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "makeAdmin",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "makeAdmin",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function removeAdminCase(request, event) {
  try {
    const { groupId, qortalAddress } = request.payload;
    const response = await removeAdmin({ groupId, qortalAddress });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "removeAdmin",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "removeAdmin",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function notificationCase(request, event) {
  try {
    const notificationId = "chat_notification_" + Date.now(); // Create a unique ID

    // chrome.notifications.create(notificationId, {
    //   type: "basic",
    //   iconUrl: "qort.png", // Add an appropriate icon for chat notifications
    //   title: "New Group Message!",
    //   message: "You have received a new message from one of your groups",
    //   priority: 2, // Use the maximum priority to ensure it's 
    // });
    // Set a timeout to clear the notification after 'timeout' milliseconds
    // setTimeout(() => {
    //   chrome.notifications.clear(notificationId);
    // }, 3000);

    // event.source.postMessage(
    //   {
    //     requestId: request.requestId,
    //     action: "notification",
    //     payload: true,
    //     type: "backgroundMessageResponse",
    //   },
    //   event.origin
    // );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "notification",
        error: "Error displaying notifaction",
        type: "backgroundMessageResponse",
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
        action: "addTimestampEnterChat",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "addTimestampEnterChat",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function setApiKeyCase(request, event) {
  try {
    const payload = request.payload;
    storeData('apiKey', payload)
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "setApiKey",
        payload: true,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "setApiKey",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}
export async function setCustomNodesCase(request, event) {
  try {
    const nodes = request.payload;
    storeData('customNodes', nodes)

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "setCustomNodes",
        payload: true,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "setCustomNodes",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "getApiKey",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "getApiKey",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "getCustomNodesFromStorage",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "getCustomNodesFromStorage",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "notifyAdminRegenerateSecretKey",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "notifyAdminRegenerateSecretKey",
        error: error?.message,
        type: "backgroundMessageResponse",
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
    });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "addGroupNotificationTimestamp",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "addGroupNotificationTimestamp",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function clearAllNotificationsCase(request, event) {
  try {
    await clearAllNotifications();

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "clearAllNotifications",
        payload: true,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "clearAllNotifications",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "setGroupData",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "setGroupData",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function getGroupDataSingleCase(request, event) {
  try {
    const { groupId } = request.payload;
    const response = await getGroupDataSingle({ groupId });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "getGroupDataSingle",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "getGroupDataSingle",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "getTimestampEnterChat",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "getTimestampEnterChat",
        error: error?.message,
        type: "backgroundMessageResponse",
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
        action: "getGroupNotificationTimestamp",
        payload: response,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "getGroupNotificationTimestamp",
        error: error?.message,
        type: "backgroundMessageResponse",
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
    const { groupId, previousData, previousNumber } = request.payload;
    const { data, numberOfMembers } =
      await encryptAndPublishSymmetricKeyGroupChat({
        groupId,
        previousData,
        previousNumber,
      });

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "encryptAndPublishSymmetricKeyGroupChat",
        payload: data,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
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
    try {
      sendChatNotification(data, groupId, previousData, numberOfMembers);
    } catch (error) {
      // error in sending notification
    }
  } catch (error) {
    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "encryptAndPublishSymmetricKeyGroupChat",
        error: error?.message,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  }
}

export async function publishGroupEncryptedResourceCase(request, event) {
    try {
      const {encryptedData, identifier} = request.payload;
      const response = await publishGroupEncryptedResource({encryptedData, identifier});
  
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "publishGroupEncryptedResource",
          payload: response,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "publishGroupEncryptedResource",
          error: error?.message,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
  }

  export async function publishOnQDNCase(request, event) {
    try {
      const {data, identifier, service, title,
          description,
          category,
          tag1,
          tag2,
          tag3,
          tag4,
          tag5, uploadType} = request.payload;
      const response = await publishOnQDN({data, identifier, service, title,
          description,
          category,
          tag1,
          tag2,
          tag3,
          tag4,
          tag5, uploadType});
  
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "publishOnQDN",
          payload: response,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "publishOnQDN",
          error: error?.message || 'Unable to publish',
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
  }

  export async function handleActiveGroupDataFromSocketCase(request, event) {
    try {
      const {groups, directs} = request.payload;
      const response = await handleActiveGroupDataFromSocket({groups, directs});
  
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "handleActiveGroupDataFromSocket",
          payload: true,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "handleActiveGroupDataFromSocket",
          error: error?.message,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
  }

  export async function getThreadActivityCase(request, event) {
    try {
      const response = await checkThreads(true)
  
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "getThreadActivity",
          payload: response,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "getThreadActivity",
          error: error?.message,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
  }

  export async function updateThreadActivityCase(request, event) {
    try {
      const { threadId, qortalName, groupId, thread} = request.payload;
      const response = await updateThreadActivity({ threadId, qortalName, groupId, thread });
  
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "updateThreadActivity",
          payload: response,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "updateThreadActivity",
          error: error?.message,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
  }

  export async function decryptGroupEncryptionCase(request, event) {
    try {
      const { data} = request.payload;
      const response = await decryptGroupEncryption({ data });
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "decryptGroupEncryption",
          payload: response,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "decryptGroupEncryption",
          error: error?.message,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
  }

  export async function encryptSingleCase(request, event) {
    try {
      const { data, secretKeyObject, typeNumber} = request.payload;
      const response = await encryptSingle({ data64: data, secretKeyObject, typeNumber });
  
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "encryptSingle",
          payload: response,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "encryptSingle",
          error: error?.message,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
  }

  export async function decryptSingleCase(request, event) {
    try {
      const { data, secretKeyObject, skipDecodeBase64} = request.payload;
      const response = await decryptSingleFunc({ messages: data, secretKeyObject, skipDecodeBase64 });
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "decryptSingle",
          payload: response,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "decryptSingle",
          error: error?.message,
          type: "backgroundMessageResponse",
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
          action: "pauseAllQueues",
          payload: true,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "pauseAllQueues",
          error: error?.message,
          type: "backgroundMessageResponse",
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
          action: "resumeAllQueues",
          payload: true,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "resumeAllQueues",
          error: error?.message,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
  }
  export async function checkLocalCase(request, event) {
    try {
      const response = await checkLocalFunc()
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "pauseAllQueues",
          payload: response,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "checkLocal",
          error: error?.message,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
  }

  export async function decryptSingleForPublishesCase(request, event) {
    try {
      const { data, secretKeyObject, skipDecodeBase64} = request.payload;
      const response = await decryptSingleForPublishes({ data, secretKeyObject, skipDecodeBase64 });
  
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "decryptSingleForPublishes",
          payload: response,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "decryptSingle",
          error: error?.message,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
  }

  export async function decryptDirectCase(request, event) {
    try {
      const { data, involvingAddress} = request.payload;
      const response = await decryptDirectFunc({ messages: data, involvingAddress });
  
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "decryptDirect",
          payload: response,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "decryptDirect",
          error: error?.message,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
  }
  export async function sendChatGroupCase(request, event) {
    try {
      const {   groupId,
        typeMessage = undefined,
        chatReference = undefined,
        messageText} = request.payload;
      const response = await sendChatGroup({ groupId, typeMessage, chatReference, messageText });
  
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "sendChatGroup",
          payload: response,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "sendChatGroup",
          error: error?.message,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
  }
  export async function sendChatDirectCase(request, event) {
    try {
      const {    directTo,
        typeMessage = undefined,
        chatReference = undefined,
        messageText,
        publicKeyOfRecipient,
        address,
        otherData} = request.payload;
      const response = await sendChatDirect({  directTo,
        chatReference,
        messageText,
        typeMessage,
        publicKeyOfRecipient,
        address,
        otherData });
  
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "sendChatDirect",
          payload: response,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "sendChatDirect",
          error: error?.message,
          type: "backgroundMessageResponse",
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
          action: "sendChatDirect",
          payload: true,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    } catch (error) {
      event.source.postMessage(
        {
          requestId: request.requestId,
          action: "sendChatDirect",
          error: error?.message,
          type: "backgroundMessageResponse",
        },
        event.origin
      );
    }
  }