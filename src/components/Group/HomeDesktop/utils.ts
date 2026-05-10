import { alpha, type Theme } from '@mui/material/styles';
import type { ApiKey } from '../../../types/auth';
import { nodeDisplay } from '../../../utils/helpers';
import { GROUP_ACTIVITY_BLUE } from '../groupActivityColorSystem';
import {
  HOME_CUSTOMIZABLE_CARD_MAX_HEIGHTS,
  HOME_CUSTOMIZABLE_CARD_MIN_HEIGHTS,
  HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT,
  WALLET_ACTIVITY_RECENT_PAYMENT_LOOKBACK_MS,
} from './homeDesktopConstants';
import type {
  HomeCustomizableCardId,
  HomeCustomizableCardsLayout,
  HomeLayoutDebugMetric,
  MinterInfoView,
  WalletActivityDirection,
  WalletActivityTransaction,
} from './types';

export function normalizeDashboardNodeUrl(url?: string | null) {
  return (url || '').trim().replace(/\/+$/, '');
}

export function getDashboardNodeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return nodeDisplay(url);
  }
}

export function normalizeDashboardCustomNodes(nodes: unknown): ApiKey[] {
  if (!Array.isArray(nodes)) return [];

  return nodes
    .map((node) => ({
      url:
        typeof node?.url === 'string'
          ? normalizeDashboardNodeUrl(node.url)
          : '',
      apikey: typeof node?.apikey === 'string' ? node.apikey : '',
      name: typeof node?.name === 'string' ? node.name.trim() : '',
    }))
    .filter((node) => Boolean(node.url));
}

export const isWalletActivityTimestampRecent = (timestamp: number) =>
  Date.now() - timestamp <= WALLET_ACTIVITY_RECENT_PAYMENT_LOOKBACK_MS;

export function formatWalletActivityRelativeTime(
  timestamp: number,
  now: number,
  tDashboard: (
    key: string,
    options?: { count?: number }
  ) => string
) {
  const elapsedMs = Math.max(0, now - timestamp);
  const elapsedMinutes = Math.floor(elapsedMs / 60000);

  if (elapsedMinutes < 1) {
    return tDashboard('wallet_activity_relative_just_now');
  }

  if (elapsedMinutes < 60) {
    return tDashboard('wallet_activity_relative_minutes_ago', {
      count: elapsedMinutes,
    });
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return tDashboard('wallet_activity_relative_hours_ago', {
      count: elapsedHours,
    });
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return tDashboard('wallet_activity_relative_days_ago', {
    count: elapsedDays,
  });
}

export function formatWalletActivityAmount(
  amount: number,
  direction: WalletActivityDirection
) {
  return `${direction === 'outgoing' ? '-' : '+'}${Math.abs(amount).toFixed(2)} QORT`;
}

export function getWalletActivityCreatorAddress(
  transaction: WalletActivityTransaction
) {
  return (
    transaction.creatorAddress ||
    transaction.senderAddress ||
    transaction.sender ||
    transaction.creator ||
    ''
  ).trim();
}

export function getWalletActivityRecipientAddress(
  transaction: WalletActivityTransaction
) {
  return (transaction.recipient || transaction.recipientAddress || '').trim();
}

export function parseMinterInfoView(value: string | null): MinterInfoView {
  return value === 'progress' ? 'progress' : 'dots';
}

export function clampHomeCustomizableCardHeight(
  cardId: HomeCustomizableCardId,
  value: number
) {
  return Math.max(
    HOME_CUSTOMIZABLE_CARD_MIN_HEIGHTS[cardId],
    Math.min(HOME_CUSTOMIZABLE_CARD_MAX_HEIGHTS[cardId], Math.round(value))
  );
}

export function parseHomeCustomizableCardsLayout(
  rawValue: string | null
): HomeCustomizableCardsLayout {
  if (!rawValue) {
    return {
      heights: {},
      order: HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT,
    };
  }

  try {
    const parsed = JSON.parse(rawValue);
    const parsedOrder = Array.isArray(parsed?.order)
      ? parsed.order.filter(
          (value): value is HomeCustomizableCardId =>
            value === 'groupActivity' || value === 'quitter'
        )
      : [];
    const order =
      parsedOrder.length === HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT.length &&
      HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT.every((value) =>
        parsedOrder.includes(value)
      )
        ? parsedOrder
        : HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT;

    const nextHeights: Partial<Record<HomeCustomizableCardId, number>> = {};
    const parsedHeights = parsed?.heights ?? {};

    HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT.forEach((cardId) => {
      const height = parsedHeights?.[cardId];
      if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
        nextHeights[cardId] = clampHomeCustomizableCardHeight(cardId, height);
      }
    });

    return {
      heights: nextHeights,
      order,
    };
  } catch {
    return {
      heights: {},
      order: HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT,
    };
  }
}

export function measureHomeLayoutDebugMetric(
  node: HTMLElement,
  rootRect: DOMRect
): HomeLayoutDebugMetric {
  const rect = node.getBoundingClientRect();

  return {
    bottom: rect.bottom - rootRect.top,
    height: rect.height,
    left: rect.left - rootRect.left,
    top: rect.top - rootRect.top,
    width: rect.width,
  };
}

export function nodeMenuItemSx(theme: Theme, selected: boolean) {
  return {
    alignItems: 'center',
    borderRadius: '8px',
    color: selected
      ? theme.palette.mode === 'dark'
        ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.96)
        : alpha(GROUP_ACTIVITY_BLUE.pressed, 0.94)
      : alpha(theme.palette.text.primary, 0.9),
    display: 'flex',
    gap: '12px',
    minHeight: 52,
    px: 1.15,
    py: 0.9,
    '&.Mui-disabled': {
      color: alpha(theme.palette.text.secondary, 0.52),
      opacity: 1,
    },
    '&:hover': {
      backgroundColor: alpha(
        GROUP_ACTIVITY_BLUE.primary,
        theme.palette.mode === 'dark' ? 0.12 : 0.08
      ),
    },
  };
}
