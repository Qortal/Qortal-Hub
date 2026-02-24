import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Card,
  Divider,
  IconButton,
  LinearProgress,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Table,
  TablePagination,
  CircularProgress,
  useTheme,
  alpha,
  Autocomplete,
} from '@mui/material';
import {
  getAddressInfo,
  getNameOrAddress,
} from '../../background/background.ts';
import { getBaseApiReact } from '../../App';
import { getNameInfo } from '../Group/groupApi';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import { Spacer } from '../../common/Spacer';
import { formatTimestamp } from '../../utils/time';
import CloseIcon from '@mui/icons-material/Close';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { useNameSearch } from '../../hooks/useNameSearch';
import { useTranslation } from 'react-i18next';
import { validateAddress } from '../../utils/validateAddress.ts';
import { appHeighOffsetPx } from '../Desktop/CustomTitleBar';
import {
  accountTargetBlocks,
  levelUpBlocks,
  levelUpDays,
  nextLevel,
} from '../Minting/MintingStats.tsx';

function formatAddress(str: string) {
  if (!str || str.length <= 12) return str || '';
  const first6 = str.slice(0, 6);
  const last6 = str.slice(-6);
  return `${first6}....${last6}`;
}

function formatBalance(value: number | string | undefined): string {
  if (value == null || value === '') return '0';
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(n)) return '0';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

