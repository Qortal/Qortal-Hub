// @ts-nocheck

import './qortalRequests'
import {  isArray } from "lodash";
import {
  decryptGroupEncryption,
  encryptAndPublishSymmetricKeyGroupChat,
  publishGroupEncryptedResource,
  publishOnQDN,
  uint8ArrayToObject,
} from "./backgroundFunctions/encryption";
import { PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY } from "./constants/codes";
import Base58 from "./deps/Base58";
import {
  base64ToUint8Array,
  decryptSingle,
  encryptSingle,
  objectToBase64,
} from "./qdn/encryption/group-encryption";
import { reusableGet } from "./qdn/publish/pubish";
import { signChat } from "./transactions/signChat";
import { createTransaction } from "./transactions/transactions";
import { decryptChatMessage } from "./utils/decryptChatMessage";
import { decryptStoredWallet } from "./utils/decryptWallet";
import PhraseWallet from "./utils/generateWallet/phrase-wallet";
import { RequestQueueWithPromise } from "./utils/queue/queue";
import { validateAddress } from "./utils/validateAddress";
import { Sha256 } from "asmcrypto.js";
import { TradeBotRespondMultipleRequest } from "./transactions/TradeBotRespondMultipleRequest";
import { RESOURCE_TYPE_NUMBER_GROUP_CHAT_REACTIONS } from "./constants/resourceTypes";

export function cleanUrl(url) {
  return url?.replace(/^(https?:\/\/)?(www\.)?/, '');
}
export function getProtocol(url) {
  if (url?.startsWith('https://')) {
    return 'https';
  } else if (url?.startsWith('http://')) {
    return 'http';
  } else {
    return 'unknown'; // If neither protocol is present
  }
}

let lastGroupNotification;
export const groupApi = "https://ext-node.qortal.link";
export const groupApiSocket = "wss://ext-node.qortal.link";
export const groupApiLocal = "http://127.0.0.1:12391";
export const groupApiSocketLocal = "ws://127.0.0.1:12391";
const timeDifferenceForNotificationChatsBackground = 600000;
const requestQueueAnnouncements = new RequestQueueWithPromise(1);
let isMobile = true;


const isMobileDevice = () => {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;

  if (/android/i.test(userAgent)) {
    return true; // Android device
  }

  if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
    return true; // iOS device
  }

  return false;
};

if (isMobileDevice()) {
  isMobile = true;
  console.log("Running on a mobile device");
} else {
  console.log("Running on a desktop");
}
const allQueues = {
  requestQueueAnnouncements: requestQueueAnnouncements,
};

const controlAllQueues = (action) => {
  Object.keys(allQueues).forEach((key) => {
    const val = allQueues[key];
    try {
      if (typeof val[action] === "function") {
        val[action]();
      }
    } catch (error) {
      console.error(error);
    }
  });
};

export const clearAllQueues = () => {
  Object.keys(allQueues).forEach((key) => {
    const val = allQueues[key];
    try {
      val.clear();
    } catch (error) {
      console.error(error);
    }
  });
};

const pauseAllQueues = () => controlAllQueues("pause");
const resumeAllQueues = () => controlAllQueues("resume");
const checkDifference = (createdTimestamp) => {
  return (
    Date.now() - createdTimestamp < timeDifferenceForNotificationChatsBackground
  );
};
const getApiKeyFromStorage = async () => {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get("apiKey", (result) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(result.apiKey || null); // Return null if apiKey isn't found
    });
  });
};

const getCustomNodesFromStorage = async () => {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get("customNodes", (result) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(result.customNodes || null); // Return null if apiKey isn't found
    });
  });
};


const getArbitraryEndpoint = async () => {
  const apiKey = await getApiKeyFromStorage(); // Retrieve apiKey asynchronously
  if (apiKey) {
    return `/arbitrary/resources/searchsimple`;
  } else {
    return `/arbitrary/resources/searchsimple`;
  }
};

export const getBaseApi = async (customApi?: string) => {
  if (customApi) {
    return customApi;
  }

  const apiKey = await getApiKeyFromStorage(); // Retrieve apiKey asynchronously
  if (apiKey) {
    return apiKey?.url;
  } else {
    return groupApi;
  }
};
export const isUsingLocal = async () => {

  const apiKey = await getApiKeyFromStorage(); // Retrieve apiKey asynchronously
  if (apiKey) {
    return true
  } else {
    return false;
  }
};



export const createEndpoint = async (endpoint, customApi?: string) => {
  if (customApi) {
    return `${customApi}${endpoint}`;
  }

  const apiKey = await getApiKeyFromStorage(); // Retrieve apiKey asynchronously

  if (apiKey) {
    // Check if the endpoint already contains a query string
    const separator = endpoint.includes("?") ? "&" : "?";
    return `${apiKey?.url}${endpoint}${separator}apiKey=${apiKey?.apikey}`;
  } else {
    return `${groupApi}${endpoint}`;
  }
};

export const walletVersion = 2;
// List of your API endpoints
const apiEndpoints = [
  "https://api.qortal.org",
  "https://api2.qortal.org",
  "https://appnode.qortal.org",
  "https://apinode.qortalnodes.live",
  "https://apinode1.qortalnodes.live",
  "https://apinode2.qortalnodes.live",
  "https://apinode3.qortalnodes.live",
  "https://apinode4.qortalnodes.live",
];

const buyTradeNodeBaseUrl = "https://appnode.qortal.org";
const proxyAccountAddress = "QXPejUe5Za1KD3zCMViWCX35AreMQ9H7ku";
const proxyAccountPublicKey = "5hP6stDWybojoDw5t8z9D51nV945oMPX7qBd29rhX1G7";
const pendingResponses = new Map();
let groups = null;

let socket;
let timeoutId;
let groupSocketTimeout;
let socketTimeout: any;
let interval;
let intervalThreads;
// Function to check each API endpoint
export async function findUsableApi() {
  for (const endpoint of apiEndpoints) {
    try {
      const response = await fetch(`${endpoint}/admin/status`);
      if (!response.ok) throw new Error("Failed to fetch");

      const data = await response.json();
      if (data.isSynchronizing === false && data.syncPercent === 100) {
        console.log(`Usable API found: ${endpoint}`);
        return endpoint;
      } else {
        console.log(`API not ready: ${endpoint}`);
      }
    } catch (error) {
      console.error(`Error checking API ${endpoint}:`, error);
    }
  }

  throw new Error("No usable API found");
}

export function isExtMsg(data) {
  let isMsgFromExtensionGroup = true;
  try {
    const decode1 = atob(data);
    const decode2 = atob(decode1);
    const keyStr = decode2.slice(0, 10);

    // Convert the key string back to a number
    const highestKey = parseInt(keyStr, 10);
    if (isNaN(highestKey)) {
      isMsgFromExtensionGroup = false;
    }
  } catch (error) {
    isMsgFromExtensionGroup = false;
  }

  return isMsgFromExtensionGroup;
}

export function isUpdateMsg(data) {
  let isUpdateMessage = true;
  try {
    const decode1 = atob(data);
    const decode2 = atob(decode1);
    const keyStr = decode2.slice(10, 13);

    // Convert the key string back to a number
    const numberKey = parseInt(keyStr, 10);
    if (isNaN(numberKey)) {
      isUpdateMessage = false;
    } else if(numberKey !== RESOURCE_TYPE_NUMBER_GROUP_CHAT_REACTIONS){
      isUpdateMessage = false;
    }
  } catch (error) {
    isUpdateMessage = false;
  }

  return isUpdateMessage;
}

async function checkWebviewFocus() {
  return new Promise((resolve) => {
    // Set a timeout for 1 second
    const timeout = setTimeout(() => {
      resolve(false); // No response within 1 second, assume not focused
    }, 1000);

    // Send message to the content script to check focus
    chrome.runtime.sendMessage({ action: "CHECK_FOCUS" }, (response) => {
      clearTimeout(timeout); // Clear the timeout if we get a response

      if (chrome.runtime.lastError) {
        resolve(false); // Error occurred, assume not focused
      } else {
        resolve(response); // Resolve based on the response
      }
    });
  });
}

function playNotificationSound() {
  // chrome.runtime.sendMessage({ action: "PLAY_NOTIFICATION_SOUND" });
}

const handleNotificationDirect = async (directs) => {
  let isFocused;
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  let isDisableNotifications = await getUserSettings({key: 'disable-push-notifications'}) || false
  const dataDirects = directs.filter((direct) => direct?.sender !== address);
  try {
    if(isDisableNotifications) return
    if (!dataDirects || dataDirects?.length === 0) return;
    isFocused = await checkWebviewFocus();

    if (isFocused) {
      throw new Error("isFocused");
    }
    const newActiveChats = dataDirects;
    const oldActiveChats = await getChatHeadsDirect();

    if (newActiveChats?.length === 0) return;

    let newestLatestTimestamp;
    let oldestLatestTimestamp;
    // Find the latest timestamp from newActiveChats
    newActiveChats?.forEach((newChat) => {
      if (
        !newestLatestTimestamp ||
        newChat?.timestamp > newestLatestTimestamp?.timestamp
      ) {
        newestLatestTimestamp = newChat;
      }
    });

    // Find the latest timestamp from oldActiveChats
    oldActiveChats?.forEach((oldChat) => {
      if (
        !oldestLatestTimestamp ||
        oldChat?.timestamp > oldestLatestTimestamp?.timestamp
      ) {
        oldestLatestTimestamp = oldChat;
      }
    });

    if (
      (checkDifference(newestLatestTimestamp.timestamp) &&
        !oldestLatestTimestamp) ||
      (newestLatestTimestamp &&
        newestLatestTimestamp?.timestamp > oldestLatestTimestamp?.timestamp)
    ) {
      const notificationId =
        "chat_notification_" +
        Date.now() +
        "_type=direct" +
        `_from=${newestLatestTimestamp.address}`;
      chrome.notifications.create(notificationId, {
        type: "basic",
        iconUrl: "qort.png", // Add an appropriate icon for chat notifications
        title: `New Direct message! ${
          newestLatestTimestamp?.name && `from ${newestLatestTimestamp.name}`
        }`,
        message: "You have received a new direct message",
        priority: 2, // Use the maximum priority to ensure it's noticeable
        // buttons: [
        //   { title: 'Go to group' }
        // ]
      });
      if (!isMobile) {
        setTimeout(() => {
          chrome.notifications.clear(notificationId);
        }, 7000);
      }

      // chrome.runtime.sendMessage(
      //   {
      //     action: "notification",
      //     payload: {
      //     },
      //   }
      // )
      // audio.play();
      playNotificationSound();
    }
  } catch (error) {
    if (!isFocused) {
      chrome.runtime.sendMessage(
        {
          action: "notification",
          payload: {},
        },
        (response) => {
          if (!response?.error) {
          }
        }
      );
      const notificationId = "chat_notification_" + Date.now();
      chrome.notifications.create(notificationId, {
        type: "basic",
        iconUrl: "qort.png", // Add an appropriate icon for chat notifications
        title: `New Direct message!`,
        message: "You have received a new direct message",
        priority: 2, // Use the maximum priority to ensure it's noticeable
        // buttons: [
        //   { title: 'Go to group' }
        // ]
      });
      if (!isMobile) {
        setTimeout(() => {
          chrome.notifications.clear(notificationId);
        }, 7000);
      }
      playNotificationSound();
      // audio.play();
      // }
    }
  } finally {
    setChatHeadsDirect(dataDirects);
    // chrome.runtime.sendMessage(
    //   {
    //     action: "setChatHeads",
    //     payload: {
    //       data,
    //     },
    //   }
    // );
  }
};
async function getThreadActivity() {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const key = `threadactivity-${address}`;
  const res = await chrome.storage.local.get([key]);
  if (res?.[key]) {
    const parsedData = JSON.parse(res[key]);
    return parsedData;
  } else {
    return null;
  }
}

async function updateThreadActivity({ threadId, qortalName, groupId, thread }) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const ONE_WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000; // One week in milliseconds
  let lastResetTime = 0;
  // Retrieve the last reset timestamp from storage
  const key = `threadactivity-${address}`;

  chrome.storage.local.get([key], (data) => {
    let threads;

    if (!data[key] || Object.keys(data?.[key]?.length === 0)) {
      threads = {
        createdThreads: [],
        mostVisitedThreads: [],
        recentThreads: [],
      };
    } else {
      threads = JSON.parse(data[key]);
    }
    if (threads?.lastResetTime) {
      lastResetTime = threads.lastResetTime;
    }

    const currentTime = Date.now();

    // Check if a week has passed since the last reset
    if (!lastResetTime || currentTime - lastResetTime > ONE_WEEK_IN_MS) {
      // Reset the visit counts for all most visited threads
      threads.mostVisitedThreads.forEach((thread) => (thread.visitCount = 0));
      lastResetTime = currentTime; // Update the last reset time
      threads.lastResetTime = lastResetTime;
    }

    // Update the recent threads list
    threads.recentThreads = threads.recentThreads.filter(
      (t) => t.threadId !== threadId
    );
    threads.recentThreads.unshift({
      threadId,
      qortalName,
      groupId,
      thread,
      visitCount: 1,
      lastVisited: Date.now(),
    });

    // Sort the recent threads by lastVisited time (descending)
    threads.recentThreads.sort((a, b) => b.lastVisited - a.lastVisited);
    // Limit the recent threads list to 2 items
    threads.recentThreads = threads.recentThreads.slice(0, 2);

    // Update the most visited threads list
    const existingThread = threads.mostVisitedThreads.find(
      (t) => t.threadId === threadId
    );
    if (existingThread) {
      existingThread.visitCount += 1;
      existingThread.lastVisited = Date.now(); // Update the last visited time as well
    } else {
      threads.mostVisitedThreads.push({
        threadId,
        qortalName,
        groupId,
        thread,
        visitCount: 1,
        lastVisited: Date.now(),
      });
    }

    // Sort the most visited threads by visitCount (descending)
    threads.mostVisitedThreads.sort((a, b) => b.visitCount - a.visitCount);
    // Limit the most visited threads list to 2 items
    threads.mostVisitedThreads = threads.mostVisitedThreads.slice(0, 2);

    // Store the updated thread information and last reset time
    // chrome.storage.local.set({ threads, lastResetTime });

    const dataString = JSON.stringify(threads);
    chrome.storage.local.set({ [`threadactivity-${address}`]: dataString });
  });
}

