/**
 * Connections → In common (from Q-Mintership+'s InCommon): where its first
 * QORT came from (worded by the kind of transaction, opening to it), and
 * the sponsor it shares with others ("Also sponsored by A (47 others)",
 * from the sponsor's own minting list, the Transactions tab's Minting kind
 * of that account: 100 at a time, and "47+" when that list stops short).
 * With the tab's search, only the rows it finds. A failed read says so,
 * with Retry, never "nothing in common".
 */
import { useMemo } from 'react';
import { Box } from '@mui/material';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  sponseesOf,
  type Funding,
  type Sponsee,
} from '../../../lib/explorer/connections';
import {
  fundingSentence,
  siblingsSentence,
} from '../../../lib/explorer/findings';
import { formatSpan } from '../../../lib/explorer/format';
import type { TxRow } from '../../../lib/explorer/reads';
import type { TxSentenceSpec } from '../../../lib/explorer/txWords';
import type { ReadState } from '../ExplorerContext';
import { cap, LoadingLine, ReadError, Section } from '../parts';
import {
  useAccountTxList,
  type AccountTxListState,
} from '../transactions/useAccountTxList';
import { ConnectionRow, ROW_LIST_SX, whenText } from './ConnectionRow';
import { isShort, MINTING_TYPES } from './useConnections';

/** One row of In common: what it shows, and the transactions behind it. */
export interface InCommonEntry {
  key: 'funding' | 'siblings';
  other: string | null;
  sentence: TxSentenceSpec;
  when: string;
  tags: string[];
  evidence: TxRow[];
}

export interface InCommonData {
  /** Its sponsor's minting list (nothing read without a sponsor). */
  sponsorList: AccountTxListState;
  /** The other accounts its sponsor sponsored, in the order of their first share (null until read). */
  siblings: Sponsee[] | null;
}

/** The reads In common needs beyond the tab's own: its sponsor's minting list. */
export function useInCommon(
  address: string,
  sponsor: string | null
): InCommonData {
  const sponsorList = useAccountTxList(sponsor ?? '', MINTING_TYPES, {
    enabled: Boolean(sponsor),
  });
  const siblings = useMemo(
    () =>
      sponsor && sponsorList.list
        ? sponseesOf(sponsorList.list.rows, sponsor).filter(
            (sponsee) => sponsee.address !== address
          )
        : null,
    [sponsor, sponsorList.list, address]
  );
  return { sponsorList, siblings };
}

/** In common's rows, in the page's order. */
export function inCommonEntries(
  funding: Funding | null | undefined,
  sponsor: string | null,
  common: InCommonData,
  t: TFunction,
  language: string
): InCommonEntry[] {
  const entries: InCommonEntry[] = [];
  if (funding)
    entries.push({
      key: 'funding',
      other: funding.from,
      sentence: fundingSentence(funding),
      when: whenText(funding, t, language),
      tags: [],
      evidence: [funding.tx],
    });
  const { siblings } = common;
  if (sponsor && siblings && siblings.length) {
    const starts = siblings.map((sibling) => sibling.start.timestamp);
    entries.push({
      key: 'siblings',
      other: sponsor,
      sentence: siblingsSentence(
        sponsor,
        siblings.length,
        isShort(common.sponsorList)
      ),
      when: String(
        t('explorer:connections.siblings_when', {
          span: formatSpan(Math.min(...starts), Math.max(...starts), language),
        })
      ),
      tags: [String(t('explorer:connections.tag.sponsor'))],
      // The first share to each of them, newest first.
      evidence: siblings
        .map((sibling) =>
          sibling.txs.find((tx) => tx.signature === sibling.start.signature)
        )
        .filter((tx): tx is TxRow => Boolean(tx))
        .reverse(),
    });
  }
  return entries;
}

export function InCommon({
  address,
  funding,
  sponsor,
  common,
  entries,
  searching,
}: {
  address: string;
  funding: ReadState<Funding | null>;
  sponsor: string | null;
  common: InCommonData;
  /** The rows to show: all of them, or the ones the tab's search found. */
  entries: readonly InCommonEntry[];
  searching: boolean;
}) {
  const { t } = useTranslation(['explorer']);
  const { sponsorList } = common;
  const loading =
    funding.status === 'loading' ||
    (Boolean(sponsor) && !sponsorList.list && !sponsorList.error);
  const fundingFailed =
    funding.status === 'error' && funding.data === undefined;
  const siblingsFailed =
    Boolean(sponsor) && !sponsorList.list && Boolean(sponsorList.error);
  if (!entries.length && !loading && !fundingFailed && !siblingsFailed)
    return null;
  // Searching, and nothing here is found: the part steps aside, unless a
  // read of it failed (the search couldn't look there: it says so).
  if (
    searching &&
    !entries.length &&
    !loading &&
    !fundingFailed &&
    !siblingsFailed
  )
    return null;
  return (
    <Section
      id="explorer-connections-common"
      title={t('explorer:connections.common_title', cap)}
    >
      {entries.length ? (
        <Box
          component="ul"
          aria-label={t('explorer:connections.common_title', cap)}
          sx={ROW_LIST_SX}
        >
          {entries.map((entry) => (
            <ConnectionRow
              key={entry.key}
              address={address}
              rowKey={entry.key}
              other={entry.other}
              sentence={entry.sentence}
              when={entry.when}
              tags={entry.tags}
              evidence={{ kind: 'transactions', txs: entry.evidence }}
            />
          ))}
        </Box>
      ) : null}
      {loading ? (
        <LoadingLine label={t('explorer:connections.common_loading', cap)} />
      ) : null}
      {fundingFailed ? (
        <ReadError
          message={t('explorer:connections.failed.funding', cap)}
          onRetry={funding.retry}
        />
      ) : null}
      {siblingsFailed ? (
        <ReadError
          message={t('explorer:connections.failed.sponsor_list', cap)}
          onRetry={sponsorList.retry}
        />
      ) : null}
    </Section>
  );
}
