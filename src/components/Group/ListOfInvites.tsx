import React, { useEffect, useRef, useState } from 'react';
import { Avatar, Box, Button, ListItem, ListItemAvatar, ListItemButton, ListItemText, Popover } from '@mui/material';
import { AutoSizer, CellMeasurer, CellMeasurerCache, List } from 'react-virtualized';
import { getNameInfo } from './Group';
import { getBaseApi, getFee } from '../../background';
import { LoadingButton } from '@mui/lab';
import { getBaseApiReact } from '../../App';

export const getMemberInvites = async (groupNumber) => {
  const response = await fetch(`${getBaseApiReact()}/groups/invites/group/${groupNumber}?limit=0`);
  const groupData = await response.json();
  return groupData;
}

const getNames = async (listOfMembers, includeNoNames) => {
  let members = [];
  if (listOfMembers && Array.isArray(listOfMembers)) {
    for (const member of listOfMembers) {
      if (member.invitee) {
        const name = await getNameInfo(member.invitee);
        if (name) {
          members.push({ ...member, name });
        } else if(includeNoNames){
          members.push({ ...member, name: name || "" });
        }
      }
    }
  }
  return members;
}

const cache = new CellMeasurerCache({
  fixedWidth: true,
  defaultHeight: 50,
});

export const ListOfInvites = ({ groupId, setInfoSnack, setOpenSnack, show }) => {
  const [invites, setInvites] = useState([]);
  const [popoverAnchor, setPopoverAnchor] = useState(null); // Track which list item the popover is anchored to
  const [openPopoverIndex, setOpenPopoverIndex] = useState(null); // Track which list item has the popover open
  const [isLoadingCancelInvite, setIsLoadingCancelInvite] = useState(false);

  const listRef = useRef();

  const getInvites = async (groupId) => {
    try {
      const res = await getMemberInvites(groupId);
      const resWithNames = await getNames(res, true);
      setInvites(resWithNames);
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    if (groupId) {
      getInvites(groupId);
    }
  }, [groupId]);

  const handlePopoverOpen = (event, index) => {
    setPopoverAnchor(event.currentTarget);
    setOpenPopoverIndex(index);
  };

  const handlePopoverClose = () => {
    setPopoverAnchor(null);
    setOpenPopoverIndex(null);
  };

  const handleCancelInvitation = async (address)=> {
    try {
      const fee = await getFee('CANCEL_GROUP_INVITE')
      await show({
        message: "Would you like to perform a CANCEL_GROUP_INVITE transaction?" ,
        publishFee: fee.fee + ' QORT'
      })
      setIsLoadingCancelInvite(true)
      await new Promise((res, rej)=> {
        window.sendMessage("cancelInvitationToGroup", {
          groupId,
          qortalAddress: address,
        })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: "success",
                message: "Successfully canceled invitation. It may take a couple of minutes for the changes to propagate",
              });
              setOpenSnack(true);
              handlePopoverClose();
              setIsLoadingCancelInvite(true);
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
        
        })  
    } catch (error) {
      
    } finally {
      setIsLoadingCancelInvite(false)
    }
  }

  const rowRenderer = ({ index, key, parent, style }) => {
    const member = invites[index];
    
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
            <ListItem disablePadding>
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
               <LoadingButton loading={isLoadingCancelInvite}
                    loadingPosition="start"
                    variant="contained" onClick={()=> handleCancelInvitation(member?.invitee)}>Cancel Invitation</LoadingButton>
                </Box>
              </Popover>
              <ListItemButton onClick={(event) => handlePopoverOpen(event, index)}>
                <ListItemAvatar>
                  <Avatar
                    alt={member?.name}
                    src={member?.name ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${member?.name}/qortal_avatar?async=true` : ''}
                  />
                </ListItemAvatar>
                <ListItemText primary={member?.name || member?.invitee} />
              </ListItemButton>
            </ListItem>
          </div>
        )}
      </CellMeasurer>
    );
  };

  return (
    <div>
      <p>Invitees list</p>
      <div style={{ position: 'relative', height: '500px', width: '100%', display: 'flex', flexDirection: 'column', flexShrink: 1 }}>
        <AutoSizer>
          {({ height, width }) => (
            <List
              ref={listRef}
              width={width}
              height={height}
              rowCount={invites.length}
              rowHeight={cache.rowHeight}
              rowRenderer={rowRenderer}
              deferredMeasurementCache={cache}
            />
          )}
        </AutoSizer>
      </div>
    </div>
  );
}
