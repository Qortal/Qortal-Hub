import { requestQueueCommentCount } from '../components/Chat/GroupAnnouncements';
import { requestQueuePublishedAccouncements } from '../components/Chat/GroupAnnouncements';
import { requestQueueGroupJoinRequests } from '../components/Group/GroupJoinRequests';
import { requestQueueMemberNames } from './queue/requestQueueMemberNames';

export const allQueues = {
  requestQueueCommentCount,
  requestQueuePublishedAccouncements,
  requestQueueMemberNames,
  requestQueueGroupJoinRequests,
};

const controlAllQueues = (action: string) => {
  Object.keys(allQueues).forEach((key) => {
    const val = allQueues[key as keyof typeof allQueues];
    try {
      if (typeof (val as any)[action] === 'function') {
        (val as any)[action]();
      }
    } catch (error) {
      console.error(error);
    }
  });
};

export const clearAllQueues = () => {
  Object.keys(allQueues).forEach((key) => {
    const val = allQueues[key as keyof typeof allQueues];
    try {
      (val as any).clear();
    } catch (error) {
      console.error(error);
    }
  });
};

export const pauseAllQueues = () => {
  controlAllQueues('pause');
  window.sendMessage('pauseAllQueues', {}).catch((error: Error) => {
    console.error(
      'Failed to pause all queues:',
      error.message || 'An error occurred'
    );
  });
};

export const resumeAllQueues = () => {
  controlAllQueues('resume');
  window.sendMessage('resumeAllQueues', {}).catch((error: Error) => {
    console.error(
      'Failed to resume all queues:',
      error.message || 'An error occurred'
    );
  });
};
