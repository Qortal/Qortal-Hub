import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { executeEvent } from '../../utils/events';
import { useSetRecoilState } from 'recoil';
import { navigationControllerAtom } from '../../atoms/global';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { saveFile } from '../../qortalRequests/get';
import { mimeToExtensionMap } from '../../utils/memeTypes';
import { MyContext } from '../../App';
import FileSaver from 'file-saver';




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
      const base64data = reader.result?.toString().split(",")[1];
      resolve(base64data || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

class Semaphore {
	constructor(count) {
		this.count = count
		this.waiting = []
	}
	acquire() {
		return new Promise(resolve => {
			if (this.count > 0) {
				this.count--
				resolve()
			} else {
				this.waiting.push(resolve)
			}
		})
	}
	release() {
		if (this.waiting.length > 0) {
			const resolve = this.waiting.shift()
			resolve()
		} else {
			this.count++
		}
	}
}
let semaphore = new Semaphore(1)
let reader = new FileReader()

const fileToBase64 = (file) => new Promise(async (resolve, reject) => {
	if (!reader) {
		reader = new FileReader()
	}
	await semaphore.acquire()
	reader.readAsDataURL(file)
	reader.onload = () => {
		const dataUrl = reader.result
		if (typeof dataUrl === "string") {
			const base64String = dataUrl.split(',')[1]
			reader.onload = null
			reader.onerror = null
			resolve(base64String)
		} else {
			reader.onload = null
			reader.onerror = null
			reject(new Error('Invalid data URL'))
		}
		semaphore.release()
	}
	reader.onerror = (error) => {
		reader.onload = null
		reader.onerror = null
		reject(error)
		semaphore.release()
	}
})

export function openIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("fileStorageDB", 1);
  
      request.onupgradeneeded = function (event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("files")) {
          db.createObjectStore("files", { keyPath: "id" });
        }
      };
  
      request.onsuccess = function (event) {
        resolve(event.target.result);
      };
  
      request.onerror = function () {
        reject("Error opening IndexedDB");
      };
    });
  }



