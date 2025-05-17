import { useCallback, useContext, useEffect, useState } from 'react';
import { executeEvent } from '../../utils/events';
import { navigationControllerAtom } from '../../atoms/global';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { saveFile } from '../../qortalRequests/get';
import { mimeToExtensionMap } from '../../utils/memeTypes';
import { MyContext } from '../../App';
import FileSaver from 'file-saver';
import { useSetAtom } from 'jotai';

export const saveFileInChunks = async (
  blob: Blob,
  fileName: string,
  chunkSize = 1024 * 1024
) => {
  try {
    let offset = 0;
    let isFirstChunk = true;

    // Extract the MIME type from the blob
    const mimeType = blob.type || 'application/octet-stream';

    // Create the dynamic base64 prefix
    const base64Prefix = `data:${mimeType};base64,`;

    // Function to extract extension from fileName
    const getExtensionFromFileName = (name: string): string => {
      const lastDotIndex = name.lastIndexOf('.');
      if (lastDotIndex !== -1) {
        return name.substring(lastDotIndex); // includes the dot
      }
      return '';
    };

    // Extract existing extension from fileName
    const existingExtension = getExtensionFromFileName(fileName);

    // Remove existing extension from fileName to avoid duplication
    if (existingExtension) {
      fileName = fileName.substring(0, fileName.lastIndexOf('.'));
    }

    // Map MIME type to file extension
    const mimeTypeToExtension = (mimeType: string): string => {
      return mimeToExtensionMap[mimeType] || existingExtension || ''; // Use existing extension if MIME type not found
    };

    // Determine the final extension to use
    const extension = mimeTypeToExtension(mimeType);

    // Construct the full file name with timestamp and extension
    const fullFileName = `${fileName}_${Date.now()}${extension}`;

    // Read the blob in chunks
    while (offset < blob.size) {
      // Extract the current chunk
      const chunk = blob.slice(offset, offset + chunkSize);

      // Convert the chunk to Base64
      const base64Chunk = await blobToBase64(chunk);

      // Write the chunk to the file with the prefix added on the first chunk
      await Filesystem.writeFile({
        path: fullFileName,
        data: isFirstChunk ? base64Prefix + base64Chunk : base64Chunk,
        directory: Directory.Documents,
        recursive: true,
        append: !isFirstChunk, // Append after the first chunk
      });

      // Update offset and flag
      offset += chunkSize;
      isFirstChunk = false;
    }
  } catch (error) {
    console.error('Error saving file in chunks:', error);
  }
};

// Helper function to convert a Blob to a Base64 string
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result?.toString().split(',')[1];
      resolve(base64data || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

class Semaphore {
  constructor(count) {
    this.count = count;
    this.waiting = [];
  }
  acquire() {
    return new Promise((resolve) => {
      if (this.count > 0) {
        this.count--;
        resolve();
      } else {
        this.waiting.push(resolve);
      }
    });
  }
  release() {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift();
      resolve();
    } else {
      this.count++;
    }
  }
}
let semaphore = new Semaphore(1);
let reader = new FileReader();

const fileToBase64 = (file) =>
  new Promise(async (resolve, reject) => {
    if (!reader) {
      reader = new FileReader();
    }
    await semaphore.acquire();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl === 'string') {
        const base64String = dataUrl.split(',')[1];
        reader.onload = null;
        reader.onerror = null;
        resolve(base64String);
      } else {
        reader.onload = null;
        reader.onerror = null;
        reject(new Error('Invalid data URL'));
      }
      semaphore.release();
    };
    reader.onerror = (error) => {
      reader.onload = null;
      reader.onerror = null;
      reject(error);
      semaphore.release();
    };
  });

export function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fileStorageDB', 1);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
    };

    request.onsuccess = function (event) {
      resolve(event.target.result);
    };

    request.onerror = function () {
      reject('Error opening IndexedDB');
    };
  });
}

