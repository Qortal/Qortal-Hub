/**
 * The Overview's "Direct links" (from Q-Mintership+'s DirectLinksPreview),
 * for a viewer who sees the detailed parts only: the first three things
 * recorded between this account and others (the same findings, in the
 * same order, as Connections → Recorded between them), one line each, and
 * "All connections (n)" to that tab, with "+" while what was read stops
 * short of everything. When nothing was found in what was read, one line
 * says so; a part that couldn't be read is named, with Retry, and never
 * counted as nothing found.
 *
 * It reads the account's Payments, Minting and Names lists (100 rows
 * each, the Transactions tab's kinds) and the online list, once it nears
 * the screen; never its Q-Asset trades, which only the Connections tab
 * reads (about two reads per filled order). Until the tab has read them,
 * the count says "+". Opening the tab then reads its trades, where its
 * first QORT came from, its payments with exchanges and its sponsor's
 * minting list.
 */
import { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTranslation } from 'react-i18next';
import { formatCount, formatList } from '../../../lib/explorer/format';
import { whenText } from '../connections/ConnectionRow';
import {
  isShort,
  useConnections,
  type ConnectionsPart,
} from '../connections/useConnections';
import { useNearScreen } from '../ExplorerContext';
import {
  cap,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
  Section,
} from '../parts';
import { TxSentence } from '../transactions/TxSentence';

/** How many lines the preview shows. */
export const PREVIEW_LINES = 3;

export function DirectLinksPreview({
  address,
  onShowAll,
}: {
  address: string;
  /** Open the Connections tab. */
  onShowAll: () => void;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const [node, setNode] = useState<HTMLElement | null>(null);
  const near = useNearScreen(node);
  const data = useConnections(address, { enabled: near, withTrades: false });
  const { recorded, failed } = data;
  const short =
    isShort(data.payments) || isShort(data.minting) || isShort(data.names);
  // Partial: a part couldn't be read, isn't in yet (the trades: until the
  // Connections tab reads them), or was read only in part.
  const partial = !data.complete;

  const unread = failed.length ? (
    <ReadError
      message={t('explorer:direct_links.failed', {
        parts: formatList(
          failed.map((part: ConnectionsPart) =>
            String(t(`explorer:connections.unread.${part}`))
          ),
          language
        ),
        ...cap,
      })}
      onRetry={data.retryFailed}
    />
  ) : null;
  const allButton = (
    <Button
      size="small"
      endIcon={<ChevronRightRoundedIcon />}
      onClick={onShowAll}
      sx={{ alignSelf: 'flex-start' }}
    >
      {recorded.length
        ? t(
            partial
              ? 'explorer:direct_links.all_more'
              : 'explorer:direct_links.all',
            {
              count: recorded.length,
              shown: formatCount(recorded.length, language),
              ...cap,
            }
          )
        : t('explorer:direct_links.all_none', cap)}
    </Button>
  );
  const refreshFailed = data.refreshFailed ? (
    <ReadError
      message={t('explorer:transactions.refresh_failed', cap)}
      onRetry={data.retryRefresh}
    />
  ) : null;
  const shortNote = short ? (
    <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
      {t('explorer:direct_links.short', cap)}
    </Typography>
  ) : null;

  let body;
  if (!data.settled && recorded.length < PREVIEW_LINES && !failed.length)
    body = <LoadingLine label={t('explorer:direct_links.loading', cap)} />;
  else if (!recorded.length)
    body = unread ? (
      <>
        {unread}
        {allButton}
      </>
    ) : !data.settled ? (
      <LoadingLine label={t('explorer:direct_links.loading', cap)} />
    ) : (
      <>
        <Typography variant="body2" role="status">
          {t('explorer:direct_links.none', cap)}
        </Typography>
        {shortNote}
        {refreshFailed}
        {allButton}
      </>
    );
  else
    body = (
      <>
        <Box
          component="ul"
          aria-label={t('explorer:direct_links.title', cap)}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            listStyle: 'none',
            m: 0,
            p: 0,
          }}
        >
          {recorded.slice(0, PREVIEW_LINES).map((finding) => (
            <Box
              component="li"
              key={finding.key}
              data-direction={
                finding.kind === 'paidBy'
                  ? 'in'
                  : finding.kind === 'paidTo'
                    ? 'out'
                    : undefined
              }
              sx={(theme) => ({
                backgroundColor: theme.palette.background.elevated,
                borderRadius: '10px',
                minWidth: 0,
                px: 1.25,
                py: 1,
                '&[data-direction="in"] strong': {
                  color: theme.palette.other.positive,
                },
                '&[data-direction="out"] strong': {
                  color: theme.palette.other.danger,
                },
              })}
            >
              <Typography component="div" sx={{ overflowWrap: 'anywhere' }}>
                <TxSentence sentence={finding.sentence} near={near} />
              </Typography>
              <Typography
                variant="body2"
                sx={(theme) => ({ color: mutedText(theme) })}
              >
                {whenText(finding, t, language)}
              </Typography>
            </Box>
          ))}
        </Box>
        {shortNote}
        {refreshFailed}
        {unread}
        {allButton}
      </>
    );

  return (
    <Box ref={setNode} sx={{ minWidth: 0 }}>
      <Section
        id="explorer-direct-links"
        title={t('explorer:direct_links.title', cap)}
      >
        <Box
          sx={(theme) => ({
            ...panelSx(theme),
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          })}
        >
          {body}
        </Box>
      </Section>
    </Box>
  );
}
