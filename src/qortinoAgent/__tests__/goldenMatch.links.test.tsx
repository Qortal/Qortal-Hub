import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';

const events = vi.hoisted(() => ({ executeEvent: vi.fn() }));
vi.mock('../../utils/events', () => events);

import { QortinoRichText } from '../../components/Group/QortinoAgent/QortinoRichText';
import goldenAnswers from '../goldenAnswers.json';
import { lookupGoldenAnswer, type GoldenEntry } from '../goldenMatch';
import { Q_APP_CATALOG } from '../qAppCatalog';
import { openQortalDeepLink } from '../qdnAppLinks';

const ENTRIES = (goldenAnswers as { entries: GoldenEntry[] }).entries;

const openedTabs = () =>
  events.executeEvent.mock.calls
    .filter(([name]) => name === 'addTab')
    .map(([, detail]) => detail.data);

/** The curated answer to `question` as the chat shows it. */
const showAnswer = (question: string) => {
  const { instant } = lookupGoldenAnswer(question);
  expect(instant).not.toBeNull();
  render(
    <ThemeProvider theme={createTheme()}>
      <QortinoRichText text={instant!.entry.a} />
    </ThemeProvider>
  );
};

/** The curated answer with this id as the chat shows it. */
const showEntry = (id: string) => {
  const entry = ENTRIES.find((e) => e.id === id);
  expect(entry).toBeDefined();
  render(
    <ThemeProvider theme={createTheme()}>
      <QortinoRichText text={entry!.a} />
    </ThemeProvider>
  );
};

describe('qortal:// links in the curated answers', () => {
  afterEach(() => {
    events.executeEvent.mockClear();
  });

  it('opens World Map from its answer', () => {
    showAnswer('What is the World Map Q-App?');
    fireEvent.click(screen.getByRole('link'));
    expect(openedTabs()).toEqual([
      expect.objectContaining({ service: 'APP', name: 'World Map' }),
    ]);
  });

  it('opens Welcome to Qortal from its answer', () => {
    showAnswer('What can I find in the Welcome to Qortal app?');
    fireEvent.click(screen.getByRole('link'));
    expect(openedTabs()).toEqual([
      expect.objectContaining({ service: 'APP', name: 'Welcome to Qortal' }),
    ]);
  });

  it('opens the On Qortal channel of Q-Tube from its answer', () => {
    showAnswer('Where can I watch videos that explain Qortal?');
    fireEvent.click(screen.getByRole('link'));
    expect(openedTabs()).toEqual([
      expect.objectContaining({
        service: 'APP',
        name: 'Q-Tube',
        path: 'channel/On%20Qortal/videos',
      }),
    ]);
  });

  it('opens the Playing Qortal website, whose name ends in dots', () => {
    showEntry('philosophy-019');
    fireEvent.click(screen.getByRole('link'));
    expect(openedTabs()).toEqual([
      expect.objectContaining({
        service: 'WEBSITE',
        name: '... Playing Qortal ...',
      }),
    ]);
  });

  it('offers to join the group from its answer only once the link is clicked', () => {
    showAnswer('What is the Welcome to Qortal group?');
    expect(events.executeEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link'));
    expect(events.executeEvent.mock.calls).toEqual([
      ['globalActionJoinGroup', { groupId: '801' }],
    ]);
  });

  it('writes no app name with a space in it as a bare link', () => {
    const spaced = Q_APP_CATALOG.filter((app) => /\s/.test(app.name)).map(
      (app) => `qortal://${app.service}/${app.name}`
    );
    expect(spaced.length).toBeGreaterThan(0);
    const broken = ENTRIES.filter((entry) =>
      spaced.some((link) => entry.a.includes(link))
    ).map((entry) => entry.id);
    expect(broken).toEqual([]);
  });
});

describe('The curated answers about + apps in links', () => {
  afterEach(() => {
    events.executeEvent.mockClear();
  });

  it('say what Hub does with an encoded plus', () => {
    // Hub opens POS+ from the encoded link...
    openQortalDeepLink('qortal://APP/POS%2B');
    expect(openedTabs()).toEqual([
      expect.objectContaining({ service: 'APP', name: 'POS+' }),
    ]);
    // ...so a blank tab is only said of older versions.
    for (const question of [
      'Why does my qortal:// link to a + app open a blank tab?',
      'How do I open a + app like Q-Share+?',
    ]) {
      const { instant } = lookupGoldenAnswer(question);
      expect(instant, question).not.toBeNull();
      const answer = instant!.entry.a;
      expect(answer).not.toMatch(/Hub opens a blank tab/i);
      const blankTab = answer
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => /blank tab/i.test(sentence));
      for (const sentence of blankTab) {
        expect(sentence).toMatch(/\bolder versions\b/i);
      }
    }
  });
});

describe('A payment link in a curated answer', () => {
  afterEach(() => {
    events.executeEvent.mockClear();
  });

  it('opens no website named after the payment', () => {
    showAnswer('How do I pay with a QR code or a qortal://pay link?');
    // Hub has no payment links: the example is text, not a link, and
    // nothing is opened as if it were a website.
    expect(
      screen.getByText(/qortal:\/\/pay\?recipient=NAME&amount=5/)
    ).toBeInTheDocument();
    for (const link of screen.queryAllByRole('link')) fireEvent.click(link);
    expect(openedTabs()).toEqual([]);
  });
});
