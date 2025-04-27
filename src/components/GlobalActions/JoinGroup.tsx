import React, { useContext, useEffect, useMemo, useState } from 'react';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Typography,
  useTheme,
} from '@mui/material';
import { CustomButton, CustomButtonAccept } from '../../styles/App-styles';
import { getBaseApiReact, MyContext } from '../../App';
import { getFee } from '../../background';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { FidgetSpinner } from 'react-loader-spinner';

export const JoinGroup = ({ memberGroups }) => {
  const { show, setTxList } = useContext(MyContext);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [groupInfo, setGroupInfo] = useState(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const theme = useTheme();
  const [isLoadingJoinGroup, setIsLoadingJoinGroup] = useState(false);
  const handleJoinGroup = async (e) => {
    setGroupInfo(null);
    const groupId = e?.detail?.groupId;
    if (groupId) {
      try {
        setIsOpen(true);
        setIsLoadingInfo(true);
        const response = await fetch(`${getBaseApiReact()}/groups/${groupId}`);
        const groupData = await response.json();
        setGroupInfo(groupData);
      } catch (error) {
      } finally {
        setIsLoadingInfo(false);
      }
    }
  };

  useEffect(() => {
    subscribeToEvent('globalActionJoinGroup', handleJoinGroup);

    return () => {
      unsubscribeFromEvent('globalActionJoinGroup', handleJoinGroup);
    };
  }, []);

  const isInGroup = useMemo(() => {
    return !!memberGroups.find(
      (item) => +item?.groupId === +groupInfo?.groupId
    );
  }, [memberGroups, groupInfo]);
  const joinGroup = async (group, isOpen) => {
    try {
      const groupId = group.groupId;
      const fee = await getFee('JOIN_GROUP');
      await show({
        message: 'Would you like to perform an JOIN_GROUP transaction?',
        publishFee: fee.fee + ' QORT',
      });
      setIsLoadingJoinGroup(true);
      await new Promise((res, rej) => {
        window
          .sendMessage('joinGroup', {
            groupId,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: 'success',
                message:
                  'Successfully requested to join group. It may take a couple of minutes for the changes to propagate',
              });

              if (isOpen) {
                setTxList((prev) => [
                  {
                    ...response,
                    type: 'joined-group',
                    label: `Joined Group ${group?.groupName}: awaiting confirmation`,
                    labelDone: `Joined Group ${group?.groupName}: success!`,
                    done: false,
                    groupId,
                  },
                  ...prev,
                ]);
              } else {
                setTxList((prev) => [
                  {
                    ...response,
                    type: 'joined-group-request',
                    label: `Requested to join Group ${group?.groupName}: awaiting confirmation`,
                    labelDone: `Requested to join Group ${group?.groupName}: success!`,
                    done: false,
                    groupId,
                  },
                  ...prev,
                ]);
              }

              setOpenSnack(true);
              res(response);
              return;
            } else {
              setInfoSnack({
                type: 'error',
                message: response?.error,
              });
              setOpenSnack(true);
              rej(response.error);
            }
          })
          .catch((error) => {
            setInfoSnack({
              type: 'error',
              message: error.message || 'An error occurred',
            });
            setOpenSnack(true);
            rej(error);
          });
      });
      setIsLoadingJoinGroup(false);
    } catch (error) {
    } finally {
      setIsLoadingJoinGroup(false);
    }
  };
  return (
    <>
      <Dialog
        open={isOpen}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogContent>
          {!groupInfo && (
            <Box
              sx={{
                width: '325px',
                height: '150px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {' '}
              <CircularProgress
                size={25}
                sx={{
                  color: theme.palette.text.primary,
                }}
              />{' '}
            </Box>
          )}
          <Box
            sx={{
              width: '325px',
              height: 'auto',
              maxHeight: '400px',
              display: !groupInfo ? 'none' : 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
              padding: '10px',
            }}
          >
            <Typography
              sx={{
                fontSize: '15px',
                fontWeight: 600,
              }}
            >
              Group name: {` ${groupInfo?.groupName}`}
            </Typography>
            <Typography
              sx={{
                fontSize: '15px',
                fontWeight: 600,
              }}
            >
              Number of members: {` ${groupInfo?.memberCount}`}
            </Typography>
            {groupInfo?.description && (
              <Typography
                sx={{
                  fontSize: '15px',
                  fontWeight: 600,
                }}
              >
                {groupInfo?.description}
              </Typography>
            )}
            {isInGroup && (
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                *You are already in this group!
              </Typography>
            )}
            {!isInGroup && groupInfo?.isOpen === false && (
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                *This is a closed/private group, so you will need to wait until
                an admin accepts your request
              </Typography>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <ButtonBase
            onClick={() => {
              joinGroup(groupInfo, groupInfo?.isOpen);

              setIsOpen(false);
            }}
            disabled={isInGroup}
          >
            <CustomButtonAccept
              color="black"
              bgColor="var(--green)"
              sx={{
                minWidth: '102px',
                height: '45px',
                fontSize: '16px',
                opacity: isInGroup ? 0.1 : 1,
              }}
            >
              Join
            </CustomButtonAccept>
          </ButtonBase>

          <CustomButtonAccept
            color="black"
            bgColor="var(--danger)"
            sx={{
              minWidth: '102px',
              height: '45px',
            }}
            onClick={() => setIsOpen(false)}
          >
            Close
          </CustomButtonAccept>
        </DialogActions>
      </Dialog>

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
      {isLoadingJoinGroup && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <FidgetSpinner
            visible={true}
            height="80"
            width="80"
            ariaLabel="fidget-spinner-loading"
            wrapperStyle={{}}
            wrapperClass="fidget-spinner-wrapper"
          />
        </Box>
      )}
    </>
  );
};
