/**
 * A transaction's sentence on screen, in the reader's language
 * (sentenceText.ts splits the translated sentence at its slots): accounts
 * by their name (or short address) as links that open them in the
 * Explorer, a step on the trail; a registered name as a link to its whole
 * history; names, groups and people's own texts isolated (`<bdi>`), so a
 * name written right to left or looking like a label can't change how the
 * line reads; amounts in bold; a transaction it points at as a link to it.
 *
 * `quiet` keeps the links out of the Tab order, for a sentence laid over a
 * list row's button (TxListRow): the row's opened details have the same
 * links for the keyboard. Names of accounts and groups are read only once
 * `near` (the row is near the screen), or shown at once when already read.
 *
 * A list shows up to a thousand of these, so their parts are styled once
 * (`styled`), not per sentence.
 */
import { Fragment, type MouseEvent } from 'react';
import { styled } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { isAtAddress, shortAddress } from '../../../lib/explorer/addresses';
import { formatAmountExact, formatList } from '../../../lib/explorer/format';
import {
  groupNameRead,
  primaryNameRead,
  type ReadSpec,
} from '../../../lib/explorer/reads';
import { visibleName } from '../../../lib/explorer/rules';
import {
  isMinterGroup,
  type Amount,
  type TxSentenceSpec,
  type TxSlot,
} from '../../../lib/explorer/txWords';
import { useExplorer, useExplorerRead } from '../ExplorerContext';
import { InlineLink } from '../parts';
import { useExchangeName } from '../useExplorerAccess';
import {
  amountText,
  marker,
  sentencePieces,
  slotText,
  splitMarked,
} from './sentenceText';

export type SentenceMode = 'links' | 'quiet';

/** A read once `near`, or what another part already read. */
function useNearRead<T>(spec: ReadSpec<T> | null, near: boolean) {
  const { cache } = useExplorer();
  const read = useExplorerRead(near ? spec : null);
  if (read.data !== undefined) return read.data;
  return spec ? cache.peek<T>(spec.key) : undefined;
}

/** An account's primary name (null for none, undefined while unknown); ATs have none. */
export function useAccountName(
  address: string | null,
  near: boolean
): string | null | undefined {
  const spec =
    address && !isAtAddress(address) ? primaryNameRead(address) : null;
  const name = useNearRead(spec, near);
  return address && isAtAddress(address) ? null : name;
}

/** Someone's own words in a sentence: isolated, in bold. */
const Isolated = styled('bdi')({ display: 'inline', fontWeight: 600 });

/** An amount: its number never breaks; an asset's name may wrap. */
const Strong = styled('strong')({
  display: 'inline',
  fontVariantNumeric: 'tabular-nums',
  '&[data-whole]': { whiteSpace: 'nowrap' },
  '& > [data-number]': { whiteSpace: 'nowrap' },
});

function AccountSlot({
  address,
  mode,
  near,
}: {
  address: string | null;
  mode: SentenceMode;
  near: boolean;
}) {
  const { t } = useTranslation(['explorer']);
  const { openAccount } = useExplorer();
  const name = useAccountName(address, near);
  const exchange = useExchangeName(address);
  if (!address) return <>{t('explorer:tx.unknown_account')}</>;
  return (
    <InlineLink
      type="button"
      tabIndex={mode === 'quiet' ? -1 : undefined}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        openAccount(address, { fromExplorer: true });
      }}
    >
      <bdi dir="auto">
        {name ? visibleName(name) : (exchange ?? shortAddress(address))}
      </bdi>
    </InlineLink>
  );
}

function GroupSlot({
  groupId,
  carried,
  near,
}: {
  groupId: number | null;
  /** The name the transaction carries (a CREATE_GROUP's): no read needed. */
  carried: string | null;
  near: boolean;
}) {
  const minter = groupId !== null && isMinterGroup(groupId);
  const spec =
    groupId !== null && !minter && !carried ? groupNameRead(groupId) : null;
  const name = useNearRead(spec, near);
  const text = minter
    ? 'MINTER'
    : carried
      ? visibleName(carried)
      : name
        ? visibleName(name)
        : groupId === null
          ? '?'
          : `#${groupId}`;
  return <Isolated dir="auto">{text}</Isolated>;
}

