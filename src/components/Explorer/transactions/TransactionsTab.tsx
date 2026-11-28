/**
 * An account's transactions: the kind and type picked (TxFilterBar), what
 * it sent that waits for a block (when it has a public key: an AT has
 * none), then its confirmed transactions, newest first, read 100 at a time
 * with "Show more" up to 1,000 of each kind. The line under the list says
 * how much of it is on screen, and when the Explorer stopped reading.
 *
 * What is picked belongs to the history step (useStepState), so Back
 * shows the tab as it was left. Each row opens to its details, its raw API
 * answer, and links on to the accounts involved and the transaction's own
 * page. Read-only.
 */
import { useMemo } from 'react';
import { Box, Button, Typography } from '@mui/material';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  ACCOUNT_TX_MAX,
  atCeiling,
  canReadMore,
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
}: {
  address: string;
  filter: TxFilter;
  state: AccountTxListState;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const { list, error, retry, more, showMore } = state;
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
            <TxList rows={list.rows} viewpoint={address} label={title} />
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
                  list.rows.length,
                  list.done,
                  filtered
                )}
                {atCeiling(list)
                  ? ` ${t('explorer:transactions.ceiling', {
                      max: formatCount(ACCOUNT_TX_MAX, i18n.language),
                    })}`
                  : null}
              </Typography>
              {canReadMore(list) && !more.error ? (
                <Button
                  size="small"
                  variant="outlined"
                  disabled={more.loading}
                  onClick={showMore}
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
                  onRetry={showMore}
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
  const state = useAccountTxList(address, typesToAsk(filter));
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
      <ConfirmedList address={address} filter={filter} state={state} />
    </Box>
  );
}
