import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./App.css";
import { useDropzone } from "react-dropzone";
import {
  Box,
  Button,
  ButtonBase,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Input,
  InputLabel,
  Popover,
  Tooltip,
  Typography,
} from "@mui/material";
import { JsonView, allExpanded, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { decryptStoredWallet } from "./utils/decryptWallet";
import { CountdownCircleTimer } from "react-countdown-circle-timer";
import Logo1 from "./assets/svgs/Logo1.svg";
import Logo1Dark from "./assets/svgs/Logo1Dark.svg";
import RefreshIcon from "@mui/icons-material/Refresh";
import Logo2 from "./assets/svgs/Logo2.svg";
import Copy from "./assets/svgs/Copy.svg";
import ltcLogo from "./assets/ltc.png";
import qortLogo from "./assets/qort.png";
import { CopyToClipboard } from "react-copy-to-clipboard";
import Download from "./assets/svgs/Download.svg";
import Logout from "./assets/svgs/Logout.svg";
import Return from "./assets/svgs/Return.svg";
import Success from "./assets/svgs/Success.svg";
import Info from "./assets/svgs/Info.svg";
import CloseIcon from "@mui/icons-material/Close";
import './utils/seedPhrase/RandomSentenceGenerator';

import {
  createAccount,
  generateRandomSentence,
  saveFileToDisk,
  saveSeedPhraseToDisk,
} from "./utils/generateWallet/generateWallet";
import { kdf } from "./deps/kdf";
import { generateSaveWalletData } from "./utils/generateWallet/storeWallet";
import { crypto, walletVersion } from "./constants/decryptWallet";
import PhraseWallet from "./utils/generateWallet/phrase-wallet";
import {
  AddressBox,
  AppContainer,
  AuthenticatedContainer,
  AuthenticatedContainerInnerLeft,
  AuthenticatedContainerInnerRight,
  CustomButton,
  CustomInput,
  CustomLabel,
  TextItalic,
  TextP,
  TextSpan,
} from "./App-styles";
import { Spacer } from "./common/Spacer";
import { Loader } from "./components/Loader";
import { PasswordField, ErrorText } from "./components";
import { ChatGroup } from "./components/Chat/ChatGroup";
import { Group, requestQueueMemberNames } from "./components/Group/Group";
import { TaskManager } from "./components/TaskManager/TaskManger";
import { useModal } from "./common/useModal";
import { LoadingButton } from "@mui/lab";
import { Label } from "./components/Group/AddGroup";
import { CustomizedSnackbars } from "./components/Snackbar/Snackbar";
import SettingsIcon from "@mui/icons-material/Settings";
import {
  cleanUrl,
  getFee,
  getProtocol,
  groupApi,
  groupApiLocal,
  groupApiSocket,
  groupApiSocketLocal,
} from "./background";
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from "./utils/events";
import {
  requestQueueCommentCount,
  requestQueuePublishedAccouncements,
} from "./components/Chat/GroupAnnouncements";
import { requestQueueGroupJoinRequests } from "./components/Group/GroupJoinRequests";
import { DrawerComponent } from "./components/Drawer/Drawer";
import { AddressQRCode } from "./components/AddressQRCode";
import { Settings } from "./components/Group/Settings";
import { MainAvatar } from "./components/MainAvatar";
import { useRetrieveDataLocalStorage } from "./useRetrieveDataLocalStorage";
import { useQortalGetSaveSettings } from "./useQortalGetSaveSettings";
import { useRecoilState, useResetRecoilState, useSetRecoilState } from "recoil";
import {
  canSaveSettingToQdnAtom,
  enabledDevModeAtom,
  fullScreenAtom,
  hasSettingsChangedAtom,
  oldPinnedAppsAtom,
  settingsLocalLastUpdatedAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from "./atoms/global";
import { useAppFullScreen } from "./useAppFullscreen";
import { NotAuthenticated } from "./ExtStates/NotAuthenticated";
import {
  openIndexedDB,
  showSaveFilePicker,
} from "./components/Apps/useQortalMessageListener";
import { fileToBase64 } from "./utils/fileReading";
import { handleGetFileFromIndexedDB } from "./utils/indexedDB";
import { CoreSyncStatus } from "./components/CoreSyncStatus";
import { Wallets } from "./Wallets";
import { RandomSentenceGenerator } from "./utils/seedPhrase/RandomSentenceGenerator";

type extStates =
  | "not-authenticated"
  | "authenticated"
  | "send-qort"
  | "web-app-request-connection"
  | "web-app-request-payment"
  | "web-app-request-authentication"
  | "download-wallet"
  | "create-wallet"
  | "transfer-success-regular"
  | "transfer-success-request"
  | "wallet-dropped"
  | "web-app-request-buy-order"
  | "buy-order-submitted"
  | "wallets"
  | "group";

interface MyContextInterface {
  txList: any[];
  memberGroups: any[];
  setTxList: (val) => void;
  setMemberGroups: (val) => void;
  isShow: boolean;
  onCancel: () => void;
  onOk: () => void;
  show: () => void;
  message: any;
}

const defaultValues: MyContextInterface = {
  txList: [],
  memberGroups: [],
  setTxList: () => {},
  setMemberGroups: () => {},
  isShow: false,
  onCancel: () => {},
  onOk: () => {},
  show: () => {},
  message: {
    publishFee: "",
    message: "",
  },
};
export let isMobile = false;

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

export const allQueues = {
  requestQueueCommentCount: requestQueueCommentCount,
  requestQueuePublishedAccouncements: requestQueuePublishedAccouncements,
  requestQueueMemberNames: requestQueueMemberNames,
  requestQueueGroupJoinRequests: requestQueueGroupJoinRequests,
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

export const pauseAllQueues = () => {
  controlAllQueues("pause");
  window.sendMessage("pauseAllQueues", {}).catch((error) => {
    console.error(
      "Failed to pause all queues:",
      error.message || "An error occurred"
    );
  });
};
export const resumeAllQueues = () => {
  controlAllQueues("resume");
  window.sendMessage("resumeAllQueues", {}).catch((error) => {
    console.error(
      "Failed to resume all queues:",
      error.message || "An error occurred"
    );
  });
};



export const MyContext = createContext<MyContextInterface>(defaultValues);

export let globalApiKey: string | null = null;

export const getBaseApiReact = (customApi?: string) => {
  if (customApi) {
    return customApi;
  }

  if (globalApiKey) {
    return globalApiKey?.url;
  } else {
    return groupApi;
  }
};
// export const getArbitraryEndpointReact = () => {

//   if (globalApiKey) {
//     return `/arbitrary/resources/search`;
//   } else {
//     return `/arbitrary/resources/searchsimple`;
//   }
// };
export const getArbitraryEndpointReact = () => {
  if (globalApiKey) {
    return `/arbitrary/resources/searchsimple`;
  } else {
    return `/arbitrary/resources/searchsimple`;
  }
};
export const getBaseApiReactSocket = (customApi?: string) => {
  if (customApi) {
    return customApi;
  }

  if (globalApiKey) {
    return `${
      getProtocol(globalApiKey?.url) === "http" ? "ws://" : "wss://"
    }${cleanUrl(globalApiKey?.url)}`;
  } else {
    return groupApiSocket;
  }
};
export const isMainWindow = true;
function App() {
  const [extState, setExtstate] = useState<extStates>("not-authenticated");
  const [desktopViewMode, setDesktopViewMode] = useState("home");

  const [backupjson, setBackupjson] = useState<any>(null);
  const [rawWallet, setRawWallet] = useState<any>(null);
  const [ltcBalanceLoading, setLtcBalanceLoading] = useState<boolean>(false);
  const [qortBalanceLoading, setQortBalanceLoading] = useState<boolean>(false);
  const [decryptedWallet, setdecryptedWallet] = useState<any>(null);
  const [requestConnection, setRequestConnection] = useState<any>(null);
  const [requestBuyOrder, setRequestBuyOrder] = useState<any>(null);
  const [authenticatedMode, setAuthenticatedMode] = useState("qort");
  const [requestAuthentication, setRequestAuthentication] = useState<any>(null);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [ltcBalance, setLtcBalance] = useState<any>(null);
  const [paymentTo, setPaymentTo] = useState<string>("");
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentPassword, setPaymentPassword] = useState<string>("");
  const [sendPaymentError, setSendPaymentError] = useState<string>("");
  const [sendPaymentSuccess, setSendPaymentSuccess] = useState<string>("");
  const [countdown, setCountdown] = useState<null | number>(null);
  const [walletToBeDownloaded, setWalletToBeDownloaded] = useState<any>(null);
  const [walletToBeDownloadedPassword, setWalletToBeDownloadedPassword] =
    useState<string>("");
  const [isMain, setIsMain] = useState<boolean>(true);
  const isMainRef = useRef(false);
  const [authenticatePassword, setAuthenticatePassword] = useState<string>("");
  const [sendqortState, setSendqortState] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [
    walletToBeDownloadedPasswordConfirm,
    setWalletToBeDownloadedPasswordConfirm,
  ] = useState<string>("");
  const [walletToBeDownloadedError, setWalletToBeDownloadedError] =
    useState<string>("");
  const [walletToBeDecryptedError, setWalletToBeDecryptedError] =
    useState<string>("");
  const [txList, setTxList] = useState([]);
  const [memberGroups, setMemberGroups] = useState([]);
  const [isFocused, setIsFocused] = useState(true);
  const [hasSettingsChanged, setHasSettingsChanged] = useRecoilState(
    hasSettingsChangedAtom
  );
  const holdRefExtState = useRef<extStates>("not-authenticated");
  const isFocusedRef = useRef<boolean>(true);
  const { isShow, onCancel, onOk, show, message } = useModal();
  const {
    isShow: isShowUnsavedChanges,
    onCancel: onCancelUnsavedChanges,
    onOk: onOkUnsavedChanges,
    show: showUnsavedChanges,
    message: messageUnsavedChanges,
  } = useModal();
  const {
    isShow: isShowInfo,
    onCancel: onCancelInfo,
    onOk: onOkInfo,
    show: showInfo,
    message: messageInfo,
  } = useModal();

  const {
    onCancel: onCancelQortalRequest,
    onOk: onOkQortalRequest,
    show: showQortalRequest,
    isShow: isShowQortalRequest,
    message: messageQortalRequest,
  } = useModal();
  const {
    onCancel: onCancelQortalRequestExtension,
    onOk: onOkQortalRequestExtension,
    show: showQortalRequestExtension,
    isShow: isShowQortalRequestExtension,
    message: messageQortalRequestExtension,
  } = useModal();

  const [openRegisterName, setOpenRegisterName] = useState(false);
  const registerNamePopoverRef = useRef(null);
  const [isLoadingRegisterName, setIsLoadingRegisterName] = useState(false);
  const [registerNameValue, setRegisterNameValue] = useState("");
  const [infoSnack, setInfoSnack] = useState(null);
  const [openSnack, setOpenSnack] = useState(false);
  const [hasLocalNode, setHasLocalNode] = useState(false);
  const [isOpenDrawerProfile, setIsOpenDrawerProfile] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [isOpenSendQort, setIsOpenSendQort] = useState(false);
  const [isOpenSendQortSuccess, setIsOpenSendQortSuccess] = useState(false);
  const [rootHeight, setRootHeight] = useState("100%");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const qortalRequestCheckbox1Ref = useRef(null);
  useRetrieveDataLocalStorage();
  useQortalGetSaveSettings(userInfo?.name);
  const [fullScreen, setFullScreen] = useRecoilState(fullScreenAtom);
  const [isEnabledDevMode, setIsEnabledDevMode] =
    useRecoilState(enabledDevModeAtom);

  const { toggleFullScreen } = useAppFullScreen(setFullScreen);
  const generatorRef = useRef(null)
  const exportSeedphrase = ()=> {
    const seedPhrase = generatorRef.current.parsedString
    saveSeedPhraseToDisk(seedPhrase)
  }
  useEffect(() => {
    const isDevModeFromStorage = localStorage.getItem("isEnabledDevMode");
    if (isDevModeFromStorage) {
      setIsEnabledDevMode(JSON.parse(isDevModeFromStorage));
    }
  }, []);

  useEffect(() => {
    // Attach a global event listener for double-click
    const handleDoubleClick = () => {
      toggleFullScreen();
    };

    // Add the event listener to the root HTML document
    document.documentElement.addEventListener("dblclick", handleDoubleClick);

    // Clean up the event listener on unmount
    return () => {
      document.documentElement.removeEventListener(
        "dblclick",
        handleDoubleClick
      );
    };
  }, [toggleFullScreen]);
  //resets for recoil
  const resetAtomSortablePinnedAppsAtom = useResetRecoilState(
    sortablePinnedAppsAtom
  );
  const resetAtomCanSaveSettingToQdnAtom = useResetRecoilState(
    canSaveSettingToQdnAtom
  );
  const resetAtomSettingsQDNLastUpdatedAtom = useResetRecoilState(
    settingsQDNLastUpdatedAtom
  );
  const resetAtomSettingsLocalLastUpdatedAtom = useResetRecoilState(
    settingsLocalLastUpdatedAtom
  );
  const resetAtomOldPinnedAppsAtom = useResetRecoilState(oldPinnedAppsAtom);

  const resetAllRecoil = () => {
    resetAtomSortablePinnedAppsAtom();
    resetAtomCanSaveSettingToQdnAtom();
    resetAtomSettingsQDNLastUpdatedAtom();
    resetAtomSettingsLocalLastUpdatedAtom();
    resetAtomOldPinnedAppsAtom();
  };
  useEffect(() => {
    if (!isMobile) return;
    // Function to set the height of the app to the viewport height
    const resetHeight = () => {
      const height = window.visualViewport
        ? window.visualViewport.height
        : window.innerHeight;
      // Set the height to the root element (usually #root)
      document.getElementById("root").style.height = height + "px";
      setRootHeight(height + "px");
    };

    // Set the initial height
    resetHeight();

    // Add event listeners for resize and visualViewport changes
    window.addEventListener("resize", resetHeight);
    window.visualViewport?.addEventListener("resize", resetHeight);

    // Clean up the event listeners when the component unmounts
    return () => {
      window.removeEventListener("resize", resetHeight);
      window.visualViewport?.removeEventListener("resize", resetHeight);
    };
  }, []);
  const handleSetGlobalApikey = (key) => {
    globalApiKey = key;
  };
  useEffect(() => {
    window
      .sendMessage("getApiKey")
      .then((response) => {
        if (response) {
          handleSetGlobalApikey(response);
          setApiKey(response);
        }
      })
      .catch((error) => {
        console.error(
          "Failed to get API key:",
          error?.message || "An error occurred"
        );
      });
  }, []);
  useEffect(() => {
    if (extState) {
      holdRefExtState.current = extState;
    }
  }, [extState]);

  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  // const checkIfUserHasLocalNode = useCallback(async () => {
  //   try {
  //     const url = `http://127.0.0.1:12391/admin/status`;
  //     const response = await fetch(url, {
  //       method: "GET",
  //       headers: {
  //         "Content-Type": "application/json",
  //       },
  //     });
  //     const data = await response.json();
  //     if (data?.isSynchronizing === false && data?.syncPercent === 100) {
  //       setHasLocalNode(true);
  //     }
  //   } catch (error) {}
  // }, []);

  // useEffect(() => {
  //   checkIfUserHasLocalNode();
  // }, [extState]);

  const address = useMemo(() => {
    if (!rawWallet?.address0) return "";
    return rawWallet.address0;
  }, [rawWallet]);
  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      "application/json": [".json"], // Only accept JSON files
    },
    maxFiles: 1,
    onDrop: async (acceptedFiles) => {
      const file: any = acceptedFiles[0];
      const fileContents = await new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onabort = () => reject("File reading was aborted");
        reader.onerror = () => reject("File reading has failed");
        reader.onload = () => {
          // Resolve the promise with the reader result when reading completes
          resolve(reader.result);
        };

        // Read the file as text
        reader.readAsText(file);
      });

      let error: any = null;
      let pf: any;

      try {
        if (typeof fileContents !== "string") return;
        pf = JSON.parse(fileContents);
      } catch (e) {}

      try {
        const requiredFields = [
          "address0",
          "salt",
          "iv",
          "version",
          "encryptedSeed",
          "mac",
          "kdfThreads",
        ];
        for (const field of requiredFields) {
          if (!(field in pf)) throw new Error(field + " not found in JSON");
        }
        setRawWallet(pf);
        // setExtstate("authenticated");
        setExtstate("wallet-dropped");
        setdecryptedWallet(null);
      } catch (e) {
        console.log(e);

        error = e;
      }
    },
  });

  const saveWalletFunc = async (password: string) => {
    let wallet = structuredClone(rawWallet);

    const res = await decryptStoredWallet(password, wallet);
    const wallet2 = new PhraseWallet(res, walletVersion);
    wallet = await wallet2.generateSaveWalletData(
      password,
      crypto.kdfThreads,
      () => {}
    );

    setWalletToBeDownloaded({
      wallet,
      qortAddress: rawWallet.address0,
    });
    return {
      wallet,
      qortAddress: rawWallet.address0,
    };
  };

  const getBalanceFunc = () => {
    setQortBalanceLoading(true);
    window
      .sendMessage("balance")
      .then((response) => {
        if (!response?.error && !isNaN(+response)) {
          setBalance(response);
        }
        setQortBalanceLoading(false);
      })
      .catch((error) => {
        console.error("Failed to get balance:", error);
        setQortBalanceLoading(false);
      });
  };
  const getLtcBalanceFunc = () => {
    setLtcBalanceLoading(true);
    window
      .sendMessage("ltcBalance")
      .then((response) => {
        if (!response?.error && !isNaN(+response)) {
          setLtcBalance(response);
        }
        setLtcBalanceLoading(false);
      })
      .catch((error) => {
        console.error("Failed to get LTC balance:", error);
        setLtcBalanceLoading(false);
      });
  };
  const sendCoinFunc = () => {
    setSendPaymentError("");
    setSendPaymentSuccess("");
    if (!paymentTo) {
      setSendPaymentError("Please enter a recipient");
      return;
    }
    if (!paymentAmount) {
      setSendPaymentError("Please enter an amount greater than 0");
      return;
    }
    if (!paymentPassword) {
      setSendPaymentError("Please enter your wallet password");
      return;
    }
    setIsLoading(true);
    window
      .sendMessage("sendCoin", {
        amount: Number(paymentAmount),
        receiver: paymentTo.trim(),
        password: paymentPassword,
      })
      .then((response) => {
        if (response?.error) {
          setSendPaymentError(response.error);
        } else {
          setIsOpenSendQort(false);
          setIsOpenSendQortSuccess(true);
        }
        setIsLoading(false);
      })
      .catch((error) => {
        console.error("Failed to send coin:", error);
        setIsLoading(false);
      });
  };

  const clearAllStates = () => {
    setRequestConnection(null);
    setRequestAuthentication(null);
  };

  const qortalRequestPermissonFromExtension = async (message, event) => {
    if (message.action === "QORTAL_REQUEST_PERMISSION") {
      try {
        if (message?.payload?.checkbox1) {
          qortalRequestCheckbox1Ref.current =
            message?.payload?.checkbox1?.value || false;
        }
        await showQortalRequestExtension(message?.payload);

        if (qortalRequestCheckbox1Ref.current) {
          event.source.postMessage(
            {
              action: "QORTAL_REQUEST_PERMISSION_RESPONSE",
              requestId: message?.requestId,
              result: {
                accepted: true,
                checkbox1: qortalRequestCheckbox1Ref.current,
              },
            },
            event.origin
          );
          return;
        }
        event.source.postMessage(
          {
            action: "QORTAL_REQUEST_PERMISSION_RESPONSE",
            requestId: message?.requestId,
            result: {
              accepted: true,
            },
          },
          event.origin
        );
      } catch (error) {
        event.source.postMessage(
          {
            action: "QORTAL_REQUEST_PERMISSION_RESPONSE",
            requestId: message?.requestId,
            result: {
              accepted: false,
            },
          },
          event.origin
        );
      }
    }
  };

  useEffect(() => {
    // Handler function for incoming messages
    const messageHandler = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const message = event.data;

      if (message?.action === "CHECK_FOCUS") {
        event.source.postMessage(
          { action: "CHECK_FOCUS_RESPONSE", isFocused: isFocusedRef.current },
          event.origin
        );
      } else if (message.action === "NOTIFICATION_OPEN_DIRECT") {
        executeEvent("openDirectMessage", {
          from: message.payload.from,
        });
      } else if (message.action === "NOTIFICATION_OPEN_GROUP") {
        executeEvent("openGroupMessage", {
          from: message.payload.from,
        });
      } else if (message.action === "NOTIFICATION_OPEN_ANNOUNCEMENT_GROUP") {
        executeEvent("openGroupAnnouncement", {
          from: message.payload.from,
        });
      } else if (message.action === "NOTIFICATION_OPEN_THREAD_NEW_POST") {
        executeEvent("openThreadNewPost", {
          data: message.payload.data,
        });
      } else if (
        message.action === "QORTAL_REQUEST_PERMISSION" &&
        message?.isFromExtension
      ) {
        qortalRequestPermissonFromExtension(message, event);
      } else if (message?.action === "getFileFromIndexedDB") {
        handleGetFileFromIndexedDB(event);
      }
    };

    // Attach the event listener
    window.addEventListener("message", messageHandler);

    // Clean up the event listener on component unmount
    return () => {
      window.removeEventListener("message", messageHandler);
    };
  }, []);

  //param = isDecline
  const confirmPayment = (isDecline: boolean) => {
    // REMOVED FOR MOBILE APP
  };

  const confirmBuyOrder = (isDecline: boolean) => {
    // REMOVED FOR MOBILE APP
  };
  const responseToConnectionRequest = (
    isOkay: boolean,
    hostname: string,
    interactionId: string
  ) => {
    // REMOVED FOR MOBILE APP
  };

  useEffect(() => {
    try {
      setIsLoading(true);

      window
        .sendMessage("getWalletInfo")
        .then((response) => {
          if (response && response?.walletInfo) {
            setRawWallet(response?.walletInfo);
            if (
              holdRefExtState.current === "web-app-request-payment" ||
              holdRefExtState.current === "web-app-request-connection" ||
              holdRefExtState.current === "web-app-request-buy-order"
            )
              return;
            if (response?.hasKeyPair) {
              setExtstate("authenticated");
            } else {
              setExtstate("wallet-dropped");
            }
          }
        })
        .catch((error) => {
          console.error("Failed to get wallet info:", error);
        });
    } catch (error) {
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getUserInfo = useCallback(async (useTimer?: boolean) => {
    try {
      if (useTimer) {
        await new Promise((res) => {
          setTimeout(() => {
            res(null);
          }, 10000);
        });
      }
      window
        .sendMessage("userInfo")
        .then((response) => {
          if (response && !response.error) {
            setUserInfo(response);
          }
        })
        .catch((error) => {
          console.error("Failed to get user info:", error);
        });

      getBalanceFunc();
    } catch (error) {}
  }, []);

  useEffect(() => {
    if (!address) return;
    getUserInfo();
  }, [address]);

  useEffect(() => {
    return () => {
      console.log("exit");
    };
  }, []);

  useEffect(() => {
    if (
      authenticatedMode === "ltc" &&
      !ltcBalanceLoading &&
      ltcBalance === null
    ) {
      getLtcBalanceFunc();
    }
  }, [authenticatedMode]);

  const confirmPasswordToDownload = async () => {
    try {
      setWalletToBeDownloadedError("");
      if (!walletToBeDownloadedPassword) {
        setSendPaymentError("Please enter your password");
        return;
      }
      setIsLoading(true);
      await new Promise<void>((res) => {
        setTimeout(() => {
          res();
        }, 250);
      });
      const res = await saveWalletFunc(walletToBeDownloadedPassword);
    } catch (error: any) {
      setWalletToBeDownloadedError(error?.message);
    } finally {
      setIsLoading(false);
    }
  };

  const saveFileToDiskFunc = async () => {
    try {
      await saveFileToDisk(
        walletToBeDownloaded.wallet,
        walletToBeDownloaded.qortAddress
      );
    } catch (error: any) {
      setWalletToBeDownloadedError(error?.message);
    } finally {
    }
  };

  const createAccountFunc = async () => {
    try {
      if (!walletToBeDownloadedPassword) {
        setWalletToBeDownloadedError("Please enter a password");
        return;
      }
      if (!walletToBeDownloadedPasswordConfirm) {
        setWalletToBeDownloadedError("Please confirm your password");
        return;
      }
      if (
        walletToBeDownloadedPasswordConfirm !== walletToBeDownloadedPassword
      ) {
        setWalletToBeDownloadedError("Password fields do not match!");
        return;
      }
      setIsLoading(true);
      await new Promise<void>((res) => {
        setTimeout(() => {
          res();
        }, 250);
      });
      const res = await createAccount(generatorRef.current.parsedString);
      const wallet = await res.generateSaveWalletData(
        walletToBeDownloadedPassword,
        crypto.kdfThreads,
        () => {}
      );
      window
        .sendMessage("decryptWallet", {
          password: walletToBeDownloadedPassword,
          wallet,
        })
        .then((response) => {
          if (response && !response.error) {
            setRawWallet(wallet);
            setWalletToBeDownloaded({
              wallet,
              qortAddress: wallet.address0,
            });

            window
              .sendMessage("userInfo")
              .then((response2) => {
                setIsLoading(false);
                if (response2 && !response2.error) {
                  setUserInfo(response2);
                }
              })
              .catch((error) => {
                setIsLoading(false);
                console.error("Failed to get user info:", error);
              });

            getBalanceFunc();
          } else if (response?.error) {
            setIsLoading(false);
            setWalletToBeDecryptedError(response.error);
          }
        })
        .catch((error) => {
          setIsLoading(false);
          console.error("Failed to decrypt wallet:", error);
        });
    } catch (error: any) {
      setWalletToBeDownloadedError(error?.message);
      setIsLoading(false);
    }
  };

  const logoutFunc = async () => {
    try {
      if (hasSettingsChanged) {
        await showUnsavedChanges({
          message:
            "Your settings have changed. If you logout you will lose your changes. Click on the save button in the header to keep your changed settings.",
        });
      }
      window
        .sendMessage("logout", {})
        .then((response) => {
          if (response) {
            executeEvent("logout-event", {});
            resetAllStates();
          }
        })
        .catch((error) => {
          console.error(
            "Failed to log out:",
            error.message || "An error occurred"
          );
        });
    } catch (error) {}
  };

  const returnToMain = () => {
    setPaymentTo("");
    setPaymentAmount(0);
    setPaymentPassword("");
    setSendPaymentError("");
    setSendPaymentSuccess("");
    setCountdown(null);
    setWalletToBeDownloaded(null);
    setWalletToBeDownloadedPassword("");
    setExtstate("authenticated");
    setIsOpenSendQort(false);
    setIsOpenSendQortSuccess(false);
  };

  const resetAllStates = () => {
    setExtstate("not-authenticated");
    setAuthenticatedMode("qort");
    setBackupjson(null);
    setRawWallet(null);
    setdecryptedWallet(null);
    setRequestConnection(null);
    setRequestBuyOrder(null);
    setRequestAuthentication(null);
    setUserInfo(null);
    setBalance(null);
    setLtcBalance(null);
    setPaymentTo("");
    setPaymentAmount(0);
    setPaymentPassword("");
    setSendPaymentError("");
    setSendPaymentSuccess("");
    setCountdown(null);
    setWalletToBeDownloaded(null);
    setWalletToBeDownloadedPassword("");
    setWalletToBeDownloadedPasswordConfirm("");
    setWalletToBeDownloadedError("");
    setSendqortState(null);
    setHasLocalNode(false);
    setTxList([]);
    setMemberGroups([]);
    resetAllRecoil();
  };

  function roundUpToDecimals(number, decimals = 8) {
    const factor = Math.pow(10, decimals); // Create a factor based on the number of decimals
    return Math.ceil(+number * factor) / factor;
  }

  const authenticateWallet = async () => {
    try {
      setIsLoading(true);
      setWalletToBeDecryptedError("");
      await new Promise<void>((res) => {
        setTimeout(() => {
          res();
        }, 250);
      });
      window
        .sendMessage(
          "decryptWallet",
          {
            password: authenticatePassword,
            wallet: rawWallet,
          },
          120000
        )
        .then((response) => {
          if (response && !response.error) {
            setAuthenticatePassword("");
            setExtstate("authenticated");
            setWalletToBeDecryptedError("");

            window
              .sendMessage("userInfo")
              .then((response) => {
                setIsLoading(false);
                if (response && !response.error) {
                  setUserInfo(response);
                }
              })
              .catch((error) => {
                setIsLoading(false);
                console.error("Failed to get user info:", error);
              });

            getBalanceFunc();

            window
              .sendMessage("getWalletInfo")
              .then((response) => {
                if (response && response.walletInfo) {
                  setRawWallet(response.walletInfo);
                }
              })
              .catch((error) => {
                console.error("Failed to get wallet info:", error);
              });
          } else if (response?.error) {
            setIsLoading(false);
            setWalletToBeDecryptedError(response.error);
          }
        })
        .catch((error) => {
          setIsLoading(false);
          console.error("Failed to decrypt wallet:", error);
        });
    } catch (error) {
      setWalletToBeDecryptedError("Unable to authenticate. Wrong password");
    }
  };

  useEffect(() => {
    if (!isMainWindow) return;
    // Handler for when the window gains focus
    const handleFocus = () => {
      setIsFocused(true);
      if (isMobile) {
        window.sendMessage("clearAllNotifications", {}).catch((error) => {
          console.error(
            "Failed to clear notifications:",
            error.message || "An error occurred"
          );
        });
      }
    };

    // Handler for when the window loses focus
    const handleBlur = () => {
      setIsFocused(false);
    };

    // Attach the event listeners
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    // Optionally, listen for visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setIsFocused(true);
        if (isMobile) {
          window.sendMessage("clearAllNotifications", {}).catch((error) => {
            console.error(
              "Failed to clear notifications:",
              error.message || "An error occurred"
            );
          });
        }
      } else {
        setIsFocused(false);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Cleanup the event listeners on component unmount
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const openPaymentInternal = (e) => {
    const directAddress = e.detail?.address;
    const name = e.detail?.name;
    setIsOpenSendQort(true);
    setPaymentTo(name || directAddress);
  };

  useEffect(() => {
    subscribeToEvent("openPaymentInternal", openPaymentInternal);

    return () => {
      unsubscribeFromEvent("openPaymentInternal", openPaymentInternal);
    };
  }, []);

  const registerName = async () => {
    try {
      if (!userInfo?.address) throw new Error("Your address was not found");
      const fee = await getFee("REGISTER_NAME");
      await show({
        message: "Would you like to register this name?",
        publishFee: fee.fee + " QORT",
      });
      setIsLoadingRegisterName(true);
      new Promise((res, rej) => {
        window
          .sendMessage("registerName", {
            name: registerNameValue,
          })
          .then((response) => {
            if (!response?.error) {
              res(response);
              setIsLoadingRegisterName(false);
              setInfoSnack({
                type: "success",
                message:
                  "Successfully registered. It may take a couple of minutes for the changes to propagate",
              });
              setOpenRegisterName(false);
              setRegisterNameValue("");
              setOpenSnack(true);
              setTxList((prev) => [
                {
                  ...response,
                  type: "register-name",
                  label: `Registered name: awaiting confirmation. This may take a couple minutes.`,
                  labelDone: `Registered name: success!`,
                  done: false,
                },
                ...prev.filter((item) => !item.done),
              ]);
              return;
            }
            setInfoSnack({
              type: "error",
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
          })
          .catch((error) => {
            setInfoSnack({
              type: "error",
              message: error.message || "An error occurred",
            });
            setOpenSnack(true);
            rej(error);
          });
      });
    } catch (error) {
      if (error?.message) {
        setInfoSnack({
          type: "error",
          message: error?.message,
        });
      }
    } finally {
      setIsLoadingRegisterName(false);
    }
  };

  const renderProfile = () => {
    return (
      <AuthenticatedContainer
        sx={{
          width: isMobile ? "100vw" : "auto",
          display: "flex",
          backgroundColor: "var(--bg-2)",
          justifyContent: "flex-end",
        }}
      >
        {isMobile && (
          <Box
            sx={{
              padding: "10px",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <CloseIcon
              onClick={() => {
                setIsOpenDrawerProfile(false);
              }}
              sx={{
                cursor: "pointer",
                color: "white",
              }}
            />
          </Box>
        )}
        {desktopViewMode !== "apps" &&
          desktopViewMode !== "dev" &&
          desktopViewMode !== "chat" && (
            <AuthenticatedContainerInnerLeft
              sx={{
                overflowY: isMobile && "auto",
                padding: "0px 20px",
                minWidth: "225px",
              }}
            >
              <Spacer height="48px" />

              {authenticatedMode === "ltc" ? (
                <>
                  <img src={ltcLogo} />
                  <Spacer height="32px" />
                  <CopyToClipboard text={rawWallet?.ltcAddress}>
                    <AddressBox>
                      {rawWallet?.ltcAddress?.slice(0, 6)}...
                      {rawWallet?.ltcAddress?.slice(-4)} <img src={Copy} />
                    </AddressBox>
                  </CopyToClipboard>
                  <Spacer height="10px" />
                  {ltcBalanceLoading && (
                    <CircularProgress color="success" size={16} />
                  )}
                  {!isNaN(+ltcBalance) && !ltcBalanceLoading && (
                    <Box
                      sx={{
                        gap: "10px",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <TextP
                        sx={{
                          textAlign: "center",
                          lineHeight: "24px",
                          fontSize: "20px",
                          fontWeight: 700,
                        }}
                      >
                        {ltcBalance} LTC
                      </TextP>
                      <RefreshIcon
                        onClick={getLtcBalanceFunc}
                        sx={{
                          fontSize: "16px",
                          color: "white",
                          cursor: "pointer",
                        }}
                      />
                    </Box>
                  )}
                  <AddressQRCode targetAddress={rawWallet?.ltcAddress} />
                </>
              ) : (
                <>
                  <MainAvatar myName={userInfo?.name} />
                  <Spacer height="32px" />
                  <TextP
                    sx={{
                      textAlign: "center",
                      lineHeight: "24px",
                      fontSize: "20px",
                    }}
                  >
                    {userInfo?.name}
                  </TextP>
                  <Spacer height="10px" />
                  <CopyToClipboard text={rawWallet?.address0}>
                    <AddressBox>
                      {rawWallet?.address0?.slice(0, 6)}...
                      {rawWallet?.address0?.slice(-4)} <img src={Copy} />
                    </AddressBox>
                  </CopyToClipboard>
                  <Spacer height="10px" />
                  {qortBalanceLoading && (
                    <CircularProgress color="success" size={16} />
                  )}
                  {!qortBalanceLoading && balance >= 0 && (
                    <Box
                      sx={{
                        gap: "10px",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <TextP
                        sx={{
                          textAlign: "center",
                          lineHeight: "24px",
                          fontSize: "20px",
                          fontWeight: 700,
                        }}
                      >
                        {balance?.toFixed(2)} QORT
                      </TextP>
                      <RefreshIcon
                        onClick={getBalanceFunc}
                        sx={{
                          fontSize: "16px",
                          color: "white",
                          cursor: "pointer",
                        }}
                      />
                    </Box>
                  )}

                  <Spacer height="35px" />
                  {userInfo && !userInfo?.name && (
                    <TextP
                      ref={registerNamePopoverRef}
                      sx={{
                        textAlign: "center",
                        lineHeight: 1.2,
                        fontSize: "16px",
                        fontWeight: 500,
                        cursor: "pointer",
                        marginTop: "10px",
                        color: "red",
                        textDecoration: "underline",
                      }}
                      onClick={() => {
                        setOpenRegisterName(true);
                      }}
                    >
                      REGISTER NAME
                    </TextP>
                  )}
                  <Spacer height="20px" />
                  <CustomButton
                    onClick={() => {
                      setIsOpenSendQort(true);
                      // setExtstate("send-qort");
                      setIsOpenDrawerProfile(false);
                    }}
                  >
                    Transfer QORT
                  </CustomButton>
                  <AddressQRCode targetAddress={rawWallet?.address0} />
                </>
              )}
              <TextP
                sx={{
                  textAlign: "center",
                  lineHeight: "24px",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                  marginTop: "10px",
                  textDecoration: "underline",
                }}
                onClick={async () => {
                  executeEvent("addTab", {
                    data: { service: "APP", name: "q-trade" },
                  });
                  executeEvent("open-apps-mode", {});
                }}
              >
                Get QORT at Q-Trade
              </TextP>
            </AuthenticatedContainerInnerLeft>
          )}

        <AuthenticatedContainerInnerRight
          sx={{
            height: "100%",
            justifyContent: "space-between",
          }}
        >
          <Box
            sx={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: 'center'
            }}
          >
            <Spacer height="20px" />
            
            {!isMobile && (
              <>
                <Spacer height="20px" />
                <img
                  src={Logout}
                  onClick={() => {
                    logoutFunc();
                    setIsOpenDrawerProfile(false);
                  }}
                  style={{
                    cursor: "pointer",
                    width: '20px',
                    height: 'auto'
                  }}
                />
              </>
            )}
            <Spacer height="20px" />

            <ButtonBase
              onClick={() => {
                setIsSettingsOpen(true);
              }}
            >
              <SettingsIcon
                sx={{
                  color: "rgba(255, 255, 255, 0.5)",
                }}
              />
            </ButtonBase>
            <Spacer height="20px" />
            {authenticatedMode === "qort" && (
              <img
                onClick={() => {
                  setAuthenticatedMode("ltc");
                }}
                src={ltcLogo}
                style={{
                  cursor: "pointer",
                  width: "20px",
                  height: "auto",
                }}
              />
            )}
            {authenticatedMode === "ltc" && (
              <img
                onClick={() => {
                  setAuthenticatedMode("qort");
                }}
                src={qortLogo}
                style={{
                  cursor: "pointer",
                  width: "20px",
                  height: "auto",
                }}
              />
            )}
            <Spacer height="20px" />
            <CoreSyncStatus />
          </Box>
          <Box
            sx={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: 'center'
            }}
          >
          <img
              onClick={() => {
                setExtstate("download-wallet");
                setIsOpenDrawerProfile(false);
              }}
              src={Download}
              style={{
                cursor: "pointer",
                width: '20px'
              }}
            />
            <Spacer height="40px" />
            </Box>
        </AuthenticatedContainerInnerRight>
      </AuthenticatedContainer>
    );
  };

  return (
    <AppContainer
      sx={{
        height: isMobile ? "100%" : "100vh",
        // backgroundImage: desktopViewMode === "apps" && 'url("appsBg.svg")',
        // backgroundSize: desktopViewMode === "apps" && "cover",
        // backgroundPosition: desktopViewMode === "apps" && "center",
        // backgroundRepeat: desktopViewMode === "apps" && "no-repeat",
      }}
    >
      {extState === "not-authenticated" && (
        <NotAuthenticated
          getRootProps={getRootProps}
          getInputProps={getInputProps}
          setExtstate={setExtstate}
          apiKey={apiKey}
          globalApiKey={globalApiKey}
          setApiKey={setApiKey}
          handleSetGlobalApikey={handleSetGlobalApikey}
        />
      )}
      {/* {extState !== "not-authenticated" && (
        <button onClick={logoutFunc}>logout</button>
      )} */}
      {extState === "authenticated" && isMainWindow && (
        <MyContext.Provider
          value={{
            txList,
            setTxList,
            memberGroups,
            setMemberGroups,
            isShow,
            onCancel,
            onOk,
            show,
            message,
            rootHeight,
            showInfo,
            openSnackGlobal: openSnack,
            setOpenSnackGlobal: setOpenSnack,
            infoSnackCustom: infoSnack,
            setInfoSnackCustom: setInfoSnack,
          }}
        >
          <Box
            sx={{
              width: "100vw",
              height: isMobile ? "100%" : "100vh",
              display: "flex",
              flexDirection: isMobile ? "column" : "row",
              overflow: isMobile && "hidden",
            }}
          >
            <Group
              logoutFunc={logoutFunc}
              balance={balance}
              userInfo={userInfo}
              myAddress={address}
              isFocused={isFocused}
              isMain={isMain}
              isOpenDrawerProfile={isOpenDrawerProfile}
              setIsOpenDrawerProfile={setIsOpenDrawerProfile}
              desktopViewMode={desktopViewMode}
              setDesktopViewMode={setDesktopViewMode}
            />
            {!isMobile && renderProfile()}
          </Box>

          <Box
            sx={{
              position: "fixed",
              right: "25px",
              bottom: "25px",
              width: "350px",
              zIndex: 100000,
            }}
          >
            <TaskManager getUserInfo={getUserInfo} />
          </Box>
        </MyContext.Provider>
      )}
      {isOpenSendQort && isMainWindow && (
        <Box
          sx={{
            width: "100%",
            height: "100%",
            position: "fixed",
            background: "#27282c",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            zIndex: 6,
          }}
        >
          <Spacer height="22px" />
          <Box
            sx={{
              display: "flex",
              width: "100%",
              justifyContent: "flex-start",
              paddingLeft: "22px",
              boxSizing: "border-box",
            }}
          >
            <img
              style={{
                cursor: "pointer",
              }}
              onClick={returnToMain}
              src={Return}
            />
          </Box>
          <Spacer height="35px" />
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
          >
            <TextP
              sx={{
                textAlign: "start",
                lineHeight: "24px",
                fontSize: "20px",
                fontWeight: 600,
              }}
            >
              Transfer QORT
            </TextP>
            <Spacer height="35px" />
            <TextP
              sx={{
                textAlign: "start",
                lineHeight: "16px",
                fontSize: "20px",
                fontWeight: 600,
                color: "rgba(255, 255, 255, 0.5)",
              }}
            >
              Balance:
            </TextP>
            <TextP
              sx={{
                textAlign: "start",
                lineHeight: "24px",
                fontSize: "20px",
                fontWeight: 700,
              }}
            >
              {balance?.toFixed(2)} QORT
            </TextP>
          </Box>
          <Spacer height="35px" />

          <Box>
            <CustomLabel htmlFor="standard-adornment-name">To</CustomLabel>
            <Spacer height="5px" />
            <CustomInput
              id="standard-adornment-name"
              value={paymentTo}
              onChange={(e) => setPaymentTo(e.target.value)}
              autoComplete="off"
            />
            <Spacer height="6px" />
            <CustomLabel htmlFor="standard-adornment-amount">
              Amount
            </CustomLabel>
            <Spacer height="5px" />
            <CustomInput
              id="standard-adornment-amount"
              type="number"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(+e.target.value)}
              autoComplete="off"
            />
            <Spacer height="6px" />
            <CustomLabel htmlFor="standard-adornment-password">
              Confirm Wallet Password
            </CustomLabel>
            <Spacer height="5px" />
            <PasswordField
              id="standard-adornment-password"
              value={paymentPassword}
              onChange={(e) => setPaymentPassword(e.target.value)}
              autoComplete="off"
            />
          </Box>
          <Spacer height="10px" />
          <ErrorText>{sendPaymentError}</ErrorText>
          {/* <Typography>{sendPaymentSuccess}</Typography> */}
          <Spacer height="25px" />
          <CustomButton
            onClick={() => {
              sendCoinFunc();
            }}
          >
            Send
          </CustomButton>
        </Box>
      )}

      {isShowQortalRequest && !isMainWindow && (
        <>
          <Spacer height="120px" />
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              width: "100%",
            }}
          >
            <TextP
              sx={{
                lineHeight: 1.2,
                maxWidth: "90%",
                textAlign: "center",
              }}
            >
              {messageQortalRequest?.text1}
            </TextP>
          </Box>
          {messageQortalRequest?.text2 && (
            <>
              <Spacer height="10px" />
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "flex-start",
                  width: "90%",
                }}
              >
                <TextP
                  sx={{
                    lineHeight: 1.2,
                    fontSize: "16px",
                    fontWeight: "normal",
                  }}
                >
                  {messageQortalRequest?.text2}
                </TextP>
              </Box>
              <Spacer height="15px" />
            </>
          )}
          {messageQortalRequest?.text3 && (
            <>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "flex-start",
                  width: "90%",
                }}
              >
                <TextP
                  sx={{
                    lineHeight: 1.2,
                    fontSize: "16px",
                    fontWeight: "normal",
                  }}
                >
                  {messageQortalRequest?.text3}
                </TextP>
                <Spacer height="15px" />
              </Box>
            </>
          )}

          {messageQortalRequest?.text4 && (
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-start",
                width: "90%",
              }}
            >
              <TextP
                sx={{
                  lineHeight: 1.2,
                  fontSize: "16px",
                  fontWeight: "normal",
                }}
              >
                {messageQortalRequest?.text4}
              </TextP>
            </Box>
          )}

          {messageQortalRequest?.html && (
            <div
              dangerouslySetInnerHTML={{ __html: messageQortalRequest?.html }}
            />
          )}
          <Spacer height="15px" />

          <TextP
            sx={{
              textAlign: "center",
              lineHeight: 1.2,
              fontSize: "16px",
              fontWeight: 700,
              maxWidth: "90%",
            }}
          >
            {messageQortalRequest?.highlightedText}
          </TextP>

          {messageQortalRequest?.fee && (
            <>
              <Spacer height="15px" />

              <TextP
                sx={{
                  textAlign: "center",
                  lineHeight: 1.2,
                  fontSize: "16px",
                  fontWeight: "normal",
                  maxWidth: "90%",
                }}
              >
                {"Fee: "}
                {messageQortalRequest?.fee}
                {" QORT"}
              </TextP>
              <Spacer height="15px" />
            </>
          )}
          {messageQortalRequest?.checkbox1 && (
            <Box
              sx={{
                display: "flex",
                gap: "10px",
                alignItems: "center",
                justifyContent: "center",
                width: "90%",
                marginTop: "20px",
              }}
            >
              <Checkbox
                onChange={(e) => {
                  qortalRequestCheckbox1Ref.current = e.target.checked;
                }}
                edge="start"
                tabIndex={-1}
                disableRipple
                defaultChecked={messageQortalRequest?.checkbox1?.value}
                sx={{
                  "&.Mui-checked": {
                    color: "white", // Customize the color when checked
                  },
                  "& .MuiSvgIcon-root": {
                    color: "white",
                  },
                }}
              />

              <Typography
                sx={{
                  fontSize: "14px",
                }}
              >
                {messageQortalRequest?.checkbox1?.label}
              </Typography>
            </Box>
          )}

          <Spacer height="29px" />
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
            }}
          >
            <CustomButton
              sx={{
                minWidth: "102px",
              }}
              onClick={() => onOkQortalRequest("accepted")}
            >
              accept
            </CustomButton>
            <CustomButton
              sx={{
                minWidth: "102px",
              }}
              onClick={() => onCancelQortalRequest()}
            >
              decline
            </CustomButton>
          </Box>
          <ErrorText>{sendPaymentError}</ErrorText>
        </>
      )}
      {extState === "web-app-request-buy-order" && !isMainWindow && (
        <>
          <Spacer height="100px" />

          <TextP
            sx={{
              textAlign: "center",
              lineHeight: "15px",
            }}
          >
            The Application <br></br>{" "}
            <TextItalic>{requestBuyOrder?.hostname}</TextItalic> <br></br>
            <TextSpan>
              is requesting {requestBuyOrder?.crosschainAtInfo?.length}{" "}
              {`buy order${
                requestBuyOrder?.crosschainAtInfo.length === 1 ? "" : "s"
              }`}
            </TextSpan>
          </TextP>
          <Spacer height="10px" />
          <TextP
            sx={{
              textAlign: "center",
              lineHeight: "24px",
              fontSize: "20px",
              fontWeight: 700,
            }}
          >
            {requestBuyOrder?.crosschainAtInfo?.reduce((latest, cur) => {
              return latest + +cur?.qortAmount;
            }, 0)}{" "}
            QORT
          </TextP>
          <Spacer height="15px" />
          <TextP
            sx={{
              textAlign: "center",
              lineHeight: "15px",
              fontSize: "14px",
            }}
          >
            FOR
          </TextP>
          <Spacer height="15px" />
          <TextP
            sx={{
              textAlign: "center",
              lineHeight: "24px",
              fontSize: "20px",
              fontWeight: 700,
            }}
          >
            {roundUpToDecimals(
              requestBuyOrder?.crosschainAtInfo?.reduce((latest, cur) => {
                return latest + +cur?.expectedForeignAmount;
              }, 0)
            )}
            {` ${requestBuyOrder?.crosschainAtInfo?.[0]?.foreignBlockchain}`}
          </TextP>
          {/* <Spacer height="29px" />

          <CustomLabel htmlFor="standard-adornment-password">
            Confirm Wallet Password
          </CustomLabel>
          <Spacer height="5px" />
          <PasswordField
            id="standard-adornment-password"
            value={paymentPassword}
            onChange={(e) => setPaymentPassword(e.target.value)}
          /> */}
          <Spacer height="29px" />
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
            }}
          >
            <CustomButton
              sx={{
                minWidth: "102px",
              }}
              onClick={() => confirmBuyOrder(false)}
            >
              accept
            </CustomButton>
            <CustomButton
              sx={{
                minWidth: "102px",
              }}
              onClick={() => confirmBuyOrder(true)}
            >
              decline
            </CustomButton>
          </Box>
          <ErrorText>{sendPaymentError}</ErrorText>
        </>
      )}

      {extState === "web-app-request-payment" && !isMainWindow && (
        <>
          <Spacer height="100px" />

          <TextP
            sx={{
              textAlign: "center",
              lineHeight: "15px",
            }}
          >
            The Application <br></br>{" "}
            <TextItalic>{sendqortState?.hostname}</TextItalic> <br></br>
            <TextSpan>is requesting a payment</TextSpan>
          </TextP>
          <Spacer height="10px" />
          <TextP
            sx={{
              textAlign: "center",
              lineHeight: "15px",
              fontSize: "10px",
            }}
          >
            {sendqortState?.description}
          </TextP>
          <Spacer height="15px" />
          <TextP
            sx={{
              textAlign: "center",
              lineHeight: "24px",
              fontSize: "20px",
              fontWeight: 700,
            }}
          >
            {sendqortState?.amount} QORT
          </TextP>
          {/* <Spacer height="29px" />

          <CustomLabel htmlFor="standard-adornment-password">
            Confirm Wallet Password
          </CustomLabel>
          <Spacer height="5px" />
          <PasswordField
            id="standard-adornment-password"
            value={paymentPassword}
            onChange={(e) => setPaymentPassword(e.target.value)}
          /> */}
          <Spacer height="29px" />
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
            }}
          >
            <CustomButton
              sx={{
                minWidth: "102px",
              }}
              onClick={() => confirmPayment(false)}
            >
              accept
            </CustomButton>
            <CustomButton
              sx={{
                minWidth: "102px",
              }}
              onClick={() => confirmPayment(true)}
            >
              decline
            </CustomButton>
          </Box>
          <ErrorText>{sendPaymentError}</ErrorText>
        </>
      )}
      {extState === "web-app-request-connection" && !isMainWindow && (
        <>
          <Spacer height="48px" />
          <div
            className="image-container"
            style={{
              width: "136px",
              height: "154px",
            }}
          >
            <img src={Logo1} className="base-image" />
            <img src={Logo1Dark} className="hover-image" />
          </div>
          <Spacer height="38px" />
          <TextP
            sx={{
              textAlign: "center",
              lineHeight: "15px",
            }}
          >
            The Application <br></br>{" "}
            <TextItalic>{requestConnection?.hostname}</TextItalic> <br></br>
            <TextSpan>is requestion a connection</TextSpan>
          </TextP>
          <Spacer height="38px" />
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
            }}
          >
            <CustomButton
              sx={{
                minWidth: "102px",
              }}
              onClick={() =>
                responseToConnectionRequest(
                  true,
                  requestConnection?.hostname,
                  requestConnection.interactionId
                )
              }
            >
              accept
            </CustomButton>
            <CustomButton
              sx={{
                minWidth: "102px",
              }}
              onClick={() =>
                responseToConnectionRequest(
                  false,
                  requestConnection?.hostname,
                  requestConnection.interactionId
                )
              }
            >
              decline
            </CustomButton>
          </Box>
        </>
      )}
      {extState === "web-app-request-authentication" && !isMainWindow && (
        <>
          <Spacer height="48px" />
          <div
            className="image-container"
            style={{
              width: "136px",
              height: "154px",
            }}
          >
            <img src={Logo1} className="base-image" />
            <img src={Logo1Dark} className="hover-image" />
          </div>
          <Spacer height="38px" />
          <TextP
            sx={{
              textAlign: "center",
              lineHeight: "15px",
            }}
          >
            The Application <br></br>{" "}
            <TextItalic>{requestConnection?.hostname}</TextItalic> <br></br>
            <TextSpan>requests authentication</TextSpan>
          </TextP>
          <Spacer height="38px" />
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
            }}
          ></Box>
          <Spacer height="38px" />
          <CustomButton {...getRootProps()}>
            <input {...getInputProps()} />
            Authenticate
          </CustomButton>
          <Spacer height="6px" />
          <CustomButton
            onClick={() => {
              setExtstate("create-wallet");
            }}
          >
            Create account
          </CustomButton>
        </>
      )}
        {extState === "wallets" && (
        <>
         <Spacer height="22px" />
          <Box
            sx={{
              display: "flex",
              width: "100%",
              justifyContent: "flex-start",
              paddingLeft: "22px",
              boxSizing: "border-box",
            }}
          >
            <img
              style={{
                cursor: "pointer",
              }}
              onClick={() => {
                setRawWallet(null);
                setExtstate("not-authenticated");
                logoutFunc();
              }}
              src={Return}
            />
          </Box>
         <Wallets setRawWallet={setRawWallet} setExtState={setExtstate} rawWallet={rawWallet} />

        </>
      )}
      {rawWallet && extState === "wallet-dropped" && (
        <>
          <Spacer height="22px" />
          <Box
            sx={{
              display: "flex",
              width: "100%",
              justifyContent: "flex-start",
              paddingLeft: "22px",
              boxSizing: "border-box",
            }}
          >
            <img
              style={{
                cursor: "pointer",
              }}
              onClick={() => {
                setRawWallet(null);
                setExtstate("wallets");
                logoutFunc();
              }}
              src={Return}
            />
          </Box>
          <Spacer height="10px" />
          <div
            className="image-container"
            style={{
              width: "136px",
              height: "154px",
            }}
          >
            <img src={Logo1} className="base-image" />
            <img src={Logo1Dark} className="hover-image" />
          </div>
          <Spacer height="35px" />
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <Typography>{rawWallet?.name ? rawWallet?.name : rawWallet?.address0}</Typography>
            <Spacer height="10px" />
            <TextP
              sx={{
                textAlign: "start",
                lineHeight: "24px",
                fontSize: "20px",
                fontWeight: 600,
              }}
            >
              Authenticate
            </TextP>
          </Box>
          <Spacer height="35px" />

          <>
            <CustomLabel htmlFor="standard-adornment-password">
              Wallet Password
            </CustomLabel>
            <Spacer height="5px" />
            <PasswordField
              id="standard-adornment-password"
              value={authenticatePassword}
              onChange={(e) => setAuthenticatePassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  authenticateWallet();
                }
              }}
            />
            <Spacer height="20px" />
            <CustomButton onClick={authenticateWallet}>
              Authenticate
            </CustomButton>
            <ErrorText>{walletToBeDecryptedError}</ErrorText>
          </>
        </>
      )}
      {extState === "download-wallet" && (
        <>
          <Spacer height="22px" />
          <Box
            sx={{
              display: "flex",
              width: "100%",
              justifyContent: "flex-start",
              paddingLeft: "22px",
              boxSizing: "border-box",
            }}
          >
            <img
              style={{
                cursor: "pointer",
              }}
              onClick={returnToMain}
              src={Return}
            />
          </Box>
          <Spacer height="10px" />
          <div
            className="image-container"
            style={{
              width: "136px",
              height: "154px",
            }}
          >
            <img src={Logo1} className="base-image" />
            <img src={Logo1Dark} className="hover-image" />
          </div>
          <Spacer height="35px" />
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
          >
            <TextP
              sx={{
                textAlign: "start",
                lineHeight: "24px",
                fontSize: "20px",
                fontWeight: 600,
              }}
            >
              Download Wallet
            </TextP>
          </Box>
          <Spacer height="35px" />
          {!walletToBeDownloaded && (
            <>
              <CustomLabel htmlFor="standard-adornment-password">
                Confirm Wallet Password
              </CustomLabel>
              <Spacer height="5px" />
              <PasswordField
                id="standard-adornment-password"
                value={walletToBeDownloadedPassword}
                onChange={(e) =>
                  setWalletToBeDownloadedPassword(e.target.value)
                }
              />
              <Spacer height="20px" />
              <CustomButton onClick={confirmPasswordToDownload}>
                Confirm password
              </CustomButton>
              <ErrorText>{walletToBeDownloadedError}</ErrorText>
            </>
          )}

          {walletToBeDownloaded && (
            <>
              <CustomButton
                onClick={async () => {
                  await saveFileToDiskFunc();
                  await showInfo({
                    message: `Keep your wallet file secure.`,
                  });
                }}
              >
                Download wallet
              </CustomButton>
            </>
          )}
        </>
      )}
      {extState === "create-wallet" && (
        <>
          {!walletToBeDownloaded && (
            <>
              <Spacer height="22px" />
              <Box
                sx={{
                  display: "flex",
                  width: "100%",
                  justifyContent: "flex-start",
                  paddingLeft: "22px",
                  boxSizing: "border-box",
                }}
              >
                <img
                  style={{
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    setExtstate("not-authenticated");
                  }}
                  src={Return}
                />
              </Box>
              <Spacer height="15px" />
              <div
                className="image-container"
                style={{
                  width: "136px",
                  height: "154px",
                }}
              >
                <img src={Logo1} className="base-image" />
                <img src={Logo1Dark} className="hover-image" />
              </div>
              <Spacer height="38px" />
              <TextP
                sx={{
                  textAlign: "center",
                  lineHeight: "15px",
                }}
              >
                Set up your Qortal account
              </TextP>
              <Spacer height="14px" />
              <Box sx={{
                display: 'flex',
                maxWidth: '100%',
                justifyContent: 'center',
                padding: '10px'
              }}>
              <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                maxWidth: '400px',
                alignItems: 'center',
                gap: '10px'
              }}>
                <Typography sx={{
                  fontSize: '14px'
                }}>Your seedphrase</Typography>
                <Typography sx={{
                  fontSize: '12px'
                }}>Only shown once! Please copy and keep safe!</Typography>

              <random-sentence-generator
              ref={generatorRef}
											template="adverb verb noun adjective noun adverb verb noun adjective noun adjective verbed adjective noun"
									
										></random-sentence-generator>
                </Box>
                </Box>
              <CustomButton sx={{
                padding: '7px',
                fontSize: '12px'
              }} onClick={exportSeedphrase}>
                Export Seedphrase
              </CustomButton>
              <Spacer height="14px" />
              <CustomLabel htmlFor="standard-adornment-password">
                Wallet Password
              </CustomLabel>
              <Spacer height="5px" />
              <PasswordField
                id="standard-adornment-password"
                value={walletToBeDownloadedPassword}
                onChange={(e) =>
                  setWalletToBeDownloadedPassword(e.target.value)
                }
              />
              <Spacer height="6px" />
              <CustomLabel htmlFor="standard-adornment-password">
                Confirm Wallet Password
              </CustomLabel>
              <Spacer height="5px" />
              <PasswordField
                id="standard-adornment-password"
                value={walletToBeDownloadedPasswordConfirm}
                onChange={(e) =>
                  setWalletToBeDownloadedPasswordConfirm(e.target.value)
                }
              />
              <Spacer height="17px" />

              <CustomButton onClick={createAccountFunc}>
                Create Account
              </CustomButton>
              <ErrorText>{walletToBeDownloadedError}</ErrorText>
            </>
          )}

          {walletToBeDownloaded && (
            <>
              <Spacer height="48px" />
              <img src={Success} />
              <Spacer height="45px" />
              <TextP
                sx={{
                  textAlign: "center",
                  lineHeight: "15px",
                }}
              >
                Congrats, you’re all set up!
              </TextP>
              <Spacer height="100px" />
              <CustomButton
                onClick={async () => {
                  await saveFileToDiskFunc();
                  returnToMain();
                  await showInfo({
                    message: `Keep your wallet file secure.`,
                  });
                }}
              >
                Backup Account
              </CustomButton>
            </>
          )}
        </>
      )}
      {isOpenSendQortSuccess && (
        <Box
          sx={{
            width: "100%",
            height: "100%",
            position: "fixed",
            background: "#27282c",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            zIndex: 6,
          }}
        >
          <Spacer height="48px" />
          <img src={Success} />
          <Spacer height="45px" />
          <TextP
            sx={{
              textAlign: "center",
              lineHeight: "15px",
            }}
          >
            The transfer was succesful!
          </TextP>
          <Spacer height="100px" />
          <CustomButton
            onClick={() => {
              returnToMain();
            }}
          >
            Continue
          </CustomButton>
        </Box>
      )}
      {extState === "transfer-success-request" && (
        <>
          <Spacer height="48px" />
          <img src={Success} />
          <Spacer height="45px" />
          <TextP
            sx={{
              textAlign: "center",
              lineHeight: "15px",
            }}
          >
            The transfer was succesful!
          </TextP>
          <Spacer height="100px" />
          <CustomButton
            onClick={() => {
              window.close();
            }}
          >
            Continue
          </CustomButton>
        </>
      )}
      {extState === "buy-order-submitted" && (
        <>
          <Spacer height="48px" />
          <img src={Success} />
          <Spacer height="45px" />
          <TextP
            sx={{
              textAlign: "center",
              lineHeight: "15px",
            }}
          >
            Your buy order was submitted
          </TextP>
          <Spacer height="100px" />
          <CustomButton
            onClick={() => {
              window.close();
            }}
          >
            Close
          </CustomButton>
        </>
      )}
      {countdown && (
        <Box
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
          }}
        >
          {/* <Spacer  height="25px"/> */}
          <CountdownCircleTimer
            isPlaying
            duration={countdown}
            colors={["#004777", "#F7B801", "#A30000", "#A30000"]}
            colorsTime={[7, 5, 2, 0]}
            onComplete={() => {
              window.close();
            }}
            size={75}
            strokeWidth={8}
          >
            {({ remainingTime }) => <TextP>{remainingTime}</TextP>}
          </CountdownCircleTimer>
        </Box>
      )}
      {isLoading && <Loader />}
      {isShow && (
        <Dialog
          open={isShow}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
        >
          <DialogTitle id="alert-dialog-title">{"Publish"}</DialogTitle>
          <DialogContent>
            <DialogContentText id="alert-dialog-description">
              {message.message}
            </DialogContentText>
            <DialogContentText id="alert-dialog-description2">
              publish fee: {message.publishFee}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={onCancel}>
              Disagree
            </Button>
            <Button variant="contained" onClick={onOk} autoFocus>
              Agree
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {isShowInfo && (
        <Dialog
          open={isShowInfo}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
        >
          <DialogTitle id="alert-dialog-title">{"Important Info"}</DialogTitle>
          <DialogContent>
            <DialogContentText id="alert-dialog-description">
              {messageInfo.message}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={onOkInfo} autoFocus>
              Close
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {isShowUnsavedChanges && (
        <Dialog
          open={isShowUnsavedChanges}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
        >
          <DialogTitle id="alert-dialog-title">{"Warning"}</DialogTitle>
          <DialogContent>
            <DialogContentText id="alert-dialog-description">
              {messageUnsavedChanges.message}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={onCancelUnsavedChanges}>
              Cancel
            </Button>
            <Button variant="contained" onClick={onOkUnsavedChanges} autoFocus>
              Continue to Logout
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {isShowQortalRequestExtension && isMainWindow && (
        <Dialog
          open={isShowQortalRequestExtension}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
        >
          <CountdownCircleTimer
            isPlaying
            duration={30}
            colors={["#004777", "#F7B801", "#A30000", "#A30000"]}
            colorsTime={[7, 5, 2, 0]}
            onComplete={() => {
              onCancelQortalRequestExtension();
            }}
            size={50}
            strokeWidth={5}
          >
            {({ remainingTime }) => <TextP>{remainingTime}</TextP>}
          </CountdownCircleTimer>
          <Box
            sx={{
              display: "flex",
              padding: "20px",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-start",
              minHeight: "400px",
              maxHeight: "90vh",
              overflow: "auto",
            }}
          >
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                width: "100%",
              }}
            >
              <TextP
                sx={{
                  lineHeight: 1.2,
                  maxWidth: "90%",
                  textAlign: "center",
                }}
              >
                {messageQortalRequestExtension?.text1}
              </TextP>
            </Box>
            {messageQortalRequestExtension?.text2 && (
              <>
                <Spacer height="10px" />
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "flex-start",
                    width: "90%",
                  }}
                >
                  <TextP
                    sx={{
                      lineHeight: 1.2,
                      fontSize: "16px",
                      fontWeight: "normal",
                    }}
                  >
                    {messageQortalRequestExtension?.text2}
                  </TextP>
                </Box>
                <Spacer height="15px" />
              </>
            )}
            {messageQortalRequestExtension?.text3 && (
              <>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "flex-start",
                    width: "90%",
                  }}
                >
                  <TextP
                    sx={{
                      lineHeight: 1.2,
                      fontSize: "16px",
                      fontWeight: "normal",
                    }}
                  >
                    {messageQortalRequestExtension?.text3}
                  </TextP>
                  <Spacer height="15px" />
                </Box>
              </>
            )}

            {messageQortalRequestExtension?.text4 && (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "flex-start",
                  width: "90%",
                }}
              >
                <TextP
                  sx={{
                    lineHeight: 1.2,
                    fontSize: "16px",
                    fontWeight: "normal",
                  }}
                >
                  {messageQortalRequestExtension?.text4}
                </TextP>
              </Box>
            )}

            {messageQortalRequestExtension?.html && (
              <div
                dangerouslySetInnerHTML={{
                  __html: messageQortalRequestExtension?.html,
                }}
              />
            )}
            <Spacer height="15px" />

            <TextP
              sx={{
                textAlign: "center",
                lineHeight: 1.2,
                fontSize: "16px",
                fontWeight: 700,
                maxWidth: "90%",
              }}
            >
              {messageQortalRequestExtension?.highlightedText}
            </TextP>

            {messageQortalRequestExtension?.json && (
              <>
                          <Spacer height="15px" />

                          <JsonView data={messageQortalRequestExtension?.json} shouldExpandNode={allExpanded} style={darkStyles} />
                          <Spacer height="15px" />

              </>
            )}

            {messageQortalRequestExtension?.fee && (
              <>
                <Spacer height="15px" />

                <TextP
                  sx={{
                    textAlign: "center",
                    lineHeight: 1.2,
                    fontSize: "16px",
                    fontWeight: "normal",
                    maxWidth: "90%",
                  }}
                >
                  {"Fee: "}
                  {messageQortalRequestExtension?.fee}
                  {" QORT"}
                </TextP>
                <Spacer height="15px" />
              </>
            )}
            {messageQortalRequestExtension?.foreignFee && (
              <>
                <Spacer height="15px" />

                <TextP
                  sx={{
                    textAlign: "center",
                    lineHeight: 1.2,
                    fontSize: "16px",
                    fontWeight: "normal",
                    maxWidth: "90%",
                  }}
                >
                  {"Foreign Fee: "}
                  {messageQortalRequestExtension?.foreignFee}
                </TextP>
                <Spacer height="15px" />
              </>
            )}
            {messageQortalRequestExtension?.checkbox1 && (
              <Box
                sx={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "90%",
                  marginTop: "20px",
                }}
              >
                <Checkbox
                  onChange={(e) => {
                    qortalRequestCheckbox1Ref.current = e.target.checked;
                  }}
                  edge="start"
                  tabIndex={-1}
                  disableRipple
                  defaultChecked={
                    messageQortalRequestExtension?.checkbox1?.value
                  }
                  sx={{
                    "&.Mui-checked": {
                      color: "white", // Customize the color when checked
                    },
                    "& .MuiSvgIcon-root": {
                      color: "white",
                    },
                  }}
                />

                <Typography
                  sx={{
                    fontSize: "14px",
                  }}
                >
                  {messageQortalRequestExtension?.checkbox1?.label}
                </Typography>
              </Box>
            )}

            <Spacer height="29px" />
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
              }}
            >
              <CustomButton
                sx={{
                  minWidth: "102px",
                }}
                onClick={() => onOkQortalRequestExtension("accepted")}
              >
                accept
              </CustomButton>
              <CustomButton
                sx={{
                  minWidth: "102px",
                }}
                onClick={() => onCancelQortalRequestExtension()}
              >
                decline
              </CustomButton>
            </Box>
            <ErrorText>{sendPaymentError}</ErrorText>
          </Box>
        </Dialog>
      )}
      <Popover
        open={openRegisterName}
        anchorEl={registerNamePopoverRef.current}
        onClose={() => {
          setOpenRegisterName(false);
          setRegisterNameValue("");
        }}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "center",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "center",
        }}
        style={{ marginTop: "8px" }}
      >
        <Box
          sx={{
            width: "325px",
            height: "250px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "10px",
            padding: "10px",
          }}
        >
          <Label>Choose a name</Label>
          <Input
            onChange={(e) => setRegisterNameValue(e.target.value)}
            value={registerNameValue}
            placeholder="Choose a name"
          />
          <Spacer height="25px" />
          <LoadingButton
            loading={isLoadingRegisterName}
            loadingPosition="start"
            variant="contained"
            disabled={!registerNameValue}
            onClick={registerName}
          >
            Register Name
          </LoadingButton>
        </Box>
      </Popover>
      {isSettingsOpen && (
        <Settings open={isSettingsOpen} setOpen={setIsSettingsOpen} />
      )}
      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
      <DrawerComponent
        open={isOpenDrawerProfile}
        setOpen={setIsOpenDrawerProfile}
      >
        {renderProfile()}
      </DrawerComponent>
    </AppContainer>
  );
}

export default App;
