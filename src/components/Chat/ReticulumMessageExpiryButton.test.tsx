import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  TIME_DAYS_1_IN_MILLISECONDS,
  TIME_MONTHS_1_IN_MILLISECONDS,
} from '../../constants/constants';
import { ReticulumMessageExpiryButton } from './ReticulumMessageExpiryButton';

describe('ReticulumMessageExpiryButton', () => {
  it('selects an explicit expiry when the channel permits it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ReticulumMessageExpiryButton
        channelExpiryDurationMs={2 * TIME_DAYS_1_IN_MILLISECONDS}
        onChange={onChange}
      />
    );

    await user.click(
      screen.getByRole('button', { name: 'Set message expiry' })
    );
    await user.click(screen.getByRole('menuitem', { name: /^1 day$/ }));

    expect(onChange).toHaveBeenCalledWith(TIME_DAYS_1_IN_MILLISECONDS);
  });

  it('disables choices longer than the channel maximum', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumMessageExpiryButton
        channelExpiryDurationMs={2 * TIME_DAYS_1_IN_MILLISECONDS}
        onChange={() => undefined}
      />
    );

    await user.click(
      screen.getByRole('button', { name: 'Set message expiry' })
    );

    expect(screen.getByRole('menuitem', { name: /^1 day$/ })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: /^2 days$/ })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: /3 days/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('menuitem', { name: /1 week/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('shows the effective channel default and selected expiry labels', () => {
    const { rerender } = render(
      <ReticulumMessageExpiryButton
        channelExpiryDurationMs={2 * TIME_DAYS_1_IN_MILLISECONDS}
        onChange={() => undefined}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Set message expiry' })
    ).toHaveTextContent('2D');

    rerender(
      <ReticulumMessageExpiryButton
        channelExpiryDurationMs={2 * TIME_DAYS_1_IN_MILLISECONDS}
        onChange={() => undefined}
        value={TIME_DAYS_1_IN_MILLISECONDS}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Set message expiry' })
    ).toHaveTextContent('1D');

    rerender(
      <ReticulumMessageExpiryButton
        channelExpiryDurationMs={3 * TIME_DAYS_1_IN_MILLISECONDS}
        onChange={() => undefined}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Set message expiry' })
    ).toHaveTextContent('3D');

    rerender(
      <ReticulumMessageExpiryButton
        channelExpiryDurationMs={7 * TIME_DAYS_1_IN_MILLISECONDS}
        onChange={() => undefined}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Set message expiry' })
    ).toHaveTextContent('1W');

    rerender(
      <ReticulumMessageExpiryButton
        channelExpiryDurationMs={TIME_MONTHS_1_IN_MILLISECONDS}
        onChange={() => undefined}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Set message expiry' })
    ).toHaveTextContent('1M');
  });

  it('does not open while expiry changes are disabled', () => {
    render(
      <ReticulumMessageExpiryButton
        disabled
        disabledReason="Expiry cannot be changed while editing"
        onChange={() => undefined}
      />
    );

    const button = screen.getByRole('button', { name: 'Set message expiry' });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('offers and selects no expiry for direct messages', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ReticulumMessageExpiryButton
        direct
        onChange={onChange}
        value={TIME_MONTHS_1_IN_MILLISECONDS}
      />
    );

    await user.click(
      screen.getByRole('button', { name: 'Set message expiry' })
    );
    await user.click(screen.getByRole('menuitem', { name: /No expiry/ }));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('offers and selects no expiry in group chat mode', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ReticulumMessageExpiryButton
        channelExpiryDurationMs={TIME_DAYS_1_IN_MILLISECONDS}
        onChange={onChange}
      />
    );

    await user.click(
      screen.getByRole('button', { name: 'Set message expiry' })
    );
    await user.click(screen.getByRole('menuitem', { name: /No expiry/ }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('keeps channel default distinct from no expiry in group mode', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ReticulumMessageExpiryButton
        channelExpiryDurationMs={TIME_DAYS_1_IN_MILLISECONDS}
        onChange={onChange}
      />
    );

    await user.click(
      screen.getByRole('button', { name: 'Set message expiry' })
    );
    await user.click(screen.getByRole('menuitem', { name: /Channel default/ }));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
