import type { ApiKey } from '../../../types/auth';

export type ActivityTab = 'requests' | 'invites' | 'promotions';
export type HomeCustomizableCardId = 'groupActivity' | 'quitter';
export type DashboardInfoStatusTone = 'operational' | 'syncing' | 'issue';
export type MinterProgressSnapshot = {
  currentBlocks: number;
  currentLevel: number;
  progressRatio: number;
  requiredBlocks: number;
};
export type MinterInfoView = 'dots' | 'progress';
export type WalletActivityTransaction = {
  amount?: number | string;
  creator?: string;
  creatorAddress?: string;
  recipientAddress?: string;
  recipient?: string;
  sender?: string;
  senderAddress?: string;
  signature?: string;
  timestamp?: number | string;
};
export type WalletActivityDirection = 'incoming' | 'outgoing';
export type WalletActivityEntry = {
  amount: number;
  counterpartyAddress: string;
  counterpartyLabel: string;
  direction: WalletActivityDirection;
  timestamp: number;
};
export type DashboardNodeOption = {
  key: string;
  label: string;
  node: ApiKey;
  secondary: string;
  type: 'custom' | 'local' | 'public';
};
export type HomeCustomizableCardsLayout = {
  heights: Partial<Record<HomeCustomizableCardId, number>>;
  order: HomeCustomizableCardId[];
};
export type HomeLayoutDebugMetric = {
  bottom: number;
  height: number;
  left: number;
  top: number;
  width: number;
};
export type HomeLayoutDebugKey =
  | 'accountOverview'
  | 'featuredApps'
  | 'info'
  | 'profileCard'
  | 'tools'
  | 'walletActivity';
