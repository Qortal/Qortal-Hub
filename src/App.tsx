import {
  createContext,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
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
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { JsonView, allExpanded, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import HubIcon from '@mui/icons-material/Hub';
import { decryptStoredWallet } from './utils/decryptWallet';
import { CountdownCircleTimer } from 'react-countdown-circle-timer';
import Logo1Dark from './assets/svgs/Logo1Dark.svg';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import { Return } from './assets/Icons/Return.tsx';
import WarningIcon from '@mui/icons-material/Warning';
import './utils/seedPhrase/randomSentenceGenerator.ts';
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
import { AppContainer } from './styles/App-styles.ts';
import { Loader } from './components/Loader';
import { AuthenticationForm } from './components/AuthenticationForm';
import { ProfileLeft } from './components/Profile';
import {
  BuyOrderRequestScreen,
  ConnectionRequestScreen,
  CountdownOverlay,
  CreateWalletView,
  InfoDialog,
  NotAuthenticatedFooter,
  PaymentPublishDialog,
  PaymentRequestScreen,
  QortalRequestExtensionDialog,
  QortalRequestScreen,
  SendQortOverlay,
  SuccessOverlay,
  SuccessScreen,
  UnsavedChangesDialog,
  WalletsView,
  WebAppAuthRequestScreen,
} from './components/App';

const AuthenticatedShell = lazy(
  () =>
    import('./components/App/AuthenticatedShell').then((m) => ({
      default: m.AuthenticatedShell,
    }))
);
import { PasswordField, ErrorText } from './components';
import { requestQueueMemberNames } from './utils/queue/requestQueueMemberNames';
import { TaskManager } from './components/TaskManager/TaskManager.tsx';
import { useModal } from './hooks/useModal.tsx';
import { CustomizedSnackbars } from './components/Snackbar/Snackbar';
import HelpIcon from '@mui/icons-material/Help';
import {
  cleanUrl,
  getProtocol,
  getWallets,
  groupApi,
  groupApiSocket,
  storeWallets,
} from './background/background.ts';
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
import { Settings } from './components/Group/Settings';
import { loadAvatar } from './utils/avatarStorage.ts';
import { useRetrieveDataLocalStorage } from './hooks/useRetrieveDataLocalStorage.tsx';
import { useQortalGetSaveSettings } from './hooks/useQortalGetSaveSettings.tsx';
import {
  authenticatePasswordAtom,
  balanceAtom,
  canSaveSettingToQdnAtom,
  enableAuthWhenSyncingAtom,
  enabledDevModeAtom,
  extStateAtom,
  globalDownloadsAtom,
  groupAnnouncementsAtom,
  groupChatTimestampsAtom,
  groupsOwnerNamesAtom,
  groupsPropertiesAtom,
  hasSettingsChangedAtom,
  isDisabledEditorEnterAtom,
  isLoadingAuthenticateAtom,
  isOpenCoreSetup,
  isRunningPublicNodeAtom,
  isUsingImportExportSettingsAtom,
  lastPaymentSeenTimestampAtom,
  mailsAtom,
  memberGroupsAtom,
  mutedGroupsAtom,
  myGroupsWhereIAmAdminAtom,
  oldPinnedAppsAtom,
  qMailLastEnteredTimestampAtom,
  qortBalanceLoadingAtom,
  rawWalletAtom,
  resourceDownloadControllerAtom,
  selectedNodeInfoAtom,
  settingsLocalLastUpdatedAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
  timestampEnterDataAtom,
  txListAtom,
  userInfoAtom,
  walletToBeDecryptedErrorAtom,
} from './atoms/global';
import { NotAuthenticated } from './components/NotAuthenticated.tsx';
import { handleGetFileFromIndexedDB } from './utils/indexedDB';
import { Wallets } from './components/Wallets.tsx';
import { useFetchResources } from './hooks/useFetchResources.tsx';
import { Tutorials } from './components/Tutorials/Tutorials';
import { useHandleTutorials } from './hooks/useHandleTutorials.tsx';
import { useHandleUserInfo } from './hooks/useHandleUserInfo.tsx';
import { Minting } from './components/Minting/Minting';
import { isRunningGateway } from './qortal/qortal-requests.ts';
import { useBlockedAddresses } from './hooks/useBlockUsers.tsx';
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
import { SuccessIcon } from './assets/Icons/SuccessIcon.tsx';
import { Save } from './components/Save/Save';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { useResetAtom } from 'jotai/utils';
import {
  getDefaultLocalNodeUrl,
  isLocalNodeUrl,
  TIME_SECONDS_10_IN_MILLISECONDS,
  TIME_MINUTES_2_IN_MILLISECONDS,
  TIME_SECONDS_40_IN_MILLISECONDS,
} from './constants/constants.ts';
import { CoreSetup } from './components/CoreSetup.tsx';
import { ApiKey } from './types/auth.ts';
import { useAuth } from './hooks/useAuth.tsx';

export type extStates =
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

export const QORTAL_APP_CONTEXT =
  createContext<MyContextInterface>(defaultValues);

export let globalApiKey: ApiKey | null = null;

export const handleSetGlobalApikey = (data: ApiKey) => {
  globalApiKey = data;
};
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
  const [extState, setExtstate] = useAtom(extStateAtom);
  const [desktopViewMode, setDesktopViewMode] = useState('home');
  const [backupjson, setBackupjson] = useState<any>(null);
  const [rawWallet, setRawWallet] = useAtom(rawWalletAtom);
  const [qortBalanceLoading, setQortBalanceLoading] = useAtom(
    qortBalanceLoadingAtom
  );
  const [decryptedWallet, setdecryptedWallet] = useState<any>(null);
  const [requestConnection, setRequestConnection] = useState<any>(null);
  const [requestBuyOrder, setRequestBuyOrder] = useState<any>(null);
  const [userInfo, setUserInfo] = useAtom(userInfoAtom);
  const [balance, setBalance] = useAtom(balanceAtom);
  const [paymentTo, setPaymentTo] = useState<string>('');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentPassword, setPaymentPassword] = useState<string>('');
  const [sendPaymentError, setSendPaymentError] = useState<string>('');
  const [sendPaymentSuccess, setSendPaymentSuccess] = useState<string>('');
  const [countdown, setCountdown] = useState<null | number>(null);
  const [walletToBeDownloaded, setWalletToBeDownloaded] = useState<any>(null);
  const [walletToBeDownloadedPassword, setWalletToBeDownloadedPassword] =
    useState<string>('');
  const setOpenCoreSetup = useSetAtom(isOpenCoreSetup);
  const [isMain, setIsMain] = useState<boolean>(true);
  const setAuthenticatePassword = useSetAtom(authenticatePasswordAtom);
  const [sendqortState, setSendqortState] = useState<any>(null);
  const [isLoading, setIsLoading] = useAtom(isLoadingAuthenticateAtom);
  const isAuthenticated = extState === 'authenticated';
  const [walletAvatarSrc, setWalletAvatarSrc] = useState<string | null>(null);

  useEffect(() => {
    if (rawWallet?.address0 && extState === 'wallet-dropped') {
      loadAvatar(rawWallet.address0).then(setWalletAvatarSrc);
    } else {
      setWalletAvatarSrc(null);
    }
  }, [rawWallet?.address0, extState]);

  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const theme = useTheme();

  const [
    walletToBeDownloadedPasswordConfirm,
    setWalletToBeDownloadedPasswordConfirm,
  ] = useState<string>('');

  const [walletToBeDownloadedError, setWalletToBeDownloadedError] =
    useState<string>('');

  const [walletToBeDecryptedError, setWalletToBeDecryptedError] = useAtom(
    walletToBeDecryptedErrorAtom
  );

  const [hasSettingsChanged, setHasSettingsChanged] = useAtom(
    hasSettingsChangedAtom
  );

  const balanceSetIntervalRef = useRef(null);
  const downloadResource = useFetchResources();
  const globalDownloadsValue = useAtomValue(globalDownloadsAtom);
  const holdRefExtState = useRef<extStates>('not-authenticated');
  const isFocusedRef = useRef<boolean>(true);

  const {
    showTutorial,
    openTutorialModal,
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
  const confirmRef = useRef(null);

  const {
    isShow: isShowInfo,
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
  const [isOpenDrawerProfile, setIsOpenDrawerProfile] = useState(false);
  const [isOpenDrawerLookup, setIsOpenDrawerLookup] = useState(false);
  const [isOpenSendQort, setIsOpenSendQort] = useState(false);
  const [isOpenSendQortSuccess, setIsOpenSendQortSuccess] = useState(false);
  const [selectedNode, setSelectedNode] = useAtom(selectedNodeInfoAtom);
  const {
    isNodeValid,
    authenticate,
    getBalanceFunc,
    validateApiKeyFromRegistration,
  } = useAuth();
  const {
    isUserBlocked,
    addToBlockList,
    removeBlockFromList,
    getAllBlockedUsers,
  } = useBlockedAddresses(extState === 'authenticated');

  // const [useLocalNode, setUseLocalNode] = useState(true);
  const useLocalNode = isLocalNodeUrl(selectedNode?.url);
  const [confirmRequestRead, setConfirmRequestRead] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const [creationStep, setCreationStep] = useState(1);
  const getIndividualUserInfo = useHandleUserInfo();
  const qortalRequestCheckbox1Ref = useRef(null);
  useRetrieveDataLocalStorage(userInfo?.address);
  useQortalGetSaveSettings(userInfo?.name, extState === 'authenticated');
  const setIsEnabledDevMode = useSetAtom(enabledDevModeAtom);
  const setEnableAuthWhenSyncing = useSetAtom(enableAuthWhenSyncingAtom);

  const setIsDisabledEditorEnter = useSetAtom(isDisabledEditorEnterAtom);

  const [isOpenMinting, setIsOpenMinting] = useState(false);
  const generatorRef = useRef(null);

  const exportSeedphrase = () => {
    const seedPhrase = generatorRef.current.parsedString;
    saveSeedPhraseToDisk(seedPhrase);
  };

  useEffect(() => {
    const isDevModeFromStorage = localStorage.getItem('isEnabledDevMode');
    if (isDevModeFromStorage) {
      setIsEnabledDevMode(JSON.parse(isDevModeFromStorage));
    }
    const enableAuthWhenSyncingFromStorage = localStorage.getItem(
      'enableAuthWhenSyncing'
    );
    if (enableAuthWhenSyncingFromStorage) {
      setEnableAuthWhenSyncing(JSON.parse(enableAuthWhenSyncingFromStorage));
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
  const resetMyGroupsWhereIAmAdminAtom = useResetAtom(
    myGroupsWhereIAmAdminAtom
  );
  const resetGroupsOwnerNamesAtom = useResetAtom(groupsOwnerNamesAtom);
  const resetGroupAnnouncementsAtom = useResetAtom(groupAnnouncementsAtom);
  const resetMutedGroupsAtom = useResetAtom(mutedGroupsAtom);
  const resetGroupChatTimestampsAtom = useResetAtom(groupChatTimestampsAtom);
  const resetTimestampEnterAtom = useResetAtom(timestampEnterDataAtom);
  const resettxListAtomAtom = useResetAtom(txListAtom);
  const resetmemberGroupsAtomAtom = useResetAtom(memberGroupsAtom);
  const resetResourceDownloadControllerAtom = useResetAtom(
    resourceDownloadControllerAtom
  );
  const resetGlobalDownloadsAtom = useResetAtom(globalDownloadsAtom);
  const [storeAccount, setStoredAccount] = useState<boolean>(true);
  const resetAllRecoil = () => {
    // First, clean up any active download intervals/timeouts
    if (globalDownloadsValue && typeof globalDownloadsValue === 'object') {
      Object.values(globalDownloadsValue).forEach((entry: any) => {
        if (entry?.interval) clearInterval(entry.interval);
        if (entry?.timeout) clearTimeout(entry.timeout);
        if (entry?.retryTimeout) clearTimeout(entry.retryTimeout);
      });
    }

    // Reset all atoms
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
    resetMyGroupsWhereIAmAdminAtom();
    resetResourceDownloadControllerAtom();
    resetGlobalDownloadsAtom();
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

  useEffect(() => {
    try {
      setIsLoading(true);
      window
        .sendMessage('getApiKey')
        .then((response) => {
          if (response?.url) {
            handleSetGlobalApikey(response);
            setSelectedNode(response);
          } else {
            const payload = {
              url: getDefaultLocalNodeUrl(),
              apikey: '',
            };
            handleSetGlobalApikey(response);
            setSelectedNode(payload);
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
      }, TIME_SECONDS_40_IN_MILLISECONDS);
    } catch (error) {
      console.error(error);
    }
  };

  const refetchUserInfo = () => {
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
  };

  const getBalanceAndUserInfoFunc = () => {
    getBalanceFunc();
    refetchUserInfo();
  };

  const qortalRequestPermissionFromExtension = async (message, event) => {
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
        qortalRequestPermissionFromExtension(message, event);
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
  const confirmPayment = useCallback((isDecline: boolean) => {
    // REMOVED FOR MOBILE APP
  }, []);

  const confirmBuyOrder = useCallback((isDecline: boolean) => {
    // REMOVED FOR MOBILE APP
  }, []);
  const responseToConnectionRequest = useCallback(
    (isOkay: boolean, hostname: string, interactionId: string) => {
      // REMOVED FOR MOBILE APP
    },
    []
  );
  const onConnectionRequestAccept = useCallback(
    () =>
      responseToConnectionRequest(
        true,
        requestConnection?.hostname ?? '',
        requestConnection?.interactionId ?? ''
      ),
    [responseToConnectionRequest, requestConnection?.hostname, requestConnection?.interactionId]
  );
  const onConnectionRequestDecline = useCallback(
    () =>
      responseToConnectionRequest(
        false,
        requestConnection?.hostname ?? '',
        requestConnection?.interactionId ?? ''
      ),
    [responseToConnectionRequest, requestConnection?.hostname, requestConnection?.interactionId]
  );

  const getUserInfo = useCallback(async (useTimer?: boolean) => {
    try {
      if (useTimer) {
        await new Promise((res) => {
          setTimeout(() => {
            res(null);
          }, TIME_SECONDS_10_IN_MILLISECONDS);
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
      await validateApiKeyFromRegistration();
      window
        .sendMessage('decryptWallet', {
          password: walletToBeDownloadedPassword,
          wallet,
        })
        .then((response) => {
          if (response && !response.error) {
            setRawWallet(wallet);
            if (storeAccount) {
              saveWalletToLocalStorage(wallet);
            }
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
    setBackupjson(null);
    setRawWallet(null);
    setdecryptedWallet(null);
    setRequestConnection(null);
    setRequestBuyOrder(null);
    setUserInfo(null);
    setBalance(null);
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
      const isValid = await isNodeValid();
      if (!isValid) {
        return;
      }
      await authenticate();
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
      isFocusedRef.current = true;
    };

    // Handler for when the window loses focus
    const handleBlur = () => {
      isFocusedRef.current = false;
    };

    // Attach the event listeners
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    // Optionally, listen for visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        isFocusedRef.current = true;
      } else {
        isFocusedRef.current = false;
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

  const onOpenSendQort = useCallback(() => setIsOpenSendQort(true), []);
  const onCloseDrawerProfile = useCallback(
    () => setIsOpenDrawerProfile(false),
    []
  );
  const onOpenSendQortAndCloseDrawer = useCallback(() => {
    setIsOpenSendQort(true);
    setIsOpenDrawerProfile(false);
  }, []);
  const onOpenRegisterName = useCallback(
    () => executeEvent('openRegisterName', {}),
    []
  );
  const onOpenSettings = useCallback(() => setIsSettingsOpen(true), []);
  const onOpenDrawerLookup = useCallback(
    () => setIsOpenDrawerLookup(true),
    []
  );
  const onOpenWalletsApp = useCallback(
    () => executeEvent('openWalletsApp', {}),
    []
  );
  const onOpenDrawerProfile = useCallback(
    () => setIsOpenDrawerProfile(true),
    []
  );
  const onOpenMinting = useCallback(async () => {
    try {
      const res = await isRunningGateway();
      if (res)
        throw new Error(
          t('core:message.generic.no_minting_details', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      setIsOpenMinting(true);
    } catch (error: any) {
      setOpenSnack(true);
      setInfoSnack({
        type: 'error',
        message: error?.message,
      });
    }
  }, [t]);
  const onBackupWallet = useCallback(() => {
    setExtstate('download-wallet');
    setIsOpenDrawerProfile(false);
  }, [setExtstate]);

  const onOkQortalRequestAccepted = useCallback(
    () => onOkQortalRequest('accepted'),
    [onOkQortalRequest]
  );
  const onConfirmBuyOrderAccept = useCallback(
    () => confirmBuyOrder(false),
    [confirmBuyOrder]
  );
  const onConfirmBuyOrderDecline = useCallback(
    () => confirmBuyOrder(true),
    [confirmBuyOrder]
  );
  const onConfirmPaymentAccept = useCallback(
    () => confirmPayment(false),
    [confirmPayment]
  );
  const onConfirmPaymentDecline = useCallback(
    () => confirmPayment(true),
    [confirmPayment]
  );
  const onGoToCreateWallet = useCallback(
    () => setExtstate('create-wallet'),
    [setExtstate]
  );
  const onWalletsBack = useCallback(() => {
    setRawWallet(null);
    setExtstate('not-authenticated');
    logoutFunc();
  }, [setExtstate, logoutFunc]);
  const onAuthenticationFormBack = useCallback(() => {
    setRawWallet(null);
    setExtstate('wallets');
    setAuthenticatePassword('');
    logoutFunc();
  }, [setExtstate, logoutFunc]);
  const onCreateWalletReturnBack = useCallback(() => {
    if (creationStep === 2) {
      setCreationStep(1);
      setWalletToBeDownloadedPasswordConfirm('');
      setWalletToBeDownloadedPassword('');
      return;
    }
    setExtstate('not-authenticated');
    setShowSeed(false);
    setCreationStep(1);
    setWalletToBeDownloadedPasswordConfirm('');
    setWalletToBeDownloadedPassword('');
  }, [
    creationStep,
    setExtstate,
    setWalletToBeDownloadedPasswordConfirm,
    setWalletToBeDownloadedPassword,
  ]);
  const onShowSeed = useCallback(() => setShowSeed(true), []);
  const onHideSeed = useCallback(() => setShowSeed(false), []);
  const onCreationStepNext = useCallback(() => setCreationStep(2), []);
  const onBackupAccountConfirm = useCallback(async () => {
    await saveFileToDiskFunc();
    returnToMain();
    await showInfo({
      message: t('auth:tips.wallet_secure', {
        postProcess: 'capitalizeFirstChar',
      }),
    });
  }, [t, showInfo]);
  const onCountdownComplete = useCallback(() => {
    window.close();
  }, []);
  const onTransferSuccessContinue = useCallback(() => returnToMain(), []);
  const onTransferSuccessRequestClose = useCallback(() => window.close(), []);
  const onBuyOrderSubmittedClose = useCallback(() => window.close(), []);
  const onOkQortalRequestExtensionAccept = useCallback(() => {
    const ext = messageQortalRequestExtension as { confirmCheckbox?: boolean } | null | undefined;
    if (ext?.confirmCheckbox && !confirmRequestRead) return;
    onOkQortalRequestExtension('accepted');
  }, [
    messageQortalRequestExtension,
    confirmRequestRead,
    onOkQortalRequestExtension,
  ]);
  const onOpenCoreSetup = useCallback(() => setOpenCoreSetup(true), [
    setOpenCoreSetup,
  ]);
  const onShowTutorialImportantInfo = useCallback(
    () => showTutorial('important-information', true),
    [showTutorial]
  );

  return (
    <AppContainer
      sx={{
        height: '100vh',
      }}
    >
      <PdfViewer />

      <QORTAL_APP_CONTEXT.Provider value={contextValue}>
        <CoreSetup />
        <Tutorials />
        {extState === 'not-authenticated' && (
          <NotAuthenticated
            handleSetGlobalApikey={handleSetGlobalApikey}
            setExtstate={setExtstate}
            useLocalNode={useLocalNode}
          />
        )}

        {extState === 'authenticated' && isMainWindow && (
          <Suspense fallback={<Loader />}>
            <AuthenticatedShell
              balance={balance}
              desktopViewMode={desktopViewMode}
              isMain={isMain}
              isOpenDrawerProfile={isOpenDrawerProfile}
              logoutFunc={logoutFunc}
              myAddress={address}
              setDesktopViewMode={setDesktopViewMode}
              setIsOpenDrawerProfile={setIsOpenDrawerProfile}
              userInfo={userInfo}
              rawWallet={rawWallet}
              qortBalanceLoading={qortBalanceLoading}
              setOpenSnack={setOpenSnack}
              setInfoSnack={setInfoSnack}
              onRefreshBalance={getBalanceAndUserInfoFunc}
              onOpenSendQort={onOpenSendQort}
              onOpenRegisterName={onOpenRegisterName}
              extState={extState}
              isMainWindow={isMainWindow}
              onOpenSettings={onOpenSettings}
              onOpenDrawerLookup={onOpenDrawerLookup}
              onOpenWalletsApp={onOpenWalletsApp}
              onOpenDrawerProfile={onOpenDrawerProfile}
              getUserInfo={getUserInfo}
              onOpenMinting={onOpenMinting}
              showTutorial={showTutorial}
              onBackupWallet={onBackupWallet}
            />
          </Suspense>
        )}

        {isOpenSendQort && isMainWindow && (
          <SendQortOverlay
            balance={balance}
            paymentTo={paymentTo}
            onReturn={returnToMain}
            onSuccess={() => {
              setIsOpenSendQort(false);
              setIsOpenSendQortSuccess(true);
            }}
            show={show}
          />
        )}

        {isShowQortalRequest && !isMainWindow && (
          <QortalRequestScreen
            message={messageQortalRequest}
            sendPaymentError={sendPaymentError}
            onAccept={onOkQortalRequestAccepted}
            onDecline={onCancelQortalRequest}
            onCheckboxChange={(checked) => {
              qortalRequestCheckbox1Ref.current = checked;
            }}
            checkboxDefaultChecked={(messageQortalRequest as { checkbox1?: { value?: boolean } })?.checkbox1?.value}
          />
        )}

        {extState === 'web-app-request-buy-order' && !isMainWindow && (
          <BuyOrderRequestScreen
            hostname={requestBuyOrder?.hostname}
            crosschainAtInfo={requestBuyOrder?.crosschainAtInfo}
            sendPaymentError={sendPaymentError}
            roundUpToDecimals={roundUpToDecimals}
            onAccept={onConfirmBuyOrderAccept}
            onDecline={onConfirmBuyOrderDecline}
          />
        )}
        {extState === 'web-app-request-payment' && !isMainWindow && (
          <PaymentRequestScreen
            hostname={requestBuyOrder?.hostname}
            count={requestBuyOrder?.crosschainAtInfo?.length || 0}
            description={sendqortState?.description}
            amount={sendqortState?.amount}
            sendPaymentError={sendPaymentError}
            onAccept={onConfirmPaymentAccept}
            onDecline={onConfirmPaymentDecline}
          />
        )}

        {extState === 'web-app-request-connection' && !isMainWindow && (
          <ConnectionRequestScreen
            hostname={requestConnection?.hostname}
            onAccept={onConnectionRequestAccept}
            onDecline={onConnectionRequestDecline}
          />
        )}

        {extState === 'web-app-request-authentication' && !isMainWindow && (
          <WebAppAuthRequestScreen
            hostname={requestConnection?.hostname}
            getRootProps={getRootProps}
            getInputProps={getInputProps}
            onCreateAccount={onGoToCreateWallet}
          />
        )}

        {extState === 'wallets' && (
          <WalletsView
            onBack={onWalletsBack}
            setRawWallet={setRawWallet}
            setExtState={setExtstate}
            rawWallet={rawWallet}
          />
        )}

        {rawWallet && extState === 'wallet-dropped' && (
          <AuthenticationForm
            rawWallet={rawWallet}
            walletAvatarSrc={walletAvatarSrc}
            selectedNode={selectedNode}
            walletToBeDecryptedError={walletToBeDecryptedError}
            onBack={onAuthenticationFormBack}
            onAuthenticate={authenticateWallet}
          />
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
          <CreateWalletView
            creationStep={creationStep}
            walletToBeDownloaded={walletToBeDownloaded}
            walletToBeDownloadedPassword={walletToBeDownloadedPassword}
            walletToBeDownloadedPasswordConfirm={walletToBeDownloadedPasswordConfirm}
            walletToBeDownloadedError={walletToBeDownloadedError}
            showSeed={showSeed}
            storeAccount={storeAccount}
            generatorRef={generatorRef}
            confirmRef={confirmRef}
            onReturnBack={onCreateWalletReturnBack}
            onShowSeed={onShowSeed}
            onHideSeed={onHideSeed}
            onCreationStepNext={onCreationStepNext}
            setWalletToBeDownloadedPassword={setWalletToBeDownloadedPassword}
            setWalletToBeDownloadedPasswordConfirm={
              setWalletToBeDownloadedPasswordConfirm
            }
            setStoredAccount={setStoredAccount}
            onCreateAccount={createAccountFunc}
            onBackupAccountConfirm={onBackupAccountConfirm}
            exportSeedphrase={exportSeedphrase}
          />
        )}

        {isOpenSendQortSuccess && (
          <SuccessOverlay
            messageKey="message.success.transfer"
            buttonLabelKey="action.continue"
            onAction={onTransferSuccessContinue}
            fullPage
          />
        )}

        {extState === 'transfer-success-request' && (
          <SuccessScreen
            messageKey="message.success.transfer"
            buttonLabelKey="action.continue"
            onAction={onTransferSuccessRequestClose}
          />
        )}

        {extState === 'buy-order-submitted' && (
          <SuccessScreen
            messageKey="message.success.order_submitted"
            buttonLabelKey="action.close"
            onAction={onBuyOrderSubmittedClose}
          />
        )}

        {countdown && (
          <CountdownOverlay
            countdown={countdown}
            onComplete={onCountdownComplete}
          />
        )}

        {isLoading && <Loader />}
        <PaymentPublishDialog
          open={isShow}
          message={message}
          onAccept={() => onOk(undefined)}
          onCancel={() => onCancel(undefined)}
        />
        <InfoDialog
          open={isShowInfo}
          message={messageInfo.message}
          onClose={onOkInfo}
        />
        <UnsavedChangesDialog
          open={isShowUnsavedChanges}
          message={messageUnsavedChanges.message}
          onCancel={onCancelUnsavedChanges}
          onConfirm={() => onOkUnsavedChanges(undefined)}
        />
        {isShowQortalRequestExtension && isMainWindow && (
          <QortalRequestExtensionDialog
            open={isShowQortalRequestExtension}
            message={messageQortalRequestExtension}
            sendPaymentError={sendPaymentError}
            confirmRequestRead={confirmRequestRead}
            onConfirmRequestReadChange={setConfirmRequestRead}
            onCheckbox1Change={(checked) => {
              qortalRequestCheckbox1Ref.current = checked;
            }}
            onAccept={onOkQortalRequestExtensionAccept}
            onCancel={onCancelQortalRequestExtension}
            onCountdownComplete={onCancelQortalRequestExtension}
          />
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
          <ProfileLeft
            userInfo={userInfo}
            balance={balance}
            rawWallet={rawWallet}
            qortBalanceLoading={qortBalanceLoading}
            setOpenSnack={setOpenSnack}
            setInfoSnack={setInfoSnack}
            onRefreshBalance={getBalanceAndUserInfoFunc}
            onOpenSendQort={onOpenSendQortAndCloseDrawer}
            onOpenRegisterName={onOpenRegisterName}
            onCloseDrawer={onCloseDrawerProfile}
          />
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
        <ButtonBase onClick={onShowTutorialImportantInfo} sx={{
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

      {!isAuthenticated && (
        <NotAuthenticatedFooter
          showCoreSetup={!!window?.coreSetup}
          onOpenCoreSetup={onOpenCoreSetup}
        />
      )}
    </AppContainer>
  );
}

export default App;
