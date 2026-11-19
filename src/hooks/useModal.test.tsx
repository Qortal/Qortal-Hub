import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useModal } from './useModal';

/** Settles to 'accepted' or the reason given, so no rejection goes unseen. */
const answerOf = (asked: Promise<unknown>) =>
  asked.then(
    () => 'accepted',
    (reason) => reason
  );

/** 'unanswered' while the confirmation still waits. */
const settledYet = (answer: Promise<unknown>) =>
  Promise.race([
    answer,
    new Promise((resolve) => setTimeout(() => resolve('unanswered'), 0)),
  ]);

describe('useModal', () => {
  it('answers a confirmation that asked for it as cancelled when a newer one takes its place', async () => {
    const { result } = renderHook(() => useModal());
    let first: Promise<unknown>;
    let second: Promise<unknown>;

    act(() => {
      first = answerOf(
        result.current.show({ message: 'first' }, { cancelIfReplaced: true })
      );
    });
    act(() => {
      second = answerOf(result.current.show({ message: 'second' }));
    });

    expect(await settledYet(first)).toEqual({ isCanceled: true });
    expect(result.current.isShow).toBe(true);
    expect(result.current.message).toEqual({ message: 'second' });

    act(() => result.current.onOk(undefined));
    expect(await second).toBe('accepted');
  });

  it('leaves a replaced confirmation that did not ask for it unanswered, as before', async () => {
    const { result } = renderHook(() => useModal());
    let first: Promise<unknown>;
    let second: Promise<unknown>;

    act(() => {
      first = answerOf(result.current.show({ message: 'first' }));
    });
    act(() => {
      second = answerOf(
        result.current.show({ message: 'second' }, { cancelIfReplaced: true })
      );
    });
    act(() => result.current.onCancel());

    expect(await second).toEqual({ isCanceled: true });
    expect(await settledYet(first)).toBe('unanswered');
  });
});
