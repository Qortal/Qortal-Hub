import { normalizeQappIdentityContext } from './qapp-identity.ts';
import { codedQortalRequestError } from './qortal-request-errors.ts';
import { hasSessionPermission } from './qortal-requests.ts';

const QAPP_MOQ_ACTIONS = new Set([
  'MOQ_SESSION_OPEN',
  'MOQ_TRACK_SUBSCRIBE',
  'MOQ_OBJECT_PUBLISH',
  'MOQ_SESSION_METRICS',
  'MOQ_SESSION_CLOSE',
]);

type QAppMoqContext = {
  appName: string;
  appService?: string;
  tabId: string | number;
};

type QAppMoqMessage = {
  action?: string;
  rnsConnectionId?: unknown;
  sessionId?: unknown;
  publicationNamespace?: unknown;
  publicationTrack?: unknown;
  subscriptionId?: unknown;
  namespace?: unknown;
  trackName?: unknown;
  payload?: unknown;
  [key: string]: unknown;
};

export function isQAppMoqAction(action: unknown): action is string {
  return typeof action === 'string' && QAPP_MOQ_ACTIONS.has(action);
}

export async function dispatchQAppMoqRequest(
  message: QAppMoqMessage,
  context: QAppMoqContext
) {
  if (!isQAppMoqAction(message.action)) {
    throw codedQortalRequestError('INVALID_ACTION', 'Invalid MOQT action');
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
  if (!api) unavailable();
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
    case 'MOQ_SESSION_OPEN':
      if (!api.qappMoqOpen) unavailable();
      return api.qappMoqOpen(
        owner,
        message.rnsConnectionId,
        message.publicationNamespace,
        message.publicationTrack
      );
    case 'MOQ_TRACK_SUBSCRIBE':
      if (!api.qappMoqSubscribe) unavailable();
      return api.qappMoqSubscribe(
        owner,
        message.sessionId,
        message.subscriptionId,
        message.namespace,
        message.trackName
      );
    case 'MOQ_OBJECT_PUBLISH':
      if (!api.qappMoqPublish) unavailable();
      return api.qappMoqPublish(owner, message.sessionId, message.payload);
    case 'MOQ_SESSION_METRICS':
      if (!api.qappMoqMetrics) unavailable();
      return api.qappMoqMetrics(owner, message.sessionId);
    case 'MOQ_SESSION_CLOSE':
      if (!api.qappMoqClose) unavailable();
      return api.qappMoqClose(owner, message.sessionId);
  }
}

function unavailable(): never {
  throw codedQortalRequestError(
    'MOQ_TRANSPORT_UNAVAILABLE',
    'MOQT transport is unavailable'
  );
}
