import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import React, { useContext, useEffect, useState } from "react";
import { MyContext } from "../../App";
import { Spacer } from "../../common/Spacer";
import { executeEvent } from "../../utils/events";

export const BlockedUsersModal = ({ close }) => {
  const [hasChanged, setHasChanged] = useState(false);
  const [value, setValue] = useState("");

  const { getAllBlockedUsers, removeBlockFromList, addToBlockList } = useContext(MyContext);
  const [blockedUsers, setBlockedUsers] = useState({
    addresses: {},
    names: {},
  });
  const fetchBlockedUsers = () => {
    setBlockedUsers(getAllBlockedUsers());
  };

  useEffect(() => {
    fetchBlockedUsers();
  }, []);
  return (
    <Dialog
      open={true}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
    >
        <DialogTitle>Blocked Users</DialogTitle>
        <DialogContent sx={{
            padding: '20px'
        }}>
      <Box
       
      sx={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
        >
        <TextField
          placeholder="Name"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
        <Button variant="contained" onClick={async ()=> {
            try {
                if(!value) return
                await addToBlockList(undefined, value)
                fetchBlockedUsers()
                setHasChanged(true)
            } catch (error) {
                console.error(error)
            }
        }}>Block</Button>
      </Box>
   
        {Object.entries(blockedUsers?.addresses).length > 0 && (
          <>
            <Spacer height="20px" />
            <DialogContentText id="alert-dialog-description">
              Blocked Users for Chat ( addresses )
            </DialogContentText>
            <Spacer height="10px" />
          </>
        )}

        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
        }}>
          {Object.entries(blockedUsers?.addresses || {})?.map(
            ([key, value]) => {
              return (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    width: '100%',
                    justifyContent: 'space-between'
                  }}
                >
                  <Typography>{key}</Typography>
                  <Button
                    variant="contained"
                    onClick={async () => {
                      try {
                        await removeBlockFromList(key, undefined);
                        setHasChanged(true);
                        setValue('')
                        fetchBlockedUsers();
                      } catch (error) {
                        console.error(error);
                      }
                    }}
                  >
                    Unblock
                  </Button>
                </Box>
              );
            }
          )}
        </Box>
        {Object.entries(blockedUsers?.names).length > 0 && (
          <>
            <Spacer height="20px" />
            <DialogContentText id="alert-dialog-description">
              Blocked Users for QDN and Chat (names)
            </DialogContentText>
            <Spacer height="10px" />
          </>
        )}

        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
        }}>
          {Object.entries(blockedUsers?.names || {})?.map(([key, value]) => {
            return (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  width: '100%',
                    justifyContent: 'space-between'
                }}
              >
                <Typography>{key}</Typography>
                <Button
                  variant="contained"
                  onClick={async () => {
                    try {
                      await removeBlockFromList(undefined, key);
                      setHasChanged(true);
                      fetchBlockedUsers();
                    } catch (error) {
                      console.error(error);
                    }
                  }}
                >
                  Unblock
                </Button>
              </Box>
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          sx={{
            backgroundColor: "var(--green)",
            color: "black",
            fontWeight: "bold",
            opacity: 0.7,
            "&:hover": {
              backgroundColor: "var(--green)",
              color: "black",
              opacity: 1,
            },
          }}
          variant="contained"
          onClick={()=> {
            if(hasChanged){
                executeEvent('updateChatMessagesWithBlocks', true)
            }
            close()
          }}
        >
          close
        </Button>
      </DialogActions>
    </Dialog>
  );
};