const handleNotification = async (groups) => {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  let isDisableNotifications = await getUserSettings({key: 'disable-push-notifications'}) || false

  let mutedGroups = await getUserSettings({key: 'mutedGroups'}) || []
  if(!isArray(mutedGroups)) mutedGroups = []

  let isFocused;
  const data = groups.filter((group) => group?.sender !== address && !mutedGroups.includes(group.groupId) && !isUpdateMsg(group?.data));
  const dataWithUpdates = groups.filter((group) => group?.sender !== address && !mutedGroups.includes(group.groupId));

  try {
    if(isDisableNotifications) return
    if (!data || data?.length === 0) return;
    isFocused = await checkWebviewFocus();

    if (isFocused) {
      throw new Error("isFocused");
    }
    const newActiveChats = data;
    const oldActiveChats = await getChatHeads();

    let results = [];
    let newestLatestTimestamp;
    let oldestLatestTimestamp;
    // Find the latest timestamp from newActiveChats
    newActiveChats?.forEach((newChat) => {
      if (
        !newestLatestTimestamp ||
        newChat?.timestamp > newestLatestTimestamp?.timestamp
      ) {
        newestLatestTimestamp = newChat;
      }
    });

    // Find the latest timestamp from oldActiveChats
    oldActiveChats?.forEach((oldChat) => {
      if (
        !oldestLatestTimestamp ||
        oldChat?.timestamp > oldestLatestTimestamp?.timestamp
      ) {
        oldestLatestTimestamp = oldChat;
      }
    });

    if (
      (checkDifference(newestLatestTimestamp.timestamp) &&
        !oldestLatestTimestamp) ||
      (newestLatestTimestamp &&
        newestLatestTimestamp?.timestamp > oldestLatestTimestamp?.timestamp)
    ) {
      if (
        !lastGroupNotification ||
        Date.now() - lastGroupNotification >= 120000
      ) {
        if (
          !newestLatestTimestamp?.data ||
          !isExtMsg(newestLatestTimestamp?.data)
        )
          return;

        const notificationId =
          "chat_notification_" +
          Date.now() +
          "_type=group" +
          `_from=${newestLatestTimestamp.groupId}`;

        chrome.notifications.create(notificationId, {
          type: "basic",
          iconUrl: "qort.png", // Add an appropriate icon for chat notifications
          title: "New Group Message!",
          message: `You have received a new message from ${newestLatestTimestamp?.groupName}`,
          priority: 2, // Use the maximum priority to ensure it's noticeable
          // buttons: [
          //   { title: 'Go to group' }
          // ]
        });
        if (!isMobile) {
          setTimeout(() => {
            chrome.notifications.clear(notificationId);
          }, 7000);
        }
        // chrome.runtime.sendMessage(
        //   {
        //     action: "notification",
        //     payload: {
        //     },
        //   }
        // )
        // audio.play();
        playNotificationSound();
        lastGroupNotification = Date.now();
      }
    }
  } catch (error) {
    if (!isFocused) {
      chrome.runtime.sendMessage(
        {
          action: "notification",
          payload: {},
        },
        (response) => {
          if (!response?.error) {
          }
        }
      );
      const notificationId = "chat_notification_" + Date.now();
      chrome.notifications.create(notificationId, {
        type: "basic",
        iconUrl: "qort.png", // Add an appropriate icon for chat notifications
        title: "New Group Message!",
        message: "You have received a new message from one of your groups",
        priority: 2, // Use the maximum priority to ensure it's noticeable
        // buttons: [
        //   { title: 'Go to group' }
        // ]
      });
      if (!isMobile) {
        setTimeout(() => {
          chrome.notifications.clear(notificationId);
        }, 7000);
      }
      playNotificationSound();
      // audio.play();
      lastGroupNotification = Date.now();
      // }
    }
  } finally {
    if (!data || data?.length === 0) return;
    setChatHeads(dataWithUpdates);
    // chrome.runtime.sendMessage(
    //   {
    //     action: "setChatHeads",
    //     payload: {
    //       data,
    //     },
    //   }
    // );
  }
};

const checkThreads = async (bringBack) => {
  try {
    let myName = "";
    const userData = await getUserInfo();
    if (userData?.name) {
      myName = userData.name;
    }
    let newAnnouncements = [];
    let dataToBringBack = [];
    const threadActivity = await getThreadActivity();
    if (!threadActivity) return null;

    const selectedThreads = [
      ...threadActivity.createdThreads.slice(0, 2),
      ...threadActivity.mostVisitedThreads.slice(0, 2),
      ...threadActivity.recentThreads.slice(0, 2),
    ];

    if (selectedThreads?.length === 0) return null;
    const tempData = {};
    for (const thread of selectedThreads) {
      try {
        const identifier = `thmsg-${thread?.threadId}`;
        const name = thread?.qortalName;
        const endpoint = await getArbitraryEndpoint();
        const url = await createEndpoint(
          `${endpoint}?mode=ALL&service=DOCUMENT&identifier=${identifier}&limit=1&includemetadata=false&offset=${0}&reverse=true&prefix=true`
        );
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });
        const responseData = await response.json();

        const latestMessage = responseData.filter(
          (pub) => pub?.name !== myName
        )[0];
        // const latestMessage = responseData[0]

        if (!latestMessage) {
          continue;
        }

        if (
          checkDifference(latestMessage.created) &&
          latestMessage.created > thread?.lastVisited &&
          (!thread?.lastNotified || thread?.lastNotified < thread?.created)
        ) {
          tempData[thread.threadId] = latestMessage.created;
          newAnnouncements.push(thread);
        }
        if (latestMessage.created > thread?.lastVisited) {
          dataToBringBack.push(thread);
        }
      } catch (error) {
        conosle.log({ error });
      }
    }

    if (bringBack) {
      return dataToBringBack;
    }

    const updateThreadWithLastNotified = {
      ...threadActivity,
      createdThreads: (threadActivity?.createdThreads || [])?.map((item) => {
        if (tempData[item.threadId]) {
          return {
            ...item,
            lastNotified: tempData[item.threadId],
          };
        } else {
          return item;
        }
      }),
      mostVisitedThreads: (threadActivity?.mostVisitedThreads || [])?.map(
        (item) => {
          if (tempData[item.threadId]) {
            return {
              ...item,
              lastNotified: tempData[item.threadId],
            };
          } else {
            return item;
          }
        }
      ),
      recentThreads: (threadActivity?.recentThreads || [])?.map((item) => {
        if (tempData[item.threadId]) {
          return {
            ...item,
            lastNotified: tempData[item.threadId],
          };
        } else {
          return item;
        }
      }),
    };

    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const dataString = JSON.stringify(updateThreadWithLastNotified);
    chrome.storage.local.set({ [`threadactivity-${address}`]: dataString });

    if (newAnnouncements.length > 0) {
      const notificationId =
        "chat_notification_" +
        Date.now() +
        "_type=thread-post" +
        `_data=${JSON.stringify(newAnnouncements[0])}`;
        let isDisableNotifications = await getUserSettings({key: 'disable-push-notifications'}) || false
      if(!isDisableNotifications){
        chrome.notifications.create(notificationId, {
          type: "basic",
          iconUrl: "qort.png", // Add an appropriate icon for chat notifications
          title: `New thread post!`,
          message: `New post in ${newAnnouncements[0]?.thread?.threadData?.title}`,
          priority: 2, // Use the maximum priority to ensure it's noticeable
          // buttons: [
          //   { title: 'Go to group' }
          // ]
        });
        if (!isMobile) {
          setTimeout(() => {
            chrome.notifications.clear(notificationId);
          }, 7000);
        }
        playNotificationSound();
      }
      
    }
    const savedtimestampAfter = await getTimestampGroupAnnouncement();
    chrome.runtime.sendMessage({
      action: "SET_GROUP_ANNOUNCEMENTS",
      payload: savedtimestampAfter,
    });
  } catch (error) {
  } finally {
  }
};
const checkNewMessages = async () => {
  try {
    let mutedGroups = await getUserSettings({key: 'mutedGroups'}) || []
    if(!isArray(mutedGroups)) mutedGroups = []
    let myName = "";
    const userData = await getUserInfo();
    if (userData?.name) {
      myName = userData.name;
    }

    let newAnnouncements = [];
    const activeData = (await getStoredData("active-groups-directs")) || {
      groups: [],
      directs: [],
    };
    const groups = activeData?.groups;
    if (!groups || groups?.length === 0) return;
    const savedtimestamp = await getTimestampGroupAnnouncement();

    await Promise.all(
      groups.map(async (group) => {
        try {
          const identifier = `grp-${group.groupId}-anc-`;
          const endpoint = await getArbitraryEndpoint();
          const url = await createEndpoint(
            `${endpoint}?mode=ALL&service=DOCUMENT&identifier=${identifier}&limit=1&includemetadata=false&offset=0&reverse=true&prefix=true`
          );
          const response = await requestQueueAnnouncements.enqueue(() => {
            return fetch(url, {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
              },
            });
          });
          const responseData = await response.json();

          const latestMessage = responseData.filter(
            (pub) => pub?.name !== myName
          )[0];
          if (!latestMessage) {
            return; // continue to the next group
          }

          if (
            checkDifference(latestMessage.created) &&
            (!savedtimestamp[group.groupId] ||
              latestMessage.created >
                savedtimestamp?.[group.groupId]?.notification)
          ) {
            newAnnouncements.push(group);
            await addTimestampGroupAnnouncement({
              groupId: group.groupId,
              timestamp: Date.now(),
            });
            // save new timestamp
          }
        } catch (error) {
          console.error(error); // Handle error if needed
        }
      })
    );
    let isDisableNotifications = await getUserSettings({key: 'disable-push-notifications'}) || false

    if (newAnnouncements.length > 0 && !mutedGroups.includes(newAnnouncements[0]?.groupId) && !isDisableNotifications) {
      const notificationId =
        "chat_notification_" +
        Date.now() +
        "_type=group-announcement" +
        `_from=${newAnnouncements[0]?.groupId}`;

      chrome.notifications.create(notificationId, {
        type: "basic",
        iconUrl: "qort.png", // Add an appropriate icon for chat notifications
        title: `New group announcement!`,
        message: `You have received a new announcement from ${newAnnouncements[0]?.groupName}`,
        priority: 2, // Use the maximum priority to ensure it's noticeable
        // buttons: [
        //   { title: 'Go to group' }
        // ]
      });
      if (!isMobile) {
        setTimeout(() => {
          chrome.notifications.clear(notificationId);
        }, 7000);
      }
      playNotificationSound();
    }
    const savedtimestampAfter = await getTimestampGroupAnnouncement();
    chrome.runtime.sendMessage({
      action: "SET_GROUP_ANNOUNCEMENTS",
      payload: savedtimestampAfter,
    });
  } catch (error) {
  } finally {
  }
};

const listenForNewGroupAnnouncements = async () => {
  try {
    setTimeout(() => {
      checkNewMessages();
    }, 500);
    if (interval) {
      clearInterval(interval);
    }

    let isCalling = false;
    interval = setInterval(async () => {
      if (isCalling) return;
      isCalling = true;
      const res = await checkNewMessages();
      isCalling = false;
    }, 180000);
  } catch (error) {}
};
const listenForThreadUpdates = async () => {
  try {
    setTimeout(() => {
      checkThreads();
    }, 500);
    if (intervalThreads) {
      clearInterval(intervalThreads);
    }

    let isCalling = false;
    intervalThreads = setInterval(async () => {
      if (isCalling) return;
      isCalling = true;
      const res = await checkThreads();
      isCalling = false;
    }, 60000);
  } catch (error) {}
};

const forceCloseWebSocket = () => {
  if (socket) {
    clearTimeout(timeoutId);
    clearTimeout(groupSocketTimeout);
    clearTimeout(socketTimeout);
    timeoutId = null;
    groupSocketTimeout = null;
    socket.close(1000, "forced");
    socket = null;
  }
};

async function getNameInfo() {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const validApi = await getBaseApi();
  const response = await fetch(validApi + "/names/address/" + address);
  const nameData = await response.json();
  if (nameData?.length > 0) {
    return nameData[0].name;
  } else {
    return "";
  }
}
async function getAddressInfo(address) {
  const validApi = await getBaseApi();
  const response = await fetch(validApi + "/addresses/" + address);
  const data = await response.json();

  if (!response?.ok && data?.error !== 124)
    throw new Error("Cannot fetch address info");
  if (data?.error === 124) {
    return {
      address,
    };
  }
  return data;
}

export async function getKeyPair() {
  const res = await chrome.storage.local.get(["keyPair"]);
  if (res?.keyPair) {
    return res.keyPair;
  } else {
    throw new Error("Wallet not authenticated");
  }
}

export async function getSaveWallet() {
  const res = await chrome.storage.local.get(["walletInfo"]);
  if (res?.walletInfo) {
    return res.walletInfo;
  } else {
    throw new Error("No wallet saved");
  }
}

async function clearAllNotifications() {
  const notifications = await chrome.notifications.getAll();
  for (const notificationId of Object.keys(notifications)) {
    await chrome.notifications.clear(notificationId);
  }
}

async function getUserInfo() {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const addressInfo = await getAddressInfo(address);
  const name = await getNameInfo();
  return {
    name,
    publicKey: wallet.publicKey,
    ...addressInfo,
  };
}

