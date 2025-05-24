import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDropzone } from 'react-dropzone';
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
  FormControlLabel,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { JsonView, allExpanded, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { decryptStoredWallet } from './utils/decryptWallet';
import { CountdownCircleTimer } from 'react-countdown-circle-timer';
import Logo1Dark from './assets/svgs/Logo1Dark.svg';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import ltcLogo from './assets/ltc.png';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import qortLogo from './assets/qort.png';
import { Return } from './assets/Icons/Return.tsx';
import WarningIcon from '@mui/icons-material/Warning';
import './utils/seedPhrase/RandomSentenceGenerator';
import EngineeringIcon from '@mui/icons-material/Engineering';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import {
  createAccount,
  saveFileToDisk,
  saveSeedPhraseToDisk,
} from './utils/generateWallet/generateWallet';
import { crypto, walletVersion } from './constants/decryptWallet';
import PhraseWallet from './utils/generateWallet/phrase-wallet';
import {
  AddressBox,
  AppContainer,
  AuthenticatedContainer,
  AuthenticatedContainerInnerLeft,
  AuthenticatedContainerInnerRight,
  CustomButton,
  CustomButtonAccept,
  CustomLabel,
  TextItalic,
  TextP,
  TextSpan,
} from './styles/App-styles.ts';
import { Spacer } from './common/Spacer';
import { Loader } from './components/Loader';
import { PasswordField, ErrorText } from './components';
import { Group, requestQueueMemberNames } from './components/Group/Group';
import { TaskManager } from './components/TaskManager/TaskManager.tsx';
import { useModal } from './common/useModal';
import { CustomizedSnackbars } from './components/Snackbar/Snackbar';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import HelpIcon from '@mui/icons-material/Help';
import {
  cleanUrl,
  getProtocol,
  getWallets,
  groupApi,
  groupApiSocket,
  storeWallets,
} from './background';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from './utils/events';
import {
  requestQueueCommentCount,
  requestQueuePublishedAccouncements,
} from './components/Chat/GroupAnnouncements';
import { requestQueueGroupJoinRequests } from './components/Group/GroupJoinRequests';
import { DrawerComponent } from './components/Drawer/Drawer';
import { AddressQRCode } from './components/AddressQRCode';
import { Settings } from './components/Group/Settings';
import { MainAvatar } from './components/MainAvatar';
import { useRetrieveDataLocalStorage } from './hooks/useRetrieveDataLocalStorage.tsx';
import { useQortalGetSaveSettings } from './hooks/useQortalGetSaveSettings.tsx';
import {
  canSaveSettingToQdnAtom,
  enabledDevModeAtom,
  groupAnnouncementsAtom,
  groupChatTimestampsAtom,
  groupsOwnerNamesAtom,
  groupsPropertiesAtom,
  hasSettingsChangedAtom,
  isDisabledEditorEnterAtom,
  isRunningPublicNodeAtom,
  isUsingImportExportSettingsAtom,
  lastPaymentSeenTimestampAtom,
  mailsAtom,
  memberGroupsAtom,
  mutedGroupsAtom,
  oldPinnedAppsAtom,
  qMailLastEnteredTimestampAtom,
  settingsLocalLastUpdatedAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
  timestampEnterDataAtom,
  txListAtom,
} from './atoms/global';
import { NotAuthenticated } from './components/NotAuthenticated.tsx';
import { handleGetFileFromIndexedDB } from './utils/indexedDB';
import { Wallets } from './Wallets';
import { useFetchResources } from './common/useFetchResources';
import { Tutorials } from './components/Tutorials/Tutorials';
import { useHandleTutorials } from './hooks/useHandleTutorials.tsx';
import { useHandleUserInfo } from './hooks/useHandleUserInfo.tsx';
import { Minting } from './components/Minting/Minting';
import { isRunningGateway } from './qortalRequests';
import { QMailStatus } from './components/QMailStatus';
import { GlobalActions } from './components/GlobalActions/GlobalActions';
import { useBlockedAddresses } from './hooks/useBlockUsers.tsx';
import { WalletIcon } from './assets/Icons/WalletIcon';
import { UserLookup } from './components/UserLookup.tsx/UserLookup';
import { RegisterName } from './components/RegisterName';
import { BuyQortInformation } from './components/BuyQortInformation';
import { QortPayment } from './components/QortPayment';
import { GeneralNotifications } from './components/GeneralNotifications';
import { PdfViewer } from './common/PdfViewer';
import ThemeSelector from './components/Theme/ThemeSelector.tsx';
import { Trans, useTranslation } from 'react-i18next';
import LanguageSelector from './components/Language/LanguageSelector.tsx';
import { DownloadWallet } from './components/Auth/DownloadWallet.tsx';
import { CopyIcon } from './assets/Icons/CopyIcon.tsx';
import { SuccessIcon } from './assets/Icons/SuccessIcon.tsx';
import { useAtom, useSetAtom } from 'jotai';
import { useResetAtom } from 'jotai/utils';

type extStates =
  | 'authenticated'
  | 'buy-order-submitted'
  | 'create-wallet'
  | 'download-wallet'
  | 'group'
  | 'not-authenticated'
  | 'send-qort'
  | 'transfer-success-regular'
  | 'transfer-success-request'
  | 'wallet-dropped'
  | 'wallets'
  | 'web-app-request-authentication'
  | 'web-app-request-buy-order'
  | 'web-app-request-connection'
  | 'web-app-request-payment';

interface MyContextInterface {
  isShow: boolean;
  onCancel: () => void;
  onOk: () => void;
  show: () => void;
  message: any;
}

const defaultValues: MyContextInterface = {
  isShow: false,
  onCancel: () => {},
  onOk: () => {},
  show: () => {},
  message: {
    publishFee: '',
    message: '',
  },
};

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
      if (typeof val[action] === 'function') {
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
  controlAllQueues('pause');
  window.sendMessage('pauseAllQueues', {}).catch((error) => {
    console.error(
      'Failed to pause all queues:',
      error.message || 'An error occurred'
    );
  });
};

export const resumeAllQueues = () => {
  controlAllQueues('resume');
  window.sendMessage('resumeAllQueues', {}).catch((error) => {
    console.error(
      'Failed to resume all queues:',
      error.message || 'An error occurred'
    );
  });
};

const defaultValuesGlobal = {
  openTutorialModal: null,
  setOpenTutorialModal: () => {},
};

export const QORTAL_APP_CONTEXT =
  createContext<MyContextInterface>(defaultValues);

export let globalApiKey: string | null = null;

export const getBaseApiReact = (customApi?: string) => {
  if (customApi) {
    return customApi;
  }

  if (globalApiKey?.url) {
    return globalApiKey?.url;
  } else {
    return groupApi;
  }
};

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

  if (globalApiKey?.url) {
    return `${
      getProtocol(globalApiKey?.url) === 'http' ? 'ws://' : 'wss://'
    }${cleanUrl(globalApiKey?.url)}`;
  } else {
    return groupApiSocket;
  }
};

export const isMainWindow = true;

