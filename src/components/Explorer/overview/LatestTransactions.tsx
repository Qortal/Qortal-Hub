/**
 * The Overview's "Latest transactions": the account's newest few, as
 * sentences, from the same read as the Transactions tab's All list
 * (`txlist:all:<address>`), so opening the tab next costs nothing. Read
 * once the section nears the screen. "All transactions" switches to the
 * tab in place (the step's tab, as the tabs do), showing every kind, and
 * puts the keyboard on it. A failed read says so with Retry, never "no
 * transactions"; a failed Refresh keeps the rows read, with Retry.
 */
import { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTranslation } from 'react-i18next';
import { useNearScreen } from '../ExplorerContext';
import { cap, LoadingLine, panelSx, ReadError, Section } from '../parts';
import { TxList } from '../transactions/TxListRow';
import { useAccountTxList } from '../transactions/useAccountTxList';

/** How many the Overview shows. */
export const LATEST_COUNT = 5;

export function LatestTransactions({
  address,
  onShowAll,
}: {
  address: string;
  /** Open the Transactions tab. */
  onShowAll: () => void;
}) {
  const { t } = useTranslation(['core', 'explorer']);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const near = useNearScreen(node);
  // The tab's own All list: Refresh merges the newest page onto it, and a failed one keeps it.
  const { list, error, retry } = useAccountTxList(address, [], {
    enabled: near,
  });
  const rows = list?.rows.slice(0, LATEST_COUNT) ?? [];

  // A Refresh that failed: what was read stays (even "none"), and it says so.
  const refreshFailed = error ? (
    <Box sx={{ mb: 1 }}>
      <ReadError
        message={t('explorer:transactions.refresh_failed', cap)}
        onRetry={retry}
      />
    </Box>
  ) : null;

  let body;
  if (!list && error)
    body = (
      <ReadError message={t('explorer:latest.failed', cap)} onRetry={retry} />
    );
  else if (!list) body = <LoadingLine label={t('core:loading.generic', cap)} />;
  else if (!rows.length)
    body = (
      <>
        {refreshFailed}
        <Typography variant="body2">
          {t('explorer:latest.none', cap)}
        </Typography>
      </>
    );
  else
    body = (
      <>
        {refreshFailed}
        <TxList
          rows={rows}
          viewpoint={address}
          label={t('explorer:latest.title', cap)}
        />
        <Button
          size="small"
          endIcon={<ChevronRightRoundedIcon />}
          onClick={onShowAll}
          sx={{ mt: 1 }}
        >
          {t('explorer:latest.all', cap)}
        </Button>
      </>
    );

  return (
    <Box ref={setNode} sx={{ minWidth: 0 }}>
      <Section id="explorer-latest" title={t('explorer:latest.title', cap)}>
        <Box sx={panelSx}>{body}</Box>
      </Section>
    </Box>
  );
}
