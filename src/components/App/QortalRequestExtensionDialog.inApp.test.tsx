import { useCallback, useRef } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (hoisted before any import) ────────────────────────────────
// What get.ts reaches out to, as in src/qortal/__tests__.

vi.mock('../../qortal/qortal-requests', async () =>
  (await import('../../qortal/__tests__/common')).qortalRequestsFactory()
);
vi.mock('../../background/background', async () =>
  (await import('../../qortal/__tests__/common')).backgroundFactory()
);
vi.mock('../../encryption/encryption', async () =>
  (await import('../../qortal/__tests__/common')).encryptionFactory()
);
vi.mock('../Chat/AdminSpaceInner', async () =>
  (await import('../../qortal/__tests__/common')).adminSpaceFactory()
);
vi.mock('../Chat/MessageDisplay', async () =>
  (await import('../../qortal/__tests__/common')).messageDisplayFactory()
);
vi.mock('../Group/Group', async () =>
  (await import('../../qortal/__tests__/common')).groupFactory()
);
vi.mock('../../qdn/encryption/group-encryption', async () =>
  (await import('../../qortal/__tests__/common')).groupEncryptionFactory()
);
vi.mock('../../qdn/publish/publish', async () =>
  (await import('../../qortal/__tests__/common')).publishFactory()
);
vi.mock('../../transactions/TradeBotCreateRequest', async () =>
  (await import('../../qortal/__tests__/common')).tradeBotCreateFactory()
);
vi.mock('../../transactions/TradeBotDeleteRequest', async () =>
  (await import('../../qortal/__tests__/common')).tradeBotDeleteFactory()
);
vi.mock('../../transactions/signTradeBotTransaction', async () =>
  (await import('../../qortal/__tests__/common')).signTradeBotFactory()
);
vi.mock('../../transactions/transactions', async () =>
  (await import('../../qortal/__tests__/common')).transactionsFactory()
);
vi.mock('../../utils/events', async () =>
  (await import('../../qortal/__tests__/common')).eventsFactory()
);
vi.mock('../../utils/fileReading/index', async () =>
  (await import('../../qortal/__tests__/common')).fileReadingFactory()
);
vi.mock('../../utils/memeTypes', async () =>
  (await import('../../qortal/__tests__/common')).mimeTypesFactory()
);
vi.mock('../../utils/queue/queue', async () =>
  (await import('../../qortal/__tests__/common')).queueFactory()
);
vi.mock('../../utils/utils', async () =>
  (await import('../../qortal/__tests__/common')).utilsFactory()
);
vi.mock('short-unique-id', async () =>
  (await import('../../qortal/__tests__/common')).shortUidFactory()
);
vi.mock('../../utils/decode', async () =>
  (await import('../../qortal/__tests__/common')).decodeFactory()
);
vi.mock('aes-js', async () =>
  (await import('../../qortal/__tests__/common')).aesFactory()
);
vi.mock('../../encryption/Base58', async () =>
  (await import('../../qortal/__tests__/common')).base58Factory()
);
vi.mock('../../encryption/ed2curve', async () =>
  (await import('../../qortal/__tests__/common')).ed2curveFactory()
);
vi.mock('../../encryption/nacl-fast', async () =>
  (await import('../../qortal/__tests__/common')).naclFactory()
);
vi.mock('asmcrypto.js', async () =>
  (await import('../../qortal/__tests__/common')).asmcryptoFactory()
);
vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('../../qortal/__tests__/common')).messageListenerFactory()
);
vi.mock('../../qortal/qapp-save-file', async () =>
  (await import('../../qortal/__tests__/common')).messageListenerFactory()
);
vi.mock('../../utils/indexedDB', () => ({
  handleGetFileFromIndexedDB: vi.fn(),
}));

