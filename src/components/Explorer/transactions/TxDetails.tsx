/**
 * A transaction's details in plain words: its type's fields (accounts,
 * names, amounts, groups and transactions shown as in its sentence, with
 * the same links), and the accounts it involves, each opening in the
 * Explorer. Long lists stop at 20 with "Show all" (a multi-payment can pay
 * hundreds of accounts, and each account shown reads its name).
 *
 * What a transaction never shows is left out before this
 * (lib/explorer/txWords.ts): a message's content, an encrypted resource's
 * identifier, the fields only its raw data carries.
 */
import { Fragment, useState } from 'react';
import { Box, Button, ButtonBase, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { isAtAddress, shortAddress } from '../../../lib/explorer/addresses';
import {
  formatAmountExact,
  formatList,
  formatSize,
} from '../../../lib/explorer/format';
import { visibleName } from '../../../lib/explorer/rules';
import type {
  TxField,
  TxFieldValue,
  TxSlot,
} from '../../../lib/explorer/txWords';
import { useExplorer } from '../ExplorerContext';
import { ExplorerAvatar } from '../ExplorerSearchField';
import { cap, mutedText, tileSx } from '../parts';
import { marker, splitMarked } from './sentenceText';
import { SlotView, TxSentence, useAccountName } from './TxSentence';

/** Rows shown before "Show all". */
export const TX_LIST_CAP = 20;

const APPROVAL_WORDS = new Set([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'INVALID',
]);

const SLOT_KINDS = new Set<TxSlot['kind']>([
  'account',
  'amount',
  'asset',
  'name',
  'group',
  'tx',
  'text',
  'number',
  'percent',
  'service',
  'type',
]);

const isSlot = (value: TxFieldValue): value is TxSlot =>
  SLOT_KINDS.has(value.kind as TxSlot['kind']);

/** People's own texts as a list, each isolated. */
function TextList({ texts }: { texts: string[] }) {
  const { i18n } = useTranslation(['explorer']);
  const names = texts.map((_, index) => `t${index}`);
  const pieces = splitMarked(
    formatList(names.map(marker), i18n.language),
    Object.fromEntries(
      names.map((name, index) => [
        name,
        { kind: 'text', text: texts[index] } as TxSlot,
      ])
    )
  );
  return (
    <>
      {pieces.map((piece, index) =>
        piece.kind === 'text' ? (
          <Fragment key={index}>{piece.text}</Fragment>
        ) : piece.slot.kind === 'text' ? (
          <bdi key={index} dir="auto">
            {visibleName(piece.slot.text)}
          </bdi>
        ) : null
      )}
    </>
  );
}

function FieldValue({ value }: { value: TxFieldValue }) {
  const { t, i18n } = useTranslation(['explorer']);
  if (isSlot(value)) return <SlotView slot={value} mode="links" near />;
  switch (value.kind) {
    case 'sentence':
      return <TxSentence sentence={value.sentence} />;
    case 'word':
      return <>{t(`explorer:tx.value.${value.key}`, cap)}</>;
    case 'approval':
      return (
        <>
          {APPROVAL_WORDS.has(value.key)
            ? t(`explorer:tx.approval.${value.key.toLowerCase()}`, cap)
            : value.key}
        </>
      );
    case 'raw':
      return (
        <Box
          component="bdi"
          dir="auto"
          sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
        >
          {value.text}
        </Box>
      );
    case 'size':
      return <>{formatSize(value.bytes, i18n.language)}</>;
    case 'option':
      return <>{t('explorer:tx.value.option', { n: value.number, ...cap })}</>;
    case 'texts':
      return <TextList texts={value.texts} />;
    case 'decimal':
      return <>{formatAmountExact(value.text, i18n.language)}</>;
    case 'price':
      return (
        <>
          {formatAmountExact(value.amount, i18n.language)}
          {value.pair ? ` ${value.pair}` : ''}
        </>
      );
    case 'flags':
      return (
        <Box component="span" sx={{ fontFamily: 'monospace' }}>
          {t('explorer:tx.value.flags', {
            and: value.and,
            or: value.or,
            xor: value.xor,
          })}
        </Box>
      );
    default:
      return null;
  }
}

function ShowAll({ count, onShow }: { count: number; onShow: () => void }) {
  const { t } = useTranslation(['explorer']);
  return (
    <Button size="small" onClick={onShow} sx={{ alignSelf: 'flex-start' }}>
      {t('explorer:tx.show_all', { count, ...cap })}
    </Button>
  );
}

export function TxFields({
  fields,
  label,
}: {
  fields: TxField[];
  label: string;
}) {
  const { t } = useTranslation(['explorer']);
  const [all, setAll] = useState(false);
  if (!fields.length) return null;
  const shown = all ? fields : fields.slice(0, TX_LIST_CAP);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Box
        component="dl"
        aria-label={label}
        sx={{
          containerType: 'inline-size',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          m: 0,
        }}
      >
        {shown.map((field, index) => (
          <Box
            key={index}
            sx={(theme) => ({
              ...tileSx(theme),
              alignItems: 'baseline',
              columnGap: 2,
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr)',
              py: 1,
              rowGap: 0.25,
              '@container (min-width: 480px)': {
                gridTemplateColumns: '9rem minmax(0, 1fr)',
              },
            })}
          >
            <Typography
              component="dt"
              variant="body2"
              sx={(theme) => ({ color: mutedText(theme) })}
            >
              {t(`explorer:tx.field.${field.label}`, cap)}
            </Typography>
            <Typography
              component="dd"
              sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere' }}
            >
              <FieldValue value={field.value} />
            </Typography>
          </Box>
        ))}
      </Box>
      {fields.length > shown.length ? (
        <ShowAll count={fields.length} onShow={() => setAll(true)} />
      ) : null}
    </Box>
  );
}

