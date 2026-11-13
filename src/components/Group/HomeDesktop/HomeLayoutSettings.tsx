import DashboardCustomizeRoundedIcon from '@mui/icons-material/DashboardCustomizeRounded';
import { Box, Button, Switch, Typography, useTheme } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useAtomValue } from 'jotai';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { userInfoAtom } from '../../../atoms/global';
import { executeEvent } from '../../../utils/events';
import { HOME_EDIT_LAYOUT_EVENT } from './homeDesktopConstants';
import {
  HOME_LAYOUT_DEFAULT,
  HOME_STACK_PANEL_IDS,
  HOME_TOP_PANEL_IDS,
  type HomePanelId,
  isHomePanelShown,
  sameHomeLayout,
  useHomeLayout,
  withHomePanelShown,
} from './homeLayout';
import { useHomeWindowTitles } from './homeWindows';

type Props = {
  /** The settings dialog's card background, border and row divider. */
  border: string;
  divider: string;
  /** Closes the settings, so Home shows for Edit Home. */
  onCloseSettings?: () => void;
  surface: string;
  switchSx: SxProps<Theme>;
};

const PANEL_IDS: readonly HomePanelId[] = [
  ...HOME_TOP_PANEL_IDS,
  ...HOME_STACK_PANEL_IDS,
];

/**
 * The Modules tab of the account settings: a switch for each Home window,
 * and the way to Edit Home, where the windows are moved and resized. Saved
 * per account.
 */
export const HomeLayoutSettings = ({
  border,
  divider,
  onCloseSettings,
  surface,
  switchSx,
}: Props) => {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const address = useAtomValue(userInfoAtom)?.address;
  const [layout, updateLayout] = useHomeLayout(address);
  const titles = useHomeWindowTitles();

  const descriptions: Record<HomePanelId, string> = {
    featured: t('group:dashboard.featured_q_apps_module_desc'),
    feed: t('group:dashboard.torq_feed_module_desc'),
    groupActivity: t('group:dashboard.group_activity_module_desc'),
    qortino: t('group:dashboard.qortino_module_desc'),
    status: t('group:dashboard.node_status_module_desc'),
    tools: t('group:dashboard.quick_tools_module_desc'),
    wallet: t('group:dashboard.wallet_activity_module_desc'),
    widgets: t('group:dashboard.widgets_module_desc'),
  };

  const cardSx = {
    background: surface,
    border: `1px solid ${border}`,
    borderRadius: '12px',
    overflow: 'hidden',
  };
  const rowSx = {
    alignItems: 'center',
    display: 'flex',
    gap: 1.2,
    justifyContent: 'space-between',
    px: 1.35,
    py: 1.2,
  };
  const titleSx = {
    color: theme.palette.text.primary,
    fontSize: '0.82rem',
    fontWeight: 700,
    letterSpacing: '0.01em',
  };
  const descriptionSx = {
    color: theme.palette.text.secondary,
    fontSize: '0.75rem',
    lineHeight: 1.45,
    mt: 0.4,
  };

  return (
    <Box sx={{ display: 'grid', gap: 1.4 }}>
      <Box sx={cardSx}>
        {PANEL_IDS.map((id, index) => (
          <Fragment key={id}>
            {index > 0 ? (
              <Box sx={{ borderTop: `1px solid ${divider}`, mx: 1.35 }} />
            ) : null}
            <Box sx={rowSx}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={titleSx}>{titles[id]}</Typography>
                <Typography sx={descriptionSx}>{descriptions[id]}</Typography>
              </Box>
              <Switch
                checked={isHomePanelShown(layout, id)}
                disabled={!address}
                onChange={(_event, checked) =>
                  updateLayout((current) =>
                    withHomePanelShown(current, id, checked)
                  )
                }
                slotProps={{ input: { 'aria-label': titles[id] } }}
                sx={switchSx}
              />
            </Box>
          </Fragment>
        ))}
      </Box>

      <Box sx={{ ...cardSx, ...rowSx }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={titleSx}>
            {t('group:dashboard.arrange_home')}
          </Typography>
          <Typography sx={descriptionSx}>
            {t('group:dashboard.arrange_home_desc')}
          </Typography>
        </Box>
        <Button
          disabled={!address}
          onClick={() => {
            onCloseSettings?.();
            executeEvent(HOME_EDIT_LAYOUT_EVENT, {});
          }}
          size="small"
          startIcon={<DashboardCustomizeRoundedIcon />}
          sx={{ flexShrink: 0, textTransform: 'none' }}
          variant="outlined"
        >
          {t('group:dashboard.edit_home')}
        </Button>
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1,
          justifyContent: 'space-between',
          px: 0.5,
        }}
      >
        <Typography
          sx={{ color: theme.palette.text.secondary, fontSize: '0.75rem' }}
        >
          {t('group:dashboard.home_layout_saved_per_account')}
        </Typography>
        <Button
          disabled={!address || sameHomeLayout(layout, HOME_LAYOUT_DEFAULT)}
          onClick={() => updateLayout(() => HOME_LAYOUT_DEFAULT)}
          size="small"
          sx={{ flexShrink: 0, textTransform: 'none' }}
        >
          {t('group:dashboard.reset_home_layout')}
        </Button>
      </Box>
    </Box>
  );
};
