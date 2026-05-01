import {
  alpha,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CloseIcon from '@mui/icons-material/Close';
import mintingWatermark from '../../assets/minting/blue-grey-menu-button2-1.png';
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
import {
  nextLevel,
  averageBlockDay,
  averageBlockTime,
  dayReward,
  levelUpBlocks,
  levelUpDays,
  countMintersInLevel,
  currentTier,
  tierPercent,
  countReward,
  countRewardDay,
} from './MintingStats.tsx';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';

export type AddressLevelEntry = {
  level: number;
  count: number;
};

export const Minting = ({ setIsOpenMinting, myAddress, show }) => {
  const setTxList = useSetAtom(txListAtom);
  const [groups] = useAtom(memberGroupsAtom);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const [mintingAccounts, setMintingAccounts] = useState([]);
  const [accountInfo, setAccountInfo] = useState(null);
  const [rewardShares, setRewardShares] = useState([]);
  const [adminInfo, setAdminInfo] = useState({});
  const [nodeStatus, setNodeStatus] = useState({});
  const [addressLevel, setAddressLevel] = useState<AddressLevelEntry[]>([]);
  const [tier4Online, setTier4Online] = useState(0);
  const [openSnack, setOpenSnack] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [nodeHeightBlock, setNodeHeightBlock] = useState({});
  const { isShow: isShowNext, onOk, show: showNext } = useModal();
  const [info, setInfo] = useState(null);
  const [names, setNames] = useState({});
  const [statsAccountInfo, setStatsAccountInfo] = useState(null);
  const [isStatsLoading, setIsStatsLoading] = useState(false);
  const [selectedMintingAccountKey, setSelectedMintingAccountKey] = useState(
    null
  );
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
        setNames((prev) => ({
          ...prev,
          [address]: nameData?.name,
        }));
      } else {
        setNames((prev) => ({
          ...prev,
          [address]: null,
        }));
      }
    } catch (error) {
      console.log(error);
    }
  };

  const getAccountInfo = async (address: string) => {
    try {
      setIsLoading(true);
      const url = `${getBaseApiReact()}/addresses/${address}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('network error');
      }
      const data = await response.json();
      setAccountInfo(data);
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatsAccountInfo = useCallback(async (address: string) => {
    if (!address) return;
    try {
      setIsStatsLoading(true);
      const url = `${getBaseApiReact()}/addresses/${address}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('network error');
      }
      const data = await response.json();
      setStatsAccountInfo(data);
    } catch (error) {
      console.log(error);
    } finally {
      setIsStatsLoading(false);
    }
  }, []);

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
      timeoutAdminInfoRef.current = setTimeout(getAdminInfo, 30000);
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
        setTier4Online(level7 + level8);
      }
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

  const addMintingAccount = useCallback(
    async (val) => {
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
    },
    [getMintingAccounts, t]
  );

  const removeMintingAccount = useCallback(
    async (val, acct) => {
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
    },
    [getMintingAccounts, t]
  );

  const createRewardShare = useCallback(
    async (publicKey, recipient) => {
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
    },
    [setTxList, show, t]
  );

  const getRewardSharePrivateKey = useCallback(
    async (publicKey) => {
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
    },
    [t]
  );

  const waitUntilRewardShareIsConfirmed = async (timeoutMs = 600000) => {
    const pollingInterval = 30000;
    const startTime = Date.now();
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    while (Date.now() - startTime < timeoutMs) {
      const rewardSharesResult = await getRewardShares(myAddress);
      const findRewardShare = rewardSharesResult?.find(
        (item) =>
          item?.recipient === myAddress && item?.mintingAccount === myAddress
      );

      if (findRewardShare) {
        return true;
      }
      await sleep(pollingInterval);
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
        await showNext({ message: '' });

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
  }, [getAdminInfo, getMintingAccounts, getNodeStatus]);

  useEffect(() => {
    if (!myAddress) return;
    getRewardShares(myAddress);
    getAccountInfo(myAddress);
  }, [myAddress, getRewardShares]);

  const effectiveSelectedMintingKey = useMemo(() => {
    if (!mintingAccounts?.length) return null;
    if (
      selectedMintingAccountKey &&
      mintingAccounts.some((a) => a?.mintingAccount === selectedMintingAccountKey)
    ) {
      return selectedMintingAccountKey;
    }
    const mine = mintingAccounts.find(
      (a) =>
        a?.recipientAccount === myAddress || a?.mintingAccount === myAddress
    );
    return mine?.mintingAccount ?? mintingAccounts[0]?.mintingAccount ?? null;
  }, [mintingAccounts, selectedMintingAccountKey, myAddress]);

  const statsAddress = useMemo(() => {
    if (mintingAccounts?.length > 0 && effectiveSelectedMintingKey) {
      return effectiveSelectedMintingKey;
    }
    return myAddress || '';
  }, [mintingAccounts, effectiveSelectedMintingKey, myAddress]);

  useEffect(() => {
    if (!statsAddress) {
      setStatsAccountInfo(null);
      return;
    }
    if (statsAddress === myAddress) {
      if (accountInfo?.address === statsAddress) {
        setStatsAccountInfo(accountInfo);
        return;
      }
      getStatsAccountInfo(statsAddress);
      return;
    }
    getStatsAccountInfo(statsAddress);
  }, [statsAddress, myAddress, accountInfo, getStatsAccountInfo]);

  const handleCloseSnack = () => {
    setOpenSnack(false);
    setTimeout(() => {
      setInfo(null);
    }, 250);
  };

  const closeMinting = () => {
    setIsOpenMinting(false);
  };

  const openQMintership = useCallback(() => {
    setIsOpenMinting(false);
    window.setTimeout(() => {
      executeEvent('addTab', {
        data: { service: 'APP', name: 'q-mintership', path: '' },
      });
      executeEvent('open-apps-mode', {});
    }, 0);
  }, [setIsOpenMinting]);

  const formatMetric = (
    value: number | string | null | undefined,
    digits = 2,
    suffix = ''
  ) => {
    const numericValue =
      typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(numericValue)
      ? `${numericValue.toFixed(digits)}${suffix}`
      : '-';
  };

  const isNodeSynchronizing = nodeStatus?.isSynchronizing === true;
  const daysToNextLevel = levelUpDays(
    statsAccountInfo,
    adminInfo,
    nodeHeightBlock,
    nodeStatus
  );
  const progressLevel = nextLevel(statsAccountInfo?.level);
  const progressBlocks = formatMetric(
    levelUpBlocks(statsAccountInfo, nodeStatus),
    0
  );
  const progressDays =
    typeof daysToNextLevel === 'number' && Number.isFinite(daysToNextLevel)
      ? Math.max(0, Math.round(daysToNextLevel))
      : null;
  const walletDisplayName =
    handleNames(accountInfo?.address) || myAddress || '-';
  const statsDisplayName =
    handleNames(statsAccountInfo?.address) || statsAddress || '-';
  const showAddressLine =
    !!statsAccountInfo?.address && statsDisplayName !== statsAccountInfo?.address;
  const showWalletAddressLine =
    !!accountInfo?.address && walletDisplayName !== accountInfo?.address;
  const viewingNodeMintingSelection =
    !!effectiveSelectedMintingKey &&
    !!mintingAccounts?.some(
      (a) => a?.mintingAccount === effectiveSelectedMintingKey
    );

  const userMintingState = useMemo(() => {
    if (isNodeSynchronizing) {
      return {
        tone: 'syncing',
        title: 'Synchronizing',
        description: 'The node is still syncing, so minting cannot begin yet.',
      };
    }
    if (viewingNodeMintingSelection) {
      return {
        tone: 'active',
        title: 'Minting active',
        description:
          'This minter key is configured on this node. Stats reflect the selected account.',
      };
    }
    if (accountIsMinting) {
      return {
        tone: 'active',
        title: 'Minting active',
        description: 'This account is configured to mint on this node.',
      };
    }
    if (!isPartOfMintingGroup) {
      return {
        tone: 'inactive',
        title: 'Not minting',
        description: 'This account is not yet part of the minter group.',
      };
    }
    if (mintingAccounts?.length > 1) {
      return {
        tone: 'inactive',
        title: 'Not minting',
        description: 'This node already has multiple minting keys configured.',
      };
    }
    return {
      tone: 'inactive',
      title: 'Not minting',
      description: 'This account is ready for the next minting step.',
    };
  }, [
    accountIsMinting,
    isNodeSynchronizing,
    isPartOfMintingGroup,
    mintingAccounts?.length,
    viewingNodeMintingSelection,
  ]);

  const statusToneStyles = {
    active: {
      background: alpha('#74d28f', theme.palette.mode === 'dark' ? 0.085 : 0.11),
      borderColor: alpha('#74d28f', 0.11),
      accent: '#86d89d',
    },
    syncing: {
      background: alpha('#9eb8df', theme.palette.mode === 'dark' ? 0.08 : 0.1),
      borderColor: alpha('#9eb8df', 0.1),
      accent: '#a8c2ea',
    },
    inactive: {
      background: alpha('#e59aa7', theme.palette.mode === 'dark' ? 0.07 : 0.095),
      borderColor: alpha('#e59aa7', 0.09),
      accent: '#f0a6b2',
    },
  } as const;

  const currentStatusTone = statusToneStyles[userMintingState.tone];

  const nextStepDescription = useMemo(() => {
    if (!isPartOfMintingGroup) {
      return 'Visit the Q-Mintership app to apply to become a minter.';
    }
    if (accountIsMinting) {
      return 'Minting is already active on this node.';
    }
    if (isNodeSynchronizing) {
      return 'Wait for the node to finish syncing before minting can begin.';
    }
    if (mintingAccounts?.length > 1) {
      return t('group:message.generic.minting_keys_per_node', {
        postProcess: 'capitalizeFirstChar',
      });
    }
    return 'Start minting on this node when you are ready.';
  }, [
    accountIsMinting,
    isNodeSynchronizing,
    isPartOfMintingGroup,
    mintingAccounts?.length,
    t,
  ]);

  const sectionLabelSx = {
    color: alpha(theme.palette.text.secondary, 0.64),
    display: 'block',
    fontSize: '0.68rem',
    fontWeight: 700,
    letterSpacing: '0.11em',
    mb: 0.9,
    textTransform: 'uppercase',
  } as const;

  const surfaceCardSx = {
    background:
      theme.palette.mode === 'dark'
        ? 'linear-gradient(180deg, rgba(22,25,32,0.68) 0%, rgba(18,21,28,0.76) 100%)'
        : 'linear-gradient(180deg, rgba(249,251,254,0.84) 0%, rgba(243,247,251,0.92) 100%)',
    border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
    borderRadius: '12px',
    boxShadow: 'none',
  } as const;

  const sectionDividerSx = {
    mt: 2.15,
    pt: 2.05,
    borderTop: `1px solid ${alpha(theme.palette.divider, 0.16)}`,
  } as const;

  const metricListRowSx = {
    alignItems: 'center',
    display: 'grid',
    gap: 1.5,
    gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) auto' },
    py: 1.05,
    '&:not(:last-of-type)': {
      borderBottom: `1px solid ${alpha(theme.palette.divider, 0.14)}`,
    },
  } as const;

  const metricLabelSx = {
    color: alpha(theme.palette.text.secondary, 0.6),
    fontSize: '0.88rem',
  } as const;

  const metricValueSx = {
    fontSize: '0.93rem',
    fontWeight: 700,
    textAlign: 'right',
  } as const;

  const silkyPrimaryButtonSx = {
    background:
      'linear-gradient(180deg, rgba(151,189,246,0.98) 0%, rgba(120,163,228,0.98) 100%)',
    border: '1px solid rgba(201,223,255,0.42)',
    borderRadius: '10px',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.34), 0 10px 24px rgba(44,88,152,0.24)',
    color: '#0E1827',
    fontWeight: 800,
    letterSpacing: '0.01em',
    px: 2.1,
    py: 1.1,
    textTransform: 'none',
    '&:hover': {
      background:
        'linear-gradient(180deg, rgba(160,196,250,1) 0%, rgba(128,171,233,1) 100%)',
      boxShadow:
        'inset 0 1px 0 rgba(255,255,255,0.36), 0 12px 26px rgba(44,88,152,0.28)',
    },
    '&.Mui-disabled': {
      background: alpha(theme.palette.action.disabledBackground, 0.9),
      borderColor: alpha(theme.palette.divider, 0.36),
      boxShadow: 'none',
      color: theme.palette.text.disabled,
    },
  } as const;

  const silkyDangerButtonSx = {
    background:
      'linear-gradient(180deg, rgba(248,150,160,0.96) 0%, rgba(226,101,118,0.98) 100%)',
    border: '1px solid rgba(255,214,219,0.4)',
    borderRadius: '10px',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.3), 0 10px 24px rgba(126,29,44,0.22)',
    color: '#2A0C12',
    fontWeight: 800,
    letterSpacing: '0.01em',
    px: 1.8,
    py: 0.95,
    textTransform: 'none',
    '&:hover': {
      background:
        'linear-gradient(180deg, rgba(250,158,168,1) 0%, rgba(230,110,127,1) 100%)',
      boxShadow:
        'inset 0 1px 0 rgba(255,255,255,0.34), 0 12px 26px rgba(126,29,44,0.26)',
    },
  } as const;

  const summaryMetricRows = [
    {
      label: t('core:minting.reward_per_day', {
        postProcess: 'capitalizeEachFirstChar',
      }),
      value:
        formatMetric(
          countRewardDay(
            statsAccountInfo,
            addressLevel,
            adminInfo,
            nodeHeightBlock,
            nodeStatus,
            tier4Online
          ),
          4
        ) + ' QORT',
    },
  ];

  const blockchainRows = [
    {
      label: t('core:minting.average_blocktime', {
        postProcess: 'capitalizeEachFirstChar',
      }),
      value: t('core:time.second', {
        count: parseFloat(formatMetric(averageBlockTime(adminInfo, nodeHeightBlock))),
        postProcess: 'capitalizeEachFirstChar',
      }),
    },
    {
      label: t('core:minting.average_blocks_per_day', {
        postProcess: 'capitalizeEachFirstChar',
      }),
      value: formatMetric(averageBlockDay(adminInfo, nodeHeightBlock)),
    },
    {
      label: t('core:minting.average_created_qorts_per_day', {
        postProcess: 'capitalizeEachFirstChar',
      }),
      value: formatMetric(dayReward(adminInfo, nodeHeightBlock, nodeStatus)) + ' QORT',
    },
  ];

  const directRewardRows = [
    {
      label: t('core:minting.current_tier', {
        postProcess: 'capitalizeEachFirstChar',
      }),
      value: t('core:minting.current_tier_content', {
        tier: currentTier(statsAccountInfo?.level)
          ? currentTier(statsAccountInfo?.level)[0]
          : '',
        levels: currentTier(statsAccountInfo?.level)
          ? currentTier(statsAccountInfo?.level)[1]
          : '',
        postProcess: 'capitalizeEachFirstChar',
      }),
    },
    {
      label: t('core:minting.tier_share_per_block', {
        postProcess: 'capitalizeEachFirstChar',
      }),
      value:
        formatMetric(tierPercent(statsAccountInfo, tier4Online), 0) + ' %',
    },
    {
      label: t('core:minting.reward_per_block', {
        postProcess: 'capitalizeEachFirstChar',
      }),
      value:
        formatMetric(
          countReward(
            statsAccountInfo,
            addressLevel,
            nodeStatus,
            tier4Online
          ),
          8
        ) + ' QORT',
    },
  ];

  const networkContextRows = [
    {
      label: t('core:minting.total_minter_in_tier', {
        postProcess: 'capitalizeEachFirstChar',
      }),
      value: formatMetric(
        countMintersInLevel(
          statsAccountInfo?.level,
          addressLevel,
          tier4Online
        ),
        0
      ),
    },
  ];

  return (
    <>
      <Dialog
        open={true}
        onClose={closeMinting}
        maxWidth={false}
        fullWidth
        BackdropProps={{
          sx: {
            backdropFilter: 'blur(12px)',
            backgroundColor: alpha('#07090D', 0.66),
          },
        }}
        PaperProps={{
          sx: {
            background:
              theme.palette.mode === 'dark'
                ? 'linear-gradient(180deg, rgba(20,23,30,0.985) 0%, rgba(15,17,23,0.99) 100%)'
                : 'linear-gradient(180deg, rgba(251,253,255,0.985) 0%, rgba(244,247,251,0.99) 100%)',
            border: `1px solid ${alpha(theme.palette.divider, 0.42)}`,
            borderRadius: '14px',
            boxShadow:
              theme.palette.mode === 'dark'
                ? '0 34px 120px rgba(0,0,0,0.46)'
                : '0 28px 88px rgba(18,28,45,0.16)',
            height: { xs: 'calc(100vh - 32px)', md: 'min(86vh, 920px)' },
            margin: { xs: 2, md: 3 },
            maxHeight: 'calc(100vh - 24px)',
            maxWidth: 'none',
            overflow: 'hidden',
            width: 'min(1180px, calc(100vw - 48px))',
          },
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.42)}`,
            display: 'flex',
            justifyContent: 'space-between',
            minHeight: 60,
            px: { xs: 2, md: 2.75 },
            py: 1.1,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: '1.12rem',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}
            >
              {t('group:message.generic.manage_minting', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.84rem',
                mt: 0.45,
              }}
            >
              Review your current minting state, progress, and next steps.
            </Typography>
          </Box>

          <IconButton
            onClick={closeMinting}
            aria-label={t('core:action.close', {
              postProcess: 'capitalizeFirstChar',
            })}
            sx={{
              borderRadius: '8px',
              color: theme.palette.text.secondary,
              height: 34,
              width: 34,
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <CloseIcon />
          </IconButton>
        </Box>

        <Box
          sx={{
            color: theme.palette.text.primary,
            display: 'flex',
            flex: '1 1 auto',
            minHeight: 0,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {isLoading && (
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor: alpha(theme.palette.background.default, 0.42),
                bottom: 0,
                display: 'flex',
                justifyContent: 'center',
                left: 0,
                position: 'absolute',
                right: 0,
                top: 0,
                zIndex: 2,
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

          <Box
            sx={{
              display: 'grid',
              flex: '1 1 auto',
              gap: 2.75,
              gridTemplateColumns: { xs: '1fr', lg: '360px minmax(0, 1fr)' },
              minHeight: 0,
              overflowY: 'auto',
              px: { xs: 2, md: 2.75 },
              py: { xs: 2.25, md: 2.75 },
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.75, minHeight: 0 }}>
              <Box
                sx={{
                  ...surfaceCardSx,
                  background:
                    theme.palette.mode === 'dark'
                      ? 'linear-gradient(180deg, rgba(18,21,28,0.42) 0%, rgba(15,18,24,0.52) 100%)'
                      : 'linear-gradient(180deg, rgba(249,251,254,0.72) 0%, rgba(243,247,251,0.82) 100%)',
                  borderColor: alpha(theme.palette.divider, 0.14),
                  flex: '1 1 auto',
                  minHeight: 0,
                  overflow: 'hidden',
                  p: { xs: 2, md: 2.25 },
                  position: 'relative',
                }}
              >
                <Box
                  component="img"
                  src={mintingWatermark}
                  alt=""
                  aria-hidden
                  sx={{
                    bottom: { xs: -88, md: -78 },
                    filter: 'saturate(0.92) brightness(0.88)',
                    left: { xs: -48, md: -58 },
                    maxWidth: { xs: 320, md: 390 },
                    opacity: 0.04,
                    pointerEvents: 'none',
                    position: 'absolute',
                    userSelect: 'none',
                    width: { xs: '82%', md: '94%' },
                    zIndex: 0,
                  }}
                />

                <Box sx={{ position: 'relative', zIndex: 1 }}>
                {mintingAccounts?.length > 0 ? (
                  <Box sx={{ mb: 2.25 }}>
                    <Typography sx={sectionLabelSx}>Your wallet</Typography>
                    <Typography
                      sx={{
                        fontSize: '1.05rem',
                        fontWeight: 700,
                        letterSpacing: '-0.02em',
                        lineHeight: 1.15,
                        wordBreak: 'break-word',
                      }}
                    >
                      {walletDisplayName}
                    </Typography>
                    {showWalletAddressLine ? (
                      <Typography
                        sx={{
                          color: alpha(theme.palette.text.secondary, 0.84),
                          fontSize: '0.82rem',
                          mt: 0.35,
                          wordBreak: 'break-all',
                        }}
                      >
                        {accountInfo?.address}
                      </Typography>
                    ) : null}
                  </Box>
                ) : null}

                <Box>
                  <Typography sx={sectionLabelSx}>
                    {mintingAccounts?.length > 0
                      ? 'Minter profile (stats)'
                      : 'Account identity'}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: '1.35rem',
                      fontWeight: 800,
                      letterSpacing: '-0.03em',
                      lineHeight: 1.12,
                      wordBreak: 'break-word',
                    }}
                  >
                    {statsDisplayName}
                  </Typography>
                  {showAddressLine ? (
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.secondary, 0.84),
                        fontSize: '0.86rem',
                        mt: 0.38,
                        wordBreak: 'break-all',
                      }}
                    >
                      {statsAccountInfo?.address}
                    </Typography>
                  ) : null}
                </Box>

                <Box
                  sx={{
                    ...sectionDividerSx,
                  }}
                >
                  <Typography sx={sectionLabelSx}>Progress to next level</Typography>
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      backgroundColor: alpha(theme.palette.primary.main, 0.08),
                      border: `1px solid ${alpha(theme.palette.primary.main, 0.14)}`,
                      borderRadius: '999px',
                      mb: 0.85,
                      px: 1,
                      py: 0.42,
                    }}
                  >
                    <Typography
                      sx={{
                        color: theme.palette.primary.main,
                        fontSize: '0.79rem',
                        fontWeight: 700,
                      }}
                    >
                      {t('core:level', { postProcess: 'capitalizeFirstChar' })}{' '}
                      {statsAccountInfo?.level ?? '-'}
                    </Typography>
                  </Box>
                  <Typography
                    sx={{
                      fontSize: '1.9rem',
                      fontWeight: 800,
                      letterSpacing: '-0.04em',
                      lineHeight: 1.05,
                    }}
                  >
                    {progressBlocks}
                  </Typography>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.9rem',
                      mt: 0.55,
                    }}
                  >
                    blocks to level {progressLevel || '-'}
                  </Typography>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.9rem',
                      mt: 1.2,
                    }}
                  >
                    Minting for: ~{progressDays ?? '-'} days
                  </Typography>
                </Box>

                <Box
                  sx={{
                    ...sectionDividerSx,
                  }}
                >
                  <Typography sx={sectionLabelSx}>Next step</Typography>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.86),
                      fontSize: '0.92rem',
                      lineHeight: 1.5,
                    }}
                  >
                    {nextStepDescription}
                  </Typography>

                  {isPartOfMintingGroup && !accountIsMinting ? (
                    <Box sx={{ mt: 1.6, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Button
                        size="small"
                        onClick={startMinting}
                        disabled={mintingAccounts?.length > 1 || isNodeSynchronizing}
                        variant="contained"
                        sx={silkyPrimaryButtonSx}
                      >
                        {t('core:action.start_minting', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Button>
                      {mintingAccounts?.length > 1 ? (
                        <Typography variant="body2" color="text.secondary">
                          {t('group:message.generic.minting_keys_per_node', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      ) : null}
                    </Box>
                  ) : null}

                  {!isPartOfMintingGroup ? (
                    <Box sx={{ mt: 1.6, display: 'flex', flexDirection: 'column', gap: 1.1 }}>
                      <Button
                        size="small"
                        onClick={openQMintership}
                        variant="contained"
                        sx={silkyPrimaryButtonSx}
                      >
                        {t('group:action.visit_q_mintership', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Button>
                    </Box>
                  ) : null}
                </Box>

                {mintingAccounts?.length > 0 ? (
                  <Box
                    sx={{
                      ...sectionDividerSx,
                    }}
                  >
                    <Typography sx={sectionLabelSx}>Node minting accounts</Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mb: 1.1, lineHeight: 1.45 }}
                    >
                      Select an account to update progress and reward stats on the
                      right.
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {mintingAccounts?.map((acct) => {
                        const isSelected =
                          acct?.mintingAccount === effectiveSelectedMintingKey;
                        return (
                          <Box
                            key={acct?.mintingAccount}
                            role="button"
                            tabIndex={0}
                            onClick={() =>
                              setSelectedMintingAccountKey(acct?.mintingAccount)
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedMintingAccountKey(acct?.mintingAccount);
                              }
                            }}
                            sx={{
                              backgroundColor: alpha(
                                theme.palette.background.default,
                                theme.palette.mode === 'dark' ? 0.14 : 0.34
                              ),
                              border: `1px solid ${
                                isSelected
                                  ? alpha(theme.palette.primary.main, 0.55)
                                  : alpha(theme.palette.divider, 0.14)
                              }`,
                              borderRadius: '10px',
                              boxShadow: isSelected
                                ? `0 0 0 1px ${alpha(theme.palette.primary.main, 0.35)}`
                                : 'none',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 1,
                              outline: 'none',
                              p: 1.15,
                              transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                            }}
                          >
                            <Box
                              sx={{
                                alignItems: 'center',
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 0.75,
                                justifyContent: 'space-between',
                              }}
                            >
                              <Typography
                                variant="body2"
                                sx={{
                                  color: theme.palette.text.primary,
                                  fontWeight: 700,
                                  wordBreak: 'break-word',
                                }}
                              >
                                {handleNames(acct?.mintingAccount)}
                              </Typography>
                              {isSelected ? (
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: theme.palette.primary.main,
                                    fontWeight: 700,
                                    letterSpacing: '0.06em',
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  Viewing stats
                                </Typography>
                              ) : null}
                            </Box>
                            <Button
                              size="small"
                              sx={silkyDangerButtonSx}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeMintingAccount(acct.publicKey, acct);
                              }}
                              variant="contained"
                            >
                              {t('group:action.remove_minting_account', {
                                postProcess: 'capitalizeFirstChar',
                              })}
                            </Button>
                          </Box>
                        );
                      })}
                    </Box>
                    {mintingAccounts?.length > 1 ? (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 1.2 }}
                      >
                        {t('group:message.generic.minting_keys_per_node_different', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                    ) : null}
                  </Box>
                ) : null}
                </Box>
              </Box>
            </Box>

            <Box
              aria-busy={isStatsLoading}
              sx={{
                borderLeft: {
                  xs: 'none',
                  lg: `1px solid ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.04 : 0.06)}`,
                },
                display: 'flex',
                flexDirection: 'column',
                gap: 2.4,
                minWidth: 0,
                opacity: isStatsLoading ? 0.62 : 1,
                pl: { xs: 0, lg: 3 },
                transition: 'opacity 0.2s ease',
              }}
            >
              <Box
                sx={{
                  ...surfaceCardSx,
                  background: currentStatusTone.background,
                  borderColor: currentStatusTone.borderColor,
                  position: 'relative',
                  p: { xs: 2, md: 2.2 },
                  '&::before': {
                    backgroundColor: alpha(currentStatusTone.accent, 0.62),
                    borderRadius: '999px',
                    bottom: 16,
                    content: '""',
                    left: 0,
                    position: 'absolute',
                    top: 16,
                    width: '1px',
                  },
                }}
              >
                <Typography sx={sectionLabelSx}>Current status</Typography>
                <Typography
                  sx={{
                    color: currentStatusTone.accent,
                    fontSize: '1.9rem',
                    fontWeight: 800,
                    letterSpacing: '-0.04em',
                    lineHeight: 1.05,
                  }}
                >
                  {userMintingState.title}
                </Typography>
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.92rem',
                    mt: 0.85,
                    maxWidth: 520,
                  }}
                >
                  {userMintingState.description}
                </Typography>
              </Box>

              <Box
                sx={{
                  display: 'grid',
                  gap: 1.1,
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'minmax(260px, 320px)',
                  },
                }}
              >
                {summaryMetricRows.map((row) => (
                  <Box
                    key={row.label}
                    sx={{
                      ...surfaceCardSx,
                      background:
                        theme.palette.mode === 'dark'
                          ? 'linear-gradient(180deg, rgba(18,21,28,0.4) 0%, rgba(15,18,24,0.48) 100%)'
                          : 'linear-gradient(180deg, rgba(249,251,254,0.7) 0%, rgba(243,247,251,0.8) 100%)',
                      borderColor: alpha(theme.palette.divider, 0.12),
                      minHeight: 88,
                      p: 1.55,
                    }}
                  >
                    <Typography sx={sectionLabelSx}>{row.label}</Typography>
                    <Typography
                      sx={{
                        color: row.accent
                          ? theme.palette.primary.main
                          : theme.palette.text.primary,
                        fontSize: row.label ===
                        t('core:minting.reward_per_day', {
                          postProcess: 'capitalizeEachFirstChar',
                        })
                          ? '1.05rem'
                          : '1.18rem',
                        fontWeight:
                          row.label ===
                          t('core:minting.reward_per_day', {
                            postProcess: 'capitalizeEachFirstChar',
                          })
                            ? 650
                            : 800,
                        letterSpacing: '-0.03em',
                        lineHeight: 1.12,
                        opacity:
                          row.label ===
                          t('core:minting.reward_per_day', {
                            postProcess: 'capitalizeEachFirstChar',
                          })
                            ? 0.88
                            : 1,
                      }}
                    >
                      {row.value}
                    </Typography>
                  </Box>
                ))}
              </Box>

              <Box
                sx={{
                  ...surfaceCardSx,
                  background:
                    theme.palette.mode === 'dark'
                      ? 'linear-gradient(180deg, rgba(18,21,27,0.46) 0%, rgba(15,18,24,0.52) 100%)'
                      : 'linear-gradient(180deg, rgba(248,250,253,0.74) 0%, rgba(242,246,251,0.8) 100%)',
                  borderColor: alpha(theme.palette.divider, 0.16),
                  p: { xs: 2, md: 2.15 },
                }}
              >
                <Typography sx={{ ...sectionLabelSx, color: theme.palette.text.primary }}>
                  Blockchain statistics
                </Typography>
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.48),
                    fontSize: '0.84rem',
                    mb: 1.45,
                  }}
                >
                  (for reference only)
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  {blockchainRows.map((row) => (
                    <Box key={row.label} sx={metricListRowSx}>
                      <Typography
                        variant="body2"
                        sx={{ ...metricLabelSx, color: alpha(theme.palette.text.secondary, 0.62) }}
                      >
                        {row.label}
                      </Typography>
                      <Typography variant="body2" sx={metricValueSx}>
                        {row.value}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>

              <Box
                sx={{
                  ...surfaceCardSx,
                  p: { xs: 2, md: 2.15 },
                }}
              >
                <Typography sx={{ ...sectionLabelSx, color: theme.palette.text.primary }}>
                  Minting rewards info
                </Typography>

                <Box>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.48),
                      fontSize: '0.9rem',
                      fontWeight: 400,
                      mb: 1,
                    }}
                  >
                    {statsAddress === myAddress
                      ? '(your rewards info)'
                      : '(selected minter — rewards for this key)'}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    {directRewardRows.map((row) => (
                      <Box key={row.label} sx={metricListRowSx}>
                        <Typography variant="body2" sx={metricLabelSx}>
                          {row.label}
                        </Typography>
                        <Typography variant="body2" sx={metricValueSx}>
                          {row.value}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>

                <Box
                  sx={{
                    mt: 3.35,
                    pt: 2.9,
                    borderTop: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
                  }}
                >
                  <Typography
                    sx={{
                      ...sectionLabelSx,
                      color: theme.palette.text.primary,
                      mb: 1,
                    }}
                  >
                    NETWORK DETAILS
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    {networkContextRows.map((row) => (
                      <Box key={row.label} sx={metricListRowSx}>
                        <Typography
                          variant="body2"
                          sx={{ ...metricLabelSx, color: alpha(theme.palette.text.secondary, 0.64) }}
                        >
                          {row.label}
                        </Typography>
                        <Typography variant="body2" sx={{ ...metricValueSx, opacity: 0.92 }}>
                          {row.value}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      </Dialog>

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
              sx={silkyPrimaryButtonSx}
            >
              {t('core:pagination.next', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={info}
        setInfo={setInfo}
      />
    </>
  );
};
