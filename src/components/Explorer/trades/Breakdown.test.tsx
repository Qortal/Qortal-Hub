import { ThemeProvider } from '@mui/material/styles';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../../i18n/i18n';
import {
  summariseAssetTrades,
  type AssetTrade,
} from '../../../lib/explorer/assetTrades';
import { darkTheme } from '../../../styles/theme-dark';
import { AssetBreakdown } from './Breakdown';

// The Trades tab's Q-Assets by asset: a price in QORT only for the units
// traded for QORT.

const SECOND = `Q${'S'.repeat(33)}`;

const trade = (
  n: number,
  gave: [number, string, string],
  got: [number, string, string]
): AssetTrade => ({
  orderId: `order${n}`,
  otherOrderId: `other${n}`,
  other: SECOND,
  timestamp: Date.UTC(2026, 6, 15, 12) + n * 86_400_000,
  initiated: true,
  gave: { asset: { id: gave[0], name: gave[1] }, amount: gave[2] },
  got: { asset: { id: got[0], name: got[1] }, amount: got[2] },
});

describe('the Q-Assets it traded, by asset', () => {
  it('prices only the units traded for QORT; those traded for other Q-Assets are apart', () => {
    const summary = summariseAssetTrades([
      trade(1, [0, 'QORT', '529.00000000'], [11, 'Gadget', '23.00000000']),
      trade(2, [0, 'QORT', '100.00000000'], [11, 'Gadget', '4.00000000']),
      // A unit of Gadget bought with Tokens: no price in QORT.
      trade(3, [6, 'Tokens', '5.00000000'], [11, 'Gadget', '1.00000000']),
    ]);
    render(
      <ThemeProvider theme={darkTheme}>
        <AssetBreakdown summary={summary} />
      </ThemeProvider>
    );
    const gadget = screen
      .getByRole('heading', { name: 'Gadget' })
      .closest('li') as HTMLElement;
    // 629 QORT for the 27 units bought with QORT: 23.30 each, not 629 / 28.
    expect(gadget).toHaveTextContent(
      'Bought27 for 629.00 QORT · 23.3 QORT each · 1 for other Q-Assets'
    );
    const tokens = screen
      .getByRole('heading', { name: 'Tokens' })
      .closest('li') as HTMLElement;
    expect(
      within(tokens).getByText('5 for other Q-Assets')
    ).toBeInTheDocument();
    expect(tokens).not.toHaveTextContent(/QORT each/);
  });
});
