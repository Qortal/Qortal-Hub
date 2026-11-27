import i18n from '../../i18n/i18n';

// Reading the reply from a background message channel.
//
// `sendMessageBackground` (src/messaging/MessagesToBackground.tsx) has three
// exits, and a caller has to distinguish all three:
//
//   payload present (even `{}`)  -> the payload, i.e. success
//   `error` or `message` set     -> `{ error, message }`, i.e. failure
//   neither                      -> falls off the end and returns `undefined`
//
// Two places got the third case wrong. Testing for the `error` key alone read a
// failure as success, and throwing `response.error` threw `Error(undefined)`.
// One predicate, tested, so the next caller cannot repeat it.

/**
 * The message to surface for a failed reply, or `null` when the reply is a
 * success.
 *
 * A missing reply is a failure: the background returning nothing means the round
 * trip produced neither a payload nor an error, so nothing was done. Reporting
 * that as success shows the user a completion toast for a transaction that never
 * happened.
 */
export function replyFailureMessage(reply: unknown): string | null {
  if (reply === undefined || reply === null) {
    return i18n.t('core:message.error.generic', {
      postProcess: 'capitalizeFirstChar',
    }) as string;
  }
  if (typeof reply !== 'object') return null;
  const { error, message } = reply as { error?: unknown; message?: unknown };
  if (typeof error === 'string' && error) return error;
  if (typeof message === 'string' && message) return message;
  return null;
}
