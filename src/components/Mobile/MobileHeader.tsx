import React, { useState } from "react";
import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Box,
  MenuItem,
  Select,
  ButtonBase,
  Menu,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import { HomeIcon } from "../../assets/Icons/HomeIcon";
import { LogoutIcon } from "../../assets/Icons/LogoutIcon";
import { NotificationIcon } from "../../assets/Icons/NotificationIcon";
import { ArrowDownIcon } from "../../assets/Icons/ArrowDownIcon";
import { MessagingIcon } from "../../assets/Icons/MessagingIcon";
import { MessagingIcon2 } from "../../assets/Icons/MessagingIcon2";
import { HubsIcon } from "../../assets/Icons/HubsIcon";
import { Save } from "../Save/Save";
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import { useRecoilState } from "recoil";
import { fullScreenAtom, hasSettingsChangedAtom } from "../../atoms/global";
import { useAppFullScreen } from "../../useAppFullscreen";

const Header = ({
  logoutFunc,
  goToHome,
  setIsOpenDrawerProfile,
  isThin,
  setMobileViewModeKeepOpen,
  hasUnreadGroups,
  hasUnreadDirects,
  setMobileViewMode,
  myName,
  setSelectedDirect,
  setNewChat
}) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);
  const [fullScreen, setFullScreen] = useRecoilState(fullScreenAtom);
  const {exitFullScreen} = useAppFullScreen(setFullScreen)
  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  if (isThin) {
    return (
      <AppBar
        position="static"
        sx={{
          backgroundColor: "background: rgba(0, 0, 0, 0.2)",
          boxShadow: "none",
        }}
      >
        <Toolbar
          sx={{
            justifyContent: "space-between",
            padding: "0 16px",
            height: "45px",
            minHeight: "45px",
          }}
        >
          {/* Left Home Icon */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "18px",
              width: "75px",
            }}
          >
            <ButtonBase
              
           
            
              onClick={() => {
                setMobileViewModeKeepOpen("");
                goToHome();
              }}
              // onClick={onHomeClick}
            >
              <HomeIcon height={20} width={27} color="rgba(145, 145, 147, 1)" />
            </ButtonBase>
            <ButtonBase
             
              onClick={handleClick}
            >
              <NotificationIcon height={20} width={21} color={hasUnreadDirects || hasUnreadGroups ? "var(--unread)" : "rgba(145, 145, 147, 1)"} />
            </ButtonBase>
            {fullScreen && (
               <ButtonBase onClick={()=> {
                exitFullScreen()
                setFullScreen(false)
               }}>
               <CloseFullscreenIcon sx={{
                 color: 'rgba(145, 145, 147, 1)'
               }} />
             </ButtonBase>
            )}
           
          </Box>

          {/* Center Title */}
          <Typography
            variant="h6"
            sx={{
              color: "rgba(255, 255, 255, 1)",
              fontWeight: 700,
              letterSpacing: "2px",
              fontSize: "13px",
            }}
          >
            QORTAL
          </Typography>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "18px",
              width: "75px",
              justifyContent: "flex-end",
            }}
          >
            {/* Right Logout Icon */}

            <ButtonBase
              onClick={() => {
                setMobileViewModeKeepOpen("messaging");
              }}
            >
              <MessagingIcon2    height={20}              color={hasUnreadDirects ? "var(--unread)" : "rgba(145, 145, 147, 1)"}
                
              />
            </ButtonBase>
            <Save />
            <ButtonBase
              onClick={logoutFunc}
            >
              <LogoutIcon
                height={20}
                width={21}
                color="rgba(145, 145, 147, 1)"
              />
            </ButtonBase>
          </Box>
        </Toolbar>
        <Menu
        id="home-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          "aria-labelledby": "basic-button",
        }}
        anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'center',

          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'center',
          }}
          slotProps={{
            paper: {
              sx: {
                backgroundColor: 'var(--bg-primary)',
                color: '#fff',
                width: '148px',
                borderRadius: '5px'
              },
            },
            
          }}
          sx={{
            marginTop: '10px'
          }}
      
      >
        <MenuItem
          onClick={() => {
            setSelectedDirect(null)
            setNewChat(false)
            setMobileViewMode("groups");
            setMobileViewModeKeepOpen("")
            handleClose();
          }}
        >
          <ListItemIcon sx={{
            
            minWidth: '24px !important'
          }}>
            <HubsIcon height={20} color={hasUnreadGroups ? "var(--unread)" :"rgba(250, 250, 250, 0.5)"} />
          </ListItemIcon>
          <ListItemText sx={{
                  "& .MuiTypography-root": {
                    fontSize: "12px",
                    fontWeight: 600,
                    color: hasUnreadGroups ? "var(--unread)" :"rgba(250, 250, 250, 0.5)"
                  },
                }} primary="Groups" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMobileViewModeKeepOpen("messaging");

            handleClose();
          }}
        >
          <ListItemIcon sx={{
            
            minWidth: '24px !important'
          }}>
          <MessagingIcon height={20} color={hasUnreadDirects ? "var(--unread)" :"rgba(250, 250, 250, 0.5)"} />
          </ListItemIcon>
          <ListItemText sx={{
                  "& .MuiTypography-root": {
                    fontSize: "12px",
                    fontWeight: 600,
                    color: hasUnreadDirects ? "var(--unread)" :"rgba(250, 250, 250, 0.5)"
                  },
                }} primary="Messaging" />
        </MenuItem>
       </Menu>
      </AppBar>
    );
  }
  return (
    <>
      {/* Main Header */}
      <AppBar
        position="static"
        sx={{ backgroundColor: "var(--bg-primary)", boxShadow: "none" }}
      >
        <Toolbar
          sx={{
            justifyContent: "space-between",
            padding: "0 16px",
            height: "60px",
          }}
        >
          {/* Left Home Icon */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "18px",
              width: "75px",
            }}
          >
          <ButtonBase

            onClick={goToHome}
            // onClick={onHomeClick}
          >
            <HomeIcon color="rgba(145, 145, 147, 1)" />
          </ButtonBase>
          {fullScreen && (
               <ButtonBase onClick={()=> {
                exitFullScreen()
                setFullScreen(false)
               }}>
               <CloseFullscreenIcon sx={{
                 color: 'rgba(145, 145, 147, 1)'
               }} />
             </ButtonBase>
            )}
            </Box>
          {/* Center Title */}
          <Typography
            variant="h6"
            sx={{
              color: "rgba(255, 255, 255, 1)",
              fontWeight: 700,
              letterSpacing: "2px",
              fontSize: "13px",
            }}
          >
            QORTAL
          </Typography>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "30px",
              width: "75px",
              justifyContent: "flex-end",
            }}
          >
          {/* Right Logout Icon */}
           <Save />
          <ButtonBase
            onClick={logoutFunc}


            // onClick={onLogoutClick}
          >
            <LogoutIcon color="rgba(145, 145, 147, 1)" />
          </ButtonBase>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Secondary Section */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: "var(--bg-3)",
          padding: "8px 16px",
          position: "relative",
          height: "27px",
        }}
      >
        <Box
          sx={{
            display: "flex",
            gap: "10px",
            alignItems: "center",
            userSelect: "none",
          }}
        >
          <Typography
            sx={{
              color: "rgba(255, 255, 255, 1)",
              fontWeight: 400,
              fontSize: "11px",
            }}
          >
            {myName}
          </Typography>
          {/* 
          <ArrowDownIcon /> */}
        </Box>

        <Box
          sx={{
            position: "absolute",
            left: "50%",
            transform: "translate(-50%, 50%)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 6,
            width: "30px", // Adjust as needed
            height: "30px", // Adjust as needed
            backgroundColor: "#232428", // Circle background
            borderRadius: "50%",
            boxShadow: "0px 4px 10px rgba(0, 0, 0, 0.3)", // Optional shadow for the circle
          }}
        >
          <IconButton  onClick={handleClick} color="inherit">
            <NotificationIcon color={hasUnreadDirects || hasUnreadGroups ? "var(--unread)" : "rgba(255, 255, 255, 1)"} />
          </IconButton>
        </Box>

        {/* Right Dropdown */}
        {/* <ButtonBase
          onClick={() => {
            setIsOpenDrawerProfile(true);
          }}
        >
          <Box
            sx={{
              display: "flex",
              gap: "10px",
              alignItems: "center",
            }}
          >
            <Typography
              sx={{
                color: "rgba(255, 255, 255, 1)",
                fontWeight: 400,
                fontSize: "11px",
              }}
            >
              View Wallet
            </Typography>

            <ArrowDownIcon />
          </Box>
        </ButtonBase> */}
      </Box>
      <Menu
        id="home-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          "aria-labelledby": "basic-button",
        }}
        anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'center',

          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'center',
          }}
          slotProps={{
            paper: {
              sx: {
                backgroundColor: 'var(--bg-primary)',
                color: '#fff',
                width: '148px',
                borderRadius: '5px'
              },
            },
            
          }}
          sx={{
            marginTop: '10px'
          }}
      
      >
        <MenuItem
          onClick={() => {
            setMobileViewMode("groups");
            setMobileViewModeKeepOpen("")
            handleClose();
          }}
        >
          <ListItemIcon sx={{
            
            minWidth: '24px !important'
          }}>
            <HubsIcon height={20} color={hasUnreadGroups ? "var(--unread)" :"rgba(250, 250, 250, 0.5)"} />
          </ListItemIcon>
          <ListItemText sx={{
                  "& .MuiTypography-root": {
                    fontSize: "12px",
                    fontWeight: 600,
                    color: hasUnreadDirects ? "var(--unread)" :"rgba(250, 250, 250, 0.5)"
                  },
                }} primary="Groups" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMobileViewModeKeepOpen("messaging");

            handleClose();
          }}
        >
          <ListItemIcon sx={{
            
            minWidth: '24px !important'
          }}>
          <MessagingIcon height={20} color={hasUnreadDirects ? "var(--unread)" :"rgba(250, 250, 250, 0.5)"} />
          </ListItemIcon>
          <ListItemText sx={{
                  "& .MuiTypography-root": {
                    fontSize: "12px",
                    fontWeight: 600,
                    color: hasUnreadDirects ? "var(--unread)" :"rgba(250, 250, 250, 0.5)"
                  },
                }} primary="Messaging" />
        </MenuItem>
       </Menu>
    </>
  );
};

export default Header;
