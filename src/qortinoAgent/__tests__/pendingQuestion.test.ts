import { afterEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ openQortinoAgentSheet: vi.fn() }));
vi.mock('../qortinoSheetNav', () => nav);

import {
  askQortino,
  clearPendingQortinoQuestion,
  getPendingQortinoQuestion,
  subscribePendingQortinoQuestion,
  takePendingQortinoQuestion,
} from '../pendingQuestion';

describe('A question from Home on its way to the chat', () => {
  afterEach(() => {
    clearPendingQortinoQuestion();
    vi.clearAllMocks();
  });

  it('opens Qortino holding the question until the chat takes it', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingQortinoQuestion(listener);
    askQortino('  what is QDN?  ');
    expect(nav.openQortinoAgentSheet).toHaveBeenCalledTimes(1);
    expect(getPendingQortinoQuestion()).toBe('what is QDN?');
    expect(listener).toHaveBeenCalledTimes(1);

    expect(takePendingQortinoQuestion()).toBe('what is QDN?');
    // Taken once: it is never asked twice.
    expect(takePendingQortinoQuestion()).toBeNull();
    expect(getPendingQortinoQuestion()).toBeNull();
    unsubscribe();
  });

  it('ignores an empty question', () => {
    askQortino('   ');
    expect(nav.openQortinoAgentSheet).not.toHaveBeenCalled();
    expect(getPendingQortinoQuestion()).toBeNull();
  });

  it('forgets a question when Qortino closes before taking it', () => {
    askQortino('hello');
    clearPendingQortinoQuestion();
    expect(getPendingQortinoQuestion()).toBeNull();
  });

  it('keeps questions asked one after another in the order they were asked', () => {
    askQortino('first');
    askQortino('second');
    expect(getPendingQortinoQuestion()).toBe('first');
    expect(takePendingQortinoQuestion()).toBe('first');
    expect(getPendingQortinoQuestion()).toBe('second');
    expect(takePendingQortinoQuestion()).toBe('second');
    expect(takePendingQortinoQuestion()).toBeNull();
  });

  it('forgets every waiting question when Qortino closes', () => {
    askQortino('first');
    askQortino('second');
    clearPendingQortinoQuestion();
    expect(getPendingQortinoQuestion()).toBeNull();
  });
});
