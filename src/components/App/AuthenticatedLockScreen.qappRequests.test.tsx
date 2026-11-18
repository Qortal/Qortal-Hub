import { useRef } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDefaultStore, useAtomValue } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { appLockedAtom } from '../../atoms/presence';
import { useAppMessageHandler } from '../../hooks/useAppMessageHandler';
import { useModal } from '../../hooks/useModal';
import { darkTheme } from '../../styles/theme-dark';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import {
  APP_LOCK_SCREEN_Z_INDEX,
  AuthenticatedLockScreen,
} from './AuthenticatedLockScreen';
import { NotificationPermissionSlideDown } from './NotificationPermissionSlideDown';
import { PaymentPublishDialog } from './PaymentPublishDialog';
import { QortalRequestExtensionDialog } from './QortalRequestExtensionDialog';

const store = getDefaultStore();
const REQUEST_TEXT = 'Opened-App asks to publish a file.';
const NOTIFICATION_TEXT = 'Allow Opened-App to send you Hub notifications?';

// App's wiring of a Q-App's approval request: the message handler passes it
// to a handler that shows the approval dialog and answers with the choice.
// App also mounts the notification permission prompt.
function LockableHub() {
  const approval = useModal();
  const isAppLocked = useAtomValue(appLockedAtom);
  const permissionHandlerRef = useRef(null);
  permissionHandlerRef.current = async (message, event) => {
    reachedTheDialog.push(message.requestId);
    let accepted = false;
    try {
      await approval.show(message.payload);
      accepted = true;
    } catch {
      accepted = false;
    }
    event.source.postMessage(
      {
        action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
        requestId: message.requestId,
        result: { accepted },
      },
      event.origin
    );
  };
  useAppMessageHandler({ current: true }, permissionHandlerRef);

  return (
    <>
      <NotificationPermissionSlideDown />
      {approval.isShow && (
        <QortalRequestExtensionDialog
          open={approval.isShow}
          message={approval.message}
          sendPaymentError=""
          confirmRequestRead={false}
          onConfirmRequestReadChange={vi.fn()}
          onCheckbox1Change={vi.fn()}
          onAccept={() => approval.onOk('accepted')}
          onCancel={approval.onCancel}
          onCountdownComplete={approval.onCancel}
        />
      )}
      {isAppLocked && (
        <AuthenticatedLockScreen
          accountLabel="Publisher"
          onUnlock={async () => {
            store.set(appLockedAtom, false);
          }}
        />
      )}
    </>
  );
}

let answers: { requestId: string; accepted: boolean }[];
let notificationAnswers: { requestId: string; accepted: boolean }[];
// Requests passed on to the approval dialog.
let reachedTheDialog: string[];
let postMessage: ReturnType<typeof vi.spyOn>;
let requestCount = 0;

// A Q-App's request, as getUserPermission posts it to Hub's own window.
const askApproval = () => {
  requestCount += 1;
  const requestId = `request-${requestCount}`;
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          action: 'QORTAL_REQUEST_PERMISSION',
          payload: { text1: REQUEST_TEXT },
          requestId,
          isFromExtension: true,
        },
        origin: window.location.origin,
        source: window,
      })
    );
  });
  return requestId;
};

// A Q-App's NOTIFICATION_PERMISSION, as getNotificationPermission posts it.
const askNotifications = () => {
  requestCount += 1;
  const requestId = `notificationPermission_${requestCount}`;
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          action: 'NOTIFICATION_PERMISSION_REQUEST',
          requestId,
          appInfo: { name: 'Opened-App', tabId: 'tab-1' },
          payload: { text1: NOTIFICATION_TEXT },
        },
        origin: window.location.origin,
        source: window,
      })
    );
  });
  return requestId;
};

const renderHub = () =>
  render(
    <ThemeProvider theme={darkTheme}>
      <LockableHub />
    </ThemeProvider>
  );

const passwordField = () => document.querySelector('input[type="password"]');
// The dialog shows the request's text twice: as its summary and its text.
const requestOnScreen = () => screen.queryAllByText(REQUEST_TEXT).length > 0;
const waitForRequest = () =>
  waitFor(() => expect(requestOnScreen()).toBe(true));

beforeEach(() => {
  answers = [];
  notificationAnswers = [];
  reachedTheDialog = [];
  postMessage = vi
    .spyOn(window, 'postMessage')
    .mockImplementation((data: any) => {
      if (data?.action === 'QORTAL_REQUEST_PERMISSION_RESPONSE') {
        answers.push({
          requestId: data.requestId,
          accepted: data.result?.accepted,
        });
      }
      if (data?.action === 'NOTIFICATION_PERMISSION_RESPONSE') {
        notificationAnswers.push({
          requestId: data.requestId,
          accepted: data.result?.accepted,
        });
      }
    });
  store.set(appLockedAtom, false);
});

afterEach(() => {
  postMessage.mockRestore();
  store.set(appLockedAtom, false);
});

