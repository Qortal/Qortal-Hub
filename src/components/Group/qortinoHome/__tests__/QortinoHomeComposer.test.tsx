import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warmup = vi.hoisted(() => ({
  warmQortinoForHomeDraft: vi.fn(async () => undefined),
  releaseQortinoAfterHomeDraft: vi.fn(),
}));
vi.mock('../../../../qortinoAgent/homeDraftWarmup', () => warmup);

import '../../../../i18n/i18n';
import {
  resetQortinoSettingsForTests,
  updateQortinoSettings,
} from '../../../../qortinoAgent/settings';
import { QortinoHomeComposer } from '../QortinoHomeComposer';

describe('The ask box next to Qortino on Home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetQortinoSettingsForTests();
  });

  it('sends the question with Enter and clears itself', () => {
    const onSend = vi.fn();
    const onFocusChange = vi.fn();
    render(
      <QortinoHomeComposer onFocusChange={onFocusChange} onSend={onSend} />
    );
    const box = screen.getByRole('textbox', { name: 'Ask Qortino…' });
    fireEvent.focus(box);
    expect(onFocusChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(box, { target: { value: '  how do I purify water?  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('how do I purify water?');
    expect(box).toHaveValue('');
  });

  it('does not send on the Enter that picks a word in an input method', () => {
    const onSend = vi.fn();
    render(<QortinoHomeComposer onFocusChange={vi.fn()} onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Ask Qortino…' });
    fireEvent.change(box, { target: { value: 'みず' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('みず');
  });

  it('has nothing to send while empty', () => {
    const onSend = vi.fn();
    render(<QortinoHomeComposer onFocusChange={vi.fn()} onSend={onSend} />);
    const send = screen.getByRole('button', { name: 'Ask Qortino' });
    expect(send).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('starts a new line with Enter when Qortino is set to', () => {
    updateQortinoSettings({ enterSends: false });
    const onSend = vi.fn();
    render(<QortinoHomeComposer onFocusChange={vi.fn()} onSend={onSend} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'two' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Qortino' }));
    expect(onSend).toHaveBeenCalledWith('two');
  });

  describe('getting Qortino ready', () => {
    it('starts loading him with the first letter, once', () => {
      render(<QortinoHomeComposer onFocusChange={vi.fn()} onSend={vi.fn()} />);
      const box = screen.getByRole('textbox');
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: ' ' } });
      expect(warmup.warmQortinoForHomeDraft).not.toHaveBeenCalled();
      fireEvent.change(box, { target: { value: ' w' } });
      fireEvent.change(box, { target: { value: ' wh' } });
      fireEvent.change(box, { target: { value: ' wha' } });
      expect(warmup.warmQortinoForHomeDraft).toHaveBeenCalledTimes(1);
    });

    it('lets him go when the box is left with the question unsent', () => {
      render(<QortinoHomeComposer onFocusChange={vi.fn()} onSend={vi.fn()} />);
      const box = screen.getByRole('textbox');
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: 'what' } });
      fireEvent.blur(box);
      expect(warmup.releaseQortinoAfterHomeDraft).toHaveBeenCalledTimes(1);

      // Coming back to the draft gets him ready again.
      fireEvent.focus(box);
      expect(warmup.warmQortinoForHomeDraft).toHaveBeenCalledTimes(2);
    });

    it('does not touch the model for a box focused and left empty', () => {
      render(<QortinoHomeComposer onFocusChange={vi.fn()} onSend={vi.fn()} />);
      const box = screen.getByRole('textbox');
      fireEvent.focus(box);
      fireEvent.blur(box);
      expect(warmup.warmQortinoForHomeDraft).not.toHaveBeenCalled();
      expect(warmup.releaseQortinoAfterHomeDraft).not.toHaveBeenCalled();
    });

    it('keeps him for the chat when the question is sent with Enter', () => {
      const { unmount } = render(
        <QortinoHomeComposer onFocusChange={vi.fn()} onSend={vi.fn()} />
      );
      const box = screen.getByRole('textbox');
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: 'what' } });
      fireEvent.keyDown(box, { key: 'Enter' });
      fireEvent.blur(box);
      unmount();
      expect(warmup.releaseQortinoAfterHomeDraft).not.toHaveBeenCalled();
    });

    it('holds on to him again after the send tap closed the keyboard', () => {
      const onSend = vi.fn();
      const { unmount } = render(
        <QortinoHomeComposer onFocusChange={vi.fn()} onSend={onSend} />
      );
      const box = screen.getByRole('textbox');
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: 'what' } });
      // A tap on send: the box loses focus before the click lands.
      fireEvent.blur(box);
      fireEvent.click(screen.getByRole('button', { name: 'Ask Qortino' }));
      expect(onSend).toHaveBeenCalledWith('what');
      // The send asks for him again, which cancels the release from the blur.
      expect(warmup.warmQortinoForHomeDraft).toHaveBeenCalledTimes(2);
      unmount();
      expect(warmup.releaseQortinoAfterHomeDraft).toHaveBeenCalledTimes(1);
    });

    it('lets him go when Home goes away with a draft', () => {
      const { unmount } = render(
        <QortinoHomeComposer onFocusChange={vi.fn()} onSend={vi.fn()} />
      );
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'what' },
      });
      unmount();
      expect(warmup.releaseQortinoAfterHomeDraft).toHaveBeenCalledTimes(1);
    });
  });
});
