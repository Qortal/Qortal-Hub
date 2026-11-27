import { describe, expect, it, vi } from 'vitest';

// How Hub reads the node's answer to a QORT payment. The answers below are
// the ones Core 6.1.9 gives on /transactions/process (apiVersion 2), plus the
// error pages a gateway in front of a node gives.

vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));

import {
  isQortPaymentRequest,
  PAYMENT_OUTCOME_UNKNOWN_CODE,
  paymentNotSentError,
  paymentOutcomeUnknownError,
  readPaymentAnswer,
} from './paymentAnswer';

/** The Base58 signature of the payment Hub sent (made up). */
const SIGNATURE =
  '3oWWbPqZ9jRvsK7mXz1vWqgfFHUc8N5cBp2ZpS6YtL4kHnYqVdR1sJ8aTgE2uW9xKcM7fB3nLpQ6yA5zDrV4hX1';
/** Core's answer to a payment it accepted: the transaction, as JSON. */
const ACCEPTED = {
  type: 'PAYMENT',
  timestamp: 1795470605055,
  fee: '0.01000000',
  signature: SIGNATURE,
  amount: '1.00000000',
};
/** Core's answer to a payment the account can't pay for. */
const NO_BALANCE = {
  error: 312,
  message: 'transaction invalid: insufficient balance (NO_BALANCE)',
};
/** A gateway's answer when the node behind it doesn't reply. */
const GATEWAY_PAGE =
  '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center></body></html>';
/** Core's own answer to a body it can't read: Jetty's HTML page, status 500. */
const CORE_ERROR_PAGE =
  '<html>\n<head>\n<title>Error 500 Internal Server Error</title>\n</head>\n<body><h2>HTTP ERROR 500 Internal Server Error</h2>\n</body>\n</html>';

describe('readPaymentAnswer', () => {
  it("counts an answer as sent when it carries the payment's signature", () => {
    expect(readPaymentAnswer(ACCEPTED, SIGNATURE)).toBe('sent');
  });

  it.each([
    ['an invalid transaction', NO_BALANCE],
    [
      'an invalid transaction, in German',
      {
        error: 312,
        message: 'Transaktion ungültig: unzureichendes Guthaben (NO_BALANCE)',
      },
    ],
    ['an invalid signature', { error: 101, message: 'invalid signature' }],
    ['data that is not a transaction', { error: 115, message: 'invalid data' }],
    [
      'a node that is not synced',
      { error: 7, message: 'blockchain needs to synchronize first' },
    ],
  ])("reads Core's refusal of %s as refused", (_label, answer) => {
    expect(readPaymentAnswer(answer, SIGNATURE)).toBe('refused');
  });

  it.each([
    ["a gateway's error page", GATEWAY_PAGE],
    ["the node's own error page", CORE_ERROR_PAGE],
    ['an empty answer', ''],
    ['the text "true"', 'true'],
    ['true', true],
    ['no answer', undefined],
    ['null', null],
    ['an empty object', {}],
    [
      'a transaction without a signature',
      { ...ACCEPTED, signature: undefined },
    ],
    [
      "another transaction's signature",
      { ...ACCEPTED, signature: `${SIGNATURE.slice(0, -1)}2` },
    ],
    ["a gateway's JSON error", { error: 'Bad Gateway' }],
    ["a gateway's JSON timeout", { message: 'Endpoint request timed out' }],
    ['a list', [ACCEPTED]],
    // The same signed payment reached the node before, so it was added.
    [
      'the payment already being there',
      {
        error: 312,
        message:
          'transaction invalid: transaction already exists (TRANSACTION_ALREADY_EXISTS)',
      },
    ],
    [
      'the payment already being there, in German',
      {
        error: 312,
        message:
          'Transaktion ungültig: Transaktion existiert bereits (TRANSACTION_ALREADY_EXISTS)',
      },
    ],
    // Codes Core can also give after it added the payment.
    ['a repository error', { error: 5, message: 'repository error' }],
    [
      'an answer Core could not write',
      { error: 127, message: 'could not transform JSON into transaction' },
    ],
    ['an error code Core does not give here', { error: 4, message: 'nope' }],
  ])(
    'cannot tell from %s whether the payment went through',
    (_label, answer) => {
      expect(readPaymentAnswer(answer, SIGNATURE)).toBe('unknown');
    }
  );

  it('never counts an answer as sent without the signature to compare', () => {
    expect(readPaymentAnswer({ signature: '' }, '')).toBe('unknown');
    expect(readPaymentAnswer({ signature: undefined }, undefined)).toBe(
      'unknown'
    );
  });
});

describe('paymentNotSentError', () => {
  it("gives the node's reason for a refusal", () => {
    const error = paymentNotSentError({
      success: false,
      outcome: 'refused',
      data: NO_BALANCE,
    });
    expect(error.message).toBe(NO_BALANCE.message);
    expect(error.code).toBeUndefined();
  });

  it('gives a reason for a refusal that has none', () => {
    const error = paymentNotSentError({
      success: false,
      outcome: 'refused',
      data: { error: 312, message: ' ' },
    });
    expect(error.message).toBe('question:message.error.process_transaction');
  });

  it.each([
    ['an answer that does not say', { success: false, outcome: 'unknown' }],
    ['no result', undefined],
  ] as const)(
    'says Hub cannot tell whether the payment went through for %s',
    (_label, result) => {
      const error = paymentNotSentError(result);
      expect(error.message).toBe(
        'question:message.error.payment_outcome_unknown'
      );
      expect(error.code).toBe(PAYMENT_OUTCOME_UNKNOWN_CODE);
    }
  );

  it('is the same error Hub gives a payment it stopped waiting for', () => {
    const error = paymentOutcomeUnknownError();
    expect(error.message).toBe(
      'question:message.error.payment_outcome_unknown'
    );
    expect(error.code).toBe(PAYMENT_OUTCOME_UNKNOWN_CODE);
  });
});

describe('isQortPaymentRequest', () => {
  it('is true only for SEND_COIN with QORT', () => {
    expect(isQortPaymentRequest({ action: 'SEND_COIN', coin: 'QORT' })).toBe(
      true
    );
    expect(isQortPaymentRequest({ action: 'SEND_COIN', coin: 'LTC' })).toBe(
      false
    );
    expect(
      isQortPaymentRequest({ action: 'TRANSFER_ASSET', coin: 'QORT' })
    ).toBe(false);
    expect(isQortPaymentRequest(undefined)).toBe(false);
    expect(isQortPaymentRequest(null)).toBe(false);
  });
});
