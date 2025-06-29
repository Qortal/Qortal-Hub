import {
  Alert,
  alpha,
  AppBar,
  Box,
  Button,
  Card,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Snackbar,
  Tab,
  Tabs,
  Toolbar,
  Typography,
  useTheme,
} from '@mui/material';
import Grid from '@mui/material/Grid';
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
import { Spacer } from '../../common/Spacer';
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

  const StatCard = ({ label, value }: { label: string; value: string }) => (
    <Paper
      elevation={5}
      sx={{
        borderRadius: '10px',
        margin: '10px',
        padding: '10px',
      }}
    >
      <Box textAlign="center">
        <Typography variant="subtitle1" fontWeight="bold">
          {label}
        </Typography>
        <Typography>{value}</Typography>
      </Box>
    </Paper>
  );

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
          <>
            <DialogContent
              sx={{
                position: 'relative',
              }}
            >
              <Container
                maxWidth="md"
                sx={{
                  py: 4,
                }}
              >
                <Paper
                  elevation={0}
                  sx={{
                    backgroundColor: (theme) =>
                      alpha(theme.palette.background.paper, 0.5),
                    p: 3,
                    mb: 4,
                    borderRadius: '10px',
                  }}
                >
                  <Typography
                    variant="h3"
                    gutterBottom
                    sx={{ textAlign: 'center' }}
                  >
                    {t('core:minting.blockchain_statistics', {
                      postProcess: 'capitalizeEachFirstChar',
                    })}
                  </Typography>

                  <Grid
                    size={{ xs: 4, sm: 6 }}
                    container
                    spacing={2}
                    justifyContent="center"
                  >
                    <StatCard
                      label={t('core:minting.average_blocktime', {
                        postProcess: 'capitalizeEachFirstChar',
                      })}
                      value={t('core:time.second', {
                        count: parseFloat(
                          averageBlockTime(adminInfo, nodeHeightBlock).toFixed(
                            2
                          )
                        ),
                        postProcess: 'capitalizeEachFirstChar',
                      })}
                    />

                    <StatCard
                      label={t('core:minting.average_blocks_per_day', {
                        postProcess: 'capitalizeEachFirstChar',
                      })}
                      value={averageBlockDay(
                        adminInfo,
                        nodeHeightBlock
                      ).toFixed(2)}
                    />

                    <StatCard
                      label={t('core:minting.average_created_qorts_per_day', {
                        postProcess: 'capitalizeEachFirstChar',
                      })}
                      value={dayReward(
                        adminInfo,
                        nodeHeightBlock,
                        nodeStatus
                      ).toFixed(2)}
                    />
                  </Grid>
                </Paper>

                <Paper
                  elevation={0}
                  sx={{
                    backgroundColor: (theme) =>
                      alpha(theme.palette.background.paper, 0.5),
                    p: 3,
                    mb: 4,
                    borderRadius: '10px',
                  }}
                >
                  <Typography
                    variant="h3"
                    gutterBottom
                    sx={{ textAlign: 'center' }}
                  >
                    {t('core:minting.account_details', {
                      postProcess: 'capitalizeEachFirstChar',
                    })}
                  </Typography>

                  <Grid
                    size={{ xs: 4, sm: 6 }}
                    container
                    spacing={2}
                    justifyContent="center"
                  >
                    <StatCard
                      label={t('core:minting.current_status', {
                        postProcess: 'capitalizeEachFirstChar',
                      })}
                      value={mintingStatus(nodeStatus)}
                    />
                    <StatCard
                      label={t('core:minting.current_level', {
                        postProcess: 'capitalizeEachFirstChar',
                      })}
                      value={accountInfo?.level}
                    />
                    <StatCard
                      label={t('core:minting.blocks_next_level', {
                        postProcess: 'capitalizeEachFirstChar',
                      })}
                      value={
                        levelUpBlocks(accountInfo, nodeStatus).toFixed(0) || ''
                      }
                    />
                  </Grid>

                  <Box mt={4} textAlign="center">
                    <Paper elevation={5}>
                      <Typography sx={{ textAlign: 'center' }}>
                        <Trans
                          i18nKey="minting.next_level"
                          ns="core"
                          components={{
                            strong: <strong />,
                          }}
                          values={{
                            level: nextLevel(accountInfo?.level),
                            count: daysToNextLevel?.toFixed(2),
                          }}
                          tOptions={{ postProcess: ['capitalizeFirstChar'] }}
                        ></Trans>
                      </Typography>
                    </Paper>
                  </Box>
                </Paper>

                <Paper
                  elevation={0}
                  sx={{
                    backgroundColor: (theme) =>
                      alpha(theme.palette.background.paper, 0.5),
                    p: 3,
                    borderRadius: '10px',
                  }}
                >
                  <Typography
                    variant="h3"
                    gutterBottom
                    sx={{ textAlign: 'center' }}
                  >
                    {t('core:minting.rewards_info', {
                      postProcess: 'capitalizeEachFirstChar',
                    })}
                  </Typography>

                  <Grid
                    size={{ xs: 4, sm: 6 }}
                    container
                    spacing={2}
                    justifyContent="center"
                  >
                    <StatCard
                      label={t('core:minting.current_tier', {
                        postProcess: 'capitalizeEachFirstChar',
                      })}
                      value={t('core:minting.current_tier_content', {
                        tier: currentTier(accountInfo?.level)
                          ? currentTier(accountInfo?.level)[0]
                          : '',
                        levels: currentTier(accountInfo?.level)
                          ? currentTier(accountInfo?.level)[1]
                          : '',
                        postProcess: 'capitalizeEachFirstChar',
                      })}
                    />
                    <StatCard
                      label={t('core:minting.total_minter_in_tier', {
                        postProcess: 'capitalizeEachFirstChar',
                      })}
                      value={
                        countMintersInLevel(
                          accountInfo?.level,
                          addressLevel,
                          tier4Online
                        )?.toFixed(0) || ''
                      }
                    />
                    <StatCard
                      label={t('core:minting.tier_share_per_block', {
                        postProcess: 'capitalizeEachFirstChar',
                      })}
                      value={
                        tierPercent(accountInfo, tier4Online)?.toFixed(0) + ' %'
                      }
                    />
                    <StatCard
                      label={t('core:minting.reward_per_block', {
                        postProcess: 'capitalizeEachFirstChar',
                      })}
                      value={
                        countReward(
                          accountInfo,
                          addressLevel,
                          nodeStatus,
                          tier4Online
                        ).toFixed(8) + ' QORT'
                      }
                    />
                    <StatCard
                      label={t('core:minting.reward_per_day', {
                        postProcess: 'capitalizeEachFirstChar',
                      })}
                      value={
                        countRewardDay(
                          accountInfo,
                          addressLevel,
                          adminInfo,
                          nodeHeightBlock,
                          nodeStatus,
                          tier4Online
                        ).toFixed(8) + ' QORT'
                      }
                    />
                  </Grid>
                </Paper>
              </Container>
            </DialogContent>
          </>
        )}

        {valueMintingTab === 1 && (
          <>
            <DialogContent
              sx={{
                position: 'relative',
              }}
            >
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

              <Card
                sx={{
                  backgroundColor: theme.palette.background.default,
                  padding: '10px',
                }}
              >
                <Typography>
                  {t('auth:account.account_one', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  : {handleNames(accountInfo?.address)}
                </Typography>

                <Typography>
                  {t('core:level', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  : {accountInfo?.level}
                </Typography>
              </Card>

              <Spacer height="10px" />

              {isPartOfMintingGroup && !accountIsMinting && (
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '5px',
                    width: '100%',
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
                      maxWidth: '90%',
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
                    <Typography>
                      {t('group:message.generic.minting_keys_per_node', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  )}
                </Box>
              )}

              <Spacer height="10px" />

              {mintingAccounts?.length > 0 && (
                <Typography>
                  {t('group:message.generic.node_minting_account', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              )}
              <Card
                sx={{
                  backgroundColor: theme.palette.background.default,
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
                      {t('group:message.generic.node_minting_key', {
                        postProcess: 'capitalizeFirstChar',
                      })}
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
                        maxWidth: '90%',
                        opacity: 0.7,
                        width: '200px',
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

                    <Divider />

                    <Spacer height="10px" />
                  </Box>
                ))}

                {mintingAccounts?.length > 1 && (
                  <Typography>
                    {t(
                      'group:message.generic.minting_keys_per_node_different',
                      {
                        postProcess: 'capitalizeFirstChar',
                      }
                    )}
                  </Typography>
                )}
              </Card>

              <Spacer height="20px" />

              {!isPartOfMintingGroup && (
                <Card
                  sx={{
                    backgroundColor: theme.palette.background.default,
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
                      {t('group:message.generic.minter_group', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>

                    <Typography>
                      {t('group:message.generic.mintership_app', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>

                    <Spacer height="10px" />

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
                </Card>
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
                      {t('core:page.next', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Button>
                  </DialogActions>
                </Dialog>
              )}
            </DialogContent>
          </>
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
