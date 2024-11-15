import React, { useState, useRef, useMemo, useEffect } from "react";
import {
  ListItemIcon,
  Menu,
  MenuItem,
  Typography,
  styled,
} from "@mui/material";

import { executeEvent } from "../utils/events";

const CustomStyledMenu = styled(Menu)(({ theme }) => ({
  "& .MuiPaper-root": {
    backgroundColor: "#f9f9f9",
    borderRadius: "12px",
    padding: theme.spacing(1),
    boxShadow: "0 5px 15px rgba(0, 0, 0, 0.2)",
  },
  "& .MuiMenuItem-root": {
    fontSize: "14px", // Smaller font size for the menu item text
    color: "#444",
    transition: "0.3s background-color",
    "&:hover": {
      backgroundColor: "#f0f0f0", // Explicit hover state
    },
  },
}));

export const ContextMenuMentions = ({
  children,
  groupId,
  getTimestampMention
}) => {
  const [menuPosition, setMenuPosition] = useState(null);
  const longPressTimeout = useRef(null);
  const preventClick = useRef(false); // Flag to prevent click after long-press or right-click



  // Handle right-click (context menu) for desktop
  const handleContextMenu = (event) => {
    event.preventDefault();
    event.stopPropagation(); // Prevent parent click

    // Set flag to prevent any click event after right-click
    preventClick.current = true;

    setMenuPosition({
      mouseX: event.clientX,
      mouseY: event.clientY,
    });
  };

  // Handle long-press for mobile
  const handleTouchStart = (event) => {
    longPressTimeout.current = setTimeout(() => {
      preventClick.current = true; // Prevent the next click after long-press
      event.stopPropagation(); // Prevent parent click
      setMenuPosition({
        mouseX: event.touches[0].clientX,
        mouseY: event.touches[0].clientY,
      });
    }, 500); // Long press duration
  };

  const handleTouchEnd = (event) => {
    clearTimeout(longPressTimeout.current);

    if (preventClick.current) {
      event.preventDefault();
      event.stopPropagation(); // Prevent synthetic click after long-press
      preventClick.current = false; // Reset the flag
    }
  };


  const handleClose = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPosition(null);
  };

  const addTimestamp = ()=> {
    window.sendMessage("addTimestampMention", {
      timestamp: Date.now(),
      groupId
    }).then((res)=> {
      getTimestampMention()
    }).catch((error) => {
        console.error("Failed to add timestamp:", error.message || "An error occurred");
      });
  }

  return (
    <div
      onContextMenu={handleContextMenu} // For desktop right-click
      onTouchStart={handleTouchStart} // For mobile long-press start
      onTouchEnd={handleTouchEnd} // For mobile long-press end
      style={{ width: "100%", height: "100%" }}
    >
      {children}

      <CustomStyledMenu
        disableAutoFocusItem
        open={!!menuPosition}
        onClose={handleClose}
        anchorReference="anchorPosition"
        anchorPosition={
          menuPosition
            ? { top: menuPosition.mouseY, left: menuPosition.mouseX }
            : undefined
        }
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <MenuItem
          onClick={(e) => {
            handleClose(e);
            addTimestamp()
          }}
        >
          <Typography variant="inherit" sx={{ fontSize: "14px" }}>
            Unmark
          </Typography>
        </MenuItem>
      </CustomStyledMenu>
    </div>
  );
};
