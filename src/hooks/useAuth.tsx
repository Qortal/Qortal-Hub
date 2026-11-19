import { useCallback, useEffect, useMemo } from 'react';
import {
  getDefaultLocalNodeUrl,
  EXT_NODE_QORTAL_LINK,
  HTTP_LOCALHOST_12391,
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
  TIME_MINUTES_2_IN_MILLISECONDS,
  TIME_SECONDS_40_IN_MILLISECONDS,
} from '../constants/constants';
import {
  isLocalPrivateHttpsUrl,
  ensureElectronCertIfLocalPrivateHttps,
} from '../utils/helpers';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import {
  authenticatePasswordAtom,
  balanceAtom,
  enableAuthWhenSyncingAtom,
  extStateAtom,
  isLoadingAuthenticateAtom,
  isOpenCoreSetup,
  isOpenDialogCustomApikey,
  isOpenDialogResetApikey,
  isOpenSettingUpLocalCoreAtom,
  isOpenSyncingDialogAtom,
  isOpenUrlInvalidAtom,
  isPublicNodeUnavailableAtom,
  isRunningPublicNodeAtom,
  qortBalanceLoadingAtom,
  rawWalletAtom,
  selectedNodeInfoAtom,
  userInfoAtom,
  walletToBeDecryptedErrorAtom,
} from '../atoms/global';
import { handleSetGlobalApikey } from '../App';
import {
  getLocalApiKeyNotElectronCase,
  setLocalApiKeyNotElectronCase,
} from '../background/background-cases';
import { ApiKey } from '../types/auth';
import { useModalGlobal } from './useModalGlobal';
import { getWalletErrorMessage } from '../utils/walletErrorMessages';
import { saveLastAuthenticatedWalletAddress } from '../utils/lastAuthenticatedWallet';
import { isLoopbackNodeUrl } from '../utils/loopbackNodeUrl';

let balanceSetIntervalRef: null | NodeJS.Timeout = null;
const LOCAL_CORE_READY_SYNC_PERCENT = 99.95;
const ADMIN_STATUS_FETCH_TIMEOUT_MS = 5000;

function isLocalCoreStatusSynced(status: any) {
  const syncPercent = Number(status?.syncPercent);
  return (
    Number.isFinite(syncPercent) && syncPercent >= LOCAL_CORE_READY_SYNC_PERCENT
  );
}

function isGatewayNode(nodeInfo?: ApiKey | null) {
  return !nodeInfo?.url || nodeInfo.url.includes(EXT_NODE_QORTAL_LINK);
}

/**
 * What a node says to a yes/no question such as "is this key valid?". Only
 * Core's own answer counts as a no: 401, 403 or "false". An error page from
 * a proxy in front of a busy node (502, 503, an HTML page), or no answer at
 * all, means the node didn't answer, not that the key is wrong.
 */
export type NodeYesNoAnswer = 'yes' | 'no' | 'no-answer';

export async function readNodeYesNoAnswer(
  response: Response
): Promise<NodeYesNoAnswer> {
  if (response.status === 401 || response.status === 403) return 'no';
  if (!response.ok) return 'no-answer';
  const text = (await response.text()).trim();
  if (text === 'true') return 'yes';
  if (text === 'false') return 'no';
  return 'no-answer';
}

