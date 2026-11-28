import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n/i18n';
import { OverviewSummary } from './OverviewSummary';

// "Last sent a transaction …" compares the node's time of the transaction
// with this PC's clock. A PC whose clock is behind (a dual-boot PC an hour
// off, say) must still read the past as the past.

afterEach(() => vi.useRealTimers());

describe('OverviewSummary', () => {
  it("doesn't say an account's last transaction is still to come when this PC's clock is behind", () => {
    const pcNow = Date.UTC(2026, 10, 20, 12, 0, 0);
    vi.useFakeTimers({ now: pcNow, toFake: ['Date'] });
    render(
      <OverviewSummary
        level={3}
        standing="outside"
        names={{ names: [], truncated: false }}
        firstSeen={null}
        // Confirmed by the chain an hour "after" this PC's clock.
        lastSent={{
          type: 'PAYMENT',
          height: 100,
          timestamp: pcNow + 3_600_000,
        }}
      />
    );
    expect(screen.getByText(/last sent a transaction/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/last sent a transaction in \d/i)
    ).not.toBeInTheDocument();
  });
});
