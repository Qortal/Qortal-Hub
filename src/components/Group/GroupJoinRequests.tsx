import { useContext, useEffect, useMemo, useState } from 'react';
import { RequestQueueWithPromise } from '../../utils/queue/queue';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CloseIcon from '@mui/icons-material/Close';
import { Box, Button, ButtonBase, Collapse, Dialog, DialogContent, DialogTitle, IconButton, Typography, useTheme } from '@mui/material';
import { CustomLoader } from '../../common/CustomLoader';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import {
  GROUP_ACTIVITY_CACHE_TTL_MS,
  joinRequestsCacheAtom,
  myGroupsWhereIAmAdminAtom,
  txListAtom,
} from '../../atoms/global';
import { ListOfJoinRequests } from './ListOfJoinRequests';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
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
  compact = false,
  onCountChange,
  onLoadingChange,
}: {
  myAddress: string;
  groups?: any[];
  setOpenManageMembers?: (v: boolean) => void;
  getTimestampEnterChat?: () => void;
  setSelectedGroup?: (g: any) => void;
  setGroupSection?: (s: string) => void;
  setMobileViewMode?: (m: string) => void;
  setDesktopViewMode?: (m: string) => void;
  compact?: boolean;
  onCountChange?: (count: number) => void;
  onLoadingChange?: (loading: boolean) => void;
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
  const [joinRequestsCache, setJoinRequestsCache] = useAtom(joinRequestsCacheAtom);

  const [myGroupsWhereIAmAdmin] = useAtom(myGroupsWhereIAmAdminAtom);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const [joinRequestsDialogOpen, setJoinRequestsDialogOpen] = useState(false);
  const [selectedGroupForDialog, setSelectedGroupForDialog] = useState<{
    groupId: number;
    groupName: string;
  } | null>(null);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const theme = useTheme();
  const adminGroupIds = useMemo(
    () =>
      [...(myGroupsWhereIAmAdmin ?? [])]
        .map((g) => g?.groupId)
        .filter((id) => id != null)
        .sort((a, b) => a - b),
    [myGroupsWhereIAmAdmin]
  );

  const isCacheValid = useMemo(() => {
    if (!joinRequestsCache || adminGroupIds.length === 0) return false;
    if (joinRequestsCache.adminGroupIds.length !== adminGroupIds.length) return false;
    const same = joinRequestsCache.adminGroupIds.every(
      (id, i) => id === adminGroupIds[i]
    );
    if (!same) return false;
    return Date.now() - joinRequestsCache.fetchedAt < GROUP_ACTIVITY_CACHE_TTL_MS;
  }, [joinRequestsCache, adminGroupIds]);

  const getJoinRequests = async (silent = false, force = false) => {
    if (!force && isCacheValid && joinRequestsCache?.data) {
      setGroupsWithJoinRequests(joinRequestsCache.data);
      if (!silent) setLoading(false);
      return;
    }
    if (!myAddress) return;
    try {
      if (!silent) setLoading(true);
      const response = await fetch(
        `${getBaseApiReact()}/groups/joinrequests/admin/${myAddress}`
      );
      const raw: Array<{ group: any; joinRequests: Array<{ groupId: number; joiner: string }> }> =
        await response.json();
      const res = raw.map((item) => ({
        group: item.group,
        data: item.joinRequests ?? [],
      }));
      setGroupsWithJoinRequests(res);
      setJoinRequestsCache({
        data: res,
        fetchedAt: Date.now(),
        adminGroupIds: [...adminGroupIds],
      });
    } catch (error) {
      console.log(error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!myAddress || myGroupsWhereIAmAdmin.length === 0) {
      setLoading(false);
      return;
    }
    if (isCacheValid && joinRequestsCache?.data) {
      setGroupsWithJoinRequests(joinRequestsCache.data);
      setLoading(false);
      return;
    }
    getJoinRequests();
  }, [myAddress, myGroupsWhereIAmAdmin, joinRequestsCache, isCacheValid]);

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

  // Report count to parent when in compact mode
  const activeRequestCount = useMemo(
    () => filteredJoinRequests?.filter((g) => g?.data?.length > 0)?.length ?? 0,
    [filteredJoinRequests]
  );

  useEffect(() => {
    onCountChange?.(activeRequestCount);
  }, [activeRequestCount, onCountChange]);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  const handleOpenRequests = (group: (typeof filteredJoinRequests)[number]) => {
    if (!group?.group) return;
    setSelectedGroupForDialog({
      groupId: group.group.groupId,
      groupName: group.group.groupName ?? '',
    });
    setJoinRequestsDialogOpen(true);
  };

  const handleCloseJoinRequestsDialog = () => {
    setJoinRequestsDialogOpen(false);
    setSelectedGroupForDialog(null);
    getJoinRequests(true, true);
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
      {loading && filteredJoinRequests.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4, width: '100%' }}>
          <CustomLoader />
        </Box>
      )}

      {!loading &&
        (filteredJoinRequests.length === 0 || activeRequestCount === 0) && (
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

      {!loading && activeRequestCount > 0 && (
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
          {filteredJoinRequests?.map((group) => {
            if (group?.data?.length === 0) return null;
            const count = group?.data?.length ?? 0;
            return (
              <Box
                key={group?.group?.groupId}
                onClick={() => handleOpenRequests(group)}
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
                    {group?.group?.groupName}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: theme.palette.text.secondary,
                      display: 'block',
                      mt: 0.25,
                    }}
                  >
                    {t('group:message.generic.pending_join_requests_count', {
                      count,
                      postProcess: 'capitalizeFirstChar',
                      defaultValue: '{{count}} pending join request(s)',
                    })}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<VisibilityIcon sx={{ fontSize: '18px' }} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenRequests(group);
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
                  {t('tutorial:home.open', { postProcess: 'capitalizeFirstChar' })}
                </Button>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );

  return (
    <Box
      sx={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: compact ? 'stretch' : 'center',
      }}
    >
      {!compact && (
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
          <Typography sx={{ fontSize: '1rem' }}>
            {t('group:join_requests', { postProcess: 'capitalizeFirstChar' })}{' '}
            {activeRequestCount > 0 && ` (${activeRequestCount})`}
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

      <Dialog
        open={joinRequestsDialogOpen}
        onClose={handleCloseJoinRequestsDialog}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: '16px',
              overflow: 'hidden',
              maxHeight: '85vh',
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            pb: 1,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            {selectedGroupForDialog
              ? t('group:join_requests', { postProcess: 'capitalizeFirstChar' }) +
                ' – ' +
                selectedGroupForDialog.groupName
              : ''}
          </Typography>
          <IconButton
            aria-label={t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
            onClick={handleCloseJoinRequestsDialog}
            size="small"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: 0, py: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {selectedGroupForDialog && (
            <Box sx={{ flex: 1, minHeight: 320, overflow: 'auto', px: 2, py: 2 }}>
              <ListOfJoinRequests
                groupId={selectedGroupForDialog.groupId}
                show={show}
                setOpenSnack={setOpenSnack}
                setInfoSnack={setInfoSnack}
              />
            </Box>
          )}
        </DialogContent>
      </Dialog>

      <CustomizedSnackbars open={openSnack} setOpen={setOpenSnack} info={infoSnack} setInfo={setInfoSnack} />
    </Box>
  );
};
