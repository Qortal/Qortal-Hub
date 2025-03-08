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
        <NotificationsIcon
          sx={{
            color: hasNewPayment ? "var(--unread)" : "rgba(255, 255, 255, 0.5)",
          }}
        />
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
                cursor: 'default'
              }}
              onClick={(e) => {
                     // executeEvent("addTab", { data: { service: 'APP', name: 'q-mail' } });
          // executeEvent("open-apps-mode", { });
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
