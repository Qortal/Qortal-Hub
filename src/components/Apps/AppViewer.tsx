import { createElement, forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Button } from '@mui/material';
import { getBaseApiReact } from '../../App';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { useQortalMessageListener } from '../../hooks/useQortalMessageListener';
import { useThemeContext } from '../Theme/ThemeContext';
import { useTranslation } from 'react-i18next';
import { QORTAL_PROTOCOL } from '../../constants/constants';
import { buildPreviewUrl } from './appPreviewUrl';

type AppViewerProps = {
  app: any;
  isDevMode: boolean;
};

export const AppViewer = forwardRef<HTMLIFrameElement, AppViewerProps>(
  ({ app, isDevMode }, forwardedRef) => {
    const nativeViewRef = useRef<any>(null);
    const [nativeConfig, setNativeConfig] = useState<null | { partition: string; preload: string }>(null);
    const [nativeGuestActive, setNativeGuestActive] = useState(false);
    const [nativeGuestFailed, setNativeGuestFailed] = useState(false);
    const [guestPreloadDocument, setGuestPreloadDocument] = useState('');
    const [guestAttempt, setGuestAttempt] = useState(0);
    const guestHelloRef = useRef(false);
    const preparingRef = useRef(false);
    const preparedInitialUrlRef = useRef('');
    useImperativeHandle(forwardedRef, () => nativeViewRef.current);
    const { path, history, changeCurrentIndex, resetHistory } =
      useQortalMessageListener(
        app?.tabId,
        isDevMode,
        isDevMode ? 'devapp' : app?.name,
        isDevMode ? 'APP' : app?.service,
        app?.identifier,
        nativeViewRef,
        nativeGuestActive
      );

    const [url, setUrl] = useState('');
    const { themeMode } = useThemeContext();
    const { i18n, t } = useTranslation(['auth', 'core', 'group', 'question']);
    const currentLang = i18n.language;

    useEffect(() => {
      if (app?.isPreview) return;
      if (isDevMode) {
        setUrl(app?.url + `?theme=${themeMode}&lang=${currentLang}`);
        return;
      }
      let hasQueryParam = false;
      if (app?.path && app.path.includes('?')) {
        hasQueryParam = true;
      }

      setUrl(
        `${getBaseApiReact()}/render/${app?.service}/${app?.name}${app?.path != null ? `/${app?.path}` : ''}${hasQueryParam ? '&' : '?'}theme=${themeMode}&lang=${currentLang}&identifier=${app?.identifier != null && app?.identifier != 'null' ? app?.identifier : ''}`
      );
    }, [app?.service, app?.name, app?.identifier, app?.path, app?.isPreview]);

    useEffect(() => {
      if (app?.isPreview && app?.url) {
        resetHistory();
        setUrl(
          buildPreviewUrl(app.url, {
            language: currentLang,
            theme: themeMode,
          })
        );
      }
    }, [app?.url, app?.isPreview, currentLang, resetHistory, themeMode]);

    const defaultUrl = useMemo(() => {
      return url;
    }, [url, isDevMode]);

    const guestOwner = useMemo(
      () => ({
        tabId: String(app?.tabId ?? ''),
        name: isDevMode ? 'devapp' : String(app?.name ?? ''),
        service: isDevMode ? 'APP' : String(app?.service ?? ''),
      }),
      [app?.tabId, app?.name, app?.service, isDevMode]
    );

    useEffect(() => {
      if (!defaultUrl || !guestOwner.tabId ||
          !guestOwner.name || !guestOwner.service ||
          preparingRef.current || preparedInitialUrlRef.current) return;
      if (!window.electronAPI?.qappGuestPrepare) {
        setNativeGuestFailed(true);
        return;
      }
      preparingRef.current = true;
      preparedInitialUrlRef.current = defaultUrl;
      void window.electronAPI.qappGuestPrepare(
        guestOwner,
        defaultUrl,
        isDevMode
      ).then(setNativeConfig).catch(() => setNativeGuestFailed(true));
    }, [defaultUrl, guestOwner, isDevMode, guestAttempt]);

    const retryNativeGuest = () => {
      guestHelloRef.current = false;
      setNativeGuestActive(false);
      setNativeGuestFailed(false);
      setGuestPreloadDocument('');
      if (!nativeConfig) {
        preparingRef.current = false;
        preparedInitialUrlRef.current = '';
        setGuestAttempt((value) => value + 1);
      }
    };

    useEffect(() => () => {
      void window.electronAPI.qappGuestRelease(guestOwner).catch(() => undefined);
    }, [guestOwner]);

    useLayoutEffect(() => {
      const view = nativeViewRef.current;
      if (!nativeConfig || !view) return;
      const preloadHello = (event) => {
        if (event.target !== view) return;
        if (event.channel === 'qapp:error') {
          setNativeGuestFailed(true);
          return;
        }
        if (event.channel !== 'qapp:hello') return;
        const documentId = event.args?.[0]?.documentId;
        if (typeof documentId === 'string' && /^[a-f0-9]{32}$/.test(documentId)) {
          guestHelloRef.current = true;
          setGuestPreloadDocument(documentId);
          setNativeGuestActive(true);
        }
      };
      const guestGone = () => setNativeGuestFailed(true);
      const loadFailed = (event) => {
        if (event.isMainFrame && event.errorCode !== -3)
          setNativeGuestFailed(true);
      };
      view.addEventListener('ipc-message', preloadHello);
      view.addEventListener('render-process-gone', guestGone);
      view.addEventListener('did-fail-load', loadFailed);
      const attachTimer = setTimeout(() => {
        if (!guestHelloRef.current) setNativeGuestFailed(true);
      }, 10_000);
      // The guest is attached only after these listeners are registered.
      if (defaultUrl && view.getAttribute('src') !== defaultUrl)
        view.setAttribute('src', defaultUrl);
      return () => {
        clearTimeout(attachTimer);
        view.removeEventListener('ipc-message', preloadHello);
        view.removeEventListener('render-process-gone', guestGone);
        view.removeEventListener('did-fail-load', loadFailed);
      };
    }, [nativeConfig, guestOwner, defaultUrl]);

    useEffect(() => {
      if (nativeGuestActive && guestPreloadDocument)
        nativeViewRef.current?.send('qapp:ready', guestPreloadDocument);
    }, [nativeGuestActive, guestPreloadDocument]);

    const postToApp = useCallback((message) => {
      if (nativeGuestActive) nativeViewRef.current?.send('qapp:event', message);
    }, [nativeGuestActive]);

    const refreshAppFunc = (e) => {
      const { tabId } = e.detail;
      if (tabId === app?.tabId) {
        if (app?.isPreview && app?.url) {
          resetHistory();
          setUrl(
            buildPreviewUrl(app.url, {
              cacheBuster: Date.now(),
              language: currentLang,
              theme: themeMode,
            })
          );
          return;
        }
        if (isDevMode) {
          resetHistory();
          setUrl(
            buildPreviewUrl(app?.url, {
              cacheBuster: Date.now(),
              language: currentLang,
              theme: themeMode,
            })
          );
          return;
        }
        const constructUrl = `${getBaseApiReact()}/render/${app?.service}/${app?.name}${path != null ? path : ''}?theme=${themeMode}&lang=${currentLang}&identifier=${app?.identifier != null ? app?.identifier : ''}&time=${new Date().getMilliseconds()}`;
        setUrl(constructUrl);
      }
    };

    useEffect(() => {
      subscribeToEvent('refreshApp', refreshAppFunc);

      return () => {
        unsubscribeFromEvent('refreshApp', refreshAppFunc);
      };
    }, [app, path, isDevMode, themeMode, currentLang]);

    useEffect(() => {
      try {
        postToApp({ action: 'THEME_CHANGED', theme: themeMode, requestedHandler: 'UI' });
      } catch (err) {
        console.error('Failed to send theme change to Q-App:', err);
      }
    }, [themeMode, postToApp]);

    useEffect(() => {
      try {
        postToApp({
          action: 'LANGUAGE_CHANGED',
          language: currentLang,
          requestedHandler: 'UI',
        });
      } catch (err) {
        console.error('Failed to send language change to Q-App:', err);
      }
    }, [currentLang, postToApp]);

    const removeTrailingSlash = (str) => str.replace(/\/$/, '');

    const copyLinkFunc = (e) => {
      const { tabId } = e.detail;
      if (tabId === app?.tabId) {
        let link =
          QORTAL_PROTOCOL + app?.service + '/' + app?.name.replace(/ /g, '%20');
        if (path && path.startsWith('/')) {
          link = link + removeTrailingSlash(path);
        }
        if (path && !path.startsWith('/')) {
          link = link + '/' + removeTrailingSlash(path);
        }
        navigator.clipboard
          .writeText(link)
          .then(() => undefined)
          .catch((error) => {
            console.error('Failed to copy path:', error);
          });
      }
    };

    useEffect(() => {
      subscribeToEvent('copyLink', copyLinkFunc);

      return () => {
        unsubscribeFromEvent('copyLink', copyLinkFunc);
      };
    }, [app, path]);

    const receiveChunksFunc = useCallback(
      (e) => {
        if (app?.tabId !== e.detail?.tabId) return;
        const publishLocation = e.detail?.publishLocation;
        const chunksSubmitted = e.detail?.chunksSubmitted;
        const totalChunks = e.detail?.totalChunks;
        const retry = e.detail?.retry;
        const filename = e.detail?.filename;
        try {
          if (publishLocation === undefined || publishLocation === null) return;
          const dataToBeSent: Record<string, unknown> = {};
          if (chunksSubmitted !== undefined && chunksSubmitted !== null) {
            dataToBeSent.chunks = chunksSubmitted;
          }
          if (totalChunks !== undefined && totalChunks !== null) {
            dataToBeSent.totalChunks = totalChunks;
          }
          if (retry !== undefined && retry !== null) {
            dataToBeSent.retry = retry;
          }
          if (filename !== undefined && filename !== null) {
            dataToBeSent.filename = filename;
          }
          postToApp({
            action: 'PUBLISH_STATUS',
            publishLocation,
            ...dataToBeSent,
            requestedHandler: 'UI',
            processed: e.detail?.processed || false,
          });
        } catch (err) {
          console.error('Failed to send status to Q-App:', err);
        }
      },
      [postToApp, app?.tabId]
    );

    useEffect(() => {
      subscribeToEvent('receiveChunks', receiveChunksFunc);

      return () => {
        unsubscribeFromEvent('receiveChunks', receiveChunksFunc);
      };
    }, [receiveChunksFunc]);

    const waitForNativeNavigation = (targetPath: string, timeoutMs: number) =>
      new Promise<void>((resolve, reject) => {
        const view = nativeViewRef.current;
        if (!view || !nativeGuestActive) return reject(new Error('navigation_timeout'));
        const onMessage = (event) => {
          const data = event.args?.[0]?.data;
          if (event.channel !== 'qapp:request' ||
              data?.action !== 'NAVIGATION_SUCCESS' ||
              data.path !== targetPath) return;
          clearTimeout(timer);
          view.removeEventListener('ipc-message', onMessage);
          resolve();
        };
        view.addEventListener('ipc-message', onMessage);
        const timer = setTimeout(() => {
          view.removeEventListener('ipc-message', onMessage);
          reject(new Error('navigation_timeout'));
        }, timeoutMs);
        postToApp({ action: 'NAVIGATE_TO_PATH', path: targetPath, requestedHandler: 'UI' });
      });

    const navigateBackInApp = async () => {
      if (!nativeGuestActive || history?.currentIndex <= 0) return;
      const previousPageIndex = history.currentIndex - 1;
      const previousPath = history.customQDNHistoryPaths[previousPageIndex];
      postToApp({ action: 'PERFORMING_NON_MANUAL', currentIndex: previousPageIndex });
      changeCurrentIndex(previousPageIndex);
      try {
        await waitForNativeNavigation(previousPath, 1000);
      } catch {
        setUrl(`${getBaseApiReact()}/render/${app?.service}/${app?.name}${previousPath ?? ''}?theme=${themeMode}&lang=${currentLang}&identifier=${app?.identifier ?? ''}&time=${Date.now()}&isManualNavigation=false`);
      }
    };

    const navigateBackAppFunc = (e) => {
      navigateBackInApp();
    };

    useEffect(() => {
      if (!app?.tabId) return;
      subscribeToEvent(`navigateBackApp-${app?.tabId}`, navigateBackAppFunc);

      return () => {
        unsubscribeFromEvent(
          `navigateBackApp-${app?.tabId}`,
          navigateBackAppFunc
        );
      };
    }, [app, history, themeMode, currentLang]);

    const navigateToPathFunc = useCallback(
      async (e) => {
        const { path: targetPath = '' } = e.detail;
        try {
          await waitForNativeNavigation(targetPath, 1000);
        } catch {
          setUrl(
            `${getBaseApiReact()}/render/${app?.service}/${app?.name}/${targetPath}?theme=${themeMode}&lang=${currentLang}&identifier=${app?.identifier != null && app?.identifier != 'null' ? app?.identifier : ''}&time=${new Date().getMilliseconds()}&isManualNavigation=false`
          );
        }
      },
      [app, themeMode, currentLang, postToApp, nativeGuestActive]
    );

    useEffect(() => {
      if (!app?.tabId) return;
      subscribeToEvent(`navigateToPath-${app?.tabId}`, navigateToPathFunc);

      return () => {
        unsubscribeFromEvent(
          `navigateToPath-${app?.tabId}`,
          navigateToPathFunc
        );
      };
    }, [app?.tabId, navigateToPathFunc]);

    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          overflowAnchor: 'none',
          overscrollBehavior: 'none',
          width: '100%',
        }}
      >
        {nativeConfig && !nativeGuestFailed ? createElement('webview' as any, {
            ref: nativeViewRef,
            partition: nativeConfig.partition,
            preload: nativeConfig.preload,
            webpreferences: 'contextIsolation=yes,nodeIntegration=no,sandbox=yes,webviewTag=no',
            style: {
              border: 'none',
              // A webview needs flex sizing; otherwise its internal document
              // falls back to the browser's default 150px viewport height.
              display: 'flex',
              flex: '1 1 auto',
              height: '100%',
              minHeight: 0,
              width: '100%',
            },
          }) : nativeGuestFailed ? (
            <Box sx={{ p: 2 }} role="alert">
              {t('core:message.error.generic', { postProcess: 'capitalizeFirstChar' })}
              <Button onClick={retryNativeGuest}>
                {t('core:retry', { postProcess: 'capitalizeFirstChar' })}
              </Button>
            </Box>
          ) : null}
      </Box>
    );
  }
);
