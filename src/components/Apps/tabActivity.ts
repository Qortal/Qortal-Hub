/**
 * What each app tab is in the middle of with Hub, so Hub never puts a tab
 * to sleep (tabSleep.ts) while its app is busy with it:
 *
 * - a request Hub has not answered yet: an approval window waiting for the
 *   user, a publish, a payment, a file save prompt;
 * - a file the app is saving piece by piece (FILE_SAVE_OPEN … FINISH), also
 *   between its requests.
 *
 * Sound playing is asked of the tab's webview when it matters (AppsDesktop).
 * Its media events are not counted: Web Audio reports a start and never a
 * stop, so a tab that once played a sound would never sleep.
 *
 * Kept by tab id. A tab's entry goes once nothing is left in it, and when the
 * tab closes.
 */

/**
 * A save not written to for this long counts as left: Hub's main process
 * drops such a save too (IDLE_MS in electron/src/qapp-file-save.ts).
 */
export const FILE_SAVE_IDLE_MS = 5 * 60_000;

type TabActivity = {
  /** Requests waiting for Hub's answer. */
  requests: number;
  /** Saves still open, by save id: when each was last written to. */
  saves: Map<string, number>;
};

const activities = new Map<string, TabActivity>();

const activityOf = (tabId: string): TabActivity => {
  let activity = activities.get(tabId);
  if (!activity) {
    activity = { requests: 0, saves: new Map() };
    activities.set(tabId, activity);
  }
  return activity;
};

const dropIfIdle = (tabId: string) => {
  const activity = activities.get(tabId);
  if (activity && activity.requests === 0 && activity.saves.size === 0) {
    activities.delete(tabId);
  }
};

/** A tab's id as a key. AppsDesktop's are strings; a number counts too. */
const keyOf = (tabId: unknown): string | null => {
  if (typeof tabId === 'string') return tabId || null;
  return typeof tabId === 'number' && Number.isFinite(tabId)
    ? String(tabId)
    : null;
};

/**
 * Counts `request` as waiting in its tab until it settles. Gives `request`
 * back, so its answer and its failure reach the caller as they are.
 */
export function trackTabRequest<T>(tabId: unknown, request: Promise<T>) {
  const key = keyOf(tabId);
  if (!key || !request || typeof request.then !== 'function') {
    return request;
  }
  const activity = activityOf(key);
  activity.requests += 1;
  // A tab closed meanwhile has a new entry, if any: this one is left alone.
  const done = () => {
    activity.requests = Math.max(0, activity.requests - 1);
    dropIfIdle(key);
  };
  request.then(done, done);
  return request;
}

/**
 * A step of a file saved piece by piece: `open` once Hub gave it a save id,
 * `write` for each piece written, `done` once it is finished or abandoned.
 */
export function noteTabFileSave(
  tabId: unknown,
  saveId: unknown,
  step: 'open' | 'write' | 'done',
  now = Date.now()
) {
  const key = keyOf(tabId);
  if (!key || typeof saveId !== 'string' || !saveId) return;
  if (step === 'done') {
    activities.get(key)?.saves.delete(saveId);
    dropIfIdle(key);
    return;
  }
  activityOf(key).saves.set(saveId, now);
}

/**
 * The page in the tab went: a new page loaded, it stopped working, or the
 * tab was unloaded. Its open saves went with it (Hub's main process ends
 * them: cleanupQAppOwner in electron/src/setup.ts). A request still waiting
 * for Hub stays counted until it is answered.
 */
export function noteTabPageGone(tabId: unknown) {
  const key = keyOf(tabId);
  const activity = key ? activities.get(key) : undefined;
  if (!activity) return;
  activity.saves.clear();
  dropIfIdle(key);
}

/** True while the tab waits for Hub or saves a file. */
export function isTabBusy(tabId: unknown, now = Date.now()): boolean {
  const key = keyOf(tabId);
  if (!key) return false;
  const activity = activities.get(key);
  if (!activity) return false;
  if (activity.requests > 0) return true;
  for (const touchedAt of activity.saves.values()) {
    if (now - touchedAt <= FILE_SAVE_IDLE_MS) return true;
  }
  return false;
}

/** The tab closed: nothing it did counts any more. */
export function forgetTabActivity(tabId: unknown) {
  const key = keyOf(tabId);
  if (key) activities.delete(key);
}
