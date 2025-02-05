import React, { useContext, useState } from "react";
import { executeEvent } from "../../utils/events";
import { getBaseApiReact, MyContext } from "../../App";
import { createEndpoint } from "../../background";
import { useRecoilState, useSetRecoilState } from "recoil";
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from "../../atoms/global";
import { saveToLocalStorage } from "./AppsNavBarDesktop";
import { base64ToBlobUrl } from "../../utils/fileReading";
import { base64ToUint8Array } from "../../qdn/encryption/group-encryption";
import { uint8ArrayToObject } from "../../backgroundFunctions/encryption";

export const useHandlePrivateApps = () => {
  const [status, setStatus] = useState("");
  const {
    openSnackGlobal,
    setOpenSnackGlobal,
    infoSnackCustom,
    setInfoSnackCustom,
  } = useContext(MyContext);
  const [sortablePinnedApps, setSortablePinnedApps] = useRecoilState(
    sortablePinnedAppsAtom
  );
  const setSettingsLocalLastUpdated = useSetRecoilState(
    settingsLocalLastUpdatedAtom
  );
  const openApp = async (privateAppProperties, addToPinnedApps) => {
    try {
      setOpenSnackGlobal(true);

      setInfoSnackCustom({
        type: "info",
        message: "Fetching app data",
      });
      const urlData = `${getBaseApiReact()}/arbitrary/${
        privateAppProperties?.service
      }/${privateAppProperties?.name}/${
        privateAppProperties?.identifier
      }?encoding=base64`;

      const responseData = await fetch(urlData, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const data = await responseData.text();

      setInfoSnackCustom({
        type: "info",
        message: "Decrypting app",
      });
      const decryptedData = await window.sendMessage(
        "DECRYPT_QORTAL_GROUP_DATA",

        {
          base64: data,
          groupId: privateAppProperties?.groupId,
        }
      );
      if(decryptedData?.error) throw new Error(decryptedData?.error)
        
        const convertToUint = base64ToUint8Array(decryptedData)
        const UintToObject = uint8ArrayToObject(convertToUint)
        
      if (decryptedData) {
        setInfoSnackCustom({
          type: "info",
          message: "Building app",
        });
        const endpoint = await createEndpoint(
          `/arbitrary/APP/${privateAppProperties?.name}/zip?preview=true`
        );
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
          },
          body: UintToObject?.app,
        });
        const previewPath = await response.text();
        setOpenSnackGlobal(false);
        const refreshfunc = async (tabId) => {
          executeEvent("refreshApp", {
            tabId: tabId,
          });
        };

        const appName = UintToObject?.name
        const logo = UintToObject?.logo ? `data:image/png;base64,${UintToObject?.logo}` : null

        executeEvent("addTab", {
          data: {
            url: await createEndpoint(previewPath),
            isPreview: true,
            isPrivate: true,
            privateAppProperties: { ...privateAppProperties, logo, appName  },
            filePath: "",
            refreshFunc: (tabId) => {
              refreshfunc(tabId);
            },
          },
        });

        if (addToPinnedApps) {
          setSortablePinnedApps((prev) => {
            const updatedApps = [
              ...prev,
              {
                isPrivate: true,
                isPreview: true,
                privateAppProperties: { ...privateAppProperties, logo, appName },
              },
            ];

            saveToLocalStorage(
              "ext_saved_settings",
              "sortablePinnedApps",
              updatedApps
            );
            return updatedApps;
          });
          setSettingsLocalLastUpdated(Date.now());
        }
      }
    } catch (error) {
      setInfoSnackCustom({
        type: "error",
        message: error?.message || "Unable to access app",
      });
    }
  };
  return {
    openApp,
    status,
  };
};
