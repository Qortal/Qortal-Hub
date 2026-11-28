import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { appLockedAtom } from '../../atoms/presence';
import {
  appNameOf,
  appOffHubZoom,
  appTabOnScreen,
  isInHubWindow,
  type HubZoomState,
  type HubZoomTab,
} from './hubZoom';

/** How long a change made with the keys, the menu or the wheel shows itself. */
export const HUB_ZOOM_BUBBLE_MS = 2000;

export type HubZoom = {
  /** Main zooms (the desktop app); in a browser there is nothing to show. */
  available: boolean;
  /** The Q-App's or website's tab on screen, if any. */
  tabId: string | null;
  /** One of Hub's windows, dialogs or menus has the keyboard. */
  hubWindow: boolean;
  appName: string;
  state: HubZoomState | null;
  /**
   * The magnifier shows: the app on screen is off Hub's zoom, or its zoom
   * just changed. Hub's own zoom has no magnifier.
   */
  shown: boolean;
  /** The panel shows a change by itself, for a moment. */
  bubble: boolean;
  endBubble(): void;
  /** Zooms the app on screen. */
  change(action: 'in' | 'out' | 'reset'): void;
  /** The pointer is on the magnifier or its panel, or left them. */
  pointerOn(on: boolean): void;
  /**
   * Counts the times main saw the pointer leave the magnifier or its panel
   * straight onto an app's page: the page itself got no pointerleave.
   */
  pointerAway: number;
};

/**
 * The search bar's magnifier: tells main which app tab is on screen (and
 * whether one of Hub's windows has the keyboard, or Hub is locked), and keeps
 * the zoom of that app for the magnifier to show.
 */
export function useHubZoom(
  desktopViewMode: string,
  selectedTab: HubZoomTab
): HubZoom {
  const api = typeof window === 'undefined' ? undefined : window.hubZoom;
  const locked = useAtomValue(appLockedAtom);
  const tabId = appTabOnScreen(desktopViewMode, selectedTab);
  const appName = appNameOf(selectedTab);
  const tabRef = useRef(tabId);
  tabRef.current = tabId;

  // One of Hub's windows, dialogs or menus with the keyboard: the zoom keys
  // zoom Hub then, not the app behind it.
  const [hubWindow, setHubWindow] = useState(() =>
    isInHubWindow(document.activeElement)
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => setHubWindow(isInHubWindow(document.activeElement));
    // On focusout the focus hasn't moved yet: look once it has.
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, 0);
    };
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', later);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', later);
    };
  }, []);

  const screenTabId = tabId && !hubWindow ? tabId : null;
  useEffect(() => {
    api?.onScreen({ tabId: screenTabId, locked });
  }, [api, screenTabId, locked]);
  // Gone (signed out, the page reloading): nothing of this page is on screen.
  useEffect(
    () => () => {
      api?.onScreen({ tabId: null, locked: false });
    },
    [api]
  );

  const [state, setState] = useState<HubZoomState | null>(null);
  // Each answer is for the newest question only (the tab may have changed).
  const requestRef = useRef(0);
  const refresh = useCallback(() => {
    if (!api) return;
    const request = ++requestRef.current;
    api.get(tabId).then(
      (next) => {
        if (request === requestRef.current) setState(next ?? null);
      },
      () => undefined
    );
  }, [api, tabId]);
  useEffect(() => {
    setState(null);
    refresh();
  }, [refresh]);

  const [bubble, setBubble] = useState(false);
  const bubbleRef = useRef(bubble);
  bubbleRef.current = bubble;
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPanelRef = useRef(false);
  const stopBubbleTimer = () => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = null;
  };
  const endBubble = useCallback(() => {
    stopBubbleTimer();
    setBubble(false);
  }, []);
  // The panel closes a moment after the change, but not under the pointer.
  const startBubbleTimer = useCallback(() => {
    stopBubbleTimer();
    bubbleTimer.current = setTimeout(() => {
      bubbleTimer.current = null;
      if (!onPanelRef.current) setBubble(false);
    }, HUB_ZOOM_BUBBLE_MS);
  }, []);

  // Main saw the pointer leave the magnifier or its panel for an app's page,
  // where the page gets no pointerleave: as if it had.
  const [pointerAway, setPointerAway] = useState(0);
  const leftUnseen = useCallback(() => {
    if (!onPanelRef.current) return;
    onPanelRef.current = false;
    setPointerAway((count) => count + 1);
    if (bubbleRef.current && bubbleTimer.current === null) startBubbleTimer();
  }, [startBubbleTimer]);

  useEffect(() => {
    if (!api) return undefined;
    return api.onChanged((change) => {
      if (change?.what === 'pointer') {
        leftUnseen();
        return;
      }
      refresh();
      // Only a change the user just made with the keys, the menu or the
      // wheel to the app on screen shows itself: Hub's own zoom has no
      // magnifier.
      if (!change || change.source === 'panel' || change.source === 'load') {
        return;
      }
      if (
        change.what === 'app' &&
        tabRef.current &&
        Array.isArray(change.tabIds) &&
        change.tabIds.includes(tabRef.current)
      ) {
        setBubble(true);
        startBubbleTimer();
      }
    });
  }, [api, refresh, startBubbleTimer, leftUnseen]);
  // Another tab on screen: a change shown for the last one is over.
  useEffect(() => endBubble(), [tabId, endBubble]);
  useEffect(() => stopBubbleTimer, []);

  const change = useCallback(
    (action: 'in' | 'out' | 'reset') => {
      const forTab = tabRef.current;
      if (!api || !forTab) return;
      // Main says what changed (onChanged); ask again in any case, for the
      // whole state of the tab on screen, if it is still the one on screen.
      api.change({ tabId: forTab }, action).then(
        () => {
          if (tabRef.current === forTab) refresh();
        },
        () => undefined
      );
    },
    [api, refresh]
  );

  const pointerOn = useCallback(
    (on: boolean) => {
      if (!api) return;
      if (on) {
        // The magnifier is the app's: there is one only with an app on
        // screen.
        if (!tabRef.current) return;
        onPanelRef.current = true;
        api.panelPointer(tabRef.current);
        return;
      }
      if (!onPanelRef.current) return;
      onPanelRef.current = false;
      api.panelPointer(undefined);
      // Off the panel: a change shown by itself closes in a moment.
      if (bubbleRef.current && bubbleTimer.current === null) {
        startBubbleTimer();
      }
    },
    [api, startBubbleTimer]
  );
  // Never leave main thinking the pointer is on a magnifier that is gone.
  useEffect(
    () => () => {
      if (onPanelRef.current) api?.panelPointer(undefined);
      onPanelRef.current = false;
    },
    [api]
  );

  return {
    available: !!api,
    tabId,
    hubWindow,
    appName,
    state,
    shown: bubble || appOffHubZoom(tabId, state),
    bubble,
    endBubble,
    change,
    pointerOn,
    pointerAway,
  };
}
