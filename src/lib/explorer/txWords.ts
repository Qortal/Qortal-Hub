/**
 * One transaction in plain words, for the Explorer: a sentence told from
 * the account whose page it is ("Sent 15 QORT to Publisher", "Received 15
 * QORT from Publisher", or "Publisher sent 15 QORT to Second" with no
 * viewpoint), how its group approval ended when it needs one, which way it
 * went, the accounts involved, and the type's own fields for an opened row.
 *
 * Pure and without text: a sentence is a key under `explorer:tx.say` with
 * its slots (the accounts, amounts, names, groups and transactions it
 * names), one key per type and side, so every language words the whole
 * sentence and orders its slots itself. TxSentence.tsx puts it on screen,
 * the slots as links where they open something; `sentenceText.ts` makes the
 * same sentence plain text.
 *
 * What is never said: a message's content (not even an unencrypted one,
 * nor an AT's message); the identifier or anything else of a resource
 * published under a private QDN service (`…_PRIVATE`, and MAIL); and the
 * fields only the raw JSON shows (`txGroupId`, `timeToLive` and the like).
 * Whether a resource under a public service is encrypted (a private Q-App
 * is an encrypted DOCUMENT) the transaction can't tell, so it reads as any.
 */
import { MINTER_GROUP_ID, NULL_ACCOUNT, type TxRow } from './reads';
import { isPrivateService, serviceName, serviceWordKey } from './qdnServices';

// ---- What a sentence is made of -------------------------------------------------------

/**
 * An asset: 0 is QORT; null when it has no number yet (a new asset gets
 * one only once a block takes its ISSUE_ASSET). The name is the one the
 * transaction carries, if any.
 */
export interface AssetRef {
  id: number | null;
  name: string | null;
}

export interface Amount {
  /** Core's decimal text, exact ("15.00000000"). */
  amount: string;
  asset: AssetRef;
}

export type TxSlot =
  /**
   * An account; null when the transaction doesn't name a valid one.
   * `maker`: the account that made the transaction.
   */
  | { kind: 'account'; address: string | null; maker?: boolean }
  /** One amount, or several joined as a list ("0.3 QORT and 1 asset #5"). */
  | { kind: 'amount'; amounts: Amount[] }
  /** An asset by itself ("Contraband Coin", "asset #90"). */
  | { kind: 'asset'; asset: AssetRef }
  /** A registered name. */
  | { kind: 'name'; name: string }
  /**
   * A group, by its name once read (MINTER by its own), or by the name the
   * transaction carries (CREATE_GROUP: the only name a group has, and the
   * only one while its number isn't assigned yet). Null when it names none.
   */
  | { kind: 'group'; groupId: number | null; name?: string | null }
  /** A transaction it points at; null when it names none. */
  | { kind: 'tx'; signature: string | null }
  /** Someone's own text (a poll's or an AT's name): isolated, never translated. */
  | { kind: 'text'; text: string }
  | { kind: 'number'; value: number }
  /** A percent as Core writes it ("5.50"). */
  | { kind: 'percent'; value: string }
  /** What a QDN publish was, in words: `explorer:tx.service.<key>`. */
  | { kind: 'service'; key: string }
  /** A transaction type, by its name in words (`explorer:tx_type`). */
  | { kind: 'type'; type: string };

export interface TxSentenceSpec {
  /** Its key under `explorer:tx.say`, such as `transfer.out`. */
  key: string;
  slots: Record<string, TxSlot>;
  /** Picks the plural form of a counted sentence. */
  count?: number;
}

export type TxFieldValue =
  | TxSlot
  /** A small sentence of its own (one payment of a multi-payment). */
  | { kind: 'sentence'; sentence: TxSentenceSpec }
  /** A word: `explorer:tx.value.<key>`. */
  | { kind: 'word'; key: string }
  /** The group approval's state: `explorer:tx.approval.<key>`. */
  | { kind: 'approval'; key: string }
  /** Core's own text, shown as it is (an identifier, a service, tags). */
  | { kind: 'raw'; text: string }
  | { kind: 'size'; bytes: number }
  /** A poll option, counted from 1. */
  | { kind: 'option'; number: number }
  /** Someone's own texts, as a list (a poll's options). */
  | { kind: 'texts'; texts: string[] }
  /** A price and the pair it is quoted in. */
  | { kind: 'price'; amount: string; pair: string | null }
  /** A number as Core writes it ("9999999.00000000"), shown exactly. */
  | { kind: 'decimal'; text: string }
  | { kind: 'flags'; and: string; or: string; xor: string };

export interface TxField {
  /** Its label's key under `explorer:tx.field`. */
  label: string;
  value: TxFieldValue;
}

/** How a transaction's group approval ended, when it isn't approved (or needed). */
export type TxOutcome = 'pending' | 'rejected' | 'expired' | 'invalid';

export type TxDirection = 'in' | 'out' | 'self' | 'none';

export interface TxWords {
  sentence: TxSentenceSpec;
  /** Said after the sentence: it waits for, failed or never got group approval. */
  outcome: TxOutcome | null;
  /**
   * From the viewpoint: `out` = it made this and another account is
   * involved; `in` = another account made it and it involves this one;
   * `self` = it made this and no other account is involved; `none` = no
   * viewpoint, or the viewpoint isn't involved.
   */
  direction: TxDirection;
  /** Every account involved, the one that made it first (an AT's own address for an AT). */
  participants: string[];
  /** The type's own fields, for an opened row. */
  fields: TxField[];
}

