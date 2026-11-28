/**
 * Connections → Payments (from Q-Mintership+'s PaymentsPanel): QORT
 * payments, Q-Asset transfers and multi-payments grouped by the other
 * account, "Sent to" or "Received from", sorted by how many or how much,
 * or by the latest or the earliest payment; 20 accounts at a time, AT
 * addresses (programs on the chain) after them. Each row opens to the
 * payments behind it. With the tab's search, each way lists only the
 * accounts it finds, and the counts on Sent to and Received from are what
 * was found. What it reads is the account's payments list (the
 * Transactions tab's Payments kind); the tab says how far that went.
 * Everything picked here belongs to the history step.
 */
import {
  Box,
  Button,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatCount } from '../../../lib/explorer/format';
import { flowSentence } from '../../../lib/explorer/findings';
import {
  FLOW_SORTS,
  isFlowSort,
  sortFlows,
  splitAt,
  type Flow,
  type FlowSort,
} from '../../../lib/explorer/money';
import { useStepState } from '../ExplorerContext';
import { cap, isolate, LoadingLine, mutedText, ReadError } from '../parts';
import { blocksText, ConnectionRow, ROW_LIST_SX } from './ConnectionRow';
import type { ConnectionsData } from './useConnections';

/** Accounts shown before "Show more", each way. */
export const PAYMENT_ROWS = 20;

type Direction = 'sent' | 'received';

