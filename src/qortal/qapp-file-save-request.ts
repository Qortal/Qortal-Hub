import i18n from '../i18n/i18n';
import { normalizeQappIdentityContext } from './qapp-identity';
import { codedQortalRequestError } from './qortal-request-errors';

export const isQAppFileSaveAction = (action: unknown) =>
  [
    'FILE_SAVE_OPEN',
    'FILE_SAVE_WRITE',
    'FILE_SAVE_FINISH',
    'FILE_SAVE_ABORT',
  ].includes(action as string);

export async function dispatchQAppFileSaveRequest(message, context) {
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
  const result = await api(owner, request);
  if (result?.error)
    throw codedQortalRequestError(
      result.error,
      i18n.t('question:stream_save.failed')
    );
  return result;
}
