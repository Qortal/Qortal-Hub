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

export const GroupInvites = ({
  myAddress,
  setOpenAddGroup,
  compact = false,
  onCountChange,
}: {
  myAddress: string;
  setOpenAddGroup?: (v: boolean) => void;
  compact?: boolean;
  onCountChange?: (count: number) => void;
}) => {
  const [groupsWithJoinRequests, setGroupsWithJoinRequests] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
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

  // Report count to parent when in compact mode
  useEffect(() => {
    onCountChange?.(groupsWithJoinRequests?.length ?? 0);
  }, [groupsWithJoinRequests, onCountChange]);

  const listContent = (
    <Box
      sx={{
        bgcolor: theme.palette.background.paper,
        borderRadius: compact ? '0' : '19px',
        display: 'flex',
        flexDirection: 'column',
        height: compact ? 'auto' : '250px',
        maxHeight: compact ? '300px' : undefined,
        overflow: compact ? 'auto' : undefined,
        padding: '20px',
        width: compact ? '100%' : '322px',
      }}
    >
      {loading && groupsWithJoinRequests.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
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
            py: compact ? 4 : 0,
            width: '100%',
          }}
        >
          <Typography
            sx={{ color: theme.palette.text.primary, fontSize: '11px', fontWeight: 400 }}
          >
            {t('group:message.generic.no_display', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      )}

      <List
        sx={{
          bgcolor: theme.palette.background.paper,
          maxHeight: '300px',
          maxWidth: compact ? '100%' : 360,
          overflow: 'auto',
          width: '100%',
        }}
        className="scrollable-container"
      >
        {groupsWithJoinRequests?.map((group) => (
          <ListItem
            sx={{ marginBottom: '20px' }}
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
                sx={{
                  bgcolor: theme.palette.background.default,
                  color: theme.palette.text.primary,
                }}
              >
                <GroupAddIcon
                  sx={{ color: theme.palette.text.primary, fontSize: '18px' }}
                />
              </IconButton>
            }
          >
            <ListItemButton disableRipple role={undefined} dense>
              <ListItemText
                sx={{
                  '& .MuiTypography-root': { fontSize: '13px', fontWeight: 400 },
                }}
                primary={t('group:message.generic.group_invited_you', {
                  group: group?.groupName,
                  postProcess: 'capitalizeFirstChar',
                })}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <Box
      sx={{
        alignItems: compact ? 'stretch' : 'center',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
      }}
    >
      {!compact && (
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
          <Typography sx={{ fontSize: '1rem' }}>
            {t('group:group.invites', { postProcess: 'capitalizeFirstChar' })}{' '}
            {groupsWithJoinRequests?.length > 0 &&
              ` (${groupsWithJoinRequests?.length})`}
          </Typography>
          {isExpanded ? (
            <ExpandLessIcon sx={{ marginLeft: 'auto' }} />
          ) : (
            <ExpandMoreIcon sx={{ marginLeft: 'auto' }} />
          )}
        </ButtonBase>
      )}

      {compact ? listContent : (
        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
          {listContent}
        </Collapse>
      )}
    </Box>
  );
};
