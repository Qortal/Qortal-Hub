import { Box, ButtonBase, Typography } from "@mui/material";
import React from "react";
import ChatIcon from "@mui/icons-material/Chat";
import qTradeLogo from "../../assets/Icons/q-trade-logo.webp";
import AppsIcon from "@mui/icons-material/Apps";
import { executeEvent } from "../../utils/events";
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';


export const Explore = ({setDesktopViewMode}) => {
  return (
    <Box
      sx={{
        display: "flex",
        gap: "20px",
        flexWrap: "wrap",
      }}
    >
      <ButtonBase
        sx={{
          "&:hover": { backgroundColor: "secondary.main" },
          transition: "all 0.1s ease-in-out",
          padding: "5px",
          borderRadius: "5px",
          gap: "5px",
        }}
        onClick={async () => {
            executeEvent("addTab", {
              data: { service: "APP", name: "q-trade" },
            });
            executeEvent("open-apps-mode", {});
          }}
      >
        <img
          style={{
            borderRadius: "50%",
            height: '30px'
          }}
          src={qTradeLogo}
        />
        <Typography
          sx={{
            fontSize: "1rem",
          }}
        >
          Trade QORT
        </Typography>
      </ButtonBase>
      <ButtonBase
        sx={{
          "&:hover": { backgroundColor: "secondary.main" },
          transition: "all 0.1s ease-in-out",
          padding: "5px",
          borderRadius: "5px",
          gap: "5px",
        }}
         onClick={()=> {
            setDesktopViewMode('apps')

         }}
      >
        <AppsIcon
          sx={{
            color: "white",
          }}
        />
        <Typography
          sx={{
            fontSize: "1rem",
          }}
        >
          See Apps
        </Typography>
      </ButtonBase>
      <ButtonBase
        sx={{
          "&:hover": { backgroundColor: "secondary.main" },
          transition: "all 0.1s ease-in-out",
          padding: "5px",
          borderRadius: "5px",
          gap: "5px",
        }}
        onClick={async () => {
            executeEvent("openGroupMessage", {
              from: "0" ,
            });
          }}
      >
        <ChatIcon
          sx={{
            color: "white",
          }}
        />
        <Typography
          sx={{
            fontSize: "1rem",
          }}
        >
          General Chat
        </Typography>
      </ButtonBase>
      <ButtonBase
        sx={{
          "&:hover": { backgroundColor: "secondary.main" },
          transition: "all 0.1s ease-in-out",
          padding: "5px",
          borderRadius: "5px",
          gap: "5px",
        }}
        onClick={async () => {
            executeEvent("openWalletsApp", {
           
            });
          }}
      >
        <AccountBalanceWalletIcon
          sx={{
            color: "white",
          }}
        />
        <Typography
          sx={{
            fontSize: "1rem",
          }}
        >
          Wallets
        </Typography>
      </ButtonBase>
    </Box>
  );
};