export const listOfAllQortalRequests = [
  'GET_USER_ACCOUNT',
  'DECRYPT_DATA',
  'SEND_COIN',
  'GET_LIST_ITEMS',
  'ADD_LIST_ITEMS',
  'DELETE_LIST_ITEM',
  'VOTE_ON_POLL',
  'CREATE_POLL',
  'SEND_CHAT_MESSAGE',
  'JOIN_GROUP',
  'DEPLOY_AT',
  'GET_USER_WALLET',
  'GET_WALLET_BALANCE',
  'GET_USER_WALLET_INFO',
  'GET_CROSSCHAIN_SERVER_INFO',
  'GET_TX_ACTIVITY_SUMMARY',
  'GET_FOREIGN_FEE',
  'UPDATE_FOREIGN_FEE',
  'GET_SERVER_CONNECTION_HISTORY',
  'SET_CURRENT_FOREIGN_SERVER',
  'ADD_FOREIGN_SERVER',
  'REMOVE_FOREIGN_SERVER',
  'GET_DAY_SUMMARY',
  'CREATE_TRADE_BUY_ORDER',
  'CREATE_TRADE_SELL_ORDER',
  'CANCEL_TRADE_SELL_ORDER',
  'IS_USING_PUBLIC_NODE',
  'ADMIN_ACTION',
  'SIGN_TRANSACTION',
  'OPEN_NEW_TAB',
  'CREATE_AND_COPY_EMBED_LINK',
  'DECRYPT_QORTAL_GROUP_DATA',
  'DECRYPT_DATA_WITH_SHARING_KEY',
  'DELETE_HOSTED_DATA',
  'GET_HOSTED_DATA',
  'PUBLISH_MULTIPLE_QDN_RESOURCES',
  'PUBLISH_QDN_RESOURCE',
  'ENCRYPT_DATA',
  'ENCRYPT_DATA_WITH_SHARING_KEY',
  'ENCRYPT_QORTAL_GROUP_DATA',
  'SAVE_FILE',
  'GET_ACCOUNT_DATA',
  'GET_ACCOUNT_NAMES',
  'SEARCH_NAMES',
  'GET_NAME_DATA',
  'GET_QDN_RESOURCE_URL',
  'LINK_TO_QDN_RESOURCE',
  'LIST_QDN_RESOURCES',
  'SEARCH_QDN_RESOURCES',
  'FETCH_QDN_RESOURCE',
  'GET_QDN_RESOURCE_STATUS',
  'GET_QDN_RESOURCE_PROPERTIES',
  'GET_QDN_RESOURCE_METADATA',
  'SEARCH_CHAT_MESSAGES',
  'LIST_GROUPS',
  'GET_BALANCE',
  'GET_AT',
  'GET_AT_DATA',
  'LIST_ATS',
  'FETCH_BLOCK',
  'FETCH_BLOCK_RANGE',
  'SEARCH_TRANSACTIONS',
  'GET_PRICE',
  'SHOW_ACTIONS',
  'REGISTER_NAME',
  'UPDATE_NAME',
  'LEAVE_GROUP',
  'INVITE_TO_GROUP',
  'KICK_FROM_GROUP',
  'BAN_FROM_GROUP',
  'CANCEL_GROUP_BAN',
  'ADD_GROUP_ADMIN',
  'REMOVE_GROUP_ADMIN',
  'DECRYPT_AESGCM',
  'CANCEL_GROUP_INVITE',
  'CREATE_GROUP',
  'GET_USER_WALLET_TRANSACTIONS',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'GET_ARRR_SYNC_STATUS',
  'SHOW_PDF_READER',
  'UPDATE_GROUP',
  'SELL_NAME',
  'CANCEL_SELL_NAME',
  'BUY_NAME',
  'SIGN_FOREIGN_FEES',
  'MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA',
  'TRANSFER_ASSET',
];

