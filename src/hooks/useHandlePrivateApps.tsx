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
import { base64ToUint8Array } from '../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../encryption/encryption.ts';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

export const useHandlePrivateApps = () => {
  const [status, setStatus] = useState('');
  const [openSnackGlobal, setOpenSnackGlobal] = useAtom(openSnackGlobalAtom);
  const [infoSnackCustom, setInfoSnackCustom] = useAtom(infoSnackGlobalAtom);
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);

  const openApp = async (
    privateAppProperties,
    addToPinnedApps,
    setLoadingStatePrivateApp
  ) => {
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

      try {
        const convertToUint = base64ToUint8Array(decryptedData);
        const UintToObject = uint8ArrayToObject(convertToUint);

        if (decryptedData) {
          setInfoSnackCustom({
            type: 'info',
            message: t('core:message.generic.building_app', {
              postProcess: 'capitalizeFirstChar',
            }),
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

            if (!response.ok) {
              throw new Error(
                t('core:message.error.build_app', {
                  postProcess: 'capitalizeFirstChar',
                })
              );
            }

            return createEndpoint(await response.text());
          };

          const previewUrl = await buildPrivatePreview();

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
          executeEvent('addTab', {
            data: dataBody,
          });
          setInfoSnackCustom({
            type: 'success',
            message: t('core:message.generic.opened', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
          if (setLoadingStatePrivateApp) {
            setLoadingStatePrivateApp(``);
          }
          if (addToPinnedApps) {
            setSortablePinnedApps((prev) => {
              const updatedApps = [
                ...prev,
                {
                  isPrivate: true,
                  isPreview: true,
                  privateAppProperties: {
                    ...privateAppProperties,
                    logo,
                    appName,
                  },
                },
              ];

              saveToLocalStorage(
                'ext_saved_settings',
                'sortablePinnedApps',
                updatedApps
              );
              return updatedApps;
            });
            setSettingsLocalLastUpdated(Date.now());
          }
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
      setInfoSnackCustom({
        type: 'error',
        message:
          error?.message ||
          t('core:message.error.fetch_app', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
    }
  };
  return {
    openApp,
    status,
  };
};
