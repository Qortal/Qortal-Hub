import {
  gateways,
  getApiKeyFromStorage,
  getNameInfoForOthers,
} from '../background/background.ts';
import { listOfAllQortalRequests } from '../hooks/useQortalMessageListener.tsx';
import {
  addForeignServer,
  addGroupAdminRequest,
  addListItems,
  adminAction,
  banFromGroupRequest,
  cancelGroupBanRequest,
  cancelGroupInviteRequest,
  cancelSellOrder,
  createAndCopyEmbedLink,
  createBuyOrder,
  createGroupRequest,
  createPoll,
  createSellOrder,
  decryptAESGCMRequest,
  decryptData,
  decryptDataWithSharingKey,
  decryptQortalGroupData,
  deleteHostedData,
  deleteListItems,
  deployAt,
  encryptData,
  encryptDataWithSharingKey,
  encryptQortalGroupData,
  getCrossChainServerInfo,
  getDaySummary,
  getNodeInfo,
  getNodeStatus,
  getForeignFee,
  getHostedData,
  getListItems,
  getServerConnectionHistory,
  getTxActivitySummary,
  getUserAccount,
  getUserWallet,
  getUserWalletInfo,
  getUserWalletTransactions,
  getWalletBalance,
  inviteToGroupRequest,
  joinGroup,
  kickFromGroupRequest,
  leaveGroupRequest,
  openNewTab,
  publishMultipleQDNResources,
  publishQDNResource,
  registerNameRequest,
  removeForeignServer,
  removeGroupAdminRequest,
  sendChatMessage,
  sendCoin,
  setCurrentForeignServer,
  signTransaction,
  updateForeignFee,
  updateNameRequest,
  voteOnPoll,
  getArrrSyncStatus,
  updateGroupRequest,
  buyNameRequest,
  sellNameRequest,
  cancelSellNameRequest,
  signForeignFees,
  multiPaymentWithPrivateData,
  transferAssetRequest,
} from './get.ts';
import { getData, storeData } from '../utils/chromeStorage.ts';
import { executeEvent } from '../utils/events.ts';

function getLocalStorage(key) {
  return getData(key).catch((error) => {
    console.error('Error retrieving data:', error);
    throw error;
  });
}

// Promisify setting data in localStorage
function setLocalStorage(key, data) {
  return storeData(key, data).catch((error) => {
    console.error('Error saving data:', error);
    throw error;
  });
}

export const isRunningGateway = async () => {
  let isGateway = true;
  const apiKey = await getApiKeyFromStorage();
  if (
    apiKey &&
    apiKey?.url &&
    !gateways.some((gateway) => apiKey?.url?.includes(gateway))
  ) {
    isGateway = false;
  }

  return isGateway;
};

export async function setPermission(key, value) {
  try {
    // Get the existing qortalRequestPermissions object
    const qortalRequestPermissions =
      (await getLocalStorage('qortalRequestPermissions')) || {};

    // Update the permission
    qortalRequestPermissions[key] = value;

    // Save the updated object back to storage
    await setLocalStorage('qortalRequestPermissions', qortalRequestPermissions);
  } catch (error) {
    console.error('Error setting permission:', error);
  }
}

export async function getPermission(key) {
  try {
    // Get the qortalRequestPermissions object from storage
    const qortalRequestPermissions =
      (await getLocalStorage('qortalRequestPermissions')) || {};

    // Return the value for the given key, or null if it doesn't exist
    return qortalRequestPermissions[key] || null;
  } catch (error) {
    console.error('Error getting permission:', error);
    return null;
  }
}

// TODO: feature: add call to GET_FRIENDS_LIST
// NOT SURE IF TO IMPLEMENT: LINK_TO_QDN_RESOURCE, QDN_RESOURCE_DISPLAYED, SET_TAB_NOTIFICATIONS

