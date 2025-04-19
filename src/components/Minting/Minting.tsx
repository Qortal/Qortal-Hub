import {
  Alert,
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputBase,
  InputLabel,
  Snackbar,
  Typography,
} from '@mui/material';
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import CloseIcon from '@mui/icons-material/Close';
import { MyContext, getBaseApiReact } from '../../App';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { getFee, getNameOrAddress } from '../../background';
import CopyToClipboard from 'react-copy-to-clipboard';
import { AddressBox } from '../../styles/App-styles';
import { Spacer } from '../../common/Spacer';
import Copy from '../../assets/svgs/Copy.svg';
import { Loader } from '../Loader';
import { FidgetSpinner } from 'react-loader-spinner';
import { useModal } from '../../common/useModal';

export const Minting = ({
  setIsOpenMinting,
  myAddress,
  groups,
  show,
  setTxList,
  txList,
}) => {
  const [mintingAccounts, setMintingAccounts] = useState([]);
  const [accountInfo, setAccountInfo] = useState(null);
  const [rewardSharePublicKey, setRewardSharePublicKey] = useState('');
  const [mintingKey, setMintingKey] = useState('');
  const [rewardsharekey, setRewardsharekey] = useState('');
  const [rewardShares, setRewardShares] = useState([]);
  const [nodeInfos, setNodeInfos] = useState({});
  const [openSnack, setOpenSnack] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { show: showKey, message } = useModal();
  const { isShow: isShowNext, onOk, show: showNext } = useModal();

  const [info, setInfo] = useState(null);
  const [names, setNames] = useState({});
  const [accountInfos, setAccountInfos] = useState({});
  const [showWaitDialog, setShowWaitDialog] = useState(false);
  const isPartOfMintingGroup = useMemo(() => {
    if (groups?.length === 0) return false;
    return !!groups?.find((item) => item?.groupId?.toString() === '694');
  }, [groups]);
  const getMintingAccounts = useCallback(async () => {
    try {
      const url = `${getBaseApiReact()}/admin/mintingaccounts`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('network error');
      }
      const data = await response.json();
      setMintingAccounts(data);
    } catch (error) {
      console.log(error);
    }
  }, []);

  const accountIsMinting = useMemo(() => {
    return !!mintingAccounts?.find(
      (item) => item?.recipientAccount === myAddress
    );
  }, [mintingAccounts, myAddress]);

  const getName = async (address) => {
    try {
      const response = await fetch(
        `${getBaseApiReact()}/names/address/${address}`
      );
      const nameData = await response.json();
      if (nameData?.length > 0) {
        setNames((prev) => {
          return {
            ...prev,
            [address]: nameData[0].name,
          };
        });
      } else {
        setNames((prev) => {
          return {
            ...prev,
            [address]: null,
          };
        });
      }
    } catch (error) {
      // error
    }
  };

  const getAccountInfo = async (address: string, others?: boolean) => {
    try {
      if (!others) {
        setIsLoading(true);
      }
      const url = `${getBaseApiReact()}/addresses/${address}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('network error');
      }
      const data = await response.json();
      if (others) {
        setAccountInfos((prev) => {
          return {
            ...prev,
            [address]: data,
          };
        });
      } else {
        setAccountInfo(data);
      }
    } catch (error) {
    } finally {
      if (!others) {
        setIsLoading(false);
      }
    }
  };

  const refreshRewardShare = () => {
    if (!myAddress) return;
    getRewardShares(myAddress);
  };

  useEffect(() => {
    subscribeToEvent('refresh-rewardshare-list', refreshRewardShare);

    return () => {
      unsubscribeFromEvent('refresh-rewardshare-list', refreshRewardShare);
    };
  }, [myAddress]);

  const handleNames = (address) => {
    if (!address) return undefined;
    if (names[address]) return names[address];
    if (names[address] === null) return address;
    getName(address);
    return address;
  };

  const handleAccountInfos = (address, field) => {
    if (!address) return undefined;
    if (accountInfos[address]) return accountInfos[address]?.[field];
    if (accountInfos[address] === null) return undefined;
    getAccountInfo(address, true);
    return undefined;
  };

  const calculateBlocksRemainingToLevel1 = (address) => {
    if (!address) return undefined;
    if (!accountInfos[address]) return undefined;
    return 7200 - accountInfos[address]?.blocksMinted || 0;
  };

  const getNodeInfos = async () => {
    try {
      const url = `${getBaseApiReact()}/admin/status`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();
      setNodeInfos(data);
    } catch (error) {
      console.error('Request failed', error);
    }
  };

  const getRewardShares = useCallback(async (address) => {
    try {
      const url = `${getBaseApiReact()}/addresses/rewardshares?involving=${address}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('network error');
      }
      const data = await response.json();
      setRewardShares(data);
      return data;
    } catch (error) {
      console.log(error);
    }
  }, []);

  const addMintingAccount = useCallback(async (val) => {
    try {
      setIsLoading(true);
      return await new Promise((res, rej) => {
        window
          .sendMessage(
            'ADMIN_ACTION',

            {
              type: 'addmintingaccount',
              value: val,
            },
            180000,
            true
          )
          .then((response) => {
            if (!response?.error) {
              res(response);
              setMintingKey('');
              setTimeout(() => {
                getMintingAccounts();
              }, 300);
              return;
            }
            rej({ message: response.error });
          })
          .catch((error) => {
            rej({ message: error.message || 'An error occurred' });
          });
      });
    } catch (error) {
      setInfo({
        type: 'error',
        message: error?.message || 'Unable to add minting account',
      });
      setOpenSnack(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const removeMintingAccount = useCallback(async (val, acct) => {
    try {
      setIsLoading(true);
      return await new Promise((res, rej) => {
        window
          .sendMessage(
            'ADMIN_ACTION',

            {
              type: 'removemintingaccount',
              value: val,
            },
            180000,
            true
          )
          .then((response) => {
            if (!response?.error) {
              res(response);

              setTimeout(() => {
                getMintingAccounts();
              }, 300);
              return;
            }
            rej({ message: response.error });
          })
          .catch((error) => {
            rej({ message: error.message || 'An error occurred' });
          });
      });
    } catch (error) {
      setInfo({
        type: 'error',
        message: error?.message || 'Unable to remove minting account',
      });
      setOpenSnack(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createRewardShare = useCallback(async (publicKey, recipient) => {
    const fee = await getFee('REWARD_SHARE');
    await show({
      message: 'Would you like to perform an REWARD_SHARE transaction?',
      publishFee: fee.fee + ' QORT',
    });
    return await new Promise((res, rej) => {
      window
        .sendMessage('createRewardShare', {
          recipientPublicKey: publicKey,
        })
        .then((response) => {
          if (!response?.error) {
            setTxList((prev) => [
              {
                recipient,
                ...response,
                type: 'add-rewardShare',
                label: `Add rewardshare: awaiting confirmation`,
                labelDone: `Add rewardshare: success!`,
                done: false,
              },
              ...prev,
            ]);
            res(response);
            return;
          }
          rej({ message: response.error });
        })
        .catch((error) => {
          rej({ message: error.message || 'An error occurred' });
        });
    });
  }, []);

  const getRewardSharePrivateKey = useCallback(async (publicKey) => {
    return await new Promise((res, rej) => {
      window
        .sendMessage('getRewardSharePrivateKey', {
          recipientPublicKey: publicKey,
        })
        .then((response) => {
          if (!response?.error) {
            res(response);
            return;
          }
          rej({ message: response.error });
        })
        .catch((error) => {
          rej({ message: error.message || 'An error occurred' });
        });
    });
  }, []);

  const waitUntilRewardShareIsConfirmed = async (timeoutMs = 600000) => {
    const pollingInterval = 30000;
    const startTime = Date.now();

    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    while (Date.now() - startTime < timeoutMs) {
      const rewardShares = await getRewardShares(myAddress);
      const findRewardShare = rewardShares?.find(
        (item) =>
          item?.recipient === myAddress && item?.mintingAccount === myAddress
      );

      if (findRewardShare) {
        return true; // Exit early if found
      }

      await sleep(pollingInterval); // Wait before the next poll
    }

    throw new Error('Timeout waiting for reward share confirmation');
  };

  const startMinting = async () => {
    try {
      setIsLoading(true);
      const findRewardShare = rewardShares?.find(
        (item) =>
          item?.recipient === myAddress && item?.mintingAccount === myAddress
      );
      if (findRewardShare) {
        const privateRewardShare = await getRewardSharePrivateKey(
          accountInfo?.publicKey
        );
        addMintingAccount(privateRewardShare);
      } else {
        await createRewardShare(accountInfo?.publicKey, myAddress);
        setShowWaitDialog(true);
        await waitUntilRewardShareIsConfirmed();
        await showNext({
          message: '',
        });
        const privateRewardShare = await getRewardSharePrivateKey(
          accountInfo?.publicKey
        );
        setShowWaitDialog(false);
        addMintingAccount(privateRewardShare);
      }
    } catch (error) {
      setShowWaitDialog(false);
      setInfo({
        type: 'error',
        message: error?.message || 'Unable to start minting',
      });
      setOpenSnack(true);
    } finally {
      setIsLoading(false);
    }
  };

  const getPublicKeyFromAddress = async (address) => {
    const url = `${getBaseApiReact()}/addresses/publickey/${address}`;
    const response = await fetch(url);
    const data = await response.text();
    return data;
  };

  const checkIfMinterGroup = async (address) => {
    const url = `${getBaseApiReact()}/groups/member/${address}`;
    const response = await fetch(url);
    const data = await response.json();
    return !!data?.find((grp) => grp?.groupId?.toString() === '694');
  };

  const removeRewardShare = useCallback(async (rewardShare) => {
    return await new Promise((res, rej) => {
      window
        .sendMessage('removeRewardShare', {
          rewardShareKeyPairPublicKey: rewardShare.rewardSharePublicKey,
          recipient: rewardShare.recipient,
          percentageShare: -1,
        })
        .then((response) => {
          if (!response?.error) {
            res(response);
            setTxList((prev) => [
              {
                ...rewardShare,
                ...response,
                type: 'remove-rewardShare',
                label: `Remove rewardshare: awaiting confirmation`,
                labelDone: `Remove rewardshare: success!`,
                done: false,
              },
              ...prev,
            ]);
            return;
          }
          rej({ message: response.error });
        })
        .catch((error) => {
          rej({ message: error.message || 'An error occurred' });
        });
    });
  }, []);

  const handleRemoveRewardShare = async (rewardShare) => {
    try {
      setIsLoading(true);

      const privateRewardShare = await removeRewardShare(rewardShare);
    } catch (error) {
      setInfo({
        type: 'error',
        message: error?.message || 'Unable to remove reward share',
      });
      setOpenSnack(true);
    } finally {
      setIsLoading(false);
    }
  };

  const createRewardShareForPotentialMinter = async (receiver) => {
    try {
      setIsLoading(true);
      const confirmReceiver = await getNameOrAddress(receiver);
      if (confirmReceiver.error)
        throw new Error('Invalid receiver address or name');
      const isInMinterGroup = await checkIfMinterGroup(confirmReceiver);
      if (!isInMinterGroup) throw new Error('Account not in Minter Group');
      const publicKey = await getPublicKeyFromAddress(confirmReceiver);
      const findRewardShare = rewardShares?.find(
        (item) =>
          item?.recipient === confirmReceiver &&
          item?.mintingAccount === myAddress
      );
      if (findRewardShare) {
        const privateRewardShare = await getRewardSharePrivateKey(publicKey);
        setRewardsharekey(privateRewardShare);
      } else {
        await createRewardShare(publicKey, confirmReceiver);
        const privateRewardShare = await getRewardSharePrivateKey(publicKey);
        setRewardsharekey(privateRewardShare);
      }
    } catch (error) {
      setInfo({
        type: 'error',
        message: error?.message || 'Unable to create reward share',
      });
      setOpenSnack(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    getNodeInfos();
    getMintingAccounts();
  }, []);

  useEffect(() => {
    if (!myAddress) return;
    getRewardShares(myAddress);

    getAccountInfo(myAddress);
  }, [myAddress]);

  const _blocksNeed = () => {
    if (accountInfo?.level === 0) {
      return 7200;
    } else if (accountInfo?.level === 1) {
      return 72000;
    } else if (accountInfo?.level === 2) {
      return 201600;
    } else if (accountInfo?.level === 3) {
      return 374400;
    } else if (accountInfo?.level === 4) {
      return 618400;
    } else if (accountInfo?.level === 5) {
      return 964000;
    } else if (accountInfo?.level === 6) {
      return 1482400;
    } else if (accountInfo?.level === 7) {
      return 2173600;
    } else if (accountInfo?.level === 8) {
      return 3037600;
    } else if (accountInfo?.level === 9) {
      return 4074400;
    }
  };

  const handleClose = () => {
    setOpenSnack(false);
    setTimeout(() => {
      setInfo(null);
    }, 250);
  };

  const _levelUpBlocks = () => {
    if (
      accountInfo?.blocksMinted === undefined ||
      nodeInfos?.height === undefined
    )
      return null;
    let countBlocks =
      _blocksNeed() -
      (accountInfo?.blocksMinted + accountInfo?.blocksMintedAdjustment);

    let countBlocksString = countBlocks.toString();
    return '' + countBlocksString;
  };

  return (
    <Dialog
      open={true}
      maxWidth="lg"
      fullWidth
      fullScreen
      sx={{
        '& .MuiDialog-paper': {
          margin: 0,
          maxWidth: '100%',
          width: '100%',
          height: '100vh',
          overflow: 'hidden', // Prevent scrollbars
        },
      }}
    >
      <DialogTitle id="alert-dialog-title">{'Manage your minting'}</DialogTitle>
      <IconButton
        sx={{
          position: 'absolute',
          right: 8,
          top: 8,
        }}
        color="inherit"
        onClick={() => setIsOpenMinting(false)}
        aria-label="close"
      >
        <CloseIcon />
      </IconButton>
      <DialogContent
        sx={{
          position: 'relative',
        }}
      >
        {isLoading && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <FidgetSpinner
              visible={true}
              height="80"
              width="80"
              ariaLabel="fidget-spinner-loading"
              wrapperStyle={{}}
              wrapperClass="fidget-spinner-wrapper"
            />
          </Box>
        )}
        <Card
          sx={{
            backgroundColor: 'var(--bg-2)',
            padding: '10px',
          }}
        >
          <Typography>Account: {handleNames(accountInfo?.address)}</Typography>
          <Typography>Level: {accountInfo?.level}</Typography>
          <Typography>
            blocks remaining until next level: {_levelUpBlocks()}
          </Typography>
          <Typography>
            This node is minting: {nodeInfos?.isMintingPossible?.toString()}
          </Typography>
        </Card>
        <Spacer height="10px" />
        {isPartOfMintingGroup && !accountIsMinting && (
          <Box
            sx={{
              display: 'flex',
              gap: '5px',
              flexDirection: 'column',
              width: '100%',
              alignItems: 'center',
            }}
          >
            <Button
              size="small"
              onClick={() => {
                startMinting();
              }}
              disabled={mintingAccounts?.length > 1}
              sx={{
                backgroundColor: 'var(--green)',
                color: 'black',
                fontWeight: 'bold',
                opacity: 0.7,
                maxWidth: '90%',
                width: '200px',
                '&:hover': {
                  backgroundColor: 'var(--green)',
                  color: 'black',
                  opacity: 1,
                },
              }}
              variant="contained"
            >
              Start minting
            </Button>
            {mintingAccounts?.length > 1 && (
              <Typography>
                Only 2 minting keys are allowed per node. Please remove one if
                you would like to mint with this account.
              </Typography>
            )}
          </Box>
        )}
        <Spacer height="10px" />
        {mintingAccounts?.length > 0 && (
          <Typography>Node's minting accounts</Typography>
        )}
        <Card
          sx={{
            backgroundColor: 'var(--bg-2)',
            padding: '10px',
          }}
        >
          {accountIsMinting && (
            <Box
              sx={{
                display: 'flex',
                gap: '5px',
                flexDirection: 'column',
              }}
            >
              <Typography>
                You currently have a minting key for this account attached to
                this node
              </Typography>
            </Box>
          )}
          <Spacer height="10px" />
          {mintingAccounts?.map((acct) => (
            <Box
              key={acct?.mintingAccount}
              sx={{
                display: 'flex',
                gap: '10px',
                flexDirection: 'column',
              }}
            >
              <Typography>
                Minting account: {handleNames(acct?.mintingAccount)}
              </Typography>
              <Button
                size="small"
                sx={{
                  backgroundColor: 'var(--danger)',
                  color: 'black',
                  fontWeight: 'bold',
                  opacity: 0.7,
                  maxWidth: '90%',
                  width: '200px',
                  '&:hover': {
                    backgroundColor: 'var(--danger)',
                    color: 'black',
                    opacity: 1,
                  },
                }}
                onClick={() => {
                  removeMintingAccount(acct.publicKey, acct);
                }}
                variant="contained"
              >
                Remove minting account
              </Button>
              <Divider />
              <Spacer height="10px" />
            </Box>
          ))}

          {mintingAccounts?.length > 1 && (
            <Typography>
              Only 2 minting keys are allowed per node. Please remove one if you
              would like to add a different account.
            </Typography>
          )}
        </Card>

        <Spacer height="20px" />
        {!isPartOfMintingGroup && (
          <Card
            sx={{
              backgroundColor: 'var(--bg-2)',
              padding: '10px',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                gap: '5px',
                flexDirection: 'column',
                width: '100%',
                alignItems: 'center',
              }}
            >
              <Typography>
                You are currently not part of the MINTER group
              </Typography>
              <Typography>
                Visit the Q-Mintership app to apply to be a minter
              </Typography>
              <Spacer height="10px" />
              <Button
                size="small"
                sx={{
                  backgroundColor: 'var(--green)',
                  color: 'black',
                  fontWeight: 'bold',
                  opacity: 0.7,

                  '&:hover': {
                    backgroundColor: 'var(--green)',
                    color: 'black',
                    opacity: 1,
                  },
                }}
                onClick={() => {
                  executeEvent('addTab', {
                    data: { service: 'APP', name: 'q-mintership' },
                  });
                  executeEvent('open-apps-mode', {});
                  setIsOpenMinting(false);
                }}
                variant="contained"
              >
                Visit Q-Mintership
              </Button>
            </Box>
          </Card>
        )}

        {showWaitDialog && (
          <Dialog
            open={showWaitDialog}
            aria-labelledby="alert-dialog-title"
            aria-describedby="alert-dialog-description"
          >
            <DialogTitle id="alert-dialog-title">
              {isShowNext ? 'Confirmed' : 'Please Wait'}
            </DialogTitle>
            <DialogContent>
              {!isShowNext && (
                <Typography>
                  Confirming creation of rewardshare on chain. Please be
                  patient, this could take up to 90 seconds.
                </Typography>
              )}
              {isShowNext && (
                <Typography>
                  Rewardshare confirmed. Please click Next.
                </Typography>
              )}
            </DialogContent>

            <DialogActions>
              <Button
                disabled={!isShowNext}
                variant="contained"
                onClick={onOk}
                autoFocus
              >
                Next
              </Button>
            </DialogActions>
          </Dialog>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          //   disabled={isLoadingPublish}
          variant="contained"
          onClick={() => setIsOpenMinting(false)}
        >
          Close
        </Button>
      </DialogActions>
      <Snackbar
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        open={openSnack}
        autoHideDuration={6000}
        onClose={handleClose}
      >
        <Alert
          onClose={handleClose}
          severity={info?.type}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {info?.message}
        </Alert>
      </Snackbar>
    </Dialog>
  );
};
