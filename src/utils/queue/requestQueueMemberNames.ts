import { RequestQueueWithPromise } from './queue';

/**
 * Shared queue for member name resolution. Used by App (for pause/resume/clear)
 * and by Group/BlockedUsersModal. Defined here so App can import it without
 * loading the Group component bundle.
 */
export const requestQueueMemberNames = new RequestQueueWithPromise(5);
