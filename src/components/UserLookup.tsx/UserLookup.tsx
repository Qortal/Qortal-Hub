import React, { useCallback, useEffect, useState } from "react";
import { DrawerUserLookup } from "../Drawer/DrawerUserLookup";
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Card,
  Divider,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Table,
  CircularProgress,
} from "@mui/material";
import { getAddressInfo, getNameOrAddress } from "../../background";
import { getBaseApiReact } from "../../App";
import { getNameInfo } from "../Group/Group";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import { Spacer } from "../../common/Spacer";
import { formatTimestamp } from "../../utils/time";
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import SearchIcon from '@mui/icons-material/Search';
import { executeEvent, subscribeToEvent, unsubscribeFromEvent } from "../../utils/events";

function formatAddress(str) {
  if (str.length <= 12) return str;

  const first6 = str.slice(0, 6);
  const last6 = str.slice(-6);

  return `${first6}....${last6}`;
}

export const UserLookup = ({ isOpenDrawerLookup, setIsOpenDrawerLookup }) => {
  const [nameOrAddress, setNameOrAddress] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [addressInfo, setAddressInfo] = useState(null);
  const [isLoadingUser, setIsLoadingUser] = useState(false);
  const [isLoadingPayments, setIsLoadingPayments] = useState(false);
  const [payments, setPayments] = useState([]);
  const lookupFunc =  useCallback(async (messageAddressOrName) => {
    try {
        setErrorMessage('')
        setIsLoadingUser(true)
        setPayments([])
        setAddressInfo(null)
        const inputAddressOrName = messageAddressOrName || nameOrAddress
      if (!inputAddressOrName?.trim())
        throw new Error("Please insert a name or address");
      const owner = await getNameOrAddress(inputAddressOrName);
      if (!owner) throw new Error("Name does not exist");
      const addressInfoRes = await getAddressInfo(owner);
      if (!addressInfoRes?.publicKey) {
        throw new Error("Address does not exist on blockchain");
      }
      const name = await getNameInfo(owner);
      const balanceRes = await fetch(
        `${getBaseApiReact()}/addresses/balance/${owner}`
      );
      const balanceData = await balanceRes.json();
      setAddressInfo({
        ...addressInfoRes,
        balance: balanceData,
        name,
      });
      setIsLoadingUser(false)
      setIsLoadingPayments(true)

      const getPayments = await fetch(
        `${getBaseApiReact()}/transactions/search?txType=PAYMENT&address=${owner}&confirmationStatus=CONFIRMED&limit=20&reverse=true`
      );
      const paymentsData = await getPayments.json();
      setPayments(paymentsData);
     
    } catch (error) {
        setErrorMessage(error?.message)
      console.error(error);
    } finally {
        setIsLoadingUser(false)
        setIsLoadingPayments(false)
    }
  }, [nameOrAddress]);

   const openUserLookupDrawerFunc = useCallback((e) => {
    setIsOpenDrawerLookup(true)
      const message = e.detail?.addressOrName;
      if(message){
        lookupFunc(message)
      }
    }, [lookupFunc, setIsOpenDrawerLookup]);
  
    useEffect(() => {
      subscribeToEvent("openUserLookupDrawer", openUserLookupDrawerFunc);
  
      return () => {
        unsubscribeFromEvent("openUserLookupDrawer", openUserLookupDrawerFunc);
      };
    }, [openUserLookupDrawerFunc]);

 const onClose = ()=> {
    setIsOpenDrawerLookup(false)
    setNameOrAddress('')
    setErrorMessage('')
    setPayments([])
    setIsLoadingUser(false)
    setIsLoadingPayments(false)
    setAddressInfo(null)
 }


  return (
    <DrawerUserLookup open={isOpenDrawerLookup} setOpen={setIsOpenDrawerLookup}>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          padding: "15px",
          height: "100vh",
          overflow: "hidden",
        }}
      >
   
     
                    <Box
          sx={{
            display: "flex",
            gap: "5px",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <TextField
          autoFocus
            value={nameOrAddress}
            onChange={(e) => setNameOrAddress(e.target.value)}
            size="small"
            placeholder="Address or Name"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter" && nameOrAddress) {
                lookupFunc();
              }
            }}
          />
          <ButtonBase onClick={()=> {
            lookupFunc();
          }} >
           <SearchIcon sx={{
            color: 'white',
             marginRight: '20px'
           }} />
          </ButtonBase>
          <ButtonBase sx={{
            marginLeft: 'auto',
           
          }} onClick={()=> {
           onClose()
          }}>
            <CloseFullscreenIcon sx={{
                color: 'white'
            }} />
          </ButtonBase>
        </Box>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            overflow: "auto",
          }}
        >
             {!isLoadingUser && errorMessage && (
            <Box sx={{
                display: 'flex',
                width: '100%',
                justifyContent: 'center',
                 marginTop: '40px'
            }}>
           <Typography>{errorMessage}</Typography>
            </Box>
        )}
                 {isLoadingUser && (
            <Box sx={{
                display: 'flex',
                width: '100%',
                justifyContent: 'center',
                marginTop: '40px'
            }}>
            <CircularProgress sx={{
                color: 'white'
            }} />
            </Box>
        )}
        {!isLoadingUser && addressInfo && (
            <>
   
          <Spacer height="30px" />
          <Box
            sx={{
              display: "flex",
              gap: "20px",
              flexWrap: "wrap",
              flexDirection: "row",
              width: "100%",
              justifyContent: "center",
            }}
          >
            <Card
              sx={{
                padding: "15px",
                minWidth: "320px",
                alignItems: "center",
                minHeight: "200px",
                background: "var(--bg-primary)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Typography
                sx={{
                  textAlign: "center",
                }}
              >
                {addressInfo?.name ?? "Name not registered"}
              </Typography>
              <Spacer height="20px" />
              <Divider>
                {addressInfo?.name ? (
                  <Avatar
                    sx={{
                      height: "50px",
                      width: "50px",
                      "& img": {
                        objectFit: "fill",
                      },
                    }}
                    alt={addressInfo?.name}
                    src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                      addressInfo?.name
                    }/qortal_avatar?async=true`}
                  >
                    <AccountCircleIcon
                      sx={{
                        fontSize: "50px",
                      }}
                    />
                  </Avatar>
                ) : (
                  <AccountCircleIcon
                    sx={{
                      fontSize: "50px",
                    }}
                  />
                )}
              </Divider>
              <Spacer height="20px" />
              <Typography
                sx={{
                  textAlign: "center",
                }}
              >
                Level {addressInfo?.level}
              </Typography>
            </Card>
            <Card
              sx={{
                padding: "15px",
                minWidth: "320px",
                minHeight: "200px",
                gap: "20px",
                display: "flex",
                flexDirection: "column",
                background: "var(--bg-primary)",
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  gap: "20px",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    flexShrink: 0,
                  }}
                >
                  <Typography>Address</Typography>
                </Box>
                <Tooltip
                  title={
                    <span
                      style={{
                        color: "white",
                        fontSize: "14px",
                        fontWeight: 700,
                      }}
                    >
                      copy address
                    </span>
                  }
                  placement="bottom"
                  arrow
                  sx={{ fontSize: "24" }}
                  slotProps={{
                    tooltip: {
                      sx: {
                        color: "#ffffff",
                        backgroundColor: "#444444",
                      },
                    },
                    arrow: {
                      sx: {
                        color: "#444444",
                      },
                    },
                  }}
                >
                  <ButtonBase
                    onClick={() => {
                      navigator.clipboard.writeText(addressInfo?.address);
                    }}
                  >
                    <Typography
                      sx={{
                        textAlign: "end",
                      }}
                    >
                      {addressInfo?.address}
                    </Typography>
                  </ButtonBase>
                </Tooltip>
              </Box>
              <Box
                sx={{
                  display: "flex",
                  gap: "20px",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <Typography>Balance</Typography>
                <Typography>{addressInfo?.balance}</Typography>
              </Box>
              <Spacer height="20px" />
              <Button variant="contained" onClick={()=> {
                 executeEvent('openPaymentInternal', {
                                       address: addressInfo?.address,
                                       name: addressInfo?.name,
                               });
              }}>Send QORT</Button>
            </Card>
          </Box>
       

            </>
        )}
          <Spacer height="40px" />
          {isLoadingPayments && (
            <Box sx={{
                display: 'flex',
                width: '100%',
                justifyContent: 'center'
            }}>
            <CircularProgress sx={{
                color: 'white'
            }} />
            </Box>
        )}
          {!isLoadingPayments && addressInfo && (
             <Card
             sx={{
               padding: "15px",
               overflow: "auto",
 
               display: "flex",
               flexDirection: "column",
               background: "var(--bg-primary)",
             }}
           >
             <Typography>20 most recent payments</Typography>
             <Spacer height="20px" />
             {!isLoadingPayments && payments?.length === 0 && (
            <Box sx={{
                display: 'flex',
                width: '100%',
                justifyContent: 'center'
            }}>
           <Typography>No payments</Typography>
            </Box>
        )}
             <Table>
               <TableHead>
                 <TableRow>
                   <TableCell>Sender</TableCell>
                   <TableCell>Reciver</TableCell>
                   <TableCell>Amount</TableCell>
                   <TableCell>Time</TableCell>
                 </TableRow>
               </TableHead>
               <TableBody>
                 {payments.map((payment, index) => (
                   <TableRow key={payment?.signature}>
                     <TableCell>
                       <Tooltip
                         title={
                           <span
                             style={{
                               color: "white",
                               fontSize: "14px",
                               fontWeight: 700,
                             }}
                           >
                             copy address
                           </span>
                         }
                         placement="bottom"
                         arrow
                         sx={{ fontSize: "24" }}
                         slotProps={{
                           tooltip: {
                             sx: {
                               color: "#ffffff",
                               backgroundColor: "#444444",
                             },
                           },
                           arrow: {
                             sx: {
                               color: "#444444",
                             },
                           },
                         }}
                       >
                         <ButtonBase
                           onClick={() => {
                             navigator.clipboard.writeText(
                               payment?.creatorAddress
                             );
                           }}
                         >
                           {formatAddress(payment?.creatorAddress)}
                         </ButtonBase>
                       </Tooltip>
                     </TableCell>
                     <TableCell>
                       <Tooltip
                         title={
                           <span
                             style={{
                               color: "white",
                               fontSize: "14px",
                               fontWeight: 700,
                             }}
                           >
                             copy address
                           </span>
                         }
                         placement="bottom"
                         arrow
                         sx={{ fontSize: "24" }}
                         slotProps={{
                           tooltip: {
                             sx: {
                               color: "#ffffff",
                               backgroundColor: "#444444",
                             },
                           },
                           arrow: {
                             sx: {
                               color: "#444444",
                             },
                           },
                         }}
                       >
                         <ButtonBase
                           onClick={() => {
                             navigator.clipboard.writeText(payment?.recipient);
                           }}
                         >
                           {formatAddress(payment?.recipient)}
                          
                         </ButtonBase>
                       </Tooltip>
                     </TableCell>
                     <TableCell>
                     {payment?.amount}
                     </TableCell>
                     <TableCell>{formatTimestamp(payment?.timestamp)}</TableCell>
                   </TableRow>
                 ))}
               </TableBody>
             </Table>
           </Card>
          )}
         
        </Box>
      </Box>
    </DrawerUserLookup>
  );
};