import '../../i18n/i18n';
import { darkTheme } from '../../styles/theme-dark';
import { useAppMessageHandler } from '../../hooks/useAppMessageHandler';
import { useAppModals } from '../../hooks/useAppModals';
import {
  getUserAccount,
  publishQDNResource,
  sessionPermissions,
} from '../../qortal/get';
import {
  getPermission,
  hasSessionPermission,
  setPermission,
  VALID_SESSION_PERMISSIONS,
} from '../../qortal/qortal-requests';
import {
  createEndpoint,
  getFee,
  getSaveWallet,
} from '../../background/background';
import { getNameInfo } from '../../encryption/encryption';
import { publishData } from '../../qdn/publish/publish';
import {
  budgetResourceKey,
  findAppBudget,
  refillAppBudget,
  resetAppBudgetsForTests,
  takeFromAppBudget,
} from '../../qortal/appBudgets';
import { QortalRequestExtensionDialog } from './QortalRequestExtensionDialog';

/** Hub's window as far as approvals go: App.tsx's wiring around the dialog. */
function Hub() {
  const {
    qortalRequestExtension,
    confirmRequestRead,
    setConfirmRequestRead,
    qortalRequestCheckbox1Ref,
  } = useAppModals();
  const isFocusedRef = useRef(true);
  const permissionHandlerRef = useRef<any>(null);
  const onCancelQortalRequestExtension = qortalRequestExtension.onCancel;
  const onOkQortalRequestExtension = qortalRequestExtension.onOk;
  const showQortalRequestExtension = qortalRequestExtension.show;
  const isShowQortalRequestExtension = qortalRequestExtension.isShow;
  const messageQortalRequestExtension = qortalRequestExtension.message;

  // As App.tsx's qortalRequestPermissionFromExtension.
  const qortalRequestPermissionFromExtension = async (message, event) => {
    if (message.action === 'QORTAL_REQUEST_PERMISSION') {
      try {
        if (message?.payload?.checkbox1) {
          qortalRequestCheckbox1Ref.current =
            message?.payload?.checkbox1?.value || false;
        }
        setConfirmRequestRead(false);
        const answer = await showQortalRequestExtension(message?.payload);
        // "Top up and approve": get.ts checks the choices again.
        const budgetTopUp =
          answer && typeof answer === 'object' && 'budgetTopUp' in answer
            ? { budgetTopUp: answer.budgetTopUp }
            : {};

        if (qortalRequestCheckbox1Ref.current) {
          event.source.postMessage(
            {
              action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
              requestId: message?.requestId,
              result: {
                accepted: true,
                checkbox1: qortalRequestCheckbox1Ref.current,
                ...budgetTopUp,
              },
            },
            event.origin
          );
          return;
        }
        event.source.postMessage(
          {
            action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
            requestId: message?.requestId,
            result: { accepted: true, ...budgetTopUp },
          },
          event.origin
        );
      } catch (error) {
        event.source.postMessage(
          {
            action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
            requestId: message?.requestId,
            result: { accepted: false },
          },
          event.origin
        );
      }
    }
  };
  permissionHandlerRef.current = qortalRequestPermissionFromExtension;
  useAppMessageHandler(isFocusedRef, permissionHandlerRef);

  const onOkQortalRequestExtensionAccept = useCallback(() => {
    const ext = messageQortalRequestExtension as
      | { confirmCheckbox?: boolean }
      | null
      | undefined;
    if (ext?.confirmCheckbox && !confirmRequestRead) return;
    onOkQortalRequestExtension('accepted');
  }, [
    messageQortalRequestExtension,
    confirmRequestRead,
    onOkQortalRequestExtension,
  ]);
  const onOkQortalRequestExtensionTopUp = useCallback(
    (budgetTopUp: unknown) => {
      const ext = messageQortalRequestExtension as
        | { confirmCheckbox?: boolean }
        | null
        | undefined;
      if (ext?.confirmCheckbox && !confirmRequestRead) return;
      onOkQortalRequestExtension({ budgetTopUp });
    },
    [
      messageQortalRequestExtension,
      confirmRequestRead,
      onOkQortalRequestExtension,
    ]
  );

  return (
    <ThemeProvider theme={darkTheme}>
      {isShowQortalRequestExtension && (
        <QortalRequestExtensionDialog
          open={isShowQortalRequestExtension}
          message={messageQortalRequestExtension}
          sendPaymentError=""
          confirmRequestRead={confirmRequestRead}
          onConfirmRequestReadChange={setConfirmRequestRead}
          onCheckbox1Change={(checked) => {
            qortalRequestCheckbox1Ref.current = checked;
          }}
          onAccept={onOkQortalRequestExtensionAccept}
          onAcceptWithTopUp={onOkQortalRequestExtensionTopUp}
          onCancel={onCancelQortalRequestExtension}
          onCountdownComplete={onCancelQortalRequestExtension}
        />
      )}
    </ThemeProvider>
  );
}

