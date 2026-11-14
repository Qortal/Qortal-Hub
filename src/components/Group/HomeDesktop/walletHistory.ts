import type { WalletActivityEntry, WalletActivityTransaction } from './types';
import {
  getWalletActivityCreatorAddress,
  getWalletActivityRecipientAddress,
} from './utils';

/** Payments per page of the Wallet Activity history. */
export const WALLET_HISTORY_PAGE_SIZE = 20;

/** The account's confirmed payments, newest first, one page from `offset`. */
export const walletHistoryUrl = (
  baseApi: string,
  address: string,
  offset: number
) =>
  `${baseApi}/transactions/search?txType=PAYMENT&address=${encodeURIComponent(
    address
  )}&confirmationStatus=CONFIRMED&limit=${WALLET_HISTORY_PAGE_SIZE}&offset=${offset}&reverse=true`;

type WalletHistoryEntry = Omit<WalletActivityEntry, 'counterpartyLabel'>;

/**
 * A payment as the account saw it: in or out, the other side, the amount.
 * Null for anything that is not a payment to or from `userAddress`.
 */
export const walletEntryFromTransaction = (
  transaction: WalletActivityTransaction | null | undefined,
  userAddress: string
): WalletHistoryEntry | null => {
  if (!transaction || !userAddress) return null;
  const creator = getWalletActivityCreatorAddress(transaction);
  const recipient = getWalletActivityRecipientAddress(transaction);
  const timestamp = Number(transaction.timestamp);
  const amount = Number(transaction.amount);
  const outgoing = creator === userAddress;
  const incoming = recipient === userAddress;
  if (!Number.isFinite(timestamp) || !Number.isFinite(amount)) return null;
  if (!outgoing && !incoming) return null;
  const counterpartyAddress = outgoing ? recipient : creator;
  if (!counterpartyAddress) return null;
  return {
    amount,
    counterpartyAddress,
    direction: outgoing ? 'outgoing' : 'incoming',
    signature: transaction.signature,
    timestamp,
  };
};

/** "6 Oct, 14:32", with the year when it is not this year's. */
export const formatWalletHistoryDate = (
  timestamp: number,
  locale: string | undefined,
  now = Date.now()
) => {
  const date = new Date(timestamp);
  const thisYear = date.getFullYear() === new Date(now).getFullYear();
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      day: 'numeric',
      month: 'short',
      ...(thisYear ? {} : { year: 'numeric' }),
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
};

/** A long address cut to its ends, for a name that is only an address. */
export const shortWalletAddress = (address: string) =>
  address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
