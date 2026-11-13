import {
  Box,
  ButtonBase,
  CircularProgress,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import NorthEastRoundedIcon from '@mui/icons-material/NorthEastRounded';
import SouthWestRoundedIcon from '@mui/icons-material/SouthWestRounded';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import type { WalletActivityEntry } from './types';
import { formatWalletActivityAmount } from './utils';
import {
  WALLET_HISTORY_PAGE_SIZE,
  formatWalletHistoryDate,
  shortWalletAddress,
  walletEntryFromTransaction,
  walletHistoryUrl,
} from './walletHistory';

type HistoryState = {
  entries: WalletActivityEntry[];
  /** Payments read so far (the next page starts here). */
  offset: number;
  hasMore: boolean;
  status: 'idle' | 'loading' | 'done' | 'error';
};

const EMPTY_HISTORY: HistoryState = {
  entries: [],
  offset: 0,
  hasMore: false,
  status: 'idle',
};

type Props = {
  /** The list's id, which the toggle names in aria-controls. */
  id: string;
  userAddress?: string;
  /** Changes when the balance does: a new payment may have arrived. */
  refreshKey: string | number | null | undefined;
  resolveLabel: (address: string) => Promise<string>;
  onOpenCounterparty: (address: string) => void;
  open: boolean;
};

/**
 * Wallet Activity's history: the account's payments, newest first, a page at
 * a time, shown in place of the latest payment. Loaded the first time it
 * opens, and again from the top when the balance changes while loaded. It
 * stays mounted while closed, so opening it again doesn't reload it.
 */
export const WalletActivityHistory = ({
  id,
  userAddress,
  refreshKey,
  resolveLabel,
  onOpenCounterparty,
  open,
}: Props) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['group']);
  const td = useCallback((key: string) => t(`group:dashboard.${key}`), [t]);
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const requestRef = useRef(0);
  const historyRef = useRef(history);
  historyRef.current = history;

  const load = useCallback(
    async (fromStart: boolean) => {
      if (!userAddress) return;
      const request = ++requestRef.current;
      const offset = fromStart ? 0 : historyRef.current.offset;
      setHistory((current) => ({ ...current, status: 'loading' }));
      try {
        const response = await fetch(
          walletHistoryUrl(getBaseApiReact(), userAddress, offset)
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const page = Array.isArray(data) ? data : [];
        const found = page
          .map((transaction) =>
            walletEntryFromTransaction(transaction, userAddress)
          )
          .filter(Boolean);
        const addresses = [
          ...new Set(found.map((entry) => entry.counterpartyAddress)),
        ];
        const labels = new Map(
          await Promise.all(
            addresses.map(
              async (address) => [address, await resolveLabel(address)] as const
            )
          )
        );
        if (request !== requestRef.current) return;
        const entries = found.map((entry) => ({
          ...entry,
          counterpartyLabel: labels.get(entry.counterpartyAddress) || '',
        }));
        setHistory((current) => {
          const before = fromStart ? [] : current.entries;
          const seen = new Set(before.map((entry) => entry.signature));
          return {
            entries: [
              ...before,
              ...entries.filter(
                (entry) => !entry.signature || !seen.has(entry.signature)
              ),
            ],
            offset: offset + page.length,
            hasMore: page.length === WALLET_HISTORY_PAGE_SIZE,
            status: 'done',
          };
        });
      } catch (error) {
        console.error('Failed to load the wallet history:', error);
        if (request !== requestRef.current) return;
        setHistory((current) => ({ ...current, status: 'error' }));
      }
    },
    [resolveLabel, userAddress]
  );

  // Another account: its own history, from scratch.
  useEffect(() => {
    requestRef.current += 1;
    setHistory(EMPTY_HISTORY);
  }, [userAddress]);

  useEffect(() => {
    if (open && historyRef.current.status === 'idle') void load(true);
  }, [load, open]);

  // A new payment moved the balance: the first page again, in place.
  const lastRefreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (lastRefreshKeyRef.current === refreshKey) return;
    lastRefreshKeyRef.current = refreshKey;
    if (historyRef.current.status === 'idle') return;
    const timer = window.setTimeout(() => void load(true), 650);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  const secondary = alpha(theme.palette.text.primary, 0.6);
  const incomingColor = theme.palette.success.main;
  const rows = history.entries;
  const now = Date.now();

  return (
    <Box
      id={id}
      sx={{ display: open ? 'flex' : 'none', flexDirection: 'column' }}
    >
      {open ? (
        <>
          {rows.map((entry, index) => {
            const incoming = entry.direction === 'incoming';
            const color = incoming ? incomingColor : theme.palette.text.primary;
            const name =
              entry.counterpartyLabel &&
              entry.counterpartyLabel !== entry.counterpartyAddress
                ? entry.counterpartyLabel
                : shortWalletAddress(entry.counterpartyAddress);
            return (
              <Box
                key={entry.signature ?? `${entry.timestamp}-${index}`}
                sx={{
                  alignItems: 'center',
                  borderTop:
                    index > 0
                      ? `1px solid ${alpha(theme.palette.text.primary, 0.07)}`
                      : 'none',
                  display: 'flex',
                  gap: 1.2,
                  minWidth: 0,
                  py: 1,
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    backgroundColor: alpha(
                      incoming ? incomingColor : theme.palette.text.primary,
                      incoming ? 0.14 : 0.07
                    ),
                    borderRadius: '50%',
                    color: incoming ? incomingColor : secondary,
                    display: 'flex',
                    flexShrink: 0,
                    height: 30,
                    justifyContent: 'center',
                    width: 30,
                  }}
                >
                  {incoming ? (
                    <SouthWestRoundedIcon sx={{ fontSize: 15 }} />
                  ) : (
                    <NorthEastRoundedIcon sx={{ fontSize: 15 }} />
                  )}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <ButtonBase
                    onClick={() =>
                      onOpenCounterparty(entry.counterpartyAddress)
                    }
                    sx={{
                      borderRadius: '6px',
                      color: theme.palette.text.primary,
                      display: 'block',
                      fontSize: '0.84rem',
                      fontWeight: 600,
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textAlign: 'left',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        color: theme.palette.primary.light,
                        textDecoration: 'underline',
                        textUnderlineOffset: '2px',
                      },
                    }}
                  >
                    {name}
                  </ButtonBase>
                  <Typography
                    sx={{ color: secondary, fontSize: '0.72rem', mt: 0.2 }}
                  >
                    {incoming
                      ? td('wallet_history_received')
                      : td('wallet_history_sent')}
                    {' · '}
                    {formatWalletHistoryDate(
                      entry.timestamp,
                      i18n.language,
                      now
                    )}
                  </Typography>
                </Box>
                <Typography
                  sx={{
                    color,
                    flexShrink: 0,
                    fontSize: '0.86rem',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatWalletActivityAmount(entry.amount, entry.direction)}
                </Typography>
              </Box>
            );
          })}

          {history.status === 'loading' ? (
            <Box
              sx={{
                alignItems: 'center',
                color: secondary,
                display: 'flex',
                gap: 1,
                justifyContent: 'center',
                py: 1.2,
              }}
            >
              <CircularProgress color="inherit" size={14} thickness={5} />
              <Typography sx={{ fontSize: '0.76rem' }}>
                {td('wallet_history_loading')}
              </Typography>
            </Box>
          ) : null}

          {history.status === 'error' ? (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 1,
                justifyContent: 'space-between',
                py: 1,
              }}
            >
              <Typography sx={{ color: secondary, fontSize: '0.76rem' }}>
                {td('wallet_history_error')}
              </Typography>
              <ButtonBase
                onClick={() => void load(history.entries.length === 0)}
                sx={{
                  borderRadius: '8px',
                  color: theme.palette.primary.light,
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  px: 0.75,
                  py: 0.5,
                }}
              >
                {td('wallet_history_retry')}
              </ButtonBase>
            </Box>
          ) : null}

          {history.status === 'done' && rows.length === 0 ? (
            <Typography sx={{ color: secondary, fontSize: '0.78rem', py: 1 }}>
              {td('wallet_history_empty')}
            </Typography>
          ) : null}

          {history.status === 'done' && history.hasMore ? (
            <ButtonBase
              onClick={() => void load(false)}
              sx={{
                alignSelf: 'center',
                borderRadius: '10px',
                color: theme.palette.primary.light,
                fontSize: '0.78rem',
                fontWeight: 600,
                mt: 0.5,
                px: 1.5,
                py: 0.75,
              }}
            >
              {td('wallet_history_load_more')}
            </ButtonBase>
          ) : null}
        </>
      ) : null}
    </Box>
  );
};

