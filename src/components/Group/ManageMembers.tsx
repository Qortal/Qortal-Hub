import * as React from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import ListItemText from '@mui/material/ListItemText';
import ListItemButton from '@mui/material/ListItemButton';
import List from '@mui/material/List';
import Divider from '@mui/material/Divider';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import Slide from '@mui/material/Slide';
import { TransitionProps } from '@mui/material/transitions';
import ListOfMembers from './ListOfMembers';
import { InviteMember } from './InviteMember';
import { ListOfInvites } from './ListOfInvites';
import { ListOfBans } from './ListOfBans';
import { ListOfJoinRequests } from './ListOfJoinRequests';
import { Box, ButtonBase, Card, Tab, Tabs } from '@mui/material';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { MyContext, getBaseApiReact, isMobile } from '../../App';
import { getGroupMembers, getNames } from './Group';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { getFee } from '../../background';
import { LoadingButton } from '@mui/lab';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { Spacer } from '../../common/Spacer';
import InsertLinkIcon from '@mui/icons-material/InsertLink';
function a11yProps(index: number) {
  return {
    id: `simple-tab-${index}`,
    'aria-controls': `simple-tabpanel-${index}`,
  };
}

const Transition = React.forwardRef(function Transition(
  props: TransitionProps & {
    children: React.ReactElement;
  },
  ref: React.Ref<unknown>
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

export const ManageMembers = ({
  address,
  open,
  setOpen,
  selectedGroup,

  isAdmin,
  isOwner,
}) => {
  const [membersWithNames, setMembersWithNames] = React.useState([]);
  const [tab, setTab] = React.useState('create');
  const [value, setValue] = React.useState(0);
  const [openSnack, setOpenSnack] = React.useState(false);
  const [infoSnack, setInfoSnack] = React.useState(null);
  const [isLoadingMembers, setIsLoadingMembers] = React.useState(false);
  const [isLoadingLeave, setIsLoadingLeave] = React.useState(false);
  const [groupInfo, setGroupInfo] = React.useState(null);
  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };
  const { show, setTxList } = React.useContext(MyContext);

  const handleClose = () => {
    setOpen(false);
  };

  const handleLeaveGroup = async () => {
    try {
      setIsLoadingLeave(true);
      const fee = await getFee('LEAVE_GROUP');
      await show({
        message: 'Would you like to perform an LEAVE_GROUP transaction?',
        publishFee: fee.fee + ' QORT',
      });

      await new Promise((res, rej) => {
        window
          .sendMessage('leaveGroup', {
            groupId: selectedGroup?.groupId,
          })
          .then((response) => {
            if (!response?.error) {
              setTxList((prev) => [
                {
                  ...response,
                  type: 'leave-group',
                  label: `Left Group ${selectedGroup?.groupName}: awaiting confirmation`,
                  labelDone: `Left Group ${selectedGroup?.groupName}: success!`,
                  done: false,
                  groupId: selectedGroup?.groupId,
                },
                ...prev,
              ]);
              res(response);
              setInfoSnack({
                type: 'success',
                message:
                  'Successfully requested to leave group. It may take a couple of minutes for the changes to propagate',
              });
              setOpenSnack(true);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(error.message || 'An error occurred');
          });
      });
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoadingLeave(false);
    }
  };

  const getMembersWithNames = React.useCallback(async (groupId) => {
    try {
      setIsLoadingMembers(true);
      const res = await getGroupMembers(groupId);
      const resWithNames = await getNames(res.members);
      setMembersWithNames(resWithNames);
      setIsLoadingMembers(false);
    } catch (error) {
      console.log(error);
    }
  }, []);

  const getMembers = async (groupId) => {
    try {
      const res = await getGroupMembers(groupId);
      setMembersWithNames(res?.members || []);
    } catch (error) {
      console.log(error);
    }
  };
  const getGroupInfo = async (groupId) => {
    try {
      const response = await fetch(`${getBaseApiReact()}/groups/${groupId}`);
      const groupData = await response.json();
      setGroupInfo(groupData);
    } catch (error) {
      console.log(error);
    }
  };

  React.useEffect(() => {
    if (selectedGroup?.groupId) {
      getMembers(selectedGroup?.groupId);
      getGroupInfo(selectedGroup?.groupId);
    }
  }, [selectedGroup?.groupId]);

  const openGroupJoinRequestFunc = () => {
    setValue(4);
  };

  React.useEffect(() => {
    subscribeToEvent('openGroupJoinRequest', openGroupJoinRequestFunc);

    return () => {
      unsubscribeFromEvent('openGroupJoinRequest', openGroupJoinRequestFunc);
    };
  }, []);

  return (
    <React.Fragment>
      <Dialog
        fullScreen
        open={open}
        onClose={handleClose}
        TransitionComponent={Transition}
      >
        <AppBar sx={{ position: 'relative', bgcolor: '#232428' }}>
          <Toolbar>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
              Manage Members
            </Typography>
            <IconButton
              edge="start"
              color="inherit"
              onClick={handleClose}
              aria-label="close"
            >
              <CloseIcon />
            </IconButton>
          </Toolbar>
        </AppBar>
        <Box
          sx={{
            bgcolor: '#27282c',
            flexGrow: 1,
            overflowY: 'auto',
            color: 'white',
          }}
        >
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs
              value={value}
              onChange={handleChange}
              aria-label="basic tabs example"
              variant="scrollable" // Make tabs scrollable
              scrollButtons="auto" // Show scroll buttons automatically
              allowScrollButtonsMobile // Show scroll buttons on mobile as well
              sx={{
                '& .MuiTabs-indicator': {
                  backgroundColor: 'white',
                },
                maxWidth: '100%', // Ensure the tabs container fits within the available space
                overflow: 'hidden', // Prevents overflow on small screens
              }}
            >
              <Tab
                label="List of members"
                {...a11yProps(0)}
                sx={{
                  '&.Mui-selected': {
                    color: 'white',
                  },
                  fontSize: isMobile ? '0.75rem' : '1rem', // Adjust font size for mobile
                }}
              />
              <Tab
                label="Invite new member"
                {...a11yProps(1)}
                sx={{
                  '&.Mui-selected': {
                    color: 'white',
                  },
                  fontSize: isMobile ? '0.75rem' : '1rem',
                }}
              />
              <Tab
                label="List of invites"
                {...a11yProps(2)}
                sx={{
                  '&.Mui-selected': {
                    color: 'white',
                  },
                  fontSize: isMobile ? '0.75rem' : '1rem',
                }}
              />
              <Tab
                label="List of bans"
                {...a11yProps(3)}
                sx={{
                  '&.Mui-selected': {
                    color: 'white',
                  },
                  fontSize: isMobile ? '0.75rem' : '1rem',
                }}
              />
              <Tab
                label="Join requests"
                {...a11yProps(4)}
                sx={{
                  '&.Mui-selected': {
                    color: 'white',
                  },
                  fontSize: isMobile ? '0.75rem' : '1rem',
                }}
              />
            </Tabs>
          </Box>
          <Card
            sx={{
              padding: '10px',
              cursor: 'default',
            }}
          >
            <Box>
              <Typography>GroupId: {groupInfo?.groupId}</Typography>
              <Typography>GroupName: {groupInfo?.groupName}</Typography>
              <Typography>
                Number of members: {groupInfo?.memberCount}
              </Typography>
              <ButtonBase
                sx={{
                  gap: '10px',
                }}
                onClick={async () => {
                  const link = `qortal://use-group/action-join/groupid-${groupInfo?.groupId}`;
                  await navigator.clipboard.writeText(link);
                }}
              >
                <InsertLinkIcon /> <Typography>Join Group Link</Typography>
              </ButtonBase>
            </Box>
            <Spacer height="20px" />
            {selectedGroup?.groupId && !isOwner && (
              <LoadingButton
                size="small"
                loading={isLoadingLeave}
                loadingPosition="start"
                variant="contained"
                onClick={handleLeaveGroup}
              >
                Leave Group
              </LoadingButton>
            )}
          </Card>
          {value === 0 && (
            <Box
              sx={{
                width: '100%',
                padding: '25px',
                maxWidth: '750px',
              }}
            >
              <Button
                variant="contained"
                onClick={() => getMembersWithNames(selectedGroup?.groupId)}
              >
                Load members with names
              </Button>
              <Spacer height="10px" />
              <ListOfMembers
                members={membersWithNames || []}
                groupId={selectedGroup?.groupId}
                setOpenSnack={setOpenSnack}
                setInfoSnack={setInfoSnack}
                isAdmin={isAdmin}
                isOwner={isOwner}
                show={show}
              />
            </Box>
          )}
          {value === 1 && (
            <Box
              sx={{
                width: '100%',
                padding: '25px',
                maxWidth: '750px',
              }}
            >
              <InviteMember
                show={show}
                groupId={selectedGroup?.groupId}
                setOpenSnack={setOpenSnack}
                setInfoSnack={setInfoSnack}
              />
            </Box>
          )}

          {value === 2 && (
            <Box
              sx={{
                width: '100%',
                padding: '25px',
                maxWidth: '750px',
              }}
            >
              <ListOfInvites
                show={show}
                groupId={selectedGroup?.groupId}
                setOpenSnack={setOpenSnack}
                setInfoSnack={setInfoSnack}
              />
            </Box>
          )}

          {value === 3 && (
            <Box
              sx={{
                width: '100%',
                padding: '25px',
                maxWidth: '750px',
              }}
            >
              <ListOfBans
                show={show}
                groupId={selectedGroup?.groupId}
                setOpenSnack={setOpenSnack}
                setInfoSnack={setInfoSnack}
              />
            </Box>
          )}

          {value === 4 && (
            <Box
              sx={{
                width: '100%',
                padding: '25px',
                maxWidth: '750px',
              }}
            >
              <ListOfJoinRequests
                show={show}
                setOpenSnack={setOpenSnack}
                setInfoSnack={setInfoSnack}
                groupId={selectedGroup?.groupId}
              />
            </Box>
          )}
        </Box>
        <CustomizedSnackbars
          open={openSnack}
          setOpen={setOpenSnack}
          info={infoSnack}
          setInfo={setInfoSnack}
        />
        <LoadingSnackbar
          open={isLoadingMembers}
          info={{
            message: 'Loading member list with names... please wait.',
          }}
        />
      </Dialog>
    </React.Fragment>
  );
};
