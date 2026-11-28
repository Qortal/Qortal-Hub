/**
 * The accounts whose first QORT payment came from this one (from
 * Q-Mintership+'s FundedPage), for a viewer the level 5+ rule lets in.
 *
 * - Its QORT payments sent, oldest first, 100 a read
 *   (`/transactions/payments/between?senderAddress=…`), up to 1,000: the
 *   first 100 at once, then "Read later payments" page by page. A full
 *   page never changes (new payments only come after the last one).
 * - The accounts it paid in them, in the order of its first payment to
 *   each (AT addresses left out and counted).
 * - For each, its earliest QORT payment received (one row): when that came
 *   from this account, it made their first QORT payment. 50 are checked
 *   at once, 4 at a time, then 50 more per "Check 50 more"; the line says
 *   how many were checked of how many, and a check that failed is said,
 *   with Retry, never counted as "not its first payment".
 *
 * An account's first QORT payment here is the earliest PAYMENT it
 * received: asset transfers, multi-payments and AT payouts aren't counted,
 * and the page says so. Read-only; nothing polls.
 */
import { useMemo } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  FUNDED_PAGES,
  firstReceivedRead,
  fundedPageRead,
  type FirstReceived,
  type FundedPage as Page,
} from '../../../lib/explorer/compareReads';
import {
  formatAmountExact,
  formatCount,
  formatDay,
} from '../../../lib/explorer/format';
import {
  firstPaidBy,
  fundedRead,
  paidAccounts,
} from '../../../lib/explorer/sets';
import { PersonButton, useAccountLabel } from '../connections/ConnectionRow';
import { useExplorerReads, useStepState } from '../ExplorerContext';
import { ExplorerTrail } from '../ExplorerTrail';
import {
  cap,
  isolate,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
  Section,
} from '../parts';

/** Accounts checked at once, and per "Check more". */
export const FUNDED_BATCH = 50;
/** Rows shown before "Show more". */
const ROWS = 20;

