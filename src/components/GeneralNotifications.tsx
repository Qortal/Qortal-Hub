import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Box,
  ButtonBase,
  Card,
  MenuItem,
  Popover,
  Tooltip,
  Typography,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import { formatDate } from "../utils/time";
import { useHandlePaymentNotification } from "../hooks/useHandlePaymentNotification";
import { executeEvent } from "../utils/events";

export const GeneralNotifications = ({ address }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const {latestTx,
    getNameOrAddressOfSenderMiddle,
    hasNewPayment, setLastEnteredTimestampPayment, nameAddressOfSender} = useHandlePaymentNotification(address)
  
  const handlePopupClick = (event) => {
    event.stopPropagation(); // Prevent parent onClick from firing
    setAnchorEl(event.currentTarget);
  };

  return (
    <>
      <ButtonBase
        onClick={(e) => {
          handlePopupClick(e);
     
        
        }}
        style={{}}
      >
         <Tooltip
                title={<span style={{ color: "white", fontSize: "14px", fontWeight: 700 }}>PAYMENT NOTIFICATION</span>} 
                placement="left"
                arrow
                sx={{ fontSize: "24" }}
                slotProps={{
                  tooltip: {
                    sx: {
                      color: "#ffffff",
                      backgroundColor: "#444444",
                    },
                  },
                  arrow: {
                    sx: {
                      color: "#444444",
                    },
                  },
                }}
              >
        <NotificationsIcon
          sx={{
            color: hasNewPayment ? "var(--unread)" : "rgba(255, 255, 255, 0.5)",
          }}
        />
        </Tooltip>
      </ButtonBase>

      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => {
          if(hasNewPayment){
            setLastEnteredTimestampPayment(Date.now())
          }
          setAnchorEl(null)

        }} // Close popover on click outside
      >
        <Box
          sx={{
            width: "300px",
            maxWidth: "100%",
            maxHeight: "60vh",
            overflow: "auto",
            padding: "5px",
            display: "flex",
            flexDirection: "column",
            alignItems: hasNewPayment ? "flex-start" : "center",
          }}
        >
          {!hasNewPayment && <Typography sx={{
            userSelect: 'none'
          }}>No new notifications</Typography>}
          {hasNewPayment && (
            <MenuItem
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "5px",
                width: "100%",
                alignItems: "flex-start",
                textWrap: "auto",
              }}
             onClick={() => {
              setAnchorEl(null)
                executeEvent('openWalletsApp', {})
              }}
            >
              <Card sx={{
                padding: '10px',
                width: '100%',
                backgroundColor: "#1F2023",
                gap: '5px',
                display: 'flex',
                flexDirection: 'column'
              }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  justifyContent: "space-between",
                }}
              >
                <AccountBalanceWalletIcon
                  sx={{
                    color: "white",
                  }}
                />{" "}
                {formatDate(latestTx?.timestamp)}
              </Box>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  justifyContent: "space-between",
                }}
              >
               
                <Typography>{latestTx?.amount}</Typography>
              </Box>
              <Typography sx={{
                fontSize: '0.8rem'
              }}>{nameAddressOfSender.current[latestTx?.creatorAddress] || getNameOrAddressOfSenderMiddle(latestTx?.creatorAddress)}</Typography>
          
              </Card>
            </MenuItem>
          )}
        </Box>
      </Popover>
    </>
  );
};
