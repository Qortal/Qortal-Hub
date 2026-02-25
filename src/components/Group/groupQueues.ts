import { RequestQueueWithPromise } from '../../utils/queue/queue';
import { requestQueueMemberNames } from '../../utils/queue/requestQueueMemberNames';

export { requestQueueMemberNames };

export const requestQueueAdminMemberNames = new RequestQueueWithPromise(5);
