import React, { useCallback, useEffect, useState } from 'react'
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import moment from 'moment'
import { Box, Typography } from "@mui/material";
import { Spacer } from "../../common/Spacer";
import { getBaseApiReact, isMobile } from "../../App";
import { MessagingIcon } from '../../assets/Icons/MessagingIcon';
import MailIcon from '@mui/icons-material/Mail';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import { executeEvent } from '../../utils/events';
import { CustomLoader } from '../../common/CustomLoader';
const isLessThanOneWeekOld = (timestamp) => {
  // Current time in milliseconds
  const now = Date.now();
  
  // One week ago in milliseconds (7 days * 24 hours * 60 minutes * 60 seconds * 1000 milliseconds)
  const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
  
  // Check if the timestamp is newer than one week ago
  return timestamp > oneWeekAgo;
};
export function formatEmailDate(timestamp: number) {
    const date = moment(timestamp);
    const now = moment();

    if (date.isSame(now, 'day')) {
        // If the email was received today, show the time
        return date.format('h:mm A');
    } else if (date.isSame(now, 'year')) {
        // If the email was received this year, show the month and day
        return date.format('MMM D');
    } else {
        // For older emails, show the full date
        return date.format('MMM D, YYYY');
    }
}
export const QMailMessages = ({userName, userAddress}) => {
    const [mails, setMails] = useState([])
    const [lastEnteredTimestamp, setLastEnteredTimestamp] = useState(null)
    const [loading, setLoading] = useState(true)

    console.log('lastEnteredTimestamp', lastEnteredTimestamp)
    const getMails = useCallback(async () => {
        try {
          setLoading(true)
            const query = `qortal_qmail_${userName.slice(
                0,
                20
            )}_${userAddress.slice(-6)}_mail_`
          const response = await fetch(`${getBaseApiReact()}/arbitrary/resources/search?service=MAIL_PRIVATE&query=${query}&limit=10&includemetadata=false&offset=0&reverse=true&excludeblocked=true&mode=ALL`);
          const mailData = await response.json();
  
          
          setMails(mailData);
        } catch (error) {
          console.error(error);
        } finally {
          setLoading(false)

        }
      }, [])

      const getTimestamp = async () => {
        try {
          return new Promise((res, rej) => {
            window.sendMessage("getEnteredQmailTimestamp")
            .then((response) => {
              if (!response?.error) {
               if(response?.timestamp){
                setLastEnteredTimestamp(response?.timestamp)
               }
              }
              rej(response.error);
            })
            .catch((error) => {
              rej(error.message || "An error occurred");
            });
          
          });
        } catch (error) {}
      };
    
      useEffect(() => {
        getTimestamp()
            if(!userName || !userAddress) return
          getMails();

          const interval = setInterval(() => {
            getTimestamp()
            getMails();
          }, 300000);
      
          return () => clearInterval(interval);
         
      }, [getMails, userName, userAddress]);

    

      console.log('mails', mails)
  return (
    <Box
    sx={{
      width: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    }}
  >
      
    <Box
      sx={{
        width: "322px",
        display: "flex",
        flexDirection: "column",
        padding: "0px 20px",
      }}
    >
      <Typography
        sx={{
          fontSize: "13px",
          fontWeight: 600,
        }}
      >
        Latest Q-Mails
      </Typography>
      <Spacer height="10px" />
    </Box>

    <Box
      sx={{
        width: "322px",
        height: isMobile ? "165px" : "250px",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        padding: "20px",
        borderRadius: "19px",
        overflow: 'auto'
      }}
    >
       {loading && mails.length === 0 && (
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
        {!loading && mails.length === 0 && (
          <Box
            sx={{
              width: "100%",
              display: "flex",
              justifyContent: "center",
              alignItems: 'center',
              height: '100%',
           
            }}
          >
            <Typography
              sx={{
                fontSize: "11px",
                fontWeight: 400,
                color: 'rgba(255, 255, 255, 0.2)'
              }}
            >
              Nothing to display
            </Typography>
          </Box>
        )}
   
         <List sx={{ width: "100%", maxWidth: 360 }}>
            {mails?.map((mail)=> {
                return (
                    <ListItem
       
                    disablePadding
                    sx={{
                      marginBottom: '20px'
                    }}
                    onClick={()=> {
                        executeEvent("addTab", { data: { service: 'APP', name: 'q-mail' } });
                        executeEvent("open-apps-mode", { });
                    }}
                  >
                    <ListItemButton
                      sx={{
                        padding: "0px",
                      }}
                      disableRipple
                      role={undefined}
                      dense
                    >
                      <ListItemText
                        sx={{
                          "& .MuiTypography-root": {
                            fontSize: "13px",
                            fontWeight: 400,
                          },
                        }}
                        primary={`From: ${mail?.name}`}
                        secondary={`${formatEmailDate(mail?.created)}`}
                      />
                      <ListItemIcon
                        sx={{
                          justifyContent: "flex-end",
                        }}
                      >
                        {!lastEnteredTimestamp && isLessThanOneWeekOld(mail?.created) ? (
                          <MailIcon sx={{
                            color: 'var(--unread)'
                        }} />
                        ) : !lastEnteredTimestamp ? (
                          <MailOutlineIcon sx={{
                            color: 'white'
                        }} />
                        ): lastEnteredTimestamp < mail?.created ? (
                          <MailIcon sx={{
                            color: 'var(--unread)'
                        }} />
                        ) :       (
                          <MailOutlineIcon sx={{
                            color: 'white'
                        }} />
                        )          
                      }
                       
                       
                     
                      </ListItemIcon>
                    </ListItemButton>
                  </ListItem>
                )
            })}
        
       
       </List>
    
     
    </Box>
  </Box>
  )
}