export const UIQortalRequests = [
  'GET_USER_ACCOUNT',
  'DECRYPT_DATA',
  'SEND_COIN',
  'GET_LIST_ITEMS',
  'ADD_LIST_ITEMS',
  'DELETE_LIST_ITEM',
  'VOTE_ON_POLL',
  'CREATE_POLL',
  'SEND_CHAT_MESSAGE',
  'JOIN_GROUP',
  'DEPLOY_AT',
  'GET_USER_WALLET',
  'GET_WALLET_BALANCE',
  'GET_USER_WALLET_INFO',
  'GET_CROSSCHAIN_SERVER_INFO',
  'GET_TX_ACTIVITY_SUMMARY',
  'GET_FOREIGN_FEE',
  'UPDATE_FOREIGN_FEE',
  'GET_SERVER_CONNECTION_HISTORY',
  'SET_CURRENT_FOREIGN_SERVER',
  'ADD_FOREIGN_SERVER',
  'REMOVE_FOREIGN_SERVER',
  'GET_DAY_SUMMARY',
  'CREATE_TRADE_BUY_ORDER',
  'CREATE_TRADE_SELL_ORDER',
  'CANCEL_TRADE_SELL_ORDER',
  'IS_USING_PUBLIC_NODE',
  'ADMIN_ACTION',
  'SIGN_TRANSACTION',
  'OPEN_NEW_TAB',
  'CREATE_AND_COPY_EMBED_LINK',
  'DECRYPT_QORTAL_GROUP_DATA',
  'DECRYPT_DATA_WITH_SHARING_KEY',
  'DELETE_HOSTED_DATA',
  'GET_HOSTED_DATA',
  'SHOW_ACTIONS',
  'REGISTER_NAME',
  'UPDATE_NAME',
  'LEAVE_GROUP',
  'INVITE_TO_GROUP',
  'KICK_FROM_GROUP',
  'BAN_FROM_GROUP',
  'CANCEL_GROUP_BAN',
  'ADD_GROUP_ADMIN',
  'REMOVE_GROUP_ADMIN',
  'DECRYPT_AESGCM',
  'CANCEL_GROUP_INVITE',
  'CREATE_GROUP',
  'GET_USER_WALLET_TRANSACTIONS',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'GET_ARRR_SYNC_STATUS',
  'SHOW_PDF_READER',
  'UPDATE_GROUP',
  'SELL_NAME',
  'CANCEL_SELL_NAME',
  'BUY_NAME',
  'SIGN_FOREIGN_FEES',
  'MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA',
  'TRANSFER_ASSET',
];

async function retrieveFileFromIndexedDB(fileId) {
  const db = await openIndexedDB();
  const transaction = db.transaction(['files'], 'readwrite');
  const objectStore = transaction.objectStore('files');

  return new Promise((resolve, reject) => {
    const getRequest = objectStore.get(fileId);

    getRequest.onsuccess = function (event) {
      if (getRequest.result) {
        // File found, resolve it and delete from IndexedDB
        const file = getRequest.result.data;
        objectStore.delete(fileId);
        resolve(file);
      } else {
        reject('File not found in IndexedDB');
      }
    };

    getRequest.onerror = function () {
      reject('Error retrieving file from IndexedDB');
    };
  });
}

async function deleteQortalFilesFromIndexedDB() {
  try {
    const db = await openIndexedDB();
    const transaction = db.transaction(['files'], 'readwrite');
    const objectStore = transaction.objectStore('files');

    // Create a request to get all keys
    const getAllKeysRequest = objectStore.getAllKeys();

    getAllKeysRequest.onsuccess = function (event) {
      const keys = event.target.result;

      // Iterate through keys to find and delete those containing '_qortalfile'
      for (let key of keys) {
        if (key.includes('_qortalfile')) {
          const deleteRequest = objectStore.delete(key);

          deleteRequest.onsuccess = function () {
            console.log(
              `File with key '${key}' has been deleted from IndexedDB`
            );
          };

          deleteRequest.onerror = function () {
            console.error(
              `Failed to delete file with key '${key}' from IndexedDB`
            );
          };
        }
      }
    };

    getAllKeysRequest.onerror = function () {
      console.error('Failed to retrieve keys from IndexedDB');
    };

    transaction.oncomplete = function () {
      console.log('Transaction complete for deleting files from IndexedDB');
    };

    transaction.onerror = function () {
      console.error('Error occurred during transaction for deleting files');
    };
  } catch (error) {
    console.error('Error opening IndexedDB:', error);
  }
}

export const showSaveFilePicker = async (
  data,
  { openSnackGlobal, setOpenSnackGlobal, infoSnackCustom, setInfoSnackCustom }
) => {
  try {
    const { filename, mimeType, blob, fileHandleOptions } = data;

    setInfoSnackCustom({
      type: 'info',
      message: 'Saving file...',
    });

    setOpenSnackGlobal(true);

    FileSaver.saveAs(blob, filename);

    setInfoSnackCustom({
      type: 'success',
      message: 'Saving file success!',
    });

    setOpenSnackGlobal(true);
  } catch (error) {
    setInfoSnackCustom({
      type: 'error',
      message: error?.message
        ? `Error saving file: ${error?.message}`
        : 'Error saving file',
    });

    setOpenSnackGlobal(true);
    console.error('Error saving file:', error);
  }
};

