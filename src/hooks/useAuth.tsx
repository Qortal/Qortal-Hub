import { useCallback } from 'react';
import {
  HTTP_LOCALHOST_12391,
  TIME_SECONDS_120_IN_MILLISECONDS,
  TIME_SECONDS_40_IN_MILLISECONDS,
} from '../constants/constants';
import { useAtom, useSetAtom } from 'jotai';
import {
  authenticatePasswordAtom,
  balanceAtom,
  extStateAtom,
  isLoadingAuthenticateAtom,
  isOpenCoreSetup,
  isOpenDialogCoreRecommendationAtom,
  isOpenDialogCustomApikey,
  isOpenDialogResetApikey,
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

let balanceSetIntervalRef: null | NodeJS.Timeout = null;

export const useAuth = () => {
  const setIsOpenResetApikey = useSetAtom(isOpenDialogResetApikey);
  const setIsOpenCustomApikeyDialog = useSetAtom(isOpenDialogCustomApikey);

  const setBalance = useSetAtom(balanceAtom);
  const setQortBalanceLoading = useSetAtom(qortBalanceLoadingAtom);
  const setIsOpenRecommendation = useSetAtom(
    isOpenDialogCoreRecommendationAtom
  );

  const setIsOpenCoreSetup = useSetAtom(isOpenCoreSetup);
  const [selectedNode, setSelectedNode] = useAtom(selectedNodeInfoAtom);
  const setUserInfo = useSetAtom(userInfoAtom);
  const setWalletToBeDecryptedError = useSetAtom(walletToBeDecryptedErrorAtom);

  const setIsLoading = useSetAtom(isLoadingAuthenticateAtom);
  const setExtstate = useSetAtom(extStateAtom);

  const [authenticatePassword, setAuthenticatePassword] = useAtom(
    authenticatePasswordAtom
  );
  const [rawWallet, setRawWallet] = useAtom(rawWalletAtom);

  const useLocalNode = selectedNode?.url === HTTP_LOCALHOST_12391;

  const checkIfLocalIsRunning = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:12391/admin/status');
      if (res?.ok) return true;
      return false;
    } catch (error) {
      return false;
    }
  }, []);

  const generateApiKey = useCallback(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:12391/admin/apikey/generate`, {
        method: 'POST',
      });
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

      try {
        const isLocal = validatedNodeInfo?.url === HTTP_LOCALHOST_12391;
        if (isLocal) {
          const runningRes = isElectron
            ? await window.coreSetup.isCoreRunning()
            : await checkIfLocalIsRunning();
          if (!runningRes && !disablePopup) {
            setIsOpenCoreSetup(false);
            setIsOpenRecommendation(true);
            return { isValid: false, validatedNodeInfo };
          }
          //
          const apiKey = isElectron
            ? await window.coreSetup.getApiKey()
            : await getLocalApiKeyNotElectronCase();
          if (apiKey) {
            validatedNodeInfo.apikey = apiKey;
          }
        }

        let isValid = false;

        const url = `${validatedNodeInfo?.url}/admin/settings/localAuthBypassEnabled`;
        const response = await fetch(url);

        // Assuming the response is in plain text and will be 'true' or 'false'
        const data = await response.text();
        if (data && data === 'true') {
          isValid = true;
        } else {
          try {
            const url2 = `${validatedNodeInfo?.url}/admin/apikey/test?apiKey=${validatedNodeInfo?.apikey}`;
            const response2 = await fetch(url2);

            // Assuming the response is in plain text and will be 'true' or 'false'
            const data2 = await response2.text();
            if (data2 === 'true') {
              isValid = true;
            }
          } catch (error) {}
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
          setIsOpenCustomApikeyDialog(true);
        }
        if (isValid && !isElectron && isLocal && !disablePopup) {
          setLocalApiKeyNotElectronCase(validatedNodeInfo.apikey);
        }

        return { isValid, validatedNodeInfo };
      } catch (error) {
        return { isValid: false, validatedNodeInfo };
      }
    },
    [
      setIsOpenCustomApikeyDialog,
      setIsOpenRecommendation,
      setIsOpenResetApikey,
      checkIfLocalIsRunning,
      generateApiKey,
      setIsOpenCoreSetup,
    ]
  );

  const validateLocalApiKey = useCallback(async (apiKey) => {
    try {
      const url2 = `http://127.0.0.1:12391/admin/apikey/test?apiKey=${apiKey}`;
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
      await window.sendMessage('setApiKey', nodeInfo);
      if (nodeInfo) {
        setSelectedNode(nodeInfo);
      }
      handleSetGlobalApikey(nodeInfo);
    },
    [setSelectedNode]
  );

  const isNodeValid = useCallback(async (): Promise<boolean> => {
    try {
      if (useLocalNode) {
        const payload = {
          apikey: '',
          url: HTTP_LOCALHOST_12391,
        };
        const { isValid, validatedNodeInfo } = await validateApiKey(payload);

        if (isValid) {
          await handleSaveNodeInfo(validatedNodeInfo);
          return true;
        } else {
          return false;
        }
      } else {
        const payload = selectedNode;
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
  }, [useLocalNode, validateApiKey, selectedNode, handleSaveNodeInfo]);

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

  const authenticate = useCallback(async () => {
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
        TIME_SECONDS_120_IN_MILLISECONDS
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
  }, [
    setIsLoading,
    setAuthenticatePassword,
    setExtstate,
    authenticatePassword,
    setUserInfo,
    setRawWallet,
    setWalletToBeDecryptedError,
    rawWallet,
    getBalanceFunc,
  ]);

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

  return {
    validateApiKey,
    isNodeValid,
    handleSaveNodeInfo,
    authenticate,
    getBalanceFunc,
    resetApikey,
    validateLocalApiKey,
    validateApiKeyFromRegistration,
  };
};
