/**
 * A transaction's sentence (lib/explorer/txWords.ts) in the reader's
 * language. Each sentence is one key whose translation places its slots
 * ({{actor}}, {{amount}}, …) where its language puts them; nothing is
 * pieced together from translated fragments.
 *
 * `sentencePieces` asks i18next for the sentence with a marker in each
 * slot's place and splits it there, so the page can render each slot as a
 * piece of its own (an account as a link, an amount in bold) in the order
 * the translation set. `sentenceText` is the same sentence as plain text
 * (accounts by name when known, else by short address).
 */
import type { TFunction } from 'i18next';
import { shortAddress } from '../../../lib/explorer/addresses';
import {
  formatAmountExact,
  formatCount,
  formatList,
  formatPercent,
} from '../../../lib/explorer/format';
import { isTxType } from '../../../lib/explorer/txFamilies';
import {
  isMinterGroup,
  type Amount,
  type AssetRef,
  type TxSentenceSpec,
  type TxSlot,
} from '../../../lib/explorer/txWords';
import { visibleName } from '../../../lib/explorer/rules';

/** Marks a slot's place in a translated sentence (private-use characters). */
const OPEN = '\uE000';
const CLOSE = '\uE001';
/** A marker's name: letters, digits and _ ("actor", "new_owner", "a0"). */
const MARKER = /\uE000([a-z0-9_]+)\uE001/g;

export const marker = (name: string) => `${OPEN}${name}${CLOSE}`;

export type SentencePiece =
  | { kind: 'text'; text: string }
  | { kind: 'slot'; name: string; slot: TxSlot };

/** The key of a sentence, in the explorer namespace. */
export const sayKey = (sentence: TxSentenceSpec) =>
  `explorer:tx.say.${sentence.key}`;

/** Text with markers split into its text and its slots (a slot the sentence doesn't hold is left out). */
export function splitMarked(
  text: string,
  slots: Readonly<Record<string, TxSlot>>
): SentencePiece[] {
  const pieces: SentencePiece[] = [];
  let at = 0;
  for (const match of text.matchAll(MARKER)) {
    const index = match.index ?? 0;
    if (index > at) pieces.push({ kind: 'text', text: text.slice(at, index) });
    const slot = slots[match[1]];
    if (slot) pieces.push({ kind: 'slot', name: match[1], slot });
    at = index + match[0].length;
  }
  if (at < text.length) pieces.push({ kind: 'text', text: text.slice(at) });
  return pieces;
}

/** The sentence, split where its slots go, in the reader's language. */
export function sentencePieces(
  sentence: TxSentenceSpec,
  t: TFunction
): SentencePiece[] {
  const markers = Object.fromEntries(
    Object.keys(sentence.slots).map((name) => [name, marker(name)])
  );
  const text = String(
    t(sayKey(sentence), {
      ...markers,
      ...(sentence.count === undefined ? {} : { count: sentence.count }),
    })
  );
  return splitMarked(text, sentence.slots);
}

/**
 * A transaction type in words ("payment"; "Payment" with `capitalized`),
 * or Core's own name for a type Hub doesn't know.
 */
export function typeTitle(
  type: string,
  t: TFunction,
  capitalized = false
): string {
  if (!isTxType(type)) return String(type || '?');
  return String(
    t(
      `explorer:tx_type.${type.toLowerCase()}`,
      capitalized ? { postProcess: 'capitalizeFirstChar' } : {}
    )
  );
}

/** An asset by itself: QORT, its name, or its number ("#90"); "?" for one with neither. */
export function assetText(asset: AssetRef): string {
  if (asset.id === 0) return 'QORT';
  if (asset.name) return asset.name;
  return asset.id === null ? '?' : `#${asset.id}`;
}

/** One amount: "15 QORT", "3 Valun", "1 asset #7". */
export function amountText(
  amount: Amount,
  t: TFunction,
  language: string
): string {
  const number = formatAmountExact(amount.amount, language);
  const { asset } = amount;
  const unit =
    asset.id === 0 || asset.name || asset.id === null
      ? assetText(asset)
      : String(t('explorer:tx.asset_number', { id: asset.id }));
  return `${number} ${unit}`;
}

export interface TextNames {
  /** The name known for an account, if any. */
  nameOf?: (address: string) => string | null | undefined;
  /** The name known for a group, if any. */
  groupNameOf?: (groupId: number) => string | null | undefined;
}

/** A slot as plain text. */
export function slotText(
  slot: TxSlot,
  t: TFunction,
  language: string,
  names: TextNames = {}
): string {
  switch (slot.kind) {
    case 'account': {
      if (!slot.address) return String(t('explorer:tx.unknown_account'));
      const name = names.nameOf?.(slot.address);
      return name ? visibleName(name) : shortAddress(slot.address);
    }
    case 'amount':
      return formatList(
        slot.amounts.map((amount) => amountText(amount, t, language)),
        language
      );
    case 'asset':
      return assetText(slot.asset);
    case 'name':
    case 'text':
      return visibleName(slot.kind === 'name' ? slot.name : slot.text);
    case 'group':
      if (slot.groupId !== null && isMinterGroup(slot.groupId)) return 'MINTER';
      if (slot.name) return visibleName(slot.name);
      if (slot.groupId === null) return '?';
      return names.groupNameOf?.(slot.groupId) ?? `#${slot.groupId}`;
    case 'tx':
      return slot.signature ? `${slot.signature.slice(0, 8)}…` : '?';
    case 'number':
      return formatCount(slot.value, language);
    case 'percent':
      return formatPercent(slot.value, language);
    case 'service':
      return String(t(`explorer:tx.service.${slot.key}`));
    case 'type':
      return typeTitle(slot.type, t);
  }
}

/** The whole sentence as plain text. */
export function sentenceText(
  sentence: TxSentenceSpec,
  t: TFunction,
  language: string,
  names: TextNames = {}
): string {
  return sentencePieces(sentence, t)
    .map((piece) =>
      piece.kind === 'text'
        ? piece.text
        : slotText(piece.slot, t, language, names)
    )
    .join('');
}