export const useAuth = () => {
  const setIsOpenResetApikey = useSetAtom(isOpenDialogResetApikey);
  const setIsOpenCustomApikeyDialog = useSetAtom(isOpenDialogCustomApikey);
  const setBalance = useSetAtom(balanceAtom);
  const setQortBalanceLoading = useSetAtom(qortBalanceLoadingAtom);
  const setIsOpenSettingUpCore = useSetAtom(isOpenSettingUpLocalCoreAtom);
  const actions = useModalGlobal({ setGlobalOpen: setIsOpenSettingUpCore });

  const setIsOpenCoreSetup = useSetAtom(isOpenCoreSetup);
  const setIsOpenSyncingDialog = useSetAtom(isOpenSyncingDialogAtom);
  const [selectedNode, setSelectedNode] = useAtom(selectedNodeInfoAtom);
  const setUserInfo = useSetAtom(userInfoAtom);
  const setWalletToBeDecryptedError = useSetAtom(walletToBeDecryptedErrorAtom);
  const setIsUrlInvalid = useSetAtom(isOpenUrlInvalidAtom);
  const setPublicNodeUnavailable = useSetAtom(isPublicNodeUnavailableAtom);
  const setIsRunningPublicNode = useSetAtom(isRunningPublicNodeAtom);

  const setIsLoading = useSetAtom(isLoadingAuthenticateAtom);
  const setExtstate = useSetAtom(extStateAtom);
  const extState = useAtomValue(extStateAtom);
  const [enableAuthWhenSyncing] = useAtom(enableAuthWhenSyncingAtom);
  const setAuthenticatePassword = useSetAtom(authenticatePasswordAtom);
  const store = useStore();
  const [rawWallet, setRawWallet] = useAtom(rawWalletAtom);

  const useLocalNode = isLocalNodeUrl(selectedNode?.url);

  useEffect(() => {
    if (extState === 'not-authenticated') {
      if (balanceSetIntervalRef) {
        clearInterval(balanceSetIntervalRef);
        balanceSetIntervalRef = null;
      }
    }
  }, [extState]);

  const checkIfLocalIsRunning = useCallback(async (baseUrl: string) => {
    try {
      const res = await fetch(baseUrl + '/admin/status');
      if (res?.ok) return true;
      return false;
    } catch (error) {
      return false;
    }
  }, []);

  const generateApiKey = useCallback(async () => {
    try {
      const res = await fetch(
        `${getDefaultLocalNodeUrl()}/admin/apikey/generate`,
        {
          method: 'POST',
        }
      );
      if (!res.ok) {
        return null;
      }
      const key = (await res.text()).trim();
      if (!key) return null;
      return key;
    } catch (error) {
      return null;
    }
  }, []);

  const validateApiKey = useCallback(
    async (currentNode, disablePopup = false) => {
      const isElectron = !!window?.coreSetup;
      const validatedNodeInfo = currentNode;

      const isLocalPrivateHttps = isLocalPrivateHttpsUrl(
        validatedNodeInfo?.url
      );
      let baseUrl = validatedNodeInfo?.url;
      if (isLocalPrivateHttps && baseUrl) {
        baseUrl = baseUrl.replace(/^https:\/\//i, 'http://');
      }
      try {
        const isLocal = isLocalNodeUrl(validatedNodeInfo?.url);
        if (isLocal) {
          const runningRes = isElectron
            ? await window.coreSetup.isCoreRunning()
            : await checkIfLocalIsRunning(baseUrl);
          if (!runningRes && !disablePopup) {
            setIsOpenCoreSetup(true);
            return { isValid: false, validatedNodeInfo };
          }
          if (isLocal && isElectron && !disablePopup) {
            const statusAvailable = await checkIfLocalIsRunning(baseUrl);
            if (!statusAvailable) {
              const endpointsReady = await actions.show();
              if (!endpointsReady) {
                return;
              }
            }
          }
          const apiKey = isElectron
            ? await window.coreSetup.getApiKey()
            : await getLocalApiKeyNotElectronCase();
          if (apiKey) {
            validatedNodeInfo.apikey = apiKey;
          }
        }

        if (!isLocal) {
          let isUrlGood = true;
          try {
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => {
              controller.abort();
            }, ADMIN_STATUS_FETCH_TIMEOUT_MS);
            let resUrlCheck: Response;
            try {
              resUrlCheck = await fetch(`${baseUrl}/admin/status`, {
                signal: controller.signal,
              });
            } finally {
              window.clearTimeout(timeoutId);
            }
            if (!resUrlCheck.ok) {
              isUrlGood = false;
            }
          } catch (error) {
            isUrlGood = false;
          }

          if (!isUrlGood) {
            if (!disablePopup) {
              if (validatedNodeInfo?.url === HTTPS_EXT_NODE_QORTAL_LINK) {
                setPublicNodeUnavailable(true);
                setIsOpenCoreSetup(true);
              } else {
                setIsUrlInvalid(true);
              }
            }
            return { isValid: false, validatedNodeInfo, nodeAnswered: false };
          }

          if (validatedNodeInfo?.url === HTTPS_EXT_NODE_QORTAL_LINK) {
            setPublicNodeUnavailable(false);
          }
        }

        let isValid = false;
        // False when the node didn't answer the key check (an error page or
        // nothing): a key can't be judged then.
        let nodeAnsweredKeyCheck = true;

        const url = `${baseUrl}/admin/settings/localAuthBypassEnabled`;
        let bypass: NodeYesNoAnswer = 'no-answer';
        try {
          bypass = await readNodeYesNoAnswer(await fetch(url));
        } catch (error) {
          // No answer at all. A node on this computer stops here, as before;
          // any other node is still asked about the key.
          if (isLocal) throw error;
        }
        // Core skips the key only for requests from its own machine, so the
        // bypass counts only for a loopback node URL, not a node on the LAN.
        if (bypass === 'yes' && isLoopbackNodeUrl(baseUrl)) {
          isValid = true;
        } else {
          let keyCheck: NodeYesNoAnswer = 'no-answer';
          try {
            const url2 = `${baseUrl}/admin/apikey/test?apiKey=${validatedNodeInfo?.apikey}`;
            const response2 = await fetch(url2);
            keyCheck = await readNodeYesNoAnswer(response2);
          } catch (error) {
            keyCheck = 'no-answer';
          }
          isValid = keyCheck === 'yes';
          nodeAnsweredKeyCheck = keyCheck !== 'no-answer';
        }
        if (!isValid && isLocal && !isElectron) {
          const resGenerateApiKey = await generateApiKey();
          if (resGenerateApiKey) {
            validatedNodeInfo.apikey = resGenerateApiKey;
            isValid = true;
          }
        }
        if (!isValid && isLocal && !disablePopup) {
          setIsOpenResetApikey(true);
        } else if (!isValid && !isLocal && !disablePopup) {
          if (validatedNodeInfo?.url === HTTPS_EXT_NODE_QORTAL_LINK) {
            // Nobody has a key for the public node: offer the local node.
            setPublicNodeUnavailable(true);
            setIsOpenCoreSetup(true);
          } else if (!nodeAnsweredKeyCheck) {
            // Busy or down: as when /admin/status doesn't answer.
            setIsUrlInvalid(true);
          } else {
            setIsOpenCustomApikeyDialog(true);
          }
        }
        if (isValid && !isElectron && isLocal && !disablePopup) {
          setLocalApiKeyNotElectronCase(validatedNodeInfo.apikey);
        }

        if (isValid && isElectron) {
          const cert = await ensureElectronCertIfLocalPrivateHttps(
            validatedNodeInfo?.url,
            validatedNodeInfo?.apikey ?? ''
          );
          if (!cert.success) {
            throw new Error(cert.error || 'Failed to ensure cert for base');
          }
        }

        // nodeAnswered false: the key wasn't judged, so it isn't a wrong key.
        return {
          isValid,
          validatedNodeInfo,
          nodeAnswered: nodeAnsweredKeyCheck,
        };
      } catch (error) {
        return { isValid: false, validatedNodeInfo };
      }
    },
    [
      setIsOpenCustomApikeyDialog,
      setIsOpenResetApikey,
      checkIfLocalIsRunning,
      generateApiKey,
      setIsOpenCoreSetup,
      setIsUrlInvalid,
      setPublicNodeUnavailable,
    ]
  );

  const validateLocalApiKey = useCallback(async (apiKey) => {
    try {
      const url2 = `${getDefaultLocalNodeUrl()}/admin/apikey/test?apiKey=${apiKey}`;
      const response2 = await fetch(url2);

      // Assuming the response is in plain text and will be 'true' or 'false'
      const data2 = await response2.text();
      if (data2 === 'true') {
        setLocalApiKeyNotElectronCase(apiKey);
        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }, []);

  const handleSaveNodeInfo = useCallback(
    async (nodeInfo) => {
      const nextNodeInfo = nodeInfo || {
        url: HTTPS_EXT_NODE_QORTAL_LINK,
        apikey: '',
      };

      await window.sendMessage('setApiKey', nextNodeInfo);
      setSelectedNode(nextNodeInfo);
      handleSetGlobalApikey(nextNodeInfo);
      try {
        setIsRunningPublicNode(isGatewayNode(nextNodeInfo));
      } catch (error) {
        console.error(error);
      }
    },
    [setIsRunningPublicNode, setSelectedNode]
  );

  const isNodeValid = useCallback(async (): Promise<boolean> => {
    try {
      const currentSelectedNode = store.get(selectedNodeInfoAtom);
      const isCurrentLocalNode = isLocalNodeUrl(currentSelectedNode?.url);

      if (isCurrentLocalNode) {
        const payload = {
          apikey: '',
          url: getDefaultLocalNodeUrl(),
        };
        const { isValid, validatedNodeInfo } = await validateApiKey(payload);

        if (isValid) {
          await handleSaveNodeInfo(validatedNodeInfo);
          return true;
        } else {
          return false;
        }
      } else {
        const payload = currentSelectedNode;
        if (!payload) return false;
        const { isValid, validatedNodeInfo } = await validateApiKey(payload);

        if (isValid) {
          await handleSaveNodeInfo(validatedNodeInfo);
          return true;
        } else {
          return false;
        }
      }
    } catch (error) {
      return false;
    }
  }, [store, validateApiKey, handleSaveNodeInfo]);

  const balanceSetInterval = useCallback(() => {
    try {
      if (balanceSetIntervalRef) {
        clearInterval(balanceSetIntervalRef);
      }

      let isCalling = false;
      balanceSetIntervalRef = setInterval(async () => {
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
  }, [setBalance]);

  const getBalanceFunc = useCallback(() => {
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
  }, [balanceSetInterval, setBalance, setQortBalanceLoading]);

  const resetApikey = useCallback(async () => {
    try {
      await window.coreSetup.resetApikey();
    } catch (error) {
      console.error(error);
    }
  }, []);

  const isSyncedLocal = useCallback(async () => {
    try {
      const currentSelectedNode = store.get(selectedNodeInfoAtom);
      if (!isLocalNodeUrl(currentSelectedNode?.url)) return true;
      const res = await fetch(HTTP_LOCALHOST_12391 + '/admin/status');
      if (!res?.ok) return false;
      const data = await res.json();
      if (!isLocalCoreStatusSynced(data)) {
        if (enableAuthWhenSyncing) {
          return true;
        }
        setIsOpenSyncingDialog(true);
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }, [store, setIsOpenSyncingDialog, enableAuthWhenSyncing]);

  const authenticate = useCallback(
    async (skipToPublic?: boolean, skipLocalCheck?: boolean) => {
      if (!skipToPublic && !skipLocalCheck) {
        const isInSync = await isSyncedLocal();
        if (!isInSync) {
          return;
        }
      }
      setIsLoading(true);
      setWalletToBeDecryptedError('');
      await new Promise<void>((res) => {
        setTimeout(() => {
          res();
        }, 250);
      });
      const password = store.get(authenticatePasswordAtom);
      window
        .sendMessage(
          'decryptWallet',
          {
            password,
            wallet: rawWallet,
          },
          TIME_MINUTES_2_IN_MILLISECONDS
        )
        .then((response) => {
          if (response && !response.error) {
            saveLastAuthenticatedWalletAddress(rawWallet?.address0);
            setAuthenticatePassword('');
            setExtstate('authenticated');
            setWalletToBeDecryptedError('');
            window.sendMessage('startNotificationCheck').catch(() => {});

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
            setWalletToBeDecryptedError(getWalletErrorMessage(response.error));
          }
        })
        .catch((error) => {
          setIsLoading(false);
          setWalletToBeDecryptedError(getWalletErrorMessage(error));
          console.error('Failed to decrypt wallet:', error);
        });
    },
    [
      store,
      setIsLoading,
      setAuthenticatePassword,
      setExtstate,
      setUserInfo,
      setRawWallet,
      setWalletToBeDecryptedError,
      rawWallet,
      getBalanceFunc,
    ]
  );

  const saveCustomNodes = useCallback(async (updatedNode: ApiKey) => {
    let nodes = [];

    try {
      nodes = await window.sendMessage('getCustomNodesFromStorage');
    } catch (error) {
      console.error(error);
    }
    if (!nodes) return;
    const customNodeToSaveIndex = nodes.findIndex(
      (n) => n?.url === updatedNode?.url
    );
    if (customNodeToSaveIndex === -1) return;

    nodes.splice(customNodeToSaveIndex, 1, updatedNode);

    window.sendMessage('setCustomNodes', nodes).catch(() => {
      console.error('Failed to set custom nodes');
    });
  }, []);

  const validateApiKeyFromRegistration = useCallback(async () => {
    try {
      const { isValid } = await validateApiKey(selectedNode, true);
      if (!isValid) {
        await handleSaveNodeInfo(null);
      }
    } catch (error) {
      await handleSaveNodeInfo(null);
      console.error(error);
    }
  }, [selectedNode, validateApiKey, handleSaveNodeInfo]);

  return useMemo(
    () => ({
      validateApiKey,
      isNodeValid,
      handleSaveNodeInfo,
      authenticate,
      getBalanceFunc,
      resetApikey,
      validateLocalApiKey,
      validateApiKeyFromRegistration,
      saveCustomNodes,
    }),
    [
      validateApiKey,
      isNodeValid,
      handleSaveNodeInfo,
      authenticate,
      getBalanceFunc,
      resetApikey,
      validateLocalApiKey,
      validateApiKeyFromRegistration,
      saveCustomNodes,
    ]
  );
};
