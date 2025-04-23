import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { useContext, useEffect, useState } from 'react';
import { getBaseApiReact, MyContext } from '../../App';
import { Spacer } from '../../common/Spacer';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { validateAddress } from '../../utils/validateAddress';
import { getNameInfo, requestQueueMemberNames } from './Group';
import { useModal } from '../../common/useModal';
import { useRecoilState } from 'recoil';
import { isOpenBlockedModalAtom } from '../../atoms/global';
import InfoIcon from '@mui/icons-material/Info';

export const BlockedUsersModal = () => {
  const theme = useTheme();
  const [isOpenBlockedModal, setIsOpenBlockedModal] = useRecoilState(
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
  } = useContext(MyContext);

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
    // const validApi = await findUsableApi();
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
        if (!data?.owner) throw new Error('Name does not exist');
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
      setOpenSnackGlobal(true); // TODO translate
      setInfoSnackCustom({
        type: 'error',
        message: error?.message || 'Unable to block user',
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
      open={isOpenBlockedModal}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
    >
      <DialogTitle>Blocked Users</DialogTitle>
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
            placeholder="Name or address"
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
            Block
          </Button>
        </Box>

        {Object.entries(blockedUsers?.addresses).length > 0 && (
          <>
            <Spacer height="20px" />
            <DialogContentText id="alert-dialog-description">
              Blocked addresses- blocks processing of txs
            </DialogContentText>
            <Spacer height="10px" />
            <Button variant="contained" size="small" onClick={getNames}>
              Fetch names
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
                    Unblock
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
              Blocked names for QDN
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
                  Unblock
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
          close
        </Button>
      </DialogActions>

      <Dialog
        open={isShow}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle id="alert-dialog-title">
          {'Decide what to block'}
        </DialogTitle>

        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            Blocking {message?.userName || message?.userAddress}
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
            />{' '}
            <Typography>
              Choose "block txs" or "all" to block chat messages{' '}
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
            Block txs
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              onOk('name');
            }}
          >
            Block QDN data
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              onOk('both');
            }}
          >
            Block All
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};
