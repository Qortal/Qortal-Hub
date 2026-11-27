import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Box, Dialog, IconButton, Typography } from '@mui/material';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddGroupList } from './AddGroupList';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { refreshReticulumGroupScores } from './reticulumGroupScore';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';

type FindGroupModalProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onOpenJoinedGroup: (group: unknown) => void;
};

export function FindGroupModal({
  open,
  setOpen,
  onOpenJoinedGroup,
}: FindGroupModalProps) {
  const { t } = useTranslation(['group']);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timers: number[] = [];
    const refresh = () => {
      if (cancelled) return;
      void refreshReticulumGroupScores(true);
    };
    refresh();
    timers.push(window.setTimeout(refresh, 8_000));
    timers.push(window.setTimeout(refresh, 20_000));
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [open]);

  if (!open) return null;

  return (
    <Fragment>
      <Dialog
        fullWidth
        maxWidth={false}
        onClose={(_event, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
            setOpen(false);
          }
        }}
        open={open}
        PaperProps={{
          sx: {
            backgroundColor: 'background.paper',
            backgroundImage: 'none',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '12px',
            boxShadow: '0 24px 70px rgba(0, 0, 0, 0.45)',
            display: 'flex',
            flexDirection: 'column',
            height: 'calc(100vh - 32px)',
            m: 2,
            maxHeight: 'calc(100vh - 32px)',
            maxWidth: 'none',
            overflow: 'hidden',
            width: 'min(920px, calc(100vw - 32px))',
          },
        }}
      >
        <Box
          component="header"
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            px: { xs: 2.5, sm: 4 },
            pt: { xs: 2.5, sm: 3.5 },
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              component="h2"
              sx={{
                color: 'text.primary',
                fontFamily:
                  'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                fontSize: { xs: 28, sm: 32 },
                fontWeight: 700,
                letterSpacing: '-0.03em',
                lineHeight: 1.15,
              }}
            >
              {t('group:find_groups.title')}
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: 15,
                fontWeight: 400,
                lineHeight: '22px',
                mt: 0.75,
              }}
            >
              {t('group:find_groups.subtitle')}
            </Typography>
          </Box>
          <IconButton
            aria-label={t('group:find_groups.close')}
            onClick={() => setOpen(false)}
            sx={{
              borderRadius: '7px',
              color: 'text.secondary',
              height: 32,
              mt: -0.25,
              width: 32,
              '&:hover': {
                backgroundColor: 'action.hover',
                color: 'text.primary',
              },
              '&:focus-visible': {
                outline: '2px solid #60a5fa',
                outlineOffset: 2,
              },
            }}
          >
            <CloseRoundedIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Box>

        <Box
          sx={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            px: { xs: 2.5, sm: 4 },
            pb: 3,
            pt: 2.25,
          }}
        >
          <AddGroupList
            onJoinedGroupOpen={(group) => {
              setOpen(false);
              onOpenJoinedGroup(group);
            }}
            setOpenSnack={setOpenSnack}
            setInfoSnack={setInfoSnack}
          />
        </Box>

        <CustomizedSnackbars
          open={openSnack}
          setOpen={setOpenSnack}
          info={infoSnack}
          setInfo={setInfoSnack}
        />
      </Dialog>
    </Fragment>
  );
}

export function FindGroupOverviewModal() {
  const [group, setGroup] = useState<any>(null);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);

  useEffect(() => {
    const open = (event: CustomEvent) => setGroup(event.detail?.group ?? null);
    subscribeToEvent('openFindGroupOverview', open);
    return () => unsubscribeFromEvent('openFindGroupOverview', open);
  }, []);

  if (!group) return null;

  return (
    <Fragment>
      <AddGroupList
        initialSelectedGroup={group}
        onOverviewClose={() => setGroup(null)}
        overviewOnly
        setOpenSnack={setOpenSnack}
        setInfoSnack={setInfoSnack}
      />
      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </Fragment>
  );
}
