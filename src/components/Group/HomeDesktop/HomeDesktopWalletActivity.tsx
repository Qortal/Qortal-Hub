import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SouthWestRoundedIcon from '@mui/icons-material/SouthWestRounded';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import { alpha } from '@mui/material/styles';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useAtomValue } from 'jotai';
import { balanceAtom, userInfoAtom } from '../../../atoms/global';
import { getBaseApiReact } from '../../../App';
import { executeEvent } from '../../../utils/events';
import { useTranslation } from 'react-i18next';
import { DashboardUtilityPanel } from './DashboardUtilityPanel';
import { WalletActionButton } from './WalletActionButton';
import { WALLET_ACTIVITY_RECENT_PAYMENT_FETCH_LIMIT } from './homeDesktopConstants';
import type {
  WalletActivityEntry,
  WalletActivityTransaction,
} from './types';
import {
  formatWalletActivityAmount,
  formatWalletActivityRelativeTime,
  getWalletActivityCreatorAddress,
  getWalletActivityRecipientAddress,
  isWalletActivityTimestampRecent,
} from './utils';

const HOME_RIGHT_RAIL_DATA_ATTR = '[data-home-right-rail]';

function getRightRailRectFromElement(element: HTMLElement | null) {
  if (!element) return null;
  const rail = element.closest(HOME_RIGHT_RAIL_DATA_ATTR);
  if (!rail) return null;
  return rail.getBoundingClientRect();
}

