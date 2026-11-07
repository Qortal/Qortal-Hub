import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  createElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { attachQAppRequestBridge } from '../../qortal/qapp-guest-request-bridge';
import { buildAppRenderRoot } from '../Apps/appRenderUrl';
import { useThemeContext } from '../Theme/ThemeContext';
import { homeWidgetKey, type SavedHomeWidget } from './homeWidgets';
import {
  WIDGET_MAX_H,
  WIDGET_MIN_H,
  gridColumnsForWidth,
  gridRowsForPx,
} from './widgetGrid';
import {
  WIDGET_INFO,
  WIDGET_SET_SIZE,
  WIDGET_VISIBILITY,
  createWidgetRequestHandler,
} from './widgetRequests';

/** Without a guest hello by then, the widget counts as failed (as tabs do). */
const GUEST_HELLO_TIMEOUT_MS = 10_000;

type GuestOwner = { tabId: string; name: string; service: string };

/**
 * The owner a widget's guest is prepared for. Its own tab id keeps its
 * session permissions apart from the same app open in a tab; the partition
 * (storage) is per app name, as for tabs, so a widget shares its settings
 * with its app.
 */
export const widgetGuestOwner = (widget: {
  name: string;
  identifier: string | null;
}): GuestOwner => ({
  tabId: `home-widget:${widget.name}:${widget.identifier ?? ''}`.slice(0, 256),
  name: widget.name,
  service: 'APP',
});

/**
 * The address a widget loads from the node: its app's /render address with
 * the theme and language every Q-App gets, its identifier, and goWidget=1 so
 * it draws itself as a widget from the first frame.
 */
export const widgetUrl = (
  baseUrl: string,
  widget: { name: string; identifier: string | null },
  { theme, language }: { theme: string; language: string }
): string =>
  `${buildAppRenderRoot(baseUrl, 'APP', widget.name)}?theme=${encodeURIComponent(
    theme
  )}&lang=${encodeURIComponent(language)}&identifier=${
    widget.identifier ? encodeURIComponent(widget.identifier) : ''
  }&goWidget=1`;

/** What a widget asked for with GO_WIDGET_SET_SIZE, in grid cells. */
export const askedWidgetSize = (
  data: Record<string, unknown>
): { w: number | null; h: number } | null => {
  const payload = (data?.payload ?? {}) as Record<string, unknown>;
  const height = Number(data?.height ?? payload.height);
  if (!Number.isFinite(height) || height <= 0) return null;
  return {
    w: gridColumnsForWidth(data?.width ?? payload.width),
    h: gridRowsForPx(height),
  };
};

type HomeWidgetViewProps = {
  widget: SavedHomeWidget;
  /** The node the widget loads from (a new one mounts a new view). */
  baseUrl: string;
  /** Home is showing, the window is visible and the widget is in view. */
  visible: boolean;
  /** Read when a request comes in (see widgetRequests). */
  isOnScreen: () => boolean;
  /** The widget's frame now, in CSS px (for GO_WIDGET_INFO). */
  widthPx: number;
  heightPx: number;
  /** The grid's columns now (for GO_WIDGET_INFO). */
  columns: number;
  /** Off while Home's widgets are being arranged: the Hub takes the pointer. */
  interactive: boolean;
  /** Bumped to load the widget again. */
  reloadKey: number;
  /** Waits this long before loading, so many widgets do not start at once. */
  loadDelayMs: number;
  /** The widget asked for a size; taken unless the user has sized it. */
  onAskSize: (key: string, size: { w: number | null; h: number }) => void;
};

type GuestStatus = 'loading' | 'ready' | 'failed';

/**
 * One widget: its Q-App in an isolated guest, prepared and checked by the
 * Electron main process exactly like a Q-App tab (own session, CSP, no
 * popups, no navigation away from its app), with the widget request policy
 * on top instead of a tab's.
 *
 * The guest's listeners and request bridge belong to the element and the
 * document, not to React effects: Home is kept in an <Activity>, whose
 * effects are taken down while another view shows, and a widget must keep
 * answering what it asked before that.
 */
