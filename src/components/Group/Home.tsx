import { Box, Button, Typography } from "@mui/material";
import React from "react";
import { Spacer } from "../../common/Spacer";
import { ListOfThreadPostsWatched } from "./ListOfThreadPostsWatched";
import { ThingsToDoInitial } from "./ThingsToDoInitial";
import { GroupJoinRequests } from "./GroupJoinRequests";
import { GroupInvites } from "./GroupInvites";
import RefreshIcon from "@mui/icons-material/Refresh";

export const Home = ({
  refreshHomeDataFunc,
  myAddress,
  isLoadingGroups,
  balance,
  userInfo,
  groups,
  setGroupSection,
  setSelectedGroup,
  getTimestampEnterChat,
  setOpenManageMembers,
  setOpenAddGroup,
  setMobileViewMode,
  setDesktopViewMode
}) => {
  return (
    <Box
      sx={{
        display: "flex",
        width: "100%",
        flexDirection: "column",
        height: "100%",
        overflow: "auto",
        alignItems: "center",
      }}
    >
      <Spacer height="20px" />
      <Typography
        sx={{
          color: "rgba(255, 255, 255, 1)",
          fontWeight: 400,
          fontSize: userInfo?.name?.length > 15 ? "16px" : "20px",
          padding: '10px'
        }}
      >
        Welcome
        {userInfo?.name ? (
          <span
            style={{
              fontStyle: "italic",
            }}
          >{`, ${userInfo?.name}`}</span>
        ) : null}
      </Typography>
      <Spacer height="26px" />

      {/* <Box
                sx={{
                  display: "flex",
                  width: "100%",
                  justifyContent: "flex-start",
                }}
              >
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={refreshHomeDataFunc}
                  sx={{
                    color: "white",
                  }}
                >
                  Refresh home data
                </Button>
              </Box> */}
      {!isLoadingGroups && (
        <Box
          sx={{
            display: "flex",
            gap: "15px",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <ThingsToDoInitial
            balance={balance}
            myAddress={myAddress}
            name={userInfo?.name}
            hasGroups={groups?.length !== 0}
          />
          <ListOfThreadPostsWatched />

          <GroupJoinRequests
            setGroupSection={setGroupSection}
            setSelectedGroup={setSelectedGroup}
            getTimestampEnterChat={getTimestampEnterChat}
            setOpenManageMembers={setOpenManageMembers}
            myAddress={myAddress}
            groups={groups}
            setMobileViewMode={setMobileViewMode}
            setDesktopViewMode={setDesktopViewMode}
          />
          <GroupInvites
            setOpenAddGroup={setOpenAddGroup}
            myAddress={myAddress}
            groups={groups}
            setMobileViewMode={setMobileViewMode}
          />
        </Box>
      )}
      <Spacer height="180px" />
    </Box>
  );
};
