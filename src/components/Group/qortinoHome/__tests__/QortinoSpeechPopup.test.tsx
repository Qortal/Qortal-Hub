import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../../i18n/i18n';
import { QortinoSpeechPopup } from '../QortinoSpeechPopup';
import type { ActiveQortinoQuip } from '../useQortinoQuips';

const QUIP: ActiveQortinoQuip = {
  category: 'promo',
  holdMs: 4_000,
  id: 1,
  key: 'quips.promo.intro',
  text: "Hi Simon! I'm Qortino.",
  typingMs: 600,
  wink: false,
};

describe("Qortino's speech bubble", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('types the line out while his mouth moves, then stops', async () => {
    const onTypingChange = vi.fn();
    render(
      <QortinoSpeechPopup
        mouth={{ x: -80, y: -16 }}
        onTap={vi.fn()}
        onTypingChange={onTypingChange}
        quip={QUIP}
      />
    );
    const bubble = screen.getByRole('button', {
      name: "Hi Simon! I'm Qortino. Click to open Qortino",
    });
    // The whole line holds its place from the start, so the bubble never
    // grows while the words come.
    expect(bubble).toHaveTextContent("Hi Simon! I'm Qortino.");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onTypingChange).toHaveBeenLastCalledWith(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUIP.text.length * 26 + 100);
    });
    expect(onTypingChange).toHaveBeenLastCalledWith(false);
  });

  it('opens Qortino when tapped', () => {
    const onTap = vi.fn();
    render(
      <QortinoSpeechPopup
        mouth={{ x: -80, y: -16 }}
        onTap={onTap}
        onTypingChange={vi.fn()}
        quip={QUIP}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onTap).toHaveBeenCalled();
  });

  it('offers nothing to open where Qortino AI cannot run', () => {
    render(
      <QortinoSpeechPopup
        mouth={{ x: -80, y: -16 }}
        onTypingChange={vi.fn()}
        quip={QUIP}
      />
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText("Hi Simon! I'm Qortino.")).toBeInTheDocument();
  });

  it('shows nothing without a line', () => {
    const { container } = render(
      <QortinoSpeechPopup
        mouth={{ x: -80, y: -16 }}
        onTap={vi.fn()}
        onTypingChange={vi.fn()}
        quip={null}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
