import React, { useState } from "react";
import {
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Badge,
  Box,
} from "@mui/material";
import ForumIcon from "@mui/icons-material/Forum";
import GroupIcon from "@mui/icons-material/Group";
import { ArrowDownIcon } from "../../assets/Icons/ArrowDownIcon";
import { NotificationIcon2 } from "../../assets/Icons/NotificationIcon2";
import { ChatIcon } from "../../assets/Icons/ChatIcon";
import { ThreadsIcon } from "../../assets/Icons/ThreadsIcon";
import { MembersIcon } from "../../assets/Icons/MembersIcon";

export const GroupMenu = ({ setGroupSection, groupSection, setOpenManageMembers, goToAnnouncements, goToChat, hasUnreadChat, hasUnreadAnnouncements }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <Box
      sx={{
        width: "100%",
        display: "flex",
        justifyContent: "center",
        marginTop: '14px',
        marginBottom: '14px'
      }}
    >
      <Button
        aria-controls={open ? "home-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
        onClick={handleClick}
        variant="contained"
        sx={{
          backgroundColor: "var(--bg-primary)",
          width: "148px",
          borderRadius: "5px",
          fontSize: "12px",
          fontWeight: 600,
          color: "#fff",
          textTransform: "none",
          padding: '5px',
          height: '25px'
        }}
      >
        <Box
          sx={{
            display: "flex",
            gap: "6px",
            alignItems: "center",
            justifyContent: "space-between",
            width: '100%'
          }}
        >
          <Box
            sx={{
              display: "flex",
              gap: "6px",
              alignItems: "center",
            }}
          >
            {groupSection === "announcement" &&(
                 <> <NotificationIcon2 color={hasUnreadAnnouncements || hasUnreadChat ? 'var(--unread)' : 'white'}  /> {" Announcements"}</>
            )}
             {groupSection === "chat" &&(
                 <> <ChatIcon color={hasUnreadAnnouncements || hasUnreadChat ? 'var(--unread)' : 'white'} /> {" Group Chats"}</>
            )}
             {groupSection === "forum" &&(
                 <> <ThreadsIcon color={hasUnreadAnnouncements || hasUnreadChat ? 'var(--unread)' : 'white'} /> {" Threads"}</>
            )}
          </Box>
          <ArrowDownIcon color="white" />
        </Box>
      </Button>
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
            goToChat()
            handleClose();
          }}
        >
          <ListItemIcon sx={{
            
            minWidth: '24px !important'
          }}>
            <ChatIcon color={hasUnreadChat ? 'var(--unread)' : "#fff"}  />
          </ListItemIcon>
          <ListItemText sx={{
                  "& .MuiTypography-root": {
                    fontSize: "12px",
                    fontWeight: 600,
                    color: hasUnreadChat ? "var(--unread)" :"#fff"
                  },
                }} primary="Chat" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            goToAnnouncements()
            handleClose();
          }}
        >
          <ListItemIcon sx={{
            
            minWidth: '24px !important'
          }}>
          <NotificationIcon2 color={hasUnreadAnnouncements ? 'var(--unread)' : "#fff" } />
          </ListItemIcon>
          <ListItemText sx={{
                  "& .MuiTypography-root": {
                    fontSize: "12px",
                    fontWeight: 600,
                    color: hasUnreadAnnouncements ? "var(--unread)" :"#fff"
                  },
                }} primary="Announcements" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setGroupSection("forum");
            handleClose();
          }}
        >
          <ListItemIcon sx={{
            minWidth: '24px !important'
          }}>
                     <ThreadsIcon  color={"#fff"} />

          </ListItemIcon>
          <ListItemText sx={{
                  "& .MuiTypography-root": {
                    fontSize: "12px",
                    fontWeight: 600,
                  },
                }} primary="Threads" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setOpenManageMembers(true)
            handleClose();
          }}
        >
          <ListItemIcon sx={{
            minWidth: '24px !important'
          }}>
                     <MembersIcon sx={{ color: "#fff" }} />

          </ListItemIcon>
          <ListItemText sx={{
                  "& .MuiTypography-root": {
                    fontSize: "12px",
                    fontWeight: 600,
                  },
                }} primary="Members" />
        </MenuItem>
      </Menu>
    </Box>
  );
};
