import { useEffect, useMemo, useState } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import IconButton from '@mui/material/IconButton';
import { RequestQueueWithPromise } from '../../utils/queue/queue';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import { executeEvent } from '../../utils/events';
import { Box, ButtonBase, Collapse, Typography, useTheme } from '@mui/material';
import { CustomLoader } from '../../common/CustomLoader';
import { getBaseApiReact } from '../../App';
import { myGroupsWhereIAmAdminAtom, txListAtom } from '../../atoms/global';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useTranslation } from 'react-i18next';
import { useAtom, useSetAtom } from 'jotai';
export const requestQueueGroupJoinRequests = new RequestQueueWithPromise(2);

export const GroupJoinRequests = ({
  myAddress,
  groups,
  setOpenManageMembers,
  getTimestampEnterChat,
  setSelectedGroup,
  setGroupSection,
  setMobileViewMode,
  setDesktopViewMode,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const [groupsWithJoinRequests, setGroupsWithJoinRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [txList] = useAtom(txListAtom);

  const setMyGroupsWhereIAmAdmin = useSetAtom(myGroupsWhereIAmAdminAtom);

  const theme = useTheme();
  const getJoinRequests = async () => {
    try {
      setLoading(true);

      let groupsAsAdmin = [];
      const getAllGroupsAsAdmin = groups
        .filter((item) => item.groupId !== '0')
        .map(async (group) => {
          const isAdminResponse = await requestQueueGroupJoinRequests.enqueue(
            () => {
              return fetch(
                `${getBaseApiReact()}/groups/members/${group.groupId}?limit=0&onlyAdmins=true`
              );
            }
          );
          const isAdminData = await isAdminResponse.json();

          const findMyself = isAdminData?.members?.find(
            (member) => member.member === myAddress
          );

          if (findMyself) {
            groupsAsAdmin.push(group);
          }
          return true;
        });

      await Promise.all(getAllGroupsAsAdmin);
      setMyGroupsWhereIAmAdmin(groupsAsAdmin);
      const res = await Promise.all(
        groupsAsAdmin.map(async (group) => {
          const joinRequestResponse =
            await requestQueueGroupJoinRequests.enqueue(() => {
              return fetch(
                `${getBaseApiReact()}/groups/joinrequests/${group.groupId}`
              );
            });

          const joinRequestData = await joinRequestResponse.json();
          return {
            group,
            data: joinRequestData,
          };
        })
      );
      setGroupsWithJoinRequests(res);
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (myAddress && groups.length > 0) {
      getJoinRequests();
    } else {
      setLoading(false);
    }
  }, [myAddress, groups]);

  const filteredJoinRequests = useMemo(() => {
    return groupsWithJoinRequests.map((group) => {
      const filteredGroupRequests = group?.data?.filter((gd) => {
        const findJoinRequsetInTxList = txList?.find(
          (tx) =>
            tx?.groupId === group?.group?.groupId &&
            tx?.qortalAddress === gd?.joiner &&
            tx?.type === 'join-request-accept'
        );

        if (findJoinRequsetInTxList) return false;
        return true;
      });
      return {
        ...group,
        data: filteredGroupRequests,
      };
    });
  }, [groupsWithJoinRequests, txList]);

  return (
    <Box
      sx={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <ButtonBase
        sx={{
          width: '322px',
          display: 'flex',
          flexDirection: 'row',
          padding: '0px 20px',
          gap: '10px',
          justifyContent: 'flex-start',
        }}
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <Typography
          sx={{
            fontSize: '1rem',
          }}
        >
          {t('group:join_requests', { postProcess: 'capitalizeFirstChar' })}{' '}
          {filteredJoinRequests?.filter((group) => group?.data?.length > 0)
            ?.length > 0 &&
            ` (${filteredJoinRequests?.filter((group) => group?.data?.length > 0)?.length})`}
        </Typography>

        {isExpanded ? (
          <ExpandLessIcon
            sx={{
              marginLeft: 'auto',
            }}
          />
        ) : (
          <ExpandMoreIcon
            sx={{
              marginLeft: 'auto',
            }}
          />
        )}
      </ButtonBase>

      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
        <Box
          sx={{
            bgcolor: 'background.paper',
            borderRadius: '19px',
            display: 'flex',
            flexDirection: 'column',
            height: '250px',
            padding: '20px',
            width: '322px',
          }}
        >
          {loading && filteredJoinRequests.length === 0 && (
            <Box
              sx={{
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <CustomLoader />
            </Box>
          )}

          {!loading &&
            (filteredJoinRequests.length === 0 ||
              filteredJoinRequests?.filter((group) => group?.data?.length > 0)
                .length === 0) && (
              <Box
                sx={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  height: '100%',
                }}
              >
                <Typography
                  sx={{
                    fontSize: '11px',
                    fontWeight: 400,
                    color: 'rgba(255, 255, 255, 0.2)',
                  }}
                >
                  {t('group:message.generic.no_display', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
            )}

          <List
            className="scrollable-container"
            sx={{
              bgcolor: 'background.paper',
              maxHeight: '300px',
              maxWidth: 360,
              overflow: 'auto',
              width: '100%',
            }}
          >
            {filteredJoinRequests?.map((group) => {
              if (group?.data?.length === 0) return null;
              return (
                <ListItem
                  key={group?.groupId}
                  onClick={() => {
                    setSelectedGroup(group?.group);
                    setMobileViewMode('group');
                    getTimestampEnterChat();
                    setGroupSection('announcement');
                    setOpenManageMembers(true);
                    setDesktopViewMode('chat');
                    setTimeout(() => {
                      executeEvent('openGroupJoinRequest', {});
                    }, 300);
                  }}
                  sx={{
                    marginBottom: '20px',
                  }}
                  disablePadding
                  secondaryAction={
                    <IconButton
                      edge="end"
                      aria-label={t('core:comment_other', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                      sx={{
                        bgcolor: theme.palette.background.default,
                        color: theme.palette.text.primary,
                      }}
                    >
                      <GroupAddIcon
                        sx={{
                          color: theme.palette.text.primary,
                          fontSize: '18px',
                        }}
                      />
                    </IconButton>
                  }
                >
                  <ListItemButton
                    sx={{
                      padding: '0px',
                    }}
                    disableRipple
                    role={undefined}
                    dense
                  >
                    <ListItemText
                      sx={{
                        '& .MuiTypography-root': {
                          fontSize: '13px',
                          fontWeight: 400,
                        },
                      }}
                      primary={t(
                        'group:message.generic.pending_join_requests',
                        {
                          group: group?.group?.groupName,
                          count: group?.data?.length,
                          postProcess: 'capitalizeFirstChar',
                        }
                      )}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        </Box>
      </Collapse>
    </Box>
  );
};
