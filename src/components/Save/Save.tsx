import React, { useContext, useEffect, useMemo, useState } from "react";
import { useRecoilState, useSetRecoilState } from "recoil";
import isEqual from "lodash/isEqual"; // Import deep comparison utility
import {
  canSaveSettingToQdnAtom,
  hasSettingsChangedAtom,
  oldPinnedAppsAtom,
  settingsLocalLastUpdatedAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from "../../atoms/global";
import { ButtonBase } from "@mui/material";
import { objectToBase64 } from "../../qdn/encryption/group-encryption";
import { MyContext } from "../../App";
import { getFee } from "../../background";
import { CustomizedSnackbars } from "../Snackbar/Snackbar";
import { SaveIcon } from "../../assets/svgs/SaveIcon";
import { IconWrapper } from "../Desktop/DesktopFooter";
export const Save = ({ isDesktop, disableWidth }) => {
  const [pinnedApps, setPinnedApps] = useRecoilState(sortablePinnedAppsAtom);
  const [settingsQdnLastUpdated, setSettingsQdnLastUpdated] = useRecoilState(
    settingsQDNLastUpdatedAtom
  );
  const [settingsLocalLastUpdated] = useRecoilState(
    settingsLocalLastUpdatedAtom
  );
  const setHasSettingsChangedAtom = useSetRecoilState(hasSettingsChangedAtom);

  const [canSave] = useRecoilState(canSaveSettingToQdnAtom);
  const [openSnack, setOpenSnack] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [oldPinnedApps, setOldPinnedApps] = useRecoilState(oldPinnedAppsAtom);

  const { show } = useContext(MyContext);

  const hasChanged = useMemo(() => {
    const newChanges = {
      sortablePinnedApps: pinnedApps.map((item) => {
        return {
          name: item?.name,
          service: item?.service,
        };
      }),
    };
    const oldChanges = {
      sortablePinnedApps: oldPinnedApps.map((item) => {
        return {
          name: item?.name,
          service: item?.service,
        };
      }),
    };
    if (settingsQdnLastUpdated === -100) return false;
    return (
      !isEqual(oldChanges, newChanges) &&
      settingsQdnLastUpdated < settingsLocalLastUpdated
    );
  }, [
    oldPinnedApps,
    pinnedApps,
    settingsQdnLastUpdated,
    settingsLocalLastUpdated,
  ]);

  useEffect(() => {
    setHasSettingsChangedAtom(hasChanged);
  }, [hasChanged]);

  const saveToQdn = async () => {
    try {
      setIsLoading(true);
      const data64 = await objectToBase64({
        sortablePinnedApps: pinnedApps.map((item) => {
          return {
            name: item?.name,
            service: item?.service,
          };
        }),
      });
      const encryptData = await new Promise((res, rej) => {
        window
          .sendMessage(
            "ENCRYPT_DATA",
            {
            
                data64,
         
            },
            60000
          )
          .then((response) => {
            if (response.error) {
              rej(response?.message);
              return;
            } else {
              res(response);
            }
          })
          .catch((error) => {
            console.error("Failed qortalRequest", error);
          });
      });
      if (encryptData && !encryptData?.error) {
        const fee = await getFee("ARBITRARY");

        await show({
          message:
            "Would you like to publish your settings to QDN (encrypted) ?",
          publishFee: fee.fee + " QORT",
        });
        const response = await new Promise((res, rej) => {
          window
            .sendMessage("publishOnQDN", {
              data: encryptData,
              identifier: "ext_saved_settings",
              service: "DOCUMENT_PRIVATE",
            })
            .then((response) => {
              if (!response?.error) {
                res(response);
                return;
              }
              rej(response.error);
            })
            .catch((error) => {
              rej(error.message || "An error occurred");
            });
        });
        if (response?.identifier) {
          setOldPinnedApps(pinnedApps);
          setSettingsQdnLastUpdated(Date.now());
          setInfoSnack({
            type: "success",
            message: "Sucessfully published to QDN",
          });
          setOpenSnack(true);
        }
      }
    } catch (error) {
      setInfoSnack({
        type: "error",
        message: error?.message || "Unable to save to QDN",
      });
      setOpenSnack(true);
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <>
      <ButtonBase
        onClick={saveToQdn}
        disabled={
          !hasChanged ||
          !canSave ||
          isLoading ||
          settingsQdnLastUpdated === -100
        }
      >
        {isDesktop ? (
          <IconWrapper
          disableWidth={disableWidth}
            color="rgba(250, 250, 250, 0.5)"
            label="Save"
            selected={false}
          >
            <SaveIcon
              color={
                settingsQdnLastUpdated === -100
                  ? "#8F8F91"
                  : hasChanged && !isLoading
                  ? "#5EB049"
                  : "#8F8F91"
              }
            />
          </IconWrapper>
        ) : (
          <SaveIcon
            color={
              settingsQdnLastUpdated === -100
                ? "#8F8F91"
                : hasChanged && !isLoading
                ? "#5EB049"
                : "#8F8F91"
            }
          />
        )}
      </ButtonBase>
      <CustomizedSnackbars
        duration={3500}
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </>
  );
};
