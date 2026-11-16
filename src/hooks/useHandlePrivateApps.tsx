import { useState } from 'react';
import { executeEvent } from '../utils/events';
import { getBaseApiReact } from '../App';
import { createEndpoint } from '../background/background.ts';
import {
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../atoms/global';
import { saveToLocalStorage } from '../components/Apps/AppsNavBarDesktop';
import {
  inLauncherTab,
  useLauncherTabId,
} from '../components/Apps/launcherTabs';
import { base64ToUint8Array } from '../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../encryption/encryption.ts';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { upsertPrivatePinnedApp } from './privatePinnedApps';
import { privateAppPreviewUrl } from './privateAppPreview';

export type OpenPrivateAppOptions = {
  /**
   * Asked between the steps. Once it gives false (the tab the app was for
   * was closed, or another account signed in), openApp stops: the app does
   * not open, and its message closes instead of turning into another.
   */
  isWanted?: () => boolean;
  /** Takes the opened app's tab, instead of the addTab event. */
  openTab?: (tab: Record<string, any>) => void;
};

let lastOpenId = 0;

export const useHandlePrivateApps = () => {
  const [status, setStatus] = useState('');
  const [openSnackGlobal, setOpenSnackGlobal] = useAtom(openSnackGlobalAtom);
  const [infoSnackCustom, setInfoSnackCustom] = useAtom(infoSnackGlobalAtom);
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);
  // Inside a launcher tab the app opens in its place, once it is decrypted.
  const launcherTabId = useLauncherTabId();
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);

  const openApp = async (
    privateAppProperties,
    addToPinnedApps,
    setLoadingStatePrivateApp,
    { isWanted, openTab }: OpenPrivateAppOptions = {}
  ) => {
    // Marks this call's messages, so stopping closes its own and no other.
    lastOpenId += 1;
    const sourceId = `private-app-${lastOpenId}`;
    const stillWanted = () => !isWanted || isWanted();
    const stop = () => {
      executeEvent('closeGlobalSnackBar', { sourceId });
      return false;
    };
    try {
      if (setLoadingStatePrivateApp) {
        setLoadingStatePrivateApp(
          t('core:message.generic.downloading_decrypting_app', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      setOpenSnackGlobal(true);

      setInfoSnackCustom({
        type: 'info',
        message: t('core:message.generic.fetching_data', {
          postProcess: 'capitalizeFirstChar',
        }),
        duration: null,
        sourceId,
      });
      const urlData = `${getBaseApiReact()}/arbitrary/${
        privateAppProperties?.service
      }/${privateAppProperties?.name}/${
        privateAppProperties?.identifier
      }?encoding=base64`;
      let data;
      try {
        const responseData = await fetch(urlData, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!responseData?.ok) {
          if (setLoadingStatePrivateApp) {
            setLoadingStatePrivateApp(
              t('core:message.error.download_private_app', {
                postProcess: 'capitalizeFirstChar',
              })
            );
          }

          throw new Error(
            t('core:message.error.fetch_app', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        }

        data = await responseData.text();
        if (data?.error) {
          if (setLoadingStatePrivateApp) {
            setLoadingStatePrivateApp(
              t('core:message.error.download_private_app', {
                postProcess: 'capitalizeFirstChar',
              })
            );
          }
          throw new Error(
            t('core:message.error.fetch_app', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        }
      } catch (error) {
        if (setLoadingStatePrivateApp) {
          setLoadingStatePrivateApp(
            t('core:message.error.download_private_app', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        }
        throw error;
      }
      if (!stillWanted()) return stop();

      let decryptedData;
      try {
        decryptedData = await window.sendMessage('DECRYPT_QORTAL_GROUP_DATA', {
          base64: data,
          groupId: privateAppProperties?.groupId,
        });
        if (decryptedData?.error) {
          if (setLoadingStatePrivateApp) {
            setLoadingStatePrivateApp(
              t('core:message.error.decrypt_app', {
                postProcess: 'capitalizeFirstChar',
              })
            );
          }
          throw new Error(decryptedData?.error);
        }
      } catch (error) {
        if (setLoadingStatePrivateApp) {
          setLoadingStatePrivateApp(
            t('core:message.error.decrypt_app', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        }
        throw error;
      }
      if (!stillWanted()) return stop();

      try {
        const convertToUint = base64ToUint8Array(decryptedData);
        const UintToObject = uint8ArrayToObject(convertToUint);

        if (decryptedData) {
          setInfoSnackCustom({
            type: 'info',
            message: t('core:message.generic.building_app', {
              postProcess: 'capitalizeFirstChar',
            }),
            sourceId,
          });

          const buildPrivatePreview = async () => {
            const endpoint = await createEndpoint(
              `/arbitrary/APP/${privateAppProperties?.name}/zip?preview=true`
            );
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'text/plain',
              },
              body: UintToObject?.app,
            });

            const url = privateAppPreviewUrl(
              getBaseApiReact(),
              response.ok ? await response.text() : ''
            );
            if (!url) {
              // 401/403: the node builds previews only with its API key.
              const needsOwnNode =
                response.status === 401 || response.status === 403;
              throw new Error(
                t(
                  needsOwnNode
                    ? 'core:message.error.private_app_needs_own_node'
                    : 'core:message.error.build_app',
                  { postProcess: 'capitalizeFirstChar' }
                )
              );
            }
            return url;
          };

          const previewUrl = await buildPrivatePreview();
          if (!stillWanted()) return stop();

          const refreshFunc = async (tabId) => {
            try {
              setOpenSnackGlobal(true);
              setInfoSnackCustom({
                type: 'info',
                message: t('core:message.generic.building_app', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });
              executeEvent('updateAppUrl', {
                tabId,
                url: await buildPrivatePreview(),
              });
            } catch (error) {
              setOpenSnackGlobal(true);
              setInfoSnackCustom({
                type: 'error',
                message:
                  error?.message ||
                  t('core:message.error.build_app', {
                    postProcess: 'capitalizeFirstChar',
                  }),
              });
            }
          };

          const appName = UintToObject?.name;
          const logo = UintToObject?.logo
            ? `data:image/png;base64,${UintToObject?.logo}`
            : null;

          const dataBody = {
            identifier: privateAppProperties?.identifier,
            name: privateAppProperties?.name,
            service: privateAppProperties?.service,
            url: previewUrl,
            isPreview: true,
            isPrivate: true,
            privateAppProperties: { ...privateAppProperties, logo, appName },
            filePath: '',
            refreshFunc: (tabId) => {
              void refreshFunc(tabId);
            },
          };
          if (openTab) {
            openTab(dataBody);
          } else {
            executeEvent('addTab', {
              data: inLauncherTab(dataBody, launcherTabId),
            });
          }
          setInfoSnackCustom({
            type: 'success',
            message: t('core:message.generic.opened', {
              postProcess: 'capitalizeFirstChar',
            }),
            sourceId,
          });
          if (setLoadingStatePrivateApp) {
            setLoadingStatePrivateApp(``);
          }
          if (addToPinnedApps) {
            setSortablePinnedApps((prev) => {
              const updatedApps = upsertPrivatePinnedApp(prev, {
                isPrivate: true,
                isPreview: true,
                privateAppProperties: {
                  ...privateAppProperties,
                  logo,
                  appName,
                },
              });

              saveToLocalStorage(
                'ext_saved_settings',
                'sortablePinnedApps',
                updatedApps
              );
              return updatedApps;
            });
            setSettingsLocalLastUpdated(Date.now());
          }
          return true;
        }
      } catch (error) {
        if (setLoadingStatePrivateApp) {
          setLoadingStatePrivateApp(
            `Error! ${
              error?.message ||
              t('core:message.error.build_app', {
                postProcess: 'capitalizeFirstChar',
              })
            }`
          );
        }
        throw error;
      }
    } catch (error) {
      // Nothing to report about an app no longer wanted.
      if (!stillWanted()) return stop();
      setInfoSnackCustom({
        type: 'error',
        message:
          error?.message ||
          t('core:message.error.fetch_app', {
            postProcess: 'capitalizeFirstChar',
          }),
        sourceId,
      });
    }
    return false;
  };
  return {
    openApp,
    status,
  };
};
