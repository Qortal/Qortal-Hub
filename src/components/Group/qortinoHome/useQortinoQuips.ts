/**
 * When Qortino says something on Home: now and then, never all the time.
 *
 * A line can only come while Qortino is on screen (Home shown, the card
 * scrolled into view, Hub's window in front), nothing else is in his bubble,
 * and someone is actually using Hub: time without mouse or keyboard counts
 * as idle (uiActivity.ts) and does not count toward the next line, so Hub
 * left on Home stays quiet. Each visit to Home gets a line only sometimes,
 * then one every two or three minutes at most, six per run of Hub.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  pickQortinoQuip,
  QORTINO_QUIP_MEMORY,
  quipHoldMs,
  quipTypingMs,
  type QortinoQuip,
} from './qortinoQuips';
import { UI_IDLE_ATTR, watchUiActivity } from './uiActivity';

const STORAGE_KEY = 'qortino:quips:v1';
/** Lines per run of Hub at most. */
export const QUIPS_PER_SESSION = 6;
/** Time on screen, while in use, before a visit's line. */
export const FIRST_QUIP_DELAY_MS: readonly [number, number] = [6_000, 14_000];
/** And between two lines. */
export const NEXT_QUIP_DELAY_MS: readonly [number, number] = [75_000, 170_000];
/** A visit to Home gets an early line this often. */
export const FIRST_QUIP_CHANCE = 0.65;
const TICK_MS = 1_000;
const IDLE_ATTR = UI_IDLE_ATTR;

let shownThisSession = 0;
let lastShownAt = 0;
let nextId = 0;

export type SayOptions = {
  /** Say it in the bubble already up (giggles, the answer after them). */
  keepBubble?: boolean;
  /** Up this long once typed, instead of a reading time. */
  holdMs?: number;
  /** Count it as said lately (lines that should not repeat soon). */
  remember?: boolean;
};

export type ActiveQortinoQuip = QortinoQuip & {
  id: number;
  text: string;
  typingMs: number;
  holdMs: number;
};

export function readRecentQortinoQuips(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as {
      recent?: unknown;
    };
    return Array.isArray(saved.recent)
      ? saved.recent.filter((key): key is string => typeof key === 'string')
      : [];
  } catch {
    return [];
  }
}

function remember(key: string): void {
  const recent = [
    ...readRecentQortinoQuips().filter((k) => k !== key),
    key,
  ].slice(-QORTINO_QUIP_MEMORY);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ recent }));
  } catch {
    /* repeats a little sooner */
  }
}

const between = ([low, high]: readonly [number, number], random: number) =>
  Math.round(low + (high - low) * random);

const isUiIdle = () =>
  document.documentElement.getAttribute(IDLE_ATTR) === 'on';

type Options = {
  /** Qortino may speak here at all (the desktop app, signed up). */
  enabled: boolean;
  /** Something else has his attention right now. */
  blocked: boolean;
  aiReady: boolean;
  /** Qortino's corner of Home; lines only come while it is on screen. */
  targetRef: RefObject<HTMLElement | null>;
  /** The line's words, or '' to skip it. */
  resolveText: (quip: QortinoQuip) => string;
};

export function useQortinoQuips({
  enabled,
  blocked,
  aiReady,
  targetRef,
  resolveText,
}: Options): {
  quip: ActiveQortinoQuip | null;
  dismiss: () => void;
  /** Say this line now, whatever the schedule (the user asked for it). */
  say: (quip: QortinoQuip, options?: SayOptions) => void;
} {
  const [quip, setQuip] = useState<ActiveQortinoQuip | null>(null);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden
  );
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const quipRef = useRef(quip);
  quipRef.current = quip;
  const aiReadyRef = useRef(aiReady);
  aiReadyRef.current = aiReady;
  const resolveRef = useRef(resolveText);
  resolveRef.current = resolveText;
  const hideTimer = useRef<number | null>(null);
  /** In-use time on screen since the last line (or the visit began). */
  const eligibleMs = useRef(0);
  const dueMs = useRef(0);

  const clearHide = () => {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  const dismiss = useCallback(() => {
    clearHide();
    setQuip(null);
  }, []);

  /** Put a line in his bubble; false when it has no words. */
  const show = useCallback(
    (picked: QortinoQuip, options: SayOptions = {}): boolean => {
      const text = resolveRef.current(picked).trim();
      if (!text) return false;
      if (options.remember !== false) remember(picked.key);
      const typingMs = quipTypingMs(text);
      const holdMs = options.holdMs ?? quipHoldMs(text);
      const current = quipRef.current;
      let id: number;
      if (options.keepBubble && current) {
        id = current.id;
      } else {
        nextId += 1;
        id = nextId;
      }
      clearHide();
      const next = { ...picked, id, text, typingMs, holdMs };
      quipRef.current = next;
      setQuip(next);
      hideTimer.current = window.setTimeout(() => {
        hideTimer.current = null;
        setQuip(null);
      }, typingMs + holdMs);
      return true;
    },
    []
  );

  const say = useCallback(
    (picked: QortinoQuip, options?: SayOptions) => void show(picked, options),
    [show]
  );

  // A new visit to Home (mount, or shown again after being parked).
  useEffect(() => {
    eligibleMs.current = 0;
    const early =
      Math.random() < FIRST_QUIP_CHANCE &&
      Date.now() - lastShownAt > FIRST_QUIP_DELAY_MS[1] * 3;
    dueMs.current = early
      ? between(FIRST_QUIP_DELAY_MS, Math.random())
      : between(NEXT_QUIP_DELAY_MS, Math.random());
    return () => {
      clearHide();
      setQuip(null);
    };
  }, []);

  useEffect(() => (enabled ? watchUiActivity() : undefined), [enabled]);

  useEffect(() => {
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const target = targetRef.current;
    if (!enabled || !target || typeof IntersectionObserver === 'undefined') {
      setInView(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      { threshold: 0.5 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [enabled, targetRef]);

  // Something else needs his bubble or his attention: stop talking.
  useEffect(() => {
    if (blocked && quipRef.current) dismiss();
  }, [blocked, dismiss]);

  useEffect(() => {
    if (!enabled || !inView || !pageVisible) return;
    if (shownThisSession >= QUIPS_PER_SESSION) return;
    const timer = window.setInterval(() => {
      if (blockedRef.current || quipRef.current || isUiIdle()) return;
      eligibleMs.current += TICK_MS;
      if (eligibleMs.current < dueMs.current) return;
      eligibleMs.current = 0;
      dueMs.current = between(NEXT_QUIP_DELAY_MS, Math.random());
      if (shownThisSession >= QUIPS_PER_SESSION) {
        window.clearInterval(timer);
        return;
      }
      const picked = pickQortinoQuip({
        aiReady: aiReadyRef.current,
        hour: new Date().getHours(),
        recent: readRecentQortinoQuips(),
      });
      if (!show(picked)) return;
      shownThisSession += 1;
      lastShownAt = Date.now();
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [enabled, inView, pageVisible, show]);

  return { quip, dismiss, say };
}

export function resetQortinoQuipsForTests(): void {
  shownThisSession = 0;
  lastShownAt = 0;
  nextId = 0;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing saved */
  }
}
