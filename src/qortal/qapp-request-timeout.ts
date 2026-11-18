import {
  TIME_HOURS_1_IN_MILLISECONDS,
  TIME_MINUTES_10_IN_MILLISECONDS,
  TIME_MINUTES_30_IN_MILLISECONDS,
  TIME_SECONDS_30_IN_MILLISECONDS,
} from '../constants/constants';

export function qappRequestTimeout(message: {
  action?: string;
  payload?: { resources?: unknown[]; coin?: string };
}): number {
  // Approval, shielded proofs and broadcast can outlive a normal read request.
  // Keep the original request pending; a timer does not cancel a Core send.
  if (
    message?.payload?.coin === 'XMR' &&
    ['GET_USER_WALLET', 'GET_USER_WALLET_INFO'].includes(message.action)
  ) {
    return TIME_MINUTES_10_IN_MILLISECONDS;
  }
  if (message?.action === 'SEND_COIN') {
    return TIME_MINUTES_10_IN_MILLISECONDS;
  }
  if (
    message?.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES' &&
    message?.payload?.resources?.length > 0
  ) {
    return message.payload.resources.length * TIME_MINUTES_30_IN_MILLISECONDS;
  }
  if (message?.action === 'PUBLISH_QDN_RESOURCE') {
    return TIME_HOURS_1_IN_MILLISECONDS;
  }
  return TIME_SECONDS_30_IN_MILLISECONDS;
}
