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
import CloseIcon from '@mui/icons-material/Close';
import Slide from '@mui/material/Slide';
import { TransitionProps } from '@mui/material/transitions';
import ListOfMembers from './ListOfMembers';
import { InviteMember } from './InviteMember';
import { ListOfInvites } from './ListOfInvites';
import { ListOfBans } from './ListOfBans';
import { ListOfJoinRequests } from './ListOfJoinRequests';
import {
  Box,
  ButtonBase,
  Card,
  Divider,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
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
import { QORTAL_PROTOCOL } from '../../constants/constants.ts';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';

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
  inline = false,
  open,
  setOpen,
  selectedGroup,
  isAdmin,
  isOwner,
  reticulumSidebar = false,
  isPrivate = false,
  joinRequestCount = 0,
  onJoinRequestCountChange,
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
  const canManageMembers = Boolean(isAdmin || isOwner);
  const canReviewJoinRequests =
    reticulumSidebar && isPrivate && (isAdmin || isOwner);

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

  useEffect(() => {
    if (
      (!canManageMembers && value !== 0) ||
      (!canReviewJoinRequests && value === 4)
    ) {
      setValue(0);
    }
  }, [canManageMembers, canReviewJoinRequests, value]);

  if (inline && reticulumSidebar) {
    const iconTabs = [
      {
        icon: <PeopleAltRoundedIcon sx={{ fontSize: 19 }} />,
        label: 'Members',
        showNotificationDot: false,
      },
      {
        icon: <AddRoundedIcon sx={{ fontSize: 20 }} />,
        label: 'Invite Member',
        showNotificationDot: false,
      },
      {
        icon: <FormatListBulletedRoundedIcon sx={{ fontSize: 19 }} />,
        label: 'Invites',
        showNotificationDot: false,
      },
      {
        icon: <BlockRoundedIcon sx={{ fontSize: 19 }} />,
        label: 'Bans',
        showNotificationDot: false,
      },
      ...(canReviewJoinRequests
        ? [
            {
              icon: <CheckCircleRoundedIcon sx={{ fontSize: 19 }} />,
              label: 'Join Requests',
              showNotificationDot: joinRequestCount > 0,
            },
          ]
        : []),
    ];

    const panelContentSx = {
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
      p: value === 1 ? 1.25 : 0,
    };

    return (
      <Box
        sx={{
          backgroundColor: theme.palette.background.surface,
          color: theme.palette.text.primary,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          width: '100%',
        }}
      >
        {canManageMembers && <Tabs
          value={value}
          onChange={handleChange}
          variant="fullWidth"
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            minHeight: 42,
            '& .MuiTab-root': {
              color: 'text.secondary',
              minHeight: 42,
              minWidth: 0,
              p: 0,
            },
            '& .Mui-selected': {
              color: 'primary.main',
            },
          }}
        >
          {iconTabs.map((tab, index) => (
            <Tab
              key={tab.label}
              icon={
                <Tooltip title={tab.label}>
                  <Box
                    component="span"
                    sx={{
                      display: 'inline-flex',
                      position: 'relative',
                    }}
                  >
                    {tab.icon}
                    {tab.showNotificationDot && (
                      <Box
                        aria-hidden
                        component="span"
                        sx={{
                          backgroundColor: '#f23f42',
                          border: `2px solid ${theme.palette.background.surface}`,
                          borderRadius: '50%',
                          bottom: -3,
                          boxSizing: 'content-box',
                          height: 7,
                          left: -4,
                          pointerEvents: 'none',
                          position: 'absolute',
                          width: 7,
                        }}
                      />
                    )}
                  </Box>
                </Tooltip>
              }
              aria-label={tab.label}
              {...a11yProps(index)}
            />
          ))}
        </Tabs>}

        <Box sx={panelContentSx}>
          {value === 0 && (
            <ListOfMembers
              compact
              members={membersWithNames || []}
              groupId={selectedGroup?.groupId}
              setOpenSnack={setOpenSnack}
              setInfoSnack={setInfoSnack}
              isAdmin={isAdmin}
              isOwner={isOwner}
              show={show}
              ownerAddress={groupInfo?.owner}
              reticulumUserCards
            />
          )}
          {canManageMembers && value === 1 && (
            <InviteMember
              show={show}
              groupId={selectedGroup?.groupId}
              setOpenSnack={setOpenSnack}
              setInfoSnack={setInfoSnack}
            />
          )}
          {canManageMembers && value === 2 && (
            <ListOfInvites
              compact
              show={show}
              groupId={selectedGroup?.groupId}
              setOpenSnack={setOpenSnack}
              setInfoSnack={setInfoSnack}
            />
          )}
          {canManageMembers && value === 3 && (
            <ListOfBans
              compact
              show={show}
              groupId={selectedGroup?.groupId}
              setOpenSnack={setOpenSnack}
              setInfoSnack={setInfoSnack}
            />
          )}
          {canManageMembers && value === 4 && (
            <ListOfJoinRequests
              compact
              show={show}
              setOpenSnack={setOpenSnack}
              setInfoSnack={setInfoSnack}
              groupId={selectedGroup?.groupId}
              onCountChange={onJoinRequestCountChange}
            />
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
      </Box>
    );
  }

  const content = (
    <Fragment>
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
              variant="scrollable" // Make tabs scrollable
              scrollButtons="auto" // Show scroll buttons automatically
              allowScrollButtonsMobile // Show scroll buttons on mobile as well
              sx={{
                '&.MuiTabs-indicator': {
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
                  const link = `${QORTAL_PROTOCOL}use-group/action-join/groupid-${groupInfo?.groupId}`;
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
              <Spacer height="10px" />

              <ListOfMembers
                members={membersWithNames || []}
                groupId={selectedGroup?.groupId}
                setOpenSnack={setOpenSnack}
                setInfoSnack={setInfoSnack}
                isAdmin={isAdmin}
                isOwner={isOwner}
                show={show}
                ownerAddress={groupInfo?.owner}
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
    </Fragment>
  );

  if (inline) {
    return content;
  }

  return (
    <Fragment>
      <Dialog
        fullScreen
        open={open}
        onClose={handleClose}
        slots={{
          transition: Transition,
        }}
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
              sx={{
                bgcolor: theme.palette.background.default,
                color: theme.palette.text.primary,
              }}
            >
              <CloseIcon />
            </IconButton>
          </Toolbar>
        </AppBar>

        {content}
      </Dialog>
    </Fragment>
  );
};
