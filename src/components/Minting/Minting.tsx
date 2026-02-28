import {
  Alert,
  alpha,
  AppBar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Snackbar,
  Tab,
  Tabs,
  Toolbar,
  Typography,
  useTheme,
} from '@mui/material';
import {
  SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import CloseIcon from '@mui/icons-material/Close';
import { getBaseApiReact } from '../../App';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { getFee } from '../../background/background.ts';
import { FidgetSpinner } from 'react-loader-spinner';
import { useModal } from '../../hooks/useModal.tsx';
import { useAtom, useSetAtom } from 'jotai';
import { memberGroupsAtom, txListAtom } from '../../atoms/global';
import { Trans, useTranslation } from 'react-i18next';
import { TransitionUp } from '../../common/Transitions.tsx';
import {
  nextLevel,
  averageBlockDay,
  averageBlockTime,
  dayReward,
  levelUpBlocks,
  levelUpDays,
  mintingStatus,
  countMintersInLevel,
  currentTier,
  tierPercent,
  countReward,
  countRewardDay,
} from './MintingStats.tsx';

export type AddressLevelEntry = {
  level: number;
  count: number;
};

export const Minting = ({ setIsOpenMinting, myAddress, show }) => {
  const setTxList = useSetAtom(txListAtom);
  const [groups] = useAtom(memberGroupsAtom);

  const [mintingAccounts, setMintingAccounts] = useState([]);
  const [accountInfo, setAccountInfo] = useState(null);
  const [mintingKey, setMintingKey] = useState('');
  const [rewardShares, setRewardShares] = useState([]);
  const [adminInfo, setAdminInfo] = useState({});
  const [nodeStatus, setNodeStatus] = useState({});
  const [addressLevel, setAddressLevel] = useState<AddressLevelEntry[]>([]);
  const [tier4Online, setTier4Online] = useState(0);
  const [openSnack, setOpenSnack] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [nodeHeightBlock, setNodeHeightBlock] = useState({});
  const [valueMintingTab, setValueMintingTab] = useState(0);
  const { isShow: isShowNext, onOk, show: showNext } = useModal();
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const [info, setInfo] = useState(null);
  const [names, setNames] = useState({});
  const [accountInfos, setAccountInfos] = useState({});
  const [showWaitDialog, setShowWaitDialog] = useState(false);
  const timeoutNodeStatusRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const timeoutAdminInfoRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
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
      const url = `${getBaseApiReact()}/names/primary/${address}`;
      const response = await fetch(url);
      const nameData = await response.json();
      if (nameData?.name) {
        setNames((prev) => {
          return {
            ...prev,
            [address]: nameData?.name,
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
      console.log(error);
    }
  };

  function a11yProps(index: number) {
    return {
      id: `simple-tab-${index}`,
      'aria-controls': `simple-tabpanel-${index}`,
    };
  }

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
      console.log(error);
    } finally {
      if (!others) {
        setIsLoading(false);
      }
    }
  };

  const daysToNextLevel = levelUpDays(
    accountInfo,
    adminInfo,
    nodeHeightBlock,
    nodeStatus
  );

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

  const getAdminInfo = useCallback(async () => {
    try {
      const url = `${getBaseApiReact()}/admin/info`;
      const response = await fetch(url);
      const data = await response.json();
      setAdminInfo(data);
    } catch (error) {
      console.log(error);
    } finally {
      timeoutAdminInfoRef.current = setTimeout(getAccountInfo, 30000);
    }
  }, []);

  const getNodeStatus = useCallback(async () => {
    try {
      const url = `${getBaseApiReact()}/admin/status`;
      const response = await fetch(url);
      const data = await response.json();
      setNodeStatus(data);
    } catch (error) {
      console.error('Request failed', error);
    } finally {
      timeoutNodeStatusRef.current = setTimeout(getNodeStatus, 30000);
    }
  }, []);

  useEffect(() => {
    if (nodeStatus?.height) {
      const getNodeHeightBlock = async () => {
        try {
          const nodeBlock = nodeStatus.height - 1440;
          const url = `${getBaseApiReact()}/blocks/byheight/${nodeBlock}`;
          const response = await fetch(url);
          const data = await response.json();
          setNodeHeightBlock(data);
        } catch (error) {
          console.error('Request failed', error);
        }
      };

      getNodeHeightBlock();
    }
  }, [nodeStatus]);

  const getAddressLevel = async () => {
    try {
      const url = `${getBaseApiReact()}/addresses/online/levels`;
      const response = await fetch(url);
      const data: AddressLevelEntry[] = await response.json();
      if (Array.isArray(data)) {
        setAddressLevel(data);
        const level7 = data.find((entry) => entry.level === 7)?.count || 0;
        const level8 = data.find((entry) => entry.level === 8)?.count || 0;
        const tier4Count =
          parseFloat(level7.toString()) + parseFloat(level8.toString());
        setTier4Online(tier4Count);
      }
    } catch (error) {
      console.error('Request failed', error);
    }
  };

  const getRewardShares = useCallback(async (address) => {
    try {
      const url = `${getBaseApiReact()}/addresses/rewardshares?involving=${address}`; // TODO check API (still useful?)
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
            rej({
              message:
                error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                }),
            });
          });
      });
    } catch (error) {
      setInfo({
        type: 'error',
        message:
          error?.message ||
          t('core:message.error.minting_account_add', {
            postProcess: 'capitalizeFirstChar',
          }),
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
            rej({
              message:
                error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                }),
            });
          });
      });
    } catch (error) {
      setInfo({
        type: 'error',
        message:
          error?.message ||
          t('core:message.error.minting_account_remove', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnack(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createRewardShare = useCallback(async (publicKey, recipient) => {
    const fee = await getFee('REWARD_SHARE');

    await show({
      message: t('core:message.question.perform_transaction', {
        action: 'REWARD_SHARE',
        postProcess: 'capitalizeFirstChar',
      }),
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
                label: t('group:message.success.rewardshare_add', {
                  postProcess: 'capitalizeFirstChar',
                }),
                labelDone: t('group:message.success.rewardshare_add_label', {
                  postProcess: 'capitalizeFirstChar',
                }),
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
          rej({
            message:
              error.message ||
              t('core:message.error.generic', {
                postProcess: 'capitalizeFirstChar',
              }),
          });
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
          rej({
            message:
              error.message ||
              t('core:message.error.generic', {
                postProcess: 'capitalizeFirstChar',
              }),
          });
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

    throw new Error(
      t('group:message.error.timeout_reward', {
        postProcess: 'capitalizeFirstChar',
      })
    );
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
        message:
          error?.message ||
          t('group:message.error:minting', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnack(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    getAddressLevel();
    getAdminInfo();
    getMintingAccounts();
    getNodeStatus();

    return () => {
      if (timeoutNodeStatusRef.current) {
        clearTimeout(timeoutNodeStatusRef.current);
        timeoutNodeStatusRef.current = null;
      }
      if (timeoutAdminInfoRef.current) {
        clearTimeout(timeoutAdminInfoRef.current);
        timeoutAdminInfoRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!myAddress) return;
    getRewardShares(myAddress);
    getAccountInfo(myAddress);
  }, [myAddress]);

  const handleClose = () => {
    setOpenSnack(false);
    setTimeout(() => {
      setInfo(null);
    }, 250);
  };

  const handleChange = (event: SyntheticEvent, newValue: number) => {
    setValueMintingTab(newValue);
  };

  return (
    <Dialog
      open={true}
      maxWidth="lg"
      fullWidth
      fullScreen
      slots={{
        transition: TransitionUp,
      }}
    >
      <AppBar sx={{ position: 'relative' }}>
        <Toolbar>
          <Typography sx={{ ml: 2, flex: 1 }} variant="h4" component="div">
            {t('group:message.generic.manage_minting', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setIsOpenMinting(false)}
            aria-label={t('core:action.close', {
              postProcess: 'capitalizeFirstChar',
            })}
            sx={{
              bgcolor: theme.palette.background.default,
              color: theme.palette.text.primary,
            }}
          >
            <CloseIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          bgcolor: theme.palette.background.default,
          color: theme.palette.text.primary,
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          overflowY: 'auto',
        }}
      >
        <Box
          sx={{ borderBottom: 1, borderColor: theme.palette.text.secondary }}
        >
          <Tabs
            value={valueMintingTab}
            onChange={handleChange}
            variant={'fullWidth'}
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{
              '&.MuiTabs-indicator': {
                backgroundColor: theme.palette.background.default,
              },
            }}
          >
            <Tab
              label={t('core:minting.details', {
                postProcess: 'capitalizeAll',
              })}
              sx={{
                '&.Mui-selected': {
                  color: theme.palette.text.primary,
                },
                fontSize: '1rem',
              }}
              {...a11yProps(0)}
            />
            <Tab
              label={t('core:minting.actions', {
                postProcess: 'capitalizeAll',
              })}
              sx={{
                '&.Mui-selected': {
                  color: theme.palette.text.primary,
                },
                fontSize: '1rem',
              }}
              {...a11yProps(1)}
            />
          </Tabs>
        </Box>

        {valueMintingTab === 0 && (
          <DialogContent sx={{ position: 'relative' }}>
            <Box sx={{ maxWidth: 560, mx: 'auto', py: 3, px: 1 }}>

              {/* Blockchain Statistics */}
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  color: theme.palette.text.secondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  mb: 1,
                }}
              >
                {t('core:minting.blockchain_statistics', {
                  postProcess: 'capitalizeEachFirstChar',
                })}
              </Typography>
              <Box
                sx={{
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: 1,
                  borderColor: alpha(theme.palette.divider, 0.4),
                  bgcolor: alpha(theme.palette.background.default, 0.5),
                  mb: 3,
                }}
              >
                {[
                  {
                    label: t('core:minting.average_blocktime', {
                      postProcess: 'capitalizeEachFirstChar',
                    }),
                    value: t('core:time.second', {
                      count: parseFloat(
                        averageBlockTime(adminInfo, nodeHeightBlock).toFixed(2)
                      ),
                      postProcess: 'capitalizeEachFirstChar',
                    }),
                  },
                  {
                    label: t('core:minting.average_blocks_per_day', {
                      postProcess: 'capitalizeEachFirstChar',
                    }),
                    value: averageBlockDay(adminInfo, nodeHeightBlock).toFixed(2),
                  },
                  {
                    label: t('core:minting.average_created_qorts_per_day', {
                      postProcess: 'capitalizeEachFirstChar',
                    }),
                    value: dayReward(adminInfo, nodeHeightBlock, nodeStatus).toFixed(2),
                  },
                ].map((row, i, arr) => (
                  <Box
                    key={row.label}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      px: 2,
                      py: 1.25,
                      ...(i < arr.length - 1 && {
                        borderBottom: 1,
                        borderColor: 'divider',
                      }),
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {row.label}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {row.value}
                    </Typography>
                  </Box>
                ))}
              </Box>

              {/* Account Details */}
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  color: theme.palette.text.secondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  mb: 1,
                }}
              >
                {t('core:minting.account_details', {
                  postProcess: 'capitalizeEachFirstChar',
                })}
              </Typography>
              <Box
                sx={{
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: 1,
                  borderColor: alpha(theme.palette.divider, 0.4),
                  bgcolor: alpha(theme.palette.background.default, 0.5),
                  mb: 3,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 2,
                    py: 1.25,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {t('core:minting.current_status', {
                      postProcess: 'capitalizeEachFirstChar',
                    })}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {mintingStatus(nodeStatus)}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 2,
                    py: 1.25,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {t('core:minting.current_level', {
                      postProcess: 'capitalizeEachFirstChar',
                    })}
                  </Typography>
                  <Box
                    sx={{
                      px: 1.5,
                      py: 0.5,
                      borderRadius: 2,
                      bgcolor: alpha(theme.palette.primary.main, 0.12),
                    }}
                  >
                    <Typography
                      variant="subtitle2"
                      sx={{
                        fontWeight: 600,
                        color: theme.palette.primary.main,
                      }}
                    >
                      {accountInfo?.level ?? '—'}
                    </Typography>
                  </Box>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 2,
                    py: 1.25,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {t('core:minting.blocks_next_level', {
                      postProcess: 'capitalizeEachFirstChar',
                    })}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {levelUpBlocks(accountInfo, nodeStatus).toFixed(0) || '—'}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    px: 2,
                    py: 1.5,
                    bgcolor: alpha(theme.palette.action.hover, 0.04),
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    <Trans
                      i18nKey="minting.next_level"
                      ns="core"
                      components={{ strong: <strong /> }}
                      values={{
                        level: nextLevel(accountInfo?.level),
                        count: daysToNextLevel?.toFixed(2),
                      }}
                      tOptions={{ postProcess: ['capitalizeFirstChar'] }}
                    />
                  </Typography>
                </Box>
              </Box>

              {/* Rewards Info */}
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  color: theme.palette.text.secondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  mb: 1,
                }}
              >
                {t('core:minting.rewards_info', {
                  postProcess: 'capitalizeEachFirstChar',
                })}
              </Typography>
              <Box
                sx={{
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: 1,
                  borderColor: alpha(theme.palette.divider, 0.4),
                  bgcolor: alpha(theme.palette.background.default, 0.5),
                  mb: 3,
                }}
              >
                {[
                  {
                    label: t('core:minting.current_tier', {
                      postProcess: 'capitalizeEachFirstChar',
                    }),
                    value: t('core:minting.current_tier_content', {
                      tier: currentTier(accountInfo?.level)
                        ? currentTier(accountInfo?.level)[0]
                        : '',
                      levels: currentTier(accountInfo?.level)
                        ? currentTier(accountInfo?.level)[1]
                        : '',
                      postProcess: 'capitalizeEachFirstChar',
                    }),
                  },
                  {
                    label: t('core:minting.total_minter_in_tier', {
                      postProcess: 'capitalizeEachFirstChar',
                    }),
                    value:
                      countMintersInLevel(
                        accountInfo?.level,
                        addressLevel,
                        tier4Online
                      )?.toFixed(0) || '—',
                  },
                  {
                    label: t('core:minting.tier_share_per_block', {
                      postProcess: 'capitalizeEachFirstChar',
                    }),
                    value:
                      tierPercent(accountInfo, tier4Online)?.toFixed(0) + ' %',
                  },
                  {
                    label: t('core:minting.reward_per_block', {
                      postProcess: 'capitalizeEachFirstChar',
                    }),
                    value:
                      countReward(
                        accountInfo,
                        addressLevel,
                        nodeStatus,
                        tier4Online
                      ).toFixed(8) + ' QORT',
                  },
                  {
                    label: t('core:minting.reward_per_day', {
                      postProcess: 'capitalizeEachFirstChar',
                    }),
                    value:
                      countRewardDay(
                        accountInfo,
                        addressLevel,
                        adminInfo,
                        nodeHeightBlock,
                        nodeStatus,
                        tier4Online
                      ).toFixed(8) + ' QORT',
                  },
                ].map((row, i, arr) => (
                  <Box
                    key={row.label}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      px: 2,
                      py: 1.25,
                      ...(i < arr.length - 1 && {
                        borderBottom: 1,
                        borderColor: 'divider',
                      }),
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {row.label}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, textAlign: 'right' }}
                    >
                      {row.value}
                    </Typography>
                  </Box>
                ))}
              </Box>

            </Box>
          </DialogContent>
        )}

        {valueMintingTab === 1 && (
          <DialogContent sx={{ position: 'relative' }}>
            {isLoading && (
              <Box
                sx={{
                  alignItems: 'center',
                  bottom: 0,
                  display: 'flex',
                  justifyContent: 'center',
                  left: 0,
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  zIndex: 1,
                }}
              >
                <FidgetSpinner
                  ariaLabel="fidget-spinner-loading"
                  height="80"
                  visible={true}
                  width="80"
                  wrapperClass="fidget-spinner-wrapper"
                  wrapperStyle={{}}
                />
              </Box>
            )}

            <Box sx={{ maxWidth: 560, mx: 'auto', py: 3, px: 1 }}>

              {/* Account info */}
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  color: theme.palette.text.secondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  mb: 1,
                }}
              >
                {t('auth:account.account_one', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
              <Box
                sx={{
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: 1,
                  borderColor: alpha(theme.palette.divider, 0.4),
                  bgcolor: alpha(theme.palette.background.default, 0.5),
                  mb: 3,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 2,
                    py: 1.25,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {t('auth:address', { postProcess: 'capitalizeFirstChar' })}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 600, fontFamily: 'monospace' }}
                  >
                    {handleNames(accountInfo?.address)}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 2,
                    py: 1.25,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {t('core:level', { postProcess: 'capitalizeFirstChar' })}
                  </Typography>
                  <Box
                    sx={{
                      px: 1.5,
                      py: 0.5,
                      borderRadius: 2,
                      bgcolor: alpha(theme.palette.primary.main, 0.12),
                    }}
                  >
                    <Typography
                      variant="subtitle2"
                      sx={{
                        fontWeight: 600,
                        color: theme.palette.primary.main,
                      }}
                    >
                      {accountInfo?.level ?? '—'}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              {/* Start minting */}
              {isPartOfMintingGroup && !accountIsMinting && (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 1,
                    mb: 3,
                  }}
                >
                  <Button
                    size="small"
                    onClick={() => {
                      startMinting();
                    }}
                    disabled={mintingAccounts?.length > 1}
                    sx={{
                      backgroundColor: theme.palette.other.positive,
                      color: 'black',
                      fontWeight: 'bold',
                      opacity: 0.7,
                      width: '200px',
                      '&:hover': {
                        backgroundColor: theme.palette.other.positive,
                        color: 'black',
                        opacity: 1,
                      },
                    }}
                    variant="contained"
                  >
                    {t('core:action.start_minting', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Button>
                  {mintingAccounts?.length > 1 && (
                    <Typography variant="body2" color="text.secondary">
                      {t('group:message.generic.minting_keys_per_node', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  )}
                </Box>
              )}

              {/* Minting accounts list */}
              {mintingAccounts?.length > 0 && (
                <>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      color: theme.palette.text.secondary,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      fontWeight: 600,
                      mb: 1,
                    }}
                  >
                    {t('group:message.generic.node_minting_account', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <Box
                    sx={{
                      borderRadius: 2,
                      overflow: 'hidden',
                      border: 1,
                      borderColor: alpha(theme.palette.divider, 0.4),
                      bgcolor: alpha(theme.palette.background.default, 0.5),
                      mb: 3,
                    }}
                  >
                    {accountIsMinting && (
                      <Box
                        sx={{
                          px: 2,
                          py: 1.25,
                          borderBottom: 1,
                          borderColor: 'divider',
                        }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          {t('group:message.generic.node_minting_key', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      </Box>
                    )}
                    {mintingAccounts?.map((acct, i) => (
                      <Box
                        key={acct?.mintingAccount}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 2,
                          px: 2,
                          py: 1.25,
                          ...(i < mintingAccounts.length - 1 && {
                            borderBottom: 1,
                            borderColor: 'divider',
                          }),
                        }}
                      >
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        >
                          {t('group:message.generic.minting_account', {
                            postProcess: 'capitalizeFirstChar',
                          })}{' '}
                          {handleNames(acct?.mintingAccount)}
                        </Typography>
                        <Button
                          size="small"
                          sx={{
                            backgroundColor: theme.palette.other.danger,
                            color: theme.palette.text.primary,
                            fontWeight: 'bold',
                            flexShrink: 0,
                            opacity: 0.7,
                            '&:hover': {
                              backgroundColor: theme.palette.other.danger,
                              color: theme.palette.text.primary,
                              opacity: 1,
                            },
                          }}
                          onClick={() => {
                            removeMintingAccount(acct.publicKey, acct);
                          }}
                          variant="contained"
                        >
                          {t('group:action.remove_minting_account', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Button>
                      </Box>
                    ))}
                    {mintingAccounts?.length > 1 && (
                      <Box
                        sx={{
                          px: 2,
                          py: 1.25,
                          borderTop: 1,
                          borderColor: 'divider',
                          bgcolor: alpha(theme.palette.action.hover, 0.04),
                        }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          {t(
                            'group:message.generic.minting_keys_per_node_different',
                            { postProcess: 'capitalizeFirstChar' }
                          )}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </>
              )}

              {/* Not part of minting group */}
              {!isPartOfMintingGroup && (
                <Box
                  sx={{
                    borderRadius: 2,
                    border: 1,
                    borderColor: alpha(theme.palette.divider, 0.4),
                    bgcolor: alpha(theme.palette.background.default, 0.5),
                    p: 3,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 2,
                  }}
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    textAlign="center"
                  >
                    {t('group:message.generic.minter_group', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    textAlign="center"
                  >
                    {t('group:message.generic.mintership_app', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <Button
                    size="small"
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
                    onClick={() => {
                      executeEvent('addTab', {
                        data: { service: 'APP', name: 'q-mintership' },
                      });
                      executeEvent('open-apps-mode', {});
                      setIsOpenMinting(false);
                    }}
                    variant="contained"
                  >
                    {t('group:action.visit_q_mintership', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Button>
                </Box>
              )}

              {showWaitDialog && (
                <Dialog
                  open={showWaitDialog}
                  aria-labelledby="alert-dialog-title"
                  aria-describedby="alert-dialog-description"
                >
                  <DialogTitle
                    id="alert-dialog-title"
                    sx={{
                      textAlign: 'center',
                      color: theme.palette.text.primary,
                      fontWeight: 'bold',
                      opacity: 1,
                    }}
                  >
                    {isShowNext
                      ? t('core:message.generic.confirmed', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : t('core:message.generic.wait', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                  </DialogTitle>

                  <DialogContent>
                    {!isShowNext && (
                      <Typography>
                        {t('group:message.success.rewardshare_creation', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                    )}

                    {isShowNext && (
                      <Typography>
                        {t('group:message.success.rewardshare_confirmed', {
                          postProcess: 'capitalizeFirstChar',
                        })}
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
                      {t('core:pagination.next', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Button>
                  </DialogActions>
                </Dialog>
              )}
            </Box>
          </DialogContent>
        )}
      </Box>

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
