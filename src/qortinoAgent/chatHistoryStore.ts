/**
 * Persisted Qortino chat sessions, with pin + rename. Kept per account, so
 * on a shared computer one account never sees another's chats.
 */
import { getDefaultStore } from 'jotai';
import { rawWalletAtom, userInfoAtom } from '../atoms/global';
import { Preferences } from './prefs';

const SESSIONS_KEY = 'qortino_chat_sessions_v1';
const ACTIVE_KEY = 'qortino_chat_active_v1';

/** Chats are kept to about this much text: localStorage is shared with Hub. */
export const CHAT_STORAGE_BUDGET_CHARS = 1_500_000;
const MAX_SESSIONS = 80;

/**
 * The storage key for the signed-in account, or null while no account is
 * known: then nothing is read or saved, rather than mixing accounts.
 */
function accountKey(base: string): string | null {
  let address: unknown;
  try {
    const store = getDefaultStore();
    // The wallet's address is known from unlock on; the account info only
    // once the node has answered.
    address =
      store.get(rawWalletAtom)?.address0 || store.get(userInfoAtom)?.address;
  } catch {
    address = undefined;
  }
  return typeof address === 'string' && address ? `${base}:${address}` : null;
}

type QortinoChatMode = 'offline' | 'qdn';

/**
 * Serializable bubble — mirrors chat UI fields we care to restore. Sessions
 * saved by the old QDN chat carried more card fields; they stay in storage
 * but only offline sessions are shown.
 */
export type StoredChatBubble = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Exactly what the model was given / wrote for this turn. */
  modelContent?: string;
  links?: unknown[];
  apps?: unknown[];
  canContinueAssemble?: boolean;
  continueQuery?: string;
  /** Where the answer came from (answerReport.ts); checked when read back. */
  source?: unknown;
};

export type QortinoChatSession = {
  id: string;
  title: string;
  /** User renamed — stop auto-titling from first message. */
  titleCustom?: boolean;
  pinned: boolean;
  mode: QortinoChatMode;
  createdAt: number;
  updatedAt: number;
  messages: StoredChatBubble[];
};

type ActiveMap = Partial<Record<QortinoChatMode, string>>;

/** Title of a chat not named yet; shown translated (see the history panel). */
export const UNTITLED_CHAT_TITLE = 'New chat';

function newId(): string {
  return `qchat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function titleFromMessages(messages: StoredChatBubble[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return UNTITLED_CHAT_TITLE;
  const t = firstUser.content.replace(/\s+/g, ' ').trim();
  return t.length > 42 ? `${t.slice(0, 42)}…` : t;
}

export function createEmptySession(mode: QortinoChatMode): QortinoChatSession {
  const now = Date.now();
  return {
    id: newId(),
    title: UNTITLED_CHAT_TITLE,
    pinned: false,
    mode,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export async function loadChatSessions(): Promise<QortinoChatSession[]> {
  const key = accountKey(SESSIONS_KEY);
  if (!key) return [];
  try {
    const { value } = await Preferences.get({ key });
    if (!value) return [];
    const parsed = JSON.parse(value) as QortinoChatSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** What the model wrote is only kept apart from the answer when they differ. */
function compactBubble(bubble: StoredChatBubble): StoredChatBubble {
  if (bubble.modelContent !== bubble.content) return bubble;
  const rest = { ...bubble };
  delete rest.modelContent;
  return rest;
}

/**
 * The chats that are kept: every pinned one, then the newest others up to
 * MAX_SESSIONS in all, within about CHAT_STORAGE_BUDGET_CHARS of text. The
 * oldest unpinned chats go first; the newest chat is always kept.
 */
export function capChatSessions(
  sessions: QortinoChatSession[]
): QortinoChatSession[] {
  const byRecent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = byRecent.filter((session) => session.pinned);
  const room = Math.max(0, MAX_SESSIONS - pinned.length);
  const others = byRecent.filter((session) => !session.pinned).slice(0, room);
  const keptIds = new Set([...pinned, ...others].map((session) => session.id));
  const kept = byRecent
    .filter((session) => keptIds.has(session.id))
    .map((session) => ({
      ...session,
      messages: session.messages.map(compactBubble),
    }));
  const newestId = kept[0]?.id;
  let size = JSON.stringify(kept).length;
  while (size > CHAT_STORAGE_BUDGET_CHARS) {
    let drop = -1;
    for (let i = kept.length - 1; i >= 0; i -= 1) {
      if (!kept[i].pinned && kept[i].id !== newestId) {
        drop = i;
        break;
      }
    }
    // Only pinned chats and the newest left: keep them, even over budget.
    if (drop < 0) break;
    kept.splice(drop, 1);
    size = JSON.stringify(kept).length;
  }
  return kept;
}

export async function saveChatSessions(
  sessions: QortinoChatSession[]
): Promise<void> {
  const key = accountKey(SESSIONS_KEY);
  if (!key) return;
  await Preferences.set({
    key,
    value: JSON.stringify(capChatSessions(sessions)),
  });
}

export async function loadActiveSessionIds(): Promise<ActiveMap> {
  const key = accountKey(ACTIVE_KEY);
  if (!key) return {};
  try {
    const { value } = await Preferences.get({ key });
    if (!value) return {};
    return JSON.parse(value) as ActiveMap;
  } catch {
    return {};
  }
}

export async function saveActiveSessionIds(map: ActiveMap): Promise<void> {
  const key = accountKey(ACTIVE_KEY);
  if (!key) return;
  await Preferences.set({ key, value: JSON.stringify(map) });
}

export function sortSessionsForDrawer(
  sessions: QortinoChatSession[],
  mode: QortinoChatMode
): QortinoChatSession[] {
  return sessions
    .filter((s) => s.mode === mode)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
}

/** Some saved chat has messages in it. */
export async function hasSavedQortinoChats(): Promise<boolean> {
  const sessions = await loadChatSessions();
  return sessions.some((session) => session.messages.length > 0);
}

/**
 * Settings → Delete all chats: one empty chat is left to type into. Returns
 * it, so an open chat can switch to it.
 */
export async function deleteAllQortinoChats(): Promise<QortinoChatSession> {
  const fresh = createEmptySession('offline');
  await saveChatSessions([fresh]);
  const active = await loadActiveSessionIds();
  await saveActiveSessionIds({ ...active, offline: fresh.id });
  return fresh;
}
