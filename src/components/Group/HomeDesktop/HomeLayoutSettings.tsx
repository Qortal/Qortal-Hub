import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import {
  Box,
  Button,
  IconButton,
  Switch,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useAtomValue } from 'jotai';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { userInfoAtom } from '../../../atoms/global';
import {
  HOME_LAYOUT_DEFAULT,
  HOME_TOP_PANEL_IDS,
  type HomePanelId,
  isHomePanelShown,
  moveHomeStackPanel,
  sameHomeLayout,
  useHomeLayout,
  withHomePanelShown,
} from './homeLayout';

type Props = {
  /** The settings dialog's card background, border and row divider. */
  border: string;
  divider: string;
  surface: string;
  switchSx: SxProps<Theme>;
};

/**
 * The Modules tab of the account settings: a switch for each Home panel, and
 * the order of the full-width panels under the top part. Saved per account.
 */
export const HomeLayoutSettings = ({
  border,
  divider,
  surface,
  switchSx,
}: Props) => {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const address = useAtomValue(userInfoAtom)?.address;
  const [layout, updateLayout] = useHomeLayout(address);

  const titles: Record<HomePanelId, string> = {
    featured: t('group:dashboard.featured_q_apps'),
    feed: t('group:dashboard.torq_feed'),
    groupActivity: t('group:dashboard.group_activity_module'),
    qortino: t('group:dashboard.qortino_module'),
    status: t('group:dashboard.node_status'),
    tools: t('group:dashboard.quick_tools_module'),
    wallet: t('group:dashboard.wallet_activity'),
    widgets: t('group:dashboard.widgets_module'),
  };
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
  const sectionLabelSx = {
    color: theme.palette.text.secondary,
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    px: 0.5,
    textTransform: 'uppercase',
  } as const;

  const row = (id: HomePanelId, controls?: ReactNode) => (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 1.2,
        justifyContent: 'space-between',
        px: 1.35,
        py: 1.2,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: '0.82rem',
            fontWeight: 700,
            letterSpacing: '0.01em',
          }}
        >
          {titles[id]}
        </Typography>
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.75rem',
            lineHeight: 1.45,
            mt: 0.4,
          }}
        >
          {descriptions[id]}
        </Typography>
      </Box>
      {controls}
      <Switch
        checked={isHomePanelShown(layout, id)}
        disabled={!address}
        onChange={(_event, checked) =>
          updateLayout((current) => withHomePanelShown(current, id, checked))
        }
        slotProps={{ input: { 'aria-label': titles[id] } }}
        sx={switchSx}
      />
    </Box>
  );

  const rowDivider = (
    <Box sx={{ borderTop: `1px solid ${divider}`, mx: 1.35 }} />
  );

  const moveButton = (
    id: (typeof layout.stack)[number],
    offset: -1 | 1,
    disabled: boolean
  ) => {
    const label = t(
      offset < 0
        ? 'group:dashboard.move_panel_up'
        : 'group:dashboard.move_panel_down',
      { panel: titles[id] }
    );
    const Icon = offset < 0 ? ArrowUpwardRoundedIcon : ArrowDownwardRoundedIcon;
    const button = (
      <IconButton
        aria-label={label}
        disabled={disabled || !address}
        onClick={() =>
          updateLayout((current) => moveHomeStackPanel(current, id, offset))
        }
        size="small"
        sx={{ color: theme.palette.text.secondary }}
      >
        <Icon sx={{ fontSize: '1.05rem' }} />
      </IconButton>
    );
    // A disabled button fires no events, so the tooltip needs a wrapper.
    return (
      <Tooltip title={label}>
        <Box component="span" sx={{ display: 'inline-flex' }}>
          {button}
        </Box>
      </Tooltip>
    );
  };

  return (
    <Box sx={{ display: 'grid', gap: 1.4 }}>
      <Typography sx={sectionLabelSx}>
        {t('group:dashboard.home_layout_top')}
      </Typography>
      <Box sx={cardSx}>
        {HOME_TOP_PANEL_IDS.map((id, index) => (
          <Fragment key={id}>
            {index > 0 ? rowDivider : null}
            {row(id)}
          </Fragment>
        ))}
      </Box>

      <Typography sx={sectionLabelSx}>
        {t('group:dashboard.home_layout_below')}
      </Typography>
      <Box sx={cardSx}>
        {layout.stack.map((id, index) => (
          <Fragment key={id}>
            {index > 0 ? rowDivider : null}
            {row(
              id,
              <Box sx={{ display: 'flex', flexShrink: 0, gap: 0.25 }}>
                {moveButton(id, -1, index === 0)}
                {moveButton(id, 1, index === layout.stack.length - 1)}
              </Box>
            )}
          </Fragment>
        ))}
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
