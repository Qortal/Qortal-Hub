import { Box, ButtonBase } from '@mui/material';
import React from 'react'
import { HomeIcon } from "../assets/Icons/HomeIcon";
import { MessagingIcon } from "../assets/Icons/MessagingIcon";
import { Save } from "./Save/Save";
import { HubsIcon } from "../assets/Icons/HubsIcon";
import { CoreSyncStatus } from "./CoreSyncStatus";
import { IconWrapper } from './Desktop/DesktopFooter';
import AppIcon from "./../assets/svgs/AppIcon.svg";
import { useRecoilState } from 'recoil';
import { enabledDevModeAtom } from '../atoms/global';
import { AppsIcon } from '../assets/Icons/AppsIcon';

export const DesktopSideBar = ({goToHome, setDesktopSideView, toggleSideViewDirects, hasUnreadDirects, isDirects, toggleSideViewGroups,hasUnreadGroups, isGroups, isApps, setDesktopViewMode, desktopViewMode, myName }) => {
    const [isEnabledDevMode, setIsEnabledDevMode] =  useRecoilState(enabledDevModeAtom)

  return (
    <Box sx={{
        width: '60px',
        flexDirection: 'column',
        height: '100vh',
        alignItems: 'center',
        display: 'flex',
        gap: '25px'
       }}>
        <ButtonBase
          sx={{
            width: '60px',
            height: '60px',
            paddingTop: '23px'
          }}
          onClick={() => {
            goToHome();

          }}
        >
            
            <HomeIcon
              height={34}
              color={desktopViewMode === 'home' ? 'white': "rgba(250, 250, 250, 0.5)"}

            />
        
        </ButtonBase>
        <ButtonBase
          onClick={() => {
            setDesktopViewMode('apps')
            // setIsOpenSideViewDirects(false)
            // setIsOpenSideViewGroups(false)
          }}
        >
          <IconWrapper
            color={isApps ? 'white' : "rgba(250, 250, 250, 0.5)"}
            label="Apps"
            selected={isApps}
            disableWidth
          >
            <AppsIcon color={isApps ? 'white' : "rgba(250, 250, 250, 0.5)"} height={30} />
          </IconWrapper>
        </ButtonBase>
        <ButtonBase
          onClick={() => {
            setDesktopViewMode('chat')
          }}
        >
        <IconWrapper
            color={(hasUnreadDirects || hasUnreadGroups) ? "var(--unread)" : desktopViewMode === 'chat' ? 'white' :"rgba(250, 250, 250, 0.5)"}
            label="Chat"
            disableWidth
          >
            <MessagingIcon
              height={30}
              color={
                (hasUnreadDirects || hasUnreadGroups)
                  ? "var(--unread)"
                  : desktopViewMode === 'chat'
                  ? "white"
                  : "rgba(250, 250, 250, 0.5)"
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
                  ? "var(--unread)"
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
            setDesktopViewMode('dev')
          }}
        >
          <IconWrapper
            color={desktopViewMode === 'dev' ? 'white' : "rgba(250, 250, 250, 0.5)"}
            label="Dev"
            disableWidth
          >
           <AppsIcon color={desktopViewMode === 'dev' ? 'white' : "rgba(250, 250, 250, 0.5)"} height={30} />
          </IconWrapper>
        </ButtonBase>
        )}
       </Box>
  )
}
