import { describe, expect, it } from 'vitest';
import { replyFailureMessage } from './messageChannelReply';

// `sendMessageBackground` answers a failed payload with
// `{ error: undefined, message: '...' }`. Testing for the `error` key alone
// read that as success, and throwing `response.error` threw Error(undefined).
describe('replyFailureMessage', () => {
  it('finds the message when only `message` is set', () => {
    // The exact shape that was being read as success.
    expect(replyFailureMessage({ error: undefined, message: 'nope' })).toBe(
      'nope'
    );
  });

  it('finds the error when only `error` is set', () => {
    expect(replyFailureMessage({ error: 'bad thing' })).toBe('bad thing');
  });

  it('prefers the error over the message', () => {
    expect(
      replyFailureMessage({ error: 'the error', message: 'the message' })
    ).toBe('the error');
  });

  it('is null for a successful reply', () => {
    expect(replyFailureMessage({ signature: 'SIG' })).toBeNull();
    expect(replyFailureMessage({})).toBeNull();
  });

  it('treats a missing reply as a failure, not as success', () => {
    // `sendMessageBackground` falls off the end and returns `undefined` when the
    // channel supplies neither a payload nor an error. That is a failed round
    // trip, not a quiet success, and reading it as success shows the toast and
    // appends a pending entry for a transaction that never happened.
    for (const reply of [undefined, null]) {
      expect(replyFailureMessage(reply)).not.toBeNull();
    }
  });

  it('treats an empty object as a successful empty payload', () => {
    // An empty payload is what `sendMessageBackground` returns when the message
    // carries `payload: {}`. It is not a failure shape.
    expect(replyFailureMessage({})).toBeNull();
  });

  it('ignores a non-object reply', () => {
    for (const reply of ['', 0, false, 'text']) {
      expect(replyFailureMessage(reply)).toBeNull();
    }
  });

  it('ignores an empty or non-string message', () => {
    expect(replyFailureMessage({ message: '' })).toBeNull();
    expect(replyFailureMessage({ message: 42 })).toBeNull();
    expect(replyFailureMessage({ error: '' })).toBeNull();
  });
});