export const UserLookup = ({ isOpenDrawerLookup, setIsOpenDrawerLookup }) => {
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const [nameOrAddress, setNameOrAddress] = useState('');
  const [inputValue, setInputValue] = useState('');
  const { results, isLoading } = useNameSearch(inputValue);
  const options = useMemo(() => {
    const isAddress = validateAddress(inputValue);
    if (isAddress) return [inputValue];
    return results?.map((item) => item.name);
  }, [results, inputValue]);
  const [errorMessage, setErrorMessage] = useState('');
  const [addressInfo, setAddressInfo] = useState<any>(null);
  const [nodeStatus, setNodeStatus] = useState<any>(null);
  const [adminInfo, setAdminInfo] = useState<any>(null);
  const [nodeHeightBlock, setNodeHeightBlock] = useState<any>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(false);
  const [isLoadingPayments, setIsLoadingPayments] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);
  const [totalPaymentsCount, setTotalPaymentsCount] = useState<number>(0);
  const [paymentsPage, setPaymentsPage] = useState(0);
  const [paymentsRowsPerPage, setPaymentsRowsPerPage] = useState(5);
  const [addressNamesMap, setAddressNamesMap] = useState<
    Record<string, { name: string | null; loading: boolean }>
  >({});
  const [lookupHistory, setLookupHistory] = useState<{
    history: string[];
    index: number;
  }>({ history: [], index: -1 });

  const tRef = useRef(t);
  tRef.current = t;
  const lookupInProgressRef = useRef(false);
  const lastFetchedOwnerRef = useRef<string | null>(null);
  const hoverNameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const HOVER_DELAY_MS = 750;

  const lookupFunc = useCallback(
    async (
      messageAddressOrName: string,
      options?: { skipHistoryPush?: boolean }
    ) => {
      const inputAddressOrName = (
        messageAddressOrName ?? nameOrAddress
      )?.trim();
      if (!inputAddressOrName) {
        return;
      }
      if (lookupInProgressRef.current) return;
      lookupInProgressRef.current = true;
      try {
        const owner = await getNameOrAddress(inputAddressOrName);
        if (!owner) {
          throw new Error(
            tRef.current('auth:message.error.name_not_existing', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        }
        if (
          !options?.skipHistoryPush &&
          lastFetchedOwnerRef.current === owner
        ) {
          lookupInProgressRef.current = false;
          return;
        }
        lastFetchedOwnerRef.current = owner;

        setErrorMessage('');
        setIsLoadingUser(true);
        setPayments([]);
        setTotalPaymentsCount(0);
        setAddressInfo(null);
        setNodeStatus(null);
        setAdminInfo(null);
        setNodeHeightBlock(null);
        setPaymentsPage(0);

        const addressInfoRes = await getAddressInfo(owner);
        if (!addressInfoRes?.publicKey) {
          throw new Error(
            tRef.current('auth:message.error.address_not_existing', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        }
        const isAddress = validateAddress(messageAddressOrName);
        const name = !isAddress
          ? messageAddressOrName
          : await getNameInfo(owner);
        const baseUrl = getBaseApiReact();
        const balanceRes = await fetch(`${baseUrl}/addresses/balance/${owner}`);
        const balanceData = await balanceRes.json();
        setAddressInfo({
          ...addressInfoRes,
          balance: balanceData,
          name,
        });
        setIsLoadingUser(false);

        if (!options?.skipHistoryPush) {
          setLookupHistory((prev) => {
            const truncated = prev.history.slice(0, prev.index + 1);
            truncated.push(owner);
            const maxLen = 50;
            const history =
              truncated.length > maxLen ? truncated.slice(-maxLen) : truncated;
            return { history, index: history.length - 1 };
          });
        }

        // Node status for level progress (remaining blocks / days)
        try {
          const statusRes = await fetch(`${baseUrl}/admin/status`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            setNodeStatus(statusData);
            if (statusData?.height != null) {
              const blockHeight = statusData.height - 1440;
              const blockRes = await fetch(
                `${baseUrl}/blocks/byheight/${blockHeight}`
              );
              if (blockRes.ok) {
                setNodeHeightBlock(await blockRes.json());
              }
              const adminRes = await fetch(`${baseUrl}/admin/info`);
              if (adminRes.ok) {
                setAdminInfo(await adminRes.json());
              }
            }
          }
        } catch (_) {
          // non-fatal
        }

        setIsLoadingPayments(true);
        try {
          const paymentsRes = await fetch(
            `${baseUrl}/transactions/search?txType=PAYMENT&address=${owner}&confirmationStatus=CONFIRMED&limit=500&reverse=true`
          );
          const paymentsData = await paymentsRes.json();
          const list = Array.isArray(paymentsData) ? paymentsData : [];
          setPayments(list);
          setTotalPaymentsCount(list.length);
        } finally {
          setIsLoadingPayments(false);
        }
      } catch (error) {
        setErrorMessage(error?.message);
        console.error(error);
      } finally {
        setIsLoadingUser(false);
        setIsLoadingPayments(false);
        lookupInProgressRef.current = false;
      }
    },
    [nameOrAddress]
  );

  const fetchNameForAddress = useCallback((address: string) => {
    if (!address) return;
    setAddressNamesMap((prev) => {
      const existing = prev[address];
      if (existing) return prev;
      return { ...prev, [address]: { name: null, loading: true } };
    });
    getNameInfo(address)
      .then((name) => {
        setAddressNamesMap((prev) => ({
          ...prev,
          [address]: { name: name || null, loading: false },
        }));
      })
      .catch(() => {
        setAddressNamesMap((prev) => ({
          ...prev,
          [address]: { name: null, loading: false },
        }));
      });
  }, []);

  const scheduleFetchNameForAddress = useCallback(
    (address: string) => {
      if (hoverNameTimeoutRef.current) {
        clearTimeout(hoverNameTimeoutRef.current);
        hoverNameTimeoutRef.current = null;
      }
      if (!address) return;
      hoverNameTimeoutRef.current = setTimeout(() => {
        fetchNameForAddress(address);
        hoverNameTimeoutRef.current = null;
      }, HOVER_DELAY_MS);
    },
    [fetchNameForAddress]
  );

  const cancelFetchNameForAddress = useCallback(() => {
    if (hoverNameTimeoutRef.current) {
      clearTimeout(hoverNameTimeoutRef.current);
      hoverNameTimeoutRef.current = null;
    }
  }, []);

  const openUserLookupDrawerFunc = useCallback(
    (e) => {
      setIsOpenDrawerLookup(true);
      const message = e.detail?.addressOrName;
      if (message) {
        setNameOrAddress(message);
        setInputValue(message);
        lookupFunc(message);
      }
    },
    [lookupFunc, setIsOpenDrawerLookup]
  );

  useEffect(() => {
    subscribeToEvent('openUserLookupDrawer', openUserLookupDrawerFunc);

    return () => {
      unsubscribeFromEvent('openUserLookupDrawer', openUserLookupDrawerFunc);
    };
  }, [openUserLookupDrawerFunc]);

  const goBack = useCallback(() => {
    const { history, index } = lookupHistory;
    if (index <= 0) return;
    const prevAddress = history[index - 1];
    lastFetchedOwnerRef.current = null;
    setNameOrAddress(prevAddress);
    setInputValue(prevAddress);
    setLookupHistory((prev) => ({ ...prev, index: prev.index - 1 }));
    lookupFunc(prevAddress, { skipHistoryPush: true });
  }, [lookupHistory, lookupFunc]);

  const goForward = useCallback(() => {
    const { history, index } = lookupHistory;
    if (index >= history.length - 1 || index < 0) return;
    const nextAddress = history[index + 1];
    lastFetchedOwnerRef.current = null;
    setNameOrAddress(nextAddress);
    setInputValue(nextAddress);
    setLookupHistory((prev) => ({ ...prev, index: prev.index + 1 }));
    lookupFunc(nextAddress, { skipHistoryPush: true });
  }, [lookupHistory, lookupFunc]);

  const canGoBack = lookupHistory.history.length > 0 && lookupHistory.index > 0;
  const canGoForward =
    lookupHistory.history.length > 0 &&
    lookupHistory.index >= 0 &&
    lookupHistory.index < lookupHistory.history.length - 1;

  const onClose = () => {
    setIsOpenDrawerLookup(false);
    setNameOrAddress('');
    setInputValue('');
    setErrorMessage('');
    setPayments([]);
    setTotalPaymentsCount(0);
    setNodeStatus(null);
    setAdminInfo(null);
    setNodeHeightBlock(null);
    setPaymentsPage(0);
    setIsLoadingUser(false);
    setIsLoadingPayments(false);
    setAddressInfo(null);
    lastFetchedOwnerRef.current = null;
    setLookupHistory({ history: [], index: -1 });
  };

  const currentBlocks =
    (addressInfo?.blocksMinted ?? 0) +
    (addressInfo?.blocksMintedAdjustment ?? 0);
  const targetBlocks =
    addressInfo?.level != null
      ? accountTargetBlocks(addressInfo.level)
      : undefined;
  const progress =
    targetBlocks != null && targetBlocks > 0
      ? Math.min(1, currentBlocks / targetBlocks)
      : 0;
  const remainingBlocks =
    addressInfo && nodeStatus
      ? levelUpBlocks(addressInfo, nodeStatus)
      : targetBlocks != null
        ? Math.max(0, targetBlocks - currentBlocks)
        : 0;
  const daysToLevel =
    addressInfo && nodeStatus && adminInfo && nodeHeightBlock
      ? levelUpDays(addressInfo, adminInfo, nodeHeightBlock, nodeStatus)
      : undefined;
  const nextLevelNum =
    addressInfo?.level != null ? nextLevel(addressInfo.level) : undefined;

  const paginatedPayments = useMemo(() => {
    const start = paymentsPage * paymentsRowsPerPage;
    return payments.slice(start, start + paymentsRowsPerPage);
  }, [payments, paymentsPage, paymentsRowsPerPage]);

  const { totalReceived, totalSent } = useMemo(() => {
    const owner = addressInfo?.address;
    if (!owner || !payments.length) {
      return { totalReceived: undefined, totalSent: undefined };
    }
    let received = 0;
    let sent = 0;
    for (const tx of payments) {
      const amount = parseFloat(tx?.amount ?? '0') || 0;
      if (tx?.recipient === owner) received += amount;
      if (tx?.creatorAddress === owner) sent += amount;
    }
    return { totalReceived: received, totalSent: sent };
  }, [addressInfo?.address, payments]);

  if (!isOpenDrawerLookup) return null;

  return (
    <Box
      sx={{
        backgroundColor: theme.palette.background.paper,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        bottom: 0,
        boxShadow: theme.shadows[12],
        height: `calc(100vh - ${appHeighOffsetPx})`,
        overflow: 'hidden',
        position: 'fixed',
        right: 0,
        width: '100vw',
        zIndex: 100,
      }}
    >
      <Box
        sx={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            px: 2,
            py: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconButton
              onClick={goBack}
              disabled={!canGoBack}
              size="small"
              aria-label={t('core:pagination.previous', {
                postProcess: 'capitalizeFirstChar',
              })}
              sx={{
                color: canGoBack
                  ? theme.palette.text.primary
                  : theme.palette.text.disabled,
                '&:hover': canGoBack
                  ? {
                      backgroundColor: alpha(theme.palette.action.hover, 0.5),
                    }
                  : {},
              }}
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <IconButton
              onClick={goForward}
              disabled={!canGoForward}
              size="small"
              aria-label={t('core:pagination.next', {
                postProcess: 'capitalizeFirstChar',
              })}
              sx={{
                color: canGoForward
                  ? theme.palette.text.primary
                  : theme.palette.text.disabled,
                '&:hover': canGoForward
                  ? {
                      backgroundColor: alpha(theme.palette.action.hover, 0.5),
                    }
                  : {},
              }}
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Box>
          <Typography
            variant="h6"
            sx={{ fontWeight: 600, letterSpacing: '-0.02em' }}
          >
            {t('core:user_lookup', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <IconButton
            onClick={onClose}
            size="small"
            sx={{
              color: theme.palette.text.secondary,
              '&:hover': {
                backgroundColor: alpha(theme.palette.action.hover, 0.5),
                color: theme.palette.text.primary,
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            minHeight: 0,
            overflow: 'auto',
            p: 2,
          }}
        >
          <Box sx={{ mb: 2 }}>
            <Typography
              component="label"
              htmlFor="user-lookup-address-name"
              variant="body2"
              color="text.secondary"
              sx={{ display: 'block', mb: 1 }}
            >
              {t('auth:address_name', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            <Autocomplete
              value={nameOrAddress}
              onChange={(event: any, newValue: string | null) => {
                if (!newValue) {
                  setNameOrAddress('');
                  return;
                }
                if (
                  addressInfo &&
                  (addressInfo.address === newValue ||
                    addressInfo.name === newValue)
                ) {
                  setNameOrAddress(newValue);
                  return;
                }
                setNameOrAddress(newValue);
                lookupFunc(newValue);
              }}
              inputValue={inputValue}
              onInputChange={(event, newInputValue) => {
                setInputValue(newInputValue);
              }}
              id="controllable-states-demo"
              loading={isLoading}
              noOptionsText={t('core:option_no', {
                postProcess: 'capitalizeFirstChar',
              })}
              options={options}
              sx={{ flexGrow: 1 }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  id="user-lookup-address-name"
                  autoFocus
                  autoComplete="off"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && inputValue) {
                      lookupFunc(inputValue);
                    }
                  }}
                  variant="outlined"
                  size="small"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      backgroundColor: theme.palette.background.default,
                    },
                  }}
                />
              )}
            />
          </Box>

          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              minHeight: 0,
              overflow: 'auto',
              flexShrink: 0,
            }}
          >
            {!isLoadingUser && errorMessage && (
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  minHeight: 120,
                  width: '100%',
                  p: 2,
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.error.main, 0.08),
                  border: 1,
                  borderColor: alpha(theme.palette.error.main, 0.2),
                }}
              >
                <Typography color="error" variant="body2">
                  {errorMessage}
                </Typography>
              </Box>
            )}

            {isLoadingUser && (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 200,
                  width: '100%',
                  gap: 2,
                }}
              >
                <CircularProgress
                  size={40}
                  thickness={4}
                  sx={{ color: theme.palette.primary.main }}
                />
                <Typography variant="body2" color="text.secondary">
                  {t('core:loading.generic', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
            )}

            {!isLoadingUser && addressInfo && (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'row',
                  flex: 1,
                  gap: 0,
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                {/* Left panel: name, avatar, level progress */}
                <Card
                  sx={{
                    alignItems: 'center',
                    background: alpha(theme.palette.background.default, 0.6),
                    borderRadius: 3,
                    display: 'flex',
                    flexDirection: 'column',
                    flexShrink: 0,
                    minWidth: 280,
                    p: 3,
                    width: 280,
                    boxShadow: theme.shadows[2],
                    border: 1,
                    borderColor: alpha(theme.palette.divider, 0.5),
                  }}
                >
                  <Typography
                    variant="h6"
                    sx={{
                      fontWeight: 700,
                      textAlign: 'center',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {addressInfo?.name ??
                      t('auth:message.error.name_not_registered', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                  </Typography>
                  <Spacer height="20px" />
                  {addressInfo?.name ? (
                    <Avatar
                      sx={{
                        height: 80,
                        width: 80,
                        boxShadow: theme.shadows[4],
                        border: 3,
                        borderColor: theme.palette.background.paper,
                        '& img': { objectFit: 'cover' },
                      }}
                      alt={addressInfo?.name}
                      src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${addressInfo?.name}/qortal_avatar?async=true`}
                    >
                      <AccountCircleIcon sx={{ fontSize: 56 }} />
                    </Avatar>
                  ) : (
                    <Box
                      sx={{
                        width: 80,
                        height: 80,
                        borderRadius: '50%',
                        bgcolor: alpha(theme.palette.action.hover, 0.3),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <AccountCircleIcon
                        sx={{ fontSize: 56, color: 'text.secondary' }}
                      />
                    </Box>
                  )}
                  <Spacer height="24px" />
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
                      {t('core:level', { postProcess: 'capitalizeFirstChar' })}{' '}
                      {addressInfo?.level ?? 0}
                    </Typography>
                  </Box>
                  {targetBlocks != null && (
                    <>
                      <Box sx={{ width: '100%', mt: 2 }}>
                        <LinearProgress
                          variant="determinate"
                          value={progress * 100}
                          sx={{
                            height: 10,
                            borderRadius: 5,
                            backgroundColor: alpha(
                              theme.palette.primary.main,
                              0.2
                            ),
                            '& .MuiLinearProgress-bar': {
                              borderRadius: 5,
                            },
                          }}
                        />
                      </Box>
                      <Typography
                        variant="body2"
                        color="text.primary"
                        sx={{ mt: 1, fontWeight: 600 }}
                      >
                        {currentBlocks.toLocaleString()} / {targetBlocks.toLocaleString()}
                      </Typography>
                      {nextLevelNum != null && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.25 }}
                        >
                          {t('core:remaining_to_level', {
                            level: nextLevelNum,
                          })}
                        </Typography>
                      )}
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 0.25 }}
                      >
                        {remainingBlocks.toLocaleString()}{' '}
                        {t('core:blocks', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                      {daysToLevel != null && daysToLevel >= 0 && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.25 }}
                        >
                          ~{Math.round(daysToLevel)}{' '}
                          {t('core:days_of_minting', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      )}
                    </>
                  )}
                </Card>

                {/* Right panel: details for address */}
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                    overflow: 'auto',
                    pl: 3,
                    pr: 2,
                    py: 2,
                  }}
                >
                  <Typography
                    variant="subtitle1"
                    sx={{
                      fontWeight: 600,
                      letterSpacing: '-0.01em',
                      mb: 2,
                      color: theme.palette.text.primary,
                    }}
                  >
                    {t('core:details_for_address', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <Box
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      bgcolor: alpha(theme.palette.background.default, 0.5),
                      border: 1,
                      borderColor: alpha(theme.palette.divider, 0.4),
                      mb: 2,
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        color: theme.palette.text.secondary,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        fontWeight: 600,
                      }}
                    >
                      {t('auth:address', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                    <Tooltip
                      title={t('auth:action.copy_address', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                      placement="bottom"
                      arrow
                      slotProps={{
                        tooltip: {
                          sx: {
                            color: theme.palette.text.primary,
                            backgroundColor: theme.palette.background.default,
                          },
                        },
                      }}
                    >
                      <ButtonBase
                        onClick={() => {
                          navigator.clipboard.writeText(addressInfo?.address);
                        }}
                        sx={{ display: 'block', textAlign: 'left', mt: 0.25 }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            fontFamily: 'monospace',
                            wordBreak: 'break-all',
                            '&:hover': { opacity: 0.8 },
                          }}
                        >
                          {addressInfo?.address}
                        </Typography>
                      </ButtonBase>
                    </Tooltip>
                  </Box>
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0,
                      mb: 2,
                      borderRadius: 2,
                      overflow: 'hidden',
                      border: 1,
                      borderColor: alpha(theme.palette.divider, 0.4),
                      bgcolor: alpha(theme.palette.background.default, 0.5),
                      paddingBottom: 1,
                    }}
                  >
                    {[
                      {
                        label: t('core:balance', {
                          postProcess: 'capitalizeFirstChar',
                        }),
                        value: `${formatBalance(addressInfo?.balance)} QORT`,
                      },
                      {
                        label: t('core:total_received', {
                          postProcess: 'capitalizeFirstChar',
                        }),
                        value:
                          totalReceived != null
                            ? `${formatBalance(totalReceived)} QORT`
                            : '—',
                      },
                      {
                        label: t('core:total_sent', {
                          postProcess: 'capitalizeFirstChar',
                        }),
                        value:
                          totalSent != null
                            ? `${formatBalance(totalSent)} QORT`
                            : '—',
                      },
                      {
                        label: t('core:total_blocks_minted', {
                          postProcess: 'capitalizeFirstChar',
                        }),
                        value: (
                          (addressInfo?.blocksMinted ?? 0) +
                          (addressInfo?.blocksMintedAdjustment ?? 0)
                        ).toLocaleString(),
                      },
                    ].map((row, i) => (
                      <Box
                        key={row.label}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          px: 2,
                          py: 1.25,
                          ...(i === 3 && { pb: 1.75 }),
                          borderBottom: i < 3 ? 1 : 0,
                          borderColor: 'divider',
                        }}
                      >
                        <Typography
                          variant="body2"
                          color={i === 3 ? 'text.primary' : 'text.secondary'}
                          sx={i === 3 ? { fontWeight: 600 } : undefined}
                        >
                          {row.label}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {row.value}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                  <Button
                    variant="contained"
                    onClick={() => {
                      executeEvent('openPaymentInternal', {
                        address: addressInfo?.address,
                        name: addressInfo?.name,
                      });
                    }}
                    sx={{
                      alignSelf: 'flex-start',
                      mb: 2,
                      px: 3,
                      py: 1.25,
                      borderRadius: 2,
                      fontWeight: 600,
                      textTransform: 'none',
                      boxShadow: theme.shadows[2],
                      '&:hover': { boxShadow: theme.shadows[4] },
                    }}
                  >
                    {t('core:action.send_qort', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Button>
                  <Divider
                    sx={{
                      my: 2,
                      borderColor: alpha(theme.palette.divider, 0.5),
                    }}
                  />
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    sx={{ mb: 1, fontWeight: 600 }}
                  >
                    {t('core:payments_count', {
                      count: totalPaymentsCount,
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <Table
                    size="small"
                    sx={{
                      borderRadius: 2,
                      overflow: 'hidden',
                      border: 1,
                      borderColor: alpha(theme.palette.divider, 0.4),
                      '& .MuiTableHead-root .MuiTableCell-head': {
                        fontWeight: 600,
                        backgroundColor: alpha(
                          theme.palette.background.default,
                          0.8
                        ),
                        color: theme.palette.text.secondary,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        fontSize: '0.75rem',
                      },
                      '& .MuiTableBody-root .MuiTableRow-root:hover': {
                        backgroundColor: alpha(theme.palette.action.hover, 0.4),
                      },
                      '& .MuiTableBody-root .MuiTableRow-root:hover .MuiButtonBase-root .MuiTypography-root':
                        {
                          color: theme.palette.primary.light,
                        },
                      '& .MuiTableCell-root': {
                        borderColor: alpha(theme.palette.divider, 0.3),
                      },
                    }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell>
                          {t('core:sender', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </TableCell>
                        <TableCell>
                          {t('core:receiver', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </TableCell>
                        <TableCell>
                          {t('core:amount', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </TableCell>
                        <TableCell>
                          {t('core:time.time', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {isLoadingPayments && (
                        <TableRow>
                          <TableCell colSpan={4} align="center" sx={{ py: 3 }}>
                            <CircularProgress
                              size={24}
                              sx={{ color: theme.palette.text.primary }}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                      {!isLoadingPayments && paginatedPayments.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4}>
                            {t('core:message.generic.no_payments', {
                              postProcess: 'capitalizeFirstChar',
                            })}
                          </TableCell>
                        </TableRow>
                      )}
                      {paginatedPayments.map((payment) => {
                        const currentAddress = addressInfo?.address;
                        const isSenderCurrent =
                          currentAddress &&
                          payment?.creatorAddress === currentAddress;
                        const isReceiverCurrent =
                          currentAddress &&
                          payment?.recipient === currentAddress;
                        const handleAddressClick = (address: string) => {
                          if (!address || address === currentAddress) return;
                          setNameOrAddress(address);
                          setInputValue(address);
                          lookupFunc(address);
                        };
                        return (
                          <TableRow
                            key={payment?.signature ?? payment?.timestamp}
                          >
                            <TableCell>
                              {isSenderCurrent ? (
                                <Typography variant="body2">
                                  {addressInfo?.name?.trim() ||
                                    formatAddress(payment?.creatorAddress)}
                                </Typography>
                              ) : (
                                <Tooltip
                                  onOpen={() =>
                                    scheduleFetchNameForAddress(
                                      payment?.creatorAddress
                                    )
                                  }
                                  onClose={cancelFetchNameForAddress}
                                  title={(() => {
                                    const entry =
                                      addressNamesMap[payment?.creatorAddress];
                                    if (!entry || entry.loading)
                                      return (
                                        <Box
                                          sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            py: 1,
                                            minWidth: 48,
                                          }}
                                        >
                                          <CircularProgress
                                            size={24}
                                            sx={{
                                              color: theme.palette.primary.main,
                                            }}
                                          />
                                        </Box>
                                      );
                                    if (entry.name)
                                      return (
                                        <Typography
                                          variant="body1"
                                          sx={{
                                            fontSize: '1.0625rem',
                                            fontWeight: 600,
                                          }}
                                        >
                                          {entry.name}
                                        </Typography>
                                      );
                                    return (
                                      <Typography
                                        variant="body2"
                                        sx={{
                                          fontFamily: 'monospace',
                                          fontSize: '0.9375rem',
                                          wordBreak: 'break-all',
                                        }}
                                      >
                                        {payment?.creatorAddress ?? ''}
                                      </Typography>
                                    );
                                  })()}
                                  placement="top"
                                  arrow
                                  slotProps={{
                                    tooltip: {
                                      sx: {
                                        color: theme.palette.text.primary,
                                        backgroundColor:
                                          theme.palette.background.paper,
                                        border: 1,
                                        borderColor: 'divider',
                                        borderRadius: 2,
                                        boxShadow: theme.shadows[4],
                                        padding: '12px 16px',
                                        maxWidth: 360,
                                      },
                                    },
                                    arrow: {
                                      sx: {
                                        color: theme.palette.background.paper,
                                      },
                                    },
                                  }}
                                >
                                  <ButtonBase
                                    onClick={() =>
                                      handleAddressClick(
                                        payment?.creatorAddress
                                      )
                                    }
                                    sx={{ textAlign: 'left' }}
                                  >
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        fontFamily: 'monospace',
                                        color: theme.palette.primary.light,
                                        fontWeight: 500,
                                        '&:hover': {
                                          textDecoration: 'underline',
                                          opacity: 0.95,
                                        },
                                      }}
                                    >
                                      {formatAddress(payment?.creatorAddress)}
                                    </Typography>
                                  </ButtonBase>
                                </Tooltip>
                              )}
                            </TableCell>
                            <TableCell>
                              {isReceiverCurrent ? (
                                <Typography variant="body2">
                                  {addressInfo?.name?.trim() ||
                                    formatAddress(payment?.recipient)}
                                </Typography>
                              ) : (
                                <Tooltip
                                  onOpen={() =>
                                    scheduleFetchNameForAddress(
                                      payment?.recipient
                                    )
                                  }
                                  onClose={cancelFetchNameForAddress}
                                  title={(() => {
                                    const entry =
                                      addressNamesMap[payment?.recipient];
                                    if (!entry || entry.loading)
                                      return (
                                        <Box
                                          sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            py: 1,
                                            minWidth: 48,
                                          }}
                                        >
                                          <CircularProgress
                                            size={24}
                                            sx={{
                                              color: theme.palette.primary.main,
                                            }}
                                          />
                                        </Box>
                                      );
                                    if (entry.name)
                                      return (
                                        <Typography
                                          variant="body1"
                                          sx={{
                                            fontSize: '1.0625rem',
                                            fontWeight: 600,
                                          }}
                                        >
                                          {entry.name}
                                        </Typography>
                                      );
                                    return (
                                      <Typography
                                        variant="body2"
                                        sx={{
                                          fontFamily: 'monospace',
                                          fontSize: '0.9375rem',
                                          wordBreak: 'break-all',
                                        }}
                                      >
                                        {payment?.recipient ?? ''}
                                      </Typography>
                                    );
                                  })()}
                                  placement="top"
                                  arrow
                                  slotProps={{
                                    tooltip: {
                                      sx: {
                                        color: theme.palette.text.primary,
                                        backgroundColor:
                                          theme.palette.background.paper,
                                        border: 1,
                                        borderColor: 'divider',
                                        borderRadius: 2,
                                        boxShadow: theme.shadows[4],
                                        padding: '12px 16px',
                                        maxWidth: 360,
                                      },
                                    },
                                    arrow: {
                                      sx: {
                                        color: theme.palette.background.paper,
                                      },
                                    },
                                  }}
                                >
                                  <ButtonBase
                                    onClick={() =>
                                      handleAddressClick(payment?.recipient)
                                    }
                                    sx={{ textAlign: 'left' }}
                                  >
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        fontFamily: 'monospace',
                                        color: theme.palette.primary.light,
                                        fontWeight: 500,
                                        '&:hover': {
                                          textDecoration: 'underline',
                                          opacity: 0.95,
                                        },
                                      }}
                                    >
                                      {formatAddress(payment?.recipient)}
                                    </Typography>
                                  </ButtonBase>
                                </Tooltip>
                              )}
                            </TableCell>
                            <TableCell>{payment?.amount} QORT</TableCell>
                            <TableCell>
                              {formatTimestamp(payment?.timestamp)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <TablePagination
                    component="div"
                    count={totalPaymentsCount}
                    page={paymentsPage}
                    onPageChange={(_, p) => setPaymentsPage(p)}
                    rowsPerPage={paymentsRowsPerPage}
                    onRowsPerPageChange={(e) => {
                      setPaymentsRowsPerPage(parseInt(e.target.value, 10));
                      setPaymentsPage(0);
                    }}
                    rowsPerPageOptions={[5, 10, 25, 50]}
                    labelDisplayedRows={({ from, to, count }) =>
                      t('core:pagination_of', {
                        from: count === 0 ? 0 : from,
                        to: to,
                        total: count,
                      })
                    }
                    labelRowsPerPage={t('core:items_per_page', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    sx={{
                      borderTop: 1,
                      borderColor: alpha(theme.palette.divider, 0.4),
                      '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows':
                        { fontSize: '0.875rem' },
                    }}
                  />
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
