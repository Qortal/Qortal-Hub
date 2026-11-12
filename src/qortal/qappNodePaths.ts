import i18n from 'i18next';
import {
  hasControlCharacter,
  hasDotSegment,
  nodePathSegment,
} from '../utils/nodeEndpointPath';

/**
 * Checks for the values a Q-App puts into node request paths. Each value is
 * matched against what Qortal Core serves, so an action only reaches the
 * endpoint it is meant for. createEndpoint checks every path as well (see
 * utils/nodeEndpointPath.ts); these give a clear error first.
 */

type ForeignCoinTicker = 'BTC' | 'LTC' | 'DOGE' | 'DGB' | 'RVN' | 'ARRR';

/** Tickers and Core's chain names, upper case, to the ticker. */
const FOREIGN_COIN_TICKERS = new Map<string, ForeignCoinTicker>([
  ['BTC', 'BTC'],
  ['BITCOIN', 'BTC'],
  ['LTC', 'LTC'],
  ['LITECOIN', 'LTC'],
  ['DOGE', 'DOGE'],
  ['DOGECOIN', 'DOGE'],
  ['DGB', 'DGB'],
  ['DIGIBYTE', 'DGB'],
  ['RVN', 'RVN'],
  ['RAVENCOIN', 'RVN'],
  ['ARRR', 'ARRR'],
  ['PIRATECHAIN', 'ARRR'],
]);

const FOREIGN_FEE_TYPES = new Set(['feekb', 'feerequired']);

// Core keeps each list as <lists folder>/<name>.json, so a path separator in
// the name would reach outside that folder.
const LIST_NAME_SEPARATORS = /[/\\]/;

/** The ticker for a coin given as ticker or chain name in any case, or null. */
export const foreignCoinTicker = (coin: unknown): ForeignCoinTicker | null => {
  if (typeof coin !== 'string') return null;
  return FOREIGN_COIN_TICKERS.get(coin.trim().toUpperCase()) ?? null;
};

/**
 * The /crosschain/<segment>/… path segment for a coin (btc, ltc, …). Throws
 * "not supported" for anything that isn't one of the six foreign coins.
 */
export const foreignCoinPathSegment = (coin: unknown): string => {
  const ticker = foreignCoinTicker(coin);
  if (!ticker) {
    throw new Error(
      i18n.t('question:message.error.token_not_supported', {
        token: typeof coin === 'string' ? coin : String(coin ?? ''),
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  return ticker.toLowerCase();
};

/** 'feekb' or 'feerequired'; anything else throws "invalid type". */
export const foreignFeeType = (type: unknown): 'feekb' | 'feerequired' => {
  const normalized = typeof type === 'string' ? type.trim().toLowerCase() : '';
  if (!FOREIGN_FEE_TYPES.has(normalized)) {
    throw new Error(
      i18n.t('question:message.error.invalid_type', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  return normalized as 'feekb' | 'feerequired';
};

/**
 * The encoded /lists/<name> segment. Q-Apps choose their own list names
 * ("blockedNames", "followedNames_q-tube", …), so the name is checked for what
 * could leave the path or Core's lists folder, not against a fixed set.
 */
export const listNamePathSegment = (name: unknown): string => {
  if (
    typeof name !== 'string' ||
    !name ||
    LIST_NAME_SEPARATORS.test(name) ||
    hasControlCharacter(name) ||
    hasDotSegment(name)
  ) {
    throw new Error(
      i18n.t('question:message.error.invalid_list_name', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  return nodePathSegment(name);
};
