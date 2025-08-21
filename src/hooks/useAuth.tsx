import React, { useCallback } from 'react';
import {
  HTTP_LOCALHOST_12391,
  TIME_120_SECONDS_IN_MILLISECONDS,
  TIME_40_SECONDS_IN_MILLISECONDS,
} from '../constants/constants';
import { useAtom } from 'jotai';
import {
  authenticatePasswordAtom,
  balanceAtom,
  extStateAtom,
  isLoadingAuthenticateAtom,
  isOpenDialogCoreRecommendationAtom,
  isOpenDialogResetApikey,
  qortBalanceLoadingAtom,
  rawWalletAtom,
  selectedNodeInfoAtom,
  userInfoAtom,
  walletToBeDecryptedErrorAtom,
} from '../atoms/global';
import { handleSetGlobalApikey } from '../App';

let balanceSetIntervalRef: null | NodeJS.Timeout = null;

export const useAuth = () => {
  const [open, setIsOpenResetApikey] = useAtom(isOpenDialogResetApikey);

  const [balance, setBalance] = useAtom(balanceAtom);
  const [qortBalanceLoading, setQortBalanceLoading] = useAtom(
    qortBalanceLoadingAtom
  );
  const [isOpenRecommendation, setIsOpenRecommendation] = useAtom(
    isOpenDialogCoreRecommendationAtom
  );
  const [selectedNode, setSelectedNode] = useAtom(selectedNodeInfoAtom);
  const [userInfo, setUserInfo] = useAtom(userInfoAtom);
  const [walletToBeDecryptedError, setWalletToBeDecryptedError] = useAtom(
    walletToBeDecryptedErrorAtom
  );

  const [isLoading, setIsLoading] = useAtom(isLoadingAuthenticateAtom);
  const [extState, setExtstate] = useAtom(extStateAtom);

  const [authenticatePassword, setAuthenticatePassword] = useAtom(
    authenticatePasswordAtom
  );
  const [rawWallet, setRawWallet] = useAtom(rawWalletAtom);

  const useLocalNode = selectedNode?.url === HTTP_LOCALHOST_12391;

  const validateApiKey = useCallback(async (currentNode) => {
    const validatedNodeInfo = currentNode;

    try {
      const isLocal = validatedNodeInfo?.url === HTTP_LOCALHOST_12391;

      if (isLocal) {
        const runningRes = await window.coreSetup.isCoreRunning();
        if (!runningRes) {
          setIsOpenRecommendation(true);
          return;
        }
        //
        const apiKey = await window.coreSetup.getApiKey();
        validatedNodeInfo.apikey = apiKey;
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
      console.log('222 isValid', isValid, isLocal);
      if (!isValid && isLocal) {
        setIsOpenResetApikey(true);
        return;
      }

      return { isValid, validatedNodeInfo };
    } catch (error) {
      return { isValid: false, validatedNodeInfo };
    }
  }, []);

  const handleSaveNodeInfo = useCallback(
    async (nodeInfo) => {
      try {
        await window.sendMessage('setApiKey', nodeInfo);
        if (nodeInfo) {
          setSelectedNode(nodeInfo);
        }
        handleSetGlobalApikey(nodeInfo);
      } catch (error) {
        //   console.error(
        //     t('auth:message.error.set_apikey', {
        //       postProcess: 'capitalizeFirstChar',
        //     }),
        //     error.message ||
        //       t('core:message.error.generic', {
        //         postProcess: 'capitalizeFirstChar',
        //       })
        //   );
      }
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
      }, TIME_40_SECONDS_IN_MILLISECONDS);
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
        TIME_120_SECONDS_IN_MILLISECONDS
      )
      .then((response) => {
        console.log('response', response);
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

  return {
    validateApiKey,
    isNodeValid,
    handleSaveNodeInfo,
    authenticate,
    getBalanceFunc,
    resetApikey,
  };
};
