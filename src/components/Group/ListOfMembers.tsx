import {
  Avatar,
  Box,
  Button,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Popover,
  Typography,
} from "@mui/material";
import React, { useRef, useState } from "react";
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
} from "react-virtualized";
import { LoadingButton } from "@mui/lab";
import { getBaseApi, getFee } from "../../background";
import { getBaseApiReact } from "../../App";

const cache = new CellMeasurerCache({
  fixedWidth: true,
  defaultHeight: 50,
});
const ListOfMembers = ({
  members,
  groupId,
  setInfoSnack,
  setOpenSnack,
  isAdmin,
  isOwner,
  show,
}) => {
  const [popoverAnchor, setPopoverAnchor] = useState(null); // Track which list item the popover is anchored to
  const [openPopoverIndex, setOpenPopoverIndex] = useState(null); // Track which list item has the popover open
  const [isLoadingKick, setIsLoadingKick] = useState(false);
  const [isLoadingBan, setIsLoadingBan] = useState(false);
  const [isLoadingMakeAdmin, setIsLoadingMakeAdmin] = useState(false);
  const [isLoadingRemoveAdmin, setIsLoadingRemoveAdmin] = useState(false);

  
  const listRef = useRef();

  const handlePopoverOpen = (event, index) => {
    setPopoverAnchor(event.currentTarget);
    setOpenPopoverIndex(index);
  };

  const handlePopoverClose = () => {
    setPopoverAnchor(null);
    setOpenPopoverIndex(null);
  };

  const handleKick = async (address) => {
    try {
      const fee = await getFee("GROUP_KICK");
      await show({
        message: "Would you like to perform a GROUP_KICK transaction?",
        publishFee: fee.fee + " QORT",
      });

      setIsLoadingKick(true);
      new Promise((res, rej) => {
        window.sendMessage("kickFromGroup", {
          groupId,
          qortalAddress: address,
        })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: "success",
                message: "Successfully kicked member from group. It may take a couple of minutes for the changes to propagate",
              });
              setOpenSnack(true);
              handlePopoverClose();
              res(response);
              return;
            }
            setInfoSnack({
              type: "error",
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
          })
          .catch((error) => {
            setInfoSnack({
              type: "error",
              message: error.message || "An error occurred",
            });
            setOpenSnack(true);
            rej(error);
          });
        
      });
    } catch (error) {
    } finally {
      setIsLoadingKick(false);
    }
  };
  const handleBan = async (address) => {
    try {
      const fee = await getFee("GROUP_BAN");
      await show({
        message: "Would you like to perform a GROUP_BAN transaction?",
        publishFee: fee.fee + " QORT",
      });
      setIsLoadingBan(true);
      await new Promise((res, rej) => {
        window.sendMessage("banFromGroup", {
          groupId,
          qortalAddress: address,
          rBanTime: 0,
        })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: "success",
                message: "Successfully banned member from group. It may take a couple of minutes for the changes to propagate",
              });
              setOpenSnack(true);
              handlePopoverClose();
              res(response);
              return;
            }
            setInfoSnack({
              type: "error",
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
          })
          .catch((error) => {
            setInfoSnack({
              type: "error",
              message: error.message || "An error occurred",
            });
            setOpenSnack(true);
            rej(error);
          });
        
      });
    } catch (error) {
    } finally {
      setIsLoadingBan(false);
    }
  };

  const makeAdmin = async (address) => {
    try {
      const fee = await getFee("ADD_GROUP_ADMIN");
      await show({
        message: "Would you like to perform a ADD_GROUP_ADMIN transaction?",
        publishFee: fee.fee + " QORT",
      });
      setIsLoadingMakeAdmin(true);
      await new Promise((res, rej) => {
        window.sendMessage("makeAdmin", {
          groupId,
          qortalAddress: address,
        })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: "success",
                message: "Successfully made member an admin. It may take a couple of minutes for the changes to propagate",
              });
              setOpenSnack(true);
              handlePopoverClose();
              res(response);
              return;
            }
            setInfoSnack({
              type: "error",
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
          })
          .catch((error) => {
            setInfoSnack({
              type: "error",
              message: error.message || "An error occurred",
            });
            setOpenSnack(true);
            rej(error);
          });
        
      });
    } catch (error) {
    } finally {
      setIsLoadingMakeAdmin(false);
    }
  };

  const removeAdmin = async (address) => {
    try {
      const fee = await getFee("REMOVE_GROUP_ADMIN");
      await show({
        message: "Would you like to perform a REMOVE_GROUP_ADMIN transaction?",
        publishFee: fee.fee + " QORT",
      });
      setIsLoadingRemoveAdmin(true);
      await new Promise((res, rej) => {
        window.sendMessage("removeAdmin", {
          groupId,
          qortalAddress: address,
        })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: "success",
                message: "Successfully removed member as an admin. It may take a couple of minutes for the changes to propagate",
              });
              setOpenSnack(true);
              handlePopoverClose();
              res(response);
              return;
            }
            setInfoSnack({
              type: "error",
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
          })
          .catch((error) => {
            setInfoSnack({
              type: "error",
              message: error.message || "An error occurred",
            });
            setOpenSnack(true);
            rej(error);
          });
        
      });
    } catch (error) {
    } finally {
      setIsLoadingRemoveAdmin(false);
    }
  };

  const rowRenderer = ({ index, key, parent, style }) => {
    const member = members[index];

    return (
      <CellMeasurer
        key={key}
        cache={cache}
        parent={parent}
        columnIndex={0}
        rowIndex={index}
      >
        {({ measure }) => (
          <div style={style} onLoad={measure}>
            <Popover
              open={openPopoverIndex === index}
              anchorEl={popoverAnchor}
              onClose={handlePopoverClose}
              anchorOrigin={{
                vertical: "bottom",
                horizontal: "center",
              }}
              transformOrigin={{
                vertical: "top",
                horizontal: "center",
              }}
              style={{ marginTop: "8px" }}
            >
              <Box
                sx={{
                  width: "325px",
                  height: "250px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px",
                }}
              >
                {isOwner && (
                  <>
                    <LoadingButton
                      loading={isLoadingKick}
                      loadingPosition="start"
                      variant="contained"
                      onClick={() => handleKick(member?.member)}
                    >
                      Kick member from group
                    </LoadingButton>
                    <LoadingButton
                      loading={isLoadingBan}
                      loadingPosition="start"
                      variant="contained"
                      onClick={() => handleBan(member?.member)}
                    >
                      Ban member from group
                    </LoadingButton>
                    <LoadingButton
                      loading={isLoadingMakeAdmin}
                      loadingPosition="start"
                      variant="contained"
                      onClick={() => makeAdmin(member?.member)}
                    >
                      Make an admin
                    </LoadingButton>
                    <LoadingButton
                      loading={isLoadingRemoveAdmin}
                      loadingPosition="start"
                      variant="contained"
                      onClick={() => removeAdmin(member?.member)}
                    >
                      Remove as admin
                    </LoadingButton>
                  </>
                )}
              </Box>
            </Popover>
            <ListItem
              key={member?.member}
              // secondaryAction={
              //   <Checkbox
              //     edge="end"
              //     onChange={handleToggle(value)}
              //     checked={checked.indexOf(value) !== -1}
              //     inputProps={{ 'aria-labelledby': labelId }}
              //   />
              // }
              disablePadding
            >
              <ListItemButton
                onClick={(event) => handlePopoverOpen(event, index)}
              >
                <ListItemAvatar>
                  <Avatar
                    alt={member?.name || member?.member}
                    src={member?.name ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${member?.name}/qortal_avatar?async=true` : ''}
                  />
                </ListItemAvatar>
                <ListItemText
                  id={""}
                  primary={member?.name || member?.member}
                />
                {member?.isAdmin && (
                <Typography sx={{
                  color: 'white',
                  marginLeft: 'auto'
                }}>Admin</Typography>
              )}
              </ListItemButton>
              
            </ListItem>
          </div>
        )}
      </CellMeasurer>
    );
  };

  return (
    <div>
      <p>Member list</p>
      <div
        style={{
          position: "relative",
          height: "500px",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          flexShrink: 1,
        }}
      >
        <AutoSizer>
          {({ height, width }) => (
            <List
              ref={listRef}
              width={width}
              height={height}
              rowCount={members.length}
              rowHeight={cache.rowHeight}
              rowRenderer={rowRenderer}
              //   onScroll={handleScroll}
              deferredMeasurementCache={cache}
            />
          )}
        </AutoSizer>
      </div>
    </div>
  );
};

export default ListOfMembers;