declare var cordova: any;

async function storeFilesInIndexedDB(obj) {
  // First delete any existing files in IndexedDB with '_qortalfile' in their ID
  await deleteQortalFilesFromIndexedDB();

  // Open the IndexedDB
  const db = await openIndexedDB();
  const transaction = db.transaction(['files'], 'readwrite');
  const objectStore = transaction.objectStore('files');

  // Handle the obj.file if it exists and is a File instance
  if (obj.file) {
    const fileId = Date.now() + 'objFile_qortalfile';

    // Store the file in IndexedDB
    const fileData = {
      id: fileId,
      data: obj.file,
    };
    objectStore.put(fileData);

    // Replace the file object with the file ID in the original object
    obj.fileId = fileId;
    delete obj.file;
  }
  if (obj.blob) {
    const fileId = Date.now() + 'objFile_qortalfile';

    // Store the file in IndexedDB
    const fileData = {
      id: fileId,
      data: obj.blob,
    };
    objectStore.put(fileData);

    // Replace the file object with the file ID in the original object
    let blobObj = {
      type: obj.blob?.type,
    };
    obj.fileId = fileId;
    delete obj.blob;
    obj.blob = blobObj;
  }

  // Iterate through resources to find files and save them to IndexedDB
  for (let resource of obj?.resources || []) {
    if (resource.file) {
      const fileId = resource.identifier + Date.now() + '_qortalfile';

      // Store the file in IndexedDB
      const fileData = {
        id: fileId,
        data: resource.file,
      };
      objectStore.put(fileData);

      // Replace the file object with the file ID in the original object
      resource.fileId = fileId;
      delete resource.file;
    }
  }

  // Set transaction completion handlers
  transaction.oncomplete = function () {
    console.log('Files saved successfully to IndexedDB');
  };

  transaction.onerror = function () {
    console.error('Error saving files to IndexedDB');
  };

  return obj; // Updated object with references to stored files
}

