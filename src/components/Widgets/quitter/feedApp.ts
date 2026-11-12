import { atom } from 'jotai';

/**
 * The app Home's feed reads and opens: Torq or Quitter. Both publish posts the
 * same way, so the feed shows the same posts either way. The choice decides
 * the title, the app a post opens in and, for Torq, Torq's own reading rules
 * (see torqFeed.ts).
 */
export type FeedApp = 'Torq' | 'Quitter';

export const DEFAULT_FEED_APP: FeedApp = 'Torq';
/** The order of the switch on Home. */
export const FEED_APPS: readonly FeedApp[] = ['Torq', 'Quitter'];
const FEED_APP_STORAGE_KEY = 'home_feed_app';

/** The app the user last chose, else Torq. */
export const readFeedApp = (): FeedApp => {
  try {
    const stored = localStorage.getItem(FEED_APP_STORAGE_KEY);
    return stored === 'Torq' || stored === 'Quitter'
      ? stored
      : DEFAULT_FEED_APP;
  } catch {
    return DEFAULT_FEED_APP;
  }
};

export const saveFeedApp = (app: FeedApp): void => {
  try {
    localStorage.setItem(FEED_APP_STORAGE_KEY, app);
  } catch {
    // Storage unavailable: the choice lasts until Hub closes.
  }
};

export const feedAppAtom = atom<FeedApp>(readFeedApp());
