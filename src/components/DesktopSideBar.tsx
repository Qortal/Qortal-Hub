import { Box, ButtonBase } from "@mui/material";
import React from "react";
import { HomeIcon } from "../assets/Icons/HomeIcon";
import { MessagingIcon } from "../assets/Icons/MessagingIcon";
import { Save } from "./Save/Save";
import { HubsIcon } from "../assets/Icons/HubsIcon";
import { CoreSyncStatus } from "./CoreSyncStatus";
import { IconWrapper } from "./Desktop/DesktopFooter";
import AppIcon from "./../assets/svgs/AppIcon.svg";
import { useRecoilState } from "recoil";
import { enabledDevModeAtom } from "../atoms/global";
import { AppsIcon } from "../assets/Icons/AppsIcon";
import ThemeSelector from "./Theme/ThemeSelector";

export const DesktopSideBar = ({
  goToHome,
  setDesktopSideView,
  toggleSideViewDirects,
  hasUnreadDirects,
  isDirects,
  toggleSideViewGroups,
  hasUnreadGroups,
  isGroups,
  isApps,
  setDesktopViewMode,
  desktopViewMode,
  myName,
}) => {
  const [isEnabledDevMode, setIsEnabledDevMode] =
    useRecoilState(enabledDevModeAtom);
  
  const theme = useTheme();

  return (
    <Box
      sx={{
        width: "60px",
        flexDirection: "column",
        height: "100vh",
        alignItems: "center",
        display: "flex",
        gap: "25px",
      }}
    >
      <ButtonBase
        sx={{
          width: "60px",
          height: "60px",
          paddingTop: "23px",
        }}
        onClick={() => {
          goToHome();
        }}
      >
        <HomeIcon
          height={34}
<<<<<<< HEAD
=======
          color={
            desktopViewMode === "home" ? "white" : "rgba(250, 250, 250, 0.5)"
          }
>>>>>>> b721248 (Add themeSelector component)
        />
      </ButtonBase>
      <ButtonBase
        onClick={() => {
          setDesktopViewMode("apps");
          // setIsOpenSideViewDirects(false)
          // setIsOpenSideViewGroups(false)
        }}
      >
        <IconWrapper
<<<<<<< HEAD
=======
          color={isApps ? "white" : "rgba(250, 250, 250, 0.5)"}
>>>>>>> b721248 (Add themeSelector component)
          label="Apps"
          selected={isApps}
          disableWidth
        >
          <AppsIcon
<<<<<<< HEAD
=======
            color={isApps ? "white" : "rgba(250, 250, 250, 0.5)"}
>>>>>>> b721248 (Add themeSelector component)
            height={30}
          />
        </IconWrapper>
      </ButtonBase>
<<<<<<< HEAD

=======
>>>>>>> b721248 (Add themeSelector component)
      <ButtonBase
        onClick={() => {
          setDesktopViewMode("chat");
        }}
      >
        <IconWrapper
          color={
            hasUnreadDirects || hasUnreadGroups
              ? "var(--unread)"
<<<<<<< HEAD
              : theme.palette.text.primary
=======
              : desktopViewMode === "chat"
              ? "white"
              : "rgba(250, 250, 250, 0.5)"
>>>>>>> b721248 (Add themeSelector component)
          }
          label="Chat"
          disableWidth
        >
          <MessagingIcon
            height={30}
            color={
              hasUnreadDirects || hasUnreadGroups
                ? "var(--unread)"
<<<<<<< HEAD
                : theme.palette.text.primary
=======
                : desktopViewMode === "chat"
                ? "white"
                : "rgba(250, 250, 250, 0.5)"
>>>>>>> b721248 (Add themeSelector component)
            }
          />
        </IconWrapper>
      </ButtonBase>
      {/* <ButtonBase
          onClick={() => {
            setDesktopSideView("groups");
            toggleSideViewGroups()
          }}
        >
            <HubsIcon
              height={30}
              color={
                hasUnreadGroups
                  ? "var(--danger)"
                  : isGroups
                  ? "white"
                  : "rgba(250, 250, 250, 0.5)"
              }
            />
     
        </ButtonBase> */}
      <Save isDesktop disableWidth myName={myName} />
      {/* <CoreSyncStatus imageSize="30px" position="left" /> */}
      {isEnabledDevMode && (
        <ButtonBase
          onClick={() => {
            setDesktopViewMode("dev");
          }}
        >
          <IconWrapper
<<<<<<< HEAD
=======
            color={
              desktopViewMode === "dev" ? "white" : "rgba(250, 250, 250, 0.5)"
            }
>>>>>>> b721248 (Add themeSelector component)
            label="Dev"
            disableWidth
          >
            <AppsIcon
<<<<<<< HEAD
=======
              color={
                desktopViewMode === "dev" ? "white" : "rgba(250, 250, 250, 0.5)"
              }
>>>>>>> b721248 (Add themeSelector component)
              height={30}
            />
          </IconWrapper>
        </ButtonBase>
      )}

      <ThemeSelector style={{ position: "fixed", bottom: "1%" }} />
    </Box>
  );
};