function setupMessageListenerQortalRequest() {
  window.addEventListener('message', async (event) => {
    const request = event.data;

    // Ensure the message is from a trusted source
    const isFromExtension = request?.isExtension;
    const appInfo = request?.appInfo;
    const skipAuth = request?.skipAuth || false;
    if (request?.type !== 'backgroundMessage') return; // Only process messages of type 'backgroundMessage'

    // Handle actions based on the `request.action` value
    switch (request.action) {
      case 'GET_USER_ACCOUNT': {
        try {
          const res = await getUserAccount({
            isFromExtension,
            appInfo,
            skipAuth,
          });
          event.source!.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source!.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: 'Unable to get user account',
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'ENCRYPT_DATA': {
        try {
          const res = await encryptData(request.payload, event.source);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'ENCRYPT_QORTAL_GROUP_DATA': {
        try {
          const res = await encryptQortalGroupData(
            request.payload,
            event.source
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'DECRYPT_QORTAL_GROUP_DATA': {
        try {
          const res = await decryptQortalGroupData(
            request.payload,
            event.source
          );
          event.source!.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source!.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'DECRYPT_DATA': {
        try {
          const res = await decryptData(request.payload);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_LIST_ITEMS': {
        try {
          const res = await getListItems(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'ADD_LIST_ITEMS': {
        try {
          const res = await addListItems(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'DELETE_LIST_ITEM': {
        try {
          const res = await deleteListItems(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'PUBLISH_QDN_RESOURCE': {
        try {
          const res = await publishQDNResource(
            request.payload,
            event.source,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'PUBLISH_MULTIPLE_QDN_RESOURCES': {
        try {
          const res = await publishMultipleQDNResources(
            request.payload,
            event.source,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'VOTE_ON_POLL': {
        try {
          const res = await voteOnPoll(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'CREATE_POLL': {
        try {
          const res = await createPoll(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'SEND_CHAT_MESSAGE': {
        try {
          const res = await sendChatMessage(
            request.payload,
            isFromExtension,
            appInfo
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'JOIN_GROUP': {
        try {
          const res = await joinGroup(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'DEPLOY_AT': {
        try {
          const res = await deployAt(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_USER_WALLET': {
        try {
          const res = await getUserWallet(
            request.payload,
            isFromExtension,
            appInfo
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_WALLET_BALANCE': {
        try {
          const res = await getWalletBalance(
            request.payload,
            false,
            isFromExtension,
            appInfo
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_USER_WALLET_TRANSACTIONS': {
        try {
          const res = await getUserWalletTransactions(
            request.payload,
            isFromExtension,
            appInfo
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_USER_WALLET_INFO': {
        try {
          const res = await getUserWalletInfo(
            request.payload,
            isFromExtension,
            appInfo
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_CROSSCHAIN_SERVER_INFO': {
        try {
          const res = await getCrossChainServerInfo(request.payload);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_TX_ACTIVITY_SUMMARY': {
        try {
          const res = await getTxActivitySummary(request.payload);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_FOREIGN_FEE': {
        try {
          const res = await getForeignFee(request.payload);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'UPDATE_FOREIGN_FEE': {
        try {
          const res = await updateForeignFee(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_SERVER_CONNECTION_HISTORY': {
        try {
          const res = await getServerConnectionHistory(request.payload);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'SET_CURRENT_FOREIGN_SERVER': {
        try {
          const res = await setCurrentForeignServer(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'ADD_FOREIGN_SERVER': {
        try {
          const res = await addForeignServer(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'REMOVE_FOREIGN_SERVER': {
        try {
          const res = await removeForeignServer(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_DAY_SUMMARY': {
        try {
          const res = await getDaySummary(request.payload);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_NODE_INFO': {
        try {
          const res = await getNodeInfo(request.payload);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_NODE_STATUS': {
        try {
          const res = await getNodeStatus(request.payload);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'SEND_COIN': {
        try {
          const res = await sendCoin(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'CREATE_TRADE_BUY_ORDER': {
        try {
          const res = await createBuyOrder(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'CREATE_TRADE_SELL_ORDER': {
        try {
          const res = await createSellOrder(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'CANCEL_TRADE_SELL_ORDER': {
        try {
          const res = await cancelSellOrder(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'IS_USING_PUBLIC_NODE': {
        try {
          let isGateway = await isRunningGateway();
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: isGateway,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'ADMIN_ACTION': {
        try {
          const res = await adminAction(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'SIGN_TRANSACTION': {
        try {
          const res = await signTransaction(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'OPEN_NEW_TAB': {
        try {
          const res = await openNewTab(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'CREATE_AND_COPY_EMBED_LINK': {
        try {
          const res = await createAndCopyEmbedLink(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'ENCRYPT_DATA_WITH_SHARING_KEY': {
        try {
          const res = await encryptDataWithSharingKey(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'DECRYPT_DATA_WITH_SHARING_KEY': {
        try {
          const res = await decryptDataWithSharingKey(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'DELETE_HOSTED_DATA': {
        try {
          const res = await deleteHostedData(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_HOSTED_DATA': {
        try {
          const res = await getHostedData(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'SHOW_ACTIONS': {
        try {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: listOfAllQortalRequests,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'REGISTER_NAME': {
        try {
          const res = await registerNameRequest(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'UPDATE_NAME': {
        try {
          const res = await updateNameRequest(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'LEAVE_GROUP': {
        try {
          const res = await leaveGroupRequest(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'INVITE_TO_GROUP': {
        try {
          const res = await inviteToGroupRequest(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'KICK_FROM_GROUP': {
        try {
          const res = await kickFromGroupRequest(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'BAN_FROM_GROUP': {
        try {
          const res = await banFromGroupRequest(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'CANCEL_GROUP_BAN': {
        try {
          const res = await cancelGroupBanRequest(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'ADD_GROUP_ADMIN': {
        try {
          const res = await addGroupAdminRequest(
            request.payload,
            isFromExtension
          );

          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'DECRYPT_AESGCM': {
        try {
          const res = await decryptAESGCMRequest(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'REMOVE_GROUP_ADMIN': {
        try {
          const res = await removeGroupAdminRequest(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'CANCEL_GROUP_INVITE': {
        try {
          const res = await cancelGroupInviteRequest(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'CREATE_GROUP': {
        try {
          const res = await createGroupRequest(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'UPDATE_GROUP': {
        try {
          const res = await updateGroupRequest(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_ARRR_SYNC_STATUS': {
        try {
          const res = await getArrrSyncStatus(request.payload);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'SHOW_PDF_READER': {
        try {
          if (!request.payload?.blob) {
            throw new Error('Missing blob');
          }
          if (request.payload?.blob?.type !== 'application/pdf')
            throw new Error('blob type must be application/pdf');
          executeEvent('openPdf', { blob: request.payload?.blob });
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: true,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA': {
        try {
          const res = await multiPaymentWithPrivateData(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'TRANSFER_ASSET': {
        try {
          const res = await transferAssetRequest(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error?.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'BUY_NAME': {
        try {
          const res = await buyNameRequest(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'SELL_NAME': {
        try {
          const res = await sellNameRequest(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'CANCEL_SELL_NAME': {
        try {
          const res = await cancelSellNameRequest(
            request.payload,
            isFromExtension
          );
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'SIGN_FOREIGN_FEES': {
        try {
          const res = await signForeignFees(request.payload, isFromExtension);
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: res,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      case 'GET_PRIMARY_NAME': {
        try {
          const res = await getNameInfoForOthers(request.payload?.address);
          const resData = res ? res : '';
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              payload: resData,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        } catch (error) {
          event.source.postMessage(
            {
              requestId: request.requestId,
              action: request.action,
              error: error.message,
              type: 'backgroundMessageResponse',
            },
            event.origin
          );
        }
        break;
      }

      default:
        break;
    }
  });
}

// Initialize the message listener
setupMessageListenerQortalRequest();
