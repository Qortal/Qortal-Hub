import React, { useContext, useMemo, useState } from "react";
import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  AppLibrarySubTitle,
  AppsContainer,
  AppsParent,
} from "./Apps-styles";
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Input,
} from "@mui/material";
import { Add } from "@mui/icons-material";
import { MyContext, getBaseApiReact, isMobile } from "../../App";
import LogoSelected from "../../assets/svgs/LogoSelected.svg";
import { executeEvent } from "../../utils/events";
import { Spacer } from "../../common/Spacer";
import { AppsDevModeSortablePinnedApps } from "./AppsDevModeSortablePinnedApps";
import { useModal } from "../../common/useModal";
import { isUsingLocal } from "../../background";
import { Label } from "../Group/AddGroup";

export const AppsDevModeHome = ({
  setMode,
  myApp,
  myWebsite,
  availableQapps,
}) => {

    const [domain, setDomain] = useState("");
    const [port, setPort] = useState("");
    const { isShow, onCancel, onOk, show, message } = useModal();
    const {
      openSnackGlobal,
      setOpenSnackGlobal,
      infoSnackCustom,
      setInfoSnackCustom,
    } = useContext(MyContext);

    const addDevModeApp = async () => {
      try {
        const usingLocal = await isUsingLocal();
        if (!usingLocal) {
          setOpenSnackGlobal(true);

          setInfoSnackCustom({
            type: "error",
            message:
              "Please use your local node for dev mode! Logout and use Local node.",
          });
          return;
        }
        const {portVal, domainVal} = await show({
          message: "",
          publishFee: "",
        });
        const framework = domainVal + ":" + portVal;
        const response = await fetch(
          `${getBaseApiReact()}/developer/proxy/start`,
          {
            method: "POST",
            headers: {
              "Content-Type": "text/plain",
            },
            body: framework,
          }
        );
        const responseData = await response.text();
        executeEvent("appsDevModeAddTab", {
          data: {
            url: "http://127.0.0.1:" + responseData,
          },
        });
      } catch (error) {}
    };
  
  return (
    <>
      <AppsContainer
        sx={{
          justifyContent: "flex-start",
        }}
      >
        <AppLibrarySubTitle
          sx={{
            fontSize: "30px",
          }}
        >
          Dev Mode Apps
        </AppLibrarySubTitle>
      </AppsContainer>
      <Spacer height="45px" />
      <AppsContainer
        sx={{
          gap: "75px",
          justifyContent: "flex-start",
        }}
      >
        <ButtonBase
          onClick={() => {
            addDevModeApp();
          }}
        >
          <AppCircleContainer
            sx={{
              gap: !isMobile ? "10px" : "5px",
            }}
          >
            <AppCircle>
              <Add>+</Add>
            </AppCircle>
            <AppCircleLabel>App</AppCircleLabel>
          </AppCircleContainer>
        </ButtonBase>
      </AppsContainer>
      {isShow && (
        <Dialog
          open={isShow}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
        >
          <DialogTitle id="alert-dialog-title">
            {"Add custom framework"}
          </DialogTitle>
          <DialogContent>
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "5px",
              }}
            >
              <Label>Domain</Label>
              <Input
                placeholder="Domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </Box>
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "5px",
                marginTop: '15px'
              }}
            >
              <Label>Port</Label>

              <Input
                placeholder="Port"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={onCancel}>
              Close
            </Button>
            <Button
              disabled={!domain || !port}
              variant="contained"
              onClick={()=> onOk({portVal: port, domainVal: domain})}
              autoFocus
            >
              Add
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
};