// What each request was answered, in the order the answers came.
let outcomes: string[];
let stored: Map<string, unknown>;

const track = (label: string, request: Promise<unknown>) => {
  request.then(
    () => outcomes.push(`${label}: accepted`),
    () => outcomes.push(`${label}: declined`)
  );
};

/** A Q-App in its own tab asks for session permissions. */
const askPermissions = (tabId: number, name: string) =>
  track(
    name,
    sessionPermissions({ permissions: ['JOIN_GROUP'] }, true, { tabId, name })
  );
/** A Q-App asks to sign in. */
const askSignIn = (tabId: number, name: string) =>
  track(
    name,
    getUserAccount({
      isFromExtension: true,
      appInfo: { tabId, name, service: 'APP' },
    })
  );

// Time passes in short steps, so Hub draws what changed when it changed.
const wait = async (ms: number) => {
  for (let left = ms; left > 0; left -= 50) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(50, left));
    });
  }
};

const click = (text: string | RegExp) =>
  fireEvent.click(screen.getByText(text));
const onScreen = (text: string | RegExp) => screen.queryAllByText(text).length;

const FIRST = 'First App is requesting session permissions';
const SECOND = 'Second App is requesting session permissions';

describe('the approval dialog as App shows it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    outcomes = [];
    stored = new Map();
    vi.mocked(getPermission).mockImplementation(
      async (key: string) => stored.get(key) ?? null
    );
    vi.mocked(setPermission).mockImplementation(
      async (key: string, value: unknown) => {
        stored.set(key, value);
      }
    );
    vi.mocked(hasSessionPermission).mockReturnValue(false);
    VALID_SESSION_PERMISSIONS.splice(
      0,
      VALID_SESSION_PERMISSIONS.length,
      'JOIN_GROUP'
    );
    vi.mocked(getSaveWallet).mockResolvedValue({
      address0: 'Q-test-address',
      publicKey: 'test-public-key',
    });
    // The window posts to itself a moment later, as a browser does.
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      setTimeout(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: window.location.origin,
            source: window,
            data: message,
          })
        );
      }, 0);
    });
    render(<Hub />);
  });

  afterEach(async () => {
    // Let requests still unanswered run out, so the next test starts clean.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(125_000);
    });
    VALID_SESSION_PERMISSIONS.splice(0, VALID_SESSION_PERMISSIONS.length);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not decline the request that waited with the second click of a double click on Decline', async () => {
    askPermissions(1, 'First App');
    askPermissions(2, 'Second App');
    await wait(1200);
    expect(onScreen(FIRST)).toBeGreaterThan(0);

    // A double click on Decline: the second click comes 150 ms after the
    // first, where Decline was.
    click('Decline');
    await wait(150);
    if (onScreen('Decline')) click('Decline');
    await wait(50);

    expect(outcomes).toEqual(['First App: declined']);
    expect(onScreen(SECOND)).toBeGreaterThan(0);
  });

  it('does not take the click that brings Hub back to the front as Accept', async () => {
    // The user works in another window that covers Hub. Hub loses the focus
    // but stays on screen behind it.
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    // An app in Hub asks meanwhile; its dialog comes up behind that window.
    askSignIn(1, 'Example');
    await wait(5000);
    expect(onScreen(/permission to authenticate/i)).toBeGreaterThan(0);

    // The user clicks on Hub to bring it to the front: its window gets the
    // focus, then the click goes to what is under the pointer.
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    click('Accept');
    await wait(50);

    expect(outcomes).toEqual([]);
  });
});

