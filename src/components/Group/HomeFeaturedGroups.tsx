import { useCallback, useContext, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Popover,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { LoadingButton } from '@mui/lab';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';
import { QORTAL_APP_CONTEXT } from '../../App';
import { HomeGroupCard } from './HomeGroupCard';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { memberGroupsAtom, txListAtom } from '../../atoms/global';
import { useAtomValue, useSetAtom } from 'jotai';
import { executeEvent } from '../../utils/events';
import { getFee } from '../../background/background.ts';
import { featuredGroups, type FeaturedGroup } from '../../data/featuredGroups';

interface HomeFeaturedGroupsProps {
  getTimestampEnterChat: () => void;
  setDesktopViewMode: (mode: string) => void;
  setGroupSection: (section: string) => void;
  setMobileViewMode: (mode: string) => void;
  setSelectedGroup: (group: any) => void;
}

// Shape used for popover/join (compatible with FeaturedGroup + extra fields for API)
interface FeaturedGroupFull extends FeaturedGroup {
  groupId: number;
  groupName: string;
  participantCount?: number;
  isOpen?: boolean;
}

function toFullGroup(g: FeaturedGroup): FeaturedGroupFull {
  return {
    ...g,
    groupId: g.id,
    groupName: g.name,
    isOpen: true,
  };
}

export const HomeFeaturedGroups = ({
  getTimestampEnterChat,
  setDesktopViewMode,
  setGroupSection,
  setMobileViewMode,
  setSelectedGroup,
}: HomeFeaturedGroupsProps) => {
  const { t } = useTranslation(['tutorial', 'core', 'group']);
  const theme = useTheme();
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const setTxList = useSetAtom(txListAtom);
  const memberGroups = useAtomValue(memberGroupsAtom) ?? [];
  const [startIndex, setStartIndex] = useState(0);
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
  const [selectedGroupForPopover, setSelectedGroupForPopover] = useState<FeaturedGroupFull | null>(null);
  const [isLoadingJoinGroup, setIsLoadingJoinGroup] = useState(false);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const groups = featuredGroups;
  const fullGroups = groups.map(toFullGroup);

  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const isSm = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  const isMd = useMediaQuery(theme.breakpoints.between('md', 'lg'));
  const visibleCount = isXs ? 2 : isSm ? 3 : isMd ? 4 : 5;

  const visibleGroups = groups.slice(startIndex, startIndex + visibleCount);
  const canGoBack = startIndex > 0;
  const canGoForward = startIndex + visibleCount < groups.length;
  const showArrows = groups.length > visibleCount;

  const handlePrev = useCallback(() => {
    setStartIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNext = useCallback(() => {
    setStartIndex((prev) =>
      Math.min(groups.length - visibleCount, prev + 1)
    );
  }, [groups.length, visibleCount]);

  const handlePopoverClose = useCallback(() => {
    setPopoverAnchor(null);
    setSelectedGroupForPopover(null);
  }, []);

  const handleGroupClick = useCallback(
    (group: FeaturedGroup, event: React.MouseEvent<HTMLElement>) => {
      const full = fullGroups.find((ag) => ag.groupId === group.id);
      if (!full) return;
      const isMember = memberGroups.some(
        (g: { groupId?: number }) => +g?.groupId === +full.groupId
      );
      if (isMember) {
        executeEvent('openGroupMessage', { from: full.groupId });
        return;
      }
      setPopoverAnchor(event.currentTarget as HTMLElement);
      setSelectedGroupForPopover(full);
    },
    [fullGroups, memberGroups]
  );

  const handleJoinGroup = useCallback(
    async (group: FeaturedGroupFull) => {
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

  return (
    <Box
      sx={{
        bgcolor: theme.palette.background.paper,
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px 20px',
        width: '100%',
      }}
    >
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '1rem',
          fontWeight: 600,
        }}
      >
        {t('tutorial:home.featured_groups')}
      </Typography>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minHeight: 120,
        }}
      >
        <IconButton
          onClick={handlePrev}
          size="small"
          disabled={!canGoBack}
          aria-label={t('tutorial:home.prev_groups', 'Previous groups')}
          sx={{
            visibility: showArrows ? 'visible' : 'hidden',
            flexShrink: 0,
            bgcolor: 'background.default',
            border: `1px solid ${theme.palette.divider}`,
            '&:hover': { bgcolor: 'action.hover' },
            '&.Mui-disabled': { opacity: 0.4 },
          }}
        >
          <ChevronLeftIcon />
        </IconButton>

        <Box
          sx={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'center',
            overflow: 'hidden',
            flex: 1,
            py: '4px',
            minWidth: 0,
          }}
        >
          {groups.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('tutorial:home.loading', 'Loading…')}
            </Typography>
          ) : (
            visibleGroups.map((group) => (
              <HomeGroupCard
                key={group.id}
                group={group}
                onClick={(e) => handleGroupClick(group, e)}
              />
            ))
          )}
        </Box>

        <IconButton
          onClick={handleNext}
          size="small"
          disabled={!canGoForward}
          aria-label={t('tutorial:home.next_groups', 'Next groups')}
          sx={{
            visibility: showArrows ? 'visible' : 'hidden',
            flexShrink: 0,
            bgcolor: 'background.default',
            border: `1px solid ${theme.palette.divider}`,
            '&:hover': { bgcolor: 'action.hover' },
            '&.Mui-disabled': { opacity: 0.4 },
          }}
        >
          <ChevronRightIcon />
        </IconButton>
      </Box>

      <Popover
        open={Boolean(selectedGroupForPopover && popoverAnchor)}
        anchorEl={popoverAnchor}
        onClose={(reason) => {
          if (reason === 'backdropClick') return;
          handlePopoverClose();
        }}
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
