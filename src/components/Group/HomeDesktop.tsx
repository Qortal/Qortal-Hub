import { Box, Button, Typography } from "@mui/material";
import React from "react";
import { Spacer } from "../../common/Spacer";
import { ListOfThreadPostsWatched } from "./ListOfThreadPostsWatched";
import { ThingsToDoInitial } from "./ThingsToDoInitial";
import { GroupJoinRequests } from "./GroupJoinRequests";
import { GroupInvites } from "./GroupInvites";
import RefreshIcon from "@mui/icons-material/Refresh";
import { ListOfGroupPromotions } from "./ListOfGroupPromotions";

export const HomeDesktop = ({
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
  setDesktopViewMode,
  desktopViewMode
}) => {
  return (
    <Box
      sx={{
        display: desktopViewMode === 'home'  ?  "flex" : "none",
        width: "100%",
        flexDirection: "column",
        height: "100%",
        overflow: "auto",
        alignItems: "center",
      }}
    >
      <Spacer height="20px" />
      <Box sx={{
        display: "flex",
        width: "100%",
        flexDirection: "column",
        height: "100%",
        alignItems: "flex-start",
        maxWidth: '1036px'
      }}>
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
      <Spacer height="30px" />
      {!isLoadingGroups && (
        <Box
          sx={{
            display: "flex",
            gap: "15px",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <Box sx={{
            width: '330px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
          <ThingsToDoInitial
            balance={balance}
            myAddress={myAddress}
            name={userInfo?.name}
            userInfo={userInfo}
            hasGroups={groups?.length !== 0}
          />
          </Box>
          {desktopViewMode === 'home' && (
            <>
             <Box sx={{
            width: '330px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
          <ListOfThreadPostsWatched />
          </Box>
          <Box sx={{
            width: '330px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
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
          </Box>
          <Box sx={{
            width: '330px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
          <GroupInvites
            setOpenAddGroup={setOpenAddGroup}
            myAddress={myAddress}
            groups={groups}
            setMobileViewMode={setMobileViewMode}
          />
          </Box>
            </>
          )}
         
        </Box>
      )}
         {!isLoadingGroups && (
      <ListOfGroupPromotions />
         )}
      </Box>
     
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
      
      <Spacer height="180px" />
    </Box>
  );
};
