import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../../i18n/i18n';
import { lightTheme } from '../../../styles/theme-light';
import { plainTextToTorqDoc, torqDocToPostBody } from './torqRichText';
import { TorqTextEditor } from './TorqTextEditor';

const renderEditor = (disabled = false) =>
  render(
    <ThemeProvider theme={lightTheme}>
      <TorqTextEditor
        initialDoc={plainTextToTorqDoc('Hello\n\nworld')}
        disabled={disabled}
        onChange={vi.fn()}
      />
    </ThemeProvider>
  );

// ProseMirror scrolls the selection into view after a command; jsdom has no
// layout, so ranges get empty boxes.
const emptyRect = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
  x: 0,
  y: 0,
} as DOMRect;
const rangeLayout = {
  getBoundingClientRect: Range.prototype.getBoundingClientRect,
  getClientRects: Range.prototype.getClientRects,
};

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => emptyRect;
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null }) as unknown as DOMRectList;
});

afterAll(() => {
  Range.prototype.getBoundingClientRect = rangeLayout.getBoundingClientRect;
  Range.prototype.getClientRects = rangeLayout.getClientRects;
});

describe('TorqTextEditor', () => {
  it('offers the formatting Torq publishes, and shows the draft', async () => {
    renderEditor();
    for (const name of [
      'Bold',
      'Italic',
      'Underline',
      'Bulleted list',
      'Numbered list',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    const textbox = await screen.findByRole('textbox', {
      name: "What's happening?",
    });
    expect(textbox).toHaveTextContent('Helloworld');
    expect(textbox.querySelectorAll('p')).toHaveLength(2);
    expect(textbox).toHaveAttribute('contenteditable', 'true');
  });

  it('turns a list from the toolbar into Torq rich text', async () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider theme={lightTheme}>
        <TorqTextEditor
          initialDoc={plainTextToTorqDoc('Shopping\n\nmilk')}
          onChange={onChange}
        />
      </ThemeProvider>
    );
    await screen.findByRole('textbox', { name: "What's happening?" });

    // The cursor starts at the end, in "milk".
    fireEvent.click(screen.getByRole('button', { name: 'Bulleted list' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(torqDocToPostBody(onChange.mock.lastCall![0])).toEqual({
      text: 'Shopping\n\n• milk',
      richText: '<p>Shopping</p><ul data-list="disc"><li>milk</li></ul>',
    });
    expect(
      screen.getByRole('button', { name: 'Bulleted list' })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('locks the text and the toolbar while a post is publishing', async () => {
    renderEditor(true);
    expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled();
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: "What's happening?" })
      ).toHaveAttribute('contenteditable', 'false')
    );
  });
});
