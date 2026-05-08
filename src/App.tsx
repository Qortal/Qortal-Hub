import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from 'react';
import { useDropzone } from 'react-dropzone';
import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { AnimatePresence } from 'framer-motion';
import { decryptStoredWallet } from './utils/decryptWallet';
import {
  getWalletErrorMessage,
  getWalletFieldLabel,
} from './utils/walletErrorMessages';
import './utils/seedPhrase/randomSentenceGenerator.ts';
import {
  createAccount,
  generateRandomSentence,
  saveFileToDisk,
  saveSeedPhraseToDisk,
} from './utils/generateWallet/generateWallet';
import { crypto, walletVersion } from './constants/decryptWallet';
import PhraseWallet from './utils/generateWallet/phrase-wallet';
import { AppContainer } from './styles/App-styles.ts';
import { Loader } from './components/Loader';
import ErrorBoundary from './common/ErrorBoundary';
import { AuthenticationForm } from './components/AuthenticationForm';
import {
  BuyOrderRequestScreen,
  ConnectionRequestScreen,
  CountdownOverlay,
  CreateWalletView,
  ElectronPersistentStorageHydration,
  InfoDialog,
  NotAuthenticatedFooter,
  NotificationPermissionSlideDown,
  PaymentPublishDialog,
  PaymentRequestScreen,
  QortalRequestExtensionDialog,
  QortalRequestScreen,
  ReceiveQortOverlay,
  SendQortOverlay,
  SuccessOverlay,
  SuccessScreen,
  UnsavedChangesDialog,
  WalletsView,
  WebAppAuthRequestScreen,
} from './components/App';

import { LazyAuthenticatedShell } from './components/App/LazyAuthenticatedShell';
import { useAppModals } from './hooks/useAppModals';
import { useAppReset } from './hooks/useAppReset';
import { useAppMessageHandler } from './hooks/useAppMessageHandler';
import { QortinoNotificationHost } from './components/Snackbar/QortinoNotificationHost';
import { getWallets, storeWallets } from './background/background.ts';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from './utils/events';
import { stopSharedEarbumpPlayback } from './components/Group/earbumpSharedAudio';
import { Settings } from './components/Group/Settings';
import { useRetrieveDataLocalStorage } from './hooks/useRetrieveDataLocalStorage.tsx';
import { useQortalGetSaveSettings } from './hooks/useQortalGetSaveSettings.tsx';
import {
  authenticatePasswordAtom,
  balanceAtom,
  enableAuthWhenSyncingAtom,
  extStateAtom,
  hasSettingsChangedAtom,
  infoSnackGlobalAtom,
  isLoadingAuthenticateAtom,
  isOpenCoreSetup,
  isPublicNodeUnavailableAtom,
  isRunningPublicNodeAtom,
  openSnackGlobalAtom,
  qortBalanceLoadingAtom,
  rawWalletAtom,
  selectedNodeInfoAtom,
  userInfoAtom,
  walletToBeDecryptedErrorAtom,
} from './atoms/global';
import { NotAuthenticated } from './components/NotAuthenticated.tsx';
import { useFetchResources } from './hooks/useFetchResources.tsx';
import { Tutorials } from './components/Tutorials/Tutorials';
import { useHandleTutorials } from './hooks/useHandleTutorials.tsx';
import { useHandleUserInfo } from './hooks/useHandleUserInfo.tsx';
import { Minting } from './components/Minting/Minting';
import { isRunningGateway } from './qortal/qortal-requests.ts';
import { useBlockedAddressesLoader } from './hooks/useBlockUsers.tsx';
import { UserLookup } from './components/UserLookup.tsx/UserLookup';
import { RegisterName } from './components/RegisterName';
import { BuyQortInformation } from './components/BuyQortInformation';
import { PdfViewer } from './common/PdfViewer';
import { useTranslation } from 'react-i18next';
import { DownloadWallet } from './components/Auth/DownloadWallet.tsx';
import { BackupWalletModal } from './components/Auth/BackupWalletModal.tsx';
import { useAtom, useSetAtom } from 'jotai';
import {
  HTTP_LOCALHOST_12391,
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
  TIME_SECONDS_10_IN_MILLISECONDS,
} from './constants/constants.ts';
import { CoreSetup } from './components/CoreSetup.tsx';
import { useAuth } from './hooks/useAuth.tsx';
import type { extStates } from './types/app';
import { AppContextInterface, QORTAL_APP_CONTEXT } from './context/AppContext';
import { handleSetGlobalApikey } from './utils/globalApi';
import { isMainWindow } from './constants/app';
import type { CustomTitleBarRightNavProps } from './components/Desktop/CustomTitleBar';
import {
  CustomTitleBar,
  CUSTOM_TITLE_BAR_HEIGHT,
} from './components/Desktop/CustomTitleBar';
import { roundUpToDecimals } from './utils/numberFunctions.ts';
import { GlobalQortalNavBar } from './components/Desktop/GlobalQortalNavBar.tsx';
import type { AuthUnlockTransitionSnapshot } from './types/authTransition';

