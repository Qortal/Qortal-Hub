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

  it('saves under the account it is given once that account has signed out', async () => {
    await saveChatSessions([chat(1, 10)], 'QA');
    getDefaultStore().set(rawWalletAtom, { address0: 'QA' });
    expect((await loadChatSessions()).map((c) => c.id)).toEqual(['c1']);
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

describe("Qortino's newest chat beside pinned ones", () => {
  afterEach(() => {
    localStorage.clear();
    getDefaultStore().set(rawWalletAtom, null);
  });

  it('is kept over the budget when a chat pinned since is newer', () => {
    const kept = capChatSessions([
      chat(5, CHAT_STORAGE_BUDGET_CHARS, true),
      chat(3, 10),
      chat(1, 10),
    ]);
    expect(kept.map((c) => c.id)).toEqual(['c5', 'c3']);
  });

  it('is still saved when eighty are pinned', async () => {
    getDefaultStore().set(rawWalletAtom, { address0: 'QA' });
    // Eighty chats pinned over time, then a new chat with a question in it.
    const pinned = Array.from({ length: 80 }, (_, i) => chat(i + 1, 1, true));
    const current = chat(1_000, 1);
    await saveChatSessions([current, ...pinned]);

    const saved = await loadChatSessions();
    expect(saved.map((session) => session.id)).toContain(current.id);
  });

  it('is kept when 80 chats are pinned', async () => {
    getDefaultStore().set(rawWalletAtom, { address0: 'QA' });
    const pinned: QortinoChatSession[] = Array.from({ length: 80 }, (_, i) => ({
      ...createEmptySession('offline'),
      id: `pinned-${i}`,
      pinned: true,
      updatedAt: 1_000 + i,
      messages: [{ id: `u${i}`, role: 'user', content: `pinned ${i}` }],
    }));
    const newest: QortinoChatSession = {
      ...createEmptySession('offline'),
      id: 'newest',
      updatedAt: 10_000,
      messages: [{ id: 'u', role: 'user', content: 'newest question' }],
    };
    await saveChatSessions([newest, ...pinned]);
    expect((await loadChatSessions()).map((session) => session.id)).toContain(
      'newest'
    );
  });
});