describe('an app budget in the approval dialog as App shows it', () => {
  const ACCOUNT = 'Q-test-address';
  const APP = { service: 'APP' as const, name: 'Opened-App' };
  const QORT = BigInt(100000000);
  const FEE = BigInt(1000000);
  /** A new post from Opened-App's tab. */
  const publishPost = (identifier: string) =>
    track(
      identifier,
      publishQDNResource(
        { service: 'BLOG_POST', identifier, data64: 'QQ==' },
        null,
        true,
        { name: 'Opened-App', service: 'APP', tabId: 4 }
      )
    );

  beforeEach(() => {
    vi.useFakeTimers();
    outcomes = [];
    window.localStorage.clear();
    resetAppBudgetsForTests();
    (window as any).__qortalCurrentAddress = ACCOUNT;
    // A budget of 0.01 QORT, used up by one post.
    refillAppBudget(ACCOUNT, APP, {
      amount: FEE,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      limits: 'standard',
    });
    const used = takeFromAppBudget({
      address: ACCOUNT,
      app: APP,
      kind: 'publish',
      count: 1,
      fee: FEE,
      resources: [budgetResourceKey('BLOG_POST', 'Publisher', 'post-0')],
    });
    if (used.kind !== 'take') throw new Error('expected a budget');
    used.ticket.done({
      service: 'BLOG_POST',
      name: 'Publisher',
      identifier: 'post-0',
    });
    vi.mocked(hasSessionPermission).mockReturnValue(false);
    vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: '0.01000000' });
    vi.mocked(getNameInfo).mockResolvedValue('Publisher');
    vi.mocked(createEndpoint).mockImplementation(
      async (path: string) => `http://127.0.0.1:12391${path}`
    );
    vi.mocked(publishData).mockResolvedValue({ signature: 'PUBLISH_SIG' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: 'NOT_PUBLISHED' }),
      }))
    );
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      setTimeout(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: window.location.origin,
            source: window,
            data: message,
          })
        );
      }, 0);
    });
    render(<Hub />);
  });

  afterEach(async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(125_000);
    });
    delete (window as any).__qortalCurrentAddress;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('tops up the used up budget, publishes, and lets the next post go without asking', async () => {
    publishPost('post-1');
    await wait(1200);
    expect(onScreen('Budget used up')).toBeGreaterThan(0);

    click('5 QORT');
    click('Top up and approve');
    await wait(100);
    expect(outcomes).toEqual(['post-1: accepted']);
    expect(findAppBudget(ACCOUNT, APP)).toMatchObject({
      total: String(FEE + QORT * BigInt(5)),
      used: String(FEE * BigInt(2)),
      actions: 2,
    });

    publishPost('post-2');
    await wait(100);
    expect(outcomes).toEqual(['post-1: accepted', 'post-2: accepted']);
    expect(onScreen('Budget used up')).toBe(0);
    expect(publishData).toHaveBeenCalledTimes(2);
  });

  it('declines without touching the budget', async () => {
    publishPost('post-1');
    await wait(1200);
    click('Decline');
    await wait(100);
    expect(outcomes).toEqual(['post-1: declined']);
    expect(publishData).not.toHaveBeenCalled();
    expect(findAppBudget(ACCOUNT, APP)).toMatchObject({
      total: String(FEE),
      used: String(FEE),
    });
  });
});
