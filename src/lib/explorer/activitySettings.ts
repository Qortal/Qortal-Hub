/**
 * The Activity row of the Explorer's settings (from Q-Mintership+'s
 * state/settings.ts), for viewers who see the detailed parts: how many of
 * an account's newest transactions the Overview reads when it opens (for
 * its Activity and QORT figures; each "Read older" reads as many more),
 * and which kinds of milestones it leaves out. Kept on this device for
 * each Hub account apart (keys ending `:<Hub address>`).
 *
 * Every storage access is guarded: a private window or blocked site data
 * leaves the defaults, and the window keeps what is picked until it closes.
 */
import { ACCOUNT_HISTORY_MAX } from './accountTx';
import { isMarkKind, type MarkKind } from './activity';

/** Read when the Overview opens, and on each Read older. */
export const ACTIVITY_FIRST_READ_DEFAULT = 1000;
/** Read in pages of 100, never more than a whole history is read. */
export const ACTIVITY_FIRST_READ_MIN = 100;
export const ACTIVITY_FIRST_READ_MAX = ACCOUNT_HISTORY_MAX;
/** The choices offered beside "another number". */
export const ACTIVITY_FIRST_READ_CHOICES = [100, 500, 1000, 2000] as const;

export interface ActivitySettings {
  firstRead: number;
  hiddenMarks: MarkKind[];
}

export const DEFAULT_ACTIVITY_SETTINGS: ActivitySettings = {
  firstRead: ACTIVITY_FIRST_READ_DEFAULT,
  hiddenMarks: [],
};

export const firstReadKey = (hubAddress: string) =>
  `explorer-activity-first-read:${hubAddress}`;
export const hiddenMarksKey = (hubAddress: string) =>
  `explorer-activity-hidden-marks:${hubAddress}`;

/** A number of transactions to read, kept to whole pages of 100 within the limits; anything else is the default. */
export function clampActivityRead(value: unknown): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : ACTIVITY_FIRST_READ_DEFAULT;
  const pages = Math.ceil(n / ACTIVITY_FIRST_READ_MIN);
  return Math.min(
    ACTIVITY_FIRST_READ_MAX,
    Math.max(1, pages) * ACTIVITY_FIRST_READ_MIN
  );
}

/** What this device keeps for `hubAddress` (the defaults where storage can't be read). */
export function readActivitySettings(
  hubAddress: string | null | undefined
): ActivitySettings {
  if (!hubAddress) return DEFAULT_ACTIVITY_SETTINGS;
  try {
    const first = window.localStorage.getItem(firstReadKey(hubAddress));
    const hidden = window.localStorage.getItem(hiddenMarksKey(hubAddress));
    const kinds: unknown = hidden ? JSON.parse(hidden) : [];
    return {
      firstRead: clampActivityRead(first === null ? NaN : Number(first)),
      hiddenMarks: Array.isArray(kinds)
        ? [...new Set(kinds.filter(isMarkKind))]
        : [],
    };
  } catch {
    return DEFAULT_ACTIVITY_SETTINGS;
  }
}

/** Keep `settings` for `hubAddress`; where storage can't be written, they last until the window closes. */
export function writeActivitySettings(
  hubAddress: string,
  settings: ActivitySettings
): void {
  try {
    if (settings.firstRead === ACTIVITY_FIRST_READ_DEFAULT)
      window.localStorage.removeItem(firstReadKey(hubAddress));
    else
      window.localStorage.setItem(
        firstReadKey(hubAddress),
        String(clampActivityRead(settings.firstRead))
      );
    if (settings.hiddenMarks.length)
      window.localStorage.setItem(
        hiddenMarksKey(hubAddress),
        JSON.stringify(settings.hiddenMarks)
      );
    else window.localStorage.removeItem(hiddenMarksKey(hubAddress));
  } catch {
    // Kept for this window only.
  }
}
