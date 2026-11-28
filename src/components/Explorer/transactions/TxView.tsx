/**
 * One transaction, by its signature: its type, its sentence (told from no
 * one's side, with links), then the facts (its block and time, or that it
 * waits for one; the fee; where its group approval stands, when it needs
 * one; its signature, with Copy), the accounts involved, for a group
 * approval the transaction it answers, the type's fields in plain words,
 * and its raw API answer, closed at first (less what never shows:
 * lib/explorer/rawTx.ts).
 *
 * A signature the node doesn't know (it may not have reached it yet) has a
 * page of its own, and a failed read offers Retry; neither is taken for
 * the other. Read-only: nothing here writes.
 */
import { type ReactNode } from 'react';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTranslation } from 'react-i18next';
import {
  formatAgo,
  formatAmountExact,
  formatCount,
  formatDayTime,
} from '../../../lib/explorer/format';
import { txRead, type TxRow } from '../../../lib/explorer/reads';
import { makerOf } from '../../../lib/explorer/txWords';
import { useExplorer, useExplorerRead } from '../ExplorerContext';
import {
  cap,
  CopyButton,
  mutedText,
  panelSx,
  ReadError,
  Section,
  tileSx,
} from '../parts';
import { RawAnswer } from './RawJson';
import { typeTitle } from './sentenceText';
import { TxFields, TxPeople } from './TxDetails';
import { OutcomeNote } from './TxListRow';
import { TxSentence } from './TxSentence';
import { useTxWords } from './txLook';

const APPROVAL_WORDS = new Set([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'INVALID',
]);

function Fact({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Box
      sx={(theme) => ({
        ...tileSx(theme),
        ...(wide ? { gridColumn: '1 / -1' } : {}),
      })}
    >
      <Typography
        component="dt"
        variant="body2"
        sx={(theme) => ({ color: mutedText(theme) })}
      >
        {label}
      </Typography>
      <Typography
        component="dd"
        sx={{ fontWeight: 600, m: 0, overflowWrap: 'anywhere' }}
      >
        {children}
      </Typography>
    </Box>
  );
}

function Facts({ tx }: { tx: TxRow }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const confirmed = typeof tx.blockHeight === 'number';
  const approval =
    typeof tx.approvalStatus === 'string' &&
    tx.approvalStatus !== 'NOT_REQUIRED'
      ? tx.approvalStatus
      : null;
  return (
    <Box sx={{ containerType: 'inline-size' }}>
      <Box
        component="dl"
        aria-label={t('explorer:tx_page.about', cap)}
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: 'minmax(0, 1fr)',
          m: 0,
          '@container (min-width: 520px)': {
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          },
        }}
      >
        <Fact label={t('explorer:tx_page.block', cap)}>
          {confirmed
            ? formatCount(tx.blockHeight as number, language)
            : t('explorer:tx_page.waiting', cap)}
        </Fact>
        <Fact
          label={
            confirmed
              ? t('explorer:tx_page.time', cap)
              : t('explorer:tx_page.sent', cap)
          }
        >
          {formatDayTime(tx.timestamp, language)}
          <Box
            component="span"
            sx={(theme) => ({
              color: mutedText(theme),
              display: 'block',
              fontSize: '0.85rem',
              fontWeight: 400,
            })}
          >
            {formatAgo(tx.timestamp, language)}
          </Box>
        </Fact>
        {typeof tx.fee === 'string' ? (
          <Fact label={t('explorer:tx_page.fee', cap)}>
            {formatAmountExact(tx.fee, language)} QORT
          </Fact>
        ) : null}
        {approval ? (
          <Fact label={t('explorer:tx.field.group_approval', cap)}>
            {APPROVAL_WORDS.has(approval)
              ? t(`explorer:tx.approval.${approval.toLowerCase()}`, cap)
              : approval}
          </Fact>
        ) : null}
        <Fact label={t('explorer:tx_page.signature', cap)} wide>
          <Box
            component="span"
            sx={{ alignItems: 'center', display: 'flex', gap: 1 }}
          >
            <Box
              component="span"
              sx={{
                flex: 1,
                fontFamily: 'monospace',
                fontSize: '0.82rem',
                fontWeight: 500,
                minWidth: 0,
                wordBreak: 'break-all',
              }}
            >
              {tx.signature}
            </Box>
            <CopyButton
              value={tx.signature}
              label={t('explorer:tx_page.copy_signature', cap)}
              copiedMessage={t('explorer:tx_page.signature_copied', cap)}
            />
          </Box>
        </Fact>
      </Box>
    </Box>
  );
}

