/**
 * Questions typed next to Qortino on Home, on their way to Qortino's chat:
 * the chat takes the oldest as soon as it is mounted and free, starts a new
 * chat for it and sends it once the model is loaded. A question only written
 * for the user (from an app's right-click menu) waits in the box instead,
 * for the user to change and send.
 */
import { openQortinoAgentSheet } from './qortinoSheetNav';

type PendingQuestion = { text: string; send: boolean };

let pending: PendingQuestion[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function queue(question: string, send: boolean): void {
  const text = question.trim();
  if (!text) return;
  // A question asked before the one before it was sent waits its turn.
  pending = [...pending, { text, send }];
  emit();
  openQortinoAgentSheet();
}

/** Open Qortino and ask it `question` in a new chat. */
export function askQortino(question: string): void {
  queue(question, true);
}

/**
 * Open Qortino with `question` written in its box, in a new chat: the user
 * changes it if they like, and sends it.
 */
export function writeQortinoQuestion(question: string): void {
  queue(question, false);
}

/** The oldest question waiting. */
export function getPendingQortinoQuestion(): string | null {
  return pending[0]?.text ?? null;
}

/** Whether the oldest question waiting is sent by itself, or only written. */
export function pendingQortinoQuestionSends(): boolean {
  return pending[0]?.send !== false;
}

/** The chat has the oldest question: it is not asked twice. */
export function takePendingQortinoQuestion(): string | null {
  if (pending.length === 0) return null;
  const [first, ...rest] = pending;
  pending = rest;
  emit();
  return first.text;
}

/** Qortino closed before the chat took them. */
export function clearPendingQortinoQuestion(): void {
  if (pending.length === 0) return;
  pending = [];
  emit();
}

export function subscribePendingQortinoQuestion(
  listener: () => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
