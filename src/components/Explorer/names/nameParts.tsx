/**
 * The parts of a name shown on the Names tab and on the name's own page:
 * its picture and name (with "Primary" on the primary one), its record
 * (when registered and updated, for sale), who has it now, the notes on
 * how it is written, and the way to its whole history. A record is read
 * once its row nears the screen; a failed read says so with Retry, never
 * "no record".
 */
import { Fragment } from 'react';
import { Box, Button, Typography } from '@mui/material';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import { useTranslation } from 'react-i18next';
import { pastNameNow } from '../../../lib/explorer/names';
import {
  nameDataRead,
  type NameData,
  type TxRow,
} from '../../../lib/explorer/reads';
import { nameNotes, visibleName } from '../../../lib/explorer/rules';
import type { TxSlot } from '../../../lib/explorer/txWords';
import {
  useExplorer,
  useExplorerRead,
  type ReadState,
} from '../ExplorerContext';
import { ExplorerAvatar } from '../ExplorerSearchField';
import {
  cap,
  isolate,
  LoadingLine,
  mutedText,
  ReadError,
  StatusChip,
} from '../parts';
import { marker, splitMarked } from '../transactions/sentenceText';
import { SlotView } from '../transactions/TxSentence';
import { nameNoteText, recordParts } from './nameWords';

/** A name's picture and the name, and "Primary" on the primary one. */
export function NameHead({
  name,
  primary = false,
  size = 40,
}: {
  name: string;
  primary?: boolean;
  size?: number;
}) {
  const { t } = useTranslation(['explorer']);
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        minWidth: 0,
      }}
    >
      <ExplorerAvatar name={name} size={size} />
      <Typography
        component="span"
        data-name-head=""
        sx={{
          flex: '0 1 auto',
          fontSize: '1.05rem',
          fontWeight: 700,
          minWidth: 0,
          overflowWrap: 'anywhere',
        }}
      >
        <bdi dir="auto">{visibleName(name)}</bdi>
      </Typography>
      {primary ? (
        <StatusChip kind="level" label={t('explorer:names.primary', cap)} />
      ) : null}
    </Box>
  );
}

/** A translated sentence with one account in it (`{{owner}}`), the account as a link. */
export function SentenceWithAccount({
  textKey,
  address,
  slotName = 'owner',
  values = {},
}: {
  textKey: string;
  address: string;
  slotName?: string;
  values?: Record<string, unknown>;
}) {
  const { t } = useTranslation(['explorer']);
  const slot: TxSlot = { kind: 'account', address };
  const pieces = splitMarked(
    String(t(textKey, { ...values, [slotName]: marker(slotName), ...cap })),
    { [slotName]: slot }
  );
  return (
    <>
      {pieces.map((piece, index) =>
        piece.kind === 'text' ? (
          <Fragment key={index}>{piece.text}</Fragment>
        ) : (
          <SlotView key={index} slot={piece.slot} mode="links" near />
        )
      )}
    </>
  );
}

const lineSx = { overflowWrap: 'anywhere' } as const;

/**
 * A name's record, once `near`: when it was registered and last updated,
 * and whether it is for sale (at what price). When the node says someone
 * else has it now (it changed hands since its owner's list was read), it
 * says who.
 */
