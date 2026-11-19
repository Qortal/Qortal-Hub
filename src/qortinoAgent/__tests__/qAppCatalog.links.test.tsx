import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';

const events = vi.hoisted(() => ({ executeEvent: vi.fn() }));
vi.mock('../../utils/events', () => events);

import { QortinoRichText } from '../../components/Group/QortinoAgent/QortinoRichText';
import { formatQAppAnswer, Q_APP_CATALOG } from '../qAppCatalog';

const openedTab = () =>
  events.executeEvent.mock.calls.find(([name]) => name === 'addTab')?.[1]?.data;

/** The catalog answer as the chat shows it; clicks its qortal:// link. */
const openLinkInAnswer = (name: string) => {
  const entry = Q_APP_CATALOG.find((app) => app.name === name)!;
  render(
    <ThemeProvider theme={createTheme()}>
      <QortinoRichText text={formatQAppAnswer(entry, null)} />
    </ThemeProvider>
  );
  fireEvent.click(screen.getByRole('link'));
  return entry;
};

describe('The link in a Q-App answer from the catalog', () => {
  afterEach(() => {
    events.executeEvent.mockClear();
  });

  it.each(['Welcome to Qortal', 'World Map', 'Qortal Web'])(
    'opens "%s", a name with spaces',
    (name) => {
      const entry = openLinkInAnswer(name);
      expect(screen.getByRole('link')).toHaveTextContent(name);
      expect(openedTab()).toMatchObject({
        service: entry.service,
        name: entry.name,
      });
    }
  );

  it('opens POS+, not POS', () => {
    openLinkInAnswer('POS+');
    expect(openedTab()).toMatchObject({ service: 'APP', name: 'POS+' });
  });

  it('opens every app of the catalog under its own name', () => {
    for (const entry of Q_APP_CATALOG) {
      events.executeEvent.mockClear();
      const { unmount } = render(
        <ThemeProvider theme={createTheme()}>
          <QortinoRichText text={formatQAppAnswer(entry, null)} />
        </ThemeProvider>
      );
      fireEvent.click(screen.getByRole('link'));
      expect(openedTab()).toMatchObject({
        service: entry.service,
        name: entry.name,
      });
      unmount();
    }
  });
});
