import {
  Alert,
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
import { useTranslation } from 'react-i18next';
import { TransitionUp } from '../../common/Transitions.tsx';
import {
  averageBlockDay,
  averageBlockTime,
  dayReward,
  levelUpBlocks,
} from './MintingStats.tsx';

export const Minting = ({ setIsOpenMinting, myAddress, show }) => {
  const setTxList = useSetAtom(txListAtom);
  const [groups] = useAtom(memberGroupsAtom);

  const [mintingAccounts, setMintingAccounts] = useState([]);
  const [accountInfo, setAccountInfo] = useState(null);
  const [mintingKey, setMintingKey] = useState('');
  const [rewardShares, setRewardShares] = useState([]);
  const [nodeStatus, setNodeStatus] = useState({});
  const [openSnack, setOpenSnack] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [adminInfo, setAdminInfo] = useState({});
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
      setTimeout(getAdminInfo, 30000);
    } catch (error) {
      console.log(error);
    }
  }, []);

  const getNodeStatus = useCallback(async () => {
    try {
      const url = `${getBaseApiReact()}/admin/status`;
      const response = await fetch(url);
      const data = await response.json();
      setNodeStatus(data);
      setTimeout(getNodeStatus, 30000);
    } catch (error) {
      console.error('Request failed', error);
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

  const getAddressLevel = useCallback(async () => {
    try {
      const url = `${getBaseApiReact()}/addresses/online/levels`;
      const response = await fetch(url);
      const data = await response.json();
      // this.tier4Online = parseFloat(this.addressLevel[7].count) + parseFloat(this.addressLevel[8].count)
      // setNodeStatus(data);
    } catch (error) {
      console.error('Request failed', error);
    }
  }, []);

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
    <Grid size={{ xs: 4, sm: 6 }}>
      <Paper elevation={5}>
        <Box textAlign="center">
          <Typography variant="subtitle1" fontWeight="bold">
            {label}
          </Typography>
          <Typography>{value}</Typography>
        </Box>
      </Paper>
    </Grid>
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
              label="Minting Details" // TODO translate
              sx={{
                '&.Mui-selected': {
                  color: theme.palette.text.primary,
                },
                fontSize: '1rem',
              }}
              {...a11yProps(0)}
            />
            <Tab
              label="Minting Actions"
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
              <Container maxWidth="md" sx={{ py: 4 }}>
                <Paper elevation={2} sx={{ p: 3, mb: 4, borderRadius: '10px' }}>
                  <Typography
                    variant="h3"
                    gutterBottom
                    sx={{ textAlign: 'center' }} // TODO translate
                  >
                    Blockchain Statistics
                  </Typography>

                  <Grid container spacing={2}>
                    <StatCard
                      label="Avg. Qortal Blocktime (seconds)"
                      value={averageBlockTime(
                        adminInfo,
                        nodeHeightBlock
                      ).toFixed(2)}
                    />

                    <StatCard
                      label="Avg. Blocks Per Day"
                      value={averageBlockDay(
                        adminInfo,
                        nodeHeightBlock
                      ).toFixed(2)}
                    />

                    <StatCard
                      label="Avg. Created QORT Per Day"
                      value="3558.48 QORT"
                    />
                  </Grid>
                </Paper>

                <Paper elevation={2} sx={{ p: 3, mb: 4, borderRadius: '10px' }}>
                  <Typography
                    variant="h3"
                    gutterBottom
                    sx={{ textAlign: 'center' }}
                  >
                    Minting Account Details
                  </Typography>

                  <Grid container spacing={2}>
                    <StatCard label="Current Status" value="(Minting)" />
                    <StatCard label="Current Level" value="Level 4" />
                    <StatCard
                      label="Blocks To Next Level"
                      value={levelUpBlocks(accountInfo, nodeStatus) || ''}
                    />
                  </Grid>

                  <Box mt={2} textAlign="center">
                    <Typography sx={{ textAlign: 'center' }}>
                      With a 24/7 Minting you will reach level 5 in{' '}
                      <strong>117.58 days</strong>!
                    </Typography>
                  </Box>
                </Paper>

                <Paper elevation={2} sx={{ p: 3, borderRadius: '10px' }}>
                  <Typography
                    variant="h3"
                    gutterBottom
                    sx={{ textAlign: 'center' }}
                  >
                    Minting Rewards Info
                  </Typography>

                  <Grid container spacing={2}>
                    <StatCard
                      label="Current Tier"
                      value="Tier 2 (Level 3 + 4)"
                    />
                    <StatCard
                      label="Total Minters in The Tier"
                      value="77 Minters"
                    />
                    <StatCard label="Tier Share Per Block" value="13%" />
                    <StatCard
                      label="Est. Reward Per Block"
                      value="0.00506494 QORT"
                    />
                    <StatCard
                      label="Est. Reward Per Day"
                      value={dayReward(
                        adminInfo,
                        nodeHeightBlock,
                        nodeStatus
                      ).toFixed(2)}
                    />
                    {/* <StatCard label="AdminInfo" value={adminInfo} /> */}
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

                <Typography>
                  {t('group:message.generic.next_level', {
                    postProcess: 'capitalizeFirstChar',
                  })}{' '}
                  {levelUpBlocks(accountInfo, nodeStatus)}
                </Typography>

                <Typography>
                  {t('group:message.generic.node_minting', {
                    postProcess: 'capitalizeFirstChar',
                  })}{' '}
                  {nodeStatus?.isMintingPossible?.toString()}
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