export const useQortalMessageListener = (
  frameWindow,
  iframeRef,
  tabId,
  isDevMode,
  appName,
  appService,
  skipAuth
) => {
  const [path, setPath] = useState('');
  const [history, setHistory] = useState({
    customQDNHistoryPaths: [],
    currentIndex: -1,
    isDOMContentLoaded: false,
  });
  const setHasSettingsChangedAtom = useSetAtom(navigationControllerAtom);

  const {
    openSnackGlobal,
    setOpenSnackGlobal,
    infoSnackCustom,
    setInfoSnackCustom,
  } = useContext(MyContext);

  useEffect(() => {
    if (tabId && !isNaN(history?.currentIndex)) {
      setHasSettingsChangedAtom((prev) => {
        return {
          ...prev,
          [tabId]: {
            hasBack: history?.currentIndex > 0,
          },
        };
      });
    }
  }, [history?.currentIndex, tabId]);

  const changeCurrentIndex = useCallback((value) => {
    setHistory((prev) => {
      return {
        ...prev,
        currentIndex: value,
      };
    });
  }, []);

  const resetHistory = useCallback(() => {
    setHistory({
      customQDNHistoryPaths: [],
      currentIndex: -1,
      isManualNavigation: true,
      isDOMContentLoaded: false,
    });
  }, []);

  useEffect(() => {
    const listener = async (event) => {
      if (event?.data?.requestedHandler !== 'UI') return;

      const sendMessageToRuntime = (message, eventPort) => {
        window
          .sendMessage(
            message.action,
            message.payload,
            300000,
            message.isExtension,
            {
              name: appName,
              service: appService,
            },
            skipAuth
          )
          .then((response) => {
            if (response.error) {
              eventPort.postMessage({
                result: null,
                error: {
                  error: response?.error,
                  message:
                    typeof response?.error === 'string'
                      ? response?.error
                      : typeof response?.message === 'string'
                        ? response?.message
                        : 'An error has occurred',
                },
              });
            } else {
              eventPort.postMessage({
                result: response,
                error: null,
              });
            }
          })
          .catch((error) => {
            console.error('Failed qortalRequest', error);
          });
      };

      // Check if action is included in the predefined list of UI requests
      if (UIQortalRequests.includes(event.data.action)) {
        sendMessageToRuntime(
          {
            action: event.data.action,
            type: 'qortalRequest',
            payload: event.data,
            isExtension: true,
          },
          event.ports[0]
        );
      } else if (event?.data?.action === 'SAVE_FILE') {
        try {
          await saveFile(event.data, null, true, {
            openSnackGlobal,
            setOpenSnackGlobal,
            infoSnackCustom,
            setInfoSnackCustom,
          });
          event.ports[0].postMessage({
            result: true,
            error: null,
          });
        } catch (error) {
          event.ports[0].postMessage({
            result: null,
            error: error?.message || 'Failed to save file',
          });
        }
      } else if (
        event?.data?.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES' ||
        event?.data?.action === 'PUBLISH_QDN_RESOURCE' ||
        event?.data?.action === 'ENCRYPT_DATA' ||
        event?.data?.action === 'ENCRYPT_DATA_WITH_SHARING_KEY' ||
        event?.data?.action === 'ENCRYPT_QORTAL_GROUP_DATA'
      ) {
        const data = event.data;

        if (data) {
          sendMessageToRuntime(
            {
              action: event.data.action,
              type: 'qortalRequest',
              payload: data,
              isExtension: true,
            },
            event.ports[0]
          );
        } else {
          event.ports[0].postMessage({
            result: null,
            error: 'Failed to prepare data for publishing',
          });
        }
      } else if (
        event?.data?.action === 'LINK_TO_QDN_RESOURCE' ||
        event?.data?.action === 'QDN_RESOURCE_DISPLAYED'
      ) {
        const pathUrl =
          event?.data?.path != null
            ? (event?.data?.path.startsWith('/') ? '' : '/') + event?.data?.path
            : null;
        setPath(pathUrl);
        if (appName?.toLowerCase() === 'q-mail') {
          window.sendMessage('addEnteredQmailTimestamp').catch((error) => {
            // error
          });
        } else if (appName?.toLowerCase() === 'q-wallets') {
          executeEvent('setLastEnteredTimestampPaymentEvent', {});
        }
      } else if (event?.data?.action === 'NAVIGATION_HISTORY') {
        if (event?.data?.payload?.isDOMContentLoaded) {
          setHistory((prev) => {
            const copyPrev = { ...prev };
            if (
              (copyPrev?.customQDNHistoryPaths || []).at(-1) ===
              (event?.data?.payload?.customQDNHistoryPaths || []).at(-1)
            ) {
              return {
                ...prev,
                currentIndex:
                  prev.customQDNHistoryPaths.length - 1 === -1
                    ? 0
                    : prev.customQDNHistoryPaths.length - 1,
              };
            }
            const copyHistory = { ...prev };
            const paths = [
              ...(copyHistory?.customQDNHistoryPaths.slice(
                0,
                copyHistory.currentIndex + 1
              ) || []),
              ...(event?.data?.payload?.customQDNHistoryPaths || []),
            ];
            return {
              ...prev,
              customQDNHistoryPaths: paths,
              currentIndex: paths.length - 1,
            };
          });
        } else {
          setHistory(event?.data?.payload);
        }
      } else if (event?.data?.action === 'SET_TAB' && !isDevMode) {
        executeEvent('addTab', {
          data: event?.data?.payload,
        });
        const targetOrigin = iframeRef.current
          ? new URL(iframeRef.current.src).origin
          : '*';
        iframeRef.current.contentWindow.postMessage(
          {
            action: 'SET_TAB_SUCCESS',
            requestedHandler: 'UI',
            payload: {
              name: event?.data?.payload?.name,
            },
          },
          targetOrigin
        );
      }
    };

    // Add the listener for messages coming from the frameWindow
    frameWindow.addEventListener('message', listener);

    // Cleanup function to remove the event listener when the component is unmounted
    return () => {
      frameWindow.removeEventListener('message', listener);
    };
  }, [isDevMode, appName, appService]); // Empty dependency array to run once when the component mounts

  return { path, history, resetHistory, changeCurrentIndex };
};