function FlowRow({
  flow,
  direction,
  address,
  tags,
}: {
  flow: Flow;
  direction: Direction;
  address: string;
  tags: Array<string | null>;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  return (
    <ConnectionRow
      address={address}
      rowKey={`${direction}:${flow.address}`}
      other={flow.address}
      sentence={flowSentence(flow, direction)}
      when={blocksText(flow.first.height, flow.last.height, t, i18n.language)}
      tags={tags}
      evidence={{ kind: 'payments', txs: flow.txs }}
      flow={direction === 'received' ? 'in' : 'out'}
    />
  );
}

function MoreButton({ left, onMore }: { left: number; onMore: () => void }) {
  const { t, i18n } = useTranslation(['explorer']);
  return (
    <Button
      size="small"
      variant="outlined"
      onClick={onMore}
      sx={{ alignSelf: 'flex-start' }}
    >
      {t('explorer:connections.payments.show_more', {
        count: Math.min(left, PAYMENT_ROWS),
        shown: formatCount(Math.min(left, PAYMENT_ROWS), i18n.language),
        ...cap,
      })}
    </Button>
  );
}

export function PaymentsPanel({
  address,
  data,
  tagsOf,
  find,
  typed,
}: {
  address: string;
  data: ConnectionsData;
  /** Plain tags for an account the page knows more about ("its sponsor"). */
  tagsOf: (other: string) => Array<string | null>;
  /** The tab's search, when one is typed: whether it finds a flow. */
  find: ((flow: Flow, direction: Direction) => boolean) | null;
  typed: string;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const [chosen, setChosen] = useStepState<Direction | null>(
    'connPayWay',
    null
  );
  const [storedSort, setSort] = useStepState<FlowSort>('connPaySort', 'count');
  const sort: FlowSort = isFlowSort(storedSort) ? storedSort : 'count';
  const [limit, setLimit] = useStepState<number>('connPayShown', PAYMENT_ROWS);
  const [atLimit, setAtLimit] = useStepState<number>(
    'connPayAtShown',
    PAYMENT_ROWS
  );
  const sentAll = data.flowsSent;
  const receivedAll = data.flowsReceived;
  const sent =
    sentAll && find ? sentAll.filter((flow) => find(flow, 'sent')) : sentAll;
  const received =
    receivedAll && find
      ? receivedAll.filter((flow) => find(flow, 'received'))
      : receivedAll;
  // Until one is picked: Sent to, unless it sent nothing and received something.
  const direction: Direction =
    chosen ??
    (sent?.length === 0 && (received?.length ?? 0) > 0 ? 'received' : 'sent');
  const here = direction === 'sent' ? sent : received;
  const other = direction === 'sent' ? received : sent;
  const { people, ats } = splitAt(sortFlows(here ?? [], sort));
  const shown = people.slice(0, Math.max(PAYMENT_ROWS, limit));
  const atsShown = ats.slice(0, Math.max(PAYMENT_ROWS, atLimit));
  const list = data.payments;

  const pick = (next: Direction) => {
    setChosen(next);
    setLimit(PAYMENT_ROWS);
    setAtLimit(PAYMENT_ROWS);
  };

  let body;
  if (!list.list && list.error)
    body = (
      <ReadError
        message={t('explorer:connections.failed.payments', cap)}
        onRetry={list.retry}
      />
    );
  else if (!here)
    body = (
      <LoadingLine label={t('explorer:connections.payments.loading', cap)} />
    );
  else if (!people.length && !ats.length)
    body = (
      <Typography
        role="status"
        variant="body2"
        sx={(theme) => ({ color: mutedText(theme) })}
      >
        {find
          ? t(
              direction === 'sent'
                ? 'explorer:connections.payments.no_match_sent'
                : 'explorer:connections.payments.no_match_received',
              { typed: isolate(typed), ...cap }
            )
          : t(
              direction === 'sent'
                ? 'explorer:connections.payments.none_sent'
                : 'explorer:connections.payments.none_received',
              cap
            )}
        {find && other?.length
          ? ` ${t(
              direction === 'sent'
                ? 'explorer:connections.payments.other_way_received'
                : 'explorer:connections.payments.other_way_sent',
              {
                count: other.length,
                shown: formatCount(other.length, language),
                ...cap,
              }
            )}`
          : null}
      </Typography>
    );
  else
    body = (
      <>
        {shown.length ? (
          <Box
            component="ul"
            aria-label={t(
              direction === 'sent'
                ? 'explorer:connections.payments.sent_label'
                : 'explorer:connections.payments.received_label',
              cap
            )}
            sx={ROW_LIST_SX}
          >
            {shown.map((flow) => (
              <FlowRow
                key={flow.address}
                flow={flow}
                direction={direction}
                address={address}
                tags={tagsOf(flow.address)}
              />
            ))}
          </Box>
        ) : null}
        {people.length > shown.length ? (
          <MoreButton
            left={people.length - shown.length}
            onMore={() => setLimit(shown.length + PAYMENT_ROWS)}
          />
        ) : null}
        {atsShown.length ? (
          <Box
            component="ul"
            aria-label={t('explorer:connections.payments.ats_label', cap)}
            sx={ROW_LIST_SX}
          >
            {atsShown.map((flow) => (
              <FlowRow
                key={flow.address}
                flow={flow}
                direction={direction}
                address={address}
                tags={[]}
              />
            ))}
          </Box>
        ) : null}
        {ats.length > atsShown.length ? (
          <MoreButton
            left={ats.length - atsShown.length}
            onMore={() => setAtLimit(atsShown.length + PAYMENT_ROWS)}
          />
        ) : null}
      </>
    );

  const count = (flows: Flow[] | null) =>
    flows ? ` · ${formatCount(flows.length, language)}` : '';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Box
        sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={direction}
          onChange={(_event, value: Direction | null) => {
            if (value) pick(value);
          }}
          aria-label={t('explorer:connections.payments.way_label', cap)}
        >
          <ToggleButton value="sent" sx={{ textTransform: 'none' }}>
            {t('explorer:connections.payments.sent_to', cap)}
            {count(sent)}
          </ToggleButton>
          <ToggleButton value="received" sx={{ textTransform: 'none' }}>
            {t('explorer:connections.payments.received_from', cap)}
            {count(received)}
          </ToggleButton>
        </ToggleButtonGroup>
        <TextField
          select
          size="small"
          label={t('explorer:connections.payments.sort', cap)}
          value={sort}
          onChange={(event) => {
            if (isFlowSort(event.target.value)) setSort(event.target.value);
          }}
          sx={{ flex: '0 1 240px', minWidth: 180 }}
        >
          {FLOW_SORTS.map((option) => (
            <MenuItem key={option} value={option}>
              {t(`explorer:connections.payments.sort_${option}`, cap)}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      {body}
    </Box>
  );
}
