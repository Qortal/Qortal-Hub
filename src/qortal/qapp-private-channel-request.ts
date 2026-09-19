import { normalizeQappIdentityContext } from './qapp-identity.ts';
import { codedQortalRequestError } from './qortal-request-errors.ts';
import { hasSessionPermission } from './qortal-requests.ts';

const QAPP_PRIVATE_CHANNEL_ACTIONS = new Set([
  'PRIVATE_CHANNEL_OPEN',
  'PRIVATE_CHANNEL_SEND',
  'PRIVATE_CHANNEL_STATUS',
  'PRIVATE_CHANNEL_CLOSE',
]);

type QAppPrivateChannelContext = {
  appName: string;
  appService?: string;
  tabId: string | number;
};

type QAppPrivateChannelMessage = {
  action?: string;
  rnsConnectionId?: unknown;
  purpose?: unknown;
  channelId?: unknown;
  lane?: unknown;
  messageId?: unknown;
  data?: unknown;
  [key: string]: unknown;
};

export function isQAppPrivateChannelAction(action: unknown): action is string {
  return typeof action === 'string' && QAPP_PRIVATE_CHANNEL_ACTIONS.has(action);
}

export async function dispatchQAppPrivateChannelRequest(
  message: QAppPrivateChannelMessage,
  context: QAppPrivateChannelContext
) {
  if (!isQAppPrivateChannelAction(message.action)) {
    throw codedQortalRequestError(
      'INVALID_ACTION',
      'Invalid private channel action'
    );
  }
  if (
    !hasSessionPermission(
      context.tabId,
      context.appName,
      'PRIVATE_DATA_CHANNEL'
    )
  ) {
    throw codedQortalRequestError(
      'PERMISSION_DENIED',
      'Private data channel permission is required'
    );
  }

  const api = window.electronAPI;
  if (!api) {
    throw codedQortalRequestError(
      'PRIVATE_TRANSPORT_UNAVAILABLE',
      'Private channel transport is unavailable'
    );
  }
  const identity = normalizeQappIdentityContext({
    name: context.appName,
    service: context.appService,
  });
  const owner = {
    tabId: String(context.tabId),
    name: identity.name,
    service: identity.service,
  };

  switch (message.action) {
    case 'PRIVATE_CHANNEL_OPEN':
      if (!api.privateChannelOpen) {
        throw codedQortalRequestError(
          'PRIVATE_TRANSPORT_UNAVAILABLE',
          'Private channel transport is unavailable'
        );
      }
      return api.privateChannelOpen(
        owner,
        message.rnsConnectionId,
        message.purpose
      );
    case 'PRIVATE_CHANNEL_SEND':
      if (!api.privateChannelSend) {
        throw codedQortalRequestError(
          'PRIVATE_TRANSPORT_UNAVAILABLE',
          'Private channel transport is unavailable'
        );
      }
      return api.privateChannelSend(
        owner,
        message.channelId,
        message.lane,
        message.messageId,
        message.data,
        message.streamOptions
      );
    case 'PRIVATE_CHANNEL_STATUS':
      if (!api.privateChannelStatus) {
        throw codedQortalRequestError(
          'PRIVATE_TRANSPORT_UNAVAILABLE',
          'Private channel transport is unavailable'
        );
      }
      return api.privateChannelStatus(owner, message.channelId);
    case 'PRIVATE_CHANNEL_CLOSE':
      if (!api.privateChannelClose) {
        throw codedQortalRequestError(
          'PRIVATE_TRANSPORT_UNAVAILABLE',
          'Private channel transport is unavailable'
        );
      }
      return api.privateChannelClose(owner, message.channelId);
  }
}