async function connection(hostname) {
  const isConnected = chrome.storage.local.get([hostname]);
  return isConnected;
}

async function getTradeInfo(qortalAtAddress) {
  const response = await fetch(
    buyTradeNodeBaseUrl + "/crosschain/trade/" + qortalAtAddress
  );
  if (!response?.ok) throw new Error("Cannot crosschain trade information");
  const data = await response.json();
  return data;
}
async function getTradesInfo(qortalAtAddresses) {
  // Use Promise.all to fetch data for all addresses concurrently
  const trades = await Promise.all(
    qortalAtAddresses.map((address) => getTradeInfo(address))
  );
  return trades; // Return the array of trade info objects
}

export async function getBalanceInfo() {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const validApi = await getBaseApi();
  const response = await fetch(validApi + "/addresses/balance/" + address);

  if (!response?.ok) throw new Error("Cannot fetch balance");
  const data = await response.json();
  return data;
}
async function getLTCBalance() {
  const wallet = await getSaveWallet();
  let _url = `${buyTradeNodeBaseUrl}/crosschain/ltc/walletbalance`;
  const keyPair = await getKeyPair();
  const parsedKeyPair = JSON.parse(keyPair);
  let _body = parsedKeyPair.ltcPublicKey;
  const response = await fetch(_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: _body,
  });
  if (response?.ok) {
    const data = await response.text();
    const dataLTCBalance = (Number(data) / 1e8).toFixed(8);
    return +dataLTCBalance;
  } else throw new Error("Onable to get LTC balance");
}

const processTransactionVersion2Chat = async (body: any, customApi) => {
  // const validApi = await findUsableApi();
  const url = await createEndpoint(
    "/transactions/process?apiVersion=2",
    customApi
  );
  return fetch(url, {
    method: "POST",
    headers: {},
    body: Base58.encode(body),
  }).then(async (response) => {
    try {
      const json = await response.clone().json();
      return json;
    } catch (e) {
      return await response.text();
    }
  });
};

export const processTransactionVersion2 = async (body: any) => {
  const url = await createEndpoint(`/transactions/process?apiVersion=2`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", // Ensure the body is correctly parsed
      },
      body, // Convert body to JSON string
    });

    // if (!response.ok) {
    //   // If the response is not successful (status code is not 2xx)
    //   throw new Error(`HTTP error! Status: ${response.status}`);
    // }

    try {
      const json = await response.clone().json();
      return json;
    } catch (jsonError) {
      try {
        const text = await response.text();
        return text;
      } catch (textError) {
        throw new Error(`Failed to parse response as both JSON and text.`);
      }
    }
  } catch (error) {
    console.error("Error processing transaction:", error);
    throw error; // Re-throw the error after logging it
  }
};

const transaction = async (
  { type, params, apiVersion, keyPair }: any,
  validApi
) => {
  const tx = createTransaction(type, keyPair, params);
  let res;

  if (apiVersion && apiVersion === 2) {
    const signedBytes = Base58.encode(tx.signedBytes);
    res = await processTransactionVersion2(signedBytes, validApi);
  }
  let success = true;
  if (res?.error) {
    success = false;
  }

  return {
    success,
    data: res,
  };
};
const makeTransactionRequest = async (
  receiver,
  lastRef,
  amount,
  fee,
  keyPair,
  validApi
) => {
  const myTxnrequest = await transaction(
    {
      nonce: 0,
      type: 2,
      params: {
        recipient: receiver,
        // recipientName: recipientName,
        amount: amount,
        lastReference: lastRef,
        fee: fee,
      },
      apiVersion: 2,
      keyPair,
    },
    validApi
  );
  return myTxnrequest;
};

export const getLastRef = async () => {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const validApi = await getBaseApi();
  const response = await fetch(
    validApi + "/addresses/lastreference/" + address
  );
  if (!response?.ok) throw new Error("Cannot fetch balance");
  const data = await response.text();
  return data;
};
export const sendQortFee = async (): Promise<number> => {
  const validApi = await getBaseApi();
  const response = await fetch(
    validApi + "/transactions/unitfee?txType=PAYMENT"
  );

  if (!response.ok) {
    throw new Error("Error when fetching join fee");
  }

  const data = await response.json();
  const qortFee = (Number(data) / 1e8).toFixed(8);
  return qortFee;
};

async function getNameOrAddress(receiver) {
  try {
    const isAddress = validateAddress(receiver);
    if (isAddress) {
      return receiver;
    }
    const validApi = await getBaseApi();

    const response = await fetch(validApi + "/names/" + receiver);
    const data = await response.json();
    if (data?.owner) return data.owner;
    if (data?.error) {
      throw new Error("Name does not exist");
    }
    if (!response?.ok) throw new Error("Cannot fetch name");
    return { error: "cannot validate address or name" };
  } catch (error) {
    throw new Error(error?.message || "cannot validate address or name");
  }
}

export async function getPublicKey(receiver) {
  try {
    const validApi = await getBaseApi();

    const response = await fetch(validApi + "/addresses/publickey/" + receiver);
    if (!response?.ok) throw new Error("Cannot fetch recipient's public key");

    const data = await response.text();
    if (!data?.error && data !== "false") return data;
    if (data?.error) {
      throw new Error("Cannot fetch recipient's public key");
    }
    throw new Error("Cannot fetch recipient's public key");
  } catch (error) {
    throw new Error(error?.message || "cannot validate address or name");
  }
}

const MAX_STORAGE_SIZE = 3 * 1024 * 1024; // 3MB in bytes

async function getDataPublishes(groupId, type) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;

  return new Promise((resolve) => {
    chrome.storage.local.get([`${address}-publishData`], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error retrieving data:", chrome.runtime.lastError);
        resolve(null); // Return null in case of an error
        return;
      }

      let storedData = result[`${address}-publishData`] || {}; // Get the stored data or initialize an empty object
      let groupData = storedData[groupId] || {}; // Get data by groupId
      let typeData = groupData[type] || {}; // Get data by type

      resolve(typeData); // Resolve with the data inside the specific type
    });
  });
}

async function addDataPublishes(newData, groupId, type) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const nameIdentifier = `${newData.name}-${newData.identifier}`;

  // Prevent adding data larger than 50KB
  if (newData?.size > 50000) return false;

  return new Promise((res) => {
    chrome.storage.local.get([`${address}-publishData`], (result) => {
      let storedData = result[`${address}-publishData`] || {}; // Get existing data or initialize
      let groupData = storedData[groupId] || {}; // Get or initialize group by groupId
      let typeData = groupData[type] || {}; // Get or initialize the type within the group

      let totalSize = 0;

      // Calculate the current size of all stored data
      Object.values(storedData).forEach((group) => {
        Object.values(group).forEach((type) => {
          Object.values(type).forEach((data) => {
            totalSize += data.size; // Accumulate the sizes of actual data
          });
        });
      });

      // Check if adding the new data exceeds 3MB
      if (totalSize + newData.size > MAX_STORAGE_SIZE) {
        // Sort and remove older data within the group and type
        let dataEntries = Object.entries(typeData);
        dataEntries.sort((a, b) => a[1].timestampSaved - b[1].timestampSaved);

        // Remove old data until there's enough space
        while (
          totalSize + newData.size > MAX_STORAGE_SIZE &&
          dataEntries.length > 0
        ) {
          const removedEntry = dataEntries.shift();
          totalSize -= removedEntry[1].size;
          delete typeData[removedEntry[0]]; // Remove from the typeData
        }
      }

      // Add or update the new data within the group and type
      if (totalSize + newData.size <= MAX_STORAGE_SIZE) {
        typeData[`${nameIdentifier}`] = newData; // Add new data under name-identifier
        groupData[type] = typeData; // Update type data within the group
        storedData[groupId] = groupData; // Update group data within the stored data

        // Save the updated structure back to chrome.storage.local
        chrome.storage.local.set(
          { [`${address}-publishData`]: storedData },
          () => {
            res(true); // Data successfully added
          }
        );
      } else {
        console.error("Failed to add data, still exceeds storage limit.");
        res(false); // Failure due to storage limit
      }
    });
  });
}

// Fetch user settings based on the key
async function getUserSettings({ key }) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;

  return new Promise((resolve) => {
    chrome.storage.local.get([`${address}-userSettings`], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error retrieving data:", chrome.runtime.lastError);
        resolve(null); // Return null in case of an error
        return;
      }

      const storedData = result[`${address}-userSettings`] || {}; // Get the stored data or initialize an empty object
      const value = storedData[key] || null; // Get data by key

      resolve(value); // Resolve with the data for the specific key
    });
  });
}

// Add or update user settings
async function addUserSettings({ keyValue }) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const { key, value } = keyValue;

  // No need to check size here, unless value is a large object. For simple settings, size checks aren't necessary.

  return new Promise((res) => {
    chrome.storage.local.get([`${address}-userSettings`], (result) => {
      let storedData = result[`${address}-userSettings`] || {}; // Get existing data or initialize

      storedData[key] = value; // Update the key-value pair within the stored data

      // Save the updated structure back to chrome.storage.local
      chrome.storage.local.set(
        { [`${address}-userSettings`]: storedData },
        () => {
          res(true); // Data successfully added
        }
      );
    });
  });
}

async function decryptWallet({ password, wallet, walletVersion }) {
  try {
    const response = await decryptStoredWallet(password, wallet);
    const wallet2 = new PhraseWallet(response, walletVersion);
    const keyPair = wallet2._addresses[0].keyPair;
    const ltcPrivateKey =
      wallet2._addresses[0].ltcWallet.derivedMasterPrivateKey;
    const ltcPublicKey = wallet2._addresses[0].ltcWallet.derivedMasterPublicKey;
    const ltcAddress = wallet2._addresses[0].ltcWallet.address;
    const toSave = {
      privateKey: Base58.encode(keyPair.privateKey),
      publicKey: Base58.encode(keyPair.publicKey),
      ltcPrivateKey: ltcPrivateKey,
      ltcPublicKey: ltcPublicKey,
      arrrSeed58: wallet2._addresses[0].arrrWallet.seed58,
      btcAddress: wallet2._addresses[0].btcWallet.address,
      btcPublicKey: wallet2._addresses[0].btcWallet.derivedMasterPublicKey,
      btcPrivateKey: wallet2._addresses[0].btcWallet.derivedMasterPrivateKey,

      ltcAddress: wallet2._addresses[0].ltcWallet.address,

      dogeAddress: wallet2._addresses[0].dogeWallet.address,
      dogePublicKey: wallet2._addresses[0].dogeWallet.derivedMasterPublicKey,
      dogePrivateKey: wallet2._addresses[0].dogeWallet.derivedMasterPrivateKey,

      dgbAddress: wallet2._addresses[0].dgbWallet.address,
      dgbPublicKey: wallet2._addresses[0].dgbWallet.derivedMasterPublicKey,
      dgbPrivateKey: wallet2._addresses[0].dgbWallet.derivedMasterPrivateKey,

      rvnAddress: wallet2._addresses[0].rvnWallet.address,
      rvnPublicKey: wallet2._addresses[0].rvnWallet.derivedMasterPublicKey,
      rvnPrivateKey: wallet2._addresses[0].rvnWallet.derivedMasterPrivateKey
    };
    const dataString = JSON.stringify(toSave);
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ keyPair: dataString }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(true);
        }
      });
    });
    const newWallet = {
      ...wallet,
      publicKey: Base58.encode(keyPair.publicKey),
      ltcAddress: ltcAddress,
    };
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ walletInfo: newWallet }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(true);
        }
      });
    });

    return true;
  } catch (error) {
    throw new Error(error.message);
  }
}

export async function signChatFunc(chatBytesArray, chatNonce, customApi, keyPair) {
  let response;
  try {
    const signedChatBytes = signChat(chatBytesArray, chatNonce, keyPair);

    const res = await processTransactionVersion2Chat(
      signedChatBytes,
      customApi
    );
    response = res;
  } catch (e) {
    console.error(e);
    console.error(e.message);
    response = false;
  }
  return response;
}
function sbrk(size, heap) {
  let brk = 512 * 1024; // stack top
  let old = brk;
  brk += size;
  if (brk > heap.length) throw new Error("heap exhausted");
  return old;
}

export const computePow = async ({ chatBytes, path, difficulty }) => {
  let response = null;
  await new Promise((resolve, reject) => {
    const _chatBytesArray = Object.keys(chatBytes).map(function (key) {
      return chatBytes[key];
    });
    const chatBytesArray = new Uint8Array(_chatBytesArray);
    const chatBytesHash = new Sha256().process(chatBytesArray).finish().result;
    const memory = new WebAssembly.Memory({ initial: 256, maximum: 256 });
    const heap = new Uint8Array(memory.buffer);

    const hashPtr = sbrk(32, heap);
    const hashAry = new Uint8Array(memory.buffer, hashPtr, 32);
    hashAry.set(chatBytesHash);
    const workBufferLength = 8 * 1024 * 1024;
    const workBufferPtr = sbrk(workBufferLength, heap);
    const importObject = {
      env: {
        memory: memory,
      },
    };
    function loadWebAssembly(filename, imports) {
      // Fetch the file and compile it
      return fetch(filename)
        .then((response) => response.arrayBuffer())
        .then((buffer) => WebAssembly.compile(buffer))
        .then((module) => {
          // Create the instance.
          return new WebAssembly.Instance(module, importObject);
        });
    }
    loadWebAssembly(path).then((wasmModule) => {
      response = {
        nonce: wasmModule.exports.compute2(
          hashPtr,
          workBufferPtr,
          workBufferLength,
          difficulty
        ),
        chatBytesArray,
      };
      resolve();
    });
  });
  return response;
};

const getStoredData = async (key) => {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(result[key]);
    });
  });
};