function App() {
  const [extState, setExtstate] = useState<extStates>('not-authenticated');
  const [desktopViewMode, setDesktopViewMode] = useState('home');
  const [backupjson, setBackupjson] = useState<any>(null);
  const [rawWallet, setRawWallet] = useState<any>(null);
  const [ltcBalanceLoading, setLtcBalanceLoading] = useState<boolean>(false);
  const [qortBalanceLoading, setQortBalanceLoading] = useState<boolean>(false);
  const [decryptedWallet, setdecryptedWallet] = useState<any>(null);
  const [requestConnection, setRequestConnection] = useState<any>(null);
  const [requestBuyOrder, setRequestBuyOrder] = useState<any>(null);
  const [authenticatedMode, setAuthenticatedMode] = useState('qort');
  const [requestAuthentication, setRequestAuthentication] = useState<any>(null);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [ltcBalance, setLtcBalance] = useState<any>(null);
  const [paymentTo, setPaymentTo] = useState<string>('');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentPassword, setPaymentPassword] = useState<string>('');
  const [sendPaymentError, setSendPaymentError] = useState<string>('');
  const [sendPaymentSuccess, setSendPaymentSuccess] = useState<string>('');
  const [countdown, setCountdown] = useState<null | number>(null);
  const [walletToBeDownloaded, setWalletToBeDownloaded] = useState<any>(null);
  const [walletToBeDownloadedPassword, setWalletToBeDownloadedPassword] =
    useState<string>('');
  const [isMain, setIsMain] = useState<boolean>(true);
  const isMainRef = useRef(false);
  const [authenticatePassword, setAuthenticatePassword] = useState<string>('');
  const [sendqortState, setSendqortState] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingSendCoin, setIsLoadingSendCoin] = useState<boolean>(false);

  const { t } = useTranslation(['auth', 'core', 'group']);
  const theme = useTheme();

  const [
    walletToBeDownloadedPasswordConfirm,
    setWalletToBeDownloadedPasswordConfirm,
  ] = useState<string>('');

  const [walletToBeDownloadedError, setWalletToBeDownloadedError] =
    useState<string>('');

  const [walletToBeDecryptedError, setWalletToBeDecryptedError] =
    useState<string>('');

  const [isFocused, setIsFocused] = useState(true);

  const [hasSettingsChanged, setHasSettingsChanged] = useAtom(
    hasSettingsChangedAtom
  );

  const balanceSetIntervalRef = useRef(null);
  const downloadResource = useFetchResources();
  const holdRefExtState = useRef<extStates>('not-authenticated');
  const isFocusedRef = useRef<boolean>(true);

  const {
    showTutorial,
    openTutorialModal,
    shownTutorialsInitiated,
    setOpenTutorialModal,
    hasSeenGettingStarted,
  } = useHandleTutorials();

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

  const setIsRunningPublicNode = useSetAtom(isRunningPublicNodeAtom);

  const [infoSnack, setInfoSnack] = useState(null);
  const [openSnack, setOpenSnack] = useState(false);
  const [hasLocalNode, setHasLocalNode] = useState(false);
  const [isOpenDrawerProfile, setIsOpenDrawerProfile] = useState(false);
  const [isOpenDrawerLookup, setIsOpenDrawerLookup] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [isOpenSendQort, setIsOpenSendQort] = useState(false);
  const [isOpenSendQortSuccess, setIsOpenSendQortSuccess] = useState(false);

  const {
    isUserBlocked,
    addToBlockList,
    removeBlockFromList,
    getAllBlockedUsers,
  } = useBlockedAddresses();

  const [currentNode, setCurrentNode] = useState({
    url: 'http://127.0.0.1:12391',
  });

  const [useLocalNode, setUseLocalNode] = useState(false);

  const [confirmRequestRead, setConfirmRequestRead] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const [creationStep, setCreationStep] = useState(1);
  const getIndividualUserInfo = useHandleUserInfo();
  const qortalRequestCheckbox1Ref = useRef(null);
  useRetrieveDataLocalStorage(userInfo?.address);
  useQortalGetSaveSettings(userInfo?.name, extState === 'authenticated');
  const setIsEnabledDevMode = useSetAtom(enabledDevModeAtom);

  const setIsDisabledEditorEnter = useSetAtom(isDisabledEditorEnterAtom);

  const [isOpenMinting, setIsOpenMinting] = useState(false);
  const generatorRef = useRef(null);

  const exportSeedphrase = () => {
    const seedPhrase = generatorRef.current.parsedString;
    saveSeedPhraseToDisk(seedPhrase);
  };

  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (extState === 'wallet-dropped' && passwordRef.current) {
      passwordRef.current.focus();
    }
  }, [extState]);

  useEffect(() => {
    const isDevModeFromStorage = localStorage.getItem('isEnabledDevMode');
    if (isDevModeFromStorage) {
      setIsEnabledDevMode(JSON.parse(isDevModeFromStorage));
    }
  }, []);

  useEffect(() => {
    isRunningGateway()
      .then((res) => {
        setIsRunningPublicNode(res);
      })
      .catch((error) => {
        console.error(error);
      });
  }, [extState]);

  useEffect(() => {
    if (!shownTutorialsInitiated) return;
    if (extState === 'not-authenticated') {
      showTutorial('create-account');
    } else if (extState === 'create-wallet' && walletToBeDownloaded) {
      showTutorial('important-information');
    } else if (extState === 'authenticated') {
      showTutorial('getting-started');
    }
  }, [extState, walletToBeDownloaded, shownTutorialsInitiated]);

  //resets for recoil
  const resetAtomSortablePinnedAppsAtom = useResetAtom(sortablePinnedAppsAtom);
  const resetAtomIsUsingImportExportSettingsAtom = useResetAtom(
    isUsingImportExportSettingsAtom
  );
  const resetAtomCanSaveSettingToQdnAtom = useResetAtom(
    canSaveSettingToQdnAtom
  );
  const resetAtomSettingsQDNLastUpdatedAtom = useResetAtom(
    settingsQDNLastUpdatedAtom
  );
  const resetAtomSettingsLocalLastUpdatedAtom = useResetAtom(
    settingsLocalLastUpdatedAtom
  );
  const resetAtomOldPinnedAppsAtom = useResetAtom(oldPinnedAppsAtom);
  const resetAtomQMailLastEnteredTimestampAtom = useResetAtom(
    qMailLastEnteredTimestampAtom
  );
  const resetAtomMailsAtom = useResetAtom(mailsAtom);
  const resetGroupPropertiesAtom = useResetAtom(groupsPropertiesAtom);
  const resetLastPaymentSeenTimestampAtom = useResetAtom(
    lastPaymentSeenTimestampAtom
  );
  const resetGroupsOwnerNamesAtom = useResetAtom(groupsOwnerNamesAtom);
  const resetGroupAnnouncementsAtom = useResetAtom(groupAnnouncementsAtom);
  const resetMutedGroupsAtom = useResetAtom(mutedGroupsAtom);
  const resetGroupChatTimestampsAtom = useResetAtom(groupChatTimestampsAtom);
  const resetTimestampEnterAtom = useResetAtom(timestampEnterDataAtom);
  const resettxListAtomAtom = useResetAtom(txListAtom);
  const resetmemberGroupsAtomAtom = useResetAtom(memberGroupsAtom);

  const resetAllRecoil = () => {
    resetAtomSortablePinnedAppsAtom();
    resetAtomCanSaveSettingToQdnAtom();
    resetAtomSettingsQDNLastUpdatedAtom();
    resetAtomSettingsLocalLastUpdatedAtom();
    resetAtomOldPinnedAppsAtom();
    resetAtomIsUsingImportExportSettingsAtom();
    resetAtomQMailLastEnteredTimestampAtom();
    resetAtomMailsAtom();
    resetGroupPropertiesAtom();
    resetLastPaymentSeenTimestampAtom();
    resetGroupsOwnerNamesAtom();
    resetGroupAnnouncementsAtom();
    resetMutedGroupsAtom();
    resetGroupChatTimestampsAtom();
    resetTimestampEnterAtom();
    resettxListAtomAtom();
    resetmemberGroupsAtomAtom();
  };

  const contextValue = useMemo(
    () => ({
      isShow,
      onCancel,
      onOk,
      show,
      userInfo,
      message,
      showInfo,
      openSnackGlobal: openSnack,
      setOpenSnackGlobal: setOpenSnack,
      infoSnackCustom: infoSnack,
      setInfoSnackCustom: setInfoSnack,
      downloadResource,
      getIndividualUserInfo,
      isUserBlocked,
      addToBlockList,
      removeBlockFromList,
      getAllBlockedUsers,
      showTutorial,
      openTutorialModal,
      setOpenTutorialModal,
      hasSeenGettingStarted,
    }),
    [
      isShow,
      onCancel,
      onOk,
      show,
      userInfo,
      message,
      showInfo,
      openSnack,
      setOpenSnack,
      infoSnack,
      setInfoSnack,
      downloadResource,
      getIndividualUserInfo,
      isUserBlocked,
      addToBlockList,
      removeBlockFromList,
      getAllBlockedUsers,
      showTutorial,
      openTutorialModal,
      setOpenTutorialModal,
      hasSeenGettingStarted,
    ]
  );

  const handleSetGlobalApikey = (key) => {
    globalApiKey = key;
  };

  useEffect(() => {
    try {
      setIsLoading(true);
      window
        .sendMessage('getApiKey')
        .then((response) => {
          if (response) {
            handleSetGlobalApikey(response);
            setApiKey(response);
          }
        })
        .catch((error) => {
          console.error(
            'Failed to get API key:',
            error?.message || 'An error occurred'
          );
        })
        .finally(() => {
          window
            .sendMessage('getWalletInfo')
            .then((response) => {
              if (response && response?.walletInfo) {
                setRawWallet(response?.walletInfo);
                if (
                  holdRefExtState.current === 'web-app-request-payment' ||
                  holdRefExtState.current === 'web-app-request-connection' ||
                  holdRefExtState.current === 'web-app-request-buy-order'
                )
                  return;
                if (response?.hasKeyPair) {
                  setExtstate('authenticated');
                } else {
                  setExtstate('wallet-dropped');
                }
              }
            })
            .catch((error) => {
              console.error('Failed to get wallet info:', error);
            });
        });
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => {
    if (extState) {
      holdRefExtState.current = extState;
    }
  }, [extState]);

  useEffect(() => {
    try {
      const val = localStorage.getItem('settings-disable-editor-enter');
      if (val) {
        const parsedVal = JSON.parse(val);
        if (parsedVal === false || parsedVal === true) {
          setIsDisabledEditorEnter(parsedVal);
        }
      }
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  const address = useMemo(() => {
    if (!rawWallet?.address0) return '';
    return rawWallet.address0;
  }, [rawWallet]);
  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      'application/json': ['.json'], // Only accept JSON files
    },
    maxFiles: 1,
    onDrop: async (acceptedFiles) => {
      const file: any = acceptedFiles[0];
      const fileContents = await new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onabort = () => reject('File reading was aborted');
        reader.onerror = () => reject('File reading has failed');
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
        if (typeof fileContents !== 'string') return;
        pf = JSON.parse(fileContents);
      } catch (e) {
        console.log(error);
      }

      try {
        const requiredFields = [
          'address0',
          'salt',
          'iv',
          'version',
          'encryptedSeed',
          'mac',
          'kdfThreads',
        ];
        for (const field of requiredFields) {
          if (!(field in pf))
            throw new Error(
              t('auth:message.error.field_not_found_json', {
                field: field,
                postProcess: 'capitalizeFirstChar',
              })
            );
        }
        setRawWallet(pf);
        setExtstate('wallet-dropped');
        setdecryptedWallet(null);
      } catch (e) {
        console.log(e);
      }
    },
  });

  const saveWalletFunc = async (password: string) => {
    let wallet = structuredClone(rawWallet);

    const res = await decryptStoredWallet(password, wallet);
    const wallet2 = new PhraseWallet(res, wallet?.version || walletVersion);
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

  const balanceSetInterval = () => {
    try {
      if (balanceSetIntervalRef?.current) {
        clearInterval(balanceSetIntervalRef?.current);
      }

      let isCalling = false;
      balanceSetIntervalRef.current = setInterval(async () => {
        if (isCalling) return;
        isCalling = true;
        window
          .sendMessage('balance')
          .then((response) => {
            if (!response?.error && !isNaN(+response)) {
              setBalance(response);
            }
            isCalling = false;
          })
          .catch((error) => {
            console.error('Failed to get balance:', error);
            isCalling = false;
          });
      }, 40000);
    } catch (error) {
      console.error(error);
    }
  };

  const getBalanceFunc = () => {
    setQortBalanceLoading(true);
    window
      .sendMessage('balance')
      .then((response) => {
        if (!response?.error && !isNaN(+response)) {
          setBalance(response);
        }

        setQortBalanceLoading(false);
      })
      .catch((error) => {
        console.error('Failed to get balance:', error);
        setQortBalanceLoading(false);
      })
      .finally(() => {
        balanceSetInterval();
      });
  };
  const getLtcBalanceFunc = () => {
    setLtcBalanceLoading(true);
    window
      .sendMessage('ltcBalance')
      .then((response) => {
        if (!response?.error && !isNaN(+response)) {
          setLtcBalance(response);
        }
        setLtcBalanceLoading(false);
      })
      .catch((error) => {
        console.error('Failed to get LTC balance:', error);
        setLtcBalanceLoading(false);
      });
  };

  const clearAllStates = () => {
    setRequestConnection(null);
    setRequestAuthentication(null);
  };

  const qortalRequestPermissonFromExtension = async (message, event) => {
    if (message.action === 'QORTAL_REQUEST_PERMISSION') {
      try {
        if (message?.payload?.checkbox1) {
          qortalRequestCheckbox1Ref.current =
            message?.payload?.checkbox1?.value || false;
        }
        setConfirmRequestRead(false);
        await showQortalRequestExtension(message?.payload);

        if (qortalRequestCheckbox1Ref.current) {
          event.source.postMessage(
            {
              action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
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
            action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
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
            action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
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

      if (message?.action === 'CHECK_FOCUS') {
        event.source.postMessage(
          { action: 'CHECK_FOCUS_RESPONSE', isFocused: isFocusedRef.current },
          event.origin
        );
      } else if (message.action === 'NOTIFICATION_OPEN_DIRECT') {
        executeEvent('openDirectMessage', {
          from: message.payload.from,
        });
      } else if (message.action === 'NOTIFICATION_OPEN_GROUP') {
        executeEvent('openGroupMessage', {
          from: message.payload.from,
        });
      } else if (message.action === 'NOTIFICATION_OPEN_ANNOUNCEMENT_GROUP') {
        executeEvent('openGroupAnnouncement', {
          from: message.payload.from,
        });
      } else if (message.action === 'NOTIFICATION_OPEN_THREAD_NEW_POST') {
        executeEvent('openThreadNewPost', {
          data: message.payload.data,
        });
      } else if (
        message.action === 'QORTAL_REQUEST_PERMISSION' &&
        message?.isFromExtension
      ) {
        qortalRequestPermissonFromExtension(message, event);
      } else if (message?.action === 'getFileFromIndexedDB') {
        handleGetFileFromIndexedDB(event);
      }
    };

    // Attach the event listener
    window.addEventListener('message', messageHandler);

    // Clean up the event listener on component unmount
    return () => {
      window.removeEventListener('message', messageHandler);
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
        .sendMessage('userInfo')
        .then((response) => {
          if (response && !response.error) {
            setUserInfo(response);
          }
        })
        .catch((error) => {
          console.error('Failed to get user info:', error);
        });

      getBalanceFunc();
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    if (!address) return;
    getUserInfo();
  }, [address]);

  useEffect(() => {
    return () => {
      console.log('exit');
    };
  }, []);

  useEffect(() => {
    if (
      authenticatedMode === 'ltc' &&
      !ltcBalanceLoading &&
      ltcBalance === null
    ) {
      getLtcBalanceFunc();
    }
  }, [authenticatedMode]);

  const saveFileToDiskFunc = async () => {
    try {
      await saveFileToDisk(
        walletToBeDownloaded.wallet,
        walletToBeDownloaded.qortAddress
      );
    } catch (error: any) {
      setWalletToBeDownloadedError(error?.message);
    }
  };

  const saveWalletToLocalStorage = async (newWallet) => {
    try {
      getWallets()
        .then((res) => {
          if (res && Array.isArray(res)) {
            const wallets = [...res, newWallet];
            storeWallets(wallets);
          } else {
            storeWallets([newWallet]);
          }
          setIsLoading(false);
        })
        .catch((error) => {
          console.error(error);
          setIsLoading(false);
        });
    } catch (error) {
      console.error(error);
    }
  };

  const createAccountFunc = async () => {
    try {
      if (!walletToBeDownloadedPassword) {
        setWalletToBeDownloadedError(
          t('core:message.generic.password_enter', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        return;
      }
      if (!walletToBeDownloadedPasswordConfirm) {
        setWalletToBeDownloadedError(
          t('core:message.generic.password_confirm', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        return;
      }
      if (
        walletToBeDownloadedPasswordConfirm !== walletToBeDownloadedPassword
      ) {
        setWalletToBeDownloadedError(
          t('core:message.error.password_not_matching', {
            postProcess: 'capitalizeFirstChar',
          })
        );
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
        .sendMessage('decryptWallet', {
          password: walletToBeDownloadedPassword,
          wallet,
        })
        .then((response) => {
          if (response && !response.error) {
            setRawWallet(wallet);
            saveWalletToLocalStorage(wallet);
            setWalletToBeDownloaded({
              wallet,
              qortAddress: wallet.address0,
            });

            window
              .sendMessage('userInfo')
              .then((response2) => {
                setIsLoading(false);
                if (response2 && !response2.error) {
                  setUserInfo(response2);
                }
              })
              .catch((error) => {
                setIsLoading(false);
                console.error('Failed to get user info:', error);
              });

            getBalanceFunc();
          } else if (response?.error) {
            setIsLoading(false);
            setWalletToBeDecryptedError(response.error);
          }
        })
        .catch((error) => {
          setIsLoading(false);
          console.error('Failed to decrypt wallet:', error);
        });
    } catch (error: any) {
      setWalletToBeDownloadedError(error?.message);
      setIsLoading(false);
    }
  };

  const logoutFunc = useCallback(async () => {
    try {
      if (extState === 'authenticated') {
        await showUnsavedChanges({
          message: t('core:message.question.logout', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
      }
      window
        .sendMessage('logout', {})
        .then((response) => {
          if (response) {
            executeEvent('logout-event', {});
            resetAllStates();
          }
        })
        .catch((error) => {
          console.error(
            'Failed to log out:',
            error.message || 'An error occurred'
          );
        });
    } catch (error) {
      console.log(error);
    }
  }, [hasSettingsChanged, extState]);

  const returnToMain = () => {
    setPaymentTo('');
    setPaymentAmount(0);
    setPaymentPassword('');
    setSendPaymentError('');
    setSendPaymentSuccess('');
    setCountdown(null);
    setWalletToBeDownloaded(null);
    setWalletToBeDownloadedPassword('');
    setShowSeed(false);
    setCreationStep(1);
    setExtstate('authenticated');
    setIsOpenSendQort(false);
    setIsOpenSendQortSuccess(false);
  };

  const resetAllStates = () => {
    setExtstate('not-authenticated');
    setAuthenticatedMode('qort');
    setBackupjson(null);
    setRawWallet(null);
    setdecryptedWallet(null);
    setRequestConnection(null);
    setRequestBuyOrder(null);
    setRequestAuthentication(null);
    setUserInfo(null);
    setBalance(null);
    setLtcBalance(null);
    setPaymentTo('');
    setPaymentAmount(0);
    setPaymentPassword('');
    setSendPaymentError('');
    setSendPaymentSuccess('');
    setCountdown(null);
    setWalletToBeDownloaded(null);
    setWalletToBeDownloadedPassword('');
    setShowSeed(false);
    setCreationStep(1);
    setWalletToBeDownloadedPasswordConfirm('');
    setWalletToBeDownloadedError('');
    setSendqortState(null);
    setHasLocalNode(false);
    resetAllRecoil();
    if (balanceSetIntervalRef?.current) {
      clearInterval(balanceSetIntervalRef?.current);
    }
  };

  function roundUpToDecimals(number, decimals = 8) {
    const factor = Math.pow(10, decimals); // Create a factor based on the number of decimals
    return Math.ceil(+number * factor) / factor;
  }

  const authenticateWallet = async () => {
    try {
      setIsLoading(true);
      setWalletToBeDecryptedError('');
      await new Promise<void>((res) => {
        setTimeout(() => {
          res();
        }, 250);
      });
      window
        .sendMessage(
          'decryptWallet',
          {
            password: authenticatePassword,
            wallet: rawWallet,
          },
          120000
        )
        .then((response) => {
          if (response && !response.error) {
            setAuthenticatePassword('');
            setExtstate('authenticated');
            setWalletToBeDecryptedError('');

            window
              .sendMessage('userInfo')
              .then((response) => {
                setIsLoading(false);
                if (response && !response.error) {
                  setUserInfo(response);
                }
              })
              .catch((error) => {
                setIsLoading(false);
                console.error('Failed to get user info:', error);
              });

            getBalanceFunc();

            window
              .sendMessage('getWalletInfo')
              .then((response) => {
                if (response && response.walletInfo) {
                  setRawWallet(response.walletInfo);
                }
              })
              .catch((error) => {
                console.error('Failed to get wallet info:', error);
              });
          } else if (response?.error) {
            setIsLoading(false);
            setWalletToBeDecryptedError(response.error);
          }
        })
        .catch((error) => {
          setIsLoading(false);
          console.error('Failed to decrypt wallet:', error);
        });
    } catch (error) {
      setWalletToBeDecryptedError(
        t('core:message.error.password_wrong', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  };

  useEffect(() => {
    if (!isMainWindow) return;
    // Handler for when the window gains focus
    const handleFocus = () => {
      setIsFocused(true);
    };

    // Handler for when the window loses focus
    const handleBlur = () => {
      setIsFocused(false);
    };

    // Attach the event listeners
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    // Optionally, listen for visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setIsFocused(true);
      } else {
        setIsFocused(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup the event listeners on component unmount
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const openGlobalSnackBarFunc = (e) => {
    const message = e.detail?.message;
    const type = e.detail?.type;
    setOpenSnack(true);
    setInfoSnack({
      type,
      message,
    });
  };

  useEffect(() => {
    subscribeToEvent('openGlobalSnackBar', openGlobalSnackBarFunc);

    return () => {
      unsubscribeFromEvent('openGlobalSnackBar', openGlobalSnackBarFunc);
    };
  }, []);

  const openPaymentInternal = (e) => {
    const directAddress = e.detail?.address;
    const name = e.detail?.name;
    setIsOpenSendQort(true);
    setPaymentTo(name || directAddress);
  };

  useEffect(() => {
    subscribeToEvent('openPaymentInternal', openPaymentInternal);

    return () => {
      unsubscribeFromEvent('openPaymentInternal', openPaymentInternal);
    };
  }, []);

  const renderProfileLeft = () => {
    return (
      <AuthenticatedContainerInnerLeft
        sx={{
          minWidth: '225px',
          overflowY: 'auto',
          padding: '0px 20px',
        }}
      >
        <Spacer height="20px" />

        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-start',
            width: '100%',
          }}
        >
          {authenticatedMode === 'qort' && (
            <Tooltip
              title={
                <span style={{ fontSize: '14px', fontWeight: 700 }}>
                  {t('core:wallet.litecoin', { postProcess: 'capitalizeAll' })}
                </span>
              }
              placement="left"
              arrow
              sx={{ fontSize: '24' }}
              slotProps={{
                tooltip: {
                  sx: {
                    color: theme.palette.text.primary,
                    backgroundColor: theme.palette.background.default,
                  },
                },
                arrow: {
                  sx: {
                    color: theme.palette.text.primary,
                  },
                },
              }}
            >
              <img
                onClick={() => {
                  setAuthenticatedMode('ltc');
                }}
                src={ltcLogo}
                style={{
                  cursor: 'pointer',
                  height: 'auto',
                  width: '20px',
                }}
              />
            </Tooltip>
          )}
          {authenticatedMode === 'ltc' && (
            <Tooltip
              title={
                <span style={{ fontSize: '14px', fontWeight: 700 }}>
                  {t('core:wallet.qortal', { postProcess: 'capitalizeAll' })}
                </span>
              }
              placement="left"
              arrow
              sx={{ fontSize: '24' }}
              slotProps={{
                tooltip: {
                  sx: {
                    color: theme.palette.text.primary,
                    backgroundColor: theme.palette.background.default,
                  },
                },
                arrow: {
                  sx: {
                    color: theme.palette.text.primary,
                  },
                },
              }}
            >
              <img
                onClick={() => {
                  setAuthenticatedMode('qort');
                }}
                src={qortLogo}
                style={{
                  cursor: 'pointer',
                  width: '20px',
                  height: 'auto',
                }}
              />
            </Tooltip>
          )}
        </Box>

        <Spacer height="48px" />

        {authenticatedMode === 'ltc' ? (
          <>
            <img src={ltcLogo} />

            <Spacer height="32px" />

            <ButtonBase
              onClick={() => {
                if (rawWallet?.ltcAddress) {
                  navigator.clipboard
                    .writeText(rawWallet.ltcAddress)
                    .catch((err) => {
                      console.error('Failed to copy LTC address:', err);
                    });
                }
              }}
            >
              <AddressBox>
                {rawWallet?.ltcAddress?.slice(0, 6)}...
                {rawWallet?.ltcAddress?.slice(-4)}{' '}
                <CopyIcon color={theme.palette.text.primary} />
              </AddressBox>
            </ButtonBase>

            <Spacer height="10px" />

            {ltcBalanceLoading && (
              <CircularProgress color="success" size={16} />
            )}
            {!isNaN(+ltcBalance) && !ltcBalanceLoading && (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: '10px',
                }}
              >
                <TextP
                  sx={{
                    fontSize: '20px',
                    fontWeight: 700,
                    lineHeight: '24px',
                    textAlign: 'center',
                  }}
                >
                  {ltcBalance} LTC
                </TextP>

                <RefreshIcon
                  onClick={getLtcBalanceFunc}
                  sx={{
                    fontSize: '16px',
                    cursor: 'pointer',
                  }}
                />
              </Box>
            )}
            <AddressQRCode targetAddress={rawWallet?.ltcAddress} />
          </>
        ) : (
          <>
            <MainAvatar
              setOpenSnack={setOpenSnack}
              setInfoSnack={setInfoSnack}
              myName={userInfo?.name}
              balance={balance}
            />

            <Spacer height="32px" />

            <TextP
              sx={{
                fontSize: '20px',
                lineHeight: '24px',
                textAlign: 'center',
              }}
            >
              {userInfo?.name}
            </TextP>

            <Spacer height="10px" />

            <ButtonBase
              onClick={() => {
                if (rawWallet?.address0) {
                  navigator.clipboard
                    .writeText(rawWallet.address0)
                    .catch((err) => {
                      console.error('Failed to copy address:', err);
                    });
                }
              }}
            >
              <AddressBox>
                {rawWallet?.address0?.slice(0, 6)}...
                {rawWallet?.address0?.slice(-4)}{' '}
                <CopyIcon color={theme.palette.text.primary} />
              </AddressBox>
            </ButtonBase>

            <Spacer height="10px" />

            {qortBalanceLoading && (
              <CircularProgress color="success" size={16} />
            )}

            {!qortBalanceLoading && balance >= 0 && (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: '10px',
                }}
              >
                <TextP
                  sx={{
                    fontSize: '20px',
                    fontWeight: 700,
                    lineHeight: '24px',
                    textAlign: 'center',
                  }}
                >
                  {balance?.toFixed(2)} QORT
                </TextP>

                <RefreshIcon
                  onClick={getBalanceFunc}
                  sx={{
                    fontSize: '16px',
                    cursor: 'pointer',
                  }}
                />
              </Box>
            )}

            <Spacer height="35px" />
            {userInfo && !userInfo?.name && (
              <TextP
                sx={{
                  color: 'red',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: 500,
                  lineHeight: 1.2,
                  marginTop: '10px',
                  textAlign: 'center',
                  textDecoration: 'underline',
                }}
                onClick={() => {
                  executeEvent('openRegisterName', {});
                }}
              >
                {t('core:action.register_name', {
                  postProcess: 'capitalizeAll',
                })}
              </TextP>
            )}

            <Spacer height="20px" />

            <CustomButton
              onClick={() => {
                setIsOpenSendQort(true);
                setIsOpenDrawerProfile(false);
              }}
            >
              {t('core:action.transfer_qort', {
                postProcess: 'capitalizeFirstChar',
              })}
            </CustomButton>
            <AddressQRCode targetAddress={rawWallet?.address0} />
          </>
        )}

        <TextP
          sx={{
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
            lineHeight: '24px',
            marginTop: '10px',
            textAlign: 'center',
            textDecoration: 'underline',
          }}
          onClick={async () => {
            executeEvent('addTab', {
              data: { service: 'APP', name: 'q-trade' },
            });
            executeEvent('open-apps-mode', {});
          }}
        >
          {t('core:action.get_qort_trade', {
            postProcess: 'capitalizeFirstChar',
          })}
        </TextP>
      </AuthenticatedContainerInnerLeft>
    );
  };

  const renderProfile = () => {
    return (
      <AuthenticatedContainer
        sx={{
          backgroundColor: theme.palette.background.default,
          display: 'flex',
          justifyContent: 'flex-end',
          width: 'auto',
        }}
      >
        {desktopViewMode !== 'apps' &&
          desktopViewMode !== 'dev' &&
          desktopViewMode !== 'chat' && <>{renderProfileLeft()}</>}

        <AuthenticatedContainerInnerRight
          sx={{
            borderLeft: `1px solid ${theme.palette.border.subtle}`,
            height: '100%',
            justifyContent: 'space-between',
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
            }}
          >
            <Spacer height="20px" />

            <ButtonBase
              onClick={() => {
                logoutFunc();
                setIsOpenDrawerProfile(false);
              }}
            >
              <Tooltip
                title={
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('core:action.logout')}
                  </span>
                }
                placement="left"
                arrow
                sx={{ fontSize: '24' }}
                slotProps={{
                  tooltip: {
                    sx: {
                      color: theme.palette.text.primary,
                      backgroundColor: theme.palette.background.paper,
                    },
                  },
                  arrow: {
                    sx: {
                      color: theme.palette.text.primary,
                    },
                  },
                }}
              >
                <LogoutIcon
                  sx={{
                    color: theme.palette.text.secondary,
                  }}
                />
              </Tooltip>
            </ButtonBase>

            <Spacer height="20px" />

            <ButtonBase
              onClick={() => {
                setIsSettingsOpen(true);
              }}
            >
              <Tooltip
                title={
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('core:settings')}
                  </span>
                }
                placement="left"
                arrow
                sx={{ fontSize: '24' }}
                slotProps={{
                  tooltip: {
                    sx: {
                      color: theme.palette.text.primary,
                      backgroundColor: theme.palette.background.paper,
                    },
                  },
                  arrow: {
                    sx: {
                      color: theme.palette.text.primary,
                    },
                  },
                }}
              >
                <SettingsIcon
                  sx={{
                    color: theme.palette.text.secondary,
                  }}
                />
              </Tooltip>
            </ButtonBase>

            <Spacer height="20px" />

            <ButtonBase
              onClick={() => {
                setIsOpenDrawerLookup(true);
              }}
            >
              <Tooltip
                title={
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                    }}
                  >
                    {t('core:user_lookup', {
                      postProcess: 'capitalizeAll',
                    })}
                  </span>
                }
                placement="left"
                arrow
                sx={{ fontSize: '24' }}
                slotProps={{
                  tooltip: {
                    sx: {
                      color: theme.palette.text.primary,
                      backgroundColor: theme.palette.background.paper,
                    },
                  },
                  arrow: {
                    sx: {
                      color: theme.palette.text.primary,
                    },
                  },
                }}
              >
                <PersonSearchIcon
                  sx={{
                    color: theme.palette.text.secondary,
                  }}
                />
              </Tooltip>
            </ButtonBase>

            <Spacer height="20px" />

            <ButtonBase
              onClick={() => {
                executeEvent('openWalletsApp', {});
              }}
            >
              <Tooltip
                title={
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('core:wallet.wallet_other')}
                  </span>
                }
                placement="left"
                arrow
                sx={{ fontSize: '24' }}
                slotProps={{
                  tooltip: {
                    sx: {
                      color: theme.palette.text.primary,
                      backgroundColor: theme.palette.background.paper,
                    },
                  },
                  arrow: {
                    sx: {
                      color: theme.palette.text.primary,
                    },
                  },
                }}
              >
                <AccountBalanceWalletIcon
                  sx={{
                    color: theme.palette.text.secondary,
                  }}
                />
              </Tooltip>
            </ButtonBase>

            {desktopViewMode !== 'home' && (
              <>
                <Spacer height="20px" />

                <Tooltip
                  title={
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {t('auth:account.your')}
                    </span>
                  }
                  placement="left"
                  arrow
                  sx={{ fontSize: '24' }}
                  slotProps={{
                    tooltip: {
                      sx: {
                        color: theme.palette.text.primary,
                        backgroundColor: theme.palette.background.paper,
                      },
                    },
                    arrow: {
                      sx: {
                        color: theme.palette.text.primary,
                      },
                    },
                  }}
                >
                  <ButtonBase
                    onClick={() => {
                      setIsOpenDrawerProfile(true);
                    }}
                  >
                    <WalletIcon
                      color={theme.palette.text.secondary}
                      width="25"
                    />
                  </ButtonBase>
                </Tooltip>
              </>
            )}

            <Spacer height="20px" />

            <QMailStatus />

            <Spacer height="20px" />

            {extState === 'authenticated' && (
              <GeneralNotifications address={userInfo?.address} />
            )}
          </Box>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
            }}
          >
            {extState === 'authenticated' && isMainWindow && (
              <>
                <TaskManager getUserInfo={getUserInfo} />
                <GlobalActions />
              </>
            )}

            <Spacer height="20px" />

            <ButtonBase
              onClick={async () => {
                try {
                  const res = await isRunningGateway();
                  if (res)
                    throw new Error(
                      t('core:message.generic.no_minting_details', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    );
                  setIsOpenMinting(true);
                } catch (error) {
                  setOpenSnack(true);
                  setInfoSnack({
                    type: 'error',
                    message: error?.message,
                  });
                }
              }}
            >
              <Tooltip
                title={
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('core:minting_status')}
                  </span>
                }
                placement="left"
                arrow
                sx={{ fontSize: '24' }}
                slotProps={{
                  tooltip: {
                    sx: {
                      color: theme.palette.text.primary,
                      backgroundColor: theme.palette.background.paper,
                    },
                  },
                  arrow: {
                    sx: {
                      color: theme.palette.text.primary,
                    },
                  },
                }}
              >
                <EngineeringIcon
                  sx={{
                    color: theme.palette.text.secondary,
                  }}
                />
              </Tooltip>
            </ButtonBase>

            <Spacer height="20px" />

            {(desktopViewMode === 'apps' || desktopViewMode === 'home') && (
              <ButtonBase
                onClick={() => {
                  if (desktopViewMode === 'apps') {
                    showTutorial('qapps', true);
                  } else {
                    showTutorial('getting-started', true);
                  }
                }}
              >
                <Tooltip
                  title={
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {t('core:tutorial')}
                    </span>
                  }
                  placement="left"
                  arrow
                  sx={{ fontSize: '24' }}
                  slotProps={{
                    tooltip: {
                      sx: {
                        color: theme.palette.text.primary,
                        backgroundColor: theme.palette.background.paper,
                      },
                    },
                    arrow: {
                      sx: {
                        color: theme.palette.text.primary,
                      },
                    },
                  }}
                >
                  <HelpIcon
                    sx={{
                      color: theme.palette.text.secondary,
                    }}
                  />
                </Tooltip>
              </ButtonBase>
            )}

            <Spacer height="20px" />

            <ButtonBase
              onClick={() => {
                setExtstate('download-wallet');
                setIsOpenDrawerProfile(false);
              }}
            >
              <Tooltip
                title={
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('core:action.backup_wallet')}
                  </span>
                }
                placement="left"
                arrow
                sx={{ fontSize: '24' }}
                slotProps={{
                  tooltip: {
                    sx: {
                      color: theme.palette.text.primary,
                      backgroundColor: theme.palette.background.paper,
                    },
                  },
                  arrow: {
                    sx: {
                      color: theme.palette.text.primary,
                    },
                  },
                }}
              >
                <DownloadIcon
                  sx={{
                    color: theme.palette.text.secondary,
                  }}
                />
              </Tooltip>
            </ButtonBase>
            <Spacer height="40px" />
          </Box>
        </AuthenticatedContainerInnerRight>
      </AuthenticatedContainer>
    );
  };

  return (
    <AppContainer
      sx={{
        height: '100vh',
      }}
    >
      <PdfViewer />

      <QORTAL_APP_CONTEXT.Provider value={contextValue}>
        <Tutorials />
        {extState === 'not-authenticated' && (
          <NotAuthenticated
            apiKey={apiKey}
            currentNode={currentNode}
            getInputProps={getInputProps}
            getRootProps={getRootProps}
            globalApiKey={globalApiKey}
            handleSetGlobalApikey={handleSetGlobalApikey}
            setApiKey={setApiKey}
            setCurrentNode={setCurrentNode}
            setExtstate={setExtstate}
            setUseLocalNode={setUseLocalNode}
            useLocalNode={useLocalNode}
          />
        )}
        {extState === 'authenticated' && isMainWindow && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'row',
              height: '100vh',
              width: '100vw',
            }}
          >
            <Group
              balance={balance}
              desktopViewMode={desktopViewMode}
              isFocused={isFocused}
              isMain={isMain}
              isOpenDrawerProfile={isOpenDrawerProfile}
              logoutFunc={logoutFunc}
              myAddress={address}
              setDesktopViewMode={setDesktopViewMode}
              setIsOpenDrawerProfile={setIsOpenDrawerProfile}
              userInfo={userInfo}
            />
            {renderProfile()}
          </Box>
        )}

        {isOpenSendQort && isMainWindow && (
          <Box
            sx={{
              alignItems: 'center',
              background: theme.palette.background.default,
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              position: 'fixed',
              width: '100%',
              zIndex: 10000,
            }}
          >
            <Spacer height="22px" />

            <Box
              sx={{
                boxSizing: 'border-box',
                display: 'flex',
                justifyContent: 'flex-start',
                maxWidth: '700px',
                paddingLeft: '22px',
                width: '100%',
              }}
            >
              <Return
                style={{
                  cursor: 'pointer',
                  height: '24px',
                  width: 'auto',
                }}
                onClick={returnToMain}
              />
            </Box>

            <Spacer height="35px" />

            <QortPayment
              balance={balance}
              show={show}
              onSuccess={() => {
                setIsOpenSendQort(false);
                setIsOpenSendQortSuccess(true);
              }}
              defaultPaymentTo={paymentTo}
            />
          </Box>
        )}

        {isShowQortalRequest && !isMainWindow && (
          <>
            <Spacer height="120px" />
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <TextP
                sx={{
                  lineHeight: 1.2,
                  maxWidth: '90%',
                  textAlign: 'center',
                  fontSize: '16px',
                  marginBottom: '10px',
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
                    display: 'flex',
                    justifyContent: 'flex-start',
                    width: '90%',
                  }}
                >
                  <TextP
                    sx={{
                      lineHeight: 1.2,
                      fontSize: '16px',
                      fontWeight: 'normal',
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
                    display: 'flex',
                    justifyContent: 'flex-start',
                    width: '90%',
                  }}
                >
                  <TextP
                    sx={{
                      lineHeight: 1.2,
                      fontSize: '16px',
                      fontWeight: 'normal',
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
                  display: 'flex',
                  justifyContent: 'flex-start',
                  width: '90%',
                }}
              >
                <TextP
                  sx={{
                    lineHeight: 1.2,
                    fontSize: '16px',
                    fontWeight: 'normal',
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
                fontSize: '16px',
                fontWeight: 700,
                lineHeight: 1.2,
                maxWidth: '90%',
                textAlign: 'center',
              }}
            >
              {messageQortalRequest?.highlightedText}
            </TextP>

            {messageQortalRequest?.fee && (
              <>
                <Spacer height="15px" />

                <TextP
                  sx={{
                    textAlign: 'center',
                    lineHeight: 1.2,
                    fontSize: '16px',
                    fontWeight: 'normal',
                    maxWidth: '90%',
                  }}
                >
                  {t('core:message.generic.fee_qort', {
                    message: messageQortalRequest?.fee,
                    postProcess: 'capitalizeFirstChar',
                  })}
                </TextP>

                <Spacer height="15px" />
              </>
            )}

            {messageQortalRequest?.checkbox1 && (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: '10px',
                  justifyContent: 'center',
                  marginTop: '20px',
                  width: '90%',
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
                    '&.Mui-checked': {
                      color: theme.palette.text.secondary, // Customize the color when checked
                    },
                    '& .MuiSvgIcon-root': {
                      color: theme.palette.text.secondary,
                    },
                  }}
                />

                <Typography
                  sx={{
                    fontSize: '14px',
                  }}
                >
                  {messageQortalRequest?.checkbox1?.label}
                </Typography>
              </Box>
            )}

            <Spacer height="29px" />
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
              }}
            >
              <CustomButton
                sx={{
                  minWidth: '102px',
                }}
                onClick={() => onOkQortalRequest('accepted')}
              >
                {t('core:action.accept', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </CustomButton>
              <CustomButton
                sx={{
                  minWidth: '102px',
                }}
                onClick={() => onCancelQortalRequest()}
              >
                {t('core:action.decline', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </CustomButton>
            </Box>

            <ErrorText>{sendPaymentError}</ErrorText>
          </>
        )}

        {extState === 'web-app-request-buy-order' && !isMainWindow && (
          <>
            <Spacer height="100px" />

            <TextP
              sx={{
                textAlign: 'center',
                lineHeight: '15px',
              }}
            >
              <Trans
                i18nKey="message.generic.buy_order_request"
                ns="core"
                components={{
                  br: <br />,
                  italic: <TextItalic />,
                  span: <TextSpan />,
                }}
                values={{
                  hostname: requestBuyOrder?.hostname,
                  count: requestBuyOrder?.crosschainAtInfo?.length || 0,
                }}
                tOptions={{ postProcess: ['capitalizeFirstChar'] }}
              >
                The Application <br />
                <italic>{{ hostname }}</italic> <br />
                <span>is requesting {{ count }} buy order</span>
              </Trans>
            </TextP>

            <Spacer height="10px" />

            <TextP
              sx={{
                fontSize: '20px',
                fontWeight: 700,
                lineHeight: '24px',
                textAlign: 'center',
              }}
            >
              {requestBuyOrder?.crosschainAtInfo?.reduce((latest, cur) => {
                return latest + +cur?.qortAmount;
              }, 0)}{' '}
              QORT
            </TextP>

            <Spacer height="15px" />

            <TextP
              sx={{
                textAlign: 'center',
                lineHeight: '15px',
                fontSize: '14px',
              }}
            >
              {t('core:for', { postProcess: 'capitalizeAll' })}
            </TextP>

            <Spacer height="15px" />

            <TextP
              sx={{
                textAlign: 'center',
                lineHeight: '24px',
                fontSize: '20px',
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

            <Spacer height="29px" />

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
              }}
            >
              <CustomButton
                sx={{
                  minWidth: '102px',
                }}
                onClick={() => confirmBuyOrder(false)}
              >
                {t('core:action.accept', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </CustomButton>

              <CustomButton
                sx={{
                  minWidth: '102px',
                }}
                onClick={() => confirmBuyOrder(true)}
              >
                {t('core:action.decline', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </CustomButton>
            </Box>

            <ErrorText>{sendPaymentError}</ErrorText>
          </>
        )}
        {extState === 'web-app-request-payment' && !isMainWindow && (
          <>
            <Spacer height="100px" />

            <TextP
              sx={{
                textAlign: 'center',
                lineHeight: '15px',
              }}
            >
              <Trans
                i18nKey="message.generic.payment_request"
                ns="core"
                components={{
                  br: <br />,
                  italic: <TextItalic />,
                  span: <TextSpan />,
                }}
                values={{
                  hostname: requestBuyOrder?.hostname,
                  count: requestBuyOrder?.crosschainAtInfo?.length || 0,
                }}
                tOptions={{ postProcess: ['capitalizeFirstChar'] }}
              >
                The Application <br />
                <italic>{{ hostname }}</italic> <br />
                <span>is requesting {{ count }} a payment</span>
              </Trans>
            </TextP>

            <Spacer height="10px" />

            <TextP
              sx={{
                textAlign: 'center',
                lineHeight: '15px',
                fontSize: '10px',
              }}
            >
              {sendqortState?.description}
            </TextP>

            <Spacer height="15px" />

            <TextP
              sx={{
                textAlign: 'center',
                lineHeight: '24px',
                fontSize: '20px',
                fontWeight: 700,
              }}
            >
              {sendqortState?.amount} QORT
            </TextP>

            <Spacer height="29px" />

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
              }}
            >
              <CustomButton
                sx={{
                  minWidth: '102px',
                }}
                onClick={() => confirmPayment(false)}
              >
                {t('core:action.accept', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </CustomButton>

              <CustomButton
                sx={{
                  minWidth: '102px',
                }}
                onClick={() => confirmPayment(true)}
              >
                {t('core:action.decline', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </CustomButton>
            </Box>

            <ErrorText>{sendPaymentError}</ErrorText>
          </>
        )}

        {extState === 'web-app-request-connection' && !isMainWindow && (
          <>
            <Spacer height="48px" />

            <div
              className="image-container"
              style={{
                width: '136px',
                height: '154px',
              }}
            >
              <img src={Logo1Dark} className="base-image" />
            </div>

            <Spacer height="38px" />

            <TextP
              sx={{
                textAlign: 'center',
                lineHeight: '15px',
              }}
            >
              The Application <br></br>{' '}
              <TextItalic>{requestConnection?.hostname}</TextItalic> <br></br>
              <TextSpan>is requestion a connection</TextSpan>
            </TextP>

            <Spacer height="38px" />

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
              }}
            >
              <CustomButton
                sx={{
                  minWidth: '102px',
                }}
                onClick={() =>
                  responseToConnectionRequest(
                    true,
                    requestConnection?.hostname,
                    requestConnection.interactionId
                  )
                }
              >
                {t('core:action.accept', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </CustomButton>
              <CustomButton
                sx={{
                  minWidth: '102px',
                }}
                onClick={() =>
                  responseToConnectionRequest(
                    false,
                    requestConnection?.hostname,
                    requestConnection.interactionId
                  )
                }
              >
                {t('core:action.decline', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </CustomButton>
            </Box>
          </>
        )}

        {extState === 'web-app-request-authentication' && !isMainWindow && (
          <>
            <Spacer height="48px" />

            <div
              className="image-container"
              style={{
                width: '136px',
                height: '154px',
              }}
            >
              <img src={Logo1Dark} className="base-image" />
            </div>

            <Spacer height="38px" />

            <TextP
              sx={{
                textAlign: 'center',
                lineHeight: '15px',
              }}
            >
              The Application <br></br>{' '}
              <TextItalic>{requestConnection?.hostname}</TextItalic> <br></br>
              <TextSpan>requests authentication</TextSpan>
            </TextP>

            <Spacer height="38px" />

            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: '14px',
              }}
            ></Box>

            <Spacer height="38px" />

            <CustomButton {...getRootProps()}>
              <input {...getInputProps()} />
              {t('auth:action.authenticate', {
                postProcess: 'capitalizeFirstChar',
              })}
            </CustomButton>

            <Spacer height="6px" />

            <CustomButton
              onClick={() => {
                setExtstate('create-wallet');
              }}
            >
              {t('auth:action.create_account', {
                postProcess: 'capitalizeFirstChar',
              })}
            </CustomButton>
          </>
        )}

        {extState === 'wallets' && (
          <>
            <Spacer height="22px" />

            <Box
              sx={{
                boxSizing: 'border-box',
                display: 'flex',
                justifyContent: 'flex-start',
                maxWidth: '700px',
                paddingLeft: '22px',
                width: '100%',
              }}
            >
              <Return
                style={{
                  cursor: 'pointer',
                  height: '24px',
                  width: 'auto',
                }}
                onClick={() => {
                  setRawWallet(null);
                  setExtstate('not-authenticated');
                  logoutFunc();
                }}
              />
            </Box>

            <Wallets
              setRawWallet={setRawWallet}
              setExtState={setExtstate}
              rawWallet={rawWallet}
            />
          </>
        )}

        {rawWallet && extState === 'wallet-dropped' && (
          <>
            <Spacer height="22px" />
            <Box
              sx={{
                boxSizing: 'border-box',
                display: 'flex',
                justifyContent: 'flex-start',
                maxWidth: '700px',
                paddingLeft: '22px',
                width: '100%',
              }}
            >
              <Return
                style={{
                  cursor: 'pointer',
                  height: '24px',
                  width: 'auto',
                }}
                onClick={() => {
                  setRawWallet(null);
                  setExtstate('wallets');
                  logoutFunc();
                }}
              />
            </Box>

            <Spacer height="10px" />

            <div
              className="image-container"
              style={{
                width: '136px',
                height: '154px',
              }}
            >
              <img src={Logo1Dark} className="base-image" />
            </div>

            <Spacer height="35px" />

            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Typography>
                {rawWallet?.name ? rawWallet?.name : rawWallet?.address0}
              </Typography>

              <Spacer height="10px" />

              <TextP
                sx={{
                  textAlign: 'start',
                  lineHeight: '24px',
                  fontSize: '20px',
                  fontWeight: 600,
                }}
              >
                {t('auth:action.authenticate', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </TextP>
            </Box>

            <Spacer height="35px" />

            <>
              <CustomLabel htmlFor="standard-adornment-password">
                {t('auth:wallet.password', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </CustomLabel>

              <Spacer height="10px" />

              <PasswordField
                id="standard-adornment-password"
                value={authenticatePassword}
                onChange={(e) => setAuthenticatePassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    authenticateWallet();
                  }
                }}
                ref={passwordRef}
              />
              {useLocalNode ? (
                <>
                  <Spacer height="20px" />

                  <Typography
                    sx={{
                      fontSize: '12px',
                    }}
                  >
                    {t('auth:node.using', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    : {currentNode?.url}
                  </Typography>
                </>
              ) : (
                <>
                  <Spacer height="20px" />

                  <Typography
                    sx={{
                      fontSize: '12px',
                    }}
                  >
                    {t('auth:node.using_public', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </>
              )}

              <Spacer height="20px" />

              <CustomButton onClick={authenticateWallet}>
                {t('auth:action.authenticate', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </CustomButton>

              <ErrorText>{walletToBeDecryptedError}</ErrorText>
            </>
          </>
        )}
        {extState === 'download-wallet' && (
          <DownloadWallet
            returnToMain={returnToMain}
            setIsLoading={setIsLoading}
            showInfo={showInfo}
            rawWallet={rawWallet}
            setWalletToBeDownloaded={setWalletToBeDownloaded}
            walletToBeDownloaded={walletToBeDownloaded}
          />
        )}

        {extState === 'create-wallet' && (
          <>
            {!walletToBeDownloaded && (
              <>
                <Spacer height="22px" />

                <Box
                  sx={{
                    boxSizing: 'border-box',
                    display: 'flex',
                    justifyContent: 'flex-start',
                    maxWidth: '700px',
                    paddingLeft: '22px',
                    width: '100%',
                  }}
                >
                  <Return
                    style={{
                      cursor: 'pointer',
                      height: '24px',
                      width: 'auto',
                    }}
                    onClick={() => {
                      if (creationStep === 2) {
                        setCreationStep(1);
                        return;
                      }
                      setExtstate('not-authenticated');
                      setShowSeed(false);
                      setCreationStep(1);
                      setWalletToBeDownloadedPasswordConfirm('');
                      setWalletToBeDownloadedPassword('');
                    }}
                  />
                </Box>

                <Spacer height="15px" />

                <div
                  className="image-container"
                  style={{
                    width: '136px',
                    height: '154px',
                  }}
                >
                  <img src={Logo1Dark} className="base-image" />
                </div>

                <Spacer height="38px" />

                <TextP
                  sx={{
                    textAlign: 'center',
                    lineHeight: 1.2,
                    fontSize: '18px',
                  }}
                >
                  {t('auth:action.setup_qortal_account', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </TextP>

                <Spacer height="14px" />

                <Box
                  sx={{
                    display: 'flex',
                    maxWidth: '100%',
                    justifyContent: 'center',
                    padding: '10px',
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: creationStep === 1 ? 'flex' : 'none',
                      flexDirection: 'column',
                      maxWidth: '95%',
                      width: '350px',
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: '14px',
                      }}
                    >
                      <Trans
                        ns="auth"
                        i18nKey="message.generic.seedphrase_notice"
                        components={{
                          seed: (
                            <span
                              onClick={() => setShowSeed(true)}
                              style={{
                                fontSize: '14px',
                                color: 'steelblue',
                                cursor: 'pointer',
                              }}
                            />
                          ),
                        }}
                        tOptions={{ postProcess: ['capitalizeFirstChar'] }}
                      >
                        A <seed>SEEDPHRASE</seed> has been randomly generated in
                        the background.
                      </Trans>
                    </Typography>

                    <Typography
                      sx={{
                        fontSize: '14px',
                        marginTop: '5px',
                      }}
                    >
                      {t('auth:tips.view_seedphrase', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>

                    <Typography
                      sx={{
                        fontSize: '18px',
                        marginTop: '15px',
                        textAlign: 'center',
                      }}
                    >
                      <Trans
                        i18nKey="action.create_qortal_account"
                        ns="auth"
                        components={{
                          next: (
                            <span
                              style={{
                                fontWeight: 'bold',
                              }}
                            />
                          ),
                        }}
                        tOptions={{ postProcess: ['capitalizeFirstChar'] }}
                      >
                        Create your Qortal account by clicking <next>NEXT</next>{' '}
                        below.
                      </Trans>
                    </Typography>

                    <Spacer height="17px" />

                    <CustomButton
                      onClick={() => {
                        setCreationStep(2);
                      }}
                    >
                      {t('core:page.next', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </CustomButton>
                  </Box>

                  <div
                    style={{
                      display: 'none',
                    }}
                  >
                    <random-sentence-generator
                      ref={generatorRef}
                      template="adverb verb noun adjective noun adverb verb noun adjective noun adjective verbed adjective noun"
                    ></random-sentence-generator>
                  </div>

                  <Dialog
                    open={showSeed}
                    aria-labelledby="alert-dialog-title"
                    aria-describedby="alert-dialog-description"
                  >
                    <DialogContent>
                      <Box
                        sx={{
                          alignItems: 'center',
                          display: showSeed ? 'flex' : 'none',
                          flexDirection: 'column',
                          gap: '10px',
                          maxWidth: '400px',
                        }}
                      >
                        <Typography
                          sx={{
                            fontSize: '14px',
                          }}
                        >
                          {t('auth:seed_your', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>

                        <Box
                          sx={{
                            background: theme.palette.background.paper,
                            borderRadius: '5px',
                            padding: '10px',
                            textAlign: 'center',
                            width: '100%',
                          }}
                        >
                          {generatorRef.current?.parsedString}
                        </Box>

                        <CustomButton
                          sx={{
                            padding: '7px',
                            fontSize: '12px',
                          }}
                          onClick={exportSeedphrase}
                        >
                          {t('auth:action.export_seedphrase', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </CustomButton>
                      </Box>
                    </DialogContent>

                    <DialogActions>
                      <Button
                        variant="contained"
                        onClick={() => setShowSeed(false)}
                      >
                        {t('core:action.close', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Button>
                    </DialogActions>
                  </Dialog>
                </Box>

                <Box
                  sx={{
                    display: creationStep === 2 ? 'flex' : 'none',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >
                  <Spacer height="14px" />

                  <CustomLabel htmlFor="standard-adornment-password">
                    {t('auth:wallet.password', {
                      postProcess: 'capitalizeFirstChar',
                    })}
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
                    {t('auth:wallet.password_confirmation', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </CustomLabel>

                  <Spacer height="5px" />

                  <PasswordField
                    id="standard-adornment-password"
                    value={walletToBeDownloadedPasswordConfirm}
                    onChange={(e) =>
                      setWalletToBeDownloadedPasswordConfirm(e.target.value)
                    }
                  />
                  <Spacer height="5px" />

                  <Typography variant="body2">
                    {t('auth:message.generic.no_minimum_length', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>

                  <Spacer height="17px" />

                  <CustomButton onClick={createAccountFunc}>
                    {t('auth:action.create_account', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </CustomButton>
                </Box>

                <ErrorText>{walletToBeDownloadedError}</ErrorText>
              </>
            )}

            {walletToBeDownloaded && (
              <>
                <Spacer height="48px" />

                <SuccessIcon />

                <Spacer height="45px" />

                <TextP
                  sx={{
                    textAlign: 'center',
                    lineHeight: '15px',
                  }}
                >
                  {t('auth:message.generic.congrats_setup', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </TextP>

                <Spacer height="50px" />

                <Box
                  sx={{
                    display: 'flex',
                    gap: '15px',
                    alignItems: 'center',
                    padding: '10px',
                  }}
                >
                  <WarningIcon color="warning" />

                  <Typography>
                    {t('auth:tips.safe_place', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </Box>

                <Spacer height="50px" />

                <CustomButton
                  onClick={async () => {
                    await saveFileToDiskFunc();
                    returnToMain();
                    await showInfo({
                      message: t('auth:tips.wallet_secure', {
                        postProcess: 'capitalizeFirstChar',
                      }),
                    });
                  }}
                >
                  {t('core:action.backup_account', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </CustomButton>
              </>
            )}
          </>
        )}

        {isOpenSendQortSuccess && (
          <Box
            sx={{
              alignItems: 'center',
              background: theme.palette.background.default,
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              position: 'fixed',
              width: '100%',
              zIndex: 10000,
            }}
          >
            <Spacer height="48px" />

            <SuccessIcon />

            <Spacer height="45px" />

            <TextP
              sx={{
                textAlign: 'center',
                lineHeight: '15px',
              }}
            >
              {t('core:message.success.transfer', {
                postProcess: 'capitalizeFirstChar',
              })}
            </TextP>

            <Spacer height="100px" />

            <ButtonBase
              autoFocus
              onClick={() => {
                returnToMain();
              }}
            >
              <CustomButton>
                {t('core:action.continue', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </CustomButton>
            </ButtonBase>
          </Box>
        )}

        {extState === 'transfer-success-request' && (
          <>
            <Spacer height="48px" />

            <SuccessIcon />

            <Spacer height="45px" />

            <TextP
              sx={{
                textAlign: 'center',
                lineHeight: '15px',
              }}
            >
              {t('core:message.success.transfer', {
                postProcess: 'capitalizeFirstChar',
              })}
            </TextP>

            <Spacer height="100px" />

            <CustomButton
              onClick={() => {
                window.close();
              }}
            >
              {t('core:action.continue', {
                postProcess: 'capitalizeFirstChar',
              })}
            </CustomButton>
          </>
        )}

        {extState === 'buy-order-submitted' && (
          <>
            <Spacer height="48px" />

            <SuccessIcon />

            <Spacer height="45px" />

            <TextP
              sx={{
                textAlign: 'center',
                lineHeight: '15px',
              }}
            >
              {t('core:message.success.order_submitted', {
                postProcess: 'capitalizeFirstChar',
              })}
            </TextP>

            <Spacer height="100px" />

            <CustomButton
              onClick={() => {
                window.close();
              }}
            >
              {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
            </CustomButton>
          </>
        )}

        {countdown && (
          <Box
            style={{
              left: '20px',
              position: 'absolute',
              top: '20px',
            }}
          >
            <CountdownCircleTimer
              isPlaying
              duration={countdown}
              colors={['#004777', '#F7B801', '#A30000', '#A30000']}
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
            sx={{
              zIndex: 10001,
            }}
          >
            <DialogTitle id="alert-dialog-title">
              {message.paymentFee ? 'Payment' : 'Publish'}
            </DialogTitle>

            <DialogContent>
              <DialogContentText id="alert-dialog-description">
                {message.message}
              </DialogContentText>
              {message?.paymentFee && (
                <DialogContentText id="alert-dialog-description2">
                  {t('core:fee.payment', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  : {message.paymentFee}
                </DialogContentText>
              )}
              {message?.publishFee && (
                <DialogContentText id="alert-dialog-description2">
                  {t('core:fee.publish', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  : {message.publishFee}
                </DialogContentText>
              )}
            </DialogContent>

            <DialogActions>
              <Button
                sx={{
                  backgroundColor: theme.palette.other.positive,
                  color: theme.palette.text.primary,
                  fontWeight: 'bold',
                  opacity: 0.7,
                  '&:hover': {
                    backgroundColor: theme.palette.other.positive,
                    color: 'black',
                    opacity: 1,
                  },
                }}
                variant="contained"
                onClick={onOk}
                autoFocus
              >
                {t('core:action.accept', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Button>

              <Button
                sx={{
                  backgroundColor: theme.palette.other.danger,
                  color: 'black',
                  fontWeight: 'bold',
                  opacity: 0.7,
                  '&:hover': {
                    backgroundColor: theme.palette.other.danger,
                    color: 'black',
                    opacity: 1,
                  },
                }}
                variant="contained"
                onClick={onCancel}
              >
                {t('core:action.decline', {
                  postProcess: 'capitalizeFirstChar',
                })}
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
            <DialogTitle id="alert-dialog-title">
              {'Important Info'}
            </DialogTitle>

            <DialogContent>
              <DialogContentText id="alert-dialog-description">
                {messageInfo.message}
              </DialogContentText>
            </DialogContent>

            <DialogActions>
              <Button variant="contained" onClick={onOkInfo} autoFocus>
                {t('core:action.close', {
                  postProcess: 'capitalizeFirstChar',
                })}
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
            <DialogTitle id="alert-dialog-title">
              {t('core:action.logout', { postProcess: 'capitalizeAll' })}
            </DialogTitle>

            <DialogContent>
              <DialogContentText id="alert-dialog-description">
                {messageUnsavedChanges.message}
              </DialogContentText>
            </DialogContent>

            <DialogActions>
              <Button variant="contained" onClick={onCancelUnsavedChanges}>
                {t('core:action.cancel', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Button>

              <Button
                variant="contained"
                onClick={onOkUnsavedChanges}
                autoFocus
              >
                {t('core:action.continue_logout', {
                  postProcess: 'capitalizeFirstChar',
                })}
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
              duration={60}
              colors={['#004777', '#F7B801', '#A30000', '#A30000']}
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
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                maxHeight: '90vh',
                overflow: 'auto',
                padding: '20px',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'center',
                  width: '100%',
                }}
              >
                <TextP
                  sx={{
                    lineHeight: 1.2,
                    maxWidth: '90%',
                    textAlign: 'center',
                    fontSize: '16px',
                    marginBottom: '10px',
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
                      display: 'flex',
                      justifyContent: 'flex-start',
                      width: '90%',
                    }}
                  >
                    <TextP
                      sx={{
                        lineHeight: 1.2,
                        fontSize: '16px',
                        fontWeight: 'normal',
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
                      display: 'flex',
                      justifyContent: 'flex-start',
                      width: '90%',
                    }}
                  >
                    <TextP
                      sx={{
                        lineHeight: 1.2,
                        fontSize: '16px',
                        fontWeight: 'normal',
                      }}
                    >
                      {messageQortalRequestExtension?.text3}
                    </TextP>
                  </Box>

                  <Spacer height="15px" />
                </>
              )}

              {messageQortalRequestExtension?.text4 && (
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'flex-start',
                    width: '90%',
                  }}
                >
                  <TextP
                    sx={{
                      lineHeight: 1.2,
                      fontSize: '16px',
                      fontWeight: 'normal',
                    }}
                  >
                    {messageQortalRequestExtension?.text4}
                  </TextP>
                </Box>
              )}

              {messageQortalRequestExtension?.html && (
                <>
                  <Spacer height="15px" />

                  <div
                    dangerouslySetInnerHTML={{
                      __html: messageQortalRequestExtension?.html,
                    }}
                  />
                </>
              )}

              <Spacer height="15px" />

              <TextP
                sx={{
                  textAlign: 'center',
                  lineHeight: 1.2,
                  fontSize: '16px',
                  fontWeight: 700,
                  maxWidth: '90%',
                }}
              >
                {messageQortalRequestExtension?.highlightedText}
              </TextP>

              {messageQortalRequestExtension?.json && (
                <>
                  <Spacer height="15px" />

                  <JsonView
                    data={messageQortalRequestExtension?.json}
                    shouldExpandNode={allExpanded}
                    style={darkStyles}
                  />
                  <Spacer height="15px" />
                </>
              )}

              {messageQortalRequestExtension?.fee && (
                <>
                  <Spacer height="15px" />

                  <TextP
                    sx={{
                      textAlign: 'center',
                      lineHeight: 1.2,
                      fontSize: '16px',
                      fontWeight: 'normal',
                      maxWidth: '90%',
                    }}
                  >
                    {'Fee: '}
                    {messageQortalRequestExtension?.fee}
                    {' QORT'}
                  </TextP>
                  <Spacer height="15px" />
                </>
              )}
              {messageQortalRequestExtension?.appFee && (
                <>
                  <TextP
                    sx={{
                      textAlign: 'center',
                      lineHeight: 1.2,
                      fontSize: '16px',
                      fontWeight: 'normal',
                      maxWidth: '90%',
                    }}
                  >
                    {t('core:message.generic.fee_qort', {
                      message: messageQortalRequestExtension?.appFee,
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </TextP>

                  <Spacer height="15px" />
                </>
              )}

              {messageQortalRequestExtension?.foreignFee && (
                <>
                  <Spacer height="15px" />

                  <TextP
                    sx={{
                      textAlign: 'center',
                      lineHeight: 1.2,
                      fontSize: '16px',
                      fontWeight: 'normal',
                      maxWidth: '90%',
                    }}
                  >
                    {t('core:message.generic.foreign_fee', {
                      message: messageQortalRequestExtension?.foreignFee,
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </TextP>

                  <Spacer height="15px" />
                </>
              )}

              {messageQortalRequestExtension?.checkbox1 && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '90%',
                    marginTop: '20px',
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
                      '&.Mui-checked': {
                        color: theme.palette.text.secondary, // Customize the color when checked
                      },
                      '& .MuiSvgIcon-root': {
                        color: theme.palette.text.secondary,
                      },
                    }}
                  />

                  <Typography
                    sx={{
                      fontSize: '14px',
                    }}
                  >
                    {messageQortalRequestExtension?.checkbox1?.label}
                  </Typography>
                </Box>
              )}

              {messageQortalRequestExtension?.confirmCheckbox && (
                <FormControlLabel
                  control={
                    <Checkbox
                      onChange={(e) => setConfirmRequestRead(e.target.checked)}
                      checked={confirmRequestRead}
                      edge="start"
                      tabIndex={-1}
                      disableRipple
                      sx={{
                        '&.Mui-checked': {
                          color: theme.palette.text.secondary,
                        },
                        '& .MuiSvgIcon-root': {
                          color: theme.palette.text.secondary,
                        },
                      }}
                    />
                  }
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Typography sx={{ fontSize: '14px' }}>
                        {t('core:message.success.request_read', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                      <PriorityHighIcon color="warning" />
                    </Box>
                  }
                />
              )}

              <Spacer height="29px" />

              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: '14px',
                }}
              >
                <CustomButtonAccept
                  color="black"
                  bgColor={theme.palette.other.positive}
                  sx={{
                    minWidth: '102px',
                    opacity:
                      messageQortalRequestExtension?.confirmCheckbox &&
                      !confirmRequestRead
                        ? 0.1
                        : 0.7,
                    cursor:
                      messageQortalRequestExtension?.confirmCheckbox &&
                      !confirmRequestRead
                        ? 'default'
                        : 'pointer',
                    '&:hover': {
                      opacity:
                        messageQortalRequestExtension?.confirmCheckbox &&
                        !confirmRequestRead
                          ? 0.1
                          : 1,
                    },
                  }}
                  onClick={() => {
                    if (
                      messageQortalRequestExtension?.confirmCheckbox &&
                      !confirmRequestRead
                    )
                      return;
                    onOkQortalRequestExtension('accepted');
                  }}
                >
                  {t('core:action.accept', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </CustomButtonAccept>

                <CustomButtonAccept
                  color="black"
                  bgColor={theme.palette.other.danger}
                  sx={{
                    minWidth: '102px',
                  }}
                  onClick={() => onCancelQortalRequestExtension()}
                >
                  {t('core:action.decline', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </CustomButtonAccept>
              </Box>
              <ErrorText>{sendPaymentError}</ErrorText>
            </Box>
          </Dialog>
        )}

        {isSettingsOpen && (
          <Settings
            open={isSettingsOpen}
            setOpen={setIsSettingsOpen}
            rawWallet={rawWallet}
          />
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
          {renderProfileLeft()}
        </DrawerComponent>

        <UserLookup
          isOpenDrawerLookup={isOpenDrawerLookup}
          setIsOpenDrawerLookup={setIsOpenDrawerLookup}
        />

        <RegisterName
          balance={balance}
          show={show}
          userInfo={userInfo}
          setOpenSnack={setOpenSnack}
          setInfoSnack={setInfoSnack}
        />
        <BuyQortInformation balance={balance} />
      </QORTAL_APP_CONTEXT.Provider>

      {extState === 'create-wallet' && walletToBeDownloaded && (
        <ButtonBase
          onClick={() => {
            showTutorial('important-information', true);
          }}
          sx={{
            bottom: '25px',
            position: 'fixed',
            right: '25px',
          }}
        >
          <HelpIcon
            sx={{
              color: theme.palette.other.unread,
            }}
          />
        </ButtonBase>
      )}

      {isOpenMinting && (
        <Minting
          setIsOpenMinting={setIsOpenMinting}
          myAddress={address}
          show={show}
        />
      )}

      <LanguageSelector />
      <ThemeSelector />
    </AppContainer>
  );
}

export default App;