type ToggleProps = {
  /** The id of the list it shows. */
  controls: string;
  open: boolean;
  onToggle: () => void;
};

/**
 * The small "History" button in Wallet Activity's label row. It takes no
 * room of its own, so the card's fixed height in the wide layout still fits.
 */
export const WalletActivityHistoryToggle = ({
  controls,
  open,
  onToggle,
}: ToggleProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  return (
    <ButtonBase
      aria-controls={controls}
      aria-expanded={open}
      aria-label={t('group:dashboard.wallet_history')}
      onClick={onToggle}
      sx={{
        alignItems: 'center',
        borderRadius: '6px',
        color: theme.palette.primary.light,
        display: 'inline-flex',
        flexShrink: 0,
        fontSize: '0.7rem',
        fontWeight: 600,
        gap: 0.25,
        lineHeight: 1.2,
        my: -0.25,
        pl: 0.75,
        pr: 0.25,
        py: 0.25,
        '&:hover': {
          backgroundColor: alpha(theme.palette.primary.light, 0.1),
        },
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.light}`,
          outlineOffset: '1px',
        },
      }}
    >
      {t('group:dashboard.wallet_history_show')}
      <ExpandMoreRoundedIcon
        sx={{
          fontSize: 16,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 220ms ease',
        }}
      />
    </ButtonBase>
  );
};
