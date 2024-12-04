import { Box, Button, Typography } from '@mui/material'
import React, { useContext } from 'react'
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { LoadingButton } from '@mui/lab';
import { MyContext, getArbitraryEndpointReact, getBaseApiReact, pauseAllQueues } from '../../App';
import { getFee } from '../../background';
import { decryptResource, getGroupAdmins, validateSecretKey } from '../Group/Group';
import { base64ToUint8Array } from '../../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../../backgroundFunctions/encryption';

export const CreateCommonSecret = ({groupId, secretKey, isOwner,  myAddress, secretKeyDetails, userInfo, noSecretKey, setHideCommonKeyPopup}) => {
  const { show, setTxList } = useContext(MyContext);

  const [openSnack, setOpenSnack] = React.useState(false);
  const [infoSnack, setInfoSnack] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(false)

  const getPublishesFromAdmins = async (admins: string[]) => {
    // const validApi = await findUsableApi();
    const queryString = admins.map((name) => `name=${name}`).join("&");
    const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT_PRIVATE&identifier=symmetric-qchat-group-${
      groupId
    }&exactmatchnames=true&limit=0&reverse=true&${queryString}&prefix=true`;
    const response = await fetch(url);
    if(!response.ok){
      throw new Error('network error')
    }
    const adminData = await response.json();
 
    const filterId = adminData.filter(
      (data: any) =>
        data.identifier === `symmetric-qchat-group-${groupId}`
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
  const getSecretKey = async (loadingGroupParam?: boolean, secretKeyToPublish?: boolean) => {
    try {
      pauseAllQueues()
      
     
     
      const {names} = await getGroupAdmins(groupId);
      if(!names.length){
        throw new Error('Network error')
      }
      const publish = await getPublishesFromAdmins(names);
   
     
      if (publish === false) {
       
        return false;
      }
    
      const res = await fetch(
        `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${
          publish.identifier
        }?encoding=base64`
      );
      const data = await res.text();
   
      const decryptedKey: any = await decryptResource(data);
    
      const dataint8Array = base64ToUint8Array(decryptedKey.data);
      const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
     
      if (!validateSecretKey(decryptedKeyToObject))
        throw new Error("SecretKey is not valid");
     
      if (decryptedKeyToObject) {
        
        return decryptedKeyToObject;
      } else {
      }
     
    } catch (error) {
  
    
    } finally {
    }
  };

    const createCommonSecret = async ()=> {
        try {
          const fee = await getFee('ARBITRARY')
          await show({
            message: "Would you like to perform an ARBITRARY transaction?" ,
            publishFee: fee.fee + ' QORT'
          })
          setIsLoading(true)

          const secretKey2 = await getSecretKey()
          if((!secretKey2 && secretKey2 !== false)) throw new Error('invalid secret key')
          if (secretKey2 && !validateSecretKey(secretKey2)) throw new Error('invalid secret key')

          const secretKeyToSend = !secretKey2 ? null : secretKey2
       
 
          window.sendMessage("encryptAndPublishSymmetricKeyGroupChat", {
            groupId: groupId,
            previousData: secretKeyToSend,
          })
            .then((response) => {
              if (!response?.error) {
                setInfoSnack({
                  type: "success",
                  message: "Successfully re-encrypted secret key. It may take a couple of minutes for the changes to propagate. Refresh the group in 5 mins.",
                });
                setOpenSnack(true);
                setTxList((prev) => [
                  {
                    ...response,
                    type: 'created-common-secret',
                    label: `Published secret key for group ${groupId}: awaiting confirmation`,
                    labelDone: `Published secret key for group ${groupId}: success!`,
                    done: false,
                    groupId,
                  },
                  ...prev,
                ]);
              }
              setIsLoading(false);
            })
            .catch((error) => {
              console.error("Failed to encrypt and publish symmetric key for group chat:", error.message || "An error occurred");
              setIsLoading(false);
            });
          
        } catch (error) {
            
        }
    }


  return (
    <Box sx={{
      padding: '25px',
      display: 'flex',
      flexDirection: 'column',
      gap: '25px',
      maxWidth: '350px',
      background: '#444444'
    }}>
      <LoadingButton loading={isLoading} loadingPosition="start" color="warning" variant='contained' onClick={createCommonSecret}>Re-encrypt key</LoadingButton>
      {noSecretKey ? (
         <Box>
         <Typography>There is no group secret key. Be the first admin to publish one!</Typography>
       </Box>
      ) : isOwner && secretKeyDetails && userInfo?.name && userInfo.name !== secretKeyDetails?.name  ? (
        <Box>
        <Typography>The latest group secret key was published by a non-owner. As the owner of the group please re-encrypt the key as a safeguard</Typography>
      </Box>
      ): (
        <Box>
        <Typography>The group member list has changed. Please re-encrypt the secret key.</Typography>
      </Box>
      )}
      <Box sx={{
        display: 'flex',
        width: '100%',
        justifyContent: 'flex-end'
      }}>
        <Button onClick={()=> {
          setHideCommonKeyPopup(true)
        }} size='small'>Hide</Button>
      </Box>
        <CustomizedSnackbars open={openSnack} setOpen={setOpenSnack} info={infoSnack} setInfo={setInfoSnack}  />
    </Box>
    
  )
}
