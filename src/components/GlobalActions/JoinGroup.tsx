import { useContext, useEffect, useMemo, useState } from 'react';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import {
  Box,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Typography,
  useTheme,
} from '@mui/material';
import { CustomButtonAccept } from '../../styles/App-styles';
import { getBaseApiReact, MyContext } from '../../App';
import { getFee } from '../../background';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { FidgetSpinner } from 'react-loader-spinner';
import { useAtom, useSetAtom } from 'jotai';
import { memberGroupsAtom, txListAtom } from '../../atoms/global';
import { useTranslation } from 'react-i18next';

export const JoinGroup = () => {
  const { show } = useContext(MyContext);
  const setTxList = useSetAtom(txListAtom);
  const [memberGroups] = useAtom(memberGroupsAtom);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [groupInfo, setGroupInfo] = useState(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group']);
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
        console.log(error);
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
        message: t('core:message.question.perform_transaction', {
          action: 'JOIN_GROUP',
          postProcess: 'capitalizeFirstChar',
        }),
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
                message: t('group:message.success.group_join', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });

              if (isOpen) {
                setTxList((prev) => [
                  {
                    ...response,
                    type: 'joined-group',
                    label: t('group:message.success.group_join_label', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    labelDone: t('group:message.success.group_join_label', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
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
                    label: t('group:message.success.group_join_request', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    labelDone: t('group:message.success.group_join_outcome', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
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
              message:
                error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                }),
            });
            setOpenSnack(true);
            rej(error);
          });
      });
      setIsLoadingJoinGroup(false);
    } catch (error) {
      console.log(error);
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
                alignItems: 'center',
                display: 'flex',
                height: '150px',
                justifyContent: 'center',
                width: '325px',
              }}
            >
              <CircularProgress
                size={25}
                sx={{
                  color: theme.palette.text.primary,
                }}
              />
            </Box>
          )}
          <Box
            sx={{
              alignItems: 'center',
              display: !groupInfo ? 'none' : 'flex',
              flexDirection: 'column',
              gap: '10px',
              height: 'auto',
              maxHeight: '400px',
              padding: '10px',
              width: '325px',
            }}
          >
            <Typography
              sx={{
                fontSize: '15px',
                fontWeight: 600,
              }}
            >
              {t('group:group.name', { postProcess: 'capitalizeFirstChar' })}:{' '}
              {` ${groupInfo?.groupName}`}
            </Typography>

            <Typography
              sx={{
                fontSize: '15px',
                fontWeight: 600,
              }}
            >
              {t('group:group.member_number', {
                postProcess: 'capitalizeFirstChar',
              })}
              : {` ${groupInfo?.memberCount}`}
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
                {t('group:message.generic.already_in_group', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            )}
            {!isInGroup && groupInfo?.isOpen === false && (
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                {t('group:message.generic.closed_group', {
                  postProcess: 'capitalizeFirstChar',
                })}
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
              bgColor={theme.palette.other.positive}
              sx={{
                minWidth: '102px',
                height: '45px',
                fontSize: '16px',
                opacity: isInGroup ? 0.1 : 1,
              }}
            >
              {t('core:action.join', {
                postProcess: 'capitalizeFirstChar',
              })}
            </CustomButtonAccept>
          </ButtonBase>

          <CustomButtonAccept
            color="black"
            bgColor={theme.palette.other.danger}
            sx={{
              minWidth: '102px',
              height: '45px',
            }}
            onClick={() => setIsOpen(false)}
          >
            {t('core:action.close', {
              postProcess: 'capitalizeFirstChar',
            })}
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
            alignItems: 'center',
            bottom: 0,
            display: 'flex',
            justifyContent: 'center',
            left: 0,
            position: 'absolute',
            right: 0,
            top: 0,
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
