import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { useContext, useEffect, useState } from 'react';
import { getBaseApiReact, QORTAL_APP_CONTEXT } from '../../App';
import { Spacer } from '../../common/Spacer';
import CloseIcon from '@mui/icons-material/Close';

import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { validateAddress } from '../../utils/validateAddress';
import { getNameInfo, requestQueueMemberNames } from './Group';
import { useModal } from '../../hooks/useModal';
import { isOpenBlockedModalAtom } from '../../atoms/global';
import InfoIcon from '@mui/icons-material/Info';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

export const BlockedUsersModal = () => {
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const [isOpenBlockedModal, setIsOpenBlockedModal] = useAtom(
    isOpenBlockedModalAtom
  );
  const [hasChanged, setHasChanged] = useState(false);
  const [value, setValue] = useState('');
  const [addressesWithNames, setAddressesWithNames] = useState({});
  const { isShow, onCancel, onOk, show, message } = useModal();
  const {
    getAllBlockedUsers,
    removeBlockFromList,
    addToBlockList,
    setOpenSnackGlobal,
    setInfoSnackCustom,
  } = useContext(QORTAL_APP_CONTEXT);

  const [blockedUsers, setBlockedUsers] = useState({
    addresses: {},
    names: {},
  });

  const fetchBlockedUsers = () => {
    setBlockedUsers(getAllBlockedUsers());
  };

  useEffect(() => {
    if (!isOpenBlockedModal) return;
    fetchBlockedUsers();
  }, [isOpenBlockedModal]);

  const getNames = async () => {
    const addresses = Object.keys(blockedUsers?.addresses);
    const addressNames = {};

    const getMemNames = addresses.map(async (address) => {
      const name = await requestQueueMemberNames.enqueue(() => {
        return getNameInfo(address);
      });
      if (name) {
        addressNames[address] = name;
      }

      return true;
    });

    await Promise.all(getMemNames);

    setAddressesWithNames(addressNames);
  };

  const blockUser = async (e, user?: string) => {
    try {
      const valUser = user || value;
      if (!valUser) return;
      const isAddress = validateAddress(valUser);
      let userName = null;
      let userAddress = null;
      if (isAddress) {
        userAddress = valUser;
        const name = await getNameInfo(valUser);
        if (name) {
          userName = name;
        }
      }
      if (!isAddress) {
        const response = await fetch(`${getBaseApiReact()}/names/${valUser}`);
        const data = await response.json();
        if (!data?.owner)
          throw new Error(
            t('auth:message.error.name_not_existing', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        if (data?.owner) {
          userAddress = data.owner;
          userName = valUser;
        }
      }
      if (!userName) {
        await addToBlockList(userAddress, null);
        fetchBlockedUsers();
        setHasChanged(true);
        executeEvent('updateChatMessagesWithBlocks', true);
        setValue('');
        return;
      }
      const responseModal = await show({
        userName,
        userAddress,
      });
      if (responseModal === 'both') {
        await addToBlockList(userAddress, userName);
      } else if (responseModal === 'address') {
        await addToBlockList(userAddress, null);
      } else if (responseModal === 'name') {
        await addToBlockList(null, userName);
      }
      fetchBlockedUsers();
      setHasChanged(true);
      setValue('');
      if (user) {
        setIsOpenBlockedModal(false);
      }
      if (responseModal === 'both' || responseModal === 'address') {
        executeEvent('updateChatMessagesWithBlocks', true);
      }
    } catch (error) {
      if (error?.isCanceled) {
        // user pressed Escape or canceled — do nothing
        return;
      }
      setOpenSnackGlobal(true);
      setInfoSnackCustom({
        type: 'error',
        message:
          error?.message ||
          t('auth:message.error.block_user', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
    }
  };

  const blockUserFromOutsideModalFunc = (e) => {
    const user = e.detail?.user;
    setIsOpenBlockedModal(true);
    blockUser(null, user);
  };

  useEffect(() => {
    subscribeToEvent('blockUserFromOutside', blockUserFromOutsideModalFunc);

    return () => {
      unsubscribeFromEvent(
        'blockUserFromOutside',
        blockUserFromOutsideModalFunc
      );
    };
  }, []);

  return (
    <Dialog
      aria-describedby="alert-dialog-description"
      aria-labelledby="alert-dialog-title"
      onClose={onCancel}
      open={isOpenBlockedModal}
    >
      <DialogTitle
        sx={{
          color: theme.palette.text.primary,
          fontWeight: 'bold',
          opacity: 1,
          textAlign: 'center',
        }}
      >
        {t('auth:blocked_users', { postProcess: 'capitalizeAll' })}
      </DialogTitle>

      <DialogContent
        sx={{
          padding: '20px',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '10px',
          }}
        >
          <TextField
            placeholder={t('auth:message.generic.name_address', {
              postProcess: 'capitalizeFirstChar',
            })}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
            }}
          />
          <Button
            sx={{
              flexShrink: 0,
            }}
            variant="contained"
            onClick={blockUser}
          >
            {t('auth:action.block', { postProcess: 'capitalizeFirstChar' })}
          </Button>
        </Box>

        {Object.entries(blockedUsers?.addresses).length > 0 && (
          <>
            <Spacer height="20px" />

            <DialogContentText id="alert-dialog-description">
              {t('auth:message.generic.blocked_addresses', {
                postProcess: 'capitalizeFirstChar',
              })}
            </DialogContentText>

            <Spacer height="10px" />

            <Button variant="contained" size="small" onClick={getNames}>
              {t('auth:action.fetch_names', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>

            <Spacer height="10px" />
          </>
        )}

        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {Object.entries(blockedUsers?.addresses || {})?.map(
            ([key, value]) => {
              return (
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: '10px',
                    justifyContent: 'space-between',
                    width: '100%',
                  }}
                >
                  <Typography>{addressesWithNames[key] || key}</Typography>
                  <Button
                    sx={{
                      flexShrink: 0,
                    }}
                    size="small"
                    variant="contained"
                    onClick={async () => {
                      try {
                        await removeBlockFromList(key, undefined);
                        setHasChanged(true);
                        setValue('');
                        fetchBlockedUsers();
                      } catch (error) {
                        console.error(error);
                      }
                    }}
                  >
                    {t('auth:action.unblock', {
                      postProcess: 'capitalizeFirstChar',
                    })}
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
              {t('auth:message.generic.blocked_names', {
                postProcess: 'capitalizeFirstChar',
              })}
            </DialogContentText>

            <Spacer height="10px" />
          </>
        )}

        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {Object.entries(blockedUsers?.names || {})?.map(([key, value]) => {
            return (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: '10px',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <Typography>{key}</Typography>

                <Button
                  size="small"
                  sx={{
                    flexShrink: 0,
                  }}
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
                  {t('auth:action.unblock', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              </Box>
            );
          })}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button
          sx={{
            backgroundColor: theme.palette.background.default,
            color: theme.palette.text.primary,
            fontWeight: 'bold',
            opacity: 0.7,
            '&:hover': {
              backgroundColor: theme.palette.background.paper,
              color: theme.palette.text.primary,
              opacity: 1,
            },
          }}
          variant="contained"
          onClick={() => {
            if (hasChanged) {
              executeEvent('updateChatMessagesWithBlocks', true);
            }
            setIsOpenBlockedModal(false);
          }}
        >
          {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
        </Button>
      </DialogActions>

      <Dialog
        open={isShow}
        onClose={onCancel}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle
          id="alert-dialog-title"
          sx={{
            textAlign: 'center',
            color: theme.palette.text.primary,
            fontWeight: 'bold',
            opacity: 1,
          }}
        >
          {t('auth:message.generic.decide_block', {
            postProcess: 'capitalizeAll',
          })}
        </DialogTitle>
        <IconButton
          aria-label={t('core:action.close', {
            postProcess: 'capitalizeFirstChar',
          })}
          onClick={onCancel}
          sx={{
            bgcolor: theme.palette.background.default,
            color: theme.palette.text.primary,
            position: 'absolute',
            right: 8,
            top: 8,
          }}
        >
          <CloseIcon />
        </IconButton>
        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            {t('auth:message.generic.blocking', {
              name: message?.userName || message?.userAddress,
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogContentText>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '10px',
              marginTop: '20px',
            }}
          >
            <InfoIcon
              sx={{
                color: theme.palette.text.primary,
              }}
            />
            <Typography>
              {t('auth:message.generic.choose_block', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        </DialogContent>

        <DialogActions>
          <Button
            variant="contained"
            onClick={() => {
              onOk('address');
            }}
          >
            {t('auth:action.block_txs', { postProcess: 'capitalizeFirstChar' })}
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              onOk('name');
            }}
          >
            {t('auth:action.block_data', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              onOk('both');
            }}
          >
            {t('auth:action.block_all', { postProcess: 'capitalizeFirstChar' })}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};
