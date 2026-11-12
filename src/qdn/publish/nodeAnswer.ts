import i18n from '../../i18n/i18n';

/**
 * How publishing reads the node's error answers. A request is tried again only
 * when that can help: after a network error, a 5xx, a 408 or a 429. A 401 or
 * 403 means the node wants its API key, which no retry fixes; any other 4xx is
 * Core refusing the request, and its own message says why.
 */

export const isRetryableStatus = (status: number): boolean =>
  status >= 500 || status === 408 || status === 429;

export const needsApiKey = (status: number): boolean =>
  status === 401 || status === 403;

export class NodeAnswerError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'NodeAnswerError';
    this.status = status;
    this.retryable = isRetryableStatus(status);
  }
}

/** Core answers errors as JSON (`{ error, message }`); otherwise the text. */
export const coreErrorMessage = (text: string): string => {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.message === 'string' && parsed.message) {
      return parsed.message;
    }
  } catch {
    // Not JSON: use the text as it is.
  }
  return text;
};

export const nodeAnswerErrorFromStatus = (
  status: number,
  text = ''
): NodeAnswerError => {
  const message = needsApiKey(status)
    ? i18n.t('auth:message.error.publish_needs_api_key', {
        postProcess: 'capitalizeFirstChar',
      })
    : coreErrorMessage(text) || `HTTP ${status}`;
  return new NodeAnswerError(message, status);
};

export const nodeAnswerError = async (response: {
  status: number;
  text: () => Promise<string>;
}): Promise<NodeAnswerError> => {
  const text = await response.text().catch(() => '');
  return nodeAnswerErrorFromStatus(response.status, text);
};

/** Network errors and retryable answers are worth another try. */
export const isWorthRetrying = (error: unknown): boolean =>
  !(error instanceof NodeAnswerError) || error.retryable;
