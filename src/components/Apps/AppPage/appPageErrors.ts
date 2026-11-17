import type { TFunction } from 'i18next';
import type { AppPageError } from './appPageQdn';

/** Errors with their own explanation; others show the node's message. */
const KNOWN_ERRORS = [
  'APP_NOT_READY',
  'APP_TOO_LARGE',
  'FILES_UNKNOWN',
  'FILE_MISSING',
  'PAGE_TOO_LARGE',
  'SHOT_UNAVAILABLE',
];

/** Internal codes that are no use to a reader: say something generic. */
const GENERIC_ERRORS = ['SEARCH_FAILED', 'PUBLISH_FAILED'];

/**
 * What to tell the user about a failed page publish: the translated
 * explanation of a known error, else the node's message, never an internal
 * code or nothing at all. `inSentence` leaves the first letter as it is, for
 * text that goes after a colon in another message.
 */
export const appPageErrorText = (
  t: TFunction,
  cause: unknown,
  { inSentence = false }: { inSentence?: boolean } = {}
): string => {
  const options = inSentence ? {} : { postProcess: 'capitalizeFirstChar' };
  const code = (cause as AppPageError)?.code;
  if (code && KNOWN_ERRORS.includes(code)) {
    return t(`core:app_page.edit.error_${code.toLowerCase()}`, options);
  }
  const message = String(
    (cause as Error)?.message ?? (typeof cause === 'string' ? cause : '')
  ).trim();
  if (message && !GENERIC_ERRORS.includes(message)) return message;
  return t('core:message.error.generic', options);
};
