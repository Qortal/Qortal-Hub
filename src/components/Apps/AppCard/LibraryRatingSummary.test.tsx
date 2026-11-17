import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

const ratingState: { rating: any } = { rating: null };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.rating !== undefined
        ? `${key}|${options.rating}|${options.count}`
        : key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../../hooks/useAppRatings', () => ({
  useAppRating: () => ({
    rating: ratingState.rating,
    containerRef: { current: null },
  }),
}));

import { createStore, Provider } from 'jotai';
import { LibraryRatingSummary } from './LibraryRatingSummary';
import { RATING_GRACE_MS } from '../AppsLibrary/libraryLayout';
import { userInfoAtom } from '../../../atoms/global';
import { pendingVotesAtom } from '../AppPage/appPageStore';

const renderSummary = () =>
  render(
    <ThemeProvider theme={createTheme()}>
      <LibraryRatingSummary name="Q-Tube" service="APP" />
    </ThemeProvider>
  );

describe('LibraryRatingSummary, with a vote on its way', () => {
  const voted = (voter: string) => {
    const store = createStore();
    store.set(userInfoAtom, { address: 'QMe' });
    store.set(pendingVotesAtom, {
      sent: {
        voter,
        rating: 5,
        createdPoll: false,
        sentAt: 1,
        name: 'q-tube',
        service: 'APP',
      },
    });
    return render(
      <Provider store={store}>
        <ThemeProvider theme={createTheme()}>
          <LibraryRatingSummary name="Q-Tube" service="APP" />
        </ThemeProvider>
      </Provider>
    );
  };

  beforeEach(() => {
    // The creator's 3 and one 4: 3.5 from 2.
    ratingState.rating = {
      averageRating: 3.5,
      totalVotes: 2,
      voteCounts: [
        { optionName: 'initialValue-3', voteCount: 0 },
        { optionName: '4', voteCount: 1 },
      ],
      hasPublishedRating: true,
      pollInfo: null,
      lastFetched: 0,
    };
  });

  it("counts the account's own vote at once", () => {
    voted('QMe');
    expect(screen.getByRole('img')).toHaveTextContent('4.0(3)');
  });

  it("leaves another account's vote to that account", () => {
    voted('QOther');
    expect(screen.getByRole('img')).toHaveTextContent('3.5(2)');
  });
});

describe('LibraryRatingSummary', () => {
  beforeEach(() => {
    ratingState.rating = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a placeholder until the rating loads', () => {
    const { container } = renderSummary();
    expect(container.querySelector('.MuiSkeleton-root')).not.toBeNull();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('stops waiting when no rating comes, and shows none instead', () => {
    vi.useFakeTimers();
    const { container, rerender } = renderSummary();
    act(() => {
      vi.advanceTimersByTime(RATING_GRACE_MS - 1);
    });
    expect(container.querySelector('.MuiSkeleton-root')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelector('.MuiSkeleton-root')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(
      screen.getByText('core:launcher.library.rating_none')
    ).toBeInTheDocument();

    // A rating that comes later still shows.
    ratingState.rating = { averageRating: 4, totalVotes: 2 };
    rerender(
      <ThemeProvider theme={createTheme()}>
        <LibraryRatingSummary name="Q-Tube" service="APP" />
      </ThemeProvider>
    );
    expect(screen.getByRole('img')).toHaveTextContent('4.0(2)');

    // A refresh empties the store: a short wait again, then none.
    ratingState.rating = null;
    rerender(
      <ThemeProvider theme={createTheme()}>
        <LibraryRatingSummary name="Q-Tube" service="APP" />
      </ThemeProvider>
    );
    expect(container.querySelector('.MuiSkeleton-root')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(RATING_GRACE_MS);
    });
    expect(container.querySelector('.MuiSkeleton-root')).toBeNull();
  });

  it('says when nobody has rated the app yet', () => {
    ratingState.rating = { averageRating: 0, totalVotes: 0 };
    renderSummary();
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
    expect(
      screen.getByText('core:launcher.library.rating_none')
    ).toBeInTheDocument();
  });

  it('reads the average and the number of votes as one sentence', () => {
    ratingState.rating = { averageRating: 4.567, totalVotes: 1234 };
    renderSummary();
    const summary = screen.getByRole('img');
    expect(summary).toHaveAccessibleName(
      'core:launcher.library.rating_summary|4.6|1234'
    );
    expect(summary).toHaveTextContent('4.6(1,234)');
    // A summary only: nothing to click or vote with.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