async function handleActiveGroupDataFromSocket({ groups, directs }) {
  try {
    chrome.runtime.sendMessage({
      action: "SET_GROUPS",
      payload: groups,
    });
    chrome.runtime.sendMessage({
      action: "SET_DIRECTS",
      payload: directs,
    });
    groups = groups;
    directs = directs;
    const activeData = {
      groups: groups || [], // Your groups data here
      directs: directs || [], // Your directs data here
    };

    // Save the active data to localStorage
    chrome.storage.local.set({ "active-groups-directs": activeData });
    try {
      handleNotification(groups);
      handleNotificationDirect(directs);
    } catch (error) {}
  } catch (error) {}
}

async function sendChat({ qortAddress, recipientPublicKey, message }) {
  let _reference = new Uint8Array(64);
  self.crypto.getRandomValues(_reference);

  let sendTimestamp = Date.now();

  let reference = Base58.encode(_reference);
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };
  const balance = await getBalanceInfo();
  const hasEnoughBalance = +balance < 4 ? false : true;
  const difficulty = 8;
  const jsonData = {
    addresses: message.addresses,
    foreignKey: message.foreignKey,
    receivingAddress: message.receivingAddress,
  };
  const finalJson = {
    callRequest: jsonData,
    extra: "whatever additional data goes here",
  };
  const messageStringified = JSON.stringify(finalJson);

  const tx = await createTransaction(18, keyPair, {
    timestamp: sendTimestamp,
    recipient: qortAddress,
    recipientPublicKey: recipientPublicKey,
    hasChatReference: 0,
    message: messageStringified,
    lastReference: reference,
    proofOfWorkNonce: 0,
    isEncrypted: 1,
    isText: 1,
  });
  if (!hasEnoughBalance) {
    const _encryptedMessage = tx._encryptedMessage;
    const encryptedMessageToBase58 = Base58.encode(_encryptedMessage);
    return {
      encryptedMessageToBase58,
      signature: "id-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      reference,
    };
  }
  const path = chrome.runtime.getURL("memory-pow.wasm.full");

  const { nonce, chatBytesArray } = await computePow({
    chatBytes: tx.chatBytes,
    path,
    difficulty,
  });
  let _response = await signChatFunc(
    chatBytesArray,
    nonce,
    "https://appnode.qortal.org",
    keyPair
  );
  if (_response?.error) {
    throw new Error(_response?.message);
  }
  return _response;
}

async function sendChatGroup({
  groupId,
  typeMessage,
  chatReference,
  messageText,
}) {
  
  let _reference = new Uint8Array(64);
  self.crypto.getRandomValues(_reference);

  let reference = Base58.encode(_reference);
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };
  // const balance = await getBalanceInfo();
  // const hasEnoughBalance = +balance < 4 ? false : true;
  const difficulty = 8;

  const txBody = {
    timestamp: Date.now(),
    groupID: Number(groupId),
    hasReceipient: 0,
    hasChatReference: chatReference ? 1 : 0,
    message: messageText,
    lastReference: reference,
    proofOfWorkNonce: 0,
    isEncrypted: 0, // Set default to not encrypted for groups
    isText: 1,
  }

  if(chatReference){
    txBody['chatReference'] = chatReference
  }

  const tx = await createTransaction(181, keyPair, txBody);

  // if (!hasEnoughBalance) {
  //   throw new Error("Must have at least 4 QORT to send a chat message");
  // }
  const path = chrome.runtime.getURL("memory-pow.wasm.full");

  const { nonce, chatBytesArray } = await computePow({
    chatBytes: tx.chatBytes,
    path,
    difficulty,
  });
  let _response = await signChatFunc(chatBytesArray, nonce, null, keyPair);
  if (_response?.error) {
    throw new Error(_response?.message);
  }
  return _response;
}

async function sendChatDirect({
  address,
  directTo,
  typeMessage,
  chatReference,
  messageText,
  publicKeyOfRecipient,
  otherData
}) {
  let recipientPublicKey;
  let recipientAddress = address;
  if (publicKeyOfRecipient) {
    recipientPublicKey = publicKeyOfRecipient;
  } else {
    recipientAddress = await getNameOrAddress(directTo);
    recipientPublicKey = await getPublicKey(recipientAddress);
  }
  if (!recipientAddress) {
    recipientAddress = await getNameOrAddress(directTo);
  }

  if (!recipientPublicKey) throw new Error("Cannot retrieve publickey");

  let _reference = new Uint8Array(64);
  self.crypto.getRandomValues(_reference);

  let reference = Base58.encode(_reference);
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };
  // const balance = await getBalanceInfo();
  // const hasEnoughBalance = +balance < 4 ? false : true;

  const difficulty = 8;

  const finalJson = {
    message: messageText,
    version: 2,
    ...(otherData || {})
  };
  const messageStringified = JSON.stringify(finalJson);
  
  const txBody = {
    timestamp: Date.now(),
    recipient: recipientAddress,
    recipientPublicKey: recipientPublicKey,
    hasChatReference: chatReference ? 1 : 0,
    message: messageStringified,
    lastReference: reference,
    proofOfWorkNonce: 0,
    isEncrypted: 1,
    isText: 1,
  }
  if(chatReference){
    txBody['chatReference'] = chatReference
  }
  const tx = await createTransaction(18, keyPair, txBody);

  // if (!hasEnoughBalance) {
  //   throw new Error("Must have at least 4 QORT to send a chat message");
  // }
  const path = chrome.runtime.getURL("memory-pow.wasm.full");

  const { nonce, chatBytesArray } = await computePow({
    chatBytes: tx.chatBytes,
    path,
    difficulty,
  });

  let _response = await signChatFunc(chatBytesArray, nonce, null, keyPair);
  if (_response?.error) {
    throw new Error(_response?.message);
  }
  return _response;
}

async function decryptSingleFunc({
  messages,
  secretKeyObject,
  skipDecodeBase64,
}) {
  let holdMessages = [];

  for (const message of messages) {
    try {
      const res = await decryptSingle({
        data64: message.data,
        secretKeyObject,
        skipDecodeBase64,
      });

      const decryptToUnit8Array = base64ToUint8Array(res);
      const responseData = uint8ArrayToObject(decryptToUnit8Array);
      holdMessages.push({ ...message, decryptedData: responseData });
    } catch (error) {}
  }
  return holdMessages;
}
async function decryptSingleForPublishes({
  messages,
  secretKeyObject,
  skipDecodeBase64,
}) {
  let holdMessages = [];

  for (const message of messages) {
    try {
      const res = await decryptSingle({
        data64: message.data,
        secretKeyObject,
        skipDecodeBase64,
      });

      const decryptToUnit8Array = base64ToUint8Array(res);
      const responseData = uint8ArrayToObject(decryptToUnit8Array);
      holdMessages.push({ ...message, decryptedData: responseData });
    } catch (error) {}
  }
  return holdMessages;
}

async function decryptDirectFunc({ messages, involvingAddress }) {
  const senderPublicKey = await getPublicKey(involvingAddress);
  let holdMessages = [];

  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };
  for (const message of messages) {
    try {
      const decodedMessage = decryptChatMessage(
        message.data,
        keyPair.privateKey,
        senderPublicKey,
        message.reference
      );
      const parsedMessage = JSON.parse(decodedMessage);
      holdMessages.push({ ...message, ...parsedMessage });
    } catch (error) {}
  }
  return holdMessages;
}