const UIQortalRequests = [
  'GET_USER_ACCOUNT', 'DECRYPT_DATA', 'SEND_COIN', 'GET_LIST_ITEMS',
  'ADD_LIST_ITEMS', 'DELETE_LIST_ITEM', 'VOTE_ON_POLL', 'CREATE_POLL',
  'SEND_CHAT_MESSAGE', 'JOIN_GROUP', 'DEPLOY_AT', 'GET_USER_WALLET',
  'GET_WALLET_BALANCE', 'GET_USER_WALLET_INFO', 'GET_CROSSCHAIN_SERVER_INFO',
  'GET_TX_ACTIVITY_SUMMARY', 'GET_FOREIGN_FEE', 'UPDATE_FOREIGN_FEE',
  'GET_SERVER_CONNECTION_HISTORY', 'SET_CURRENT_FOREIGN_SERVER',
  'ADD_FOREIGN_SERVER', 'REMOVE_FOREIGN_SERVER', 'GET_DAY_SUMMARY', 'CREATE_TRADE_BUY_ORDER', 'CREATE_TRADE_SELL_ORDER', 'CANCEL_TRADE_SELL_ORDER', 'IS_USING_GATEWAY'
];



  
  
  async function retrieveFileFromIndexedDB(fileId) {
    const db = await openIndexedDB();
    const transaction = db.transaction(["files"], "readwrite");
    const objectStore = transaction.objectStore("files");
  
    return new Promise((resolve, reject) => {
      const getRequest = objectStore.get(fileId);
  
      getRequest.onsuccess = function (event) {
        if (getRequest.result) {
          // File found, resolve it and delete from IndexedDB
          const file = getRequest.result.data;
          objectStore.delete(fileId);
          resolve(file);
        } else {
          reject("File not found in IndexedDB");
        }
      };
  
      getRequest.onerror = function () {
        reject("Error retrieving file from IndexedDB");
      };
    });
  }
  
  async function deleteQortalFilesFromIndexedDB() {
    try {
      const db = await openIndexedDB();
      const transaction = db.transaction(["files"], "readwrite");
      const objectStore = transaction.objectStore("files");
  
      // Create a request to get all keys
      const getAllKeysRequest = objectStore.getAllKeys();
  
      getAllKeysRequest.onsuccess = function (event) {
        const keys = event.target.result;
  
        // Iterate through keys to find and delete those containing '_qortalfile'
        for (let key of keys) {
          if (key.includes("_qortalfile")) {
            const deleteRequest = objectStore.delete(key);
  
            deleteRequest.onsuccess = function () {
              console.log(`File with key '${key}' has been deleted from IndexedDB`);
            };
  
            deleteRequest.onerror = function () {
              console.error(`Failed to delete file with key '${key}' from IndexedDB`);
            };
          }
        }
      };
  
      getAllKeysRequest.onerror = function () {
        console.error("Failed to retrieve keys from IndexedDB");
      };
  
      transaction.oncomplete = function () {
        console.log("Transaction complete for deleting files from IndexedDB");
      };
  
      transaction.onerror = function () {
        console.error("Error occurred during transaction for deleting files");
      };
    } catch (error) {
      console.error("Error opening IndexedDB:", error);
    }
  }


  

  export const showSaveFilePicker = async (data, {openSnackGlobal, 
    setOpenSnackGlobal,
    infoSnackCustom,
    setInfoSnackCustom}) => {
 
  
    try {
      const { filename, mimeType, blob, fileHandleOptions } = data;
  
      setInfoSnackCustom({
        type: "info",
        message:
          "Saving file...",
      });
 
     
      setOpenSnackGlobal(true);
      
     
    
      FileSaver.saveAs(blob, filename)
      
     setInfoSnackCustom({
      type: "success",
      message:
        "Saving file success!",
    });

   
    setOpenSnackGlobal(true);
    } catch (error) {
      setInfoSnackCustom({
        type: "error",
        message:
          error?.message ? `Error saving file: ${error?.message}` : 'Error saving file',
      });
  
     
      setOpenSnackGlobal(true);
      console.error("Error saving file:", error);
     
    }
  };

  declare var cordova: any;



  async function storeFilesInIndexedDB(obj) {
    // First delete any existing files in IndexedDB with '_qortalfile' in their ID
    await deleteQortalFilesFromIndexedDB();
  
    // Open the IndexedDB
    const db = await openIndexedDB();
    const transaction = db.transaction(["files"], "readwrite");
    const objectStore = transaction.objectStore("files");
  
    // Handle the obj.file if it exists and is a File instance
    if (obj.file) {
      const fileId = "objFile_qortalfile";
  
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
      const fileId = "objFile_qortalfile";
  
      // Store the file in IndexedDB
      const fileData = {
        id: fileId,
        data: obj.blob,
      };
      objectStore.put(fileData);
  
      // Replace the file object with the file ID in the original object
      let blobObj = {
        type: obj.blob?.type
      }
      obj.fileId = fileId;
      delete obj.blob;
      obj.blob = blobObj
    }
  
    // Iterate through resources to find files and save them to IndexedDB
    for (let resource of (obj?.resources || [])) {
      if (resource.file) {
        const fileId = resource.identifier + "_qortalfile";
  
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
      console.log("Files saved successfully to IndexedDB");
    };
  
    transaction.onerror = function () {
      console.error("Error saving files to IndexedDB");
    };
  
    return obj; // Updated object with references to stored files
  }

export const useQortalMessageListener = (frameWindow, iframeRef, tabId, isDevMode) => {
  const [path, setPath] = useState('')
  const [history, setHistory] = useState({
    customQDNHistoryPaths: [],
currentIndex: -1,
isDOMContentLoaded: false
  })
  const setHasSettingsChangedAtom = useSetRecoilState(navigationControllerAtom);
  const { openSnackGlobal, 
    setOpenSnackGlobal,
    infoSnackCustom,
    setInfoSnackCustom } = useContext(MyContext);

 
  useEffect(()=> {
    if(tabId && !isNaN(history?.currentIndex)){
      setHasSettingsChangedAtom((prev)=> {
        return {
          ...prev,
          [tabId]: {
            hasBack: history?.currentIndex > 0,
          }
        }
      })
    }
  }, [history?.currentIndex, tabId])


  const changeCurrentIndex = useCallback((value)=> {
    setHistory((prev)=> {
      return {
        ...prev,
        currentIndex: value
      }
    })
  }, [])

  const resetHistory = useCallback(()=> {
    setHistory({
      customQDNHistoryPaths: [],
  currentIndex: -1,
  isManualNavigation: true,
  isDOMContentLoaded: false
    })
  }, [])

  useEffect(() => {

    const listener = async (event) => {


      if (event?.data?.requestedHandler !== 'UI') return;

      const sendMessageToRuntime = (message, eventPort) => {
        window.sendMessage(message.action, message.payload, 300000, message.isExtension)
        .then((response) => {
          if (response.error) {
            eventPort.postMessage({
              result: null,
              error: response,
            });
          } else {
            eventPort.postMessage({
              result: response,
              error: null,
            });
          }
        })
        .catch((error) => {
          console.error("Failed qortalRequest", error);
        });
        
      };

      // Check if action is included in the predefined list of UI requests
      if (UIQortalRequests.includes(event.data.action)) {
        sendMessageToRuntime(
          { action: event.data.action, type: 'qortalRequest', payload: event.data, isExtension: true },
          event.ports[0]
        );
      } else if(event?.data?.action === 'SAVE_FILE'
      ){
        try {
          const res = await saveFile( event.data, null, true, {
            openSnackGlobal, 
    setOpenSnackGlobal,
    infoSnackCustom,
    setInfoSnackCustom
          });

        } catch (error) {
          
        }
      } else if (
        event?.data?.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES' ||
        event?.data?.action === 'PUBLISH_QDN_RESOURCE' ||
        event?.data?.action === 'ENCRYPT_DATA' 
        
      ) {
        let data;
        try {
          data = await storeFilesInIndexedDB(event.data);
        } catch (error) {
          console.error('Error storing files in IndexedDB:', error);
          event.ports[0].postMessage({
            result: null,
            error: 'Failed to store files in IndexedDB',
          });
          return;
        }
        if (data) {
          sendMessageToRuntime(
            { action: event.data.action, type: 'qortalRequest', payload: data, isExtension: true },
            event.ports[0]
          );
        } else {
          event.ports[0].postMessage({
            result: null,
            error: 'Failed to prepare data for publishing',
          });
        }
      } else if(event?.data?.action === 'LINK_TO_QDN_RESOURCE' ||
      event?.data?.action === 'QDN_RESOURCE_DISPLAYED'){
        const pathUrl = event?.data?.path != null ? (event?.data?.path.startsWith('/') ? '' : '/') + event?.data?.path : null
        setPath(pathUrl)
      } else if(event?.data?.action === 'NAVIGATION_HISTORY'){
        if(event?.data?.payload?.isDOMContentLoaded){
          setHistory((prev)=> {
            const copyPrev = {...prev}
            if((copyPrev?.customQDNHistoryPaths || []).at(-1) === (event?.data?.payload?.customQDNHistoryPaths || []).at(-1)) {
              return {
                ...prev,
                currentIndex: prev.customQDNHistoryPaths.length - 1 === -1 ? 0 : prev.customQDNHistoryPaths.length - 1
              }
            }
            const copyHistory = {...prev}
            const paths = [...(copyHistory?.customQDNHistoryPaths.slice(0, copyHistory.currentIndex + 1) || []), ...(event?.data?.payload?.customQDNHistoryPaths || [])]
            return {
              ...prev,
              customQDNHistoryPaths: paths,
              currentIndex: paths.length - 1
            }
          })
        } else {
          setHistory(event?.data?.payload)

        }
      }  else  if(event?.data?.action === 'SET_TAB' && !isDevMode){
        executeEvent("addTab", {
          data: event?.data?.payload
        })
        const targetOrigin = iframeRef.current ? new URL(iframeRef.current.src).origin : "*";
        iframeRef.current.contentWindow.postMessage(
          { action: 'SET_TAB_SUCCESS', requestedHandler: 'UI',payload: {
            name: event?.data?.payload?.name
          }  }, targetOrigin
        );
      } 
      

    };

    // Add the listener for messages coming from the frameWindow
    frameWindow.addEventListener('message', listener);

    // Cleanup function to remove the event listener when the component is unmounted
    return () => {
      frameWindow.removeEventListener('message', listener);
    };

    
  }, [isDevMode]); // Empty dependency array to run once when the component mounts



  return {path, history, resetHistory, changeCurrentIndex}
};

