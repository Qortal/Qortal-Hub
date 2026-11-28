/**
 * Qortal's transaction types in families, for the Transactions tab's
 * filters, each with an icon and a colour on screen. The list is Core's own
 * enum (Transaction.TransactionType, Core 6.1.4–6.1.9): every type belongs
 * to exactly one family, and a type Core adds later lands in Other until it
 * is placed here. Pure: no text (`explorer:tx_family.<key>` and
 * `explorer:tx_type.<type>` name them).
 */

/** Every transaction type Core knows, in Core's order (type numbers 1–41). */
export const ALL_TX_TYPES = [
  'GENESIS',
  'PAYMENT',
  'REGISTER_NAME',
  'UPDATE_NAME',
  'SELL_NAME',
  'CANCEL_SELL_NAME',
  'BUY_NAME',
  'CREATE_POLL',
  'VOTE_ON_POLL',
  'ARBITRARY',
  'ISSUE_ASSET',
  'TRANSFER_ASSET',
  'CREATE_ASSET_ORDER',
  'CANCEL_ASSET_ORDER',
  'MULTI_PAYMENT',
  'DEPLOY_AT',
  'MESSAGE',
  'CHAT',
  'PUBLICIZE',
  'AIRDROP',
  'AT',
  'CREATE_GROUP',
  'UPDATE_GROUP',
  'ADD_GROUP_ADMIN',
  'REMOVE_GROUP_ADMIN',
  'GROUP_BAN',
  'CANCEL_GROUP_BAN',
  'GROUP_KICK',
  'GROUP_INVITE',
  'CANCEL_GROUP_INVITE',
  'JOIN_GROUP',
  'LEAVE_GROUP',
  'GROUP_APPROVAL',
  'SET_GROUP',
  'UPDATE_ASSET',
  'ACCOUNT_FLAGS',
  'ENABLE_FORGING',
  'REWARD_SHARE',
  'ACCOUNT_LEVEL',
  'TRANSFER_PRIVS',
  'PRESENCE',
] as const;

export type TxType = (typeof ALL_TX_TYPES)[number];

export const isTxType = (value: unknown): value is TxType =>
  ALL_TX_TYPES.includes(value as TxType);

export type TxFamilyKey =
  | 'all'
  | 'payments'
  | 'names'
  | 'minting'
  | 'groups'
  | 'qdn'
  | 'trading'
  | 'messages'
  | 'other';

export interface TxFamily {
  key: TxFamilyKey;
  /** The types in this family. Empty for All: no type filter at all. */
  types: readonly TxType[];
}

/** The filters, in the order they show. */
export const TX_FAMILIES: readonly TxFamily[] = [
  { key: 'all', types: [] },
  { key: 'payments', types: ['PAYMENT', 'TRANSFER_ASSET', 'MULTI_PAYMENT'] },
  {
    key: 'names',
    types: [
      'REGISTER_NAME',
      'UPDATE_NAME',
      'SELL_NAME',
      'CANCEL_SELL_NAME',
      'BUY_NAME',
    ],
  },
  {
    key: 'minting',
    types: [
      'REWARD_SHARE',
      'TRANSFER_PRIVS',
      'ACCOUNT_FLAGS',
      'ACCOUNT_LEVEL',
      'ENABLE_FORGING',
    ],
  },
  {
    key: 'groups',
    types: [
      'CREATE_GROUP',
      'UPDATE_GROUP',
      'ADD_GROUP_ADMIN',
      'REMOVE_GROUP_ADMIN',
      'GROUP_BAN',
      'CANCEL_GROUP_BAN',
      'GROUP_KICK',
      'GROUP_INVITE',
      'CANCEL_GROUP_INVITE',
      'JOIN_GROUP',
      'LEAVE_GROUP',
      'GROUP_APPROVAL',
      'SET_GROUP',
    ],
  },
  { key: 'qdn', types: ['ARBITRARY'] },
  {
    key: 'trading',
    types: [
      'DEPLOY_AT',
      'AT',
      'CREATE_ASSET_ORDER',
      'CANCEL_ASSET_ORDER',
      'ISSUE_ASSET',
      'UPDATE_ASSET',
    ],
  },
  { key: 'messages', types: ['MESSAGE', 'CHAT'] },
  {
    key: 'other',
    types: [
      'GENESIS',
      'CREATE_POLL',
      'VOTE_ON_POLL',
      'PUBLICIZE',
      'AIRDROP',
      'PRESENCE',
    ],
  },
];

/** A family that holds types: every family but All. */
export type TxTypeFamily = Exclude<TxFamilyKey, 'all'>;

const FAMILY_BY_TYPE: ReadonlyMap<string, TxTypeFamily> = new Map(
  TX_FAMILIES.flatMap((family) =>
    family.types.map((type) => [type, family.key as TxTypeFamily] as const)
  )
);

/** The family a type belongs to; Other for a type Hub doesn't know. Never All. */
export function familyOf(type: string): TxTypeFamily {
  return FAMILY_BY_TYPE.get(type) ?? 'other';
}

/** The types to ask Core for. Empty for All (or an unknown key): no type filter. */
export function typesFor(familyKey: string): readonly TxType[] {
  return TX_FAMILIES.find((family) => family.key === familyKey)?.types ?? [];
}

export function isTxFamilyKey(value: unknown): value is TxFamilyKey {
  return (
    typeof value === 'string' &&
    TX_FAMILIES.some((family) => family.key === value)
  );
}

/** What the Transactions tab shows: one family, and one exact type of it or all of them. */
export interface TxFilter {
  kind: TxFamilyKey;
  /** One type of `kind`, or null for every type of it. */
  type: TxType | null;
}

export const ALL_TRANSACTIONS: TxFilter = { kind: 'all', type: null };

/** The filter as kept, made safe: an unknown kind is All, a type outside its kind none. */
export function cleanFilter(value: unknown): TxFilter {
  const raw = (value ?? {}) as Partial<TxFilter>;
  const kind = isTxFamilyKey(raw.kind) ? raw.kind : 'all';
  const type =
    kind !== 'all' && typesFor(kind).includes(raw.type as TxType)
      ? (raw.type as TxType)
      : null;
  return { kind, type };
}

/** The types the filter asks Core for: none (every type) for All. */
export function typesToAsk(filter: TxFilter): readonly TxType[] {
  return filter.type ? [filter.type] : typesFor(filter.kind);
}

/** Whether a row read is one the filter shows (for rows Core didn't filter: what waits for a block). */
export function filterMatches(filter: TxFilter, type: string): boolean {
  const types = typesToAsk(filter);
  return types.length === 0 || types.includes(type as TxType);
}

/** Is anything other than every transaction picked? */
export const isFiltered = (filter: TxFilter): boolean =>
  filter.kind !== 'all' || filter.type !== null;
