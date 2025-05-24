import { useCallback, useContext, useEffect, useState } from 'react';
import {
  QORTAL_APP_CONTEXT,
  getArbitraryEndpointReact,
  getBaseApiReact,
} from '../../App';
import { Box, Button, Typography } from '@mui/material';
import {
  decryptResource,
  getPublishesFromAdmins,
  validateSecretKey,
} from '../Group/Group';
import { getFee } from '../../background';
import { base64ToUint8Array } from '../../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../../backgroundFunctions/encryption';
import { formatTimestampForum } from '../../utils/time';
import { Spacer } from '../../common/Spacer';
import { GroupAvatar } from './GroupAvatar';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';

export const getPublishesFromAdminsAdminSpace = async (
  admins: string[],
  groupId
) => {
  const queryString = admins.map((name) => `name=${name}`).join('&');
  const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT_PRIVATE&identifier=admins-symmetric-qchat-group-${groupId}&exactmatchnames=true&limit=0&reverse=true&${queryString}&prefix=true`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(i18next.t('core:message.error.network_generic'));
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
  balance,
  userInfo,
  isOwner,
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
  const { show, setInfoSnackCustom, setOpenSnackGlobal } =
    useContext(QORTAL_APP_CONTEXT);
  const { t } = useTranslation(['auth', 'core', 'group']);

  const getAdminGroupSecretKey = useCallback(async () => {
    try {
      if (!selectedGroup) return;
      const getLatestPublish = await getPublishesFromAdminsAdminSpace(
        adminsWithNames.map((admin) => admin?.name),
        selectedGroup
      );
      if (getLatestPublish === false) return;

      const res = await fetch(
        `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${
          getLatestPublish.name
        }/${getLatestPublish.identifier}?encoding=base64&rebuild=true`
      );

      const data = await res.text();
      const decryptedKey: any = await decryptResource(data);
      const dataint8Array = base64ToUint8Array(decryptedKey.data);
      const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);

      if (!validateSecretKey(decryptedKeyToObject))
        throw new Error(
          t('auth:message.error.invalid_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      setAdminGroupSecretKey(decryptedKeyToObject);
      setAdminGroupSecretKeyPublishDetails(getLatestPublish);
    } catch (error) {
      console.log(error);
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
      console.log(error);
    } finally {
      setIsFetchingGroupSecretKey(false);
    }
  }, [adminsWithNames, selectedGroup]);

  const createCommonSecretForAdmins = async () => {
    try {
      const fee = await getFee('ARBITRARY');

      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'ARBITRARY',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      setIsLoadingPublishKey(true);

      window
        .sendMessage('encryptAndPublishSymmetricKeyGroupChatForAdmins', {
          groupId: selectedGroup,
          previousData: adminGroupSecretKey,
          admins: adminsWithNames,
        })
        .then((response) => {
          if (!response?.error) {
            setInfoSnackCustom({
              type: 'success',
              message: t('auth:message.success.reencrypted_secret_key', {
                postProcess: 'capitalizeFirstChar',
              }),
            });
            setOpenSnackGlobal(true);
            return;
          }
          setInfoSnackCustom({
            type: 'error',
            message:
              response?.error ||
              t('auth:message.error.reencrypt_secret_key', {
                postProcess: 'capitalizeFirstChar',
              }),
          });
          setOpenSnackGlobal(true);
        })
        .catch((error) => {
          setInfoSnackCustom({
            type: 'error',
            message:
              error?.message ||
              t('auth:message.error.reencrypt_secret_key', {
                postProcess: 'capitalizeFirstChar',
              }),
          });
          setOpenSnackGlobal(true);
        });
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    getAdminGroupSecretKey();
    getGroupSecretKey();
  }, [getAdminGroupSecretKey, getGroupSecretKey]);
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        padding: '10px',
        width: '100%',
      }}
    >
      <Typography
        sx={{
          fontSize: '14px',
        }}
      >
        {t('auth:message.error.publishing_key', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>

      <Spacer height="25px" />

      <Box
        sx={{
          border: '1px solid gray',
          borderRadius: '6px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          maxWidth: '90%',
          padding: '10px',
          width: '300px',
        }}
      >
        {isFetchingGroupSecretKey && (
          <Typography>
            {t('auth:message.generic.fetching_group_secret_key', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        )}

        {!isFetchingGroupSecretKey &&
          groupSecretKeyPublishDetails === false && (
            <Typography>
              {t('auth:message.generic.no_secret_key_published', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )}

        {groupSecretKeyPublishDetails && (
          <Typography>
            {t('auth:message.generic.last_encryption_date', {
              date: formatTimestampForum(
                groupSecretKeyPublishDetails?.updated ||
                  groupSecretKeyPublishDetails?.created
              ),
              name: groupSecretKeyPublishDetails?.name,
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        )}

        <Button
          disabled={isFetchingGroupSecretKey}
          onClick={() => setIsForceShowCreationKeyPopup(true)}
          variant="contained"
        >
          {t('auth:action.publish_group_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>

        <Spacer height="20px" />

        <Typography
          sx={{
            fontSize: '14px',
          }}
        >
          {t('auth:tips.key_encrypt_group', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      </Box>

      <Spacer height="25px" />

      <Box
        sx={{
          border: '1px solid gray',
          borderRadius: '6px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          maxWidth: '90%',
          padding: '10px',
          width: '300px',
        }}
      >
        {isFetchingAdminGroupSecretKey && (
          <Typography>
            {t('auth:message.generic.fetching_admin_secret_key', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        )}

        {!isFetchingAdminGroupSecretKey && !adminGroupSecretKey && (
          <Typography>
            {t('auth:message.generic.no_secret_key_published', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        )}

        {adminGroupSecretKeyPublishDetails && (
          <Typography>
            {t('auth:message.generic.last_encryption_date', {
              date: formatTimestampForum(
                adminGroupSecretKeyPublishDetails?.updated ||
                  adminGroupSecretKeyPublishDetails?.created
              ),
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        )}

        <Button
          disabled={isFetchingAdminGroupSecretKey}
          onClick={createCommonSecretForAdmins}
          variant="contained"
        >
          {t('auth:action.publish_admin_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>

        <Spacer height="20px" />

        <Typography
          sx={{
            fontSize: '14px',
          }}
        >
          {t('auth:tips.key_encrypt_admin', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      </Box>

      <Spacer height="25px" />

      {isOwner && (
        <Box
          sx={{
            border: '1px solid gray',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            maxWidth: '90%',
            padding: '10px',
            width: '300px',
            alignItems: 'center',
          }}
        >
          <Typography>
            {t('group:group.avatar', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

          <GroupAvatar
            setOpenSnack={setOpenSnackGlobal}
            setInfoSnack={setInfoSnackCustom}
            myName={userInfo?.name}
            balance={balance}
            groupId={selectedGroup}
          />
        </Box>
      )}
    </Box>
  );
};
