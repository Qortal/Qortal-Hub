/**
 * Questions typed next to Qortino on Home, on their way to Qortino's chat:
 * the chat takes the oldest as soon as it is mounted and free, starts a new
 * chat for it and sends it once the model is loaded.
 */
import { openQortinoAgentSheet } from './qortinoSheetNav';

let pending: string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Open Qortino and ask it `question` in a new chat. */
export function askQortino(question: string): void {
  const text = question.trim();
  if (!text) return;
  // A question asked before the one before it was sent waits its turn.
  pending = [...pending, text];
  emit();
  openQortinoAgentSheet();
}

/** The oldest question waiting. */
export function getPendingQortinoQuestion(): string | null {
  return pending[0] ?? null;
}

/** The chat has the oldest question: it is not asked twice. */
export function takePendingQortinoQuestion(): string | null {
  if (pending.length === 0) return null;
  const [text, ...rest] = pending;
  pending = rest;
  emit();
  return text;
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
