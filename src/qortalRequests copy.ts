import { addForeignServer, addListItems, createPoll, decryptData, deleteListItems, deployAt, encryptData, getCrossChainServerInfo, getDaySummary, getForeignFee, getListItems, getServerConnectionHistory, getTxActivitySummary, getUserAccount, getUserWallet, getUserWalletInfo, getWalletBalance, joinGroup, publishMultipleQDNResources, publishQDNResource, removeForeignServer, saveFile, sendChatMessage, sendCoin, setCurrentForeignServer, updateForeignFee, voteOnPoll } from "./qortalRequests/get";



// Promisify chrome.storage.local.get
function getLocalStorage(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([key], function (result) {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(result[key]);
      });
    });
  }
  
  // Promisify chrome.storage.local.set
  function setLocalStorage(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, function () {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  
  export async function setPermission(key, value) {
    try {
      // Get the existing qortalRequestPermissions object
      const qortalRequestPermissions = (await getLocalStorage('qortalRequestPermissions')) || {};
      
      // Update the permission
      qortalRequestPermissions[key] = value;
      
      // Save the updated object back to storage
      await setLocalStorage({ qortalRequestPermissions });
      
    } catch (error) {
      console.error('Error setting permission:', error);
    }
  }

  export async function getPermission(key) {
    try {
      // Get the qortalRequestPermissions object from storage
      const qortalRequestPermissions = (await getLocalStorage('qortalRequestPermissions')) || {};
      
      // Return the value for the given key, or null if it doesn't exist
      return qortalRequestPermissions[key] || null;
    } catch (error) {
      console.error('Error getting permission:', error);
      return null;
    }
  }


  // TODO: GET_FRIENDS_LIST
  // NOT SURE IF TO IMPLEMENT: LINK_TO_QDN_RESOURCE, QDN_RESOURCE_DISPLAYED, SET_TAB_NOTIFICATIONS
  
chrome?.runtime?.onMessage.addListener((request, sender, sendResponse) => {
  if (request) {
    const isFromExtension = request?.isExtension
    switch (request.action) {
      case "GET_USER_ACCOUNT": {
        getUserAccount()
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: "Unable to get user account" });
          });

        break;
      }
      case "ENCRYPT_DATA": {
        const data = request.payload;
        
        encryptData(data, sender)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "DECRYPT_DATA": {
        const data = request.payload;
        
        decryptData(data)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "GET_LIST_ITEMS": {
        const data = request.payload;
        
        getListItems(data, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "ADD_LIST_ITEMS": {
        const data = request.payload;
        
        addListItems(data, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "DELETE_LIST_ITEM": {
        const data = request.payload;
        
        deleteListItems(data, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "PUBLISH_QDN_RESOURCE": {
        const data = request.payload;
        
        publishQDNResource(data, sender, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "PUBLISH_MULTIPLE_QDN_RESOURCES": {
        const data = request.payload;
        
        publishMultipleQDNResources(data, sender, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "VOTE_ON_POLL": {
        const data = request.payload;
        
        voteOnPoll(data, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "CREATE_POLL": {
        const data = request.payload;
        
        createPoll(data, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "SEND_CHAT_MESSAGE": {
        const data = request.payload;
        sendChatMessage(data, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "JOIN_GROUP": {
        const data = request.payload;
      
        joinGroup(data, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "SAVE_FILE": {
        const data = request.payload;
      
        saveFile(data, sender, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "DEPLOY_AT": {
        const data = request.payload;
      
        deployAt(data, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "GET_USER_WALLET": {
        const data = request.payload;
      
        getUserWallet(data, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "GET_WALLET_BALANCE": {
        const data = request.payload;
      
        getWalletBalance(data, false, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }

      case "GET_USER_WALLET_INFO": {
        const data = request.payload;
      
        getUserWalletInfo(data, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "GET_CROSSCHAIN_SERVER_INFO": {
        const data = request.payload;
      
        getCrossChainServerInfo(data)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
      case "GET_TX_ACTIVITY_SUMMARY": {
        const data = request.payload;
    
        getTxActivitySummary(data)
            .then((res) => {
                sendResponse(res);
            })
            .catch((error) => {
                sendResponse({ error: error.message });
            });
    
        break;
    }
    
    case "GET_FOREIGN_FEE": {
        const data = request.payload;
    
        getForeignFee(data)
            .then((res) => {
                sendResponse(res);
            })
            .catch((error) => {
                sendResponse({ error: error.message });
            });
    
        break;
    }
    
    case "UPDATE_FOREIGN_FEE": {
        const data = request.payload;
    
        updateForeignFee(data)
            .then((res) => {
                sendResponse(res);
            })
            .catch((error) => {
                sendResponse({ error: error.message });
            });
    
        break;
    }
    
    case "GET_SERVER_CONNECTION_HISTORY": {
        const data = request.payload;
    
        getServerConnectionHistory(data)
            .then((res) => {
                sendResponse(res);
            })
            .catch((error) => {
                sendResponse({ error: error.message });
            });
    
        break;
    }
    
    case "SET_CURRENT_FOREIGN_SERVER": {
        const data = request.payload;
    
        setCurrentForeignServer(data)
            .then((res) => {
                sendResponse(res);
            })
            .catch((error) => {
                sendResponse({ error: error.message });
            });
    
        break;
    }
    
    case "ADD_FOREIGN_SERVER": {
        const data = request.payload;
    
        addForeignServer(data)
            .then((res) => {
                sendResponse(res);
            })
            .catch((error) => {
                sendResponse({ error: error.message });
            });
    
        break;
    }
    
    case "REMOVE_FOREIGN_SERVER": {
        const data = request.payload;
    
        removeForeignServer(data)
            .then((res) => {
                sendResponse(res);
            })
            .catch((error) => {
                sendResponse({ error: error.message });
            });
    
        break;
    }
    
    case "GET_DAY_SUMMARY": {
        const data = request.payload;
    
        getDaySummary(data)
            .then((res) => {
                sendResponse(res);
            })
            .catch((error) => {
                sendResponse({ error: error.message });
            });
    
        break;
    }
    
      case "SEND_COIN": {
        const data = request.payload;
      
        sendCoin(data, isFromExtension)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      }
    }
  }
  return true;
});
