import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

import { LibraryResultsStatus, LibraryWaiting } from './LibrarySection';
import { APP_SKELETON } from './libraryLayout';

const wrap = (ui: React.ReactNode) =>
  render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);

describe('LibraryWaiting', () => {
  it('loads while the node has sent nothing', () => {
    wrap(
      <LibraryWaiting
        {...APP_SKELETON}
        count={2}
        status="loading"
        view="grid"
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'core:loading.generic'
    );
  });

  it('never loads once the node has sent apps: the section has none', () => {
    wrap(
      <LibraryWaiting {...APP_SKELETON} count={2} status="ready" view="grid" />
    );
    expect(screen.queryByText('core:loading.generic')).toBeNull();
    expect(
      screen.getByText('core:message.generic.no_results')
    ).toBeInTheDocument();
  });

  it('says the library is empty when the node sent nothing at all', () => {
    wrap(
      <LibraryWaiting {...APP_SKELETON} count={2} status="empty" view="list" />
    );
    expect(
      screen.getByText('core:launcher.library.empty_title')
    ).toBeInTheDocument();
  });
});

describe('LibraryResultsStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('speaks at once without a delay', () => {
    const { rerender } = wrap(<LibraryResultsStatus message="" />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    rerender(
      <ThemeProvider theme={createTheme()}>
        <LibraryResultsStatus message="3 of 9" />
      </ThemeProvider>
    );
    expect(screen.getByRole('status')).toHaveTextContent('3 of 9');
  });

  it('waits for the typing to stop with a delay', () => {
    vi.useFakeTimers();
    const ui = (message: string) => (
      <ThemeProvider theme={createTheme()}>
        <LibraryResultsStatus delay={400} message={message} />
      </ThemeProvider>
    );
    const { rerender } = render(ui(''));
    rerender(ui('5 of 9'));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender(ui('2 of 9'));
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(screen.getByRole('status')).toHaveTextContent('');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('status')).toHaveTextContent('2 of 9');
  });
});
