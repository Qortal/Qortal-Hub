import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QortinoRichText } from './QortinoRichText';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';

/** The tabs a click asks Hub to open. */
function watchTabs() {
  const opened: Array<{ service?: string; name?: string }> = [];
  const listener = (event: CustomEvent) => opened.push(event.detail?.data);
  subscribeToEvent('addTab', listener);
  return {
    opened,
    stop: () => unsubscribeFromEvent('addTab', listener),
  };
}

/** An answer as the chat shows it. */
const showAnswer = (text: string) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <QortinoRichText text={text} />
    </ThemeProvider>
  );

describe("Example links in Qortino's answers", () => {
  let tabs: ReturnType<typeof watchTabs>;

  beforeEach(() => {
    tabs = watchTabs();
  });

  afterEach(() => {
    tabs.stop();
  });

  // Wording as in the curated answers that explain these links.
  it.each([
    [
      'a payment link',
      'A payment request link looks like qortal://pay?recipient=NAME&amount=5.',
    ],
    ['the shape of an app link', 'Link to your app with qortal://APP/<Name>.'],
    [
      'the shape of a resource link',
      'Any resource opens with qortal://SERVICE/name/identifier/path.',
    ],
  ])('opens no tab for %s', (_what, answer) => {
    showAnswer(answer);
    for (const link of screen.queryAllByRole('link')) fireEvent.click(link);
    expect(tabs.opened).toEqual([]);
  });

  it('opens no tab for an example link that names nothing to open', () => {
    // Curated answers about GO's payment links and the form of a link.
    showAnswer(
      "In GO, open a payment link such as qortal://pay?recipient=NAME&amount=5. Hub doesn't open payment links. Links take the form qortal://SERVICE/name/identifier/path. In a page, write src as qortal://THUMBNAIL/<name>/qortal_avatar."
    );
    for (const label of [
      'qortal://pay?recipient=NAME&amount=5',
      'qortal://SERVICE/name/identifier/path',
      'qortal://THUMBNAIL/<name>/qortal_avatar',
    ]) {
      const link = screen.queryByText(label);
      if (link) fireEvent.click(link);
    }
    expect(tabs.opened).toEqual([]);
  });

  it('shows an example link as it is written', () => {
    const { container } = showAnswer(
      'Link to your app with qortal://APP/<Name>.'
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.textContent).toBe(
      'Link to your app with qortal://APP/<Name>.'
    );
  });

  it('opens the tab of a real app link', () => {
    showAnswer('Watch it in qortal://APP/Q-Tube.');
    fireEvent.click(screen.getByRole('link', { name: 'Q-Tube' }));
    expect(tabs.opened).toEqual([
      expect.objectContaining({ service: 'APP', name: 'Q-Tube' }),
    ]);
  });
});
