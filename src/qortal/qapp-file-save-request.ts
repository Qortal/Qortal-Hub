import i18n from '../i18n/i18n';
import { normalizeQappIdentityContext } from './qapp-identity';
import { codedQortalRequestError } from './qortal-request-errors';
import { isHubLocked } from '../atoms/presence';
import { hubLockedError, refuseWhileHubLocked } from './hubLocked';
import { noteTabFileSave } from '../components/Apps/tabActivity';

export const isQAppFileSaveAction = (action: unknown) =>
  [
    'FILE_SAVE_OPEN',
    'FILE_SAVE_WRITE',
    'FILE_SAVE_FINISH',
    'FILE_SAVE_ABORT',
  ].includes(action as string);

// Main refuses these without ending the save (electron/src/qapp-file-save.ts):
// the app can still send the right piece, or finish once all are written.
const SAVE_ERRORS_KEEPING_IT_OPEN = new Set([
  'SAVE_BUSY',
  'SAVE_INCOMPLETE',
  'SAVE_INVALID_CHUNK',
]);

export async function dispatchQAppFileSaveRequest(message, context) {
  // Opening a save asks in a window of its own; one already open goes on.
  if (message?.action === 'FILE_SAVE_OPEN') refuseWhileHubLocked();
  const api = window.electronAPI?.qappFileSave;
  if (!api)
    throw codedQortalRequestError(
      'SAVE_UNAVAILABLE',
      i18n.t('question:stream_save.unavailable')
    );
  const identity = normalizeQappIdentityContext({
    name: context.appName,
    service: context.appService,
  });
  const owner = { tabId: String(context.tabId), ...identity };
  // Never accept ownership or permission labels supplied by the iframe.
  const request = {
    action: message.action,
    filename: message.filename,
    size: message.size,
    saveId: message.saveId,
    offset: message.offset,
    data: message.data,
    ...(message.action === 'FILE_SAVE_OPEN'
      ? {
          labels: {
            title: i18n.t('question:stream_save.title'),
            detail: i18n.t('question:stream_save.detail', {
              app: identity.name,
              filename: String(message.filename).slice(0, 200),
              size: Number(message.size).toLocaleString(),
            }),
            allow: i18n.t('question:stream_save.choose'),
            cancel: i18n.t('core:action.cancel', {
              postProcess: 'capitalizeFirstChar',
            }),
          },
        }
      : {}),
  };
  // A save open in a tab keeps it awake between its pieces (tabSleep.ts):
  // putting the tab to sleep would end it.
  let result;
  try {
    result = await api(owner, request);
  } catch (error) {
    if (message.action !== 'FILE_SAVE_OPEN')
      noteTabFileSave(owner.tabId, message.saveId, 'done');
    throw error;
  }
  if (message.action === 'FILE_SAVE_ABORT') {
    noteTabFileSave(owner.tabId, message.saveId, 'done');
  } else if (message.action !== 'FILE_SAVE_OPEN') {
    const stillOpen = SAVE_ERRORS_KEEPING_IT_OPEN.has(result?.error);
    const ended =
      !stillOpen && (message.action === 'FILE_SAVE_FINISH' || !!result?.error);
    noteTabFileSave(owner.tabId, message.saveId, ended ? 'done' : 'write');
  }
  if (result?.error)
    throw codedQortalRequestError(
      result.error,
      i18n.t('question:stream_save.failed')
    );
  // Its prompt was answered after Hub locked: the save doesn't start.
  if (message.action === 'FILE_SAVE_OPEN' && result?.saveId && isHubLocked()) {
    await api(owner, {
      action: 'FILE_SAVE_ABORT',
      saveId: result.saveId,
    }).catch(() => undefined);
    throw hubLockedError();
  }
  if (message.action === 'FILE_SAVE_OPEN')
    noteTabFileSave(owner.tabId, result?.saveId, 'open');
  return result;
}
