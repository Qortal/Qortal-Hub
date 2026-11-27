import i18n from 'i18next';
import { codedQortalRequestError } from '../qortal/qortal-request-errors';

/**
 * Reading the node's answer to a QORT payment Hub sent to
 * /transactions/process (apiVersion 2).
 *
 * Core answers a transaction it accepted with that transaction, signature
 * included, and one it refused with `{ error: <code>, message }`. Any other
 * answer (an error page from a gateway or from the node, a reply cut off, no
 * reply at all) doesn't say whether the payment went through, so it is
 * reported neither as sent nor as failed: paying again could pay twice.
 */

/**
 * - `sent`: the node accepted the payment.
 * - `refused`: the node refused it, so it wasn't added.
 * - `unknown`: the answer doesn't say whether the payment went through.
 */
export type PaymentOutcome = 'sent' | 'refused' | 'unknown';

/** The code a Q-App gets when Hub can't tell whether its payment went through. */
export const PAYMENT_OUTCOME_UNKNOWN_CODE = 'PAYMENT_OUTCOME_UNKNOWN';

/** A payment as background.ts `sendCoin` returns it in `res`. */
export type PaymentResult = {
  /** True only when the outcome is `sent`. */
  success: boolean;
  outcome: PaymentOutcome;
  /** The node's answer, as JSON when it was JSON. */
  data?: unknown;
};

/**
 * Core's error codes that it answers only before it adds a transaction:
 * BLOCKCHAIN_NEEDS_SYNC (7), INVALID_SIGNATURE (101), INVALID_DATA (115) and
 * TRANSACTION_INVALID (312). Others can also come after the payment was added:
 * REPOSITORY_ISSUE (5) when closing the database fails, TRANSFORMATION_ERROR
 * (127) when writing the answer fails.
 */
const REFUSED_BEFORE_ADDING = new Set([7, 101, 115, 312]);

/**
 * `signature`: the Base58 signature of the payment that was sent. Only an
 * answer that carries that signature counts as sent.
 */
export function readPaymentAnswer(
  answer: unknown,
  signature: string
): PaymentOutcome {
  if (!answer || typeof answer !== 'object') return 'unknown';
  const fields = answer as {
    signature?: unknown;
    error?: unknown;
    message?: unknown;
  };
  if (signature && fields.signature === signature) return 'sent';
  if (typeof fields.error !== 'number') return 'unknown';
  if (!REFUSED_BEFORE_ADDING.has(fields.error)) return 'unknown';
  // TRANSACTION_INVALID names its reason in brackets, in every language. This
  // one means the same signed payment reached the node before and was added.
  if (
    typeof fields.message === 'string' &&
    fields.message.includes('(TRANSACTION_ALREADY_EXISTS)')
  ) {
    return 'unknown';
  }
  return 'refused';
}

/** A Q-App's request to pay QORT (SEND_COIN with the coin QORT). */
export function isQortPaymentRequest(request: unknown): boolean {
  const fields = request as { action?: unknown; coin?: unknown } | null;
  return fields?.action === 'SEND_COIN' && fields?.coin === 'QORT';
}

/** The error for a payment Hub can't tell went through or not. */
export function paymentOutcomeUnknownError(): Error & { code?: string } {
  return codedQortalRequestError(
    PAYMENT_OUTCOME_UNKNOWN_CODE,
    i18n.t('question:message.error.payment_outcome_unknown', {
      postProcess: 'capitalizeFirstChar',
    })
  );
}

/**
 * The error for a payment that wasn't reported as sent: the node's reason when
 * it refused the payment, otherwise that Hub can't tell whether it went
 * through (with PAYMENT_OUTCOME_UNKNOWN_CODE as its code).
 */
export function paymentNotSentError(
  result: PaymentResult | undefined
): Error & { code?: string } {
  if (result?.outcome === 'refused') {
    const message = (result.data as { message?: unknown } | undefined)?.message;
    return new Error(
      typeof message === 'string' && message.trim()
        ? message
        : i18n.t('question:message.error.process_transaction', {
            postProcess: 'capitalizeFirstChar',
          })
    );
  }
  return paymentOutcomeUnknownError();
}
