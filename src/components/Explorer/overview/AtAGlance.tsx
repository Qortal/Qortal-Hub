/**
 * The Overview's facts, each on a tile: its level and how far it is to the
 * next (with Hub's Minting window maths), blocks minted, balance, when it
 * was first seen, how many groups it is in, and the QORT it received and
 * sent in its newest payments (User search's figures, now saying what
 * they cover). Each fact loads, fails and retries on its own.
 */
import { type ReactNode } from 'react';
import { Box, LinearProgress, Tooltip, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';
import {
  formatCount,
  formatDay,
  formatQort,
  formatQortExact,
} from '../../../lib/explorer/format';
import {
  balanceRead,
  nodeTimingRead,
  RECENT_PAYMENTS_LIMIT,
  type AccountInfo,
  type BlockAt,
  type GroupOf,
  type RecentPayments,
} from '../../../lib/explorer/reads';
import {
  countedBlocks,
  levelProgressOf,
  paymentTotals,
} from '../../../lib/explorer/rules';
import { useExplorerRead, type ReadState } from '../ExplorerContext';
import {
  cap,
  LoadingLine,
  mutedText,
  ReadError,
  Section,
  tileSx,
} from '../parts';

function Fact({
  label,
  value,
  detail,
  info,
  wide = false,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  /** What the figure covers, on hover and focus of an (i) beside the label. */
  info?: string;
  wide?: boolean;
}) {
  return (
    <Box
      sx={(theme) => ({
        ...tileSx(theme),
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        ...(wide ? { gridColumn: '1 / -1' } : {}),
      })}
    >
      <Typography
        component="dt"
        variant="body2"
        sx={(theme) => ({
          alignItems: 'center',
          color: mutedText(theme),
          display: 'flex',
          gap: 0.5,
        })}
      >
        {label}
        {info ? (
          <Tooltip title={info}>
            <Box
              component="span"
              tabIndex={0}
              role="img"
              aria-label={info}
              sx={{
                display: 'inline-flex',
                '&:focus-visible': { outline: '2px solid' },
              }}
            >
              <InfoOutlinedIcon sx={{ fontSize: 15 }} />
            </Box>
          </Tooltip>
        ) : null}
      </Typography>
      <Typography
        component="dd"
        sx={{
          fontSize: '1.1rem',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 700,
          m: 0,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </Typography>
      {detail ? (
        <Typography
          component="dd"
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme), m: 0 })}
        >
          {detail}
        </Typography>
      ) : null}
    </Box>
  );
}

/** A fact whose read failed: what couldn't load, and Retry, across the row. */
function FactError({
  label,
  message,
  read,
}: {
  label: string;
  message: string;
  read: ReadState<unknown>;
}) {
  return (
    <Fact
      wide
      label={label}
      value={<ReadError message={message} onRetry={read.retry} />}
    />
  );
}

function LevelFact({ account }: { account: AccountInfo }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  // The blocks and days to the next level need the node's height and pace.
  const timing = useExplorerRead(nodeTimingRead());
  const progress = levelProgressOf(account, timing.data ?? null);
  const label = t('core:level', cap);
  if (progress.next === null)
    return (
      <Fact
        label={label}
        value={account.level}
        detail={t('explorer:facts.top_level', cap)}
      />
    );
  const percent = Math.round(progress.fraction * 100);
  return (
    <Fact
      label={label}
      value={account.level}
      detail={
        <Box
          component="span"
          sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}
        >
          <LinearProgress
            variant="determinate"
            value={percent}
            aria-label={t('explorer:facts.level_progress', {
              level: progress.next,
              percent,
              ...cap,
            })}
            sx={{ borderRadius: 4, height: 6 }}
          />
          {timing.status === 'error' ? (
            <ReadError
              message={t('explorer:facts.pace_failed', cap)}
              onRetry={timing.retry}
            />
          ) : timing.data === undefined ? (
            <LoadingLine label={t('core:loading.generic', cap)} />
          ) : null}
          {progress.blocksToNext !== null ? (
            <span>
              {t('explorer:facts.blocks_to_level', {
                count: progress.blocksToNext,
                blocks: formatCount(progress.blocksToNext, i18n.language),
                level: progress.next,
                ...cap,
              })}
            </span>
          ) : null}
          {progress.days !== null ? (
            <span>
              {t('explorer:facts.days_to_level', {
                count: Math.round(progress.days),
                ...cap,
              })}
            </span>
          ) : null}
        </Box>
      }
    />
  );
}

