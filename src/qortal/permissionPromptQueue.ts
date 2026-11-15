/**
 * Q-App approval requests reach the approval dialog one at a time.
 *
 * A request that comes while another one is on screen waits its turn instead
 * of taking the dialog's place, so what the user reads is what their Accept
 * answers.
 */

/** The longest countdown the approval dialog shows, in seconds. */
export const QORTAL_REQUEST_COUNTDOWN_SECONDS = 60;

/**
 * How long a request waits for an answer, counted from when the app asked. A
 * request that waited behind others gets only what is left of it.
 */
export const PERMISSION_REQUEST_TIMEOUT_MS = 61_000;

/**
 * The dialog's countdown ends this long before the requester stops waiting.
 * The dialog then always declines the request itself, and the next request
 * never reaches a dialog that still shows the last one.
 */
export const PERMISSION_DIALOG_MARGIN_MS = 1000;

/**
 * A request with less time left than this when its turn comes is declined
 * without being shown: too little to read it.
 */
export const MIN_PERMISSION_TIME_TO_SHOW_MS = 3000;

/**
 * At most this many requests wait behind the one on screen. More are
 * declined at once, so an app that asks in a loop can't keep the dialog busy
 * for long after it is closed.
 */
export const MAX_WAITING_PERMISSION_PROMPTS = 10;

/** Seconds the dialog shows for a request that must be answered by `expiresAt`. */
export function permissionSecondsLeft(expiresAt: unknown, now: number): number {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return QORTAL_REQUEST_COUNTDOWN_SECONDS;
  }
  const left = (expiresAt - PERMISSION_DIALOG_MARGIN_MS - now) / 1000;
  return Math.min(QORTAL_REQUEST_COUNTDOWN_SECONDS, Math.max(0, left));
}

/**
 * Returns `ask(show, declined)`. `show(expiresAt)` runs once every earlier
 * request has been answered, and its answer is passed back. `declined` is the
 * answer when too many requests are already waiting, or when the request's
 * time ran out while it waited.
 */
export function createPermissionPromptQueue({
  maxWaiting = MAX_WAITING_PERMISSION_PROMPTS,
  now = () => Date.now(),
}: { maxWaiting?: number; now?: () => number } = {}) {
  // Requests not answered yet: the one on screen and the ones waiting.
  let unanswered = 0;
  let lastAnswered: Promise<unknown> = Promise.resolve();

  return <T>(
    show: (expiresAt: number) => Promise<T>,
    declined: T
  ): Promise<T> => {
    if (unanswered > maxWaiting) return Promise.resolve(declined);
    const expiresAt = now() + PERMISSION_REQUEST_TIMEOUT_MS;
    unanswered += 1;
    const answer = lastAnswered.then(() =>
      expiresAt - now() < MIN_PERMISSION_TIME_TO_SHOW_MS
        ? declined
        : show(expiresAt)
    );
    lastAnswered = answer
      .catch(() => undefined)
      .then(() => {
        unanswered -= 1;
      });
    return answer;
  };
}
