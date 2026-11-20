import i18n from 'i18next';
import {
  AT_ADDRESS_VERSION,
  isValidAddressWithVersion,
  isValidQortalAddress,
} from '../encryption/addressKeyCheck';
import { ADDRESS_VERSION } from '../constants/constants';

/**
 * Checks used between "the user approved a payment" and "Hub signs it".
 *
 * - Amounts are parsed as plain decimals, rounded to 8 places. "1e3", "0x10",
 *   "Infinity" and negative values are refused, and the dialog shows the value
 *   that will be signed, not the text a Q-App sent.
 * - The fee is fetched again just before signing. It may not be higher than
 *   the fee the user approved, and never above a fixed ceiling.
 * - A recipient name is checked before it is put in a node path, and the
 *   owner address the node returns must be a valid Qortal address.
 */

/**
 * True for an address QORT or an asset can be sent to: an account address
 * ("Q…") or an AT address ("A…", e.g. a crowdfund), with a valid checksum.
 * Core accepts both as PAYMENT and TRANSFER_ASSET recipients.
 */
export function isValidPaymentAddress(address: unknown): address is string {
  return isValidAddressWithVersion(address, [
    ADDRESS_VERSION,
    AT_ADDRESS_VERSION,
  ]);
}

const DECIMALS = 8;
const ATOMIC_PER_UNIT = BigInt(100000000);
const DECIMAL_TEXT = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
/** The largest amount a transaction holds, in 1e-8 units (a signed int64). */
const MAX_TRANSACTION_AMOUNT = BigInt('9223372036854775807');

/**
 * The highest fee Hub signs for a PAYMENT or TRANSFER_ASSET, in QORT. Core's
 * fee for these is 0.01 QORT; the ceiling leaves room for a fee change.
 */
export const MAX_VALUE_TRANSFER_FEE_QORT = '1';

export type ParsedAmount = {
  /** Amount in 1e-8 units. */
  atomic: bigint;
  /** Normalised decimal text, without trailing zeros ("1.5", "0.00000001"). */
  text: string;
  /** Number to hand to the transaction builder. */
  value: number;
};

