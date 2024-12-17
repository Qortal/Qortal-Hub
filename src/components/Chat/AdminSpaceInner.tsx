import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  MyContext,
  getArbitraryEndpointReact,
  getBaseApiReact,
} from "../../App";
import { Box, Button, Typography } from "@mui/material";
import {
  decryptResource,
  getPublishesFromAdmins,
  validateSecretKey,
} from "../Group/Group";
import { getFee } from "../../background";
import { base64ToUint8Array } from "../../qdn/encryption/group-encryption";
import { uint8ArrayToObject } from "../../backgroundFunctions/encryption";
import { formatTimestampForum } from "../../utils/time";
import { Spacer } from "../../common/Spacer";

export const getPublishesFromAdminsAdminSpace = async (
  admins: string[],
  groupId
) => {
  const queryString = admins.map((name) => `name=${name}`).join("&");
  const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT_PRIVATE&identifier=admins-symmetric-qchat-group-${groupId}&exactmatchnames=true&limit=0&reverse=true&${queryString}&prefix=true`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("network error");
  }
  const adminData = await response.json();

  const filterId = adminData.filter(
    (data: any) => data.identifier === `admins-symmetric-qchat-group-${groupId}`
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

export const AdminSpaceInner = ({
  selectedGroup,
  adminsWithNames,
  setIsForceShowCreationKeyPopup,
}) => {
  const [adminGroupSecretKey, setAdminGroupSecretKey] = useState(null);
  const [isFetchingAdminGroupSecretKey, setIsFetchingAdminGroupSecretKey] =
    useState(true);
  const [isFetchingGroupSecretKey, setIsFetchingGroupSecretKey] =
    useState(true);
  const [
    adminGroupSecretKeyPublishDetails,
    setAdminGroupSecretKeyPublishDetails,
  ] = useState(null);
  const [groupSecretKeyPublishDetails, setGroupSecretKeyPublishDetails] =
    useState(null);
  const [isLoadingPublishKey, setIsLoadingPublishKey] = useState(false);
  const { show, setTxList, setInfoSnackCustom, setOpenSnackGlobal } =
    useContext(MyContext);

  const getAdminGroupSecretKey = useCallback(async () => {
    try {
      if (!selectedGroup) return;
      const getLatestPublish = await getPublishesFromAdminsAdminSpace(
        adminsWithNames.map((admin) => admin?.name),
        selectedGroup
      );
      if (getLatestPublish === false) return;
      let data;

      const res = await fetch(
        `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${
          getLatestPublish.name
        }/${getLatestPublish.identifier}?encoding=base64`
      );
      data = await res.text();

      const decryptedKey: any = await decryptResource(data);
      const dataint8Array = base64ToUint8Array(decryptedKey.data);
      const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
      if (!validateSecretKey(decryptedKeyToObject))
        throw new Error("SecretKey is not valid");
      setAdminGroupSecretKey(decryptedKeyToObject);
      setAdminGroupSecretKeyPublishDetails(getLatestPublish);
    } catch (error) {
    } finally {
      setIsFetchingAdminGroupSecretKey(false);
    }
  }, [adminsWithNames, selectedGroup]);

  const getGroupSecretKey = useCallback(async () => {
    try {
      if (!selectedGroup) return;
      const getLatestPublish = await getPublishesFromAdmins(
        adminsWithNames.map((admin) => admin?.name),
        selectedGroup
      );
      if (getLatestPublish === false) setGroupSecretKeyPublishDetails(false);
      setGroupSecretKeyPublishDetails(getLatestPublish);
    } catch (error) {
    } finally {
      setIsFetchingGroupSecretKey(false);
    }
  }, [adminsWithNames, selectedGroup]);

  const createCommonSecretForAdmins = async () => {
    try {
      const fee = await getFee("ARBITRARY");
      await show({
        message: "Would you like to perform an ARBITRARY transaction?",
        publishFee: fee.fee + " QORT",
      });
      setIsLoadingPublishKey(true);

      window
        .sendMessage("encryptAndPublishSymmetricKeyGroupChatForAdmins", {
          groupId: selectedGroup,
          previousData: null,
          admins: adminsWithNames,
        })
        .then((response) => {
          if (!response?.error) {
            setInfoSnackCustom({
              type: "success",
              message:
                "Successfully re-encrypted secret key. It may take a couple of minutes for the changes to propagate. Refresh the group in 5 mins.",
            });
            setOpenSnackGlobal(true);
            return;
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
    } catch (error) {}
  };

  useEffect(() => {
    getAdminGroupSecretKey();
    getGroupSecretKey();
  }, [getAdminGroupSecretKey, getGroupSecretKey]);
  return (
    <Box
      sx={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "10px",
        alignItems: 'center'
      }}
    >
       <Typography sx={{
          fontSize: '14px'
        }}>Reminder: After publishing the key, it will take a couple of minutes for it to appear. Please just wait.</Typography>
      <Spacer height="25px" />
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          width: "300px",
          maxWidth: "90%",
          padding: '10px',
          border: '1px solid gray',
          borderRadius: '6px'
        }}
      >
        {isFetchingGroupSecretKey && (
          <Typography>Fetching Group secret key publishes</Typography>
        )}
        {!isFetchingGroupSecretKey &&
          groupSecretKeyPublishDetails === false && (
            <Typography>No secret key published yet</Typography>
          )}
        {groupSecretKeyPublishDetails && (
          <Typography>
            Last encryption date:{" "}
            {formatTimestampForum(
              groupSecretKeyPublishDetails?.updated ||
                groupSecretKeyPublishDetails?.created
            )}{" "}
            {` by ${groupSecretKeyPublishDetails?.name}`}
          </Typography>
        )}
        <Button disabled={isFetchingGroupSecretKey} onClick={()=> setIsForceShowCreationKeyPopup(true)} variant="contained">
          Publish group secret key
        </Button>
        <Spacer height="20px" />
        <Typography sx={{
          fontSize: '14px'
        }}>This key is to encrypt GROUP related content. This is the only one used in this UI as of now. All group members will be able to see content encrypted with this key.</Typography>
      </Box>
      <Spacer height="25px" />
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          width: "300px",
          maxWidth: "90%",
          padding: '10px',
          border: '1px solid gray',
          borderRadius: '6px'
        }}
      >
        {isFetchingAdminGroupSecretKey && (
          <Typography>Fetching Admins secret key</Typography>
        )}
        {!isFetchingAdminGroupSecretKey && !adminGroupSecretKey && (
          <Typography>No secret key published yet</Typography>
        )}
        {adminGroupSecretKeyPublishDetails && (
          <Typography>
            Last encryption date:{" "}
            {formatTimestampForum(
              adminGroupSecretKeyPublishDetails?.updated ||
                adminGroupSecretKeyPublishDetails?.created
            )}
          </Typography>
        )}
        <Button disabled={isFetchingAdminGroupSecretKey} onClick={createCommonSecretForAdmins} variant="contained">
          Publish admin secret key
        </Button>
        <Spacer height="20px" />
        <Typography sx={{
          fontSize: '14px'
        }}>This key is to encrypt ADMIN related content. Only admins would see content encrypted with it.</Typography>
      </Box>
    </Box>
  );
};
