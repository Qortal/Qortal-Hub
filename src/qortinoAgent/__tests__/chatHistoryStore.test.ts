import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import { rawWalletAtom, userInfoAtom } from '../../atoms/global';
import {
  capChatSessions,
  CHAT_STORAGE_BUDGET_CHARS,
  createEmptySession,
  loadChatSessions,
  saveChatSessions,
  type QortinoChatSession,
} from '../chatHistoryStore';

const chat = (
  updatedAt: number,
  size: number,
  pinned = false
): QortinoChatSession => ({
  ...createEmptySession('offline'),
  id: `c${updatedAt}`,
  pinned,
  updatedAt,
  messages: [
    { id: 'u', role: 'user', content: 'q' },
    {
      id: 'a',
      role: 'assistant',
      content: 'x'.repeat(size),
      modelContent: 'x'.repeat(size),
    },
  ],
});

describe("Qortino's saved chats", () => {
  afterEach(() => {
    localStorage.clear();
    getDefaultStore().set(userInfoAtom, null);
    getDefaultStore().set(rawWalletAtom, null);
  });

  it('keeps each account to its own chats', async () => {
    const store = getDefaultStore();
    store.set(userInfoAtom, { address: 'QA' });
    await saveChatSessions([chat(1, 10)]);
    store.set(userInfoAtom, { address: 'QB' });
    expect(await loadChatSessions()).toEqual([]);
    store.set(userInfoAtom, { address: 'QA' });
    expect((await loadChatSessions()).map((c) => c.id)).toEqual(['c1']);
  });

  it('keys by the wallet as soon as it is unlocked', async () => {
    const store = getDefaultStore();
    store.set(rawWalletAtom, { address0: 'QA' });
    await saveChatSessions([chat(1, 10)]);
    store.set(rawWalletAtom, null);
    store.set(userInfoAtom, { address: 'QA' });
    expect((await loadChatSessions()).map((c) => c.id)).toEqual(['c1']);
  });

  it('reads and saves nothing while no account is known', async () => {
    await saveChatSessions([chat(1, 10)]);
    expect(localStorage.length).toBe(0);
    expect(await loadChatSessions()).toEqual([]);
  });

  it('keeps pinned chats however old, and always the newest', () => {
    const many = Array.from({ length: 90 }, (_, i) => chat(i + 10, 1));
    const kept = capChatSessions([chat(1, 1, true), ...many]);
    expect(kept).toHaveLength(80);
    expect(kept.some((c) => c.id === 'c1')).toBe(true);
    const huge = capChatSessions([
      chat(1, CHAT_STORAGE_BUDGET_CHARS, true),
      chat(2, 10),
    ]);
    expect(huge.map((c) => c.id)).toEqual(['c2', 'c1']);
  });

  it('stores what the model wrote only when it differs from the answer', () => {
    const [kept] = capChatSessions([chat(1, 10)]);
    expect(kept.messages[1]).not.toHaveProperty('modelContent');
  });

  it('lets go of the oldest unpinned chats to stay within the budget', () => {
    const big = Math.floor(CHAT_STORAGE_BUDGET_CHARS / 3);
    const kept = capChatSessions([
      chat(1, big, true),
      chat(2, big),
      chat(3, big),
      chat(4, big),
    ]);
    expect(kept.map((c) => c.id)).toEqual(['c4', 'c1']);
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(
      CHAT_STORAGE_BUDGET_CHARS
    );
  });
});