const MINTING_LOCAL_DEBUG_STORAGE_KEY = 'hub.mintingLocalDebug';
const LOCAL_CORE_READY_SYNC_PERCENT = 99.95;

// Re-export for consumers that still import from App
export type { extStates } from './types/app';
export { QORTAL_APP_CONTEXT } from './context/AppContext';
export {
  allQueues,
  clearAllQueues,
  pauseAllQueues,
  resumeAllQueues,
} from './utils/appQueues';
export {
  globalApiKey,
  handleSetGlobalApikey,
  getBaseApiReact,
  getBaseApiReactForAvatar,
  getBaseApiReactForPrimaryName,
  getArbitraryEndpointReact,
  getBaseApiReactSocket,
} from './utils/globalApi';
export { isMainWindow } from './constants/app';

const formatRuntimeFaultMessage = (
  value: unknown,
  fallbackMessage: string
): string => {
  if (value instanceof Error) {
    return value.stack || value.message || fallbackMessage;
  }

  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (
    value &&
    typeof value === 'object' &&
    'message' in value &&
    typeof (value as { message?: unknown }).message === 'string' &&
    (value as { message: string }).message.trim()
  ) {
    return (value as { message: string }).message;
  }

  if (
    value &&
    typeof value === 'object' &&
    'reason' in value &&
    typeof (value as { reason?: unknown }).reason === 'string' &&
    (value as { reason: string }).reason.trim()
  ) {
    return (value as { reason: string }).reason;
  }

  if (value != null) {
    try {
      const serialized = JSON.stringify(value, null, 2);
      if (serialized && serialized !== '{}') {
        return `${fallbackMessage}\n${serialized}`;
      }
    } catch {
      // Fall through to String(value) below.
    }

    const stringified = String(value);
    if (
      stringified &&
      stringified !== '[object Object]' &&
      stringified !== 'undefined'
    ) {
      return `${fallbackMessage}\n${stringified}`;
    }
  }

  return fallbackMessage;
};

/** Chromium reports this when resize work spans the same frame; not an app fault. */
const RESIZE_OBSERVER_LOOP_MESSAGE =
  /ResizeObserver loop completed with undelivered notifications/i;

const isIgnorableRuntimeFault = (value: unknown): boolean => {
  const extractMessage = (): string => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message || '';
    if (
      value &&
      typeof value === 'object' &&
      'message' in value &&
      typeof (value as { message?: unknown }).message === 'string'
    ) {
      return (value as { message: string }).message;
    }
    return '';
  };

  const message = extractMessage().trim();
  if (RESIZE_OBSERVER_LOOP_MESSAGE.test(message)) {
    return true;
  }

  const errorCode =
    value &&
    typeof value === 'object' &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'string'
      ? (value as { error: string }).error
      : '';

  return (
    errorCode === 'timeout' &&
    /^Request timed out after \d+ ms\b/i.test(message)
  );
};

