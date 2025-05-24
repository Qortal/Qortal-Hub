import { useContext, useState } from 'react';
import { Box, Button, Typography, useTheme } from '@mui/material';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { LoadingButton } from '@mui/lab';
import {
  QORTAL_APP_CONTEXT,
  getArbitraryEndpointReact,
  getBaseApiReact,
  pauseAllQueues,
} from '../../App';
import { getFee } from '../../background';
import {
  decryptResource,
  getGroupAdmins,
  validateSecretKey,
} from '../Group/Group';
import { base64ToUint8Array } from '../../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../../backgroundFunctions/encryption';
import { useSetAtom } from 'jotai';
import { txListAtom } from '../../atoms/global';
import { useTranslation } from 'react-i18next';

export const CreateCommonSecret = ({
  groupId,
  secretKey,
  isOwner,
  myAddress,
  secretKeyDetails,
  userInfo,
  noSecretKey,
  setHideCommonKeyPopup,
  setIsForceShowCreationKeyPopup,
  isForceShowCreationKeyPopup,
}) => {
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const setTxList = useSetAtom(txListAtom);

  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group']);

  const getPublishesFromAdmins = async (admins: string[]) => {
    const queryString = admins.map((name) => `name=${name}`).join('&');
    const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT_PRIVATE&identifier=symmetric-qchat-group-${
      groupId
    }&exactmatchnames=true&limit=0&reverse=true&${queryString}&prefix=true`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('network error');
    }
    const adminData = await response.json();

    const filterId = adminData.filter(
      (data: any) => data.identifier === `symmetric-qchat-group-${groupId}`
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

  const getSecretKey = async (
    loadingGroupParam?: boolean,
    secretKeyToPublish?: boolean
  ) => {
    try {
      pauseAllQueues();

      const { names } = await getGroupAdmins(groupId);

      if (!names.length) {
        throw new Error(
          t('core:message.error.network_generic', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      const publish = await getPublishesFromAdmins(names);

      if (publish === false) {
        return false;
      }

      const res = await fetch(
        `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${
          publish.identifier
        }?encoding=base64&rebuild=true`
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

      if (decryptedKeyToObject) {
        return decryptedKeyToObject;
      }
    } catch (error) {
      console.log(error);
    }
  };

  const createCommonSecret = async () => {
    try {
      const fee = await getFee('ARBITRARY');

      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'ARBITRARY',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });
      setIsLoading(true);

      const secretKey2 = await getSecretKey();

      if (!secretKey2 && secretKey2 !== false)
        throw new Error(
          t('auth:message.error.invalid_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );

      if (secretKey2 && !validateSecretKey(secretKey2))
        throw new Error(
          t('auth:message.error.invalid_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );

      const secretKeyToSend = !secretKey2 ? null : secretKey2;

      window
        .sendMessage('encryptAndPublishSymmetricKeyGroupChat', {
          groupId: groupId,
          previousData: secretKeyToSend,
        })
        .then((response) => {
          if (!response?.error) {
            setInfoSnack({
              type: 'success',
              message: t('auth:message.success.reencrypted_secret_key', {
                postProcess: 'capitalizeFirstChar',
              }),
            });
            setOpenSnack(true);
            setTxList((prev) => [
              {
                ...response,
                type: 'created-common-secret',
                label: t('group:message.success.published_secret_key', {
                  group_id: groupId,
                  postProcess: 'capitalizeFirstChar',
                }),
                labelDone: t(
                  'group:message.success.published_secret_key_label',
                  {
                    group_id: groupId,
                    postProcess: 'capitalizeFirstChar',
                  }
                ),
                done: false,
                groupId,
              },
              ...prev,
            ]);
          }
          setIsLoading(false);
          setTimeout(() => {
            setIsForceShowCreationKeyPopup(false);
          }, 1000);
        })
        .catch((error) => {
          console.error(
            'Failed to encrypt and publish symmetric key for group chat:',
            error.message || 'An error occurred'
          );
          setIsLoading(false);
        });
    } catch (error) {
      console.log(error);
    }
  };

  return (
    <Box
      sx={{
        background: theme.palette.background.default,
        display: 'flex',
        flexDirection: 'column',
        gap: '25px',
        maxWidth: '350px',
        padding: '25px',
      }}
    >
      <LoadingButton
        loading={isLoading}
        loadingPosition="start"
        color="warning"
        variant="contained"
        onClick={createCommonSecret}
      >
        {t('auth:action.reencrypt_key', { postProcess: 'capitalizeFirstChar' })}
      </LoadingButton>

      {noSecretKey ? (
        <Box>
          <Typography>
            {t('group:message.generic.group_no_secret_key', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      ) : isOwner &&
        secretKeyDetails &&
        userInfo?.name &&
        userInfo.name !== secretKeyDetails?.name ? (
        <Box>
          <Typography>
            {t('group:message.generic.group_secret_key_no_owner', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      ) : isForceShowCreationKeyPopup ? null : (
        <Box>
          <Typography>
            {t('group:message.generic.group_member_list_changed', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      )}

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          width: '100%',
        }}
      >
        <Button
          onClick={() => {
            setHideCommonKeyPopup(true);
            setIsForceShowCreationKeyPopup(false);
          }}
          size="small"
        >
          {t('core:action.hide', { postProcess: 'capitalizeFirstChar' })}
        </Button>
      </Box>

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </Box>
  );
};