const HomeWidgetViewInner = ({
  widget,
  baseUrl,
  visible,
  isOnScreen,
  widthPx,
  heightPx,
  columns,
  interactive,
  reloadKey,
  loadDelayMs,
  onAskSize,
}: HomeWidgetViewProps) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core', 'group']);
  const { themeMode } = useThemeContext();
  const language = i18n.language;
  const key = homeWidgetKey(widget);
  const owner = useMemo(
    () => widgetGuestOwner(widget),
    [widget.name, widget.identifier]
  );

  // The address is fixed for the view's life: theme and language changes are
  // posted to the widget, as to any Q-App.
  const initialUrl = useMemo(
    () => widgetUrl(baseUrl, widget, { theme: themeMode, language: language }),
    [baseUrl, widget.name, widget.identifier]
  );

  const [config, setConfig] = useState<{
    partition: string;
    preload: string;
  } | null>(null);
  const [status, setStatus] = useState<GuestStatus>('loading');
  const [shown, setShown] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<any>(null);
  const documentRef = useRef('');
  const bridgeRef = useRef<null | (() => void)>(null);
  const helloTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentVisibleRef = useRef<boolean | null>(null);
  // Off while Home's <Activity> hides the view: the widget is not visible
  // then, even before the props catch up.
  const effectsOnRef = useRef(false);

  const live = useRef({
    visible,
    widthPx,
    heightPx,
    columns,
    themeMode,
    language,
    widget,
    isOnScreen,
    onAskSize,
  });
  live.current = {
    visible,
    widthPx,
    heightPx,
    columns,
    themeMode,
    language,
    widget,
    isOnScreen,
    onAskSize,
  };

  const post = useCallback((message: Record<string, unknown>) => {
    const view = viewRef.current;
    if (!view?.isConnected || !documentRef.current) return;
    try {
      void Promise.resolve(
        view.send('qapp:event', { ...message, requestedHandler: 'UI' })
      ).catch(() => undefined);
    } catch {
      /* the guest is going away */
    }
  }, []);

  const postVisibility = useCallback(
    (next: boolean) => {
      sentVisibleRef.current = next;
      post({ action: WIDGET_VISIBILITY, payload: { visible: next } });
    },
    [post]
  );

  // What a document is told when it starts: theme, language and visibility.
  const postState = useCallback(() => {
    const current = live.current;
    post({ action: 'THEME_CHANGED', theme: current.themeMode });
    post({ action: 'LANGUAGE_CHANGED', language: current.language });
    postVisibility(effectsOnRef.current && current.visible);
  }, [post, postVisibility]);

  const answerOwn = useCallback(
    (action: string, data: Record<string, unknown>) => {
      const current = live.current;
      if (action === WIDGET_SET_SIZE) {
        const asked = askedWidgetSize(data);
        if (!asked) return { applied: false };
        const userSized = current.widget.sizedBy === 'user';
        if (!userSized) current.onAskSize(key, asked);
        return { applied: !userSized };
      }
      if (action === WIDGET_INFO) {
        return {
          widget: true,
          platform: 'Qortal Hub',
          theme: current.themeMode,
          language: current.language,
          visible: current.visible,
          width: Math.round(current.widthPx),
          height: Math.round(current.heightPx),
          columns: current.widget.w,
          rows: current.widget.h,
          gridColumns: current.columns,
          minRows: WIDGET_MIN_H,
          maxRows: WIDGET_MAX_H,
          sizedBy: current.widget.sizedBy,
        };
      }
      return null;
    },
    [key]
  );

  // A new document said hello: bind requests to it, release it, and tell it
  // what it missed while it loaded.
  const onHello = useCallback(
    (view: any, documentId: string) => {
      if (helloTimerRef.current) clearTimeout(helloTimerRef.current);
      helloTimerRef.current = null;
      bridgeRef.current?.();
      documentRef.current = documentId;
      bridgeRef.current = attachQAppRequestBridge(
        view,
        documentId,
        createWidgetRequestHandler({
          owner,
          isOnScreen: () => live.current.isOnScreen(),
          answerOwn,
        })
      );
      try {
        void Promise.resolve(view.send('qapp:ready', documentId)).catch(
          () => undefined
        );
      } catch {
        return; // the guest is already going away
      }
      postState();
      setStatus('ready');
    },
    [answerOwn, owner, postState]
  );

  // The preload says hello as soon as it runs, so what onHello posts can
  // reach the page before the widget's own script listens. Tell it again
  // once the page has loaded; a repeat is harmless. Only after a document
  // said hello, and the guest hands it to the page loaded now.
  const onLoaded = useCallback(() => {
    if (documentRef.current) postState();
  }, [postState]);

  const fail = useCallback(() => {
    if (helloTimerRef.current) clearTimeout(helloTimerRef.current);
    helloTimerRef.current = null;
    bridgeRef.current?.();
    bridgeRef.current = null;
    documentRef.current = '';
    setStatus('failed');
  }, []);

  const handlers = useRef({ onHello, onLoaded, fail });
  handlers.current = { onHello, onLoaded, fail };

  // Prepare the guest (after the stagger delay). Kept across Activity hides:
  // a hidden Home cancels a prepare still in flight and asks again on show.
  useEffect(() => {
    if (config || status === 'failed') return;
    const api = window.electronAPI;
    if (!api?.qappGuestPrepare) {
      setStatus('failed');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .qappGuestPrepare(owner, initialUrl, false)
        .then((prepared) => {
          if (!cancelled) setConfig(prepared);
        })
        .catch(() => {
          if (!cancelled) setStatus('failed');
        });
    }, loadDelayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config, status, owner, initialUrl, loadDelayMs, attempt]);

  // Released when the view really goes (removed widget, other node, logout),
  // not when Home's <Activity> only hides it: then its element stays put.
  useEffect(() => {
    const container = containerRef.current;
    return () => {
      setTimeout(() => {
        if (container?.isConnected) return;
        bridgeRef.current?.();
        bridgeRef.current = null;
        if (helloTimerRef.current) clearTimeout(helloTimerRef.current);
        void window.electronAPI
          ?.qappGuestRelease?.(owner)
          ?.catch(() => undefined);
      }, 0);
    };
  }, [owner]);

  // Listeners go on once per element and stay for its life; the source is
  // set only after them, since the guest attaches when it gets one.
  const attachedViews = useRef(new WeakSet<object>());
  const attachView = useCallback(
    (view: any) => {
      // Kept through Home's <Activity> hiding it, which detaches refs before
      // its effects' cleanups run: those still tell the widget it is hidden.
      if (!view) return;
      viewRef.current = view;
      if (attachedViews.current.has(view)) return;
      attachedViews.current.add(view);
      view.addEventListener('ipc-message', (event: any) => {
        if (event.target !== view) return;
        if (event.channel === 'qapp:error') {
          handlers.current.fail();
          return;
        }
        if (event.channel !== 'qapp:hello') return;
        const documentId = event.args?.[0]?.documentId;
        if (
          typeof documentId === 'string' &&
          /^[a-f0-9]{32}$/.test(documentId)
        ) {
          handlers.current.onHello(view, documentId);
        }
      });
      view.addEventListener('render-process-gone', () =>
        handlers.current.fail()
      );
      view.addEventListener('did-fail-load', (event: any) => {
        if (event.isMainFrame && event.errorCode !== -3) {
          handlers.current.fail();
        }
      });
      view.addEventListener('dom-ready', () => {
        setShown(true);
        handlers.current.onLoaded();
      });
      helloTimerRef.current = setTimeout(() => {
        if (!documentRef.current) handlers.current.fail();
      }, GUEST_HELLO_TIMEOUT_MS);
      view.setAttribute('src', initialUrl);
    },
    [initialUrl]
  );

  // Load it again when asked (a fresh address makes the node serve it anew).
  // Only a new key reloads: Home's <Activity> runs this again on every show.
  const appliedReload = useRef(reloadKey);
  useEffect(() => {
    if (reloadKey === appliedReload.current) return;
    appliedReload.current = reloadKey;
    const view = viewRef.current;
    if (!view?.isConnected || status === 'failed') return;
    setShown(false);
    view.setAttribute('src', `${initialUrl}&time=${reloadKey}`);
  }, [reloadKey]);

  useEffect(() => {
    post({ action: 'THEME_CHANGED', theme: themeMode });
  }, [themeMode, post]);
  useEffect(() => {
    post({ action: 'LANGUAGE_CHANGED', language });
  }, [language, post]);
  // Lets a widget pause while nobody sees it. The cleanup covers Home's
  // <Activity> hiding it, when no later effect runs until it shows again.
  useEffect(() => {
    effectsOnRef.current = true;
    if (sentVisibleRef.current !== visible) postVisibility(visible);
    return () => {
      effectsOnRef.current = false;
      if (sentVisibleRef.current !== false) postVisibility(false);
    };
  }, [visible, postVisibility]);

  const retry = () => {
    setShown(false);
    setStatus('loading');
    setAttempt((value) => value + 1);
  };

  const title = widget.title ?? widget.name;

  return (
    <Box
      ref={containerRef}
      sx={{ inset: 0, overflow: 'hidden', position: 'absolute' }}
    >
      {config && status !== 'failed'
        ? createElement('webview', {
            key: attempt,
            ref: attachView,
            partition: config.partition,
            preload: config.preload,
            webpreferences:
              'contextIsolation=yes,nodeIntegration=no,sandbox=yes,webviewTag=no',
            title,
            style: {
              background: 'transparent',
              border: 'none',
              display: 'flex',
              height: '100%',
              inset: 0,
              opacity: shown ? 1 : 0,
              pointerEvents: interactive ? 'auto' : 'none',
              position: 'absolute',
              transition: 'opacity 160ms ease',
              width: '100%',
            },
          })
        : null}
      {status === 'failed' ? (
        <Box
          role="alert"
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            height: '100%',
            justifyContent: 'center',
            p: 1,
            textAlign: 'center',
          }}
        >
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.74rem',
              lineHeight: 1.35,
            }}
          >
            {t('group:home_widgets.load_failed', {
              defaultValue: "{{title}} didn't load.",
              title,
            })}
          </Typography>
          <Button
            onClick={retry}
            size="small"
            sx={{
              textTransform: 'none',
              borderRadius: 999,
              fontSize: '0.72rem',
              minHeight: 28,
            }}
          >
            {t('core:retry', { postProcess: 'capitalizeFirstChar' })}
          </Button>
        </Box>
      ) : !shown ? (
        <Box
          aria-busy="true"
          aria-label={t('group:home_widgets.loading', {
            defaultValue: 'Loading {{title}}',
            title,
          })}
          sx={{
            alignItems: 'center',
            color: alpha(theme.palette.text.secondary, 0.8),
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            height: '100%',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <CircularProgress color="inherit" size={18} thickness={5} />
          <Typography noWrap sx={{ fontSize: '0.72rem', maxWidth: '90%' }}>
            {title}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
};

export const HomeWidgetView = memo(HomeWidgetViewInner);
HomeWidgetView.displayName = 'HomeWidgetView';
