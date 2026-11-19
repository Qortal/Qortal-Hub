import i18n from '../i18n/i18n';
import { isHubLocked } from '../atoms/presence';
import { codedQortalRequestError } from './qortal-request-errors';

export const HUB_LOCKED_CODE = 'HUB_LOCKED';

/** The error a Q-App gets for a request Hub doesn't take while locked. */
export const hubLockedError = () =>
  codedQortalRequestError(
    HUB_LOCKED_CODE,
    i18n.t('question:message.error.hub_locked', {
      postProcess: 'capitalizeFirstChar',
    })
  );

/**
 * For Q-App requests that open a window or a tab of their own (not the
 * approval dialog): while Hub is locked nothing opens over or behind the lock
 * screen, and the request gets this error.
 */
export function refuseWhileHubLocked() {
  if (isHubLocked()) throw hubLockedError();
}
