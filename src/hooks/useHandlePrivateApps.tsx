import { useContext, useState } from 'react';
import { executeEvent } from '../utils/events';
import { getBaseApiReact, MyContext } from '../App';
import { createEndpoint } from '../background';
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../atoms/global';
import { saveToLocalStorage } from '../components/Apps/AppsNavBarDesktop';
import { base64ToUint8Array } from '../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../backgroundFunctions/encryption';
import { useSetAtom } from 'jotai';

export const useHandlePrivateApps = () => {
  const [status, setStatus] = useState('');
  const {
    openSnackGlobal,
    setOpenSnackGlobal,
    infoSnackCustom,
    setInfoSnackCustom,
  } = useContext(MyContext);
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);

  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);

  const openApp = async (
    privateAppProperties,
    addToPinnedApps,
    setLoadingStatePrivateApp
  ) => {
    try {
      if (setLoadingStatePrivateApp) {
        setLoadingStatePrivateApp(`Downloading and decrypting private app.`);
      }
      setOpenSnackGlobal(true);

      setInfoSnackCustom({
        type: 'info',
        message: 'Fetching app data',
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
            setLoadingStatePrivateApp('Error! Unable to download private app.');
          }

          throw new Error('Unable to fetch app');
        }

        data = await responseData.text();
        if (data?.error) {
          if (setLoadingStatePrivateApp) {
            setLoadingStatePrivateApp('Error! Unable to download private app.');
          }
          throw new Error('Unable to fetch app');
        }
      } catch (error) {
        if (setLoadingStatePrivateApp) {
          setLoadingStatePrivateApp('Error! Unable to download private app.');
        }
        throw error;
      }

      let decryptedData;
      // eslint-disable-next-line no-useless-catch
      try {
        decryptedData = await window.sendMessage(
          'DECRYPT_QORTAL_GROUP_DATA',

          {
            base64: data,
            groupId: privateAppProperties?.groupId,
          }
        );
        if (decryptedData?.error) {
          if (setLoadingStatePrivateApp) {
            setLoadingStatePrivateApp('Error! Unable to decrypt private app.');
          }
          throw new Error(decryptedData?.error);
        }
      } catch (error) {
        if (setLoadingStatePrivateApp) {
          setLoadingStatePrivateApp('Error! Unable to decrypt private app.');
        }
        throw error;
      }

      try {
        const convertToUint = base64ToUint8Array(decryptedData);
        const UintToObject = uint8ArrayToObject(convertToUint);

        if (decryptedData) {
          setInfoSnackCustom({
            type: 'info',
            message: 'Building app',
          });
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
          const previewPath = await response.text();
          const refreshfunc = async (tabId, privateAppProperties) => {
            const checkIfPreviewLinkStillWorksUrl = await createEndpoint(
              `/render/hash/HmtnZpcRPwisMfprUXuBp27N2xtv5cDiQjqGZo8tbZS?secret=E39WTiG4qBq3MFcMPeRZabtQuzyfHg9ZuR5SgY7nW1YH`
            );
            const res = await fetch(checkIfPreviewLinkStillWorksUrl);
            if (res.ok) {
              executeEvent('refreshApp', {
                tabId: tabId,
              });
            } else {
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
              const previewPath = await response.text();
              executeEvent('updateAppUrl', {
                tabId: tabId,
                url: await createEndpoint(previewPath),
              });

              setTimeout(() => {
                executeEvent('refreshApp', {
                  tabId: tabId,
                });
              }, 300);
            }
          };

          const appName = UintToObject?.name;
          const logo = UintToObject?.logo
            ? `data:image/png;base64,${UintToObject?.logo}`
            : null;

          const dataBody = {
            url: await createEndpoint(previewPath),
            isPreview: true,
            isPrivate: true,
            privateAppProperties: { ...privateAppProperties, logo, appName },
            filePath: '',
            refreshFunc: (tabId) => {
              refreshfunc(tabId, privateAppProperties);
            },
          };
          executeEvent('addTab', {
            data: dataBody,
          });
          setInfoSnackCustom({
            type: 'success',
            message: 'Opened',
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
            `Error! ${error?.message || 'Unable to build private app.'}`
          );
        }
        throw error;
      }
    } catch (error) {
      setInfoSnackCustom({
        type: 'error',
        message: error?.message || 'Unable to fetch app',
      });
    }
  };
  return {
    openApp,
    status,
  };
};
