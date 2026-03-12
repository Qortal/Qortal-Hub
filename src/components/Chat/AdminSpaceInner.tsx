import { useCallback, useContext, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { userInfoAtom, balanceAtom } from '../../atoms/global';
import {
  QORTAL_APP_CONTEXT,
  getArbitraryEndpointReact,
  getBaseApiReact,
  pauseAllQueues,
} from '../../App';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import {
  decryptResource,
  getAllPublishesFromAdmins,
  getPublishesFromAdmins,
  validateSecretKey,
} from '../Group/Group';
import { getFee } from '../../background/background.ts';
import { base64ToUint8Array } from '../../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../../encryption/encryption.ts';
import { formatTimestampForum } from '../../utils/time';
import { Spacer } from '../../common/Spacer';
import { GroupAvatar } from './GroupAvatar';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useSetAtom } from 'jotai';
import {
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
  txListAtom,
} from '../../atoms/global';
import { LoadingButton } from '@mui/lab';

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
  isOwner,
}) => {
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
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
  const [groupKeyPublishSelectOpen, setGroupKeyPublishSelectOpen] =
    useState(false);
  const [groupKeyPublishList, setGroupKeyPublishList] = useState([]);
  const [loadingGroupKeyPublishList, setLoadingGroupKeyPublishList] =
    useState(false);
  const [selectedPublishForGroupKey, setSelectedPublishForGroupKey] =
    useState(null);
  const [isPublishingGroupKey, setIsPublishingGroupKey] = useState(false);
  const [groupKeyPublishConfirmOpen, setGroupKeyPublishConfirmOpen] =
    useState(false);
  const setTxList = useSetAtom(txListAtom);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const setInfoSnackCustom = useSetAtom(infoSnackGlobalAtom);
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

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

  const openGroupKeyPublishSelect = useCallback(async () => {
    setGroupKeyPublishSelectOpen(true);
    setLoadingGroupKeyPublishList(true);
    setSelectedPublishForGroupKey(null);
    try {
      const list = await getAllPublishesFromAdmins(
        adminsWithNames.map((admin) => admin?.name),
        selectedGroup
      );
      setGroupKeyPublishList(Array.isArray(list) ? list : []);
    } catch (e) {
      console.log(e);
      setGroupKeyPublishList([]);
    } finally {
      setLoadingGroupKeyPublishList(false);
    }
  }, [adminsWithNames, selectedGroup]);

  const publishGroupKeyFromSelection = useCallback(async () => {
    if (!selectedPublishForGroupKey) return;
    const publish = selectedPublishForGroupKey;
    try {
      const fee = await getFee('ARBITRARY');
      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'ARBITRARY',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });
      setIsPublishingGroupKey(true);
      pauseAllQueues();
      const res = await fetch(
        `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${publish.identifier}?encoding=base64&rebuild=true`
      );
      const data = await res.text();
      const decryptedKey = await decryptResource(data);
      const dataint8Array = base64ToUint8Array(decryptedKey.data);
      const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
      if (!validateSecretKey(decryptedKeyToObject))
        throw new Error(
          t('auth:message.error.invalid_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      const secretKeyToSend = decryptedKeyToObject;
      window
        .sendMessage('encryptAndPublishSymmetricKeyGroupChat', {
          groupId: selectedGroup,
          previousData: secretKeyToSend,
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
            setTxList((prev) => [
              {
                ...response,
                type: 'created-common-secret',
                label: t('group:message.success.published_secret_key', {
                  group_id: selectedGroup,
                  postProcess: 'capitalizeFirstChar',
                }),
                labelDone: t('group:message.success.published_secret_key_label', {
                  group_id: selectedGroup,
                  postProcess: 'capitalizeFirstChar',
                }),
                done: false,
                groupId: selectedGroup,
              },
              ...prev,
            ]);
            setGroupKeyPublishSelectOpen(false);
            setSelectedPublishForGroupKey(null);
            getGroupSecretKey();
          } else {
            setInfoSnackCustom({
              type: 'error',
              message:
                response?.error ||
                t('auth:message.error.reencrypt_secret_key', {
                  postProcess: 'capitalizeFirstChar',
                }),
            });
            setOpenSnackGlobal(true);
          }
          setIsPublishingGroupKey(false);
        })
        .catch((error) => {
          console.error(
            'Failed to encrypt and publish symmetric key for group chat:',
            error?.message || 'An error occurred'
          );
          setInfoSnackCustom({
            type: 'error',
            message:
              error?.message ||
              t('auth:message.error.reencrypt_secret_key', {
                postProcess: 'capitalizeFirstChar',
              }),
          });
          setOpenSnackGlobal(true);
          setIsPublishingGroupKey(false);
        });
    } catch (error) {
      console.log(error);
      setIsPublishingGroupKey(false);
    }
  }, [
    selectedPublishForGroupKey,
    selectedGroup,
    show,
    t,
    setInfoSnackCustom,
    setOpenSnackGlobal,
    setTxList,
    getGroupSecretKey,
  ]);

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
        {t('auth:message.generic.publishing_key', {
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
          disabled={!isOwner}
          onClick={openGroupKeyPublishSelect}
          variant="contained"
        >
          {isOwner
            ? t('auth:action.publish_group_secret_key', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('auth:action.only_owner', {
                postProcess: 'capitalizeFirstChar',
              })}
        </Button>

        <Dialog
          open={groupKeyPublishSelectOpen}
          onClose={() => {
            if (!isPublishingGroupKey) {
              setGroupKeyPublishSelectOpen(false);
              setSelectedPublishForGroupKey(null);
            }
          }}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            {t('auth:message.generic.select_publish_to_update_from', {
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogTitle>
          <DialogContent>
            {loadingGroupKeyPublishList ? (
              <Typography>
                {t('auth:message.generic.fetching_group_secret_key', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            ) : groupKeyPublishList.length === 0 ? (
              <Typography>
                {t('auth:message.generic.no_secret_key_published', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            ) : (
              <List dense>
                {groupKeyPublishList.map((publish) => {
                  const ts =
                    publish?.updated ?? publish?.created ?? 0;
                  const dateNum =
                    typeof ts === 'number' ? ts : new Date(ts).getTime();
                  const label = `${formatTimestampForum(dateNum)} by ${publish?.name ?? ''}`;
                  return (
                    <ListItemButton
                      key={`${publish.name}-${dateNum}`}
                      selected={
                        selectedPublishForGroupKey?.name === publish.name &&
                        (selectedPublishForGroupKey?.updated ??
                          selectedPublishForGroupKey?.created) === ts
                      }
                      onClick={() => setSelectedPublishForGroupKey(publish)}
                    >
                      <ListItemText primary={label} />
                    </ListItemButton>
                  );
                })}
              </List>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setGroupKeyPublishSelectOpen(false);
                setSelectedPublishForGroupKey(null);
              }}
              disabled={isPublishingGroupKey}
            >
              {t('core:action.cancel', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
            <LoadingButton
              variant="contained"
              loading={isPublishingGroupKey}
              onClick={() => setGroupKeyPublishConfirmOpen(true)}
              disabled={!selectedPublishForGroupKey}
            >
              {t('core:action.publish', {
                postProcess: 'capitalizeFirstChar',
              })}
            </LoadingButton>
          </DialogActions>
        </Dialog>

        <Dialog
          open={groupKeyPublishConfirmOpen}
          onClose={() => !isPublishingGroupKey && setGroupKeyPublishConfirmOpen(false)}
        >
          <DialogTitle>
            {t('auth:message.generic.confirm_publish_group_secret_key', {
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogTitle>
          <DialogContent>
            <Typography>
              {t('auth:message.generic.confirm_publish_group_secret_key_body', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setGroupKeyPublishConfirmOpen(false)}
              disabled={isPublishingGroupKey}
            >
              {t('core:action.cancel', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                setGroupKeyPublishConfirmOpen(false);
                publishGroupKeyFromSelection();
              }}
              disabled={isPublishingGroupKey}
            >
              {t('core:action.confirm', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </DialogActions>
        </Dialog>

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
              name: adminGroupSecretKeyPublishDetails?.name,
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
