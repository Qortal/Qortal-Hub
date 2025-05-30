import { forwardRef, useEffect, useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { getBaseApiReact } from '../../App';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { useFrame } from 'react-frame-component';
import { useQortalMessageListener } from '../../hooks/useQortalMessageListener';
import { useThemeContext } from '../Theme/ThemeContext';
import { useTranslation } from 'react-i18next';

export const AppViewer = forwardRef(
  ({ app, hide, isDevMode, skipAuth }, iframeRef) => {
    const { window: frameWindow } = useFrame();
    const { path, history, changeCurrentIndex, resetHistory } =
      useQortalMessageListener(
        frameWindow,
        iframeRef,
        app?.tabId,
        isDevMode,
        app?.name,
        app?.service,
        skipAuth
      );

    const [url, setUrl] = useState('');
    const { themeMode } = useThemeContext();
    const { i18n, t } = useTranslation([
      'auth',
      'core',
      'group',
      'question',
      'tutorial',
    ]);
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
        setUrl(app.url + `&theme=${themeMode}&lang=${currentLang}`);
      }
    }, [app?.url, app?.isPreview]);
    const defaultUrl = useMemo(() => {
      return url;
    }, [url, isDevMode]);

    const refreshAppFunc = (e) => {
      const { tabId } = e.detail;
      if (tabId === app?.tabId) {
        if (isDevMode) {
          resetHistory();
          if (!app?.isPreview || app?.isPrivate) {
            setUrl(
              app?.url +
                `?time=${Date.now()}&theme=${themeMode}&lang=${currentLang}`
            );
          }
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
      const iframe = iframeRef?.current;
      if (!iframe || !iframe?.src) return;

      try {
        const targetOrigin = new URL(iframe.src).origin;
        iframe.contentWindow?.postMessage(
          { action: 'THEME_CHANGED', theme: themeMode, requestedHandler: 'UI' },
          targetOrigin
        );
      } catch (err) {
        console.error('Failed to send theme change to iframe:', err);
      }
    }, [themeMode]);

    useEffect(() => {
      const iframe = iframeRef?.current;
      if (!iframe || !iframe?.src) return;

      try {
        const targetOrigin = new URL(iframe.src).origin;
        iframe.contentWindow?.postMessage(
          {
            action: 'LANGUAGE_CHANGED',
            language: currentLang,
            requestedHandler: 'UI',
          },
          targetOrigin
        );
      } catch (err) {
        console.error('Failed to send language change to iframe:', err);
      }
    }, [currentLang]);

    const removeTrailingSlash = (str) => str.replace(/\/$/, '');

    const copyLinkFunc = (e) => {
      const { tabId } = e.detail;
      if (tabId === app?.tabId) {
        let link = 'qortal://' + app?.service + '/' + app?.name;
        if (path && path.startsWith('/')) {
          link = link + removeTrailingSlash(path);
        }
        if (path && !path.startsWith('/')) {
          link = link + '/' + removeTrailingSlash(path);
        }
        navigator.clipboard
          .writeText(link)
          .then(() => {
            console.log('Path copied to clipboard:', path);
          })
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

    // Function to navigate back in iframe
    const navigateBackInIframe = async () => {
      if (
        iframeRef.current &&
        iframeRef.current.contentWindow &&
        history?.currentIndex > 0
      ) {
        // Calculate the previous index and path
        const previousPageIndex = history.currentIndex - 1;
        const previousPath = history.customQDNHistoryPaths[previousPageIndex];
        const targetOrigin = iframeRef.current
          ? new URL(iframeRef.current.src).origin
          : '*';
        // Signal non-manual navigation
        iframeRef.current.contentWindow.postMessage(
          { action: 'PERFORMING_NON_MANUAL', currentIndex: previousPageIndex },
          targetOrigin
        );
        // Update the current index locally
        changeCurrentIndex(previousPageIndex);

        // Create a navigation promise with a 200ms timeout
        const navigationPromise = new Promise((resolve, reject) => {
          function handleNavigationSuccess(event) {
            if (
              event.data?.action === 'NAVIGATION_SUCCESS' &&
              event.data.path === previousPath
            ) {
              frameWindow.removeEventListener(
                'message',
                handleNavigationSuccess
              );
              resolve();
            }
          }

          frameWindow.addEventListener('message', handleNavigationSuccess);

          // Timeout after 200ms if no response
          setTimeout(() => {
            window.removeEventListener('message', handleNavigationSuccess);
            reject(
              new Error(
                t('core:message.error.navigation_timeout', {
                  postProcess: 'capitalizeFirstChar',
                })
              )
            );
          }, 200);
          const targetOrigin = iframeRef.current
            ? new URL(iframeRef.current.src).origin
            : '*';
          // Send the navigation command after setting up the listener and timeout
          iframeRef.current.contentWindow.postMessage(
            {
              action: 'NAVIGATE_TO_PATH',
              path: previousPath,
              requestedHandler: 'UI',
            },
            targetOrigin
          );
        });

        // Execute navigation promise and handle timeout fallback
        try {
          await navigationPromise;
        } catch (error) {
          if (isDevMode) {
            setUrl(
              `${url}${previousPath != null ? previousPath : ''}?theme=${themeMode}&lang=${currentLang}&time=${new Date().getMilliseconds()}&isManualNavigation=false`
            );
            return;
          }
          setUrl(
            `${getBaseApiReact()}/render/${app?.service}/${app?.name}${previousPath != null ? previousPath : ''}?theme=${themeMode}&lang=${currentLang}&identifier=${app?.identifier != null && app?.identifier != 'null' ? app?.identifier : ''}&time=${new Date().getMilliseconds()}&isManualNavigation=false`
          );
          // iframeRef.current.contentWindow.location.href = previousPath; // Fallback URL update
        }
      } else {
        console.log('Iframe not accessible or does not have a content window.');
      }
    };

    const navigateBackAppFunc = (e) => {
      navigateBackInIframe();
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

    // Function to navigate back in iframe
    const navigateForwardInIframe = async () => {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        const targetOrigin = iframeRef.current
          ? new URL(iframeRef.current.src).origin
          : '*';
        iframeRef.current.contentWindow.postMessage(
          { action: 'NAVIGATE_FORWARD' },
          targetOrigin
        );
      } else {
        console.log('Iframe not accessible or does not have a content window.');
      }
    };

    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <iframe
          ref={iframeRef}
          style={{
            height: '100vh',
            border: 'none',
            width: '100%',
          }}
          id="browser-iframe"
          src={defaultUrl}
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals"
          allow="fullscreen; clipboard-read; clipboard-write"
        ></iframe>
      </Box>
    );
  }
);
