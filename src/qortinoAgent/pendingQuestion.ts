/**
 * A question typed next to Qortino on Home, on its way to Qortino's chat:
 * the chat takes it as soon as it is mounted, starts a new chat for it and
 * sends it once the model is loaded.
 */
import { openQortinoAgentSheet } from './qortinoSheetNav';

let pending: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Open Qortino and ask it `question` in a new chat. */
export function askQortino(question: string): void {
  const text = question.trim();
  if (!text) return;
  pending = text;
  emit();
  openQortinoAgentSheet();
}

export function getPendingQortinoQuestion(): string | null {
  return pending;
}

/** The chat has the question: it is not asked twice. */
export function takePendingQortinoQuestion(): string | null {
  const text = pending;
  if (text != null) {
    pending = null;
    emit();
  }
  return text;
}

/** Qortino closed before the chat took it. */
export function clearPendingQortinoQuestion(): void {
  if (pending == null) return;
  pending = null;
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
