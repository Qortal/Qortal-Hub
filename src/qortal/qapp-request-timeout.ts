import {
  TIME_HOURS_1_IN_MILLISECONDS,
  TIME_MINUTES_10_IN_MILLISECONDS,
  TIME_MINUTES_30_IN_MILLISECONDS,
  TIME_SECONDS_30_IN_MILLISECONDS,
} from '../constants/constants';

export function qappRequestTimeout(message: {
  action?: string;
  payload?: {
    resources?: unknown[];
    coin?: string;
    foreignBlockchain?: string;
  };
}): number {
  // ARRR may need a separately approved self-payment, shielded proofs and
  // several confirmations before Core can create the buy-order state.
  if (
    message?.action === 'CREATE_TRADE_BUY_ORDER' &&
    message?.payload?.foreignBlockchain === 'PIRATECHAIN'
  ) {
    return TIME_MINUTES_30_IN_MILLISECONDS;
  }
  // Approval, shielded proofs and broadcast can outlive a normal read request.
  // Keep the original request pending; a timer does not cancel a Core send.
  if (
    (message?.payload?.coin === 'XMR' &&
      ['GET_USER_WALLET', 'GET_USER_WALLET_INFO'].includes(message.action)) ||
    (message?.payload?.coin === 'ARRR' &&
      [
        'GET_USER_WALLET',
        'GET_USER_WALLET_INFO',
        'GET_WALLET_BALANCE',
        'GET_WALLET_TRANSACTIONS',
        'GET_WALLET_SYNC_STATUS',
      ].includes(message.action))
  ) {
    return TIME_MINUTES_10_IN_MILLISECONDS;
  }
  if (message?.action === 'GET_ARRR_SYNC_STATUS')
    return TIME_MINUTES_10_IN_MILLISECONDS;
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
