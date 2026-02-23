import {
  Box,
  Button,
  ListItem,
  ListItemButton,
  ListItemText,
  Popover,
  Typography,
  useTheme,
} from '@mui/material';
import { useContext, useEffect, useRef, useState } from 'react';
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
} from 'react-virtualized';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import { LoadingButton } from '@mui/lab';
import { getFee } from '../../background/background.ts';
import LockIcon from '@mui/icons-material/Lock';
import NoEncryptionGmailerrorredIcon from '@mui/icons-material/NoEncryptionGmailerrorred';
import { Spacer } from '../../common/Spacer';
import { useSetAtom } from 'jotai';
import { txListAtom } from '../../atoms/global';
import { useTranslation } from 'react-i18next';

const cache = new CellMeasurerCache({
  fixedWidth: true,
  defaultHeight: 50,
});

const getGroupInfo = async (groupId) => {
  const response = await fetch(`${getBaseApiReact()}/groups/` + groupId);
  const groupData = await response.json();

  if (groupData) {
    return groupData;
  }
};
export const getGroupNames = async (listOfGroups) => {
  let groups = [];
  if (listOfGroups && Array.isArray(listOfGroups)) {
    for (const group of listOfGroups) {
      const groupInfo = await getGroupInfo(group.groupId);
      if (groupInfo) {
        groups.push({ ...group, ...groupInfo });
      }
    }
  }
  return groups;
};

export const UserListOfInvites = ({
  myAddress,
  setInfoSnack,
  setOpenSnack,
}) => {
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const setTxList = useSetAtom(txListAtom);

  const [invites, setInvites] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const [popoverAnchor, setPopoverAnchor] = useState(null); // Track which list item the popover is anchored to
  const [openPopoverIndex, setOpenPopoverIndex] = useState(null); // Track which list item has the popover open
  const listRef = useRef(null);

  const getRequests = async () => {
    try {
      const response = await fetch(
        `${getBaseApiReact()}/groups/invites/${myAddress}/?limit=0`
      );
      const inviteData = await response.json();

      const resMoreData = await getGroupNames(inviteData);
      setInvites(resMoreData);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    getRequests();
  }, []);

  const handlePopoverOpen = (event, index) => {
    setPopoverAnchor(event.currentTarget);
    setOpenPopoverIndex(index);
  };

  const handlePopoverClose = () => {
    setPopoverAnchor(null);
    setOpenPopoverIndex(null);
  };

  const handleJoinGroup = async (groupId, groupName) => {
    try {
      const fee = await getFee('JOIN_GROUP');

      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'JOIN_GROUP',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      setIsLoading(true);

      await new Promise((res, rej) => {
        window
          .sendMessage('joinGroup', {
            groupId,
          })
          .then((response) => {
            if (!response?.error) {
              setTxList((prev) => [
                {
                  ...response,
                  type: 'joined-group',
                  label: `Joined Group ${groupName}: awaiting confirmation`,
                  labelDone: `Joined Group ${groupName}: success!`,
                  done: false,
                  groupId,
                },
                ...prev,
              ]);
              res(response);
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_join', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });
              setOpenSnack(true);
              handlePopoverClose();
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
      setIsLoading(false);
    }
  };

  const rowRenderer = ({ index, key, parent, style }) => {
    const invite = invites[index];

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
            <ListItem disablePadding>
              <Popover
                open={openPopoverIndex === index}
                anchorEl={popoverAnchor}
                onClose={handlePopoverClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                transformOrigin={{ vertical: 'top', horizontal: 'center' }}
                slotProps={{
                  paper: {
                    sx: {
                      mt: 1,
                      borderRadius: '16px',
                      overflow: 'hidden',
                      boxShadow: theme.shadows[8],
                      border: `1px solid ${theme.palette.divider}`,
                      minWidth: 280,
                      maxWidth: 360,
                    },
                  },
                }}
              >
                <Box
                  sx={{
                    overflow: 'hidden',
                    bgcolor: theme.palette.background.paper,
                  }}
                >
                  <Box
                    sx={{
                      px: 2.5,
                      pt: 2.5,
                      pb: 1.5,
                      bgcolor: theme.palette.background?.default ?? 'rgba(0,0,0,0.2)',
                      borderBottom: `1px solid ${theme.palette.divider}`,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                      {t('group:group.name', { postProcess: 'capitalizeFirstChar' })}
                    </Typography>
                    <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.3 }}>
                      {invite?.groupName}
                    </Typography>
                    {(invite?.participantCount != null || invite?.memberCount != null) && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                        {t('group:group.member_number', { postProcess: 'capitalizeFirstChar' })}:{' '}
                        {invite?.participantCount ?? invite?.memberCount ?? 0}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ px: 2.5, py: 2 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mb: 0.75, fontWeight: 600 }}
                    >
                      {t('group:group.description', { postProcess: 'capitalizeFirstChar', defaultValue: 'Description' })}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        color: theme.palette.text.secondary,
                        lineHeight: 1.5,
                        minHeight: '2em',
                        display: '-webkit-box',
                        WebkitLineClamp: 4,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {invite?.description ||
                        t('group:message.generic.no_description', { postProcess: 'capitalizeFirstChar', defaultValue: 'No description' })}
                    </Typography>
                    {invite?.isOpen === false && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        {t('group:message.generic.closed_group', { postProcess: 'capitalizeFirstChar' })}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ px: 2.5, pb: 2.5, pt: 0, display: 'flex', gap: 1.5, justifyContent: 'flex-end' }}>
                    <Button
                      variant="outlined"
                      onClick={handlePopoverClose}
                      sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '10px' }}
                    >
                      {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
                    </Button>
                    <LoadingButton
                      loading={isLoading}
                      loadingPosition="start"
                      variant="contained"
                      onClick={() => handleJoinGroup(invite?.groupId, invite?.groupName)}
                      sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '10px' }}
                    >
                      {t('group:action.join_group', { postProcess: 'capitalizeFirstChar' })}
                    </LoadingButton>
                  </Box>
                </Box>
              </Popover>

              <ListItemButton
                onClick={(event) => handlePopoverOpen(event, index)}
              >
                {invite?.isOpen === false && (
                  <LockIcon
                    sx={{
                      color: theme.palette.other.positive,
                    }}
                  />
                )}
                {invite?.isOpen === true && (
                  <NoEncryptionGmailerrorredIcon
                    sx={{
                      color: theme.palette.other.danger,
                    }}
                  />
                )}

                <Spacer width="15px" />

                <ListItemText
                  primary={invite?.groupName}
                  secondary={invite?.description}
                />
              </ListItemButton>
            </ListItem>
          </div>
        )}
      </CellMeasurer>
    );
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
      }}
    >
      <p>
        {t('core:list.invites', {
          postProcess: 'capitalizeFirstChar',
        })}
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          position: 'relative',
          width: '100%',
        }}
      >
        <AutoSizer>
          {({ height, width }) => (
            <List
              ref={listRef}
              width={width}
              height={height}
              rowCount={invites.length}
              rowHeight={cache.rowHeight}
              rowRenderer={rowRenderer}
              deferredMeasurementCache={cache}
            />
          )}
        </AutoSizer>
      </div>
    </Box>
  );
};
