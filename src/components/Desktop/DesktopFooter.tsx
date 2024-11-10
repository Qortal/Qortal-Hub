import * as React from "react";
import {
  BottomNavigation,
  BottomNavigationAction,
  ButtonBase,
  Typography,
} from "@mui/material";
import { Home, Groups, Message, ShowChart } from "@mui/icons-material";
import Box from "@mui/material/Box";
import BottomLogo from "../../assets/svgs/BottomLogo5.svg";
import { CustomSvg } from "../../common/CustomSvg";
import { WalletIcon } from "../../assets/Icons/WalletIcon";
import { HubsIcon } from "../../assets/Icons/HubsIcon";
import { TradingIcon } from "../../assets/Icons/TradingIcon";
import { MessagingIcon } from "../../assets/Icons/MessagingIcon";
import AppIcon from "../../assets/svgs/AppIcon.svg";

import { HomeIcon } from "../../assets/Icons/HomeIcon";
import { Save } from "../Save/Save";
import { useRecoilState } from "recoil";
import { enabledDevModeAtom } from "../../atoms/global";

export const IconWrapper = ({ children, label, color, selected, disableWidth }) => {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap:  "5px",
        flexDirection: "column",
        height: disableWidth ? 'auto' :  "89px",
        width: disableWidth ? 'auto' : "89px",
        borderRadius: "50%",
        backgroundColor: selected ? "rgba(28, 29, 32, 1)" : "transparent",
      }}
    >
      {children}
      <Typography
        sx={{
          fontFamily: "Inter",
          fontSize: "12px",
          fontWeight: 500,
          color: color,
        }}
      >
        {label}
      </Typography>
    </Box>
  );
};

export const DesktopFooter = ({
  selectedGroup,
  groupSection,
  isUnread,
  goToAnnouncements,
  isUnreadChat,
  goToChat,
  goToThreads,
  setOpenManageMembers,
  groupChatHasUnread,
  groupsAnnHasUnread,
  directChatHasUnread,
  chatMode,
  openDrawerGroups,
  goToHome,
  setIsOpenDrawerProfile,
  mobileViewMode,
  setMobileViewMode,
  setMobileViewModeKeepOpen,
  hasUnreadGroups,
  hasUnreadDirects,
  isHome,
  isGroups,
  isDirects,
  setDesktopSideView,
  isApps,
  setDesktopViewMode,
  desktopViewMode,
  hide,
  setIsOpenSideViewDirects,
  setIsOpenSideViewGroups
  
}) => {
  const [isEnabledDevMode, setIsEnabledDevMode] =  useRecoilState(enabledDevModeAtom)

  if(hide) return
  return (
    <Box
      sx={{
        width: "100%",
        position: "absolute",
        bottom: 0,
        display: "flex",
        alignItems: "center",
        height: "100px", // Footer height
        zIndex: 1,
        justifyContent: "center",
      }}
    >
      <Box
        sx={{
          display: "flex",
          gap: "20px",
        }}
      >
        <ButtonBase
          onClick={() => {
            goToHome();
          }}
        >
          <IconWrapper
            color="rgba(250, 250, 250, 0.5)"
            label="Home"
            selected={isHome}
          >
            <HomeIcon
              height={30}
              color={isHome ? "white" : "rgba(250, 250, 250, 0.5)"}
            />
          </IconWrapper>
        </ButtonBase>
        <ButtonBase
          onClick={() => {
            setDesktopViewMode('apps')
            setIsOpenSideViewDirects(false)
            setIsOpenSideViewGroups(false)
          }}
        >
          <IconWrapper
            color="rgba(250, 250, 250, 0.5)"
            label="Apps"
            selected={isApps}
          >
          <img src={AppIcon} />
          </IconWrapper>
        </ButtonBase>
        <ButtonBase
          onClick={() => {
            setDesktopSideView("groups");
          }}
        >
          <IconWrapper
            color="rgba(250, 250, 250, 0.5)"
            label="Groups"
            selected={isGroups}
          >
            <HubsIcon
              height={30}
              color={
                hasUnreadGroups
                  ? "var(--unread)"
                  : isGroups
                  ? "white"
                  : "rgba(250, 250, 250, 0.5)"
              }
            />
          </IconWrapper>
        </ButtonBase>
        <ButtonBase
          onClick={() => {
            setDesktopSideView("directs");
          }}
        >
          <IconWrapper
            color="rgba(250, 250, 250, 0.5)"
            label="Messaging"
            selected={isDirects}
          >
            <MessagingIcon
              height={30}
              color={
                hasUnreadDirects
                  ? "var(--unread)"
                  : isDirects
                  ? "white"
                  : "rgba(250, 250, 250, 0.5)"
              }
            />
          </IconWrapper>
        </ButtonBase>
        
        <Save isDesktop />
        {isEnabledDevMode && (
          <ButtonBase
          onClick={() => {
            setDesktopViewMode('dev')
            setIsOpenSideViewDirects(false)
            setIsOpenSideViewGroups(false)
          }}
        >
          <IconWrapper
            color="rgba(250, 250, 250, 0.5)"
            label="Dev Mode"
            selected={isApps}
          >
          <img src={AppIcon} />
          </IconWrapper>
        </ButtonBase>
        )}
        
      </Box>
    </Box>
  );
};
