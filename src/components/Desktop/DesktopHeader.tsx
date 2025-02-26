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
import { HomeIcon } from "../../assets/Icons/HomeIcon";
import { NotificationIcon2 } from "../../assets/Icons/NotificationIcon2";
import { ChatIcon } from "../../assets/Icons/ChatIcon";
import { ThreadsIcon } from "../../assets/Icons/ThreadsIcon";
import { MembersIcon } from "../../assets/Icons/MembersIcon";
import { AdminsIcon } from "../../assets/Icons/AdminsIcon";
import LockIcon from '@mui/icons-material/Lock';
import NoEncryptionGmailerrorredIcon from '@mui/icons-material/NoEncryptionGmailerrorred';

const IconWrapper = ({ children, label, color, selected, selectColor, customHeight }) => {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: "5px",
        flexDirection: "column",
        height: customHeight ? customHeight : "65px",
        width: customHeight ? customHeight :  "65px",
        borderRadius: "50%",
        backgroundColor: selected ? selectColor || "rgba(28, 29, 32, 1)" : "transparent",
      }}
    >
      {children}
      <Typography
        sx={{
          fontFamily: "Inter",
          fontSize: "10px",
          fontWeight: 500,
          color: color,
        }}
      >
        {label}
      </Typography>
    </Box>
  );
};

export const DesktopHeader = ({
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
  hasUnreadAnnouncements,
  isAnnouncement,
  hasUnreadChat,
  isChat,
  isForum,
  setGroupSection,
  isPrivate
}) => {
  const [value, setValue] = React.useState(0);
  return (
    <Box
      sx={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        height: "70px", // Footer height
        zIndex: 1,
        justifyContent: "space-between",
        padding: "10px",
      }}
    >
      <Box sx={{
        display: 'flex',
        gap: '10px'
      }}>
        {isPrivate && (
          <LockIcon sx={{
            color: 'var(--green)'
          }} />
        )}
        {isPrivate === false && (
          <NoEncryptionGmailerrorredIcon sx={{
            color: 'var(--danger)'
          }} />
        )}
        <Typography
          sx={{
            fontSize: "16px",
            fontWeight: 600,
          }}
        >
          {selectedGroup?.groupId === '0' ? 'General' :selectedGroup?.groupName}
        </Typography>
      </Box>
      <Box
        sx={{
          display: "flex",
          gap: "20px",
          alignItems: "center",
          visibility: selectedGroup?.groupId === '0' ? 'hidden' : 'visibile'
        }}
      >
      
        <ButtonBase
          onClick={() => {
            goToAnnouncements()
          }}
        >
          <IconWrapper
            color={isAnnouncement ? "black" :"rgba(250, 250, 250, 0.5)"}
            label="ANN"
            selected={isAnnouncement}
            selectColor="#09b6e8"
            customHeight="55px"
          >
            <NotificationIcon2
              height={25}
              width={20}
              color={
                isUnread
                  ? "var(--unread)"
                  : isAnnouncement
                  ? "black"
                  : "rgba(250, 250, 250, 0.5)"
              }
            />
          </IconWrapper>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            goToChat()
          }}
        >
          <IconWrapper
            color={isChat ? "black" :"rgba(250, 250, 250, 0.5)"}
            label="Chat"
            selected={isChat}
            selectColor="#09b6e8"
            customHeight="55px"
          >
            <ChatIcon
              height={25}
              width={20}
              color={
                isUnreadChat
                  ? "var(--unread)"
                  : isChat
                  ? "black"
                  : "rgba(250, 250, 250, 0.5)"
              }
            />
          </IconWrapper>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setGroupSection("forum");
          
          }}
        >
          <IconWrapper
            color={isForum ? 'black' : "rgba(250, 250, 250, 0.5)"}
            label="Threads"
            selected={isForum}
            selectColor="#09b6e8"
            customHeight="55px"
          >
            <ThreadsIcon
              height={25}
              width={20}
              color={
                isForum
                  ? "black"
                  : "rgba(250, 250, 250, 0.5)"
              }
            />
          </IconWrapper>
        </ButtonBase>
        <ButtonBase
          onClick={() => {
            setOpenManageMembers(true)
          
          }}
        >
          <IconWrapper
            color="rgba(250, 250, 250, 0.5)"
            label="Members"
            selected={false}
            customHeight="55px"
          >
            <MembersIcon
              height={25}
              width={20}
              color={
                isForum
                  ? "white"
                  : "rgba(250, 250, 250, 0.5)"
              }
            />
          </IconWrapper>
        </ButtonBase>
        <ButtonBase
          onClick={() => {
            setGroupSection("adminSpace");
          
          }}
        >
          <IconWrapper
            color={groupSection === 'adminSpace' ? 'black' : "rgba(250, 250, 250, 0.5)"}
            label="Admins"
            selected={groupSection === 'adminSpace'}
            customHeight="55px"
            selectColor="#09b6e8"
          >
            <AdminsIcon
              height={25}
              width={20}
              color={
                groupSection === 'adminSpace'
                  ? "black"
                  : "rgba(250, 250, 250, 0.5)"
              }
            />
          </IconWrapper>
        </ButtonBase>
      </Box>
    </Box>
  );
};