function Person({ address, maker }: { address: string; maker: string | null }) {
  const { t } = useTranslation(['explorer']);
  const { openAccount } = useExplorer();
  const at = isAtAddress(address);
  const name = useAccountName(address, true);
  const notes = [
    address === maker ? t('explorer:tx.creator', cap) : null,
    at ? t('explorer:tx.field.at', cap) : null,
  ].filter(Boolean);
  return (
    <ButtonBase
      onClick={() => openAccount(address, { fromExplorer: true })}
      sx={(theme) => ({
        alignItems: 'center',
        borderRadius: '10px',
        display: 'flex',
        gap: 1,
        justifyContent: 'flex-start',
        maxWidth: '100%',
        minHeight: 40,
        px: 0.75,
        textAlign: 'left',
        '&:hover': { backgroundColor: theme.palette.action.hover },
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
        },
      })}
    >
      <ExplorerAvatar name={name ?? null} size={28} />
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Box
          component="bdi"
          dir="auto"
          sx={(theme) => ({
            color: theme.palette.primary.main,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          })}
        >
          {name ? visibleName(name) : shortAddress(address)}
        </Box>
        {notes.length ? (
          <Typography
            component="span"
            variant="body2"
            sx={(theme) => ({ color: mutedText(theme), fontSize: '0.78rem' })}
          >
            {notes.join(' · ')}
          </Typography>
        ) : null}
      </Box>
    </ButtonBase>
  );
}

/** The accounts a transaction involves, the one that made it first. */
export function TxPeople({
  addresses,
  maker,
}: {
  addresses: string[];
  /** The account that made it (signed it and paid its fee), marked as such. */
  maker: string | null;
}) {
  const { t } = useTranslation(['explorer']);
  const [all, setAll] = useState(false);
  if (!addresses.length) return null;
  const shown = all ? addresses : addresses.slice(0, TX_LIST_CAP);
  const title = t('explorer:tx.people', cap);
  return (
    <Box
      sx={(theme) => ({
        ...tileSx(theme),
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
      })}
    >
      <Typography
        variant="body2"
        sx={(theme) => ({ color: mutedText(theme), fontWeight: 600 })}
      >
        {title}
      </Typography>
      <Box
        component="ul"
        aria-label={title}
        sx={{
          columnGap: 2,
          display: 'flex',
          flexWrap: 'wrap',
          listStyle: 'none',
          m: 0,
          p: 0,
          rowGap: 0.25,
        }}
      >
        {shown.map((address) => (
          <Box
            component="li"
            key={address}
            sx={{ maxWidth: '100%', minWidth: 0 }}
          >
            <Person address={address} maker={maker} />
          </Box>
        ))}
      </Box>
      {addresses.length > shown.length ? (
        <ShowAll count={addresses.length} onShow={() => setAll(true)} />
      ) : null}
    </Box>
  );
}
