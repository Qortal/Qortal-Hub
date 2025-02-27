import * as React from "react";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import CommentIcon from "@mui/icons-material/Comment";
import InfoIcon from "@mui/icons-material/Info";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import { executeEvent } from "../../utils/events";
import { Box, ButtonBase, Collapse, Typography } from "@mui/material";
import { Spacer } from "../../common/Spacer";
import { getGroupNames } from "./UserListOfInvites";
import { CustomLoader } from "../../common/CustomLoader";
import { getBaseApiReact, isMobile } from "../../App";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

export const GroupInvites = ({ myAddress, setOpenAddGroup }) => {
  const [groupsWithJoinRequests, setGroupsWithJoinRequests] = React.useState(
    []
  );
  const [isExpanded, setIsExpanded] = React.useState(false);

  const [loading, setLoading] = React.useState(true);

  const getJoinRequests = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${getBaseApiReact()}/groups/invites/${myAddress}/?limit=0`
      );
      const data = await response.json();
      const resMoreData = await getGroupNames(data);

      setGroupsWithJoinRequests(resMoreData);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (myAddress) {
      getJoinRequests();
    }
  }, [myAddress]);

  return (
    <Box
      sx={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <ButtonBase
        sx={{
          width: "322px",
          display: "flex",
          flexDirection: "row",
          padding: "0px 20px",
          gap: '10px',
          justifyContent: 'flex-start'
        }}
        onClick={()=> setIsExpanded((prev)=> !prev)}
      >
        <Typography
          sx={{
            fontSize: "1rem",
          }}
        >
          Group Invites {groupsWithJoinRequests?.length > 0 && ` (${groupsWithJoinRequests?.length})`}
        </Typography>
        {isExpanded ? <ExpandLessIcon sx={{
      marginLeft: 'auto'
     }}  /> : (
      <ExpandMoreIcon sx={{
        marginLeft: 'auto'
       }}/>
     )}
      </ButtonBase>
      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
        <Box
          sx={{
            width: "322px",
            height: isMobile ? "165px" : "250px",

            display: "flex",
            flexDirection: "column",
            bgcolor: "background.paper",
            padding: "20px",
            borderRadius: "19px",
          }}
        >
          {loading && groupsWithJoinRequests.length === 0 && (
            <Box
              sx={{
                width: "100%",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <CustomLoader />
            </Box>
          )}
          {!loading && groupsWithJoinRequests.length === 0 && (
            <Box
              sx={{
                width: "100%",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100%",
              }}
            >
              <Typography
                sx={{
                  fontSize: "11px",
                  fontWeight: 400,
                  color: "rgba(255, 255, 255, 0.2)",
                }}
              >
                Nothing to display
              </Typography>
            </Box>
          )}
          <List
            sx={{
              width: "100%",
              maxWidth: 360,
              bgcolor: "background.paper",
              maxHeight: "300px",
              overflow: "auto",
            }}
            className="scrollable-container"
          >
            {groupsWithJoinRequests?.map((group) => {
              return (
                <ListItem
                  sx={{
                    marginBottom: "20px",
                  }}
                  key={group?.groupId}
                  onClick={() => {
                    setOpenAddGroup(true);
                    setTimeout(() => {
                      executeEvent("openGroupInvitesRequest", {});
                    }, 300);
                  }}
                  disablePadding
                  secondaryAction={
                    <IconButton edge="end" aria-label="comments">
                      <GroupAddIcon
                        sx={{
                          color: "white",
                          fontSize: "18px",
                        }}
                      />
                    </IconButton>
                  }
                >
                  <ListItemButton disableRipple role={undefined} dense>
                    <ListItemText
                      sx={{
                        "& .MuiTypography-root": {
                          fontSize: "13px",
                          fontWeight: 400,
                        },
                      }}
                      primary={`${group?.groupName} has invited you`}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        </Box>
      </Collapse>
    </Box>
  );
};