export interface TxWordsOptions {
  /** The account whose page this is. */
  viewpoint?: string | null;
  /** A minting-level move's recipient, read from its raw bytes (Core's JSON leaves it out). */
  privsRecipient?: string | null;
}

// ---- Small helpers ---------------------------------------------------------------------

const ACCOUNT_RE = /^[QA][1-9A-HJ-NP-Za-km-z]{33}$/;

function isAccount(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_RE.test(value);
}

const ATOMIC = 100_000_000n;

/** "1.5" → 150000000n (8 decimals); null for anything that isn't an amount. */
export function toAtomic(value: unknown): bigint | null {
  const match = String(value ?? '')
    .trim()
    .match(/^(\d+)(?:\.(\d{1,8}))?$/);
  if (!match) return null;
  return BigInt(match[1]) * ATOMIC + BigInt((match[2] ?? '').padEnd(8, '0'));
}

function fromAtomic(value: bigint): string {
  return `${value / ATOMIC}.${(value % ATOMIC).toString().padStart(8, '0')}`;
}

function positive(amount: unknown): boolean {
  const atomic = toAtomic(amount);
  return atomic !== null && atomic > 0n;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The asset of `id`. An amount without an asset is QORT (a PAYMENT names
 * none); an asset a transaction is about, without its number, has none yet.
 */
function assetOf(id: unknown, name?: unknown, missingIsQort = true): AssetRef {
  const missing = id === undefined || id === null || id === '';
  const n = missing ? (missingIsQort ? 0 : NaN) : Number(id);
  return {
    id: Number.isFinite(n) ? n : null,
    name: typeof name === 'string' && name.trim() ? name : null,
  };
}

const QORT: AssetRef = { id: 0, name: null };

const account = (address: unknown): TxSlot => ({
  kind: 'account',
  address: isAccount(address) ? address : null,
});
const amountSlot = (amounts: Amount[]): TxSlot => ({
  kind: 'amount',
  amounts,
});
const one = (amount: unknown, asset: AssetRef): TxSlot =>
  amountSlot([{ amount: String(amount ?? '0'), asset }]);
const nameSlot = (name: string): TxSlot => ({ kind: 'name', name });
const textSlot = (text: string): TxSlot => ({ kind: 'text', text });
const groupSlot = (
  groupId: number | null,
  name: string | null = null
): TxSlot => ({
  kind: 'group',
  groupId,
  ...(name ? { name } : {}),
});

interface Ctx {
  tx: TxRow;
  /** The viewpoint, when there is one. */
  me: string | null;
  /** Who made it (an AT's own address for an AT; null for Core's own null account). */
  actor: string | null;
  /** The viewpoint made it. */
  mine: boolean;
}

/** The account that made it, marked so a sentence that needs it can be told apart. */
const maker = (c: Ctx): TxSlot => ({
  kind: 'account',
  address: c.actor,
  maker: true,
});

interface Built {
  key: string;
  slots?: Record<string, TxSlot>;
  count?: number;
  /** Falsy entries are left out. */
  fields?: Array<TxField | null | false | '' | undefined | 0>;
  /** The accounts it involves besides the one that made it. */
  others?: unknown[];
  /** Overrides the direction worked out from the accounts. */
  direction?: TxDirection;
}

const field = (label: string, value: TxFieldValue | null): TxField | null =>
  value ? { label, value } : null;

const textField = (label: string, value: unknown): TxField | null =>
  str(value) ? { label, value: textSlot(str(value)) } : null;

const rawField = (label: string, value: unknown): TxField | null =>
  str(value) ? { label, value: { kind: 'raw', text: str(value) } } : null;

const yesNo = (label: string, value: unknown): TxField | null =>
  typeof value === 'boolean'
    ? { label, value: { kind: 'word', key: value ? 'yes' : 'no' } }
    : null;

/** "mine" when the viewpoint made it, otherwise "none" with who made it. */
function act(c: Ctx, base: string, slots: Record<string, TxSlot> = {}) {
  return c.mine
    ? { key: `${base}.mine`, slots }
    : { key: `${base}.none`, slots: { actor: maker(c), ...slots } };
}

/**
 * A change done to another account: `out` when the viewpoint made it,
 * `in` when it was done to the viewpoint, `none` otherwise.
 */
function toward(
  c: Ctx,
  base: string,
  subject: string | null,
  subjectSlot: string,
  slots: Record<string, TxSlot> = {}
) {
  if (c.mine)
    return {
      key: `${base}.out`,
      slots: { [subjectSlot]: account(subject), ...slots },
    };
  if (subject && subject === c.me)
    return { key: `${base}.in`, slots: { actor: maker(c), ...slots } };
  return {
    key: `${base}.none`,
    slots: {
      actor: maker(c),
      [subjectSlot]: account(subject),
      ...slots,
    },
  };
}

// ---- Group approval --------------------------------------------------------------------

/** The types whose change itself waits for a group's admins to approve it. */
const GATED: ReadonlySet<string> = new Set([
  'GROUP_INVITE',
  'CANCEL_GROUP_INVITE',
  'GROUP_KICK',
  'GROUP_BAN',
  'CANCEL_GROUP_BAN',
  'ADD_GROUP_ADMIN',
  'REMOVE_GROUP_ADMIN',
  'UPDATE_GROUP',
]);

function outcomeOf(tx: TxRow): TxOutcome | null {
  switch (tx.approvalStatus) {
    case 'PENDING':
      return 'pending';
    case 'REJECTED':
      return 'rejected';
    case 'EXPIRED':
      return 'expired';
    case 'INVALID':
      return 'invalid';
    default:
      return null;
  }
}

/** A change that hasn't happened (it waits for, or didn't get, group approval) is a proposal. */
function proposed(
  c: Ctx,
  said: { key: string; slots: Record<string, TxSlot> }
) {
  return GATED.has(c.tx.type) && outcomeOf(c.tx)
    ? { ...said, key: `${said.key}_proposed` }
    : said;
}

// ---- Each type -------------------------------------------------------------------------

/** PAYMENT, TRANSFER_ASSET and an AT's payout: who sent what to whom. */
function transfer(c: Ctx, recipient: unknown, amount: TxSlot) {
  const to = isAccount(recipient) ? recipient : null;
  if (to && to === c.actor)
    return c.mine
      ? { key: 'transfer.self_mine', slots: { amount } }
      : { key: 'transfer.self', slots: { actor: maker(c), amount } };
  if (c.mine)
    return { key: 'transfer.out', slots: { amount, to: account(to) } };
  if (to && to === c.me)
    return { key: 'transfer.in', slots: { amount, from: maker(c) } };
  return {
    key: 'transfer.none',
    slots: { from: maker(c), amount, to: account(to) },
  };
}

interface PaymentRow {
  recipient: string;
  amount: string;
  asset: AssetRef;
}

function paymentsOf(tx: TxRow): PaymentRow[] {
  const rows = Array.isArray(tx.payments)
    ? (tx.payments as Array<Record<string, unknown>>)
    : [];
  return rows
    .filter((row) => row && isAccount(row.recipient))
    .map((row) => ({
      recipient: row.recipient as string,
      amount: String(row.amount ?? '0'),
      asset: assetOf(row.assetId, row.assetName),
    }));
}

/** Totals per asset, in first-seen order ("12 QORT", "5 asset #90"). */
function totals(rows: readonly PaymentRow[]): Amount[] {
  const sums = new Map<number, { asset: AssetRef; sum: bigint }>();
  for (const row of rows) {
    const held = sums.get(row.asset.id) ?? { asset: row.asset, sum: 0n };
    held.sum += toAtomic(row.amount) ?? 0n;
    sums.set(row.asset.id, held);
  }
  const amounts = [...sums.values()].map(({ asset, sum }) => ({
    amount: fromAtomic(sum),
    asset,
  }));
  return amounts.length ? amounts : [{ amount: '0', asset: QORT }];
}

function paymentFields(rows: readonly PaymentRow[]): TxField[] {
  return rows.map((row) => ({
    label: 'payment',
    value: {
      kind: 'sentence',
      sentence: {
        key: 'payment_line',
        slots: {
          amount: one(row.amount, row.asset),
          to: account(row.recipient),
        },
      },
    },
  }));
}

function multiPayment(c: Ctx): Built {
  const rows = paymentsOf(c.tx);
  const recipients = [...new Set(rows.map((row) => row.recipient))];
  const fields = paymentFields(rows);
  // To one account it reads as a payment to it.
  if (recipients.length === 1)
    return {
      ...transfer(c, recipients[0], amountSlot(totals(rows))),
      fields,
      others: recipients,
    };
  const count = recipients.length;
  const accounts: TxSlot = { kind: 'number', value: count };
  let said: Built;
  if (c.mine)
    said = {
      key: 'multi.out',
      slots: { accounts, amount: amountSlot(totals(rows)) },
      count,
    };
  else if (c.me && recipients.includes(c.me))
    said = {
      key: 'multi.in',
      slots: {
        amount: amountSlot(
          totals(rows.filter((row) => row.recipient === c.me))
        ),
        from: maker(c),
        accounts,
      },
      count,
    };
  else
    said = {
      key: 'multi.none',
      slots: {
        actor: maker(c),
        accounts,
        amount: amountSlot(totals(rows)),
      },
      count,
    };
  return { ...said, fields, others: recipients };
}

function rewardShare(c: Ctx): Built {
  const { tx } = c;
  const recipient = isAccount(tx.recipient) ? tx.recipient : null;
  const removal = Number(tx.sharePercent) < 0;
  const percent: TxSlot = { kind: 'percent', value: str(tx.sharePercent) };
  const fields = [
    recipient && recipient !== c.actor
      ? field('recipient', account(recipient))
      : null,
    field(
      'share',
      removal ? { kind: 'word', key: 'removed' } : (percent as TxFieldValue)
    ),
  ];
  if (recipient && recipient === c.actor) {
    const base = removal ? 'reward_share.self_stop' : 'reward_share.self_start';
    return {
      key: c.mine ? `${base}_mine` : base,
      slots: c.mine ? {} : { actor: maker(c) },
      fields,
      others: [recipient],
    };
  }
  const said = removal
    ? toward(c, 'reward_share.removed', recipient, 'other')
    : toward(c, 'reward_share.started', recipient, 'other', { percent });
  return { ...said, fields, others: [recipient] };
}

function transferPrivs(
  c: Ctx,
  privsRecipient: string | null | undefined
): Built {
  const recipient = isAccount(privsRecipient)
    ? privsRecipient
    : isAccount(c.tx.recipient)
      ? c.tx.recipient
      : null;
  let said: Built;
  if (!c.mine && recipient && recipient === c.me)
    said = { key: 'transfer_privs.in', slots: { from: maker(c) } };
  else if (recipient)
    said = c.mine
      ? { key: 'transfer_privs.out', slots: { to: account(recipient) } }
      : {
          key: 'transfer_privs.none',
          slots: { actor: maker(c), to: account(recipient) },
        };
  else
    said = c.mine
      ? { key: 'transfer_privs.out_unknown' }
      : {
          key: 'transfer_privs.none_unknown',
          slots: { actor: maker(c) },
        };
  return {
    ...said,
    fields: [recipient ? field('moved_to', account(recipient)) : null],
    others: [recipient],
    direction: c.mine ? 'out' : undefined,
  };
}

function buyName(c: Ctx): Built {
  const { tx } = c;
  const name = nameSlot(str(tx.name));
  const seller = isAccount(tx.seller) ? tx.seller : null;
  const price = one(tx.amount, QORT);
  let said: Built;
  if (!c.mine && seller && seller === c.me)
    said = {
      key: 'buy_name.in',
      slots: { name, buyer: maker(c), price },
    };
  else if (c.mine)
    said = {
      key: 'buy_name.out',
      slots: { name, seller: account(seller), price },
    };
  else
    said = {
      key: 'buy_name.none',
      slots: { actor: maker(c), name, seller: account(seller), price },
    };
  return {
    ...said,
    fields: [
      field('name', name),
      field('price', price),
      seller && field('seller', account(seller)),
    ],
    others: [seller],
  };
}

function updateName(c: Ctx): Built {
  const { tx } = c;
  const name = str(tx.name);
  const newName = str(tx.newName);
  const renamed = Boolean(newName) && newName !== name;
  return {
    ...(renamed
      ? act(c, 'update_name.renamed', {
          name: nameSlot(name),
          new_name: nameSlot(newName),
        })
      : act(c, 'update_name.details', { name: nameSlot(name) })),
    fields: [
      field('name', nameSlot(name)),
      renamed && field('new_name', nameSlot(newName)),
      rawField('new_data', tx.newData),
    ],
  };
}

function arbitrary(c: Ctx): Built {
  const { tx } = c;
  const service = serviceName(tx.service);
  const name = str(tx.name);
  const encrypted = isPrivateService(service);
  const rows = paymentsOf(tx);
  const recipients = [...new Set(rows.map((row) => row.recipient))];
  const what: TxSlot = { kind: 'service', key: serviceWordKey(service) };
  let said: Built;
  if (!c.mine && c.me && recipients.includes(c.me))
    said = {
      key: 'arbitrary.in',
      slots: {
        amount: amountSlot(
          totals(rows.filter((row) => row.recipient === c.me))
        ),
        from: maker(c),
      },
    };
  else
    said = name
      ? act(c, 'arbitrary.named', { what, name: nameSlot(name) })
      : act(c, 'arbitrary.unnamed', { what });
  const serviceField = rawField('service', service);
  if (encrypted)
    // Counts only: nothing that tells what is inside, not even its identifier.
    return { ...said, fields: [serviceField], others: recipients };
  return {
    ...said,
    fields: [
      serviceField,
      name && field('name', nameSlot(name)),
      rawField('identifier', tx.identifier),
      typeof tx.size === 'number' &&
        tx.size >= 0 &&
        field('size', { kind: 'size', bytes: tx.size }),
      ...paymentFields(rows),
    ],
    others: recipients,
  };
}

function message(c: Ctx): Built {
  const { tx } = c;
  const recipient = isAccount(tx.recipient) ? tx.recipient : null;
  const amount =
    recipient && positive(tx.amount)
      ? one(tx.amount, assetOf(tx.assetId))
      : null;
  const withAmount = amount ? '_amount' : '';
  const slots: Record<string, TxSlot> = amount ? { amount } : {};
  let said: Built;
  if (!c.mine && recipient && recipient === c.me)
    said = {
      key: `message.in${withAmount}`,
      slots: { ...slots, from: maker(c) },
    };
  else if (recipient)
    said = c.mine
      ? {
          key: `message.out${withAmount}`,
          slots: { ...slots, to: account(recipient) },
        }
      : {
          key: `message.none${withAmount}`,
          slots: { ...slots, from: maker(c), to: account(recipient) },
        };
  else
    said = c.mine
      ? { key: 'message.out_nobody' }
      : { key: 'message.none_nobody', slots: { from: maker(c) } };
  // Whether it was encrypted, never what it said.
  return {
    ...said,
    fields: [yesNo('encrypted', Boolean(tx.isEncrypted))],
    others: [recipient],
  };
}

function chat(c: Ctx): Built {
  const recipient = isAccount(c.tx.recipient) ? c.tx.recipient : null;
  let said: Built;
  if (!c.mine && recipient && recipient === c.me)
    said = { key: 'chat.in', slots: { from: maker(c) } };
  else if (recipient)
    said = c.mine
      ? { key: 'chat.out', slots: { to: account(recipient) } }
      : {
          key: 'chat.none',
          slots: { from: maker(c), to: account(recipient) },
        };
  // In a group's chat: which group stays in the raw JSON (txGroupId).
  else said = act(c, 'chat.group');
  return {
    ...said,
    fields: [yesNo('encrypted', Boolean(c.tx.isEncrypted))],
    others: [recipient],
  };
}

function at(c: Ctx): Built {
  const { tx } = c;
  const recipient = isAccount(tx.recipient) ? tx.recipient : null;
  const amount = positive(tx.amount)
    ? one(tx.amount, assetOf(tx.assetId))
    : null;
  let said: Built;
  if (amount && recipient) said = transfer(c, recipient, amount);
  else if (recipient && !c.mine && recipient === c.me)
    said = { key: 'message.in', slots: { from: maker(c) } };
  else if (recipient)
    said = c.mine
      ? { key: 'message.out', slots: { to: account(recipient) } }
      : {
          key: 'message.none',
          slots: { from: maker(c), to: account(recipient) },
        };
  else
    said = c.mine
      ? { key: 'at.ran_mine' }
      : { key: 'at.ran', slots: { at: maker(c) } };
  return {
    ...said,
    fields: [isAccount(tx.atAddress) && field('at', account(tx.atAddress))],
    others: [recipient],
  };
}

function deployAt(c: Ctx): Built {
  const { tx } = c;
  const atAddress = isAccount(tx.aTAddress)
    ? tx.aTAddress
    : isAccount(tx.atAddress)
      ? tx.atAddress
      : null;
  const said =
    !c.mine && atAddress && atAddress === c.me
      ? { key: 'deploy_at.in', slots: { actor: maker(c) } }
      : act(c, 'deploy_at');
  return {
    ...said,
    fields: [
      textField('at_name', tx.name),
      textField('description', tx.description),
      rawField('at_kind', tx.aTType),
      rawField('tags', tx.tags),
      atAddress && field('at_address', account(atAddress)),
      positive(tx.amount) &&
        field('funded_with', one(tx.amount, assetOf(tx.assetId))),
    ],
    others: [atAddress],
  };
}

function groupFields(
  c: Ctx,
  subjectLabel: string | null,
  subject: unknown
): Array<TxField | null> {
  return [
    typeof c.tx.groupId === 'number'
      ? field('group', groupSlot(c.tx.groupId))
      : null,
    subjectLabel && isAccount(subject)
      ? field(subjectLabel, account(subject))
      : null,
  ];
}

/** A group's number, when the transaction gives one. */
function groupIdOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function groupTx(c: Ctx): Built {
  const { tx } = c;
  // Every group type but CANCEL_GROUP_INVITE (whose JSON leaves it out) names its group.
  // A CREATE_GROUP carries the group's name: its number comes only once a block takes it.
  const group: Record<string, TxSlot> = {
    group: groupSlot(
      groupIdOf(tx.groupId),
      tx.type === 'CREATE_GROUP' ? str(tx.groupName) || null : null
    ),
  };
  const subjectOf = (value: unknown) => (isAccount(value) ? value : null);
  switch (tx.type) {
    case 'GROUP_INVITE':
      return {
        ...proposed(
          c,
          toward(c, 'group_invite', subjectOf(tx.invitee), 'invitee', group)
        ),
        fields: groupFields(c, 'invitee', tx.invitee),
        others: [tx.invitee],
      };
    case 'CANCEL_GROUP_INVITE':
      // Core's JSON names neither the group nor the account invited.
      return {
        ...proposed(c, act(c, 'cancel_group_invite')),
        fields: groupFields(c, 'invitee', tx.invitee),
        others: [tx.invitee],
      };
    case 'GROUP_KICK':
      return {
        ...proposed(
          c,
          toward(c, 'group_kick', subjectOf(tx.member), 'member', group)
        ),
        fields: [
          ...groupFields(c, 'member', tx.member),
          textField('reason', tx.reason),
        ],
        others: [tx.member],
      };
    case 'GROUP_BAN':
      return {
        ...proposed(
          c,
          toward(c, 'group_ban', subjectOf(tx.offender), 'member', group)
        ),
        fields: [
          ...groupFields(c, 'account', tx.offender),
          textField('reason', tx.reason),
        ],
        others: [tx.offender],
      };
    case 'CANCEL_GROUP_BAN':
      return {
        ...proposed(
          c,
          toward(c, 'cancel_group_ban', subjectOf(tx.member), 'member', group)
        ),
        fields: groupFields(c, 'account', tx.member),
        others: [tx.member],
      };
    case 'ADD_GROUP_ADMIN': {
      const member = subjectOf(tx.member);
      const self = member !== null && member === c.actor;
      return {
        ...proposed(
          c,
          self
            ? act(c, 'add_group_admin.self', group)
            : toward(c, 'add_group_admin', member, 'member', group)
        ),
        fields: groupFields(c, 'new_admin', tx.member),
        others: [tx.member],
      };
    }
    case 'REMOVE_GROUP_ADMIN': {
      const admin = subjectOf(tx.admin);
      const self = admin !== null && admin === c.actor;
      return {
        ...proposed(
          c,
          self
            ? act(c, 'remove_group_admin.self', group)
            : toward(c, 'remove_group_admin', admin, 'member', group)
        ),
        fields: groupFields(c, 'admin', tx.admin),
        others: [tx.admin],
      };
    }
    case 'JOIN_GROUP':
      // Joined at once, or only asked: that depends on the group and on what
      // came before, not on this row.
      return {
        ...act(c, 'join_group', group),
        fields: groupFields(c, null, null),
      };
    case 'LEAVE_GROUP':
      return {
        ...act(c, 'leave_group', group),
        fields: groupFields(c, null, null),
      };
    case 'CREATE_GROUP':
      return {
        ...act(c, 'create_group', group),
        fields: [
          ...groupFields(c, null, null),
          textField('name', tx.groupName),
          textField('description', tx.description),
          yesNo('open', tx.isOpen),
        ],
      };
    case 'UPDATE_GROUP': {
      const newOwner = subjectOf(tx.newOwner);
      const handover = newOwner !== null && newOwner !== c.actor;
      return {
        ...proposed(
          c,
          handover
            ? toward(c, 'update_group.owner', newOwner, 'new_owner', group)
            : act(c, 'update_group.settings', group)
        ),
        fields: [
          ...groupFields(c, null, null),
          handover && field('new_owner', account(newOwner)),
          textField('new_description', tx.newDescription),
          yesNo('open', tx.newIsOpen),
        ],
        others: [newOwner],
      };
    }
    case 'SET_GROUP': {
      const id = Number(tx.defaultGroupId);
      return Number.isFinite(id) && id > 0
        ? { ...act(c, 'set_group.set', { group: groupSlot(id) }), fields: [] }
        : { ...act(c, 'set_group.cleared'), fields: [] };
    }
    case 'GROUP_APPROVAL': {
      const target = str(tx.pendingSignature) || null;
      const pending: TxSlot = { kind: 'tx', signature: target };
      return {
        ...act(
          c,
          tx.approval ? 'group_approval.approved' : 'group_approval.rejected',
          { tx: pending }
        ),
        fields: [
          field('answer', {
            kind: 'word',
            key: tx.approval ? 'approve' : 'reject',
          }),
          target && field('transaction', pending),
        ],
      };
    }
    default:
      return generic(c);
  }
}

/** A type with no sentence of its own, or one made in a way it can't be: "made a transaction: Payment". */
function generic(c: Ctx): Built {
  const type: TxSlot = { kind: 'type', type: String(c.tx.type ?? '') };
  if (c.mine) return { key: 'generic.mine', slots: { type } };
  if (c.actor) return { key: 'generic.none', slots: { actor: maker(c), type } };
  return { key: 'generic.nobody', slots: { type } };
}

/** ACCOUNT_FLAGS and ACCOUNT_LEVEL: set for an account in the genesis block. */
function inGenesis(c: Ctx, base: string, slots: Record<string, TxSlot>): Built {
  const target = isAccount(c.tx.target) ? c.tx.target : null;
  // Only the genesis block sets these; one that says otherwise reads plainly.
  if (c.actor || c.tx.blockHeight !== 1)
    return { ...generic(c), others: [target] };
  return target && target === c.me
    ? { key: `${base}.in`, slots, others: [target] }
    : {
        key: `${base}.none`,
        slots: { target: account(target), ...slots },
        others: [target],
      };
}

function accountFlags(c: Ctx): Built {
  const { tx } = c;
  return {
    ...inGenesis(c, 'account_flags', {}),
    fields: [
      isAccount(tx.target) && field('account', account(tx.target)),
      field('change', {
        kind: 'flags',
        and: String(tx.andMask ?? '?'),
        or: String(tx.orMask ?? '?'),
        xor: String(tx.xorMask ?? '?'),
      }),
    ],
  };
}

function accountLevel(c: Ctx): Built {
  const { tx } = c;
  // A level the transaction doesn't give is never said as one.
  const level =
    typeof tx.level === 'number' && Number.isFinite(tx.level) ? tx.level : null;
  return {
    ...(level === null
      ? { ...generic(c), others: [tx.target] }
      : inGenesis(c, 'account_level', {
          level: { kind: 'number', value: level },
        })),
    fields: [
      isAccount(tx.target) && field('account', account(tx.target)),
      level !== null && field('level', { kind: 'number', value: level }),
    ],
  };
}

function genesis(c: Ctx): Built {
  const { tx } = c;
  const recipient = isAccount(tx.recipient) ? tx.recipient : null;
  const amount = one(tx.amount, assetOf(tx.assetId, tx.assetName));
  return {
    ...(recipient && recipient === c.me
      ? { key: 'genesis.in', slots: { amount } }
      : { key: 'genesis.none', slots: { to: account(recipient), amount } }),
    others: [recipient],
  };
}

function createPoll(c: Ctx): Built {
  const { tx } = c;
  const owner = isAccount(tx.owner) ? tx.owner : null;
  const poll = textSlot(str(tx.pollName));
  const options = Array.isArray(tx.pollOptions)
    ? (tx.pollOptions as Array<{ optionName?: unknown }>)
        .map((option) => str(option?.optionName))
        .filter(Boolean)
    : [];
  let said: Built;
  if (owner && owner !== c.actor) {
    if (!c.mine && owner === c.me)
      said = {
        key: 'create_poll.for_me',
        slots: { actor: maker(c), poll },
      };
    else
      said = c.mine
        ? {
            key: 'create_poll.owned_by_mine',
            slots: { poll, owner: account(owner) },
          }
        : {
            key: 'create_poll.owned_by',
            slots: { actor: maker(c), poll, owner: account(owner) },
          };
  } else said = act(c, 'create_poll', { poll });
  return {
    ...said,
    fields: [
      textField('poll', tx.pollName),
      textField('description', tx.description),
      options.length > 0 && field('options', { kind: 'texts', texts: options }),
      owner && owner !== c.actor && field('owner', account(owner)),
    ],
    others: [owner],
  };
}

function voteOnPoll(c: Ctx): Built {
  const { tx } = c;
  const index = Number(tx.optionIndex);
  return {
    ...act(c, 'vote_on_poll', { poll: textSlot(str(tx.pollName)) }),
    fields: [
      textField('poll', tx.pollName),
      // Counted from 1.
      Number.isInteger(index) &&
        index >= 0 &&
        field('option', { kind: 'option', number: index + 1 }),
    ],
  };
}

function issueAsset(c: Ctx): Built {
  const { tx } = c;
  // The asset by the name it issues it under: its number comes only once a block takes it.
  const name = str(tx.assetName);
  const asset: TxSlot = name
    ? textSlot(name)
    : { kind: 'asset', asset: assetOf(tx.assetId, null, false) };
  return {
    ...(c.actor || c.mine
      ? act(c, 'issue_asset', { asset })
      : // Core's own null account issued QORT and the other genesis assets.
        { key: 'issue_asset.nobody', slots: { asset } }),
    fields: [
      typeof tx.assetId === 'number' &&
        field('asset', { kind: 'raw', text: `#${tx.assetId}` }),
      tx.quantity !== undefined &&
        field('quantity', { kind: 'decimal', text: String(tx.quantity) }),
      yesNo('divisible', tx.isDivisible),
      textField('description', tx.description),
    ],
  };
}

function createAssetOrder(c: Ctx): Built {
  const { tx } = c;
  const have: TxSlot = {
    kind: 'asset',
    asset: assetOf(tx.haveAssetId, tx.haveAssetName, false),
  };
  const want: TxSlot = {
    kind: 'asset',
    asset: assetOf(tx.wantAssetId, tx.wantAssetName, false),
  };
  const amountAsset = assetOf(
    tx.amountAssetId ?? tx.haveAssetId,
    tx.amountAssetName ?? tx.haveAssetName,
    false
  );
  return {
    ...act(c, 'create_asset_order', { have, want }),
    fields: [
      tx.amount !== undefined && field('amount', one(tx.amount, amountAsset)),
      tx.price !== undefined &&
        field('price', {
          kind: 'price',
          amount: String(tx.price),
          pair: str(tx.pricePair) || null,
        }),
    ],
  };
}

function updateAsset(c: Ctx): Built {
  const { tx } = c;
  const asset: TxSlot = {
    kind: 'asset',
    asset: assetOf(tx.assetId, tx.assetName, false),
  };
  const newOwner = isAccount(tx.newOwner) ? tx.newOwner : null;
  const handover = newOwner !== null && newOwner !== c.actor;
  return {
    ...(handover
      ? toward(c, 'update_asset.owner', newOwner, 'new_owner', { asset })
      : act(c, 'update_asset.details', { asset })),
    fields: [
      handover && field('new_owner', account(newOwner)),
      textField('new_description', tx.newDescription),
    ],
    others: [newOwner],
  };
}

function enableForging(c: Ctx): Built {
  const target = isAccount(c.tx.target) ? c.tx.target : null;
  return {
    ...(target
      ? toward(c, 'enable_forging.for', target, 'target')
      : act(c, 'enable_forging')),
    others: [target],
  };
}

function describe(c: Ctx, options: TxWordsOptions): Built {
  const { tx } = c;
  switch (tx.type) {
    case 'PAYMENT': {
      const amount = one(tx.amount, QORT);
      return {
        ...transfer(c, tx.recipient, amount),
        fields: [
          field('amount', amount),
          isAccount(tx.recipient) && field('recipient', account(tx.recipient)),
        ],
        others: [tx.recipient],
      };
    }
    case 'TRANSFER_ASSET': {
      const asset = assetOf(tx.assetId, tx.assetName);
      const amount = one(tx.amount, asset);
      return {
        ...transfer(c, tx.recipient, amount),
        fields: [
          field('amount', amount),
          asset.id !== 0 &&
            field('asset', { kind: 'raw', text: `#${asset.id}` }),
          isAccount(tx.recipient) && field('recipient', account(tx.recipient)),
        ],
        others: [tx.recipient],
      };
    }
    case 'MULTI_PAYMENT':
      return multiPayment(c);
    case 'REWARD_SHARE':
      return rewardShare(c);
    case 'TRANSFER_PRIVS':
      return transferPrivs(c, options.privsRecipient);
    case 'BUY_NAME':
      return buyName(c);
    case 'SELL_NAME': {
      const name = nameSlot(str(tx.name));
      const price = one(tx.amount, QORT);
      return {
        ...act(c, 'sell_name', { name, price }),
        fields: [field('name', name), field('price', price)],
      };
    }
    case 'CANCEL_SELL_NAME': {
      const name = nameSlot(str(tx.name));
      return {
        ...act(c, 'cancel_sell_name', { name }),
        fields: [field('name', name)],
      };
    }
    case 'REGISTER_NAME': {
      const name = nameSlot(str(tx.name));
      return {
        ...act(c, 'register_name', { name }),
        fields: [field('name', name), rawField('data', tx.data)],
      };
    }
    case 'UPDATE_NAME':
      return updateName(c);
    case 'ARBITRARY':
      return arbitrary(c);
    case 'MESSAGE':
      return message(c);
    case 'CHAT':
      return chat(c);
    case 'AT':
      return at(c);
    case 'DEPLOY_AT':
      return deployAt(c);
    case 'GROUP_INVITE':
    case 'CANCEL_GROUP_INVITE':
    case 'GROUP_KICK':
    case 'GROUP_BAN':
    case 'CANCEL_GROUP_BAN':
    case 'ADD_GROUP_ADMIN':
    case 'REMOVE_GROUP_ADMIN':
    case 'JOIN_GROUP':
    case 'LEAVE_GROUP':
    case 'CREATE_GROUP':
    case 'UPDATE_GROUP':
    case 'SET_GROUP':
    case 'GROUP_APPROVAL':
      return groupTx(c);
    case 'ACCOUNT_FLAGS':
      return accountFlags(c);
    case 'ACCOUNT_LEVEL':
      return accountLevel(c);
    case 'GENESIS':
      return genesis(c);
    case 'CREATE_POLL':
      return createPoll(c);
    case 'VOTE_ON_POLL':
      return voteOnPoll(c);
    case 'PUBLICIZE':
      return act(c, 'publicize');
    case 'ISSUE_ASSET':
      return issueAsset(c);
    case 'CREATE_ASSET_ORDER':
      return createAssetOrder(c);
    case 'CANCEL_ASSET_ORDER': {
      const order = str(tx.orderId);
      return {
        ...act(c, 'cancel_asset_order'),
        fields: [order && field('order', { kind: 'tx', signature: order })],
      };
    }
    case 'UPDATE_ASSET':
      return updateAsset(c);
    case 'AIRDROP':
      return act(c, 'airdrop');
    case 'ENABLE_FORGING':
      return enableForging(c);
    case 'PRESENCE':
      return act(
        c,
        tx.presenceType === 'TRADE_BOT'
          ? 'presence.trade_bot'
          : 'presence.minting'
      );
    default:
      return generic(c);
  }
}

/** Who made it: an AT's own address for an AT; nobody for Core's null account. */
export function makerOf(tx: TxRow): string | null {
  if (tx.type === 'AT') return isAccount(tx.atAddress) ? tx.atAddress : null;
  const creator = tx.creatorAddress;
  return isAccount(creator) && creator !== NULL_ACCOUNT ? creator : null;
}

/** One transaction in words, told from `options.viewpoint` when given. */
export function describeTx(tx: TxRow, options: TxWordsOptions = {}): TxWords {
  const me = isAccount(options.viewpoint) ? options.viewpoint : null;
  const actor = makerOf(tx);
  const c: Ctx = { tx, me, actor, mine: me !== null && me === actor };
  let built = describe(c, options);
  // Made by no account Hub can name (Core's null account): never "an unknown account …".
  if (
    !actor &&
    Object.values(built.slots ?? {}).some(
      (slot) => slot.kind === 'account' && slot.maker
    )
  )
    built = { ...built, ...generic(c), count: undefined };

  const others = [
    ...new Set(
      (built.others ?? []).filter(
        (address): address is string =>
          isAccount(address) && address !== NULL_ACCOUNT && address !== actor
      )
    ),
  ];
  const participants = actor ? [actor, ...others] : others;
  let direction: TxDirection = 'none';
  if (me && c.mine) direction = others.length > 0 ? 'out' : 'self';
  else if (me && others.includes(me)) direction = 'in';
  if (built.direction && me) direction = built.direction;

  const approval =
    typeof tx.approvalStatus === 'string' &&
    tx.approvalStatus !== 'NOT_REQUIRED'
      ? field('group_approval', { kind: 'approval', key: tx.approvalStatus })
      : null;
  const fields = [...(built.fields ?? []), approval].filter((f): f is TxField =>
    Boolean(f)
  );

  return {
    sentence: {
      key: built.key,
      slots: built.slots ?? {},
      ...(built.count === undefined ? {} : { count: built.count }),
    },
    outcome: outcomeOf(tx),
    direction,
    participants,
    fields,
  };
}

/** Is it MINTER (the group whose members mint)? For the group slot's words. */
export const isMinterGroup = (groupId: number): boolean =>
  groupId === MINTER_GROUP_ID;