async function createBuyOrderTx({ crosschainAtInfo, useLocal }) {
  try {
    if(useLocal){
      const wallet = await getSaveWallet();

      const address = wallet.address0;

      const resKeyPair = await getKeyPair();
      const parsedData = JSON.parse(resKeyPair);
      const message = {
        addresses: crosschainAtInfo.map((order)=> order.qortalAtAddress),
        foreignKey: parsedData.ltcPrivateKey,
        receivingAddress: address,
      };
      let responseVar 
      const txn = new TradeBotRespondMultipleRequest().createTransaction(message)
      const apiKey = await getApiKeyFromStorage();
      const responseFetch = await fetch(`${apiKey?.url}/crosschain/tradebot/respondmultiple?apiKey=${apiKey?.apikey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(txn),
  });

  const res = await responseFetch.json();

      if(res === false){
        responseVar = { response: "Unable to execute buy order", success: false };
      } else {
        responseVar = { response: res, success: true };
      }
      const { response, success } = responseVar
      let responseMessage;
      if (success) {
          responseMessage = {
              callResponse: response,
              extra: {
                  message: 'Transaction processed successfully!',
                  atAddresses: crosschainAtInfo.map((order)=> order.qortalAtAddress),
                  
              }
          };
      } else {
          responseMessage = {
              callResponse: 'ERROR',
              extra: {
                  message: response,
                  atAddresses: crosschainAtInfo.map((order)=> order.qortalAtAddress),
               
              }
          };
      }

      setTimeout(() => {
        chrome.tabs.query({}, function (tabs) {
          tabs.forEach((tab) => {
            chrome.tabs.sendMessage(tab.id, {
              type: "RESPONSE_FOR_TRADES",
              message: responseMessage,
            });
          });
        });
      }, 5000);

      return
    }
    const wallet = await getSaveWallet();
    const address = wallet.address0;

    const resKeyPair = await getKeyPair();
    const parsedData = JSON.parse(resKeyPair);
    const message = {
      addresses: crosschainAtInfo.map((order)=> order.qortalAtAddress),
      foreignKey: parsedData.ltcPrivateKey,
      receivingAddress: address,
    };
    const res = await sendChat({
      qortAddress: proxyAccountAddress,
      recipientPublicKey: proxyAccountPublicKey,
      message,
    });
    if (res?.signature) {
      listenForChatMessageForBuyOrder({
        nodeBaseUrl: buyTradeNodeBaseUrl,
        senderAddress: proxyAccountAddress,
        senderPublicKey: proxyAccountPublicKey,
        signature: res?.signature,
      });
      if (res?.encryptedMessageToBase58) {
        return {
          atAddresses: crosschainAtInfo.map((order)=> order.qortalAtAddress),
          encryptedMessageToBase58: res?.encryptedMessageToBase58,
          node: buyTradeNodeBaseUrl,
          qortAddress: address,
          chatSignature: res?.signature,
          senderPublicKey: parsedData.publicKey,
          sender: address,
          reference: res?.reference,
        };
      }
      return {
        atAddresses: crosschainAtInfo.map((order)=> order.qortalAtAddress),
        chatSignature: res?.signature,
        node: buyTradeNodeBaseUrl,
        qortAddress: address,
      };
    } else {
      throw new Error("Unable to send buy order message");
    }
  } catch (error) {
    throw new Error(error.message);
  }
}

async function sendChatNotification(
  res,
  groupId,
  secretKeyObject,
  numberOfMembers
) {
  try {
    const data = await objectToBase64({
      type: "notification",
      subType: "new-group-encryption",
      data: {
        timestamp: res.timestamp,
        name: res.name,
        message: `${res.name} has updated the encryption key`,
        numberOfMembers,
      },
    });

    encryptSingle({
      data64: data,
      secretKeyObject: secretKeyObject,
    })
      .then((res2) => {
        pauseAllQueues();
        sendChatGroup({
          groupId,
          typeMessage: undefined,
          chatReference: undefined,
          messageText: res2,
        })
          .then(() => {})
          .catch((error) => {
            console.error("1", error.message);
          })
          .finally(() => {
            resumeAllQueues();
          });
      })
      .catch((error) => {
        console.error("2", error.message);
      });
  } catch (error) {}
}

export const getFee = async (txType) => {
  const timestamp = Date.now();
  const data = await reusableGet(
    `/transactions/unitfee?txType=${txType}&timestamp=${timestamp}`
  );
  const arbitraryFee = (Number(data) / 1e8).toFixed(8);

  return {
    timestamp,
    fee: arbitraryFee,
  };
};

async function leaveGroup({ groupId }) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const lastReference = await getLastRef();
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };
  const feeres = await getFee("LEAVE_GROUP");

  const tx = await createTransaction(32, keyPair, {
    fee: feeres.fee,
    registrantAddress: address,
    rGroupId: groupId,
    lastReference: lastReference,
  });

  const signedBytes = Base58.encode(tx.signedBytes);

  const res = await processTransactionVersion2(signedBytes);
  if (!res?.signature)
    throw new Error("Transaction was not able to be processed");
  return res;
}

export async function joinGroup({ groupId }) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const lastReference = await getLastRef();
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };
  const feeres = await getFee("JOIN_GROUP");

  const tx = await createTransaction(31, keyPair, {
    fee: feeres.fee,
    registrantAddress: address,
    rGroupId: groupId,
    lastReference: lastReference,
  });

  const signedBytes = Base58.encode(tx.signedBytes);

  const res = await processTransactionVersion2(signedBytes);
  if (!res?.signature)
    throw new Error(res?.message || "Transaction was not able to be processed");
  return res;
}

async function cancelInvitationToGroup({ groupId, qortalAddress }) {
  const lastReference = await getLastRef();
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };
  const feeres = await getFee("CANCEL_GROUP_INVITE");

  const tx = await createTransaction(30, keyPair, {
    fee: feeres.fee,
    recipient: qortalAddress,
    rGroupId: groupId,
    lastReference: lastReference,
  });

  const signedBytes = Base58.encode(tx.signedBytes);

  const res = await processTransactionVersion2(signedBytes);
  if (!res?.signature)
    throw new Error("Transaction was not able to be processed");
  return res;
}

async function cancelBan({ groupId, qortalAddress }) {
  const lastReference = await getLastRef();
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };
  const feeres = await getFee("CANCEL_GROUP_BAN");

  const tx = await createTransaction(27, keyPair, {
    fee: feeres.fee,
    recipient: qortalAddress,
    rGroupId: groupId,
    lastReference: lastReference,
  });

  const signedBytes = Base58.encode(tx.signedBytes);

  const res = await processTransactionVersion2(signedBytes);
  if (!res?.signature)
    throw new Error("Transaction was not able to be processed");
  return res;
}
async function registerName({ name }) {
  const lastReference = await getLastRef();
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };
  const feeres = await getFee("REGISTER_NAME");

  const tx = await createTransaction(3, keyPair, {
    fee: feeres.fee,
    name,
    value: "",
    lastReference: lastReference,
  });

  const signedBytes = Base58.encode(tx.signedBytes);

  const res = await processTransactionVersion2(signedBytes);
  if (!res?.signature)
    throw new Error("Transaction was not able to be processed");
  return res;
}
async function makeAdmin({ groupId, qortalAddress }) {
  const lastReference = await getLastRef();
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };
  const feeres = await getFee("ADD_GROUP_ADMIN");

  const tx = await createTransaction(24, keyPair, {
    fee: feeres.fee,
    recipient: qortalAddress,
    rGroupId: groupId,
    lastReference: lastReference,
  });

  const signedBytes = Base58.encode(tx.signedBytes);

  const res = await processTransactionVersion2(signedBytes);
  if (!res?.signature)
    throw new Error("Transaction was not able to be processed");
  return res;
}

async function removeAdmin({ groupId, qortalAddress }) {
  const lastReference = await getLastRef();
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };
  const feeres = await getFee("REMOVE_GROUP_ADMIN");

  const tx = await createTransaction(25, keyPair, {
    fee: feeres.fee,
    recipient: qortalAddress,
    rGroupId: groupId,
    lastReference: lastReference,
  });

  const signedBytes = Base58.encode(tx.signedBytes);

  const res = await processTransactionVersion2(signedBytes);
  if (!res?.signature)
    throw new Error("Transaction was not able to be processed");
  return res;
}

async function banFromGroup({
  groupId,
  qortalAddress,
  rBanReason = "",
  rBanTime,
}) {
  const lastReference = await getLastRef();
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };
  const feeres = await getFee("GROUP_BAN");

  const tx = await createTransaction(26, keyPair, {
    fee: feeres.fee,
    recipient: qortalAddress,
    rGroupId: groupId,
    rBanReason: rBanReason,
    rBanTime,
    lastReference: lastReference,
  });

  const signedBytes = Base58.encode(tx.signedBytes);

  const res = await processTransactionVersion2(signedBytes);
  if (!res?.signature)
    throw new Error("Transaction was not able to be processed");
  return res;
}

async function kickFromGroup({ groupId, qortalAddress, rBanReason = "" }) {
  const lastReference = await getLastRef();
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };
  const feeres = await getFee("GROUP_KICK");

  const tx = await createTransaction(28, keyPair, {
    fee: feeres.fee,
    recipient: qortalAddress,
    rGroupId: groupId,
    rBanReason: rBanReason,
    lastReference: lastReference,
  });

  const signedBytes = Base58.encode(tx.signedBytes);

  const res = await processTransactionVersion2(signedBytes);
  if (!res?.signature)
    throw new Error("Transaction was not able to be processed");
  return res;
}

async function createGroup({
  groupName,
  groupDescription,
  groupType,
  groupApprovalThreshold,
  minBlock,
  maxBlock,
}) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  if (!address) throw new Error("Cannot find user");
  const lastReference = await getLastRef();
  const feeres = await getFee("CREATE_GROUP");
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };

  const tx = await createTransaction(22, keyPair, {
    fee: feeres.fee,
    registrantAddress: address,
    rGroupName: groupName,
    rGroupDesc: groupDescription,
    rGroupType: groupType,
    rGroupApprovalThreshold: groupApprovalThreshold,
    rGroupMinimumBlockDelay: minBlock,
    rGroupMaximumBlockDelay: maxBlock,
    lastReference: lastReference,
  });

  const signedBytes = Base58.encode(tx.signedBytes);

  const res = await processTransactionVersion2(signedBytes);
  if (!res?.signature)
    throw new Error("Transaction was not able to be processed");
  return res;
}
async function inviteToGroup({ groupId, qortalAddress, inviteTime }) {
  const address = await getNameOrAddress(qortalAddress);
  if (!address) throw new Error("Cannot find user");
  const lastReference = await getLastRef();
  const feeres = await getFee("GROUP_INVITE");
  const resKeyPair = await getKeyPair();
  const parsedData = JSON.parse(resKeyPair);
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8PublicKey = Base58.decode(parsedData.publicKey);
  const keyPair = {
    privateKey: uint8PrivateKey,
    publicKey: uint8PublicKey,
  };

  const tx = await createTransaction(29, keyPair, {
    fee: feeres.fee,
    recipient: address,
    rGroupId: groupId,
    rInviteTime: inviteTime,
    lastReference: lastReference,
  });

  const signedBytes = Base58.encode(tx.signedBytes);

  const res = await processTransactionVersion2(signedBytes);
  if (!res?.signature)
    throw new Error("Transaction was not able to be processed");
  return res;
}

export async function sendCoin({ password, amount, receiver }, skipConfirmPassword) {
  try {
    const confirmReceiver = await getNameOrAddress(receiver);
    if (confirmReceiver.error)
      throw new Error("Invalid receiver address or name");
    const wallet = await getSaveWallet();
    let keyPair = "";
    if (skipConfirmPassword) {
      const resKeyPair = await getKeyPair();
      const parsedData = JSON.parse(resKeyPair);
      const uint8PrivateKey = Base58.decode(parsedData.privateKey);
      const uint8PublicKey = Base58.decode(parsedData.publicKey);
      keyPair = {
        privateKey: uint8PrivateKey,
        publicKey: uint8PublicKey,
      };
    } else {
      const response = await decryptStoredWallet(password, wallet);
      const wallet2 = new PhraseWallet(response, walletVersion);

      keyPair = wallet2._addresses[0].keyPair;
    }

    const lastRef = await getLastRef();
    const fee = await sendQortFee();
    const validApi = await findUsableApi();

    const res = await makeTransactionRequest(
      confirmReceiver,
      lastRef,
      amount,
      fee,
      keyPair,
      validApi
    );

    return { res, validApi };
  } catch (error) {
    throw new Error(error.message);
  }
}

function fetchMessages(apiCall) {
  let retryDelay = 2000; // Start with a 2-second delay
  const maxDuration = 360000 * 2; // Maximum duration set to 12 minutes
  const startTime = Date.now(); // Record the start time

  // Promise to handle polling logic
  return new Promise((resolve, reject) => {
    const attemptFetch = async () => {
      if (Date.now() - startTime > maxDuration) {
        return reject(new Error("Maximum polling time exceeded"));
      }

      try {
        const response = await fetch(apiCall);
        const data = await response.json();
        if (data && data.length > 0) {
          resolve(data[0]); // Resolve the promise when data is found
        } else {
          setTimeout(attemptFetch, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 360000); // Ensure delay does not exceed 6 minutes
        }
      } catch (error) {
        reject(error); // Reject the promise on error
      }
    };

    attemptFetch(); // Initial call to start the polling
  });
}

async function fetchMessagesForBuyOrders(apiCall, signature, senderPublicKey) {
  let retryDelay = 2000; // Start with a 2-second delay
  const maxDuration = 360000 * 2; // Maximum duration set to 12 minutes
  const startTime = Date.now(); // Record the start time
  let triedChatMessage = [];
  // Promise to handle polling logic
  await new Promise((res) => {
    setTimeout(() => {
      res();
    }, 40000);
  });
  return new Promise((resolve, reject) => {
    const attemptFetch = async () => {
      if (Date.now() - startTime > maxDuration) {
        return reject(new Error("Maximum polling time exceeded"));
      }

      try {
        const response = await fetch(apiCall);
        let data = await response.json();

        data = data.filter(
          (item) => !triedChatMessage.includes(item.signature)
        );
        if (data && data.length > 0) {
          const encodedMessageObj = data[0];
          const resKeyPair = await getKeyPair();
          const parsedData = JSON.parse(resKeyPair);
          const uint8PrivateKey = Base58.decode(parsedData.privateKey);
          const uint8PublicKey = Base58.decode(parsedData.publicKey);
          const keyPair = {
            privateKey: uint8PrivateKey,
            publicKey: uint8PublicKey,
          };
          
          const decodedMessage = decryptChatMessage(
            encodedMessageObj.data,
            keyPair.privateKey,
            senderPublicKey,
            encodedMessageObj.reference
          );
          const parsedMessage = JSON.parse(decodedMessage);
          if (parsedMessage?.extra?.chatRequestSignature === signature) {
            resolve(parsedMessage);
          } else {
            triedChatMessage.push(encodedMessageObj.signature);
            setTimeout(attemptFetch, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 360000); // Ensure delay does not exceed 6 minutes
          }
          // Resolve the promise when data is found
        } else {
          setTimeout(attemptFetch, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 360000); // Ensure delay does not exceed 6 minutes
        }
      } catch (error) {
        reject(error); // Reject the promise on error
      }
    };

    attemptFetch(); // Initial call to start the polling
  });
}

async function listenForChatMessage({
  nodeBaseUrl,
  senderAddress,
  senderPublicKey,
  timestamp,
}) {
  try {
    let validApi = "";
    const checkIfNodeBaseUrlIsAcceptable = apiEndpoints.find(
      (item) => item === nodeBaseUrl
    );
    if (checkIfNodeBaseUrlIsAcceptable) {
      validApi = checkIfNodeBaseUrlIsAcceptable;
    } else {
      validApi = await findUsableApi();
    }
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const before = timestamp + 5000;
    const after = timestamp - 5000;
    const apiCall = `${validApi}/chat/messages?involving=${senderAddress}&involving=${address}&reverse=true&limit=1&before=${before}&after=${after}&encoding=BASE64`;
    const encodedMessageObj = await fetchMessages(apiCall);

    const resKeyPair = await getKeyPair();
    const parsedData = JSON.parse(resKeyPair);
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };

    const decodedMessage = decryptChatMessage(
      encodedMessageObj.data,
      keyPair.privateKey,
      senderPublicKey,
      encodedMessageObj.reference
    );
    return { secretCode: decodedMessage };
  } catch (error) {
    console.error(error);
    throw new Error(error.message);
  }
}

async function listenForChatMessageForBuyOrder({
  nodeBaseUrl,
  senderAddress,
  senderPublicKey,
  signature,
}) {
  try {
    let validApi = "";
    const checkIfNodeBaseUrlIsAcceptable = apiEndpoints.find(
      (item) => item === nodeBaseUrl
    );
    if (checkIfNodeBaseUrlIsAcceptable) {
      validApi = checkIfNodeBaseUrlIsAcceptable;
    } else {
      validApi = await findUsableApi();
    }
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const before = Date.now() + 1200000;
    const after = Date.now();
    const apiCall = `${validApi}/chat/messages?involving=${senderAddress}&involving=${address}&reverse=true&limit=1&before=${before}&after=${after}&encoding=BASE64`;
    const parsedMessageObj = await fetchMessagesForBuyOrders(
      apiCall,
      signature,
      senderPublicKey
    );

    chrome.tabs.query({}, function (tabs) {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, {
          type: "RESPONSE_FOR_TRADES",
          message: parsedMessageObj,
        });
      });
    });
  } catch (error) {
    console.error(error);
    throw new Error(error.message);
  }
}

export function removeDuplicateWindow(popupUrl) {
  chrome.windows.getAll(
    { populate: true, windowTypes: ["popup"] },
    (windows) => {
      // Filter to find popups matching the specific URL
      const existingPopupsPending = windows.filter(
        (w) =>
          w.tabs &&
          w.tabs.some(
            (tab) => tab.pendingUrl && tab.pendingUrl.startsWith(popupUrl)
          )
      );
      const existingPopups = windows.filter(
        (w) =>
          w.tabs &&
          w.tabs.some((tab) => tab.url && tab.url.startsWith(popupUrl))
      );

      if (existingPopupsPending.length > 1) {
        chrome.windows.remove(
          existingPopupsPending?.[0]?.tabs?.[0]?.windowId,
          () => {}
        );
      } else if (
        existingPopupsPending.length > 0 &&
        existingPopups.length > 0
      ) {
        chrome.windows.remove(
          existingPopupsPending?.[0]?.tabs?.[0]?.windowId,
          () => {}
        );
      }
    }
  );
}

async function setChatHeads(data) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const dataString = JSON.stringify(data);
  return await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [`chatheads-${address}`]: dataString }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(true);
      }
    });
  });
}

async function checkLocalFunc(){
  const apiKey = await getApiKeyFromStorage()
  return !!apiKey

}

async function getTempPublish() {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const key = `tempPublish-${address}`;
  const res = await chrome.storage.local.get([key]);
  const SIX_MINUTES = 6 * 60 * 1000; // 6 minutes in milliseconds

  if (res?.[key]) {
    const parsedData = JSON.parse(res[key]);
    const currentTime = Date.now();

    // Filter through each top-level key (e.g., "announcement") and then through its nested entries
    const filteredData = Object.fromEntries(
      Object.entries(parsedData).map(([category, entries]) => {
        // Filter out entries inside each category that are older than 6 minutes
        const filteredEntries = Object.fromEntries(
          Object.entries(entries).filter(([entryKey, entryValue]) => {
            return currentTime - entryValue.timestampSaved < SIX_MINUTES;
          })
        );
        return [category, filteredEntries];
      })
    );

    if (JSON.stringify(filteredData) !== JSON.stringify(parsedData)) {
      const dataString = JSON.stringify(filteredData);
      await chrome.storage.local.set({ [key]: dataString });
    }
    return filteredData;
  } else {
    return {};
  }
}

async function saveTempPublish({ data, key }) {
  const existingTemp = await getTempPublish();
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const newTemp = {
    ...existingTemp,
    [key]: {
      ...(existingTemp[key] || {}),
      [data.identifier]: {
        data,
        timestampSaved: Date.now(),
      },
    },
  };

  const dataString = JSON.stringify(newTemp);

  return await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [`tempPublish-${address}`]: dataString }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(newTemp[key]);
      }
    });
  });
}

async function setChatHeadsDirect(data) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const dataString = JSON.stringify(data);
  return await new Promise((resolve, reject) => {
    chrome.storage.local.set(
      { [`chatheads-direct-${address}`]: dataString },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(true);
        }
      }
    );
  });
}

async function getTimestampEnterChat() {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const key = `enter-chat-timestamp-${address}`;
  const res = await chrome.storage.local.get([key]);
  if (res?.[key]) {
    const parsedData = JSON.parse(res[key]);
    return parsedData;
  } else {
    return {};
  }
}
async function getTimestampGroupAnnouncement() {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const key = `group-announcement-${address}`;
  const res = await chrome.storage.local.get([key]);
  if (res?.[key]) {
    const parsedData = JSON.parse(res[key]);
    return parsedData;
  } else {
    return {};
  }
}

async function addTimestampGroupAnnouncement({
  groupId,
  timestamp,
  seenTimestamp,
}) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const data = (await getTimestampGroupAnnouncement()) || {};
  data[groupId] = {
    notification: timestamp,
    seentimestamp: seenTimestamp ? true : false,
  };
  const dataString = JSON.stringify(data);
  return await new Promise((resolve, reject) => {
    chrome.storage.local.set(
      { [`group-announcement-${address}`]: dataString },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(true);
        }
      }
    );
  });
}

async function getGroupData() {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const key = `group-data-${address}`;
  const res = await chrome.storage.local.get([key]);
  if (res?.[key]) {
    const parsedData = JSON.parse(res[key]);
    return parsedData;
  } else {
    return {};
  }
}
async function getGroupDataSingle(groupId) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const key = `group-data-${address}`;
  const res = await chrome.storage.local.get([key]);
  if (res?.[key]) {
    const parsedData = JSON.parse(res[key]);
    return parsedData[groupId] || null;
  } else {
    return null;
  }
}

async function setGroupData({
  groupId,
  secretKeyData,
  secretKeyResource,
  admins,
}) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const data = (await getGroupData()) || {};
  data[groupId] = {
    timestampLastSet: Date.now(),
    admins,
    secretKeyData,
    secretKeyResource,
  };
  const dataString = JSON.stringify(data);
  return await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [`group-data-${address}`]: dataString }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(true);
      }
    });
  });
}

async function addTimestampEnterChat({ groupId, timestamp }) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const data = await getTimestampEnterChat();
  data[groupId] = timestamp;
  const dataString = JSON.stringify(data);
  return await new Promise((resolve, reject) => {
    chrome.storage.local.set(
      { [`enter-chat-timestamp-${address}`]: dataString },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(true);
        }
      }
    );
  });
}

async function notifyAdminRegenerateSecretKey({ groupName, adminAddress }) {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const name = await getNameInfo(address);
  const nameOrAddress = name || address;
  await sendChatDirect({
    directTo: adminAddress,
    typeMessage: undefined,
    chatReference: undefined,
    messageText: `<p>Member ${nameOrAddress} has requested that you regenerate the group's secret key. Group: ${groupName}</p>`,
  });
  return true;
}

async function getChatHeads() {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const key = `chatheads-${address}`;
  const res = await chrome.storage.local.get([key]);
  if (res?.[key]) {
    const parsedData = JSON.parse(res[key]);
    return parsedData;
  } else {
    throw new Error("No Chatheads saved");
  }
}

async function getChatHeadsDirect() {
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const key = `chatheads-direct-${address}`;
  const res = await chrome.storage.local.get([key]);
  if (res?.[key]) {
    const parsedData = JSON.parse(res[key]);
    return parsedData;
  } else {
    throw new Error("No Chatheads saved");
  }
}
chrome?.runtime?.onMessage.addListener((request, sender, sendResponse) => {
  if (request) {


    switch (request.action) {
      case "version":
        // Example: respond with the version
        sendResponse({ version: "1.0" });
        break;
      case "storeWalletInfo":
        chrome.storage.local.set({ walletInfo: request.wallet }, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ result: "Data saved successfully" });
          }
        });
        break;
      case "getWalletInfo":
        getKeyPair()
          .then(() => {
            chrome.storage.local.get(["walletInfo"], (result) => {
              if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
              } else if (result.walletInfo) {
                sendResponse({ walletInfo: result.walletInfo });
              } else {
                sendResponse({ error: "No wallet info found" });
              }
            });
          })
          .catch((error) => {
            sendResponse({ error: error.message });
          });

        break;
      case "validApi":
        findUsableApi()
          .then((usableApi) => {
            console.log("Usable API:", usableApi);
          })
          .catch((error) => {
            console.error(error.message);
          });
      case "name":
        getNameInfo()
          .then((name) => {
            sendResponse(name);
          })
          .catch((error) => {
            console.error(error.message);
          });
        break;
      case "userInfo":
        getUserInfo()
          .then((name) => {
            sendResponse(name);
          })
          .catch((error) => {
            sendResponse({ error: "User not authenticated" });
            console.error(error.message);
          });
        break;
      case "decryptWallet":
        {
          const { password, wallet } = request.payload;

          decryptWallet({
            password,
            wallet,
            walletVersion,
          })
            .then((hasDecrypted) => {
              sendResponse(hasDecrypted);
            })
            .catch((error) => {
              sendResponse({ error: error?.message });
              console.error(error.message);
            });
        }

        break;
      case "balance":
        getBalanceInfo()
          .then((balance) => {
            sendResponse(balance);
          })
          .catch((error) => {
            console.error(error.message);
          });
        break;
      case "ltcBalance":
        {
          getLTCBalance()
            .then((balance) => {
              sendResponse(balance);
            })
            .catch((error) => {
              console.error(error.message);
            });
        }
        break;
      case "sendCoin":
        {
          const { receiver, password, amount } = request.payload;
          sendCoin({ receiver, password, amount })
            .then(({ res }) => {
              if (!res?.success) {
                sendResponse({ error: res?.data?.message });
                return;
              }
              sendResponse(true);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }

        break;
      case "inviteToGroup":
        {
          const { groupId, qortalAddress, inviteTime } = request.payload;
          inviteToGroup({ groupId, qortalAddress, inviteTime })
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }

        break;
      case "saveTempPublish":
        {
          const { data, key } = request.payload;
          saveTempPublish({ data, key })
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
          return true;
        }
        break;
      case "getTempPublish":
        {
          getTempPublish()
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }

        break;

      case "createGroup":
        {
          const {
            groupName,
            groupDescription,
            groupType,
            groupApprovalThreshold,
            minBlock,
            maxBlock,
          } = request.payload;
          createGroup({
            groupName,
            groupDescription,
            groupType,
            groupApprovalThreshold,
            minBlock,
            maxBlock,
          })
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }

        break;
      case "cancelInvitationToGroup":
        {
          const { groupId, qortalAddress } = request.payload;
          cancelInvitationToGroup({ groupId, qortalAddress })
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }

        break;
      case "leaveGroup":
        {
          const { groupId } = request.payload;
          leaveGroup({ groupId })
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }

        break;
      case "joinGroup":
        {
          const { groupId } = request.payload;
          joinGroup({ groupId })
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }

        break;

      case "kickFromGroup":
        {
          const { groupId, qortalAddress, rBanReason } = request.payload;
          kickFromGroup({ groupId, qortalAddress, rBanReason })
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }

        break;
      case "banFromGroup":
        {
          const { groupId, qortalAddress, rBanReason, rBanTime } =
            request.payload;
          banFromGroup({ groupId, qortalAddress, rBanReason, rBanTime })
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }

        break;
      case "addDataPublishes":
        {
          const { data, groupId, type } = request.payload;
          addDataPublishes(data, groupId, type)
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }
        break;
      case "getDataPublishes":
        {
          const { groupId, type } = request.payload;
          getDataPublishes(groupId, type)
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }
        break;
      case "addUserSettings":
        {
          const { keyValue } = request.payload;
          addUserSettings({keyValue})
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }
        break;
      case "getUserSettings":
        {
          const { key } = request.payload;
          getUserSettings({key})
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }
        break;
      case "cancelBan":
        {
          const { groupId, qortalAddress } = request.payload;
          cancelBan({ groupId, qortalAddress })
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }

        break;
      case "registerName":
        {
          const { name } = request.payload;
          registerName({ name })
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }

        break;
      case "makeAdmin":
        {
          const { groupId, qortalAddress } = request.payload;
          makeAdmin({ groupId, qortalAddress })
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }

        break;
      case "removeAdmin":
        {
          const { groupId, qortalAddress } = request.payload;
          removeAdmin({ groupId, qortalAddress })
            .then((res) => {
              sendResponse(res);
            })
            .catch((error) => {
              sendResponse({ error: error.message });
              console.error(error.message);
            });
        }

        break;

      case "oauth": {
        const { nodeBaseUrl, senderAddress, senderPublicKey, timestamp } =
          request.payload;

        listenForChatMessage({
          nodeBaseUrl,
          senderAddress,
          senderPublicKey,
          timestamp,
        })
          .then(({ secretCode }) => {
            sendResponse(secretCode);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
            console.error(error.message);
          });

        break;
      }
      case "setChatHeads": {
        const { data } = request.payload;

        setChatHeads({
          data,
        })
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
            console.error(error.message);
          });

        break;
      }
      case "getChatHeads": {
        getChatHeads()
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
            console.error(error.message);
          });

        break;
      }
      case "notification": {
        const notificationId = "chat_notification_" + Date.now(); // Create a unique ID

        const {} = request.payload;
        chrome.notifications.create(notificationId, {
          type: "basic",
          iconUrl: "qort.png", // Add an appropriate icon for chat notifications
          title: "New Group Message!",
          message: "You have received a new message from one of your groups",
          priority: 2, // Use the maximum priority to ensure it's noticeable
          // buttons: [
          //   { title: 'Go to group' }
          // ]
        });
        // Set a timeout to clear the notification after 'timeout' milliseconds
        setTimeout(() => {
          chrome.notifications.clear(notificationId);
        }, 3000);
        sendResponse(true);
        break;
      }
      case "addTimestampEnterChat": {
        const { groupId, timestamp } = request.payload;
        addTimestampEnterChat({ groupId, timestamp })
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
            console.error(error.message);
          });
        break;
      }

      case "setApiKey": {
        const { payload } = request;

        // Save the apiKey in chrome.storage.local for persistence
        chrome.storage.local.set({ apiKey: payload }, () => {
          sendResponse(true);
        });
        return true;
        break;
      }
      case "setCustomNodes": {
        const { nodes } = request;

        // Save the customNodes in chrome.storage.local for persistence
        chrome.storage.local.set({ customNodes: nodes }, () => {
          sendResponse(true);
        });
        return true;
        break;
      }
      case "getApiKey": {
        getApiKeyFromStorage()
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
            console.error(error.message);
          });
        return true;
        break;
      }
      case "getCustomNodesFromStorage": {
        getCustomNodesFromStorage()
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
            console.error(error.message);
          });
        return true;
        break;
      }
      
      case "notifyAdminRegenerateSecretKey": {
        const { groupName, adminAddress } = request.payload;
        notifyAdminRegenerateSecretKey({ groupName, adminAddress })
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
            console.error(error.message);
          });
        break;
      }

      case "addGroupNotificationTimestamp": {
        const { groupId, timestamp } = request.payload;
        addTimestampGroupAnnouncement({
          groupId,
          timestamp,
          seenTimestamp: true,
        })
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
            console.error(error.message);
          });
        break;
      }
      case "clearAllNotifications": {
        clearAllNotifications()
          .then((res) => {})
          .catch((error) => {});
        break;
      }
      case "setGroupData": {
        const { groupId, secretKeyData, secretKeyResource, admins } =
          request.payload;
        setGroupData({
          groupId,
          secretKeyData,
          secretKeyResource,
          admins,
        })
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
            console.error(error.message);
          });
        break;
      }
      case "getGroupDataSingle": {
        const { groupId } = request.payload;
        getGroupDataSingle(groupId)
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
            console.error(error.message);
          });
        return true;
        break;
      }
      case "getTimestampEnterChat": {
        getTimestampEnterChat()
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
            console.error(error.message);
          });
        break;
      }
      case "getGroupNotificationTimestamp": {
        getTimestampGroupAnnouncement()
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            sendResponse({ error: error.message });
            console.error(error.message);
          });
        break;
      }
      case "authentication":
        {
          getSaveWallet()
            .then(() => {
              sendResponse(true);
            })
            .catch((error) => {
              const popupUrl = chrome.runtime.getURL(
                "index.html?secondary=true"
              );

              chrome.windows.getAll(
                { populate: true, windowTypes: ["popup"] },
                (windows) => {
                  // Attempt to find an existing popup window that has a tab with the correct URL
                  const existingPopup = windows.find(
                    (w) =>
                      w.tabs &&
                      w.tabs.some(
                        (tab) => tab.url && tab.url.startsWith(popupUrl)
                      )
                  );
                  if (existingPopup) {
                    // If the popup exists but is minimized or not focused, focus it
                    chrome.windows.update(existingPopup.id, {
                      focused: true,
                      state: "normal",
                    });
                  } else {
                    // No existing popup found, create a new one
                    chrome.system.display.getInfo((displays) => {
                      // Assuming the primary display is the first one (adjust logic as needed)
                      const primaryDisplay = displays[0];
                      const screenWidth = primaryDisplay.bounds.width;
                      const windowHeight = 500; // Your window height
                      const windowWidth = 400; // Your window width

                      // Calculate left position for the window to appear on the right of the screen
                      const leftPosition = screenWidth - windowWidth;

                      // Calculate top position for the window, adjust as desired
                      const topPosition =
                        (primaryDisplay.bounds.height - windowHeight) / 2;

                      chrome.windows.create(
                        {
                          url: chrome.runtime.getURL(
                            "index.html?secondary=true"
                          ),
                          type: "popup",
                          width: windowWidth,
                          height: windowHeight,
                          left: leftPosition,
                          top: 0,
                        },
                        () => {
                          removeDuplicateWindow(popupUrl);
                        }
                      );
                    });
                  }

                  const interactionId = Date.now().toString(); // Simple example; consider a better unique ID

                  setTimeout(() => {
                    chrome.runtime.sendMessage({
                      action: "SET_COUNTDOWN",
                      payload: request.timeout ? 0.75 * request.timeout : 60,
                    });
                    chrome.runtime.sendMessage({
                      action: "UPDATE_STATE_REQUEST_AUTHENTICATION",
                      payload: {
                        hostname,
                        interactionId,
                      },
                    });
                  }, 500);

                  // Store sendResponse callback with the interaction ID
                  pendingResponses.set(interactionId, sendResponse);
                  let intervalId = null;
                  const startTime = Date.now();
                  const checkInterval = 3000; // Check every 3 seconds
                  const timeout = request.timeout
                    ? 0.75 * (request.timeout * 1000)
                    : 60000; // Stop after 15 seconds

                  const checkFunction = () => {
                    getSaveWallet()
                      .then(() => {
                        clearInterval(intervalId); // Stop checking
                        sendResponse(true); // Perform the success action
                        chrome.runtime.sendMessage({
                          action: "closePopup",
                        });
                      })
                      .catch((error) => {
                        // Handle error if needed
                      });

                    if (Date.now() - startTime > timeout) {
                      sendResponse({
                        error: "User has not authenticated, try again.",
                      });
                      clearInterval(intervalId); // Stop checking due to timeout

                      // Handle timeout situation if needed
                    }
                  };

                  intervalId = setInterval(checkFunction, checkInterval);
                }
              );
            });
        }
        break;
      case "buyOrder":
        {
          const { qortalAtAddresses, hostname, useLocal } = request.payload;
          getTradesInfo(qortalAtAddresses)
            .then((crosschainAtInfo) => {
              const popupUrl = chrome.runtime.getURL(
                "index.html?secondary=true"
              );

              chrome.windows.getAll(
                { populate: true, windowTypes: ["popup"] },
                (windows) => {
                  // Attempt to find an existing popup window that has a tab with the correct URL
                  const existingPopup = windows.find(
                    (w) =>
                      w.tabs &&
                      w.tabs.some(
                        (tab) => tab.url && tab.url.startsWith(popupUrl)
                      )
                  );
                  if (existingPopup) {
                    // If the popup exists but is minimized or not focused, focus it
                    chrome.windows.update(existingPopup.id, {
                      focused: true,
                      state: "normal",
                    });
                  } else {
                    // No existing popup found, create a new one
                    chrome.system.display.getInfo((displays) => {
                      // Assuming the primary display is the first one (adjust logic as needed)
                      const primaryDisplay = displays[0];
                      const screenWidth = primaryDisplay.bounds.width;
                      const windowHeight = 500; // Your window height
                      const windowWidth = 400; // Your window width

                      // Calculate left position for the window to appear on the right of the screen
                      const leftPosition = screenWidth - windowWidth;

                      // Calculate top position for the window, adjust as desired
                      const topPosition =
                        (primaryDisplay.bounds.height - windowHeight) / 2;

                      chrome.windows.create(
                        {
                          url: chrome.runtime.getURL(
                            "index.html?secondary=true"
                          ),
                          type: "popup",
                          width: windowWidth,
                          height: windowHeight,
                          left: leftPosition,
                          top: 0,
                        },
                        () => {
                          removeDuplicateWindow(popupUrl);
                        }
                      );
                    });
                  }

                  const interactionId = Date.now().toString(); // Simple example; consider a better unique ID

                  setTimeout(() => {
                    chrome.runtime.sendMessage({
                      action: "SET_COUNTDOWN",
                      payload: request.timeout ? 0.9 * request.timeout : 20,
                    });
                    chrome.runtime.sendMessage({
                      action: "UPDATE_STATE_REQUEST_BUY_ORDER",
                      payload: {
                        hostname,
                        crosschainAtInfo,
                        interactionId,
                        useLocal
                      },
                    });
                  }, 500);

                  // Store sendResponse callback with the interaction ID
                  pendingResponses.set(interactionId, sendResponse);
                }
              );
            })
            .catch((error) => {
              console.error(error.message);
            });
        }

        break;
      case "connection":
        {
          const { hostname } = request.payload;

          connection(hostname)
            .then((isConnected) => {
              if (
                Object.keys(isConnected)?.length > 0 &&
                isConnected[hostname]
              ) {
                sendResponse(true);
              } else {
                const popupUrl = chrome.runtime.getURL(
                  "index.html?secondary=true"
                );
                chrome.windows.getAll(
                  { populate: true, windowTypes: ["popup"] },
                  (windows) => {
                    // Attempt to find an existing popup window that has a tab with the correct URL
                    const existingPopup = windows.find(
                      (w) =>
                        w.tabs &&
                        w.tabs.some(
                          (tab) => tab.url && tab.url.startsWith(popupUrl)
                        )
                    );

                    if (existingPopup) {
                      // If the popup exists but is minimized or not focused, focus it
                      chrome.windows.update(existingPopup.id, {
                        focused: true,
                        state: "normal",
                      });
                    } else {
                      // No existing popup found, create a new one
                      chrome.system.display.getInfo((displays) => {
                        // Assuming the primary display is the first one (adjust logic as needed)
                        const primaryDisplay = displays[0];
                        const screenWidth = primaryDisplay.bounds.width;
                        const windowHeight = 500; // Your window height
                        const windowWidth = 400; // Your window width

                        // Calculate left position for the window to appear on the right of the screen
                        const leftPosition = screenWidth - windowWidth;

                        // Calculate top position for the window, adjust as desired
                        const topPosition =
                          (primaryDisplay.bounds.height - windowHeight) / 2;

                        chrome.windows.create(
                          {
                            url: popupUrl,
                            type: "popup",
                            width: windowWidth,
                            height: windowHeight,
                            left: leftPosition,
                            top: 0,
                          },
                          () => {
                            removeDuplicateWindow(popupUrl);
                          }
                        );
                      });
                    }

                    const interactionId = Date.now().toString(); // Simple example; consider a better unique ID

                    setTimeout(() => {
                      chrome.runtime.sendMessage({
                        action: "SET_COUNTDOWN",
                        payload: request.timeout ? 0.9 * request.timeout : 20,
                      });
                      chrome.runtime.sendMessage({
                        action: "UPDATE_STATE_REQUEST_CONNECTION",
                        payload: {
                          hostname,
                          interactionId,
                        },
                      });
                    }, 500);

                    // Store sendResponse callback with the interaction ID
                    pendingResponses.set(interactionId, sendResponse);
                  }
                );
              }
            })
            .catch((error) => {
              console.error(error.message);
            });
        }

        break;
      case "sendQort":
        {
          const { amount, hostname, address, description } = request.payload;
          const popupUrl = chrome.runtime.getURL("index.html?secondary=true");

          chrome.windows.getAll(
            { populate: true, windowTypes: ["popup"] },
            (windows) => {
              // Attempt to find an existing popup window that has a tab with the correct URL
              const existingPopup = windows.find(
                (w) =>
                  w.tabs &&
                  w.tabs.some((tab) => tab.url && tab.url.startsWith(popupUrl))
              );
              if (existingPopup) {
                // If the popup exists but is minimized or not focused, focus it
                chrome.windows.update(existingPopup.id, {
                  focused: true,
                  state: "normal",
                });
              } else {
                // No existing popup found, create a new one
                chrome.system.display.getInfo((displays) => {
                  // Assuming the primary display is the first one (adjust logic as needed)
                  const primaryDisplay = displays[0];
                  const screenWidth = primaryDisplay.bounds.width;
                  const windowHeight = 500; // Your window height
                  const windowWidth = 400; // Your window width

                  // Calculate left position for the window to appear on the right of the screen
                  const leftPosition = screenWidth - windowWidth;

                  // Calculate top position for the window, adjust as desired
                  const topPosition =
                    (primaryDisplay.bounds.height - windowHeight) / 2;

                  chrome.windows.create(
                    {
                      url: chrome.runtime.getURL("index.html?secondary=true"),
                      type: "popup",
                      width: windowWidth,
                      height: windowHeight,
                      left: leftPosition,
                      top: 0,
                    },
                    () => {
                      removeDuplicateWindow(popupUrl);
                    }
                  );
                });
              }

              const interactionId = Date.now().toString(); // Simple example; consider a better unique ID

              setTimeout(() => {
                chrome.runtime.sendMessage({
                  action: "SET_COUNTDOWN",
                  payload: (request.timeout ? request.timeout : 60) - 6,
                });
                chrome.runtime.sendMessage({
                  action: "UPDATE_STATE_CONFIRM_SEND_QORT",
                  payload: {
                    amount,
                    address,
                    hostname,
                    description,
                    interactionId,
                  },
                });
              }, 500);

              // Store sendResponse callback with the interaction ID
              pendingResponses.set(interactionId, sendResponse);
            }
          );
        }

        break;
      case "responseToConnectionRequest":
        {
          const { hostname, isOkay } = request.payload;
          const interactionId3 = request.payload.interactionId;
          if (!isOkay) {
            const originalSendResponse = pendingResponses.get(interactionId3);
            if (originalSendResponse) {
              originalSendResponse(false);
              sendResponse(false);
            }
          } else {
            const originalSendResponse = pendingResponses.get(interactionId3);
            if (originalSendResponse) {
              // Example of setting domain permission
              chrome.storage.local.set({ [hostname]: true });

              originalSendResponse(true);
              sendResponse(true);
            }
          }

          pendingResponses.delete(interactionId3);
        }

        break;
      case "sendQortConfirmation":
        const { password, amount, receiver, isDecline } = request.payload;
        const interactionId2 = request.payload.interactionId;
        // Retrieve the stored sendResponse callback
        const originalSendResponse = pendingResponses.get(interactionId2);

        if (originalSendResponse) {
          if (isDecline) {
            originalSendResponse({ error: "User has declined" });
            sendResponse(false);
            pendingResponses.delete(interactionId2);
            return;
          }
          sendCoin({ password, amount, receiver }, true)
            .then((res) => {
              sendResponse(true);
              // Use the sendResponse callback to respond to the original message
              originalSendResponse(res);
              // Remove the callback from the Map as it's no longer needed
              pendingResponses.delete(interactionId2);
            })
            .catch((error) => {
              console.error(error.message);
              sendResponse({ error: error.message });
              originalSendResponse({ error: error.message });
            });
        }

        break;
      case "buyOrderConfirmation":
        {
          const { crosschainAtInfo, isDecline, useLocal } = request.payload;
          const interactionId2 = request.payload.interactionId;
          // Retrieve the stored sendResponse callback
          const originalSendResponse = pendingResponses.get(interactionId2);

          if (originalSendResponse) {
            if (isDecline) {
              originalSendResponse({ error: "User has declined" });
              sendResponse(false);
              pendingResponses.delete(interactionId2);
              return;
            }
            createBuyOrderTx({ crosschainAtInfo, useLocal })
              .then((res) => {
                sendResponse(true);
                originalSendResponse(res);
                pendingResponses.delete(interactionId2);
              })
              .catch((error) => {
                console.error(error.message);
                sendResponse({ error: error.message });
                // originalSendResponse({ error: error.message });
              });
          }
        }

        break;
      case "encryptAndPublishSymmetricKeyGroupChat": {
        const { groupId, previousData, previousNumber } = request.payload;

        encryptAndPublishSymmetricKeyGroupChat({
          groupId,
          previousData,
          previousNumber,
        })
          .then(({ data, numberOfMembers }) => {
            sendResponse(data);

            if (!previousData) {
              // first secret key of the group
              sendChatGroup({
                groupId,
                typeMessage: undefined,
                chatReference: undefined,
                messageText: PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY,
              })
                .then(() => {})
                .catch((error) => {
                  console.error("1", error.message);
                });
              return;
            }
            sendChatNotification(data, groupId, previousData, numberOfMembers);
          })
          .catch((error) => {
            console.error(error.message);
            sendResponse({ error: error.message });
          });

        break;
      }
      case "publishGroupEncryptedResource": {
        const { encryptedData, identifier } = request.payload;

        publishGroupEncryptedResource({
          encryptedData,
          identifier,
        })
          .then((data) => {
            sendResponse(data);
          })
          .catch((error) => {
            console.error(error.message);
            sendResponse({ error: error.message });
          });
        return true;
        break;
      }
      case "publishOnQDN": {
        const { data, identifier, service, title,
          description,
          category,
          tag1,
          tag2,
          tag3,
          tag4,
          tag5, uploadType } = request.payload;

        publishOnQDN({
          data,
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
          uploadType
        })
          .then((data) => {
            sendResponse(data);
          })
          .catch((error) => {
            console.error(error?.message);
            sendResponse({ error: error?.message || 'Unable to publish' });
          });
        return true;
        break;
      }
      case "handleActiveGroupDataFromSocket": {
        const { groups, directs } = request.payload;
        handleActiveGroupDataFromSocket({
          groups,
          directs,
        })
          .then((data) => {
            sendResponse(true);
          })
          .catch((error) => {
            console.error(error.message);
            sendResponse({ error: error.message });
          });

        break;
      }
      case "getThreadActivity": {
        checkThreads(true)
          .then((data) => {
            sendResponse(data);
          })
          .catch((error) => {
            console.error(error.message);
            sendResponse({ error: error.message });
          });

        break;
      }

      case "updateThreadActivity": {
        const { threadId, qortalName, groupId, thread } = request.payload;

        updateThreadActivity({ threadId, qortalName, groupId, thread })
          .then(() => {
            sendResponse(true);
          })
          .catch((error) => {
            console.error(error.message);
            sendResponse({ error: error.message });
          });

        break;
      }
      case "decryptGroupEncryption": {
        const { data } = request.payload;

        decryptGroupEncryption({ data })
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            console.error(error.message);
            sendResponse({ error: error.message });
          });

        break;
      }
      case "encryptSingle": {
        const { data, secretKeyObject, typeNumber } = request.payload;

        encryptSingle({ data64: data, secretKeyObject: secretKeyObject, typeNumber })
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            console.error(error.message);
            sendResponse({ error: error.message });
          });

        break;
      }
      case "decryptSingle": {
        const { data, secretKeyObject, skipDecodeBase64 } = request.payload;

        decryptSingleFunc({ messages: data, secretKeyObject, skipDecodeBase64 })
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            console.error(error.message);
            sendResponse({ error: error.message });
          });

        break;
      }
      case "pauseAllQueues": {
        pauseAllQueues();
        sendResponse(true);

        break;
      
      }
      case "resumeAllQueues": {
        resumeAllQueues();
        sendResponse(true);

        break;
      }
      case "checkLocal": {
        checkLocalFunc()
        .then((res) => {
          sendResponse(res);
        })
        .catch((error) => {
          console.error(error.message);
          sendResponse({ error: error.message });
        });
     

        break;
      }
      case "decryptSingleForPublishes": {
        const { data, secretKeyObject, skipDecodeBase64 } = request.payload;

        decryptSingleForPublishes({
          messages: data,
          secretKeyObject,
          skipDecodeBase64,
        })
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            console.error(error.message);
            sendResponse({ error: error.message });
          });

        break;
      }

      case "decryptDirect": {
        const { data, involvingAddress } = request.payload;

        decryptDirectFunc({ messages: data, involvingAddress })
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            console.error(error.message);
            sendResponse({ error: error.message });
          });

        break;
      }

      case "sendChatGroup": {
        const {
          groupId,
          typeMessage = undefined,
          chatReference = undefined,
          messageText,
        } = request.payload;

        sendChatGroup({ groupId, typeMessage, chatReference, messageText })
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            console.error(error.message);
            sendResponse({ error: error.message });
          });

        break;
      }
      case "sendChatDirect": {
        const {
          directTo,
          typeMessage = undefined,
          chatReference = undefined,
          messageText,
          publicKeyOfRecipient,
          address,
          otherData
        } = request.payload;
        
        sendChatDirect({
          directTo,
          chatReference,
          messageText,
          typeMessage,
          publicKeyOfRecipient,
          address,
          otherData
        })
          .then((res) => {
            sendResponse(res);
          })
          .catch((error) => {
            console.error(error.message);
            sendResponse({ error: error.message });
          });

        break;
      }
      case "setupGroupWebsocket": {
        checkNewMessages();
        checkThreads();
        sendResponse(true);

        break;
      }

      case "logout":
        {
          try {
            const logoutFunc = async () => {
              forceCloseWebSocket();
              clearAllQueues();
              if (interval) {
                // for announcement notification
                clearInterval(interval);
              }

              const wallet = await getSaveWallet();
              const address = wallet.address0;
              const key1 = `tempPublish-${address}`;
              const key2 = `group-data-${address}`;
              const key3 = `${address}-publishData`;
              chrome.storage.local.remove(
                [
                  "keyPair",
                  "walletInfo",
                  "active-groups-directs",
                  key1,
                  key2,
                  key3,
                ],
                () => {
                  if (chrome.runtime.lastError) {
                    // Handle error
                    console.error(chrome.runtime.lastError.message);
                  } else {
                    chrome.tabs.query({}, function (tabs) {
                      tabs.forEach((tab) => {
                        chrome.tabs.sendMessage(tab.id, { type: "LOGOUT" });
                      });
                    });
                    // Data removed successfully
                    sendResponse(true);
                  }
                }
              );
            };
            logoutFunc();
          } catch (error) {}
        }

        break;
    }
  }
  return true;
});

