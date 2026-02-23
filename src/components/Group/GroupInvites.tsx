import { useCallback, useContext, useEffect, useState } from 'react';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import { Box, Button, ButtonBase, Collapse, Popover, Typography, useTheme } from '@mui/material';
import { LoadingButton } from '@mui/lab';
import { useSetAtom } from 'jotai';
import { txListAtom } from '../../atoms/global';
import { QORTAL_APP_CONTEXT } from '../../App';
import { getFee } from '../../background/background';
import { getGroupNames } from './UserListOfInvites';
import { CustomLoader } from '../../common/CustomLoader';
import { getBaseApiReact } from '../../App';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useTranslation } from 'react-i18next';

export const GroupInvites = ({
  myAddress,
  setOpenAddGroup,
  compact = false,
  onCountChange,
  onLoadingChange,
}: {
  myAddress: string;
  setOpenAddGroup?: (v: boolean) => void;
  compact?: boolean;
  onCountChange?: (count: number) => void;
  onLoadingChange?: (loading: boolean) => void;
}) => {
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const theme = useTheme();
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const setTxList = useSetAtom(txListAtom);

  const [groupsWithJoinRequests, setGroupsWithJoinRequests] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
  const [selectedGroupForPopover, setSelectedGroupForPopover] = useState<{
    groupId: number;
    groupName: string;
    description?: string;
    isOpen?: boolean;
    participantCount?: number;
  } | null>(null);
  const [isLoadingJoinGroup, setIsLoadingJoinGroup] = useState(false);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handlePopoverClose = useCallback(() => {
    setPopoverAnchor(null);
    setSelectedGroupForPopover(null);
  }, []);

  const handleJoinGroup = useCallback(
    async (group: { groupId: number; groupName: string; isOpen?: boolean }) => {
      try {
        const fee = await getFee('JOIN_GROUP');
        await show({
          message: t('core:message.question.perform_transaction', {
            action: 'JOIN_GROUP',
            postProcess: 'capitalizeFirstChar',
          }),
          publishFee: fee.fee + ' QORT',
        });
        setIsLoadingJoinGroup(true);
        await new Promise((res, rej) => {
          window
            .sendMessage('joinGroup', { groupId: group.groupId })
            .then((response) => {
              if (!response?.error) {
                setInfoSnack({
                  type: 'success',
                  message: t('group:message.success.group_join', { postProcess: 'capitalizeFirstChar' }),
                });
                if (group.isOpen) {
                  setTxList((prev) => [
                    {
                      ...response,
                      type: 'joined-group',
                      label: t('group:message.success.group_join_label', {
                        group_name: group.groupName,
                        postProcess: 'capitalizeFirstChar',
                      }),
                      labelDone: t('group:message.success.group_join_label', {
                        group_name: group.groupName,
                        postProcess: 'capitalizeFirstChar',
                      }),
                      done: false,
                      groupId: group.groupId,
                    },
                    ...prev,
                  ]);
                } else {
                  setTxList((prev) => [
                    {
                      ...response,
                      type: 'joined-group-request',
                      label: t('group:message.success.group_join_request', {
                        group_name: group.groupName,
                        postProcess: 'capitalizeFirstChar',
                      }),
                      labelDone: t('group:message.success.group_join_outcome', {
                        group_name: group.groupName,
                        postProcess: 'capitalizeFirstChar',
                      }),
                      done: false,
                      groupId: group.groupId,
                    },
                    ...prev,
                  ]);
                }
                setOpenSnack(true);
                handlePopoverClose();
                getJoinRequests();
                res(response);
                return;
              }
              setInfoSnack({ type: 'error', message: response?.error });
              setOpenSnack(true);
              rej(response.error);
            })
            .catch((error) => {
              setInfoSnack({
                type: 'error',
                message: error?.message ?? t('core:message.error.generic', { postProcess: 'capitalizeFirstChar' }),
              });
              setOpenSnack(true);
              rej(error);
            });
        });
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoadingJoinGroup(false);
      }
    },
    [show, t, setTxList, handlePopoverClose]
  );

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
    } else {
      setLoading(false);
    }
  }, [myAddress]);

  // Report count to parent when in compact mode
  useEffect(() => {
    onCountChange?.(groupsWithJoinRequests?.length ?? 0);
  }, [groupsWithJoinRequests, onCountChange]);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  const handleInviteItemClick = (e: React.MouseEvent<HTMLElement>, group: (typeof groupsWithJoinRequests)[number]) => {
    setPopoverAnchor(e.currentTarget as HTMLElement);
    setSelectedGroupForPopover({
      groupId: group.groupId,
      groupName: group.groupName ?? '',
      description: group.description,
      isOpen: group.isOpen,
      participantCount: group.participantCount ?? (group as { memberCount?: number }).memberCount ?? 0,
    });
  };

  const listContent = (
    <Box
      sx={{
        bgcolor: theme.palette.background.paper,
        borderRadius: compact ? '0' : '12px',
        display: 'flex',
        flexDirection: 'column',
        height: compact ? 'auto' : '250px',
        maxHeight: compact ? '300px' : undefined,
        overflow: compact ? 'auto' : undefined,
        padding: compact ? 1.5 : 2,
        width: compact ? '100%' : '322px',
      }}
    >
      {loading && groupsWithJoinRequests.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4, width: '100%' }}>
          <CustomLoader />
        </Box>
      )}

      {!loading && groupsWithJoinRequests.length === 0 && (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'center',
            py: compact ? 4 : 5,
            width: '100%',
          }}
        >
          <Typography
            variant="body2"
            sx={{ color: theme.palette.text.secondary, fontWeight: 500 }}
          >
            {t('group:message.generic.no_display', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      )}

      {!loading && groupsWithJoinRequests.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            maxHeight: '300px',
            overflow: 'auto',
            width: '100%',
          }}
          className="scrollable-container"
        >
          {groupsWithJoinRequests?.map((group) => (
            <Box
              key={group?.groupId}
              onClick={(e) => handleInviteItemClick(e, group)}
              sx={{
                alignItems: 'center',
                bgcolor: theme.palette.background.default,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: '10px',
                cursor: 'pointer',
                display: 'flex',
                gap: 1.5,
                justifyContent: 'space-between',
                padding: '12px 14px',
                transition: 'background-color 0.2s ease, border-color 0.2s ease',
                '&:hover': {
                  bgcolor: theme.palette.action.hover,
                  borderColor: theme.palette.divider,
                },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{
                    color: theme.palette.text.primary,
                    fontWeight: 600,
                    fontSize: '0.9rem',
                  }}
                >
                  {group?.groupName}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: theme.palette.text.secondary,
                    display: 'block',
                    mt: 0.25,
                  }}
                >
                  {t('group:message.generic.invited_you', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="contained"
                startIcon={<GroupAddIcon sx={{ fontSize: '18px' }} />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleInviteItemClick(e, group);
                }}
                sx={{
                  flexShrink: 0,
                  fontWeight: 600,
                  textTransform: 'none',
                  borderRadius: '8px',
                  px: 1.5,
                  py: 0.75,
                }}
              >
                {t('core:action.join', { postProcess: 'capitalizeFirstChar' })}
              </Button>
            </Box>
          ))}
        </Box>
      )}
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

      <Popover
        open={Boolean(selectedGroupForPopover && popoverAnchor)}
        anchorEl={popoverAnchor}
        onClose={() => handlePopoverClose()}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
              border: `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
            },
          },
        }}
      >
        {selectedGroupForPopover && (
          <Box sx={{ width: 360, overflow: 'hidden' }}>
            <Box
              sx={{
                px: 2.5,
                pt: 2.5,
                pb: 1.5,
                bgcolor: theme.palette.background?.default ?? 'rgba(0,0,0,0.2)',
                borderBottom: `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {t('group:group.name', { postProcess: 'capitalizeFirstChar' })}
              </Typography>
              <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.3 }}>
                {selectedGroupForPopover.groupName}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                {t('group:group.member_number', { postProcess: 'capitalizeFirstChar' })}: {selectedGroupForPopover.participantCount ?? 0}
              </Typography>
            </Box>
            <Box sx={{ px: 2.5, py: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75, fontWeight: 600 }}>
                {t('group:group.description', { postProcess: 'capitalizeFirstChar', defaultValue: 'Description' })}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: theme.palette.text.secondary,
                  lineHeight: 1.5,
                  minHeight: '2.5em',
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {selectedGroupForPopover.description ||
                  t('group:message.generic.no_description', { postProcess: 'capitalizeFirstChar', defaultValue: 'No description' })}
              </Typography>
              {selectedGroupForPopover.isOpen === false && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  {t('group:message.generic.closed_group', { postProcess: 'capitalizeFirstChar' })}
                </Typography>
              )}
            </Box>
            <Box sx={{ px: 2.5, pb: 2.5, pt: 0, display: 'flex', gap: 1.5, justifyContent: 'flex-end' }}>
              <Button variant="outlined" onClick={handlePopoverClose} sx={{ textTransform: 'none', fontWeight: 600 }}>
                {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
              </Button>
              <LoadingButton
                loading={isLoadingJoinGroup}
                loadingPosition="start"
                variant="contained"
                onClick={() => handleJoinGroup(selectedGroupForPopover)}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                {t('core:action.join', { postProcess: 'capitalizeFirstChar' })}
              </LoadingButton>
            </Box>
          </Box>
        )}
      </Popover>

      <CustomizedSnackbars open={openSnack} setOpen={setOpenSnack} info={infoSnack} setInfo={setInfoSnack} />
    </Box>
  );
};
