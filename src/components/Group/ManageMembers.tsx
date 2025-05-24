import {
  forwardRef,
  Fragment,
  ReactElement,
  Ref,
  SyntheticEvent,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
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
import { Box, ButtonBase, Card, Tab, Tabs, useTheme } from '@mui/material';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import { getGroupMembers, getNames } from './Group';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { getFee } from '../../background/background.ts';
import { LoadingButton } from '@mui/lab';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { Spacer } from '../../common/Spacer';
import InsertLinkIcon from '@mui/icons-material/InsertLink';
import { useSetAtom } from 'jotai';
import { txListAtom } from '../../atoms/global';
import { useTranslation } from 'react-i18next';

function a11yProps(index: number) {
  return {
    id: `simple-tab-${index}`,
    'aria-controls': `simple-tabpanel-${index}`,
  };
}

const Transition = forwardRef(function Transition(
  props: TransitionProps & {
    children: ReactElement;
  },
  ref: Ref<unknown>
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

export const ManageMembers = ({
  open,
  setOpen,
  selectedGroup,
  isAdmin,
  isOwner,
}) => {
  const [membersWithNames, setMembersWithNames] = useState([]);
  const [value, setValue] = useState(0);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isLoadingLeave, setIsLoadingLeave] = useState(false);
  const [groupInfo, setGroupInfo] = useState(null);
  const handleChange = (event: SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const setTxList = useSetAtom(txListAtom);

  const handleClose = () => {
    setOpen(false);
  };

  const handleLeaveGroup = async () => {
    try {
      setIsLoadingLeave(true);
      const fee = await getFee('LEAVE_GROUP');
      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'LEAVE_GROUP',
          postProcess: 'capitalizeFirstChar',
        }),
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
                  label: t('group:message.success.group_leave_name', {
                    group_name: selectedGroup?.groupName,
                    postProcess: 'capitalizeFirstChar',
                  }),
                  labelDone: t('group:message.success.group_leave_label', {
                    group_name: selectedGroup?.groupName,
                    postProcess: 'capitalizeFirstChar',
                  }),
                  done: false,
                  groupId: selectedGroup?.groupId,
                },
                ...prev,
              ]);
              res(response);
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_leave', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });
              setOpenSnack(true);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoadingLeave(false);
    }
  };

  const getMembersWithNames = useCallback(async (groupId) => {
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

  useEffect(() => {
    if (selectedGroup?.groupId) {
      getMembers(selectedGroup?.groupId);
      getGroupInfo(selectedGroup?.groupId);
    }
  }, [selectedGroup?.groupId]);

  const openGroupJoinRequestFunc = () => {
    setValue(4);
  };

  useEffect(() => {
    subscribeToEvent('openGroupJoinRequest', openGroupJoinRequestFunc);

    return () => {
      unsubscribeFromEvent('openGroupJoinRequest', openGroupJoinRequestFunc);
    };
  }, []);

  return (
    <Fragment>
      <Dialog
        fullScreen
        open={open}
        onClose={handleClose}
        TransitionComponent={Transition}
      >
        <AppBar
          sx={{
            position: 'relative',
            bgcolor: theme.palette.background.default,
          }}
        >
          <Toolbar>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h4" component="div">
              {t('group:action.manage_members', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>

            <IconButton
              aria-label={t('core:action.close', {
                postProcess: 'capitalizeFirstChar',
              })}
              color="inherit"
              edge="start"
              onClick={handleClose}
            >
              <CloseIcon />
            </IconButton>
          </Toolbar>
        </AppBar>

        <Box
          sx={{
            bgcolor: theme.palette.background.default,
            color: theme.palette.text.primary,
            flexGrow: 1,
            overflowY: 'auto',
          }}
        >
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs
              value={value}
              onChange={handleChange}
              aria-label={t('core:basic_tabs_example', {
                postProcess: 'capitalizeFirstChar',
              })}
              variant="scrollable" // Make tabs scrollable
              scrollButtons="auto" // Show scroll buttons automatically
              allowScrollButtonsMobile // Show scroll buttons on mobile as well
              sx={{
                '& .MuiTabs-indicator': {
                  backgroundColor: theme.palette.background.default,
                },
                maxWidth: '100%', // Ensure the tabs container fits within the available space
                overflow: 'hidden', // Prevents overflow on small screens
              }}
            >
              <Tab
                label={t('core:list.members', {
                  postProcess: 'capitalizeFirstChar',
                })}
                {...a11yProps(0)}
                sx={{
                  '&.Mui-selected': {
                    color: theme.palette.text.primary,
                  },
                  fontSize: '1rem',
                }}
              />

              <Tab
                label={t('core:action.invite_member', {
                  postProcess: 'capitalizeFirstChar',
                })}
                {...a11yProps(1)}
                sx={{
                  '&.Mui-selected': {
                    color: theme.palette.text.primary,
                  },
                  fontSize: '1rem',
                }}
              />

              <Tab
                label={t('core:list.invites', {
                  postProcess: 'capitalizeFirstChar',
                })}
                {...a11yProps(2)}
                sx={{
                  '&.Mui-selected': {
                    color: theme.palette.text.primary,
                  },
                  fontSize: '1rem',
                }}
              />

              <Tab
                label={t('core:list.bans', {
                  postProcess: 'capitalizeFirstChar',
                })}
                {...a11yProps(3)}
                sx={{
                  '&.Mui-selected': {
                    color: theme.palette.text.primary,
                  },
                  fontSize: '1rem',
                }}
              />

              <Tab
                label={t('group:join_requests', {
                  postProcess: 'capitalizeFirstChar',
                })}
                {...a11yProps(4)}
                sx={{
                  '&.Mui-selected': {
                    color: theme.palette.text.primary,
                  },
                  fontSize: '1rem',
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
              <Typography>
                {t('group:group.id', { postProcess: 'capitalizeFirstChar' })}:{' '}
                {groupInfo?.groupId}
              </Typography>

              <Typography>
                {t('group:group.name', { postProcess: 'capitalizeFirstChar' })}:{' '}
                {groupInfo?.groupName}
              </Typography>

              <Typography>
                {t('group:group.member_number', {
                  postProcess: 'capitalizeFirstChar',
                })}
                : {groupInfo?.memberCount}
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
                <InsertLinkIcon />

                <Typography>
                  {t('group:join_link', { postProcess: 'capitalizeFirstChar' })}
                </Typography>
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
                {t('group:action.leave_group', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </LoadingButton>
            )}
          </Card>

          {value === 0 && (
            <Box
              sx={{
                maxWidth: '750px',
                padding: '25px',
                width: '100%',
              }}
            >
              <Button
                variant="contained"
                onClick={() => getMembersWithNames(selectedGroup?.groupId)}
              >
                {t('group:action.load_members', {
                  postProcess: 'capitalizeFirstChar',
                })}
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
                maxWidth: '750px',
                padding: '25px',
                width: '100%',
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
                maxWidth: '750px',
                padding: '25px',
                width: '100%',
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
                padding: '25px',
                width: '100%',
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
                maxWidth: '750px',
                padding: '25px',
                width: '100%',
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
            message: t('group:message.generic.loading_members', {
              postProcess: 'capitalizeFirstChar',
            }),
          }}
        />
      </Dialog>
    </Fragment>
  );
};
