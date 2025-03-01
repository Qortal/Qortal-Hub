import React, { useCallback, useContext, useEffect, useState } from 'react'
import {
    Avatar,
    Box,
    Button,
    ButtonBase,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Input,
    ListItem,
    ListItemAvatar,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    List,
    MenuItem,
    Popover,
    Select,
    TextField,
    Typography,
  } from "@mui/material";
import { Label } from './Group/AddGroup';
import { Spacer } from '../common/Spacer';
import { LoadingButton } from '@mui/lab';
import { getBaseApiReact, MyContext } from '../App';
import { getFee } from '../background';
import qTradeLogo from "../assets/Icons/q-trade-logo.webp";

import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import { executeEvent, subscribeToEvent, unsubscribeFromEvent } from '../utils/events';
import { BarSpinner } from '../common/Spinners/BarSpinner/BarSpinner';



export const BuyQortInformation = ({balance}) => {
  const [isOpen, setIsOpen] = useState(false) 

    const openBuyQortInfoFunc = useCallback((e) => {
     setIsOpen(true)
 
     }, [ setIsOpen]);
   
     useEffect(() => {
       subscribeToEvent("openBuyQortInfo", openBuyQortInfoFunc);
   
       return () => {
         unsubscribeFromEvent("openBuyQortInfo", openBuyQortInfoFunc);
       };
     }, [openBuyQortInfoFunc]);

  return (
    <Dialog
          open={isOpen}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
        >
          <DialogTitle id="alert-dialog-title">
            {"Get QORT"}
          </DialogTitle>
          <DialogContent>
          <Box
          sx={{
            width: "400px",
            maxWidth: '90vw',
            height: "400px",
            maxHeight: '90vh',
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "10px",
            padding: "10px",
          }}
        >
         <Typography>Get QORT using Qortal's crosschain trade portal</Typography>
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
            setIsOpen(false)
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
      <Spacer height='40px' />
         <Typography sx={{
            textDecoration: 'underline'
         }}>Benefits of having QORT</Typography>
         <List
      sx={{ width: '100%', maxWidth: 360, bgcolor: 'background.paper' }}
      aria-label="contacts"
    >
      <ListItem disablePadding>
         
          <ListItemIcon>
            <RadioButtonCheckedIcon sx={{
                color: 'white'
            }} />
          </ListItemIcon>
          <ListItemText primary="Create transactions on the Qortal Blockchain" />
     
      </ListItem>
      <ListItem disablePadding>
         
         <ListItemIcon>
           <RadioButtonCheckedIcon sx={{
               color: 'white'
           }} />
         </ListItemIcon>
         <ListItemText primary="Having at least 4 QORT in your balance allows you to send chat messages at near instant speed." />
    
     </ListItem>
    </List>
        </Box>
          </DialogContent>
          <DialogActions>
            <Button
              variant="contained"
              onClick={() => {
                setIsOpen(false)
              }}
            >
              Close
            </Button>
            
          </DialogActions>
        </Dialog>
  )
}
