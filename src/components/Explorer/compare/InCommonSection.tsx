/**
 * Compare → In common: what two or more of the compared accounts share,
 * each with its denominator: the same first sponsor (and how many accounts
 * it sponsored, to the accounts it sponsored), the same first payer (and
 * how busy a payer it is, to the accounts whose first QORT payment came
 * from it), accounts they paid or were paid by (the direction and the
 * counts; busy payers and AT addresses left out and counted), and groups,
 * smallest first. Raw facts: no threshold decides what is shown, and
 * nothing says what it means. Then what was checked and found nothing
 * (only from reads that reached their end), and a read that failed, with
 * Retry, never counted as nothing found.
 */
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  COMPARE_SAY,
  type Letter,
  type SharedCounterparty,
} from '../../../lib/explorer/compare';
import type { PayerBand } from '../../../lib/explorer/compareReads';
import { sponseesOf } from '../../../lib/explorer/connections';
import { formatCount, formatList } from '../../../lib/explorer/format';
import { visibleName } from '../../../lib/explorer/rules';
import type { TxSentenceSpec, TxSlot } from '../../../lib/explorer/txWords';
import { ROW_LIST_SX } from '../connections/ConnectionRow';
import { isShort } from '../connections/useConnections';
import { cap, LoadingLine, mutedText, ReadError, Section } from '../parts';
import { FundedLink, SponseesLink } from '../sets/SetLinks';
import { TxSentence } from '../transactions/TxSentence';
import { lettersText } from './compareWords';
import {
  COMMON_CHECKS,
  type CommonCheck,
  type CompareData,
  type SharedSponsor,
} from './useCompareData';

const SUBHEAD_SX = {
  fontSize: '0.95rem',
  fontWeight: 700,
  lineHeight: 1.3,
  m: 0,
} as const;

const ROW_SX = (theme: Parameters<typeof mutedText>[0]) => ({
  backgroundColor: theme.palette.background.elevated,
  borderRadius: '12px',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 0.5,
  minWidth: 0,
  px: 1.5,
  py: 1.25,
});

const say = (key: string, slots: Record<string, TxSlot>): TxSentenceSpec => ({
  base: COMPARE_SAY,
  key,
  slots,
});

const account = (address: string): TxSlot => ({ kind: 'account', address });

/** "Both …", "All 3 …", or "A and C …": which of the sentence's three forms, and its slots. */
function whoSentence(
  base: string,
  letters: readonly Letter[],
  total: number,
  language: string,
  slots: Record<string, TxSlot>
): TxSentenceSpec {
  if (letters.length === total && total === 2)
    return say(`${base}.both`, slots);
  if (letters.length === total)
    return say(`${base}.all`, {
      ...slots,
      accounts: { kind: 'number', value: total },
    });
  return say(`${base}.some`, {
    ...slots,
    letters: { kind: 'text', text: lettersText(letters, language) },
  });
}

/** The relation between the compared accounts and one they share. */
function counterpartySentence(
  row: SharedCounterparty,
  total: number,
  language: string
): TxSentenceSpec {
  const other = account(row.address);
  const { relation } = row;
  switch (relation.kind) {
    case 'through':
      return say('common.through', {
        from: { kind: 'text', text: relation.from },
        other,
        to: { kind: 'text', text: relation.to },
      });
    case 'bothPaid':
      return whoSentence('common.paid', relation.letters, total, language, {
        other,
      });
    case 'paidBoth':
      return whoSentence('common.paid_by', relation.letters, total, language, {
        other,
      });
  }
}

function SponsorRow({ same, total }: { same: SharedSponsor; total: number }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const list = same.list;
  const count =
    list?.list !== undefined
      ? sponseesOf(list.list.rows, same.sponsor).length
      : null;
  const more = list ? isShort(list) : false;
  return (
    <Box component="li" sx={ROW_SX}>
      <Typography component="div" sx={{ overflowWrap: 'anywhere' }}>
        <TxSentence
          sentence={whoSentence(
            'common.sponsor',
            same.letters,
            total,
            language,
            { sponsor: account(same.sponsor) }
          )}
        />
      </Typography>
      {count !== null ? (
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t(
            more
              ? 'explorer:compare.common.sponsor_count_more'
              : 'explorer:compare.common.sponsor_count',
            {
              count,
              shown: formatCount(count, language),
              ...cap,
            }
          )}
        </Typography>
      ) : list?.error ? (
        <ReadError
          message={t('explorer:connections.failed.sponsor_list', cap)}
          onRetry={list.retry}
        />
      ) : (
        <LoadingLine label={t('explorer:compare.common.reading', cap)} />
      )}
      <SponseesLink sponsor={same.sponsor} />
    </Box>
  );
}