// Function to save window position and size
const saveWindowBounds = (windowId) => {
  chrome.windows.get(windowId, (window) => {
    const { top, left, width, height } = window;
    chrome.storage.local.set(
      {
        windowBounds: { top, left, width, height },
      },
      () => {
        console.log("Window bounds saved:", { top, left, width, height });
      }
    );
  });
};

// Function to restore window position and size
const restoreWindowBounds = (callback) => {
  chrome.storage.local.get("windowBounds", (data) => {
    if (data.windowBounds) {
      callback(data.windowBounds);
    } else {
      callback(null); // No saved bounds, use default size/position
    }
  });
};

chrome.action?.onClicked?.addListener((tab) => {
  const popupUrl = chrome.runtime.getURL("index.html?main=true");
  chrome.windows.getAll(
    { populate: true, windowTypes: ["popup"] },
    (windows) => {
      // Attempt to find an existing popup window that has a tab with the correct URL
      const existingPopup = windows.find((w) => {
        return (
          w.tabs &&
          w.tabs.some((tab) => tab.url && tab.url.startsWith(popupUrl))
        );
      });
      if (existingPopup) {
        // If the popup exists but is minimized or not focused, focus it

        if (isMobile) {
          const correctTab = existingPopup.tabs.find(
            (tab) => tab.url && tab.url.startsWith(popupUrl)
          );
          if (correctTab) {
            chrome.tabs.update(correctTab.id, { active: true });
            chrome.windows.update(existingPopup.id, {
              focused: true,
              state: "normal",
            });
          }
        } else {
          chrome.windows.update(existingPopup.id, {
            focused: true,
            state: "normal",
          });
        }
      } else {
        // No existing popup found, restore the saved bounds or create a new one
        restoreWindowBounds((savedBounds) => {
          chrome.system.display.getInfo((displays) => {
            // Assuming the primary display is the first one (adjust logic as needed)
            const primaryDisplay = displays[0];
            const screenWidth = primaryDisplay.bounds.width;
            const screenHeight = primaryDisplay.bounds.height;

            // Create a new window that uses the saved bounds if available
            chrome.windows.create(
              {
                url: chrome.runtime.getURL("index.html?main=true"),
                type: "popup",
                width: savedBounds ? savedBounds.width : screenWidth,
                height: savedBounds ? savedBounds.height : screenHeight,
                left: savedBounds ? savedBounds.left : 0,
                top: savedBounds ? savedBounds.top : 0,
              },
              (newWindow) => {
                // Listen for changes in the window's size or position and save them
                chrome.windows.onBoundsChanged.addListener((window) => {
                  if (window.id === newWindow.id) {
                    saveWindowBounds(newWindow.id);
                  }
                });

                // Save the final window bounds when the window is closed
                chrome.windows.onRemoved.addListener((windowId) => {
                  if (windowId === newWindow.id) {
                    saveWindowBounds(windowId); // Save the position/size before it’s closed
                  }
                });
              }
            );
          });
        });
      }

      const interactionId = Date.now().toString(); // Simple example; consider a better unique ID

      setTimeout(() => {
        chrome.runtime.sendMessage({
          action: "INITIATE_MAIN",
          payload: {},
        });
      }, 500);

      // Store sendResponse callback with the interaction ID
      pendingResponses.set(interactionId, sendResponse);
    }
  );
});

