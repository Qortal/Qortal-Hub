/**
 * QORT minted, QORT purchased / sold and QORT received / sent over its
 * whole history (from Q-Mintership+'s qortSummaries.tsx), for a viewer who
 * sees the detailed parts (lib/explorer/access.ts; nothing of them is read
 * for anyone else). Each has an (i) that says how it was worked out.
 *
 * - Received / sent and minted add up its whole history: the Overview's
 *   All list (useAccountHistory), which reads on by itself up to the first
 *   read (the Activity settings, 1,000 by default). A longer history waits
 *   for "Read the rest", and the line under the facts says how far it read.
 *   A partial history never gives a figure.
 * - Minted is then its exact balance less what its transactions moved,
 *   with its asset orders' QORT (lib/explorer/qortBook.ts). The balance is
 *   only ever set against the transactions read up to it: it is read
 *   between two reads of the node's newest transaction (qortReads.ts
 *   `balanceAtRead`), and counts only when both are the newest one the list
 *   holds. Otherwise the newest page is read again (and the balance with
 *   it); when its transactions keep changing, it says so, with Retry. After
 *   a Refresh whose newest page failed it works nothing out: it says so,
 *   with Retry. An account that never minted (no blocks minted, no reward
 *   share ever) says so, with nothing to work out.
 * - Its asset orders are read two at a time; a closed one never changes,
 *   and is kept for the window's life, so Refresh reads only open ones.
 * - Purchased / sold are its completed trades on the Trade Portal. An
 *   account without a public key never made a transaction, so it never
 *   sold (a sale starts with a trade contract of its own); what it bought is
 *   what other accounts' trade contracts paid it, from its whole history.
 * - Each loads, fails (with Retry) and works out on its own; while a
 *   Refresh reads again, what was shown stays. In green what came in, in
 *   red what went out.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Box, Button, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ACCOUNT_HISTORY_MAX } from '../../../lib/explorer/accountTx';
import {
  formatAmountExact,
  formatCount,
  formatList,
  formatQort,
} from '../../../lib/explorer/format';
import {
  movedParts,
  neverMinted,
  qortBook,
  qortMinted,
  type QortBook,
} from '../../../lib/explorer/qortBook';
import {
  balanceAtRead,
  balanceMatches,
  balanceRead,
  closedOrderKey,
  firstShareRead,
  ORDER_TRADES_MAX,
  orderQortRead,
  portalTradesRead,
  type OrderQort,
  type PortalTrades,
} from '../../../lib/explorer/qortReads';
import type { AccountInfo } from '../../../lib/explorer/reads';
import { fromAtomic } from '../../../lib/explorer/txWords';
import {
  useExplorer,
  useExplorerRead,
  useExplorerReads,
  type ReadState,
} from '../ExplorerContext';
import { cap, LoadingLine, mutedText } from '../parts';
import { Fact, FactError, FactWords } from './Fact';
import type { AccountHistory } from './useAccountHistory';

/** Where its whole history stands. */
export type HistoryState =
  | 'whole'
  | 'reading'
  | 'waiting'
  | 'ceiling'
  | 'failed';

type Minted =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'never' }
  | { kind: 'history' }
  | {
      kind: 'failed';
      what: 'share' | 'balance' | 'orders' | 'newest';
      retry: () => void;
    }
  | { kind: 'changing'; retry: () => void }
  | { kind: 'orders_too_long' }
  | { kind: 'orders_too_many'; count: number }
  | { kind: 'unknown'; balance: bigint; book: QortBook; orders: bigint }
  | {
      kind: 'value';
      atomic: bigint;
      balance: bigint;
      book: QortBook;
      orders: bigint;
    };

export interface QortFigures {
  /** It is read: a viewer who sees the detailed parts, once At a glance nears the screen. */
  enabled: boolean;
  history: AccountHistory;
  historyState: HistoryState;
  /** Read the newest page, or the older one, that failed. */
  retryHistory: () => void;
  /** What its whole history moved, once it is read. */
  book: QortBook | null;
  /** Rows in its whole history. */
  count: number;
  minted: Minted;
  trades: ReadState<PortalTrades>;
  /** It has no public key: it never made a transaction of its own, so it never sold. */
  noKey: boolean;
}

