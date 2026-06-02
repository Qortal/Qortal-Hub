/**
 * useMessageReadObserver
 *
 * Creates a single IntersectionObserver per chat instance that marks messages
 * as read only when they actually enter the scrollable message container's
 * visible area AND the document is visible (window not minimized/backgrounded).
 *
 * Key properties:
 *  - One observer shared across all message bubbles in a chat.
 *  - Bails out of the intersection callback when `document.visibilityState`
 *    is not 'visible' — prevents marking while the window is minimized.
 *  - On `visibilitychange → visible`, re-observes all pending elements so the
 *    observer re-fires for messages already in the viewport.
 *  - Each observed element is unobserved immediately after the first
 *    intersection (mark-once semantics).
 *  - Messages already present in readReceipts (loaded from DB) are skipped at
 *    registration time, incurring zero observer overhead.
 *  - All callbacks (markMessagesRead etc.) are captured in stable refs so the
 *    observer closure never becomes stale.
 *
 * Usage in a parent component:
 *   const scrollRef = useRef<HTMLDivElement>(null);
 *   const { register, unregister } = useMessageReadObserver(
 *     myAddress, readReceipts, markMessagesRead, scrollRef
 *   );
 *
 * Usage in each MessageBubble (only for !isMine && !isDeleted):
 *   const rootRef = useRef<HTMLDivElement>(null);
 *   useEffect(() => {
 *     const el = rootRef.current;
 *     if (!el) return;
 *     register(msg.id, el);
 *     return () => unregister(msg.id, el);
 *   }, [msg.id, register, unregister]);
 *   <Box ref={rootRef} ...>
 */

import { useCallback, useEffect, useRef } from 'react';

export function useMessageReadObserver(
  myAddress: string | undefined,
  readReceipts: Map<string, Set<string>>,
  markMessagesRead: (ids: string[]) => void,
  scrollContainerRef: React.RefObject<HTMLElement | null>
): {
  register: (msgId: string, el: HTMLElement) => void;
  unregister: (msgId: string, el: HTMLElement) => void;
} {
  const observerRef = useRef<IntersectionObserver | null>(null);
  // Maps each observed DOM element to its message ID.
  const elementToIdRef = useRef<Map<Element, string>>(new Map());

  // Stable refs so the observer callback never closes over stale values.
  const myAddressRef = useRef(myAddress);
  const readReceiptsRef = useRef(readReceipts);
  const markRef = useRef(markMessagesRead);

  // Keep the refs in sync on every render (no deps array = run after every render).
  useEffect(() => { myAddressRef.current = myAddress; });
  useEffect(() => { readReceiptsRef.current = readReceipts; });
  useEffect(() => { markRef.current = markMessagesRead; });

  // Create the observer once on mount.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Only process when the Electron window is actively focused.
        // visibilityState catches minimised windows; hasFocus() catches the
        // case where the window is visible on screen but another app is in front.
        if (!document.hasFocus()) return;

        const addr = myAddressRef.current;
        if (!addr) return;

        const receipts = readReceiptsRef.current;
        const toMark: string[] = [];

        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          const msgId = elementToIdRef.current.get(entry.target);
          if (!msgId) continue;

          // Unobserve immediately — each message only needs to be marked once.
          observer.unobserve(entry.target);
          elementToIdRef.current.delete(entry.target);

          // Skip if already marked read (receipts may have loaded from DB by now).
          if (receipts.get(msgId)?.has(addr)) continue;

          toMark.push(msgId);
        }

        if (toMark.length > 0) {
          markRef.current(toMark);
        }
      },
      {
        root: scrollContainerRef.current,
        threshold: 0.1,
        rootMargin: '0px',
      }
    );

    observerRef.current = observer;

    // When the window becomes visible again, re-observe all pending elements.
    // This causes the observer to re-fire immediately for anything that is
    // already in the viewport, so messages the user can now see get marked.
    // Debounced at 200 ms so rapid OS focus/visibility events (e.g. fast
    // alt-tab) don't cause unnecessary unobserve/re-observe churn.
    let recheckTimer: ReturnType<typeof setTimeout> | null = null;
    const recheck = () => {
      if (recheckTimer !== null) return;
      recheckTimer = setTimeout(() => {
        recheckTimer = null;
        if (!document.hasFocus()) return;
        const pending = Array.from(elementToIdRef.current.entries());
        for (const [el] of pending) {
          observer.unobserve(el);
          observer.observe(el);
        }
      }, 200);
    };

    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);

    return () => {
      observer.disconnect();
      observerRef.current = null;
      elementToIdRef.current.clear();
      if (recheckTimer !== null) clearTimeout(recheckTimer);
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally once — root is a stable DOM ref, captured once is correct.

  /**
   * Register a message element for intersection observation.
   * Only call for messages from others (!isMine && !isDeleted).
   */
  const register = useCallback((msgId: string, el: HTMLElement) => {
    const observer = observerRef.current;
    if (!observer) return;

    // Skip if already read — avoid unnecessary DOM observation.
    const addr = myAddressRef.current;
    if (addr && readReceiptsRef.current.get(msgId)?.has(addr)) return;

    elementToIdRef.current.set(el, msgId);
    observer.observe(el);
  }, []);

  /**
   * Unregister an element on unmount. Called from MessageBubble's useEffect cleanup.
   */
  const unregister = useCallback((_msgId: string, el: HTMLElement) => {
    observerRef.current?.unobserve(el);
    elementToIdRef.current.delete(el);
  }, []);

  return { register, unregister };
}