/** A registered name, as a link to its whole history (the name step). */
function NameSlotLink({ name, mode }: { name: string; mode: SentenceMode }) {
  const { openName } = useExplorer();
  // Nothing to open: the transaction names none.
  if (!name) return null;
  return (
    <InlineLink
      type="button"
      tabIndex={mode === 'quiet' ? -1 : undefined}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        openName(name);
      }}
    >
      <bdi dir="auto">{visibleName(name)}</bdi>
    </InlineLink>
  );
}

function TxSlotLink({
  signature,
  mode,
}: {
  signature: string | null;
  mode: SentenceMode;
}) {
  const { openTransaction } = useExplorer();
  if (!signature) return <>?</>;
  return (
    <InlineLink
      type="button"
      data-tx=""
      tabIndex={mode === 'quiet' ? -1 : undefined}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        openTransaction(signature);
      }}
    >
      {signature.slice(0, 8)}…
    </InlineLink>
  );
}

function OneAmount({ amount }: { amount: Amount }) {
  const { t, i18n } = useTranslation(['explorer']);
  // An asset's name is its issuer's choice: isolated, and it may wrap.
  if (amount.asset.id !== 0 && amount.asset.name)
    return (
      <Strong>
        <span data-number="">
          {formatAmountExact(amount.amount, i18n.language)}
        </span>{' '}
        <bdi dir="auto">{amount.asset.name}</bdi>
      </Strong>
    );
  return <Strong data-whole="">{amountText(amount, t, i18n.language)}</Strong>;
}

function AmountSlot({ amounts }: { amounts: Amount[] }) {
  const { i18n } = useTranslation(['explorer']);
  if (amounts.length === 1) return <OneAmount amount={amounts[0]} />;
  // Several amounts, joined the way the language joins a list.
  const names = amounts.map((_, index) => `a${index}`);
  const pieces = splitMarked(
    formatList(names.map(marker), i18n.language),
    Object.fromEntries(
      names.map((name, index) => [
        name,
        { kind: 'amount', amounts: [amounts[index]] } as TxSlot,
      ])
    )
  );
  return (
    <>
      {pieces.map((piece, index) =>
        piece.kind === 'text' ? (
          <Fragment key={index}>{piece.text}</Fragment>
        ) : piece.slot.kind === 'amount' ? (
          <OneAmount key={index} amount={piece.slot.amounts[0]} />
        ) : null
      )}
    </>
  );
}

export function SlotView({
  slot,
  mode,
  near,
}: {
  slot: TxSlot;
  mode: SentenceMode;
  near: boolean;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  switch (slot.kind) {
    case 'account':
      return <AccountSlot address={slot.address} mode={mode} near={near} />;
    case 'amount':
      return <AmountSlot amounts={slot.amounts} />;
    case 'group':
      return (
        <GroupSlot
          groupId={slot.groupId}
          carried={slot.name ?? null}
          near={near}
        />
      );
    case 'tx':
      return <TxSlotLink signature={slot.signature} mode={mode} />;
    case 'name':
      return <NameSlotLink name={slot.name} mode={mode} />;
    case 'text':
    case 'asset':
      return <Isolated dir="auto">{slotText(slot, t, i18n.language)}</Isolated>;
    default:
      return <>{slotText(slot, t, i18n.language)}</>;
  }
}

const Words = styled('span')({ overflowWrap: 'anywhere' });

export function TxSentence({
  sentence,
  mode = 'links',
  near = true,
}: {
  sentence: TxSentenceSpec;
  mode?: SentenceMode;
  near?: boolean;
}) {
  const { t } = useTranslation(['explorer']);
  return (
    <Words>
      {sentencePieces(sentence, t).map((piece, index) =>
        piece.kind === 'text' ? (
          <Fragment key={index}>{piece.text}</Fragment>
        ) : (
          <SlotView key={index} slot={piece.slot} mode={mode} near={near} />
        )
      )}
    </Words>
  );
}
