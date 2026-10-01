import { authorizeRnsDestination } from './get.ts';
import { normalizeQappIdentityContext } from './qapp-identity.ts';

const QAPP_RETICULUM_ACTIONS = new Set([
  'RNS_CLOSE',
  'RNS_CONNECT',
  'RNS_REQUEST',
  'RNS_SEND',
]);

type QAppReticulumContext = {
  appName: string;
  appService?: string;
  isFromExtension: boolean;
  tabId: string | number;
};

type QAppReticulumMessage = {
  action?: string;
  connectionId?: string;
  destination?: string;
  payload?: unknown;
  [key: string]: unknown;
};

export function isQAppReticulumAction(action: unknown): action is string {
  return typeof action === 'string' && QAPP_RETICULUM_ACTIONS.has(action);
}

/**
 * Dispatches native Q-App Reticulum operations without putting them on the
 * Hub-wide backgroundMessage bus. That bus is shared by unrelated Hub
 * features and is the wrong isolation boundary for a per-Q-App transport.
 */
export async function dispatchQAppReticulumRequest(
  message: QAppReticulumMessage,
  context: QAppReticulumContext
) {
  if (!isQAppReticulumAction(message.action)) {
    throw new Error('RNS_PROTOCOL_ERROR');
  }

  const api = window.electronAPI;
  if (!api) throw new Error('RNS_NATIVE_TRANSPORT_UNAVAILABLE');

  const identity = normalizeQappIdentityContext({
    name: context.appName,
    service: context.appService,
  });
  const owner = {
    tabId: String(context.tabId),
    name: identity.name,
    service: identity.service,
  };
  const appInfo = { tabId: context.tabId, name: context.appName };

  if (message.action === 'RNS_REQUEST') {
    if (!api.qappReticulumRequest)
      throw new Error('RNS_NATIVE_TRANSPORT_UNAVAILABLE');
    if (typeof message.destination !== 'string')
      throw new Error('RNS_DESTINATION_UNREACHABLE');
    const destination = await authorizeRnsDestination(
      message.destination,
      context.isFromExtension,
      appInfo
    );
    return api.qappReticulumRequest(owner, { ...message, destination });
  }

  if (message.action === 'RNS_CONNECT') {
    if (!api.qappReticulumConnect)
      throw new Error('RNS_NATIVE_TRANSPORT_UNAVAILABLE');
    if (typeof message.destination !== 'string')
      throw new Error('RNS_DESTINATION_UNREACHABLE');
    const destination = await authorizeRnsDestination(
      message.destination,
      context.isFromExtension,
      appInfo
    );
    return api.qappReticulumConnect(owner, destination);
  }

  if (message.action === 'RNS_SEND') {
    if (!api.qappReticulumSend)
      throw new Error('RNS_NATIVE_TRANSPORT_UNAVAILABLE');
    if (typeof message.connectionId !== 'string' || !message.connectionId)
      throw new Error('RNS_UNKNOWN_CONNECTION');
    return api.qappReticulumSend(owner, message.connectionId, message.payload);
  }

  if (!api.qappReticulumClose)
    throw new Error('RNS_NATIVE_TRANSPORT_UNAVAILABLE');
  if (typeof message.connectionId !== 'string' || !message.connectionId)
    throw new Error('RNS_UNKNOWN_CONNECTION');
  return api.qappReticulumClose(owner, message.connectionId);
}