export function NameRecordLine({
  name,
  owner,
  near,
}: {
  name: string;
  /** The account whose list it is in. */
  owner: string;
  near: boolean;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const record = useExplorerRead(near ? nameDataRead(name) : null);
  if (record.status === 'error')
    return (
      <ReadError
        message={t('explorer:names.record_failed', cap)}
        onRetry={record.retry}
      />
    );
  if (record.data === undefined)
    return (
      <LoadingLine
        label={t('explorer:names.record_loading', cap)}
        width="55%"
      />
    );
  if (record.data === null)
    return (
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {t('explorer:names.no_record', cap)}
      </Typography>
    );
  const parts = recordParts(record.data, t, i18n.language);
  return (
    <>
      {parts.length ? (
        <Typography
          variant="body2"
          sx={(theme) => ({ ...lineSx, color: mutedText(theme) })}
        >
          {parts.join(' · ')}
        </Typography>
      ) : null}
      {record.data.owner !== owner ? (
        <Typography variant="body2" sx={lineSx}>
          <SentenceWithAccount
            textKey="explorer:names.now_owned_by"
            address={record.data.owner}
          />
        </Typography>
      ) : null}
    </>
  );
}

/**
 * What a name the account no longer owns is now, from the name's record
 * (read once its row is near): no one has it, another account has it, it
 * goes on under another spelling, or it was registered again since (the
 * node matched another registration, whose history isn't this one's).
 */
export function NowOwnedBy({
  name,
  record,
  txs,
  address,
}: {
  name: string;
  record: ReadState<NameData | null>;
  /** This account's transactions about the name. */
  txs: readonly TxRow[];
  address: string;
}) {
  const { t } = useTranslation(['core', 'explorer']);
  if (record.status === 'error')
    return (
      <ReadError
        message={t('explorer:names.owner_failed', cap)}
        onRetry={record.retry}
      />
    );
  if (record.data === undefined)
    return (
      <LoadingLine label={t('explorer:names.owner_loading', cap)} width="40%" />
    );
  const now = pastNameNow(name, record.data, txs);
  const muted = (text: string) => (
    <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
      {text}
    </Typography>
  );
  switch (now.kind) {
    case 'nobody':
      return muted(t('explorer:names.nobody_now', cap));
    case 'registeredAgain':
      return (
        <Typography variant="body2" sx={lineSx}>
          <SentenceWithAccount
            textKey="explorer:names.registered_again"
            address={now.owner}
            values={{ matched: isolate(visibleName(now.name)) }}
          />
        </Typography>
      );
    case 'respelled':
      return now.owner === address ? (
        muted(
          t('explorer:names.now_spelled_own', {
            matched: isolate(visibleName(now.name)),
            ...cap,
          })
        )
      ) : (
        <Typography variant="body2" sx={lineSx}>
          <SentenceWithAccount
            textKey="explorer:names.now_spelled_owned_by"
            address={now.owner}
            values={{ matched: isolate(visibleName(now.name)) }}
          />
        </Typography>
      );
    case 'owned':
      return now.owner === address ? (
        muted(t('explorer:names.own_again', cap))
      ) : (
        <Typography variant="body2" sx={lineSx}>
          <SentenceWithAccount
            textKey="explorer:names.now_owned_by"
            address={now.owner}
          />
        </Typography>
      );
  }
}

/** Notes on how `name`, owned by `owner`, is written: only when there are any. */
export function NameNotes({ name, owner }: { name: string; owner: string }) {
  const { t } = useTranslation(['explorer']);
  const notes = nameNotes(name, owner);
  if (!notes.length) return null;
  return (
    <Box
      component="ul"
      aria-label={t('explorer:names.notes_label', {
        name: isolate(visibleName(name)),
        ...cap,
      })}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
        listStyle: 'none',
        m: 0,
        p: 0,
      }}
    >
      {notes.map((note) => (
        <Typography
          key={note.kind}
          component="li"
          variant="body2"
          sx={(theme) => ({
            ...lineSx,
            borderInlineStart: `3px solid ${theme.palette.warning.main}`,
            pl: 1,
          })}
        >
          {nameNoteText(note, t)}
        </Typography>
      ))}
    </Box>
  );
}

/** Opens the name's whole history: every change since it was registered, by every account that had it. */
export function WholeHistoryButton({ name }: { name: string }) {
  const { t } = useTranslation(['explorer']);
  const { openName } = useExplorer();
  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={<HistoryRoundedIcon />}
      aria-label={t('explorer:names.whole_history_of', {
        name: isolate(visibleName(name)),
        ...cap,
      })}
      onClick={() => openName(name)}
      sx={{ alignSelf: 'flex-start' }}
    >
      {t('explorer:names.whole_history', cap)}
    </Button>
  );
}
