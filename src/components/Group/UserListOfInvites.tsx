import {
  Box,
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
import { MyContext, getBaseApiReact } from '../../App';
import { LoadingButton } from '@mui/lab';
import { getFee } from '../../background';
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
  const { show } = useContext(MyContext);
  const setTxList = useSetAtom(txListAtom);

  const [invites, setInvites] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group']);
  const [popoverAnchor, setPopoverAnchor] = useState(null); // Track which list item the popover is anchored to
  const [openPopoverIndex, setOpenPopoverIndex] = useState(null); // Track which list item has the popover open
  const listRef = useRef();

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
        message: t('group:question.perform_transaction', {
          action: 'JOIN_GROUP',
          postProcess: 'capitalize',
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
                  postProcess: 'capitalize',
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
                t('core:message.error.generic', { postProcess: 'capitalize' }),
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
                  <Typography>
                    {t('core:action.join', {
                      postProcess: 'capitalize',
                    })}{' '}
                    {invite?.groupName}
                  </Typography>

                  <LoadingButton
                    loading={isLoading}
                    loadingPosition="start"
                    variant="contained"
                    onClick={() =>
                      handleJoinGroup(invite?.groupId, invite?.groupName)
                    }
                  >
                    {t('group:action.join_group', {
                      postProcess: 'capitalize',
                    })}
                  </LoadingButton>
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
        {t('core:invite_list', {
          postProcess: 'capitalize',
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
