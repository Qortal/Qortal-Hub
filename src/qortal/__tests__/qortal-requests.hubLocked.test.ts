import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// qortal-requests answers Q-App requests posted to Hub's own window. Only its
// SHOW_PDF_READER, OPEN_USER_LOOKUP and OPEN_NEW_TAB cases run here, so what
// else it imports is mocked. The two get.ts calls refuse as get.ts does.
vi.mock('../get', async () => {
  const { refuseWhileHubLocked } = await import('../hubLocked');
  const opens = async () => {
    refuseWhileHubLocked();
    return true;
  };
  return { openUserLookup: vi.fn(opens), openNewTab: vi.fn(opens) };
});
vi.mock('../../background/background', async () =>
  (await import('./common')).backgroundFactory()
);
vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('./common')).messageListenerFactory()
);
vi.mock('../../subscriptions/useInitializeMySubscriptions', () => ({
  triggerMemberGroupsFetch: vi.fn(),
}));
vi.mock('../../utils/chromeStorage', () => ({
  getData: vi.fn(),
  storeData: vi.fn(),
}));
vi.mock('../../utils/events', async () =>
  (await import('./common')).eventsFactory()
);
vi.mock('i18next', async () => (await import('./common')).i18nFactory());
vi.mock('../../i18n/i18n', async () =>
  (await import('./common')).i18nFactory()
);

import { getDefaultStore } from 'jotai';
import { appLockedAtom } from '../../atoms/presence';
import { executeEvent } from '../../utils/events';
import { HUB_LOCKED_CODE } from '../hubLocked';
import '../qortal-requests';

const store = getDefaultStore();
let answers: any[];
let postMessage: ReturnType<typeof vi.spyOn>;

// A Q-App's request, as Hub's request bridge posts it.
const ask = async (action: string, payload: unknown) => {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: {
        type: 'backgroundMessage',
        action,
        requestId: `${action}-1`,
        payload,
        isExtension: true,
        appInfo: { name: 'Opened-App', service: 'APP', tabId: 'tab-1' },
      },
      origin: window.location.origin,
      source: window,
    })
  );
  await vi.waitFor(() => expect(answers).toHaveLength(1));
  return answers[0];
};
const showPdf = () =>
  ask('SHOW_PDF_READER', {
    blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  answers = [];
  postMessage = vi
    .spyOn(window, 'postMessage')
    .mockImplementation((data: any) => {
      if (data?.type === 'backgroundMessageResponse') answers.push(data);
    });
  store.set(appLockedAtom, false);
});

afterEach(() => {
  postMessage.mockRestore();
  store.set(appLockedAtom, false);
});

describe("a Q-App's SHOW_PDF_READER", () => {
  it('opens the PDF reader while Hub is unlocked', async () => {
    expect(await showPdf()).toMatchObject({ payload: true });
    expect(executeEvent).toHaveBeenCalledWith('openPdf', {
      blob: expect.any(Blob),
    });
  });

  it('opens nothing while Hub is locked, and says why', async () => {
    store.set(appLockedAtom, true);
    expect(await showPdf()).toMatchObject({
      code: HUB_LOCKED_CODE,
      message: 'question:message.error.hub_locked',
    });
    expect(executeEvent).not.toHaveBeenCalled();
  });
});

// The Q-App gets the code with the text, as for other coded errors.
describe('the locked answer to a Q-App', () => {
  it.each([
    ['OPEN_USER_LOOKUP', { user: 'Publisher' }],
    ['OPEN_NEW_TAB', { qortalLink: 'qortal://APP/Opened-App' }],
  ])('carries the HUB_LOCKED code for %s', async (action, payload) => {
    store.set(appLockedAtom, true);
    expect(await ask(action, payload)).toMatchObject({
      code: HUB_LOCKED_CODE,
      message: 'question:message.error.hub_locked',
    });
  });

  it.each([
    ['OPEN_USER_LOOKUP', { user: 'Publisher' }],
    ['OPEN_NEW_TAB', { qortalLink: 'qortal://APP/Opened-App' }],
  ])('is not given for %s while Hub is unlocked', async (action, payload) => {
    expect(await ask(action, payload)).toMatchObject({ payload: true });
  });
});
