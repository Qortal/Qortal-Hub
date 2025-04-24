import {
  Box,
  ListItem,
  ListItemButton,
  ListItemText,
  Popover,
  Typography,
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
  const { txList, setTxList, show } = useContext(MyContext);
  const [invites, setInvites] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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
      const fee = await getFee('JOIN_GROUP'); // TODO translate
      await show({
        message: 'Would you like to perform an JOIN_GROUP transaction?',
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
                message:
                  'Successfully requested to join group. It may take a couple of minutes for the changes to propagate',
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
              message: error.message || 'An error occurred',
            });
            setOpenSnack(true);
            rej(error);
          });
      });
    } catch (error) {
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
                    width: '325px',
                    height: '250px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px',
                  }}
                >
                  <Typography>Join {invite?.groupName}</Typography>
                  <LoadingButton
                    loading={isLoading}
                    loadingPosition="start"
                    variant="contained"
                    onClick={() =>
                      handleJoinGroup(invite?.groupId, invite?.groupName)
                    }
                  >
                    Join group
                  </LoadingButton>
                </Box>
              </Popover>
              <ListItemButton
                onClick={(event) => handlePopoverOpen(event, index)}
              >
                {invite?.isOpen === false && (
                  <LockIcon
                    sx={{
                      color: 'var(--green)',
                    }}
                  />
                )}
                {invite?.isOpen === true && (
                  <NoEncryptionGmailerrorredIcon
                    sx={{
                      color: 'var(--danger)',
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
      <p>Invite list</p>
      <div
        style={{
          position: 'relative',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
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
