/**
 * An account's transactions: the kind and type picked (TxFilterBar), what
 * it sent that waits for a block (when it has a public key: an AT has
 * none), then its confirmed transactions, newest first, 100 at a time with
 * "Show more", up to 1,000 of each kind. Show more first shows the next
 * 100 of the rows already read (the Overview may have read many for its
 * QORT figures and Activity), and reads 100 more from the node only once
 * every row read is on screen. The line under the list says how much of it
 * is on screen, and when the Explorer stopped reading. When the Overview
 * read more of all of them, the tab lists the newest 1,000 of those, and
 * says so.
 *
 * What is picked, and how many of each kind are shown, belong to the
 * history step (useStepState), so Back and switching tabs show the tab as
 * it was left. Each row opens to its details, its raw API answer, and
 * links on to the accounts involved and the transaction's own page.
 * Read-only.
 */
import { useMemo } from 'react';
import { Box, Button, Typography } from '@mui/material';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  ACCOUNT_TX_MAX,
  atCeiling,
  canReadMore,
  listedPart,
  moreShown,
  shownCount,
  type ShownRows,
} from '../../../lib/explorer/accountTx';
import { formatCount } from '../../../lib/explorer/format';
import {
  ALL_TRANSACTIONS,
  cleanFilter,
  isFiltered,
  typesToAsk,
  type TxFilter,
} from '../../../lib/explorer/txFamilies';
import { useStepState } from '../ExplorerContext';
import {
  cap,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
  Section,
} from '../parts';
import { typeTitle } from './sentenceText';
import { TxFilterBar } from './TxFilterBar';
import { TxList } from './TxListRow';
import { useAccountTxList, type AccountTxListState } from './useAccountTxList';
import { WaitingSection } from './WaitingSection';

/** How much of the list is on screen, always with what it covers. */
function coverageLine(
  t: TFunction,
  language: string,
  shown: number,
  done: boolean,
  filtered: boolean
): string {
  const n = formatCount(shown, language);
  const kind = filtered ? '_kind' : '';
  if (done && shown === 1)
    return String(t(`explorer:transactions.only${kind}`, cap));
  if (done)
    return String(
      t(`explorer:transactions.all${kind}`, { count: shown, shown: n, ...cap })
    );
  return String(
    t(`explorer:transactions.newest${kind}`, { count: shown, shown: n, ...cap })
  );
}

function ConfirmedList({
  address,
  filter,
  state,
  shown,
  onShown,
}: {
  address: string;
  filter: TxFilter;
  state: AccountTxListState;
  /** How many rows are shown (none yet: the first 100). */
  shown: ShownRows | undefined;
  onShown: (next: ShownRows) => void;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const { list, error, retry, more, showMore } = state;
  // At most the newest 1,000: the Overview may have read more of all of them.
  const listed = list ? listedPart(list) : null;
  // 100 at a time, of the rows read.
  const visible = listed ? shownCount(listed.rows, shown) : 0;
  const allShown = Boolean(listed) && visible === listed.rows.length;
  const canShowMore = Boolean(list) && (!allShown || canReadMore(list));
  /** The next 100 rows read, or, once all are shown, 100 more from the node. */
  const onShowMore = () => {
    if (!list || !listed) return;
    const { next, read } = moreShown(listed.rows, shown);
    if (read && !canReadMore(list)) return;
    onShown(next);
    if (read) showMore();
  };
  const filtered = isFiltered(filter);
  const title = filter.type
    ? typeTitle(filter.type, t, true)
    : t(
        filter.kind === 'all'
          ? 'explorer:transactions.title_all'
          : `explorer:tx_family.${filter.kind}`,
        cap
      );

  let body;
  if (!list && error)
    body = (
      <ReadError
        message={t('explorer:transactions.failed', cap)}
        onRetry={retry}
      />
    );
  else if (!list) body = <LoadingLine label={t('core:loading.generic', cap)} />;
  else
    body = (
      <>
        {/* A Refresh that failed: the rows read so far stay, and Retry reads the newest again onto them. */}
        {error ? (
          <Box sx={{ mb: 1 }}>
            <ReadError
              message={t('explorer:transactions.refresh_failed', cap)}
              onRetry={retry}
            />
          </Box>
        ) : null}
        {!list.rows.length ? (
          <Typography variant="body2" role="status">
            {filtered
              ? t('explorer:transactions.none_kind', cap)
              : t('explorer:transactions.none', cap)}
          </Typography>
        ) : (
          <>
            <TxList
              rows={listed.rows.slice(0, visible)}
              viewpoint={address}
              label={title}
            />
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1,
                justifyContent: 'space-between',
                mt: 1,
              }}
            >
              <Typography
                role="status"
                variant="body2"
                sx={(theme) => ({
                  color: mutedText(theme),
                  flex: '1 1 240px',
                })}
              >
                {coverageLine(
                  t,
                  i18n.language,
                  visible,
                  listed.all && allShown,
                  filtered
                )}
                {listed.beyond
                  ? ` ${t('explorer:transactions.listed_cap', {
                      count: list.rows.length,
                      max: formatCount(ACCOUNT_TX_MAX, i18n.language),
                      shown: formatCount(list.rows.length, i18n.language),
                    })}`
                  : atCeiling(list) && allShown
                    ? ` ${t('explorer:transactions.ceiling', {
                        max: formatCount(ACCOUNT_TX_MAX, i18n.language),
                      })}`
                    : null}
              </Typography>
              {canShowMore && !more.error ? (
                <Button
                  size="small"
                  variant="outlined"
                  disabled={more.loading}
                  onClick={onShowMore}
                >
                  {more.loading
                    ? t('core:loading.generic', cap)
                    : t('explorer:transactions.show_more', cap)}
                </Button>
              ) : null}
            </Box>
            {more.error ? (
              <Box sx={{ mt: 1 }}>
                <ReadError
                  message={t('explorer:transactions.more_failed', cap)}
                  onRetry={onShowMore}
                />
              </Box>
            ) : null}
          </>
        )}
      </>
    );

  return (
    <Section id="explorer-transactions" title={title}>
      <Box sx={panelSx}>{body}</Box>
    </Section>
  );
}

export function TransactionsTab({
  address,
  publicKey,
}: {
  address: string;
  /** Known once it has sent a transaction; an AT has none. */
  publicKey: string | null;
}) {
  const [kept, setFilter] = useStepState<TxFilter>(
    'txFilter',
    ALL_TRANSACTIONS
  );
  const filter = cleanFilter(kept);
  const types = typesToAsk(filter);
  const state = useAccountTxList(address, types);
  // How many of each kind's list are shown, kept with the step like the kind picked.
  const listKey = types.join(',') || 'all';
  const [shownByList, setShownByList] = useStepState<
    Readonly<Record<string, ShownRows>>
  >('txShown', {});
  // One confirmed since the waiting list was read shows only among the confirmed.
  const confirmed = useMemo(
    () => new Set((state.list?.rows ?? []).map((row) => row.signature)),
    [state.list]
  );
  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, minWidth: 0 }}
    >
      <TxFilterBar filter={filter} onChange={setFilter} />
      {publicKey ? (
        <WaitingSection
          address={address}
          publicKey={publicKey}
          filter={filter}
          confirmed={confirmed}
        />
      ) : null}
      <ConfirmedList
        address={address}
        filter={filter}
        state={state}
        shown={shownByList[listKey]}
        onShown={(next) => setShownByList({ ...shownByList, [listKey]: next })}
      />
    </Box>
  );
}