function signed(value: number, language: string): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${formatCount(Math.abs(value), language)}`;
}

function BlocksFact({ account }: { account: AccountInfo }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const details = [
    account.blocksMintedAdjustment
      ? t('explorer:facts.adjustment', {
          blocks: signed(account.blocksMintedAdjustment, language),
          ...cap,
        })
      : null,
    account.blocksMintedPenalty
      ? t('explorer:facts.penalty', {
          blocks: signed(account.blocksMintedPenalty, language),
          ...cap,
        })
      : null,
  ].filter(Boolean);
  return (
    <Fact
      label={t('core:total_blocks_minted', cap)}
      value={formatCount(countedBlocks(account), language)}
      detail={details.length ? details.join(' · ') : null}
    />
  );
}

function BalanceFact({ address }: { address: string }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const balance = useExplorerRead(balanceRead(address));
  const label = t('explorer:facts.balance', cap);
  if (balance.status === 'error')
    return (
      <FactError
        label={label}
        message={t('explorer:facts.balance_failed', cap)}
        read={balance}
      />
    );
  if (balance.data === undefined)
    return (
      <Fact
        label={label}
        value={<LoadingLine label={t('core:loading.generic', cap)} />}
      />
    );
  const short = formatQort(balance.data, i18n.language);
  const exact = formatQortExact(balance.data, i18n.language);
  return (
    <Fact
      label={label}
      value={`${short} QORT`}
      detail={
        short !== exact
          ? t('explorer:facts.balance_exact', { amount: exact, ...cap })
          : null
      }
    />
  );
}

function FirstSeenFact({ read }: { read: ReadState<BlockAt | null> }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const label = t('explorer:facts.first_seen', cap);
  if (read.status === 'error')
    return (
      <FactError
        label={label}
        message={t('explorer:facts.first_seen_failed', cap)}
        read={read}
      />
    );
  if (read.data === undefined)
    return (
      <Fact
        label={label}
        value={<LoadingLine label={t('core:loading.generic', cap)} />}
      />
    );
  const seen = read.data;
  if (!seen)
    return (
      <Fact label={label} value={t('explorer:facts.first_seen_none', cap)} />
    );
  return (
    <Fact
      label={label}
      value={formatDay(seen.timestamp, i18n.language)}
      detail={t('explorer:facts.at_block', {
        block: formatCount(seen.height, i18n.language),
        ...cap,
      })}
    />
  );
}

function GroupsFact({ read }: { read: ReadState<GroupOf[]> }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const label = t('explorer:facts.groups', cap);
  if (read.status === 'error')
    return (
      <FactError
        label={label}
        message={t('explorer:groups.failed', cap)}
        read={read}
      />
    );
  if (!read.data)
    return (
      <Fact
        label={label}
        value={<LoadingLine label={t('core:loading.generic', cap)} />}
      />
    );
  const count = read.data.length;
  return (
    <Fact
      label={label}
      value={
        count === 0
          ? t('explorer:facts.in_no_groups', cap)
          : t('explorer:facts.in_groups', {
              count,
              groups: formatCount(count, i18n.language),
              ...cap,
            })
      }
    />
  );
}

function PaymentsFact({
  address,
  read,
}: {
  address: string;
  read: ReadState<RecentPayments>;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const label = t('explorer:facts.received_sent', cap);
  if (read.status === 'error')
    return (
      <FactError
        label={label}
        message={t('explorer:payments.failed', cap)}
        read={read}
      />
    );
  if (!read.data)
    return (
      <Fact
        label={label}
        value={<LoadingLine label={t('core:loading.generic', cap)} />}
      />
    );
  const { received, sent } = paymentTotals(read.data.rows, address);
  const count = read.data.rows.length;
  return (
    <Fact
      label={label}
      info={t('explorer:facts.received_sent_info', cap)}
      value={
        <>
          <Box
            component="span"
            sx={(theme) => ({ color: theme.palette.other.positive })}
          >
            {formatQort(received, i18n.language)}
          </Box>
          {' / '}
          <Box
            component="span"
            sx={(theme) => ({ color: theme.palette.other.danger })}
          >
            {formatQort(sent, i18n.language)}
          </Box>
          {' QORT'}
        </>
      }
      detail={
        count === 0
          ? t('explorer:facts.payments_none', cap)
          : count === 1
            ? t('explorer:facts.payments_single', cap)
            : read.data.full
              ? t('explorer:facts.payments_newest', {
                  count: RECENT_PAYMENTS_LIMIT,
                  payments: formatCount(RECENT_PAYMENTS_LIMIT, i18n.language),
                  ...cap,
                })
              : t('explorer:facts.payments_all', {
                  count,
                  payments: formatCount(count, i18n.language),
                  ...cap,
                })
      }
    />
  );
}

export function AtAGlance({
  account,
  firstSeen,
  groups,
  payments,
}: {
  account: AccountInfo;
  firstSeen: ReadState<BlockAt | null>;
  groups: ReadState<GroupOf[]>;
  payments: ReadState<RecentPayments>;
}) {
  const { t } = useTranslation(['explorer']);
  return (
    <Section id="explorer-facts" title={t('explorer:facts.title', cap)}>
      <Box sx={{ containerType: 'inline-size' }}>
        <Box
          component="dl"
          sx={{
            display: 'grid',
            gap: 1,
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            m: 0,
            '@container (min-width: 720px)': {
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            },
            '@container (max-width: 380px)': {
              gridTemplateColumns: 'minmax(0, 1fr)',
            },
          }}
        >
          <LevelFact account={account} />
          <BlocksFact account={account} />
          <BalanceFact address={account.address} />
          <FirstSeenFact read={firstSeen} />
          <GroupsFact read={groups} />
          <PaymentsFact address={account.address} read={payments} />
        </Box>
      </Box>
    </Section>
  );
}
