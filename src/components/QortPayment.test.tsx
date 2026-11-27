import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// Hub's Send QORT dialog resolves the recipient before its confirmation,
// shows the name and the full address there, and sends to that address with
// the fee it showed. The tests of names with invisible characters use the real
// resolveRecipient from background.ts.

const FEE = '0.01000000';

function withParams(key: string, options?: Record<string, unknown>) {
  const params = { ...(options || {}) };
  delete params.postProcess;
  delete params.defaultValue;
  return Object.keys(params).length ? `${key} ${JSON.stringify(params)}` : key;
}

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: withParams, i18n: { language: 'en' } }),
}));
vi.mock('i18next', () => ({ default: { t: withParams } }));
vi.mock('../background/background.ts', () => ({
  getFee: vi.fn(),
  resolveRecipient: vi.fn(),
}));
vi.mock('../utils/events', () => ({ executeEvent: vi.fn() }));
// src/test/setup.ts stubs asmcrypto out; addresses need the real SHA-256.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
// The real background.ts is loaded below. Hub's i18n setup, its worker, its
// handlers for Hub's own messages, the Q-App request module and the QDN
// publish module are left out.
vi.mock('../i18n/i18n', () => ({ default: { t: withParams } }));
vi.mock('../qortal/qortal-requests', () => ({
  getNotificationOsPushDisabled: vi.fn(() => false),
}));
vi.mock('../background/background-cases', () => ({}));
vi.mock('../qdn/publish/publish', () => ({ reusableGet: vi.fn() }));
vi.mock('../chatComputePow.worker.js?worker', () => ({
  default: class {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    postMessage() {}
  },
}));

import { QortPayment } from './QortPayment';
import { lightTheme } from '../styles/theme-light';
import { getFee, resolveRecipient } from '../background/background.ts';
import { executeEvent } from '../utils/events';
import publicKeyToAddressUntyped from '../utils/generateWallet/publicKeyToAddress';

const publicKeyToAddress = publicKeyToAddressUntyped as any;

// Account-A is Recipient B's address; Account-X owns names with invisible
// characters.
const ACCOUNT_A = String(publicKeyToAddress(new Uint8Array(32).fill(41)));
const ACCOUNT_X = String(publicKeyToAddress(new Uint8Array(32).fill(42)));

type Background = typeof import('../background/background');
/** The real resolveRecipient; the module mock above stands in for it. */
let realResolveRecipient: Background['resolveRecipient'];

beforeAll(async () => {
  realResolveRecipient = (
    await vi.importActual<Background>('../background/background')
  ).resolveRecipient;
});

const sendMessage = vi.fn();

function renderPayment(recipient = 'Recipient B', amount = '1.5') {
  const show = vi.fn(async (_message: unknown) => true);
  const onSuccess = vi.fn();
  render(
    <ThemeProvider theme={lightTheme}>
      <QortPayment
        balance={100}
        show={show}
        onSuccess={onSuccess}
        defaultPaymentTo={recipient}
      />
    </ThemeProvider>
  );
  fireEvent.change(screen.getByDisplayValue('0'), {
    target: { value: amount },
  });
  const password = document.getElementById(
    'payment-password'
  ) as HTMLInputElement;
  fireEvent.focus(password);
  fireEvent.change(password, { target: { value: 'pw' } });
  return { show, onSuccess };
}

const clickSend = () =>
  fireEvent.click(screen.getByRole('button', { name: 'core:action.send' }));

beforeEach(() => {
  vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: FEE });
  vi.mocked(resolveRecipient).mockResolvedValue({
    address: ACCOUNT_A,
    name: 'Recipient B',
  });
  sendMessage.mockResolvedValue(true);
  (window as unknown as { sendMessage: unknown }).sendMessage = sendMessage;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete (window as unknown as { sendMessage?: unknown }).sendMessage;
});

