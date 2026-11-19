/**
 * What the model is sent each turn: the conversation so far (trimmed to fit
 * the context window) plus the new question.
 *
 * The model keeps the last prompt and reply in its KV cache and only reads
 * what follows the part a new prompt shares with it. So the history is kept
 * byte-identical between turns (`modelContent` holds the exact text of each
 * turn) and, when it no longer fits, old turns are dropped in one jump
 * rather than one per question — every drop forces a full re-read.
 */
import { QORTINO_MODEL } from './manifest';
import type { QortinoAnswerLength } from './settings';

export type PromptTurn = {
  role: 'user' | 'assistant';
  content: string;
};

/** Longest reply; the "Continue answer" button picks up after it. */
export const MAX_REPLY_TOKENS = 1024;

/** Longest reply for each answer length in Qortino's settings. */
export const QORTINO_REPLY_TOKENS: Record<QortinoAnswerLength, number> = {
  short: 512,
  normal: MAX_REPLY_TOKENS,
  detailed: 1536,
};

/** Qwen3 Instruct 2507's recommended sampling (non-thinking). */
export const QORTINO_SAMPLING = {
  temperature: 0.7,
  topP: 0.8,
  topK: 20,
  minP: 0,
  repeatPenalty: 1.0,
  presencePenalty: 0,
} as const;

/** Chat-template tokens around each turn. */
const TURN_OVERHEAD_TOKENS = 6;
/** Slack for estimation error, so the native side never truncates. */
const SAFETY_MARGIN_TOKENS = 128;
/** After a drop the history fills this share of the budget, leaving room to grow. */
const REFILL_FRACTION = 0.6;
/** One FAQ answer or fact sheet attached to a question. */
const MAX_NOTE_CHARS = 1200;

/**
 * Rough token count, on the high side: Qwen averages ~4 characters per token
 * for English; non-Latin scripts use far fewer characters per token.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 3.2) + other;
}

function turnTokens(turn: PromptTurn): number {
  return estimateTokens(turn.content) + TURN_OVERHEAD_TOKENS;
}

/** The question with any notes Qortino's on-device knowledge adds to it. */
export function composeUserTurn(question: string, notes: string[]): string {
  const kept = notes
    .map((note) => note.trim())
    .filter(Boolean)
    .map((note) =>
      note.length > MAX_NOTE_CHARS ? `${note.slice(0, MAX_NOTE_CHARS)}…` : note
    );
  if (!kept.length) return question;
  return (
    "Notes from Qortino's on-device knowledge (use them only if they fit the question):\n\n" +
    `${kept.join('\n\n')}\n\nQuestion: ${question}`
  );
}

/**
 * Turns to send, oldest first, ending with `next`. `start` is the oldest
 * prior turn sent last time; the returned `start` is to be passed next time.
 */
export function buildPromptHistory(options: {
  prior: PromptTurn[];
  next: string;
  systemTokens: number;
  start?: number;
  contextTokens?: number;
  replyTokens?: number;
  /**
   * The KV cache does not hold this conversation (model just loaded, or
   * another chat was open): keep only this much of the history, so the
   * first answer is not spent re-reading the whole chat.
   */
  coldPriorTokens?: number;
}): { turns: PromptTurn[]; start: number } {
  const { prior, next, systemTokens } = options;
  const contextTokens = options.contextTokens ?? QORTINO_MODEL.contextTokens;
  const replyTokens = options.replyTokens ?? MAX_REPLY_TOKENS;
  const budget =
    contextTokens - replyTokens - SAFETY_MARGIN_TOKENS - systemTokens;
  const nextTurn: PromptTurn = { role: 'user', content: next };
  const nextCost = turnTokens(nextTurn);

  const costFrom = (index: number) => {
    let total = nextCost;
    for (let i = index; i < prior.length; i += 1) total += turnTokens(prior[i]);
    return total;
  };

  let start = Math.min(Math.max(0, options.start ?? 0), prior.length);
  if (options.coldPriorTokens !== undefined) {
    const cap = nextCost + Math.max(0, options.coldPriorTokens);
    while (start < prior.length && costFrom(start) > cap) start += 1;
  }
  if (costFrom(start) > budget) {
    // Over budget: jump forward far enough to leave room for a few turns.
    const target = Math.max(nextCost, Math.floor(budget * REFILL_FRACTION));
    while (start < prior.length && costFrom(start) > target) start += 1;
  }
  // A conversation never opens with the assistant.
  while (start < prior.length && prior[start].role !== 'user') start += 1;

  return { turns: [...prior.slice(start), nextTurn], start };
}