export function FundedPage({
  address,
  trail,
}: {
  address: string;
  trail: string[];
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const { label } = useAccountLabel(address, true);
  const [storedPages, setPages] = useStepState<number>('fundedPages', 1);
  const pageCount = Math.min(
    Math.max(1, Number(storedPages) || 1),
    FUNDED_PAGES
  );
  const pageSpecs = useMemo(
    () =>
      Array.from({ length: pageCount }, (_, page) =>
        fundedPageRead(address, page)
      ),
    [address, pageCount]
  );
  // A Refresh that couldn't read its payments again keeps the ones read, with Retry.
  const pages = useExplorerReads<Page | null>(pageSpecs, {
    concurrency: 1,
    keep: true,
  });

  // The pages in order, as far as each one before it was read (and full).
  const read = useMemo(
    () => fundedRead(pageSpecs.map((spec) => pages.data.get(spec.key))),
    [pageSpecs, pages.data]
  );
  const failedPage = pages.failed.length > 0;
  const { paid, atLeftOut } = useMemo(
    () => paidAccounts(read.rows, address),
    [read.rows, address]
  );

  const [storedChecked, setChecked] = useStepState<number>(
    'fundedChecked',
    FUNDED_BATCH
  );
  const asked = Math.min(Math.max(0, Number(storedChecked) || 0), paid.length);
  const checkSpecs = useMemo(
    () => paid.slice(0, asked).map((each) => firstReceivedRead(each.address)),
    [paid, asked]
  );
  const checks = useExplorerReads<FirstReceived | null>(checkSpecs, {
    concurrency: 4,
  });
  const answers = useMemo(() => {
    const map = new Map<string, FirstReceived | null>();
    for (const each of paid.slice(0, asked)) {
      const key = firstReceivedRead(each.address).key;
      if (checks.data.has(key))
        map.set(each.address, checks.data.get(key) ?? null);
    }
    return map;
  }, [paid, asked, checks.data]);
  const first = firstPaidBy(paid, answers, address);
  const checked = answers.size;
  const [shown, setShown] = useStepState<number>('fundedShown', ROWS);

  const counted = (key: string, count: number, extra = {}) =>
    t(key, { count, shown: formatCount(count, language), ...extra, ...cap });
  /** A part of a sentence: not capitalized. */
  const part = (key: string, count: number) =>
    t(key, { count, shown: formatCount(count, language) });

  const reading = read.through < pageCount && !failedPage && !read.unsupported;
  const coverage =
    read.through > 0
      ? t('explorer:connections.coverage.read', {
          list: read.complete
            ? read.rows.length === 1
              ? t('explorer:funded.read_single')
              : part('explorer:funded.read_all', read.rows.length)
            : read.beyond
              ? part('explorer:funded.read_ceiling', read.rows.length)
              : part('explorer:funded.read_first', read.rows.length),
          ...cap,
        })
      : null;
  const canReadLater =
    !read.complete &&
    !read.unsupported &&
    !failedPage &&
    !reading &&
    read.through === pageCount &&
    pageCount < FUNDED_PAGES;

  let body;
  if (read.unsupported)
    body = (
      <Typography role="status">
        {t('explorer:funded.unsupported', cap)}
      </Typography>
    );
  else if (read.through === 0 && failedPage)
    body = (
      <ReadError
        message={t('explorer:payments.failed', cap)}
        onRetry={pages.retry}
      />
    );
  else if (read.through === 0)
    body = <LoadingLine label={t('explorer:funded.loading', cap)} />;
  else if (!paid.length && read.complete)
    body = (
      <Typography role="status">{t('explorer:funded.none', cap)}</Typography>
    );
  else
    body = (
      <>
        <Typography
          role="status"
          sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
        >
          {paid.length
            ? counted('explorer:funded.paid', paid.length)
            : t('explorer:funded.none_so_far', cap)}{' '}
          {paid.length && checked === paid.length
            ? counted('explorer:funded.result_all', first.length)
            : paid.length && checked
              ? counted('explorer:funded.result_some', first.length, {
                  checked: formatCount(checked, language),
                })
              : null}
        </Typography>
        {checks.loading ? (
          <Typography variant="body2">
            {t('explorer:funded.checking', {
              done: formatCount(checked + checks.failed.length, language),
              total: formatCount(asked, language),
              ...cap,
            })}
          </Typography>
        ) : null}
        {checks.failed.length ? (
          <ReadError
            message={counted(
              'explorer:funded.check_failed',
              checks.failed.length
            )}
            onRetry={checks.retry}
          />
        ) : null}
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:funded.note', cap)}
          {atLeftOut ? ` ${counted('explorer:funded.ats', atLeftOut)}` : null}
        </Typography>
        {asked < paid.length && !checks.loading ? (
          <Button
            size="small"
            variant="outlined"
            onClick={() => setChecked(asked + FUNDED_BATCH)}
            sx={{ alignSelf: 'flex-start' }}
          >
            {counted(
              'explorer:funded.check_more',
              Math.min(FUNDED_BATCH, paid.length - asked)
            )}
          </Button>
        ) : null}
        {first.length ? (
          <Section
            id="explorer-funded-list"
            title={t('explorer:funded.list_title', cap)}
          >
            <Box
              component="ul"
              aria-label={t('explorer:funded.title', {
                name: label,
                ...cap,
              })}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                listStyle: 'none',
                m: 0,
                p: 0,
              }}
            >
              {first.slice(0, shown).map((each) => (
                <Box
                  component="li"
                  key={each.address}
                  sx={(theme) => ({
                    backgroundColor: theme.palette.background.elevated,
                    borderRadius: '12px',
                    minWidth: 0,
                    px: 1.5,
                    py: 1,
                  })}
                >
                  <PersonButton
                    address={each.address}
                    near
                    secondary={t('explorer:funded.row', {
                      amount: formatAmountExact(each.amount, language),
                      date: formatDay(each.timestamp, language),
                      block: formatCount(each.height, language),
                    })}
                  />
                </Box>
              ))}
            </Box>
            {first.length > shown ? (
              <Button
                size="small"
                onClick={() => setShown(shown + ROWS)}
                sx={{ alignSelf: 'flex-start' }}
              >
                {counted(
                  'explorer:connections.payments.show_more',
                  Math.min(ROWS, first.length - shown)
                )}
              </Button>
            ) : null}
          </Section>
        ) : null}
      </>
    );

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, minWidth: 0 }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography
          component="h2"
          sx={{
            fontSize: { xs: '1.15rem', sm: '1.3rem' },
            fontWeight: 700,
            lineHeight: 1.25,
            overflowWrap: 'anywhere',
          }}
        >
          {t('explorer:funded.title', { name: isolate(label), ...cap })}
        </Typography>
        <ExplorerTrail trail={trail} />
      </Box>
      <Box
        sx={(theme) => ({
          ...panelSx(theme),
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        })}
      >
        {body}
        {coverage ? (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
            }}
          >
            <Typography
              variant="body2"
              sx={(theme) => ({ color: mutedText(theme), flex: '1 1 280px' })}
            >
              {coverage}
            </Typography>
            {canReadLater ? (
              <Button
                size="small"
                variant="outlined"
                onClick={() => setPages(pageCount + 1)}
              >
                {t('explorer:funded.read_later', cap)}
              </Button>
            ) : null}
            {reading ? (
              <LoadingLine label={t('explorer:funded.loading', cap)} />
            ) : null}
          </Box>
        ) : null}
        {read.through > 0 && failedPage ? (
          <ReadError
            message={t('explorer:payments.failed', cap)}
            onRetry={pages.retry}
          />
        ) : null}
      </Box>
    </Box>
  );
}