function App() {
  type SendQortOriginRect = {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;

  const [extState, setExtstate] = useAtom(extStateAtom);
  const [desktopViewMode, setDesktopViewMode] = useState('home');
  const [rawWallet, setRawWallet] = useAtom(rawWalletAtom);
  const [qortBalanceLoading, setQortBalanceLoading] = useAtom(
    qortBalanceLoadingAtom
  );
  const [requestConnection, setRequestConnection] = useState<any>(null);
  const [requestBuyOrder, setRequestBuyOrder] = useState<any>(null);
  const [userInfo, setUserInfo] = useAtom(userInfoAtom);
  const [balance, setBalance] = useAtom(balanceAtom);
  const [paymentTo, setPaymentTo] = useState<string>('');
  const [sendPaymentError, setSendPaymentError] = useState<string>('');
  const [countdown, setCountdown] = useState<null | number>(null);
  const [globalRuntimeFault, setGlobalRuntimeFault] = useState<{
    message: string;
    source: 'boundary' | 'error' | 'promise';
  } | null>(null);
  const [authUnlockTransition, setAuthUnlockTransition] =
    useState<AuthUnlockTransitionSnapshot | null>(null);
  const [walletToBeDownloaded, setWalletToBeDownloaded] = useState<any>(null);
  const [isBackupWalletModalOpen, setIsBackupWalletModalOpen] = useState(false);
  const [walletToBeDownloadedPassword, setWalletToBeDownloadedPassword] =
    useState<string>('');
  const setOpenCoreSetup = useSetAtom(isOpenCoreSetup);
  const setPublicNodeUnavailable = useSetAtom(isPublicNodeUnavailableAtom);
  const setAuthenticatePassword = useSetAtom(authenticatePasswordAtom);
  const [sendqortState, setSendqortState] = useState<any>(null);
  const [isLoading, setIsLoading] = useAtom(isLoadingAuthenticateAtom);
  const isAuthenticated = extState === 'authenticated';
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

   useEffect(() => {
    const w = window as Window & { __qortalCurrentAddress?: string | null };
    w.__qortalCurrentAddress = userInfo?.address ?? null;
    return () => {
      delete w.__qortalCurrentAddress;
    };
  }, [userInfo?.address]);

  const downloadResource = useFetchResources();
  const holdRefExtState = useRef<extStates>('not-authenticated');
  const suppressWalletInfoRestoreRef = useRef(false);
  const isFocusedRef = useRef<boolean>(true);
  const permissionHandlerRef = useRef<
    ((message: any, event: MessageEvent) => void) | null
  >(null);

  const { resetAllRecoil } = useAppReset();

  const { showTutorial } = useHandleTutorials();

  const modals = useAppModals();
  const {
    paymentPublish,
    unsavedChanges,
    info,
    qortalRequest,
    qortalRequestExtension,
    confirmRequestRead,
    setConfirmRequestRead,
    qortalRequestCheckbox1Ref,
  } = modals;
  const isShow = paymentPublish.isShow;
  const onCancel = paymentPublish.onCancel;
  const onOk = paymentPublish.onOk;
  const show = paymentPublish.show;
  const message = paymentPublish.message;
  const isShowUnsavedChanges = unsavedChanges.isShow;
  const onCancelUnsavedChanges = unsavedChanges.onCancel;
  const onOkUnsavedChanges = unsavedChanges.onOk;
  const showUnsavedChanges = unsavedChanges.show;
  const messageUnsavedChanges = unsavedChanges.message;
  const isShowInfo = info.isShow;
  const onOkInfo = info.onOk;
  const showInfo = info.show;
  const messageInfo = info.message;
  const onCancelQortalRequest = qortalRequest.onCancel;
  const onOkQortalRequest = qortalRequest.onOk;
  const showQortalRequest = qortalRequest.show;
  const isShowQortalRequest = qortalRequest.isShow;
  const messageQortalRequest = qortalRequest.message;
  const onCancelQortalRequestExtension = qortalRequestExtension.onCancel;
  const onOkQortalRequestExtension = qortalRequestExtension.onOk;
  const showQortalRequestExtension = qortalRequestExtension.show;
  const isShowQortalRequestExtension = qortalRequestExtension.isShow;
  const messageQortalRequestExtension = qortalRequestExtension.message;

  const confirmRef = useRef(null);

  const setIsRunningPublicNode = useSetAtom(isRunningPublicNodeAtom);

  const [infoSnack, setInfoSnack] = useAtom(infoSnackGlobalAtom);
  const [openSnack, setOpenSnack] = useAtom(openSnackGlobalAtom);
  const [isOpenDrawerLookup, setIsOpenDrawerLookup] = useState(false);
  const [isOpenSendQort, setIsOpenSendQort] = useState(false);
  const [isOpenReceiveQort, setIsOpenReceiveQort] = useState(false);
  const [isOpenSendQortSuccess, setIsOpenSendQortSuccess] = useState(false);
  const [sendQortOriginRect, setSendQortOriginRect] =
    useState<SendQortOriginRect>(null);
  const [sendQortTargetRect, setSendQortTargetRect] =
    useState<SendQortOriginRect>(null);
  const [receiveQortOriginRect, setReceiveQortOriginRect] =
    useState<SendQortOriginRect>(null);
  const [receiveQortTargetRect, setReceiveQortTargetRect] =
    useState<SendQortOriginRect>(null);
  const [receiveQortAddress, setReceiveQortAddress] = useState('');
  const [selectedNode, setSelectedNode] = useAtom(selectedNodeInfoAtom);
  const {
    isNodeValid,
    authenticate,
    getBalanceFunc,
    handleSaveNodeInfo,
    validateApiKeyFromRegistration,
  } = useAuth();
  useBlockedAddressesLoader(extState === 'authenticated');

  const useLocalNode = isLocalNodeUrl(selectedNode?.url);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const [creationStep, setCreationStep] = useState(1);
  const getIndividualUserInfo = useHandleUserInfo();
  useRetrieveDataLocalStorage(userInfo?.address);
  useQortalGetSaveSettings(userInfo?.name, extState === 'authenticated');
  const setEnableAuthWhenSyncing = useSetAtom(enableAuthWhenSyncingAtom);

  const [isOpenMinting, setIsOpenMinting] = useState(false);
  const generatorRef = useRef(null);

  const ensureGeneratedSeedphrase = useCallback(() => {
    const currentPhrase = generatorRef.current?.parsedString;
    if (currentPhrase) return currentPhrase;

    const generatedPhrase = generateRandomSentence();
    generatorRef.current = {
      parsedString: generatedPhrase,
    };
    return generatedPhrase;
  }, []);

  const prepareNewSeedphrase = useCallback(() => {
    const generatedPhrase = generateRandomSentence();
    generatorRef.current = {
      parsedString: generatedPhrase,
    };
    return generatedPhrase;
  }, []);

  const exportSeedphrase = () => {
    const seedPhrase = ensureGeneratedSeedphrase();
    saveSeedPhraseToDisk(seedPhrase);
  };

  useEffect(() => {
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

  const [storeAccount, setStoredAccount] = useState<boolean>(true);

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      if (isIgnorableRuntimeFault(event.error ?? event.message)) {
        console.warn(
          'Ignoring non-fatal runtime fault',
          event.error || event.message,
          event
        );
        return;
      }
      console.error(
        'Global runtime error',
        event.error || event.message,
        event
      );
      setGlobalRuntimeFault({
        message: formatRuntimeFaultMessage(
          event.error ?? event.message,
          'Unknown runtime error'
        ),
        source: 'error',
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (isIgnorableRuntimeFault(reason)) {
        console.warn('Ignoring non-fatal runtime fault', reason, event);
        return;
      }
      console.error('Unhandled promise rejection', reason, event);
      setGlobalRuntimeFault({
        message: formatRuntimeFaultMessage(
          reason,
          'Unhandled promise rejection'
        ),
        source: 'promise',
      });
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener(
        'unhandledrejection',
        handleUnhandledRejection
      );
    };
  }, []);

  useEffect(() => {
    if (extState !== 'authenticated' && globalRuntimeFault) {
      setGlobalRuntimeFault(null);
    }
  }, [extState, globalRuntimeFault]);

  const contextValue = useMemo(
    () => ({
      onCancel,
      onOk,
      show,
      showInfo,
      downloadResource,
      getIndividualUserInfo,
    }),
    [onCancel, onOk, show, showInfo, downloadResource, getIndividualUserInfo]
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
              url: HTTPS_EXT_NODE_QORTAL_LINK,
              apikey: '',
            };
            handleSetGlobalApikey(payload);
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
                if (suppressWalletInfoRestoreRef.current) return;

                if (
                  holdRefExtState.current === 'web-app-request-payment' ||
                  holdRefExtState.current === 'web-app-request-connection' ||
                  holdRefExtState.current === 'web-app-request-buy-order'
                )
                  return;

                if (holdRefExtState.current !== 'not-authenticated') return;

                if (response?.hasKeyPair) {
                  setRawWallet(response?.walletInfo);
                  setExtstate('authenticated');
                  window.sendMessage('startNotificationCheck').catch(() => {});
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

      let pf: any;

      try {
        if (typeof fileContents !== 'string') return;
        pf = JSON.parse(fileContents);
      } catch (e) {
        console.log(e);
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
                field: getWalletFieldLabel(field),
                postProcess: 'capitalizeFirstChar',
              })
            );
        }
        setRawWallet(pf);
        setExtstate('wallet-dropped');
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
  permissionHandlerRef.current = qortalRequestPermissionFromExtension;
  useAppMessageHandler(isFocusedRef, permissionHandlerRef);

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
    [
      responseToConnectionRequest,
      requestConnection?.hostname,
      requestConnection?.interactionId,
    ]
  );
  const onConnectionRequestDecline = useCallback(
    () =>
      responseToConnectionRequest(
        false,
        requestConnection?.hostname ?? '',
        requestConnection?.interactionId ?? ''
      ),
    [
      responseToConnectionRequest,
      requestConnection?.hostname,
      requestConnection?.interactionId,
    ]
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

  const saveFileToDiskFunc = useCallback(async () => {
    try {
      if (!walletToBeDownloaded?.wallet || !walletToBeDownloaded?.qortAddress) {
        setWalletToBeDownloadedError('No wallet backup is ready yet.');
        return false;
      }

      const saved = await saveFileToDisk(
        walletToBeDownloaded.wallet,
        walletToBeDownloaded.qortAddress
      );
      return Boolean(saved);
    } catch (error: any) {
      setWalletToBeDownloadedError(
        getWalletErrorMessage(
          error,
          t('auth:wallet_errors.unable_to_save_backup', {
            postProcess: 'capitalizeFirstChar',
          })
        )
      );
      return false;
    }
  }, [walletToBeDownloaded, t]);

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
      setWalletToBeDownloadedError('');
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
      const generatedSeedphrase = ensureGeneratedSeedphrase();
      if (!generatedSeedphrase) {
        setWalletToBeDownloadedError(
          'We could not prepare the seedphrase. Please go back and try again.'
        );
        return;
      }
      setIsLoading(true);

      await new Promise<void>((res) => {
        setTimeout(() => {
          res();
        }, 250);
      });

      const res = await createAccount(generatedSeedphrase);
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
            setWalletToBeDecryptedError(getWalletErrorMessage(response.error));
          }
        })
        .catch((error) => {
          setIsLoading(false);
          setWalletToBeDecryptedError(getWalletErrorMessage(error));
          console.error('Failed to decrypt wallet:', error);
        });
    } catch (error: any) {
      console.error('Failed to create account:', error);
      setWalletToBeDownloadedError(
        'We could not create this account. Please try again.'
      );
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
            stopSharedEarbumpPlayback();
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

  const returnToMain = useCallback(() => {
    suppressWalletInfoRestoreRef.current = true;
    holdRefExtState.current = 'authenticated';
    setPaymentTo('');
    setSendPaymentError('');
    setCountdown(null);
    setWalletToBeDownloaded(null);
    setWalletToBeDownloadedPassword('');
    generatorRef.current = null;
    setShowSeed(false);
    setCreationStep(1);
    setSendQortOriginRect(null);
    setSendQortTargetRect(null);
    setReceiveQortOriginRect(null);
    setReceiveQortTargetRect(null);
    setReceiveQortAddress('');
    setExtstate('authenticated');
    setIsOpenSendQort(false);
    setIsOpenReceiveQort(false);
    setIsOpenSendQortSuccess(false);
  }, []);

  const resetAllStates = () => {
    suppressWalletInfoRestoreRef.current = true;
    holdRefExtState.current = 'not-authenticated';
    setExtstate('not-authenticated');
    setRawWallet(null);
    setRequestConnection(null);
    setRequestBuyOrder(null);
    setUserInfo(null);
    setBalance(null);
    setPaymentTo('');
    setSendPaymentError('');
    setCountdown(null);
    setWalletToBeDownloaded(null);
    setWalletToBeDownloadedPassword('');
    generatorRef.current = null;
    setShowSeed(false);
    setCreationStep(1);
    setWalletToBeDownloadedPasswordConfirm('');
    setWalletToBeDownloadedError('');
    setSendqortState(null);
    resetAllRecoil();
  };

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

  const openPaymentInternal = (e) => {
    const directAddress = e.detail?.address;
    const name = e.detail?.name;
    const anchorRect = e.detail?.anchorRect;
    const targetRect = e.detail?.targetRect;
    setSendQortOriginRect(
      anchorRect
        ? {
            left: anchorRect.left,
            top: anchorRect.top,
            width: anchorRect.width,
            height: anchorRect.height,
          }
        : null
    );
    setSendQortTargetRect(
      targetRect
        ? {
            left: targetRect.left,
            top: targetRect.top,
            width: targetRect.width,
            height: targetRect.height,
          }
        : null
    );
    setIsOpenSendQort(true);
    setPaymentTo(name || directAddress || '');
  };

  const openReceiveQortInternal = (e) => {
    const anchorRect = e.detail?.anchorRect;
    const targetRect = e.detail?.targetRect;
    setReceiveQortOriginRect(
      anchorRect
        ? {
            left: anchorRect.left,
            top: anchorRect.top,
            width: anchorRect.width,
            height: anchorRect.height,
          }
        : null
    );
    setReceiveQortTargetRect(
      targetRect
        ? {
            left: targetRect.left,
            top: targetRect.top,
            width: targetRect.width,
            height: targetRect.height,
          }
        : null
    );
    setReceiveQortAddress(e.detail?.address || address || '');
    setIsOpenReceiveQort(true);
  };

  useEffect(() => {
    subscribeToEvent('openPaymentInternal', openPaymentInternal);
    subscribeToEvent('openReceiveQortInternal', openReceiveQortInternal);

    return () => {
      unsubscribeFromEvent('openPaymentInternal', openPaymentInternal);
      unsubscribeFromEvent('openReceiveQortInternal', openReceiveQortInternal);
    };
  }, [address]);

  const onOpenSendQort = useCallback(() => {
    setSendQortOriginRect(null);
    setSendQortTargetRect(null);
    executeEvent('openSendQortInternal', {});
    setIsOpenSendQort(true);
  }, []);
  const onOpenRegisterName = useCallback(
    () => executeEvent('openRegisterName', {}),
    []
  );
  const onOpenSettings = useCallback(() => setIsSettingsOpen(true), []);
  const onOpenDrawerLookup = useCallback(
    () => setIsOpenDrawerLookup((prev) => !prev),
    []
  );
  const onOpenWalletsApp = useCallback(
    () => executeEvent('openWalletsApp', {}),
    []
  );
  const onOpenMinting = useCallback(async () => {
    try {
      const forceLocalMintingPreview =
        typeof window !== 'undefined' &&
        (localStorage.getItem(MINTING_LOCAL_DEBUG_STORAGE_KEY) === 'true' ||
          localStorage.getItem(MINTING_LOCAL_DEBUG_STORAGE_KEY) === '1');
      const res = await isRunningGateway();
      if (res && !forceLocalMintingPreview)
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
    if (extState === 'authenticated' && rawWallet) {
      setIsBackupWalletModalOpen(true);
      return;
    }

    setExtstate('download-wallet');
  }, [extState, rawWallet, setExtstate]);

  const closeBackupWalletModal = useCallback(() => {
    setIsBackupWalletModalOpen(false);
  }, []);

  useEffect(() => {
    subscribeToEvent('openMintingPanel', onOpenMinting);
    subscribeToEvent('openBackupWallet', onBackupWallet);

    return () => {
      unsubscribeFromEvent('openMintingPanel', onOpenMinting);
      unsubscribeFromEvent('openBackupWallet', onBackupWallet);
    };
  }, [onBackupWallet, onOpenMinting]);

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
  const onGoToCreateWallet = useCallback(() => {
    suppressWalletInfoRestoreRef.current = true;
    holdRefExtState.current = 'create-wallet';
    prepareNewSeedphrase();
    setWalletToBeDownloadedError('');
    setWalletToBeDownloadedPassword('');
    setWalletToBeDownloadedPasswordConfirm('');
    setCreationStep(1);
    setExtstate('create-wallet');
  }, [
    prepareNewSeedphrase,
    setExtstate,
    setWalletToBeDownloadedPassword,
    setWalletToBeDownloadedPasswordConfirm,
  ]);
  const onWalletsBack = useCallback(() => {
    suppressWalletInfoRestoreRef.current = true;
    holdRefExtState.current = 'not-authenticated';
    setRawWallet(null);
    setExtstate('not-authenticated');
    logoutFunc();
  }, [setExtstate, logoutFunc]);
  const onAuthenticationFormBack = useCallback(() => {
    suppressWalletInfoRestoreRef.current = true;
    holdRefExtState.current = 'not-authenticated';
    setRawWallet(null);
    setExtstate('not-authenticated');
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
    suppressWalletInfoRestoreRef.current = true;
    holdRefExtState.current = 'not-authenticated';
    setExtstate('not-authenticated');
    setShowSeed(false);
    setCreationStep(1);
    setWalletToBeDownloadedPasswordConfirm('');
    setWalletToBeDownloadedPassword('');
    setWalletToBeDownloadedError('');
    generatorRef.current = null;
  }, [
    creationStep,
    setExtstate,
    setWalletToBeDownloadedPasswordConfirm,
    setWalletToBeDownloadedPassword,
  ]);
  const onShowSeed = useCallback(() => setShowSeed(true), []);
  const onHideSeed = useCallback(() => setShowSeed(false), []);
  const onCreationStepNext = useCallback(() => {
    ensureGeneratedSeedphrase();
    setWalletToBeDownloadedError('');
    setCreationStep(2);
  }, [ensureGeneratedSeedphrase]);

  const isPublicNodeReachable = useCallback(async () => {
    try {
      const response = await fetch(
        `${HTTPS_EXT_NODE_QORTAL_LINK}/admin/status`
      );
      return response.ok;
    } catch (error) {
      return false;
    }
  }, []);

  const isLocalCoreReadyForHub = useCallback(async () => {
    try {
      const response = await fetch(`${HTTP_LOCALHOST_12391}/admin/status`);
      if (!response.ok) return false;

      const status = await response.json();
      const syncPercent = Number(status?.syncPercent);
      return (
        Number.isFinite(syncPercent) &&
        syncPercent >= LOCAL_CORE_READY_SYNC_PERCENT
      );
    } catch (error) {
      return false;
    }
  }, []);

  const prepareNodeForHubEntry = useCallback(async () => {
    const selectedUrl = selectedNode?.url || HTTPS_EXT_NODE_QORTAL_LINK;
    const usingDefaultPublic = selectedUrl === HTTPS_EXT_NODE_QORTAL_LINK;
    const blockedEntry = {
      canEnter: false,
      shouldOpenCoreSetupAfterEntry: false,
    };

    if (usingDefaultPublic) {
      if (!(await isPublicNodeReachable())) {
        setPublicNodeUnavailable(true);
        setOpenCoreSetup(true);
        return blockedEntry;
      }

      setPublicNodeUnavailable(false);
      return {
        canEnter: true,
        shouldOpenCoreSetupAfterEntry: true,
      };
    }

    if (isLocalNodeUrl(selectedUrl) && !(await isLocalCoreReadyForHub())) {
      if (await isPublicNodeReachable()) {
        setPublicNodeUnavailable(false);
        await handleSaveNodeInfo({
          url: HTTPS_EXT_NODE_QORTAL_LINK,
          apikey: '',
        });
        return {
          canEnter: true,
          shouldOpenCoreSetupAfterEntry: true,
        };
      }

      setPublicNodeUnavailable(true);
      setOpenCoreSetup(true);
      return blockedEntry;
    }

    setPublicNodeUnavailable(false);
    return {
      canEnter: true,
      shouldOpenCoreSetupAfterEntry: false,
    };
  }, [
    handleSaveNodeInfo,
    isLocalCoreReadyForHub,
    isPublicNodeReachable,
    selectedNode?.url,
    setOpenCoreSetup,
    setPublicNodeUnavailable,
  ]);

  const onBackupAccountConfirm = useCallback(async () => {
    return saveFileToDiskFunc();
  }, [saveFileToDiskFunc]);

  const onEnterHubAfterCreate = useCallback(async () => {
    const entryPreparation = await prepareNodeForHubEntry();
    if (!entryPreparation.canEnter) return;

    returnToMain();

    if (window?.coreSetup && entryPreparation.shouldOpenCoreSetupAfterEntry) {
      window.setTimeout(() => {
        setOpenCoreSetup(true);
      }, 650);
    }
  }, [prepareNodeForHubEntry, returnToMain, setOpenCoreSetup]);
  const onCountdownComplete = useCallback(() => {
    window.close();
  }, []);
  const onTransferSuccessContinue = useCallback(() => returnToMain(), []);
  const onTransferSuccessRequestClose = useCallback(() => window.close(), []);
  const onBuyOrderSubmittedClose = useCallback(() => window.close(), []);
  const onOkQortalRequestExtensionAccept = useCallback(() => {
    const ext = messageQortalRequestExtension as
      | { confirmCheckbox?: boolean }
      | null
      | undefined;
    if (ext?.confirmCheckbox && !confirmRequestRead) return;
    onOkQortalRequestExtension('accepted');
  }, [
    messageQortalRequestExtension,
    confirmRequestRead,
    onOkQortalRequestExtension,
  ]);
  const onOpenCoreSetup = useCallback(
    () => setOpenCoreSetup(true),
    [setOpenCoreSetup]
  );
  const isElectron =
    typeof window !== 'undefined' &&
    typeof (
      window as Window & { electronAPI?: { windowMinimize?: () => unknown } }
    ).electronAPI?.windowMinimize === 'function';
  const shouldReduceAuthTransition =
    typeof window !== 'undefined' &&
    (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      window.localStorage.getItem('hub_ui_animations_enabled') === 'false');

  const mainContent = (
    <>
      <PdfViewer />

      <QORTAL_APP_CONTEXT.Provider value={contextValue as AppContextInterface}>
        <ElectronPersistentStorageHydration />
        <CoreSetup />
        <Tutorials />
        {extState === 'not-authenticated' && (
          <NotAuthenticated
            onWalletUnlockStart={setAuthUnlockTransition}
            setExtstate={setExtstate}
            setRawWallet={setRawWallet}
            rawWallet={rawWallet}
          />
        )}

        {extState === 'authenticated' && isMainWindow && (
          <Suspense fallback={<Loader />}>
            <ErrorBoundary
              fallback={({ error, componentStack }) => (
                <Box
                  sx={{
                    alignItems: 'flex-start',
                    backdropFilter: 'blur(18px)',
                    background:
                      theme.palette.mode === 'dark'
                        ? 'linear-gradient(180deg, rgba(18,22,29,0.92) 0%, rgba(11,14,20,0.96) 100%)'
                        : 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(244,247,252,0.96) 100%)',
                    border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(20,24,32,0.08)'}`,
                    borderRadius: '24px',
                    boxShadow:
                      theme.palette.mode === 'dark'
                        ? '0 24px 48px rgba(0,0,0,0.3)'
                        : '0 18px 36px rgba(15,20,30,0.12)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    m: '24px',
                    maxWidth: '560px',
                    p: '22px',
                  }}
                >
                  <Typography sx={{ fontSize: '1.05rem', fontWeight: 800 }}>
                    Hub runtime error
                  </Typography>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.85rem',
                      lineHeight: 1.55,
                    }}
                  >
                    The authenticated shell crashed during render.
                  </Typography>
                  {error?.message ? (
                    <Typography
                      sx={{
                        color: 'rgba(246,248,252,0.9)',
                        fontFamily:
                          'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace',
                        fontSize: '0.78rem',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {error.message}
                    </Typography>
                  ) : null}
                  {componentStack ? (
                    <Typography
                      sx={{
                        color: 'rgba(214,221,233,0.55)',
                        fontFamily:
                          'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace',
                        fontSize: '0.7rem',
                        lineHeight: 1.45,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {componentStack.trim()}
                    </Typography>
                  ) : null}
                </Box>
              )}
            >
              <Box
                sx={{
                  animation: shouldReduceAuthTransition
                    ? 'none'
                    : 'dashboardAfterAuthIn 720ms cubic-bezier(0.4, 0, 0.2, 1) both',
                  height: '100%',
                  width: '100%',
                  '@keyframes dashboardAfterAuthIn': {
                    from: {
                      opacity: 0,
                      transform: 'translateY(8px)',
                    },
                    to: {
                      opacity: 1,
                      transform: 'translateY(0)',
                    },
                  },
                }}
              >
                <LazyAuthenticatedShell
                  balance={balance}
                  desktopViewMode={desktopViewMode}
                  isMain={true}
                  logoutFunc={logoutFunc}
                  myAddress={address}
                  setDesktopViewMode={setDesktopViewMode}
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
                  getUserInfo={getUserInfo}
                  onOpenMinting={onOpenMinting}
                  showTutorial={showTutorial}
                  onBackupWallet={onBackupWallet}
                />
              </Box>
            </ErrorBoundary>
          </Suspense>
        )}

        {isMainWindow && (
          <BackupWalletModal
            open={isBackupWalletModalOpen}
            onClose={closeBackupWalletModal}
            rawWallet={rawWallet}
          />
        )}

        <AnimatePresence>
          {isOpenSendQort && isMainWindow && (
            <SendQortOverlay
              balance={balance}
              originRect={sendQortOriginRect}
              targetRect={sendQortTargetRect}
              paymentTo={paymentTo}
              onReturn={returnToMain}
              onSuccess={() => {
                setIsOpenSendQort(false);
                setSendQortOriginRect(null);
                setSendQortTargetRect(null);
                setIsOpenSendQortSuccess(true);
              }}
              show={show}
            />
          )}
          {isOpenReceiveQort && isMainWindow && (
            <ReceiveQortOverlay
              address={receiveQortAddress || address || ''}
              originRect={receiveQortOriginRect}
              targetRect={receiveQortTargetRect}
              onReturn={() => {
                setIsOpenReceiveQort(false);
                setReceiveQortOriginRect(null);
                setReceiveQortTargetRect(null);
                setReceiveQortAddress('');
              }}
            />
          )}
        </AnimatePresence>

        {isShowQortalRequest && !isMainWindow && (
          <QortalRequestScreen
            message={messageQortalRequest}
            sendPaymentError={sendPaymentError}
            onAccept={onOkQortalRequestAccepted}
            onDecline={onCancelQortalRequest}
            onCheckboxChange={(checked) => {
              qortalRequestCheckbox1Ref.current = checked;
            }}
            checkboxDefaultChecked={
              (messageQortalRequest as { checkbox1?: { value?: boolean } })
                ?.checkbox1?.value
            }
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
            selectedNode={selectedNode}
            unlockTransition={authUnlockTransition}
            walletToBeDecryptedError={walletToBeDecryptedError}
            onBack={onAuthenticationFormBack}
            onAuthenticate={authenticateWallet}
            onUnlockTransitionComplete={() => setAuthUnlockTransition(null)}
          />
        )}
        {extState === 'download-wallet' && (
          <DownloadWallet
            returnToMain={returnToMain}
            setIsLoading={setIsLoading}
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
            walletToBeDownloadedPasswordConfirm={
              walletToBeDownloadedPasswordConfirm
            }
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
            onEnterHub={onEnterHubAfterCreate}
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
          onClose={() => onOkInfo(undefined)}
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

        <QortinoNotificationHost
          open={openSnack}
          setOpen={setOpenSnack}
          info={infoSnack}
          setInfo={setInfoSnack}
        />

        <UserLookup
          isOpenDrawerLookup={isOpenDrawerLookup}
          setIsOpenDrawerLookup={setIsOpenDrawerLookup}
        />

        <RegisterName
          balance={balance}
          show={show}
          userInfo={userInfo}
          setOpenSnack={setOpenSnack}
          setInfoSnack={
            setInfoSnack as (
              info: { type: string; message: string } | null
            ) => void
          }
        />
        <BuyQortInformation balance={balance} />
        {isMainWindow && <NotificationPermissionSlideDown />}
      </QORTAL_APP_CONTEXT.Provider>

      {isOpenMinting && (
        <Minting
          setIsOpenMinting={setIsOpenMinting}
          myAddress={address}
          show={show}
        />
      )}

      {!isAuthenticated && (
        <NotAuthenticatedFooter
          showCoreSetup
          onOpenCoreSetup={onOpenCoreSetup}
        />
      )}
    </>
  );

  const titleBarRightNav: CustomTitleBarRightNavProps | null =
    extState === 'authenticated' && isMainWindow
      ? {
          desktopViewMode,
          extState,
          isMainWindow,
          userInfo,
          onOpenSettings,
          onOpenDrawerLookup,
          onOpenWalletsApp,
          onLogout: logoutFunc,
          getUserInfo,
          onOpenMinting,
          showTutorial,
          onBackupWallet,
        }
      : null;

  return (
    <AppContainer
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        ['--electron-title-bar-height' as string]: `${CUSTOM_TITLE_BAR_HEIGHT}px`,
      }}
    >
      <CustomTitleBar rightNav={titleBarRightNav} />
      {extState === 'authenticated' && isMainWindow && (
        <GlobalQortalNavBar
          desktopViewMode={desktopViewMode}
          utilityNav={titleBarRightNav}
        />
      )}

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          overflow: 'hidden',
        }}
      >
        {globalRuntimeFault && extState === 'authenticated' && isMainWindow ? (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'center',
              p: 3,
              width: '100%',
            }}
          >
            <Box
              sx={{
                alignItems: 'flex-start',
                backdropFilter: 'blur(18px)',
                background:
                  theme.palette.mode === 'dark'
                    ? 'linear-gradient(180deg, rgba(18,22,29,0.92) 0%, rgba(11,14,20,0.96) 100%)'
                    : 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(244,247,252,0.96) 100%)',
                border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(20,24,32,0.08)'}`,
                borderRadius: '24px',
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? '0 24px 48px rgba(0,0,0,0.3)'
                    : '0 18px 36px rgba(15,20,30,0.12)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                maxWidth: '620px',
                p: '22px',
                width: '100%',
              }}
            >
              <Typography sx={{ fontSize: '1.05rem', fontWeight: 800 }}>
                Hub runtime error
              </Typography>
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.85rem',
                  lineHeight: 1.55,
                }}
              >
                The authenticated app hit a runtime fault after login. We are
                surfacing it here instead of leaving a white screen.
              </Typography>
              <Box
                sx={{
                  background:
                    theme.palette.mode === 'dark'
                      ? 'rgba(255,255,255,0.03)'
                      : 'rgba(24,32,44,0.04)',
                  border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(24,32,44,0.08)'}`,
                  borderRadius: '16px',
                  px: 1.5,
                  py: 1.2,
                }}
              >
                <Typography
                  sx={{ fontSize: '0.78rem', fontWeight: 700, mb: 0.45 }}
                >
                  {globalRuntimeFault.source}
                </Typography>
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {globalRuntimeFault.message}
                </Typography>
              </Box>
            </Box>
          </Box>
        ) : (
          mainContent
        )}
      </Box>
    </AppContainer>
  );
}

export default App;
