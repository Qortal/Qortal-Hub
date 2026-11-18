export const STAGENET_DAEMON = 'https://xmr.nodely.dev:38089';
export interface MoneroOpenRequest {
  qortalAddress: string;
  network: 'stagenet';
  address: string;
  privateSpendKey: string;
  restoreHeight: number;
}
export interface MoneroPendingPayment {
  txId: string;
  recipient: string;
  amountAtomic: string;
  feeAtomic: string;
}
export interface MoneroTransaction {
  txId: string;
  incoming: boolean;
  amountAtomic: string;
  feeAtomic: string;
  confirmations: number;
  timestamp: number | null;
}
export interface MoneroWalletStatus {
  network: 'stagenet';
  address: string;
  daemonUrl: string;
  initialized: boolean;
  syncing: boolean;
  synced: boolean;
  walletHeight: number;
  daemonHeight: number;
  progress: number;
  balanceAtomic: string;
  unlockedBalanceAtomic: string;
  transactions: MoneroTransaction[];
  pending: MoneroPendingPayment | null;
  error: string | null;
}
export interface MoneroPreparedPayment extends MoneroPendingPayment {
  id: string;
  expiresAt: number;
}
export type MoneroResult<T> =
  | { result: T; error?: never }
  | { error: string; result?: never };
