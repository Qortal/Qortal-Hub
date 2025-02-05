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
          body: decryptedData,
        });
        const previewPath = await response.text();
        setOpenSnackGlobal(false);
        const refreshfunc = async (tabId) => {
          executeEvent("refreshApp", {
            tabId: tabId,
          });
        };

        executeEvent("addTab", {
          data: {
            url: await createEndpoint(previewPath),
            isPreview: true,
            isPrivate: true,
            privateAppProperties: { ...privateAppProperties },
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
                privateAppProperties: { ...privateAppProperties },
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