function historyStateOf(history: AccountHistory): HistoryState {
  if (history.whole) return 'whole';
  if (!history.list) return history.error ? 'failed' : 'reading';
  if (history.more.error) return 'failed';
  if (history.atCeiling) return 'ceiling';
  return history.reading ? 'reading' : 'waiting';
}

const FINAL = new Set<Minted['kind']>([
  'never',
  'value',
  'unknown',
  'orders_too_long',
  'orders_too_many',
]);

/**
 * The most asset orders worked out for QORT minted: each takes two reads
 * or more (the order and its trades), two at a time.
 */
export const ORDERS_MAX = 500;

/** Asset orders read at a time. */
const ORDER_READS_AT_ONCE = 2;

/**
 * How many times in a row its balance is read again by itself when it
 * doesn't go with the transactions held (one came in meanwhile), before it
 * says so and waits for Retry.
 */
const MATCH_TRIES = 3;

export function useQortFigures(
  account: AccountInfo,
  history: AccountHistory,
  enabled: boolean
): QortFigures {
  const { cache } = useExplorer();
  const { address, publicKey } = account;
  const noBlocks =
    account.blocksMinted === 0 && !account.blocksMintedAdjustment;
  // Whether it ever had a reward share: an account that moved its level away has 0 blocks again.
  const share = useExplorerRead(
    enabled && noBlocks ? firstShareRead(address) : null
  );
  const never =
    noBlocks &&
    neverMinted(account, share.status === 'ready' ? share.data : undefined);
  const rows = history.whole ? history.list?.rows : undefined;
  const book = useMemo(
    () => (enabled && rows ? qortBook(rows, address) : null),
    [enabled, rows, address]
  );
  const tooManyOrders = (book?.orders.length ?? 0) > ORDERS_MAX;
  const wantsMinted =
    enabled && Boolean(book) && !never && share.status !== 'error';

  // Its balance as of the newest transaction held: not while its newest
  // transactions are read again, nor after that failed.
  const newest = rows?.[0]?.signature ?? null;
  const settled = wantsMinted && !history.refreshing && !history.error;
  const at = useExplorerRead(settled ? balanceAtRead(address, newest) : null);
  const atData = at.status === 'ready' ? at.data : undefined;
  const matches = Boolean(atData && balanceMatches(atData, newest));
  const mismatch = Boolean(atData) && !matches;
  const tries = useRef({ address, count: 0 });
  if (tries.current.address !== address) tries.current = { address, count: 0 };
  const { retry: retryNewest } = history;
  const { retry: retryAt } = at;
  useEffect(() => {
    if (matches) tries.current.count = 0;
    if (!mismatch || !atData || tries.current.count >= MATCH_TRIES) return;
    tries.current.count += 1;
    // The node has a newer transaction than the list: its newest page again
    // (the balance follows, by the list's new newest row). One came in
    // while the balance was read: the balance again.
    if (atData.before === atData.after) retryNewest();
    else retryAt();
  }, [matches, mismatch, atData, retryNewest, retryAt]);
  // The Balance fact shows the newest balance read too.
  useEffect(() => {
    if (!matches || !atData) return;
    const spec = balanceRead(address);
    if (cache.peek(spec.key) !== atData.balance)
      cache.put(spec.key, atData.balance, { ttlMs: spec.ttlMs });
  }, [matches, atData, cache, address]);

  // Its asset orders: a closed one was kept for the window's life, the rest are read.
  const orderIds = useMemo(
    () => (wantsMinted && book && !tooManyOrders ? book.orders : []),
    [wantsMinted, book, tooManyOrders]
  );
  const toRead = orderIds
    .filter((id) => cache.peek<OrderQort>(closedOrderKey(id)) === undefined)
    .join('\n');
  const orderSpecs = useMemo(
    () =>
      toRead
        ? toRead.split('\n').map((id) => orderQortRead(id, address))
        : null,
    [toRead, address]
  );
  const orders = useExplorerReads<OrderQort>(orderSpecs, {
    concurrency: ORDER_READS_AT_ONCE,
  });
  useEffect(() => {
    for (const id of orderIds) {
      const read = orders.data.get(orderQortRead(id, address).key);
      if (read?.closed && cache.peek(closedOrderKey(id)) === undefined)
        cache.put(closedOrderKey(id), read, {
          ttlMs: Number.POSITIVE_INFINITY,
        });
    }
  }, [orderIds, orders.data, cache, address]);
  const trades = useExplorerRead(
    enabled && publicKey ? portalTradesRead(address, publicKey) : null
  );

  let minted: Minted;
  if (!enabled) minted = { kind: 'idle' };
  else if (noBlocks && share.status === 'error')
    minted = { kind: 'failed', what: 'share', retry: share.retry };
  else if (noBlocks && share.status !== 'ready') minted = { kind: 'loading' };
  else if (never) minted = { kind: 'never' };
  else if (!book) minted = { kind: 'history' };
  else if (tooManyOrders)
    minted = { kind: 'orders_too_many', count: book.orders.length };
  else if (history.error)
    // Its newest transactions couldn't be read again: nothing to set its balance against.
    minted = { kind: 'failed', what: 'newest', retry: history.retry };
  else if (at.status === 'error')
    minted = { kind: 'failed', what: 'balance', retry: at.retry };
  else if (orders.failed.length)
    minted = { kind: 'failed', what: 'orders', retry: orders.retry };
  else if (mismatch && tries.current.count >= MATCH_TRIES)
    minted = {
      kind: 'changing',
      retry: () => {
        tries.current.count = 0;
        at.retry();
      },
    };
  else if (!atData || !matches || orders.loading || history.refreshing)
    // While its newest transactions or its balance are read (again), the
    // two wouldn't add up: it waits for both.
    minted = { kind: 'loading' };
  else {
    const nets = book.orders.map(
      (id) =>
        (
          cache.peek<OrderQort>(closedOrderKey(id)) ??
          orders.data.get(orderQortRead(id, address).key)
        )?.net
    );
    if (nets.some((net) => net === null)) minted = { kind: 'orders_too_long' };
    else {
      const net = nets.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n);
      const balance = atData.balance.atomic;
      const value = qortMinted(balance, book, net);
      minted =
        value < 0n
          ? { kind: 'unknown', balance, book, orders: net }
          : { kind: 'value', atomic: value, balance, book, orders: net };
    }
  }
  // What was worked out stays while a Refresh reads again.
  const last = useRef<{ address: string; minted: Minted } | null>(null);
  if (FINAL.has(minted.kind)) last.current = { address, minted };
  else if (minted.kind === 'loading' && last.current?.address === address)
    minted = last.current.minted;

  const historyState = historyStateOf(history);
  return {
    enabled,
    history,
    historyState,
    retryHistory: !history.list ? history.retry : history.retryMore,
    book,
    count: rows?.length ?? 0,
    minted,
    trades,
    noKey: !publicKey,
  };
}

