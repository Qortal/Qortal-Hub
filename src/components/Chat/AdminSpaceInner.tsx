import React, { useCallback, useContext, useEffect, useState } from 'react'
import { MyContext, getArbitraryEndpointReact, getBaseApiReact } from '../../App';
import { Box, Button, Typography } from '@mui/material';
import { decryptResource, validateSecretKey } from '../Group/Group';
import { getFee } from '../../background';
import { base64ToUint8Array } from '../../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../../backgroundFunctions/encryption';
import { formatTimestampForum } from '../../utils/time';
import { Spacer } from '../../common/Spacer';


export const getPublishesFromAdminsAdminSpace = async (admins: string[], groupId) => {
    const queryString = admins.map((name) => `name=${name}`).join("&");
    const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT_PRIVATE&identifier=admins-symmetric-qchat-group-${
      groupId
    }&exactmatchnames=true&limit=0&reverse=true&${queryString}&prefix=true`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("network error");
    }
    const adminData = await response.json();
  
    const filterId = adminData.filter(
      (data: any) =>
        data.identifier === `admins-symmetric-qchat-group-${groupId}`
    );
    if (filterId?.length === 0) {
      return false;
    }
    const sortedData = filterId.sort((a: any, b: any) => {
      // Get the most recent date for both a and b
      const dateA = a.updated ? new Date(a.updated) : new Date(a.created);
      const dateB = b.updated ? new Date(b.updated) : new Date(b.created);
  
      // Sort by most recent
      return dateB.getTime() - dateA.getTime();
    });
  
    return sortedData[0];
  };

export const AdminSpaceInner = ({selectedGroup, adminsWithNames}) => {
    const [adminGroupSecretKey,  setAdminGroupSecretKey] = useState(null)
    const [isFetchingAdminGroupSecretKey,  setIsFetchingAdminGroupSecretKey] = useState(true)
    const [adminGroupSecretKeyPublishDetails,  setAdminGroupSecretKeyPublishDetails] = useState(null)

    const [isLoadingPublishKey,  setIsLoadingPublishKey] = useState(false)
    const { show, setTxList,  setInfoSnackCustom,
        setOpenSnackGlobal  } = useContext(MyContext);
  

    const getAdminGroupSecretKey = useCallback(async ()=> {
        try {
            if(!selectedGroup) return
           const getLatestPublish = await getPublishesFromAdminsAdminSpace(adminsWithNames.map((admin)=> admin?.name), selectedGroup)
          if(getLatestPublish === false) return
           let data;
        
             const res = await fetch(
               `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${getLatestPublish.name}/${
                 getLatestPublish.identifier
               }?encoding=base64`
             );
             data = await res.text();
        
           const decryptedKey: any = await decryptResource(data);
           const dataint8Array = base64ToUint8Array(decryptedKey.data);
           const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
           if (!validateSecretKey(decryptedKeyToObject))
             throw new Error("SecretKey is not valid");
             setAdminGroupSecretKey(decryptedKeyToObject)
             setAdminGroupSecretKeyPublishDetails(getLatestPublish)
        } catch (error) {
            
        } finally {
            setIsFetchingAdminGroupSecretKey(false)
        }
    }, [adminsWithNames, selectedGroup])

    const createCommonSecretForAdmins = async ()=> {
        try {
          const fee = await getFee('ARBITRARY')
          await show({
            message: "Would you like to perform an ARBITRARY transaction?" ,
            publishFee: fee.fee + ' QORT'
          })
          setIsLoadingPublishKey(true)
       
 
          window.sendMessage("encryptAndPublishSymmetricKeyGroupChatForAdmins", {
            groupId: selectedGroup,
            previousData: null,
            admins: adminsWithNames
          })
            .then((response) => {
                
              if (!response?.error) {
                setInfoSnackCustom({
                  type: "success",
                  message: "Successfully re-encrypted secret key. It may take a couple of minutes for the changes to propagate. Refresh the group in 5 mins.",
                });
                setOpenSnackGlobal(true);
               return
              }
              setInfoSnackCustom({
                type: "error",
                message: response?.error || "unable to re-encrypt secret key",
              });
              setOpenSnackGlobal(true);
            })
            .catch((error) => {
              setInfoSnackCustom({
                type: "error",
                message: error?.message || "unable to re-encrypt secret key",
              });
              setOpenSnackGlobal(true);
            });
          
        } catch (error) {
            
        }
    }
    useEffect(() => {
        getAdminGroupSecretKey()
      }, [getAdminGroupSecretKey]);
  return (
    <Box sx={{
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: '10px'
    }}>
      <Spacer height="25px" />
      <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
      width: '300px',
      maxWidth: '90%'
    }}>
        {isFetchingAdminGroupSecretKey && <Typography>Fetching Admins secret keys</Typography>}
        {!isFetchingAdminGroupSecretKey && !adminGroupSecretKey && <Typography>No secret key published yet</Typography>}
        {adminGroupSecretKeyPublishDetails && (
            <Typography>Last encryption date: {formatTimestampForum(adminGroupSecretKeyPublishDetails?.updated || adminGroupSecretKeyPublishDetails?.created)}</Typography>
        )}
        <Button onClick={createCommonSecretForAdmins} variant="contained">Publish admin secret key</Button>
      </Box>
    </Box>
  )
}