function FirstPayerRow({
  from,
  letters,
  heights,
  band,
  total,
}: {
  from: string;
  letters: Letter[];
  heights: number[];
  band: PayerBand | null | undefined;
  total: number;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  return (
    <Box component="li" sx={ROW_SX}>
      <Typography component="div" sx={{ overflowWrap: 'anywhere' }}>
        <TxSentence
          sentence={whoSentence(
            'common.first_payer',
            letters,
            total,
            language,
            {
              from: account(from),
            }
          )}
        />
      </Typography>
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {t('explorer:compare.common.blocks', {
          list: formatList(
            heights.map((height) => formatCount(height, language)),
            language
          ),
        })}
        {band
          ? ` · ${t('explorer:compare.common.band', {
              band: formatCount(band, language),
            })}`
          : null}
      </Typography>
      <FundedLink payer={from} />
    </Box>
  );
}

function CounterpartyRow({
  row,
  total,
  band,
}: {
  row: SharedCounterparty;
  total: number;
  band: PayerBand | null | undefined;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const payments = (count: number) =>
    String(
      t('explorer:compare.common.payments', {
        count,
        shown: formatCount(count, language),
      })
    );
  const counts = row.counts.map((count) =>
    String(
      count.sent && count.received
        ? t('explorer:compare.common.count_both', {
            letter: count.letter,
            sent: payments(count.sent),
            received: payments(count.received),
          })
        : count.sent
          ? t('explorer:compare.common.count_sent', {
              letter: count.letter,
              payments: payments(count.sent),
            })
          : t('explorer:compare.common.count_received', {
              letter: count.letter,
              payments: payments(count.received),
            })
    )
  );
  return (
    <Box component="li" sx={ROW_SX}>
      <Typography component="div" sx={{ overflowWrap: 'anywhere' }}>
        <TxSentence sentence={counterpartySentence(row, total, language)} />
      </Typography>
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {counts.join(' · ')}
        {band
          ? ` · ${t('explorer:compare.common.band', {
              band: formatCount(band, language),
            })}`
          : null}
      </Typography>
    </Box>
  );
}

/** A check in words. */
const CHECK_KEYS: Readonly<Record<CommonCheck, string>> = {
  sponsor: 'explorer:compare.common.check.sponsor',
  first_payer: 'explorer:compare.common.check.first_payer',
  counterparties: 'explorer:compare.common.check.counterparties',
  groups: 'explorer:compare.common.check.groups',
};

export function InCommonSection({ data }: { data: CompareData }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const total = data.live.length;
  const { counterparties, groupsShared, commonChecks } = data;

  const words = (checks: readonly CommonCheck[]) =>
    formatList(
      checks.map((check) => String(t(CHECK_KEYS[check]))),
      language
    );
  const by = (state: string) =>
    COMMON_CHECKS.filter((check) => commonChecks[check] === state);
  const none = by('none');
  const soFar = by('none_so_far');
  const reading = by('reading');

  const failedReads = data.live.filter(
    (side) =>
      (side.funding.status === 'error' && side.funding.data === undefined) ||
      (side.groups.status === 'error' && side.groups.data === undefined) ||
      side.coverage.payments === 'failed' ||
      side.coverage.minting === 'failed'
  );
  const failed = failedReads.length > 0;
  const retry = () => {
    for (const side of failedReads) {
      if (side.funding.status === 'error') side.funding.retry();
      if (side.groups.status === 'error') side.groups.retry();
      if (side.conn.failed.length) side.conn.retryFailed();
    }
  };

  const leftOut = [
    counterparties.atLeftOut
      ? String(
          t('explorer:compare.common.left_ats', {
            count: counterparties.atLeftOut,
            shown: formatCount(counterparties.atLeftOut, language),
          })
        )
      : null,
    counterparties.busyLeftOut
      ? String(
          t('explorer:compare.common.left_busy', {
            count: counterparties.busyLeftOut,
            shown: formatCount(counterparties.busyLeftOut, language),
          })
        )
      : null,
  ].filter((part): part is string => part !== null);

  return (
    <Section
      id="explorer-compare-common"
      title={t('explorer:compare.common.title', cap)}
    >
      {data.sponsors.length || data.firstPayers.length ? (
        <Box
          component="ul"
          aria-label={t('explorer:compare.common.firsts', cap)}
          sx={ROW_LIST_SX}
        >
          {data.sponsors.map((same) => (
            <SponsorRow
              key={`sponsor:${same.sponsor}`}
              same={same}
              total={total}
            />
          ))}
          {data.firstPayers.map((same) => (
            <FirstPayerRow
              key={`first:${same.from}`}
              from={same.from}
              letters={same.accounts.map((each) => each.letter)}
              heights={same.accounts.map((each) => each.height)}
              band={data.bands[same.from]}
              total={total}
            />
          ))}
        </Box>
      ) : null}

      {counterparties.rows.length || leftOut.length ? (
        <Box
          sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}
        >
          <Typography component="h4" sx={SUBHEAD_SX}>
            {t('explorer:compare.common.counterparties', cap)}
          </Typography>
          {counterparties.rows.length ? (
            <Box
              component="ul"
              aria-label={t('explorer:compare.common.counterparties', cap)}
              sx={ROW_LIST_SX}
            >
              {counterparties.rows.map((row) => (
                <CounterpartyRow
                  key={row.address}
                  row={row}
                  total={total}
                  band={data.bands[row.address]}
                />
              ))}
            </Box>
          ) : null}
          {leftOut.length ? (
            <Typography
              variant="body2"
              sx={(theme) => ({ color: mutedText(theme) })}
            >
              {t('explorer:compare.common.left_out', {
                list: formatList(leftOut, language),
                ...cap,
              })}
            </Typography>
          ) : null}
          <Typography
            variant="body2"
            sx={(theme) => ({ color: mutedText(theme) })}
          >
            {t('explorer:compare.common.payments_note', cap)}
          </Typography>
        </Box>
      ) : null}
      {data.bandReads.failed.length ? (
        <ReadError
          message={t('explorer:compare.common.bands_failed', cap)}
          onRetry={data.bandReads.retry}
        />
      ) : null}

      {groupsShared.length ? (
        <Box
          sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}
        >
          <Typography component="h4" sx={SUBHEAD_SX}>
            {t('explorer:compare.common.groups', cap)}
          </Typography>
          <Box
            component="ul"
            aria-label={t('explorer:compare.common.groups', cap)}
            sx={{ ...ROW_LIST_SX, gap: 0.5 }}
          >
            {groupsShared.map((group) => (
              <Typography
                component="li"
                key={group.groupId}
                sx={{ overflowWrap: 'anywhere' }}
              >
                <Box component="bdi" dir="auto" sx={{ fontWeight: 600 }}>
                  {group.groupName
                    ? visibleName(group.groupName)
                    : t('explorer:groups.unnamed', {
                        id: group.groupId,
                        ...cap,
                      })}
                </Box>
                {group.memberCount !== null ? (
                  <Box
                    component="span"
                    sx={(theme) => ({ color: mutedText(theme) })}
                  >
                    {' · '}
                    {t('explorer:groups.members', {
                      count: group.memberCount,
                      members: formatCount(group.memberCount, language),
                    })}
                  </Box>
                ) : null}
                <Box
                  component="span"
                  sx={(theme) => ({ color: mutedText(theme) })}
                >
                  {' · '}
                  {lettersText(group.letters, language)}
                </Box>
              </Typography>
            ))}
          </Box>
        </Box>
      ) : null}

      {reading.length ? (
        <LoadingLine label={t('explorer:compare.common.reading', cap)} />
      ) : null}
      {failed ? (
        <ReadError
          message={t('explorer:compare.common.failed', cap)}
          onRetry={retry}
        />
      ) : null}
      {[
        none.length
          ? t('explorer:compare.none', { list: words(none), ...cap })
          : null,
        soFar.length
          ? t('explorer:compare.none_so_far', { list: words(soFar), ...cap })
          : null,
        reading.length
          ? t('explorer:compare.reading', { list: words(reading), ...cap })
          : null,
      ]
        .filter(Boolean)
        .map((line) => (
          <Typography
            key={line as string}
            variant="body2"
            sx={(theme) => ({
              color: mutedText(theme),
              overflowWrap: 'anywhere',
            })}
          >
            {line}
          </Typography>
        ))}
    </Section>
  );
}