// ---- On screen ---------------------------------------------------------------------------

const qortText = (atomic: bigint, language: string) =>
  formatQort(Number(fromAtomic(atomic)), language);

const exactText = (atomic: bigint, language: string) =>
  formatAmountExact(fromAtomic(atomic), language);

function InOut({
  into,
  out,
  language,
}: {
  into: bigint;
  out: bigint;
  language: string;
}) {
  return (
    <>
      <Box
        component="span"
        sx={(theme) => ({ color: theme.palette.other.positive })}
      >
        {qortText(into, language)}
      </Box>
      {' / '}
      <Box
        component="span"
        sx={(theme) => ({ color: theme.palette.other.danger })}
      >
        {qortText(out, language)}
      </Box>
      {' QORT'}
    </>
  );
}

/** "received 4,200, sent 3 and fees 0.01": what its transactions moved. */
function movedText(
  book: QortBook,
  orders: bigint,
  t: TFunction,
  language: string
): string {
  const parts = movedParts(book, orders).map(({ part, atomic }) =>
    String(
      t(`explorer:facts.moved.${part}`, {
        amount: exactText(atomic, language),
      })
    )
  );
  return parts.length
    ? formatList(parts, language)
    : String(t('explorer:facts.moved.nothing'));
}

/** A whole-history figure's place while its history isn't all read: how it stands. */
function HistoryValue({
  label,
  figures,
}: {
  label: string;
  figures: QortFigures;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  switch (figures.historyState) {
    case 'failed':
      return (
        <FactError
          label={label}
          message={t('explorer:facts.history_failed', cap)}
          onRetry={figures.retryHistory}
        />
      );
    case 'ceiling':
      return (
        <Fact
          label={label}
          value={
            <FactWords>{t('explorer:facts.cant_work_out', cap)}</FactWords>
          }
          info={t('explorer:facts.history_too_long', {
            max: formatCount(ACCOUNT_HISTORY_MAX, i18n.language),
            ...cap,
          })}
        />
      );
    case 'waiting':
      return (
        <Fact
          label={label}
          value={
            <FactWords>{t('explorer:facts.needs_history', cap)}</FactWords>
          }
        />
      );
    default:
      return (
        <Fact
          label={label}
          value={
            <LoadingLine
              label={t('explorer:facts.history_reading_short', cap)}
            />
          }
        />
      );
  }
}

/** QORT received / sent over its whole history, in the place of its newest payments' figure. */
export function QortFlowsFact({ figures }: { figures: QortFigures }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const label = t('explorer:facts.received_sent', cap);
  if (!figures.enabled)
    return (
      <Fact
        label={label}
        value={<LoadingLine label={t('core:loading.generic', cap)} />}
      />
    );
  if (!figures.book) return <HistoryValue label={label} figures={figures} />;
  const { received, sent } = figures.book;
  const count = figures.count;
  return (
    <Fact
      label={label}
      info={t('explorer:facts.flows_info', {
        received: exactText(received, language),
        sent: exactText(sent, language),
        ...cap,
      })}
      value={<InOut into={received} out={sent} language={language} />}
      detail={
        count === 0
          ? t('explorer:facts.flows_none', cap)
          : count === 1
            ? t('explorer:facts.flows_single', cap)
            : t('explorer:facts.flows_all', {
                count,
                shown: formatCount(count, language),
                ...cap,
              })
      }
    />
  );
}

/** QORT minted: its balance less what its whole history moved. */
export function QortMintedFact({ figures }: { figures: QortFigures }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const label = t('explorer:facts.minted', cap);
  const { minted } = figures;
  switch (minted.kind) {
    case 'never':
      return (
        <Fact
          label={label}
          value={<FactWords>{t('explorer:facts.never_minted', cap)}</FactWords>}
          info={t('explorer:facts.never_minted_info', cap)}
        />
      );
    case 'history':
      return <HistoryValue label={label} figures={figures} />;
    case 'failed':
      return (
        <FactError
          label={label}
          message={t(
            minted.what === 'share'
              ? 'explorer:facts.share_failed'
              : minted.what === 'balance'
                ? 'explorer:facts.balance_failed'
                : minted.what === 'newest'
                  ? 'explorer:facts.newest_failed'
                  : 'explorer:facts.orders_failed',
            cap
          )}
          onRetry={minted.retry}
        />
      );
    case 'changing':
      return (
        <FactError
          label={label}
          message={t('explorer:facts.minted_changing', cap)}
          onRetry={minted.retry}
        />
      );
    case 'orders_too_long':
      return (
        <Fact
          label={label}
          value={
            <FactWords>{t('explorer:facts.cant_work_out', cap)}</FactWords>
          }
          info={t('explorer:facts.orders_too_long', {
            max: formatCount(ORDER_TRADES_MAX, language),
            ...cap,
          })}
        />
      );
    case 'orders_too_many':
      return (
        <Fact
          label={label}
          value={
            <FactWords>{t('explorer:facts.cant_work_out', cap)}</FactWords>
          }
          info={t('explorer:facts.orders_too_many', {
            count: minted.count,
            shown: formatCount(minted.count, language),
            max: formatCount(ORDERS_MAX, language),
            ...cap,
          })}
        />
      );
    case 'unknown':
      return (
        <Fact
          label={label}
          value={
            <FactWords>{t('explorer:facts.cant_work_out', cap)}</FactWords>
          }
          info={t('explorer:facts.minted_unknown_info', {
            balance: exactText(minted.balance, language),
            moved: movedText(minted.book, minted.orders, t, language),
            ...cap,
          })}
        />
      );
    case 'value':
      return (
        <Fact
          label={label}
          value={`${qortText(minted.atomic, language)} QORT`}
          info={t('explorer:facts.minted_info', {
            exact: exactText(minted.atomic, language),
            balance: exactText(minted.balance, language),
            moved: movedText(minted.book, minted.orders, t, language),
            ...cap,
          })}
        />
      );
    default:
      return (
        <Fact
          label={label}
          value={<LoadingLine label={t('core:loading.generic', cap)} />}
        />
      );
  }
}

/**
 * QORT purchased / sold: its completed trades on the Trade Portal; for an
 * account without a public key, what other accounts' trade contracts paid
 * it, from its whole history (it never sold).
 */
export function QortTradesFact({ figures }: { figures: QortFigures }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const label = t('explorer:facts.purchased_sold', cap);
  if (figures.enabled && figures.noKey) {
    if (!figures.book) return <HistoryValue label={label} figures={figures} />;
    const bought = figures.book.purchased;
    return (
      <Fact
        label={label}
        value={<InOut into={bought} out={0n} language={language} />}
        info={t('explorer:facts.trades_no_key_info', {
          bought: exactText(bought, language),
          ...cap,
        })}
      />
    );
  }
  const { trades } = figures;
  if (trades.status === 'error')
    return (
      <FactError
        label={label}
        message={t('explorer:facts.trades_failed', cap)}
        onRetry={trades.retry}
      />
    );
  if (!trades.data)
    return (
      <Fact
        label={label}
        value={<LoadingLine label={t('core:loading.generic', cap)} />}
      />
    );
  return (
    <Fact
      label={label}
      info={t('explorer:facts.trades_info', {
        bought: exactText(trades.data.bought, language),
        sold: exactText(trades.data.sold, language),
        ...cap,
      })}
      value={
        <InOut
          into={trades.data.bought}
          out={trades.data.sold}
          language={language}
        />
      }
    />
  );
}

/**
 * Under the facts, while its whole history isn't read: how far it read,
 * and Read the rest; or that it reads on; or that it is longer than the
 * Explorer reads.
 */
export function HistoryNotice({ figures }: { figures: QortFigures }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const { history, historyState } = figures;
  if (!figures.enabled) return null;
  const held = history.list?.rows.length ?? 0;
  const line = (role: 'status' | 'note', text: string, action?: ReactNode) => (
    <Box
      role={role}
      sx={(theme) => ({
        alignItems: 'center',
        borderLeft: `3px solid ${theme.palette.info.main}`,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        mt: 1,
        pl: 1.25,
        py: 0.5,
      })}
    >
      <InfoOutlinedIcon
        aria-hidden
        sx={(theme) => ({ color: theme.palette.info.main, fontSize: 18 })}
      />
      <Typography
        variant="body2"
        sx={(theme) => ({
          color: mutedText(theme),
          flex: '1 1 260px',
          minWidth: 0,
        })}
      >
        {text}
      </Typography>
      {action}
    </Box>
  );
  if (historyState === 'reading' && held)
    return line(
      'status',
      t('explorer:facts.history_reading', {
        count: held,
        shown: formatCount(held, language),
        ...cap,
      })
    );
  if (historyState === 'waiting')
    return line(
      'note',
      t('explorer:facts.history_waiting', {
        count: held,
        shown: formatCount(held, language),
        ...cap,
      }),
      <Button size="small" variant="outlined" onClick={history.readAll}>
        {t('explorer:facts.read_rest', cap)}
      </Button>
    );
  if (historyState === 'ceiling')
    return line(
      'note',
      t('explorer:facts.history_ceiling', {
        max: formatCount(ACCOUNT_HISTORY_MAX, language),
        ...cap,
      })
    );
  return null;
}