const checkGroupList = async () => {
  try {
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const url = await createEndpoint(`/chat/active/${address}`);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();

    const filteredGroups =
      data.groups?.filter((item) => item?.groupId !== 0) || [];
    const sortedGroups = filteredGroups.sort(
      (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
    );
    const sortedDirects = (data?.direct || [])
      .filter(
        (item) =>
          item?.name !== "extension-proxy" &&
          item?.address !== "QSMMGSgysEuqDCuLw3S4cHrQkBrh3vP3VH"
      )
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    handleActiveGroupDataFromSocket({
      groups: sortedGroups,
      directs: sortedDirects,
    });
  } catch (error) {
    console.error(error);
  } finally {
  }
};

const checkActiveChatsForNotifications = async () => {
  try {
    const popupUrl = chrome.runtime.getURL("index.html?main=true");

    chrome.windows.getAll(
      { populate: true, windowTypes: ["popup"] },
      (windows) => {
        // Attempt to find an existing popup window that has a tab with the correct URL
        const existingPopup = windows.find((w) => {
          return (
            w.tabs &&
            w.tabs.some((tab) => tab.url && tab.url.startsWith(popupUrl))
          );
        });

        if (existingPopup) {
        } else {
          checkGroupList();
        }
      }
    );
  } catch (error) {}
};
chrome.notifications?.onClicked?.addListener((notificationId) => {
  const popupUrl = chrome.runtime.getURL("index.html?main=true");
  const isDirect = notificationId.includes("_type=direct_");
  const isGroup = notificationId.includes("_type=group_");
  const isGroupAnnouncement = notificationId.includes(
    "_type=group-announcement_"
  );
  const isNewThreadPost = notificationId.includes("_type=thread-post_");

  let isExisting = false;
  chrome.windows.getAll(
    { populate: true, windowTypes: ["popup"] },
    async (windows) => {
      // Attempt to find an existing popup window that has a tab with the correct URL
      const existingPopup = windows.find((w) => {
        return (
          w.tabs &&
          w.tabs.some((tab) => tab.url && tab.url.startsWith(popupUrl))
        );
      });

      if (existingPopup) {
        // If the popup exists but is minimized or not focused, focus it
        chrome.windows.update(existingPopup.id, {
          focused: true,
          state: "normal",
        });
        isExisting = true;
      } else {
        // No existing popup found, restore saved bounds or create a new one
        restoreWindowBounds((savedBounds) => {
          chrome.system.display.getInfo((displays) => {
            // Assuming the primary display is the first one (adjust logic as needed)
            const primaryDisplay = displays[0];
            const screenWidth = primaryDisplay.bounds.width;
            const screenHeight = primaryDisplay.bounds.height;

            // Create a new window that takes up the full screen or uses saved bounds
            chrome.windows.create(
              {
                url: chrome.runtime.getURL("index.html?main=true"),
                type: "popup",
                width: savedBounds ? savedBounds.width : screenWidth,
                height: savedBounds ? savedBounds.height : screenHeight,
                left: savedBounds ? savedBounds.left : 0,
                top: savedBounds ? savedBounds.top : 0,
              },
              (newWindow) => {
                // Listen for changes in the window's size or position and save them
                chrome.windows.onBoundsChanged.addListener((window) => {
                  if (window.id === newWindow.id) {
                    saveWindowBounds(newWindow.id);
                  }
                });

                // Save the final window bounds when the window is closed
                chrome.windows.onRemoved.addListener((windowId) => {
                  if (windowId === newWindow.id) {
                    saveWindowBounds(windowId); // Save the position/size before it’s closed
                  }
                });
              }
            );
          });
        });
      }
      const activeData = (await getStoredData("active-groups-directs")) || {
        groups: [],
        directs: [],
      };
      setTimeout(
        () => {
          chrome.runtime.sendMessage({
            action: "SET_GROUPS",
            payload: activeData?.groups || [],
          });
          chrome.runtime.sendMessage({
            action: "SET_DIRECTS",
            payload: activeData?.directs || [],
          });
        },
        isExisting ? 100 : 1000
      );
      const interactionId = Date.now().toString(); // Simple example; consider a better unique ID

      setTimeout(
        () => {
          chrome.runtime.sendMessage({
            action: "INITIATE_MAIN",
            payload: {},
          });

          // Handle different types of notifications
          if (isDirect) {
            const fromValue = notificationId.split("_from=")[1];
            chrome.runtime.sendMessage({
              action: "NOTIFICATION_OPEN_DIRECT",
              payload: { from: fromValue },
            });
          } else if (isGroup) {
            const fromValue = notificationId.split("_from=")[1];
            chrome.runtime.sendMessage({
              action: "NOTIFICATION_OPEN_GROUP",
              payload: { from: fromValue },
            });
          } else if (isGroupAnnouncement) {
            const fromValue = notificationId.split("_from=")[1];
            chrome.runtime.sendMessage({
              action: "NOTIFICATION_OPEN_ANNOUNCEMENT_GROUP",
              payload: { from: fromValue },
            });
          } else if (isNewThreadPost) {
            const dataValue = notificationId.split("_data=")[1];
            const dataParsed = JSON.parse(dataValue);

            chrome.runtime.sendMessage({
              action: "NOTIFICATION_OPEN_THREAD_NEW_POST",
              payload: { data: dataParsed },
            });
          }
        },
        isExisting ? 400 : 3000
      );

      // Store sendResponse callback with the interaction ID
      pendingResponses.set(interactionId, sendResponse);
    }
  );
});

// Reconnect when service worker wakes up
chrome.runtime?.onStartup.addListener(() => {
  console.log("Service worker started up, reconnecting WebSocket...");
});

chrome.runtime?.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    console.log("Extension Installed");
    // Perform tasks that should only happen on extension installation
    // Example: Initialize WebSocket, set default settings, etc.
  } else if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
    console.log("Extension Updated");
    // Handle the update logic here (e.g., migrate settings)
  } else if (
    details.reason === chrome.runtime.OnInstalledReason.CHROME_UPDATE
  ) {
    console.log("Chrome updated");
    // Optional: Handle Chrome-specific updates if necessary
  }


});

// Check if the alarm already exists before creating it
chrome.alarms?.get("checkForNotifications", (existingAlarm) => {
  if (!existingAlarm) {
    // If the alarm does not exist, create it
    chrome.alarms.create("checkForNotifications", { periodInMinutes: 10 });
  }
});

chrome.alarms?.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === "checkForNotifications") {
      const wallet = await getSaveWallet();
      const address = wallet.address0;
      if (!address) return;
      checkActiveChatsForNotifications();
      checkNewMessages();
      checkThreads();
    }
  } catch (error) {}
});
