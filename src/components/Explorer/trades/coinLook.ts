/**
 * Each coin's colour on the Trades tab, so a coin is the same colour in
 * every bar, chart and key: Litecoin blue, Bitcoin orange, DigiByte aqua,
 * Dogecoin yellow, Ravencoin magenta, Pirate Chain green; another coin
 * (one no chain the Explorer knows claims) grey. From the theme
 * (its info blue turned to each coin's hue, as the asset coins are), so
 * light and dark both follow; neighbours in TRADE_CHAINS order stay far
 * apart. Text never wears these colours: a key beside them names each
 * coin.
 */
import type { Theme } from '@mui/material/styles';
import {
  isTradeChain,
  type CoinKey,
  type TradeChain,
} from '../../../lib/explorer/portalTrades';
import { mutedText, withHue } from '../parts';

const COIN_HUE: Record<TradeChain, number> = {
  LITECOIN: 214,
  BITCOIN: 28,
  DIGIBYTE: 172,
  DOGECOIN: 52,
  RAVENCOIN: 318,
  PIRATECHAIN: 122,
};

/** A coin's colour; another coin, and one not known yet, the theme's muted text. */
export function coinAccent(theme: Theme, chain: CoinKey | null): string {
  return isTradeChain(chain)
    ? withHue(theme.palette.info.main, COIN_HUE[chain])
    : mutedText(theme);
}