describe("a Q-App's approval request and the lock screen", () => {
  it('shows the request and passes on Accept while Hub is unlocked', async () => {
    const user = userEvent.setup();
    renderHub();

    const requestId = askApproval();
    await waitForRequest();
    await user.click(screen.getByText('Accept'));

    await waitFor(() =>
      expect(answers).toEqual([{ requestId, accepted: true }])
    );
  });

  it('answers a request that comes while Hub is locked as declined, and opens nothing', async () => {
    store.set(appLockedAtom, true);
    renderHub();
    await waitFor(() => expect(passwordField()).toHaveFocus());

    const requestId = askApproval();

    await waitFor(() =>
      expect(answers).toEqual([{ requestId, accepted: false }])
    );
    expect(reachedTheDialog).toEqual([]);
    expect(requestOnScreen()).toBe(false);
    // Nothing took the password field's focus.
    expect(passwordField()).toHaveFocus();
  });

  it('declines a request still on screen when Hub locks', async () => {
    renderHub();
    const requestId = askApproval();
    await waitForRequest();

    act(() => store.set(appLockedAtom, true));

    await waitFor(() =>
      expect(answers).toEqual([{ requestId, accepted: false }])
    );
    expect(requestOnScreen()).toBe(false);
    await waitFor(() => expect(passwordField()).toHaveFocus());
  });

  it('declines a request that comes in the same moment as the lock', async () => {
    renderHub();
    let requestId = '';
    act(() => {
      requestId = askApproval();
      store.set(appLockedAtom, true);
    });

    await waitFor(() =>
      expect(answers).toEqual([{ requestId, accepted: false }])
    );
    expect(requestOnScreen()).toBe(false);
    await waitFor(() => expect(passwordField()).toHaveFocus());
  });

  it('shows the next request as usual once Hub is unlocked', async () => {
    const user = userEvent.setup();
    store.set(appLockedAtom, true);
    renderHub();
    const whileLocked = askApproval();
    await waitFor(() =>
      expect(answers).toEqual([{ requestId: whileLocked, accepted: false }])
    );

    await user.type(passwordField() as HTMLElement, 'secret');
    await user.click(screen.getByRole('button', { name: /unlock/i }));
    await waitFor(() => expect(passwordField()).not.toBeInTheDocument());

    const afterUnlock = askApproval();
    await waitForRequest();
    await user.click(screen.getByText('Accept'));
    await waitFor(() =>
      expect(answers).toEqual([
        { requestId: whileLocked, accepted: false },
        { requestId: afterUnlock, accepted: true },
      ])
    );
  });
});

describe("a Q-App's notification permission request and the lock screen", () => {
  const promptOnScreen = () => screen.queryByText(NOTIFICATION_TEXT) !== null;

  it('is shown while Hub is unlocked', async () => {
    renderHub();
    askNotifications();
    await waitFor(() => expect(promptOnScreen()).toBe(true));
    expect(notificationAnswers).toEqual([]);
  });

  it('is answered as declined when it comes while Hub is locked, and never reaches the prompt', async () => {
    const reachedThePrompt = vi.fn();
    subscribeToEvent('show-notification-permission', reachedThePrompt);
    store.set(appLockedAtom, true);
    renderHub();

    const requestId = askNotifications();

    await waitFor(() =>
      expect(notificationAnswers).toEqual([{ requestId, accepted: false }])
    );
    expect(reachedThePrompt).not.toHaveBeenCalled();
    expect(promptOnScreen()).toBe(false);
    unsubscribeFromEvent('show-notification-permission', reachedThePrompt);
  });

  it('is declined, with any waiting behind it, when Hub locks', async () => {
    renderHub();
    const first = askNotifications();
    const second = askNotifications();
    await waitFor(() => expect(promptOnScreen()).toBe(true));

    act(() => store.set(appLockedAtom, true));

    await waitFor(() =>
      expect(notificationAnswers).toEqual([
        { requestId: first, accepted: false },
        { requestId: second, accepted: false },
      ])
    );
    act(() => store.set(appLockedAtom, false));
    expect(promptOnScreen()).toBe(false);
  });
});

describe('the lock screen over Hub layers', () => {
  // The layers a Q-App's request or Hub's own actions can put up: the
  // approval dialog and Hub's fee confirmation.
  it('sits above the approval dialog and the fee confirmation', async () => {
    store.set(appLockedAtom, true);
    render(
      <ThemeProvider theme={darkTheme}>
        <PaymentPublishDialog
          open
          message={{ message: 'Publish?', publishFee: '0.01 QORT' }}
          onAccept={vi.fn()}
          onCancel={vi.fn()}
        />
        <QortalRequestExtensionDialog
          open
          message={{ text1: REQUEST_TEXT }}
          sendPaymentError=""
          confirmRequestRead={false}
          onConfirmRequestReadChange={vi.fn()}
          onCheckbox1Change={vi.fn()}
          onAccept={vi.fn()}
          onCancel={vi.fn()}
          onCountdownComplete={vi.fn()}
        />
        <AuthenticatedLockScreen accountLabel="Publisher" onUnlock={vi.fn()} />
      </ThemeProvider>
    );
    await waitForRequest();

    const layerOf = (element: Element) =>
      element.closest('.MuiModal-root') as HTMLElement;
    const zIndexOf = (element: Element) =>
      Number(getComputedStyle(layerOf(element)).zIndex);
    const lockScreen = zIndexOf(passwordField());
    const approval = zIndexOf(screen.getAllByText(REQUEST_TEXT)[0]);
    const feeConfirmation = zIndexOf(screen.getByText('Publish?'));

    expect(lockScreen).toBe(APP_LOCK_SCREEN_Z_INDEX);
    expect(lockScreen).toBeGreaterThan(approval);
    expect(lockScreen).toBeGreaterThan(feeConfirmation);
  });
});