/** The transaction a group approval answers, read on its own. */
function AnsweredTx({ signature }: { signature: string }) {
  const { t } = useTranslation(['core', 'explorer']);
  const { openTransaction } = useExplorer();
  const read = useExplorerRead(txRead(signature));
  let line: ReactNode;
  if (read.status === 'error')
    line = (
      <ReadError
        message={t('explorer:tx_page.answers_failed', cap)}
        onRetry={read.retry}
      />
    );
  else if (read.data === undefined)
    line = (
      <Typography variant="body2">{t('core:loading.generic', cap)}</Typography>
    );
  else if (read.data === null)
    line = (
      <Typography variant="body2">
        {t('explorer:tx_page.answers_unknown', cap)}
      </Typography>
    );
  else line = <AnsweredSentence tx={read.data} />;
  return (
    <Section
      id="explorer-tx-answers"
      title={t('explorer:tx_page.answers', cap)}
    >
      <Box
        sx={(theme) => ({
          ...panelSx(theme),
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        })}
      >
        {line}
        <Button
          size="small"
          variant="outlined"
          endIcon={<ChevronRightRoundedIcon />}
          onClick={() => openTransaction(signature)}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('explorer:tx_page.open_answered', cap)}
        </Button>
      </Box>
    </Section>
  );
}

function AnsweredSentence({ tx }: { tx: TxRow }) {
  const words = useTxWords(tx, null);
  return (
    <Typography component="p" sx={{ m: 0, overflowWrap: 'anywhere' }}>
      <TxSentence sentence={words.sentence} />
      <OutcomeNote outcome={words.outcome} />
    </Typography>
  );
}

function TxPage({ tx }: { tx: TxRow }) {
  const { t } = useTranslation(['explorer']);
  const words = useTxWords(tx, null);
  const title = typeTitle(tx.type, t, true);
  // The approval is one of the facts above; the fields don't repeat it.
  const fields = words.fields.filter(
    (field) => field.label !== 'group_approval'
  );
  const answers =
    tx.type === 'GROUP_APPROVAL' && typeof tx.pendingSignature === 'string'
      ? tx.pendingSignature
      : null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography
          component="h2"
          sx={{ fontSize: { xs: '1.15rem', sm: '1.3rem' }, fontWeight: 700 }}
        >
          {title}
        </Typography>
        <Typography
          component="p"
          sx={{ fontSize: '1.05rem', lineHeight: 1.45, m: 0 }}
        >
          <TxSentence sentence={words.sentence} />
          <OutcomeNote outcome={words.outcome} />
        </Typography>
        {words.privsFailed ? (
          <ReadError
            message={t('explorer:tx.privs_failed', cap)}
            onRetry={words.privsFailed}
          />
        ) : null}
      </Box>
      <Facts tx={tx} />
      <TxPeople addresses={words.participants} maker={makerOf(tx)} />
      {answers ? <AnsweredTx signature={answers} /> : null}
      {fields.length ? (
        <Section
          id="explorer-tx-details"
          title={t('explorer:tx_page.details', cap)}
        >
          <TxFields
            fields={fields}
            label={t('explorer:tx.details_of', {
              type: typeTitle(tx.type, t),
              ...cap,
            })}
          />
        </Section>
      ) : null}
      <RawAnswer tx={tx} />
    </Box>
  );
}

export function TxView({ signature }: { signature: string }) {
  const { t } = useTranslation(['core', 'explorer']);
  const read = useExplorerRead(txRead(signature));
  if (read.status === 'error')
    return (
      <Box sx={panelSx}>
        <ReadError
          message={t('explorer:tx_page.failed', cap)}
          onRetry={read.retry}
        />
      </Box>
    );
  if (read.data === undefined)
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress
          size={28}
          aria-label={t('core:loading.generic', cap)}
        />
      </Box>
    );
  if (read.data === null)
    return (
      <Box
        sx={(theme) => ({
          ...panelSx(theme),
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        })}
      >
        <Typography role="status" sx={{ fontWeight: 700 }}>
          {t('explorer:tx_page.unknown', cap)}
        </Typography>
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:tx_page.unknown_hint', cap)}
        </Typography>
        <Typography
          variant="body2"
          sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}
        >
          {signature}
        </Typography>
      </Box>
    );
  return <TxPage tx={read.data} />;
}
