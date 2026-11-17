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

/**
 * Decline ignores clicks this long after a request appears. The next request
 * appears where the last one was, so the second click of a double click on
 * Decline would otherwise answer a request nobody read.
 */
export const DECLINE_GUARD_MS = 500;

/**
 * The answer for a request that waited its turn and that an answer in front
 * of it has allowed meanwhile (a sign-in grants its reads for the session).
 * Nothing is shown for it.
 */
export const PERMISSION_ALREADY_GIVEN = Object.freeze({ accepted: true });

/** Seconds the dialog shows for a request that must be answered by `expiresAt`. */
export function permissionSecondsLeft(expiresAt: unknown, now: number): number {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return QORTAL_REQUEST_COUNTDOWN_SECONDS;
  }
  const left = (expiresAt - PERMISSION_DIALOG_MARGIN_MS - now) / 1000;
  return Math.min(QORTAL_REQUEST_COUNTDOWN_SECONDS, Math.max(0, left));
}

// Lets the answer in front finish acting (granting what it allows), then asks
// whether that allows this request too. A failed check counts as no, so the
// request is shown.
async function allowedMeanwhile(
  alreadyAllowed: () => boolean | Promise<boolean>
): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    return (await alreadyAllowed()) === true;
  } catch {
    return false;
  }
}

/**
 * Returns `ask(show, declined, alreadyAllowed)`. `show(expiresAt)` runs once
 * every earlier request has been answered, and its answer is passed back.
 * `declined` is the answer when too many requests are already waiting, or
 * when the request's time ran out while it waited. A request that waited is
 * not shown when `alreadyAllowed()` says the answers in front of it allowed
 * it; its answer is then PERMISSION_ALREADY_GIVEN.
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
    declined: T,
    alreadyAllowed?: () => boolean | Promise<boolean>
  ): Promise<T | typeof PERMISSION_ALREADY_GIVEN> => {
    if (unanswered > maxWaiting) return Promise.resolve(declined);
    const expiresAt = now() + PERMISSION_REQUEST_TIMEOUT_MS;
    // Checked when it was asked; only one that waits needs a second check.
    const waits = unanswered > 0;
    unanswered += 1;
    const answer = lastAnswered.then(async () => {
      if (expiresAt - now() < MIN_PERMISSION_TIME_TO_SHOW_MS) return declined;
      if (waits && alreadyAllowed && (await allowedMeanwhile(alreadyAllowed))) {
        return PERMISSION_ALREADY_GIVEN;
      }
      return show(expiresAt);
    });
    lastAnswered = answer
      .catch(() => undefined)
      .then(() => {
        unanswered -= 1;
      });
    return answer;
  };
}
