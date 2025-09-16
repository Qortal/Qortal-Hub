import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordField } from './PasswordField';

describe('PasswordField', () => {
  test('it renders', () => {
    render(<PasswordField data-testid="test-id" value="test-value" />);
    expect(screen.queryByTestId('test-id')).toBeTruthy();
  });

  test('User can toggle between plain text view and password view', async () => {
    render(<PasswordField data-testid="test-id" value="test-value" />);
    const user = userEvent.setup();

    // If your input has no testid, this reliably finds it via its value:
    const input = screen.getByDisplayValue('test-value') as HTMLInputElement;

    // initial: password mode
    expect(input.type).toBe('password');
    expect(screen.getByTestId('password-text-indicator')).toBeInTheDocument();

    // toggle -> plain text
    await user.click(screen.getByTestId('toggle-view-password-btn'));
    expect(input.type).toBe('text');
    expect(screen.getByTestId('plain-text-indicator')).toBeInTheDocument();

    // toggle back -> password
    await user.click(screen.getByTestId('toggle-view-password-btn'));
    expect(input.type).toBe('password');
    expect(screen.getByTestId('password-text-indicator')).toBeInTheDocument();
  });
});
