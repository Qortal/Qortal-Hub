import React, { useEffect, useRef, useState } from 'react';
import { Avatar, Box, Button, ListItem, ListItemAvatar, ListItemButton, ListItemText, Popover } from '@mui/material';
import { AutoSizer, CellMeasurer, CellMeasurerCache, List } from 'react-virtualized';
import { getNameInfo } from './Group';
import { getBaseApi, getFee } from '../../background';
import { LoadingButton } from '@mui/lab';
import { getBaseApiReact } from '../../App';

export const getMemberInvites = async (groupNumber) => {
  const response = await fetch(`${getBaseApiReact()}/groups/bans/${groupNumber}?limit=0`);
  const groupData = await response.json();
  return groupData;
}

const getNames = async (listOfMembers, includeNoNames) => {
  let members = [];
  if (listOfMembers && Array.isArray(listOfMembers)) {
    for (const member of listOfMembers) {
      if (member.offender) {
        const name = await getNameInfo(member.offender);
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

export const ListOfBans = ({ groupId, setInfoSnack, setOpenSnack, show }) => {
  const [bans, setBans] = useState([]);
  const [popoverAnchor, setPopoverAnchor] = useState(null); // Track which list item the popover is anchored to
  const [openPopoverIndex, setOpenPopoverIndex] = useState(null); // Track which list item has the popover open
  const listRef = useRef();
  const [isLoadingUnban, setIsLoadingUnban] = useState(false);

  const getInvites = async (groupId) => {
    try {
      const res = await getMemberInvites(groupId);
      const resWithNames = await getNames(res, true);
      setBans(resWithNames);
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

  const handleCancelBan = async (address)=> {
    try {
      const fee = await getFee('CANCEL_GROUP_BAN')
      await show({
        message: "Would you like to perform a CANCEL_GROUP_BAN transaction?" ,
        publishFee: fee.fee + ' QORT'
      })
      setIsLoadingUnban(true)
      new Promise((res, rej)=> {
        window.sendMessage("cancelBan", {
          groupId,
          qortalAddress: address,
        })
          .then((response) => {
            if (!response?.error) {
              res(response);
              setIsLoadingUnban(false);
              setInfoSnack({
                type: "success",
                message: "Successfully unbanned user. It may take a couple of minutes for the changes to propagate",
              });
              handlePopoverClose();
              setOpenSnack(true);
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
      setIsLoadingUnban(false)
    }
  }

  const rowRenderer = ({ index, key, parent, style }) => {
    const member = bans[index];
    
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
                <LoadingButton loading={isLoadingUnban}
                    loadingPosition="start"
                    variant="contained"  onClick={()=> handleCancelBan(member?.offender)}>Cancel Ban</LoadingButton>
                </Box>
              </Popover>
              <ListItemButton onClick={(event) => handlePopoverOpen(event, index)}>
                <ListItemAvatar>
                  <Avatar
                    alt={member?.name}
                    src={member?.name ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${member?.name}/qortal_avatar?async=true` : ''}
                  />
                </ListItemAvatar>
                <ListItemText primary={member?.name || member?.offender} />
              </ListItemButton>
            </ListItem>
          </div>
        )}
      </CellMeasurer>
    );
  };

  return (
    <div>
      <p>Ban list</p>
      <div style={{ position: 'relative', height: '500px', width: '100%', display: 'flex', flexDirection: 'column', flexShrink: 1 }}>
        <AutoSizer>
          {({ height, width }) => (
            <List
              ref={listRef}
              width={width}
              height={height}
              rowCount={bans.length}
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