export class InvalidAmountError extends Error {
  constructor() {
    super(
      i18n.t('core:message.error.invalid_amount', {
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'InvalidAmountError';
  }
}

/** 150000000 (atomic) -> "1.5". */
export function formatAtomicAmount(atomic: bigint): string {
  const negative = atomic < BigInt(0);
  const abs = negative ? -atomic : atomic;
  const whole = (abs / ATOMIC_PER_UNIT).toString();
  const fraction = (abs % ATOMIC_PER_UNIT)
    .toString()
    .padStart(DECIMALS, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Parses an amount strictly. Strings must be plain decimals (surrounding
 * spaces are ignored); more than 8 places are rounded half-up to 8, digit by
 * digit. Numbers must be finite and are rounded as the transaction builders
 * round them, Math.round(value * 1e8), so the `value` of a parsed amount
 * parses back to the same amount. An amount that is zero after rounding is
 * refused unless `allowZero` is set; one too large for a transaction, or one
 * the builders can't sign exactly, is always refused. Throws
 * InvalidAmountError.
 */
export function parseDecimalAmount(
  value: unknown,
  { allowZero = false }: { allowZero?: boolean } = {}
): ParsedAmount {
  let atomic: bigint;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new InvalidAmountError();
    const signed = Math.round(value * 1e8);
    if (!Number.isFinite(signed)) throw new InvalidAmountError();
    atomic = BigInt(signed);
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (!DECIMAL_TEXT.test(text)) throw new InvalidAmountError();
    const [wholeText, fractionText = ''] = text.split('.');
    atomic =
      BigInt(wholeText || '0') * ATOMIC_PER_UNIT +
      BigInt(fractionText.slice(0, DECIMALS).padEnd(DECIMALS, '0'));
    // Half-up on the first dropped digit: "0.123456785" is 0.12345679.
    if (fractionText.length > DECIMALS && fractionText[DECIMALS] >= '5') {
      atomic += BigInt(1);
    }
  } else {
    throw new InvalidAmountError();
  }
  if (atomic === BigInt(0) && !allowZero) throw new InvalidAmountError();
  if (atomic > MAX_TRANSACTION_AMOUNT) throw new InvalidAmountError();

  const normalised = formatAtomicAmount(atomic);
  const numeric = Number(normalised);
  // The builders sign Math.round(value * 1e8); refuse anything that would not
  // come out as exactly this amount.
  if (BigInt(Math.round(numeric * 1e8)) !== atomic) {
    throw new InvalidAmountError();
  }
  return { atomic, text: normalised, value: numeric };
}

export class FeeNotApprovedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeNotApprovedError';
  }
}

function hasApprovedFee(approvedFee: unknown): boolean {
  return (
    approvedFee !== undefined && approvedFee !== null && approvedFee !== ''
  );
}

/**
 * Checks the fee the node gave just before signing. Returns `nodeFee`
 * unchanged when it is no higher than `approvedFee` (when one is given) and no
 * higher than MAX_VALUE_TRANSFER_FEE_QORT; throws FeeNotApprovedError
 * otherwise. Nothing is signed after a throw.
 */
export function checkValueTransferFee<T>(nodeFee: T, approvedFee?: unknown): T {
  let fee: ParsedAmount;
  try {
    fee = parseDecimalAmount(nodeFee, { allowZero: true });
  } catch {
    throw new FeeNotApprovedError(
      i18n.t('question:message.error.fee_invalid', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const ceiling = parseDecimalAmount(MAX_VALUE_TRANSFER_FEE_QORT);
  if (fee.atomic > ceiling.atomic) {
    throw new FeeNotApprovedError(
      i18n.t('question:message.error.fee_above_limit', {
        fee: fee.text,
        limit: ceiling.text,
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  if (hasApprovedFee(approvedFee)) {
    let approved: ParsedAmount;
    try {
      approved = parseDecimalAmount(approvedFee, { allowZero: true });
    } catch {
      throw new FeeNotApprovedError(
        i18n.t('question:message.error.fee_invalid', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
    if (fee.atomic > approved.atomic) {
      throw new FeeNotApprovedError(
        i18n.t('question:message.error.fee_above_approved', {
          fee: fee.text,
          approved: approved.text,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  }
  return nodeFee;
}

export class InvalidAssetIdError extends Error {
  constructor() {
    super(
      i18n.t('question:message.error.invalid_asset_id', {
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'InvalidAssetIdError';
  }
}

/**
 * A Core asset id: a non-negative safe integer, given as a number or as a
 * string of digits. Anything else is refused with InvalidAssetIdError before
 * the transaction is built.
 */
export function parseAssetId(value: unknown): number {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return value;
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    const id = Number(value);
    if (Number.isSafeInteger(id)) return id;
  }
  throw new InvalidAssetIdError();
}

/** Core's limit for a registered name, in UTF-8 bytes. */
const MAX_NAME_BYTES = 40;

function isControlOrInvisible(code: number): boolean {
  return (
    code <= 0x1f || // C0 controls
    (code >= 0x7f && code <= 0x9f) || // DEL, C1 controls
    code === 0xad || // soft hyphen
    (code >= 0x200b && code <= 0x200f) || // zero-width, LRM/RLM
    (code >= 0x202a && code <= 0x202e) || // bidi embedding/override
    (code >= 0x2060 && code <= 0x206f) || // word joiner, bidi isolates
    code === 0xfeff // BOM
  );
}

function hasControlOrInvisibleCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (isControlOrInvisible(value.charCodeAt(i))) return true;
  }
  return false;
}

/**
 * True for text that can be a registered Qortal name and is looked up as one
 * /names/<name> path segment: 1-40 UTF-8 bytes, no surrounding or repeated
 * whitespace, no control or invisible characters, no "/" or "\", and not "."
 * or "..".
 */
export function isLookupSafeName(name: unknown): name is string {
  if (typeof name !== 'string' || !name) return false;
  if (name !== name.trim()) return false;
  if (/\s{2,}/.test(name) || /[^\S ]/.test(name)) return false;
  if (hasControlOrInvisibleCharacter(name)) return false;
  if (/[/\\]/.test(name)) return false;
  if (name === '.' || name === '..') return false;
  return new TextEncoder().encode(name).length <= MAX_NAME_BYTES;
}

export class InvalidRecipientError extends Error {
  constructor() {
    super(
      i18n.t('question:message.error.invalid_receiver', {
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'InvalidRecipientError';
  }
}

export class RecipientNameNotFoundError extends Error {
  constructor() {
    super(
      i18n.t('auth:message.error.name_not_existing', {
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'RecipientNameNotFoundError';
  }
}

/** A recipient name with characters that utils/hasInvisibleCharacters flags. */
export class RecipientInvisibleCharactersError extends Error {
  constructor() {
    super(
      i18n.t('question:message.error.recipient_invisible_characters', {
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'RecipientInvisibleCharactersError';
  }
}

/**
 * The node gave no usable answer for a name: an error other than its answer
 * for an unknown name, a reply that isn't JSON, or no reply at all.
 */
export class RecipientLookupFailedError extends Error {
  constructor(name: string) {
    super(
      i18n.t('question:message.error.recipient_lookup_failed', {
        name,
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'RecipientLookupFailedError';
  }
}

export type ResolvedRecipient = {
  /** The address the payment goes to. */
  address: string;
  /** The registered name that was given, as Core spells it; '' for an address. */
  name: string;
};

/**
 * Builds the recipient from the node's /names/<name> answer. The owner must be
 * a valid Qortal account address; otherwise InvalidRecipientError.
 */
export function recipientFromNameRecord(
  requestedName: string,
  record: unknown
): ResolvedRecipient {
  const data = (record && typeof record === 'object' ? record : {}) as {
    owner?: unknown;
    name?: unknown;
  };
  if (!isValidQortalAddress(data.owner)) throw new InvalidRecipientError();
  const name =
    typeof data.name === 'string' && isLookupSafeName(data.name)
      ? data.name
      : requestedName;
  return { address: data.owner, name };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "name (address)" for a named recipient, the address otherwise. */
export function recipientDisplayLabel(
  recipient: ResolvedRecipient,
  t: Translate = (key, options) => i18n.t(key, options) as string
): string {
  if (!recipient.name) return recipient.address;
  return t('question:recipient_name_address', {
    name: recipient.name,
    address: recipient.address,
  });
}
