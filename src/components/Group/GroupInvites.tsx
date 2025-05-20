import { useEffect, useState } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import IconButton from '@mui/material/IconButton';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import { executeEvent } from '../../utils/events';
import { Box, ButtonBase, Collapse, Typography, useTheme } from '@mui/material';
import { getGroupNames } from './UserListOfInvites';
import { CustomLoader } from '../../common/CustomLoader';
import { getBaseApiReact } from '../../App';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useTranslation } from 'react-i18next';

export const GroupInvites = ({ myAddress, setOpenAddGroup }) => {
  const [groupsWithJoinRequests, setGroupsWithJoinRequests] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation(['auth', 'core', 'group']);
  const theme = useTheme();

  const getJoinRequests = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${getBaseApiReact()}/groups/invites/${myAddress}/?limit=0`
      );
      const data = await response.json();
      const resMoreData = await getGroupNames(data);

      setGroupsWithJoinRequests(resMoreData);
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (myAddress) {
      getJoinRequests();
    }
  }, [myAddress]);

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
      }}
    >
      <ButtonBase
        sx={{
          display: 'flex',
          flexDirection: 'row',
          gap: '10px',
          justifyContent: 'flex-start',
          padding: '0px 20px',
          width: '322px',
        }}
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <Typography
          sx={{
            fontSize: '1rem',
          }}
        >
          {t('group:group.invites', { postProcess: 'capitalizeFirstChar' })}{' '}
          {groupsWithJoinRequests?.length > 0 &&
            ` (${groupsWithJoinRequests?.length})`}
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
            bgcolor: theme.palette.background.paper,
            borderRadius: '19px',
            display: 'flex',
            flexDirection: 'column',
            height: '250px',
            padding: '20px',
            width: '322px',
          }}
        >
          {loading && groupsWithJoinRequests.length === 0 && (
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <CustomLoader />
            </Box>
          )}

          {!loading && groupsWithJoinRequests.length === 0 && (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                height: '100%',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <Typography
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: '11px',
                  fontWeight: 400,
                }}
              >
                {t('group:message.generic.no_display', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>
          )}

          <List
            sx={{
              width: '100%',
              maxWidth: 360,
              bgcolor: theme.palette.background.paper,
              maxHeight: '300px',
              overflow: 'auto',
            }}
            className="scrollable-container"
          >
            {groupsWithJoinRequests?.map((group) => {
              return (
                <ListItem
                  sx={{
                    marginBottom: '20px',
                  }}
                  key={group?.groupId}
                  onClick={() => {
                    setOpenAddGroup(true);
                    setTimeout(() => {
                      executeEvent('openGroupInvitesRequest', {});
                    }, 300);
                  }}
                  disablePadding
                  secondaryAction={
                    <IconButton
                      edge="end"
                      aria-label={t('core:comment_other', {
                        postProcess: 'capitalizeFirstChar',
                      })}
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
                  <ListItemButton disableRipple role={undefined} dense>
                    <ListItemText
                      sx={{
                        '& .MuiTypography-root': {
                          fontSize: '13px',
                          fontWeight: 400,
                        },
                      }}
                      primary={t('group:message.generic.group_invited_you', {
                        group: group?.groupName,
                        postProcess: 'capitalizeFirstChar',
                      })}
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