describe('QortPayment', () => {
  it('confirms with the name and the full address, then pays that address with the fee it showed', async () => {
    const { show, onSuccess } = renderPayment();
    clickSend();

    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    expect(resolveRecipient).toHaveBeenCalledWith('Recipient B');
    const { message, paymentFee } = show.mock.calls[0][0] as {
      message: string;
      paymentFee: string;
    };
    expect(message).toContain('core:message.question.transfer_qort_to');
    expect(message).toContain('"amount":"1.5"');
    expect(message).toContain('question:recipient_name_address');
    expect(message).toContain('Recipient B');
    expect(message).toContain(ACCOUNT_A);
    expect(paymentFee).toBe(`${FEE} QORT`);

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(sendMessage).toHaveBeenCalledWith('sendCoin', {
      amount: 1.5,
      receiver: ACCOUNT_A,
      password: 'pw',
      approvedFee: FEE,
    });
  });

  it('pays an address as given', async () => {
    vi.mocked(resolveRecipient).mockResolvedValue({
      address: ACCOUNT_A,
      name: '',
    });
    const { show, onSuccess } = renderPayment(ACCOUNT_A, '2');
    clickSend();

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const { message } = show.mock.calls[0][0] as { message: string };
    expect(message).toBe(
      `core:message.question.transfer_qort_to ${JSON.stringify({
        amount: '2',
        recipient: ACCOUNT_A,
      })}`
    );
    expect(sendMessage).toHaveBeenCalledWith('sendCoin', {
      amount: 2,
      receiver: ACCOUNT_A,
      password: 'pw',
      approvedFee: FEE,
    });
  });

  it('shows the lookup error and asks nothing when the name does not resolve', async () => {
    vi.mocked(resolveRecipient).mockRejectedValueOnce(
      new Error('name does not exist')
    );
    const { show } = renderPayment('Recipient X');
    clickSend();

    expect(await screen.findByText('name does not exist')).toBeTruthy();
    expect(show).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('shows the refusal and asks nothing when the node fee is above the ceiling', async () => {
    vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: '5.00000000' });
    const { show } = renderPayment();
    clickSend();

    expect(
      await screen.findByText(/question:message\.error\.fee_above_limit/)
    ).toBeTruthy();
    expect(show).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('shows the refusal and asks nothing when the fee cannot be read', async () => {
    vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: 'NaN' });
    const { show } = renderPayment();
    clickSend();

    expect(
      await screen.findByText('question:message.error.fee_invalid')
    ).toBeTruthy();
    expect(show).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['a braille blank (U+2800)', 'Recipient B\u2800'],
    ['a zero-width space (U+200B)', 'Recipient\u200B B'],
  ])(
    'refuses a name with %s, asks nothing and sends nothing',
    async (_label, name) => {
      vi.mocked(resolveRecipient).mockImplementation(realResolveRecipient);
      // The node would answer that Account-X owns the name.
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ name, owner: ACCOUNT_X }),
      }));
      vi.stubGlobal('fetch', fetchMock);
      const { show } = renderPayment(name);
      clickSend();

      expect(
        await screen.findByText(
          'question:message.error.recipient_invisible_characters'
        )
      ).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(show).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    }
  );

  // What the dialog is told after it sent the payment: only `true` is a
  // payment the node took.
  it('shows the reason and keeps the dialog open when the payment was not sent', async () => {
    sendMessage.mockResolvedValue({
      error: 'transaction invalid: invalid address (INVALID_ADDRESS)',
      message: 'transaction invalid: invalid address (INVALID_ADDRESS)',
    });
    const { onSuccess } = renderPayment();
    clickSend();

    expect(
      await screen.findByText(
        'transaction invalid: invalid address (INVALID_ADDRESS)'
      )
    ).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(executeEvent).not.toHaveBeenCalled();
  });

  it('shows a failure, not a payment, when the answer gives no reason', async () => {
    // sendCoinCase gives a reason for every payment it sent, so an answer
    // without one comes from a failure before signing.
    sendMessage.mockResolvedValue(undefined);
    const { onSuccess } = renderPayment();
    clickSend();

    expect(await screen.findByText('question:message.error.send')).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(executeEvent).not.toHaveBeenCalled();
  });

  it('says Hub cannot tell whether the payment went through when no answer comes in time', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    sendMessage.mockRejectedValue({
      error: 'timeout',
      message: 'Request timed out after 600000 ms (action: sendCoin)',
    });
    const { onSuccess } = renderPayment();
    clickSend();

    expect(
      await screen.findByText('question:message.error.payment_outcome_unknown')
    ).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  // The overlay can be closed while the payment is in flight.
  it.each([
    [
      'Hub cannot tell whether it went through',
      {
        error: 'question:message.error.payment_outcome_unknown',
        code: 'PAYMENT_OUTCOME_UNKNOWN',
        message: 'question:message.error.payment_outcome_unknown',
      },
      {
        message: 'question:message.error.payment_outcome_unknown',
        type: 'warning',
      },
    ],
    [
      'the node refused it',
      {
        error: 'transaction invalid: invalid address (INVALID_ADDRESS)',
        message: 'transaction invalid: invalid address (INVALID_ADDRESS)',
      },
      {
        message: 'transaction invalid: invalid address (INVALID_ADDRESS)',
        type: 'error',
      },
    ],
  ])(
    'tells it in Hub’s notification when the dialog closed before it heard that %s',
    async (_label, answer, notification) => {
      let reply: (value: unknown) => void = () => {};
      sendMessage.mockReturnValue(
        new Promise((resolve) => {
          reply = resolve;
        })
      );
      renderPayment();
      clickSend();
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

      cleanup();
      reply(answer);

      await waitFor(() =>
        expect(executeEvent).toHaveBeenCalledWith('openGlobalSnackBar', {
          ...notification,
          duration: 8000,
        })
      );
    }
  );

  it('tells it in Hub’s notification when the dialog closed and no answer came in time', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    let timeOut: (reason: unknown) => void = () => {};
    sendMessage.mockReturnValue(
      new Promise((_resolve, reject) => {
        timeOut = reject;
      })
    );
    renderPayment();
    clickSend();
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    cleanup();
    timeOut({
      error: 'timeout',
      message: 'Request timed out after 600000 ms (action: sendCoin)',
    });

    await waitFor(() =>
      expect(executeEvent).toHaveBeenCalledWith('openGlobalSnackBar', {
        message: 'question:message.error.payment_outcome_unknown',
        type: 'warning',
        duration: 8000,
      })
    );
    consoleError.mockRestore();
  });
});
