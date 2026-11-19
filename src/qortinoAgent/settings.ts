/**
 * Qortino's own settings (the gear in its panel). Kept on this computer only,
 * and read synchronously: the chat needs them for every answer, the model
 * session when the Qortino panel closes.
 */
import { useSyncExternalStore } from 'react';

export type QortinoAnswerLength = 'short' | 'normal' | 'detailed';
export type QortinoTextSize = 'small' | 'default' | 'large';
/** What happens to the loaded model once the Qortino panel closes. */
export type QortinoKeepReady =
  /** Free the memory right away. */
  | 'off'
  /** Keep it for a minute and a half, so reopening is instant. */
  | 'short'
  /** Keep it while Hub is open. */
  | 'open';

export type QortinoSettings = {
  answerLength: QortinoAnswerLength;
  textSize: QortinoTextSize;
  /** Enter sends the question; off, it starts a new line. */
  enterSends: boolean;
  keepReady: QortinoKeepReady;
  /** Let the model use the graphics card when there is one. */
  useGpu: boolean;
};

export const DEFAULT_QORTINO_SETTINGS: QortinoSettings = {
  answerLength: 'normal',
  textSize: 'default',
  enterSends: true,
  keepReady: 'short',
  useGpu: true,
};

export const QORTINO_ANSWER_LENGTHS: readonly QortinoAnswerLength[] = [
  'short',
  'normal',
  'detailed',
];
export const QORTINO_TEXT_SIZES: readonly QortinoTextSize[] = [
  'small',
  'default',
  'large',
];
export const QORTINO_KEEP_READY: readonly QortinoKeepReady[] = [
  'off',
  'short',
  'open',
];

/** Reading text in the chat (Q-Chat's text size steps on Qortino's size). */
export const QORTINO_TEXT_FONT_SIZE: Record<QortinoTextSize, string> = {
  small: '0.81rem',
  default: '0.92rem',
  large: '1.09rem',
};

const STORAGE_KEY = 'qortino:settings:v1';

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Anything missing or unknown falls back to its default. */
export function normalizeQortinoSettings(raw: unknown): QortinoSettings {
  const value =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const defaults = DEFAULT_QORTINO_SETTINGS;
  return {
    answerLength: pick(
      value.answerLength,
      QORTINO_ANSWER_LENGTHS,
      defaults.answerLength
    ),
    textSize: pick(value.textSize, QORTINO_TEXT_SIZES, defaults.textSize),
    enterSends:
      typeof value.enterSends === 'boolean'
        ? value.enterSends
        : defaults.enterSends,
    keepReady: pick(value.keepReady, QORTINO_KEEP_READY, defaults.keepReady),
    useGpu: typeof value.useGpu === 'boolean' ? value.useGpu : defaults.useGpu,
  };
}

let state: QortinoSettings | null = null;
const listeners = new Set<() => void>();

function readSaved(): QortinoSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return normalizeQortinoSettings(saved ? JSON.parse(saved) : null);
  } catch {
    return DEFAULT_QORTINO_SETTINGS;
  }
}

export function getQortinoSettings(): QortinoSettings {
  if (!state) state = readSaved();
  return state;
}

export function subscribeQortinoSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateQortinoSettings(patch: Partial<QortinoSettings>): void {
  state = normalizeQortinoSettings({ ...getQortinoSettings(), ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* kept until Hub closes */
  }
  for (const listener of listeners) listener();
}

export function useQortinoSettings(): QortinoSettings {
  return useSyncExternalStore(
    subscribeQortinoSettings,
    getQortinoSettings,
    getQortinoSettings
  );
}

export function resetQortinoSettingsForTests(): void {
  state = null;
  listeners.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing saved */
  }
}
