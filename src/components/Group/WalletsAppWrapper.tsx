import { Box, ButtonBase, Divider, Typography } from "@mui/material";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CloseIcon from "@mui/icons-material/Close";
import AppViewerContainer from "../Apps/AppViewerContainer";
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from "../../utils/events";
import { useRecoilState } from "recoil";
import { navigationControllerAtom } from "../../atoms/global";
import { AppsNavBarLeft, AppsNavBarParent } from "../Apps/Apps-styles";
import NavBack from "../../assets/svgs/NavBack.svg";
import RefreshIcon from "@mui/icons-material/Refresh";

export const WalletsAppWrapper = () => {
  const iframeRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [navigationController, setNavigationController] = useRecoilState(
    navigationControllerAtom
  );
  const [selectedTab, setSelectedTab] = useState({
    tabId: "5558589",
    name: "Q-Wallets",
    service: "APP",
    path: 'qortal?authOnMount=true'
  });

  const isDisableBackButton = useMemo(() => {
    if (selectedTab && navigationController[selectedTab?.tabId]?.hasBack)
      return false;
    if (selectedTab && !navigationController[selectedTab?.tabId]?.hasBack)
      return true;
    return false;
  }, [navigationController, selectedTab]);

  const openWalletsAppFunc = useCallback(
    (e) => {
      setIsOpen(true);
    },
    [setIsOpen]
  );

  useEffect(() => {
    subscribeToEvent("openWalletsApp", openWalletsAppFunc);

    return () => {
      unsubscribeFromEvent("openWalletsApp", openWalletsAppFunc);
    };
  }, [openWalletsAppFunc]);

  const handleClose = ()=> {
    setIsOpen(false);
    iframeRef.current = null
  }

  return (
    <>
      {isOpen && (
        <Box
          sx={{
            position: "fixed",
            height: "100vh",
            width: "100vw",
            backgroundColor: "#27282c",
            zIndex: 100,
            bottom: 0,
            right: 0,
            overflow: "hidden",
            borderTopLeftRadius: "10px",
            borderTopRightRadius: "10px",
            boxShadow: 4,
          }}
        >
          <Box
            sx={{
              height: "100%",
              width: "100%",
            }}
          >
            <Box
              sx={{
                height: "40px",
                display: "flex",
                alignItems: "center",
                padding: "5px",

                justifyContent: "space-between",
              }}
            >
              <Typography>Q-Wallets</Typography>
              <ButtonBase
                onClick={handleClose}
              >
                <CloseIcon
                  sx={{
                    color: "white",
                  }}
                />
              </ButtonBase>
            </Box>
            <Divider />
            <AppViewerContainer
              customHeight="calc(100% - 40px - 60px)"
              app={selectedTab}
              isSelected
              ref={iframeRef}
              skipAuth={true}
            />
            <AppsNavBarParent>
              <AppsNavBarLeft sx={{
                gap: '25px'
              }}>
                <ButtonBase
                  onClick={() => {
                    executeEvent(`navigateBackApp-${selectedTab?.tabId}`, {});
                  }}
                  disabled={isDisableBackButton}
                  sx={{
                    opacity: !isDisableBackButton ? 1 : 0.1,
                    cursor: !isDisableBackButton ? "pointer" : "default",
                  }}
                >
                  <img src={NavBack} />
                </ButtonBase>
                <ButtonBase  onClick={() => {
            if (selectedTab?.refreshFunc) {
              selectedTab.refreshFunc(selectedTab?.tabId);
            
            } else {
              executeEvent("refreshApp", {
                tabId: selectedTab?.tabId,
              });
            }
            
            
          }}>
                <RefreshIcon
              height={20}
              sx={{
                color: "rgba(250, 250, 250, 0.5)",
                height: '30px',
                width: 'auto'
              }}
            />
                </ButtonBase>
              </AppsNavBarLeft>
            </AppsNavBarParent>
          </Box>
        </Box>
      )}
    </>
  );
};
