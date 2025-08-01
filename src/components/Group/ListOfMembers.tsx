import {
  Avatar,
  Box,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Popover,
  Typography,
  useTheme,
} from '@mui/material';
import { useRef, useState } from 'react';
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
} from 'react-virtualized';
import { LoadingButton } from '@mui/lab';
import { getFee } from '../../background/background.ts';
import { getBaseApiReact } from '../../App';
import { useTranslation } from 'react-i18next';

const cache = new CellMeasurerCache({
  fixedWidth: true,
  defaultHeight: 50,
});

const ListOfMembers = ({
  members,
  groupId,
  setInfoSnack,
  setOpenSnack,
  isAdmin,
  isOwner,
  show,
}) => {
  const [popoverAnchor, setPopoverAnchor] = useState(null); // Track which list item the popover is anchored to
  const [openPopoverIndex, setOpenPopoverIndex] = useState(null); // Track which list item has the popover open
  const [isLoadingKick, setIsLoadingKick] = useState(false);
  const [isLoadingBan, setIsLoadingBan] = useState(false);
  const [isLoadingMakeAdmin, setIsLoadingMakeAdmin] = useState(false);
  const [isLoadingRemoveAdmin, setIsLoadingRemoveAdmin] = useState(false);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const listRef = useRef(null);

  const handlePopoverOpen = (event, index) => {
    setPopoverAnchor(event.currentTarget);
    setOpenPopoverIndex(index);
  };

  const handlePopoverClose = () => {
    setPopoverAnchor(null);
    setOpenPopoverIndex(null);
  };

  const handleKick = async (address) => {
    try {
      const fee = await getFee('GROUP_KICK');
      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'GROUP_KICK',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      setIsLoadingKick(true);
      new Promise((res, rej) => {
        window
          .sendMessage('kickFromGroup', {
            groupId,
            qortalAddress: address,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_kick', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });
              setOpenSnack(true);
              handlePopoverClose();
              res(response);
              return;
            }
            setInfoSnack({
              type: 'error',
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
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
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoadingKick(false);
    }
  };

  const handleBan = async (address) => {
    try {
      const fee = await getFee('GROUP_BAN');

      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'GROUP_BAN',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      setIsLoadingBan(true);

      await new Promise((res, rej) => {
        window
          .sendMessage('banFromGroup', {
            groupId,
            qortalAddress: address,
            rBanTime: 0,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_ban', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });
              setOpenSnack(true);
              handlePopoverClose();
              res(response);
              return;
            }
            setInfoSnack({
              type: 'error',
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
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
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoadingBan(false);
    }
  };

  const makeAdmin = async (address) => {
    try {
      const fee = await getFee('ADD_GROUP_ADMIN');
      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'ADD_GROUP_ADMIN',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });
      setIsLoadingMakeAdmin(true);
      await new Promise((res, rej) => {
        window
          .sendMessage('makeAdmin', {
            groupId,
            qortalAddress: address,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_member_admin', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });
              setOpenSnack(true);
              handlePopoverClose();
              res(response);
              return;
            }
            setInfoSnack({
              type: 'error',
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
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
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoadingMakeAdmin(false);
    }
  };

  const removeAdmin = async (address) => {
    try {
      const fee = await getFee('REMOVE_GROUP_ADMIN');
      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'REMOVE_GROUP_ADMIN',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });
      setIsLoadingRemoveAdmin(true);
      await new Promise((res, rej) => {
        window
          .sendMessage('removeAdmin', {
            groupId,
            qortalAddress: address,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_remove_member', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });
              setOpenSnack(true);
              handlePopoverClose();
              res(response);
              return;
            }
            setInfoSnack({
              type: 'error',
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
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
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoadingRemoveAdmin(false);
    }
  };

  const rowRenderer = ({ index, key, parent, style }) => {
    const member = members[index];

    return (
      <CellMeasurer
        key={key}
        cache={cache}
        parent={parent}
        columnIndex={0}
        rowIndex={index}
      >
        {({ measure }) => (
          <div style={style} onLoad={measure}>
            {isOwner && (
              <Popover
                open={openPopoverIndex === index}
                anchorEl={popoverAnchor}
                onClose={handlePopoverClose}
                anchorOrigin={{
                  vertical: 'bottom',
                  horizontal: 'center',
                }}
                transformOrigin={{
                  vertical: 'top',
                  horizontal: 'center',
                }}
                style={{ marginTop: '8px' }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    height: '250px',
                    padding: '10px',
                    width: '325px',
                  }}
                >
                  {isOwner && (
                    <>
                      <LoadingButton
                        loading={isLoadingKick}
                        loadingPosition="start"
                        variant="contained"
                        onClick={() => handleKick(member?.member)}
                      >
                        {t('group:action.kick_member', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </LoadingButton>

                      <LoadingButton
                        loading={isLoadingBan}
                        loadingPosition="start"
                        variant="contained"
                        onClick={() => handleBan(member?.member)}
                      >
                        {t('group:action.ban', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </LoadingButton>

                      <LoadingButton
                        loading={isLoadingMakeAdmin}
                        loadingPosition="start"
                        variant="contained"
                        onClick={() => makeAdmin(member?.member)}
                      >
                        {t('group:action.make_admin', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </LoadingButton>

                      <LoadingButton
                        loading={isLoadingRemoveAdmin}
                        loadingPosition="start"
                        variant="contained"
                        onClick={() => removeAdmin(member?.member)}
                      >
                        {t('group:action.remove_admin', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </LoadingButton>
                    </>
                  )}
                </Box>
              </Popover>
            )}

            <ListItem key={member?.member} disablePadding>
              <ListItemButton
                onClick={(event) => handlePopoverOpen(event, index)}
              >
                <ListItemAvatar>
                  <Avatar
                    alt={member?.name || member?.member}
                    src={
                      member?.name
                        ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${member?.name}/qortal_avatar?async=true`
                        : ''
                    }
                  />
                </ListItemAvatar>

                <ListItemText
                  id={member?.name || member?.member}
                  primary={member?.name || member?.member}
                />
                {member?.isAdmin && (
                  <Typography
                    sx={{
                      color: theme.palette.text.primary,
                      marginLeft: 'auto',
                    }}
                  >
                    {t('core:admin', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                )}
              </ListItemButton>
            </ListItem>
          </div>
        )}
      </CellMeasurer>
    );
  };

  return (
    <div>
      <p>
        {t('core:list.members', {
          postProcess: 'capitalizeFirstChar',
        })}
      </p>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 1,
          height: '500px',
          position: 'relative',
          width: '100%',
        }}
      >
        <AutoSizer>
          {({ height, width }) => (
            <List
              deferredMeasurementCache={cache}
              height={height}
              ref={listRef}
              rowCount={members.length}
              rowHeight={cache.rowHeight}
              rowRenderer={rowRenderer}
              width={width}
            />
          )}
        </AutoSizer>
      </div>
    </div>
  );
};

export default ListOfMembers;