export const HomeDesktopWalletActivity = () => {
  const theme = useTheme();
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const userAddress = userInfo?.address;
  const { t } = useTranslation(['core', 'group', 'tutorial', 'auth']);
  const td = useCallback(
    (key: string, defaultValue: string) =>
      t(`group:dashboard.${key}`, { defaultValue }),
    [t]
  );

  const walletActivityNameCacheRef = useRef<Record<string, string>>({});
  const lastWalletActivityBalanceRef = useRef<string | null>(null);
  const [recentWalletActivity, setRecentWalletActivity] =
    useState<WalletActivityEntry | null>(null);
  const [isWalletActivityLoading, setIsWalletActivityLoading] = useState(false);
  const [walletActivityRelativeTimeNow, setWalletActivityRelativeTimeNow] =
    useState(() => Date.now());

  const walletActivitySecondaryTextColor = alpha(
    theme.palette.text.primary,
    0.6
  );

  const handleOpenReceiveQort = useCallback((target: HTMLElement | null) => {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const rightRailRect = getRightRailRectFromElement(target);
    executeEvent('openReceiveQortInternal', {
      address: userAddress ?? '',
      anchorRect: {
        height: rect.height,
        left: rect.left,
        top: rect.top,
        width: rect.width,
      },
      targetRect: rightRailRect
        ? {
            height: rightRailRect.height,
            left: rightRailRect.left,
            top: rightRailRect.top,
            width: rightRailRect.width,
          }
        : null,
    });
  }, [userAddress]);

  const handleOpenWalletActivityCounterparty = useCallback(
    (address: string) => {
      if (!address) return;
      executeEvent('openUserLookupDrawer', {
        addressOrName: address,
      });
    },
    []
  );

  const resolveWalletActivityAddressLabel = useCallback(
    async (address: string) => {
      if (!address) return 'Unknown address';

      const cachedSenderName = walletActivityNameCacheRef.current[address];
      if (cachedSenderName !== undefined) {
        return cachedSenderName || address;
      }

      try {
        const response = await fetch(
          `${getBaseApiReact()}/names/primary/${address}`
        );
        const responseData = await response.json();
        const senderName =
          response.ok && responseData?.name ? responseData.name : '';
        walletActivityNameCacheRef.current[address] = senderName || '';
        return senderName || address;
      } catch (error) {
        console.error(
          'Failed to resolve wallet activity participant name:',
          error
        );
        walletActivityNameCacheRef.current[address] = '';
        return address;
      }
    },
    []
  );

  const fetchWalletActivityTransactionBySignature = useCallback(
    async (signature?: string) => {
      if (!signature) return null;

      try {
        const response = await fetch(
          `${getBaseApiReact()}/transactions/signature/${encodeURIComponent(signature)}`
        );

        if (!response.ok) return null;

        const responseData = await response.json();
        return responseData && typeof responseData === 'object'
          ? (responseData as WalletActivityTransaction)
          : null;
      } catch (error) {
        console.error(
          'Failed to load wallet activity transaction by signature:',
          error
        );
        return null;
      }
    },
    []
  );

  const buildWalletActivityEntry = useCallback(
    async (transaction: WalletActivityTransaction | null | undefined) => {
      if (!transaction || !userAddress) return null;

      let resolvedTransaction = transaction;
      let creatorAddress = getWalletActivityCreatorAddress(resolvedTransaction);
      let recipientAddress =
        getWalletActivityRecipientAddress(resolvedTransaction);

      if (
        (!creatorAddress || !recipientAddress) &&
        resolvedTransaction.signature
      ) {
        const fullTransaction = await fetchWalletActivityTransactionBySignature(
          resolvedTransaction.signature
        );

        if (fullTransaction) {
          resolvedTransaction = {
            ...resolvedTransaction,
            ...fullTransaction,
            timestamp:
              resolvedTransaction.timestamp ?? fullTransaction.timestamp,
          };
          creatorAddress = getWalletActivityCreatorAddress(resolvedTransaction);
          recipientAddress =
            getWalletActivityRecipientAddress(resolvedTransaction);
        }
      }

      const timestamp = Number(resolvedTransaction.timestamp);
      const amount = Number(resolvedTransaction.amount);
      const isOutgoing = creatorAddress === userAddress;
      const isIncoming = recipientAddress === userAddress;

      if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(amount) ||
        (!isIncoming && !isOutgoing) ||
        !isWalletActivityTimestampRecent(timestamp)
      ) {
        return null;
      }

      const counterpartyAddress = isOutgoing
        ? recipientAddress
        : creatorAddress;

      if (!counterpartyAddress) return null;

      const counterpartyLabel =
        await resolveWalletActivityAddressLabel(counterpartyAddress);

      const direction = isOutgoing ? 'outgoing' : 'incoming';
      return {
        amount,
        counterpartyAddress,
        counterpartyLabel,
        direction,
        timestamp,
      } satisfies WalletActivityEntry;
    },
    [
      fetchWalletActivityTransactionBySignature,
      resolveWalletActivityAddressLabel,
      userAddress,
    ]
  );

  const loadRecentWalletActivity = useCallback(async () => {
    if (!userAddress) {
      setRecentWalletActivity(null);
      setIsWalletActivityLoading(false);
      return;
    }

    setIsWalletActivityLoading(true);

    try {
      const response = await fetch(
        `${getBaseApiReact()}/transactions/search?txType=PAYMENT&address=${userAddress}&confirmationStatus=CONFIRMED&limit=${WALLET_ACTIVITY_RECENT_PAYMENT_FETCH_LIMIT}&reverse=true`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch wallet activity payments');
      }

      const responseData = await response.json();
      const latestRelevantPayment = Array.isArray(responseData)
        ? responseData.find(
            (transaction: WalletActivityTransaction) =>
              (getWalletActivityCreatorAddress(transaction) === userAddress ||
                getWalletActivityRecipientAddress(transaction) ===
                  userAddress) &&
              Number.isFinite(Number(transaction?.timestamp)) &&
              isWalletActivityTimestampRecent(Number(transaction.timestamp))
          )
        : null;

      const recentEntry = await buildWalletActivityEntry(latestRelevantPayment);
      setRecentWalletActivity((currentEntry) => {
        if (!recentEntry) {
          return currentEntry &&
            isWalletActivityTimestampRecent(currentEntry.timestamp)
            ? currentEntry
            : null;
        }

        if (
          currentEntry &&
          isWalletActivityTimestampRecent(currentEntry.timestamp) &&
          currentEntry.timestamp > recentEntry.timestamp
        ) {
          return currentEntry;
        }

        return recentEntry;
      });
    } catch (error) {
      console.error('Failed to load recent wallet activity:', error);
      setRecentWalletActivity((currentEntry) =>
        currentEntry && isWalletActivityTimestampRecent(currentEntry.timestamp)
          ? currentEntry
          : null
      );
    } finally {
      setIsWalletActivityLoading(false);
    }
  }, [buildWalletActivityEntry, userAddress]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setWalletActivityRelativeTimeNow(Date.now());
    }, 60000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    setRecentWalletActivity(null);
    lastWalletActivityBalanceRef.current = null;
  }, [userAddress]);

  useEffect(() => {
    if (!userAddress || balance == null) {
      return;
    }

    const nextBalanceKey = String(balance);
    if (lastWalletActivityBalanceRef.current == null) {
      lastWalletActivityBalanceRef.current = nextBalanceKey;
      return;
    }

    if (lastWalletActivityBalanceRef.current === nextBalanceKey) {
      return;
    }

    lastWalletActivityBalanceRef.current = nextBalanceKey;
    const refreshTimer = window.setTimeout(() => {
      loadRecentWalletActivity();
    }, 650);

    return () => {
      window.clearTimeout(refreshTimer);
    };
  }, [balance, loadRecentWalletActivity, userAddress]);

  useEffect(() => {
    loadRecentWalletActivity();
  }, [loadRecentWalletActivity]);

  return (
    <DashboardUtilityPanel
      title={td('wallet_activity', 'Wallet Activity')}
      theme={theme}
      sx={{
        gap: '12px',
        height: '100%',
        minHeight: '182px',
        padding: '14px 16px 16px',
      }}
    >
      <Box
        sx={{
          borderBottom: `1px solid ${theme.palette.border.subtle}`,
          pb: 1.35,
        }}
      />
      <Box
        sx={{
          display: 'grid',
          gap: '8px',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          pt: 0.5,
        }}
      >
        <WalletActionButton
          icon={<SendRoundedIcon sx={{ fontSize: '16px' }} />}
          label={td('send', 'Send')}
          onClick={(event) => {
            const el = event.currentTarget as HTMLElement;
            const rect = el.getBoundingClientRect();
            const rightRailRect = getRightRailRectFromElement(el);
            executeEvent('openPaymentInternal', {
              anchorRect: {
                height: rect.height,
                left: rect.left,
                top: rect.top,
                width: rect.width,
              },
              targetRect: rightRailRect
                ? {
                    height: rightRailRect.height,
                    left: rightRailRect.left,
                    top: rightRailRect.top,
                    width: rightRailRect.width,
                  }
                : null,
            });
          }}
          theme={theme}
        />
        <WalletActionButton
          icon={<SouthWestRoundedIcon sx={{ fontSize: '16px' }} />}
          label={td('receive', 'Receive')}
          onClick={(event) => {
            handleOpenReceiveQort(event.currentTarget as HTMLElement);
          }}
          theme={theme}
        />
        <WalletActionButton
          icon={<ShoppingBagRoundedIcon sx={{ fontSize: '16px' }} />}
          label={td('buy', 'Buy')}
          onClick={() => {
            executeEvent('addTab', {
              data: { service: 'APP', name: 'q-trade' },
            });
            executeEvent('open-apps-mode', {});
          }}
          theme={theme}
        />
      </Box>
      <Box
        sx={{
          borderTop: `1px solid ${theme.palette.border.subtle}`,
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          gap: '5px',
          mt: 0.35,
          minHeight: 0,
          pt: 2.2,
        }}
      >
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.64rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textAlign: 'left',
            textTransform: 'uppercase',
          }}
        >
          {td('recent_transaction', 'Recent Transaction')}
        </Typography>
        {isWalletActivityLoading ? (
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.82rem',
              lineHeight: 1.45,
            }}
          >
            {td(
              'loading_wallet_activity',
              'Loading recent wallet activity...'
            )}
          </Typography>
        ) : recentWalletActivity ? (
          [recentWalletActivity].map((activityEntry, index) => (
            <Box
              key={`${activityEntry.timestamp}-${index}`}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                minWidth: 0,
                '& + &': {
                  borderTop: `1px solid ${alpha(
                    theme.palette.text.primary,
                    0.08
                  )}`,
                  mt: 0.25,
                  pt: 1.2,
                },
              }}
            >
              <Box
                sx={{
                  alignItems: 'baseline',
                  color: theme.palette.text.primary,
                  display: 'flex',
                  gap: '5px',
                  minWidth: 0,
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatWalletActivityAmount(
                    activityEntry.amount,
                    activityEntry.direction
                  )}
                </Typography>
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: '0.83rem',
                    lineHeight: 1.45,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      color: walletActivitySecondaryTextColor,
                    }}
                  >
                    {activityEntry.direction === 'outgoing'
                      ? td('sent_to', 'sent to ')
                      : td('received_from', 'received from ')}
                  </Box>
                  <ButtonBase
                    component="span"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleOpenWalletActivityCounterparty(
                        activityEntry.counterpartyAddress
                      );
                    }}
                    sx={{
                      borderRadius: '6px',
                      color: theme.palette.text.primary,
                      display: 'inline-flex',
                      font: 'inherit',
                      fontWeight: 600,
                      lineHeight: 'inherit',
                      maxWidth: '100%',
                      minWidth: 0,
                      p: 0,
                      textAlign: 'left',
                      verticalAlign: 'baseline',
                      '&:hover': {
                        color: theme.palette.primary.light,
                        textDecoration: 'underline',
                        textUnderlineOffset: '2px',
                      },
                    }}
                  >
                    {activityEntry.counterpartyLabel}
                  </ButtonBase>
                </Typography>
              </Box>
              <Typography
                sx={{
                  color: walletActivitySecondaryTextColor,
                  fontSize: '0.74rem',
                  lineHeight: 1.4,
                  textAlign: 'left',
                }}
              >
                {formatWalletActivityRelativeTime(
                  activityEntry.timestamp,
                  walletActivityRelativeTimeNow
                )}
              </Typography>
            </Box>
          ))
        ) : (
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.82rem',
              lineHeight: 1.45,
            }}
          >
            {td('no_wallet_activity', 'No new wallet activity.')}
          </Typography>
        )}
        <Box
          sx={{
            mt: 'auto',
            pt: 1.05,
          }}
        >
          <Typography
            sx={{
              color: walletActivitySecondaryTextColor,
              fontSize: '0.68rem',
              lineHeight: 1.45,
              textAlign: 'left',
            }}
          >
            {td(
              'wallet_activity_window',
              'Latest transaction within the past 7 days'
            )}
          </Typography>
        </Box>
      </Box>
    </DashboardUtilityPanel>
  );
};
