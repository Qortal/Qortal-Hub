import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Tooltip, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import NotificationsOffRoundedIcon from '@mui/icons-material/NotificationsOffRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SpaRoundedIcon from '@mui/icons-material/SpaRounded';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import { AppsIcon } from '../../assets/Icons/AppsIcon';
import { MessagingIconFilled } from '../../assets/Icons/MessagingIconFilled';
import { executeEvent } from '../../utils/events';
import {
  dashboardPanelSx,
  handleDashboardPanelPointerLeave,
  handleDashboardPanelPointerMove,
  useDashboardPanelMouseLight,
} from './dashboardPanelEffects';
import { QORTINO_DONATION_DRAG_TYPE } from './qortinoDonationEasterEgg';

type HomeQuickToolsPadProps = {
  fillHeight?: boolean;
  onOpenApps?: () => void;
  onOpenChat?: () => void;
  onOpenQortalLand?: () => void;
  onOpenSettings?: () => void;
};

type QuickToolItem = {
  accent: string;
  /** A short line under the name, on a button with room for it. */
  detail: string;
  draggable?: boolean;
  iconOffsetX?: number;
  iconOffsetY?: number;
  iconScale?: number;
  isActive?: boolean;
  key: string;
  /** The tooltip and the button's accessible name. */
  label: string;
  /** The name a big enough button shows, when it isn't the label. */
  name?: string;
  onAction: (event: MouseEvent<HTMLElement>) => void;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  renderIcon: () => React.ReactNode;
};

const QUICK_TOOL_ICON_SIZE = '1.14rem';
const QUICK_TOOL_ICON_BOX_SIZE_PX = 20;
const QUICK_TOOL_DOT_OFFSET = '7px';
const QUICK_TOOL_DOT_SIZE = '5px';
const QUICK_TOOL_LED_COLOR = '#8FD8FF';
/** The ink on the dark theme's buttons. */
const QUICK_TOOL_DARK_INK = '#F6F8FB';
const QUICK_TOOLS_PANEL_GRADIENT_DEFAULT = {
  angle: 197,
  spread: 76,
};
/**
 * The tools in reading order. The grid has 4 columns and 2 rows, or 8 and 1
 * in a wide, short Home window, or 2 and 4 in a narrow, tall one. A bigger
 * window makes bigger buttons, which show more (QUICK_TOOL_*).
 */
const QUICK_TOOL_ORDER = [
  'lookup-user',
  'wallets',
  'apps',
  'q-chat',
  'backup-wallet',
  'minting',
  'notifications',
  'qortal-land',
];
const HOME_WINDOW_WIDE_AND_SHORT =
  '@container home-window (min-aspect-ratio: 3 / 1)';
const HOME_WINDOW_NARROW_AND_TALL =
  '@container home-window (max-aspect-ratio: 3 / 4)';
/**
 * Each tool button is a container ("quick-tool"): the icon alone at first,
 * then the tool's name, then a detail line too, as the button grows. The
 * text goes under the icon, or beside it on a button at least twice as
 * wide as it is tall.
 */
const QUICK_TOOL_WIDE = '@container quick-tool (min-aspect-ratio: 2 / 1)';
const QUICK_TOOL_NAME_UNDER =
  '@container quick-tool (max-aspect-ratio: 2 / 1) and (min-width: 72px) and (min-height: 60px)';
const QUICK_TOOL_DETAIL_UNDER =
  '@container quick-tool (max-aspect-ratio: 2 / 1) and (min-width: 130px) and (min-height: 96px)';
const QUICK_TOOL_NAME_BESIDE =
  '@container quick-tool (min-aspect-ratio: 2 / 1) and (min-width: 110px) and (min-height: 28px)';
const QUICK_TOOL_DETAIL_BESIDE =
  '@container quick-tool (min-aspect-ratio: 2 / 1) and (min-width: 200px) and (min-height: 46px)';
/**
 * Text beside the icon stops this much short of the face's 10px padding:
 * 18px from the edge, clear of the LED dot in the top right corner. On
 * the text, so an icon without text stays in the middle.
 */
const QUICK_TOOL_TEXT_BESIDE_END_PADDING = '8px';
/** Long names end in an ellipsis rather than breaking inside a word. */
const QUICK_TOOL_TEXT_SX = {
  maxWidth: '100%',
  overflow: 'hidden',
  overflowWrap: 'normal',
  textOverflow: 'ellipsis',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  wordBreak: 'normal',
} as const;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const buildQuickToolsPanelGradient = (
  isDarkMode: boolean,
  angle: number,
  spread: number
) =>
  isDarkMode
    ? `linear-gradient(${angle}deg, rgba(28,31,37,0.995) 0%, rgba(23,26,32,1) ${spread}%, rgba(18,21,27,1) 100%)`
    : `linear-gradient(${angle}deg, rgba(236,240,246,0.97) 0%, rgba(227,232,240,0.985) ${spread}%, rgba(219,225,234,1) 100%)`;

const buildQuickToolsPanelHighlightGradient = (
  isDarkMode: boolean,
  angle: number,
  spread: number
) => {
  const overlayMidStop = clamp(Math.round(spread * 0.6), 18, 48);
  const overlayEndStop = clamp(overlayMidStop + 28, 38, 78);

  return isDarkMode
    ? `linear-gradient(${angle}deg, rgba(255,255,255,0.032) 0%, rgba(255,255,255,0.012) ${overlayMidStop}%, rgba(255,255,255,0) ${overlayEndStop}%)`
    : `linear-gradient(${angle}deg, rgba(255,255,255,0.44) 0%, rgba(255,255,255,0.2) ${overlayMidStop}%, rgba(255,255,255,0) ${overlayEndStop}%)`;
};

export const HomeQuickToolsPad = ({
  fillHeight = false,
  onOpenApps,
  onOpenChat,
  onOpenQortalLand,
}: HomeQuickToolsPadProps) => {
  const theme = useTheme();
  const { t } = useTranslation('core');
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const transparentDragImageRef = useRef<HTMLCanvasElement | null>(null);
  const [notificationsMuted, setNotificationsMuted] = useState(false);
  const isDarkMode = theme.palette.mode === 'dark';

  useEffect(() => {
    const dragCanvas = document.createElement('canvas');
    dragCanvas.width = 1;
    dragCanvas.height = 1;
    transparentDragImageRef.current = dragCanvas;

    return () => {
      transparentDragImageRef.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;

    window
      .sendMessage('getUserSettings', {
        key: 'disable-push-notifications',
      })
      .then((response) => {
        if (!active || response?.error) return;
        setNotificationsMuted(Boolean(response));
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const handleToggleNotifications = async () => {
    const nextValue = !notificationsMuted;
    setNotificationsMuted(nextValue);

    try {
      const response = await window.sendMessage('addUserSettings', {
        keyValue: {
          key: 'disable-push-notifications',
          value: nextValue,
        },
      });

      if (response?.error) {
        setNotificationsMuted(!nextValue);
        return;
      }

      executeEvent('qortinoContextHint', {
        data: {
          message: t('quick_tools_pad.hint_notifications_desktop_only'),
        },
      });
    } catch {
      setNotificationsMuted(!nextValue);
    }
  };

  const panelGradient = useMemo(
    () =>
      buildQuickToolsPanelGradient(
        isDarkMode,
        QUICK_TOOLS_PANEL_GRADIENT_DEFAULT.angle,
        QUICK_TOOLS_PANEL_GRADIENT_DEFAULT.spread
      ),
    [isDarkMode]
  );

  const panelHighlightGradient = useMemo(
    () =>
      buildQuickToolsPanelHighlightGradient(
        isDarkMode,
        QUICK_TOOLS_PANEL_GRADIENT_DEFAULT.angle,
        QUICK_TOOLS_PANEL_GRADIENT_DEFAULT.spread
      ),
    [isDarkMode]
  );

  // The detail line is a fainter tone of the buttons' ink.
  const detailColor = alpha(
    isDarkMode ? QUICK_TOOL_DARK_INK : theme.palette.text.primary,
    0.64
  );

  const items = useMemo<QuickToolItem[]>(
    () => [
      {
        accent: QUICK_TOOL_LED_COLOR,
        detail: t('core:quick_tools_pad.detail.user_search'),
        iconScale: 1.08,
        key: 'lookup-user',
        label: t('quick_tools_pad.user_search'),
        onAction: () => {
          executeEvent('openUserLookupDrawer', {});
        },
        renderIcon: () => (
          <SearchRoundedIcon sx={{ fontSize: QUICK_TOOL_ICON_SIZE }} />
        ),
      },
      {
        accent: QUICK_TOOL_LED_COLOR,
        detail: t('core:quick_tools_pad.detail.wallets'),
        draggable: true,
        iconScale: 1.08,
        key: 'wallets',
        label: t('quick_tools_pad.wallets'),
        onAction: () => {
          executeEvent('openWalletsApp', {});
        },
        onDragStart: (event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(QORTINO_DONATION_DRAG_TYPE, 'wallets');
          event.dataTransfer.setData('text/plain', 'wallets');
          const dragImage = transparentDragImageRef.current;
          if (dragImage) {
            event.dataTransfer.setDragImage(dragImage, 0, 0);
          }
        },
        renderIcon: () => (
          <AccountBalanceWalletRoundedIcon
            sx={{ fontSize: QUICK_TOOL_ICON_SIZE }}
          />
        ),
      },
      {
        accent: QUICK_TOOL_LED_COLOR,
        detail: t('core:quick_tools_pad.detail.minting'),
        iconScale: 1.04,
        key: 'minting',
        label: t('quick_tools_pad.minting'),
        onAction: () => {
          executeEvent('qortinoContextHint', {
            data: {
              message: t('quick_tools_pad.hint_minting_panel'),
            },
          });
          executeEvent('openMintingPanel', {});
        },
        renderIcon: () => (
          <SpaRoundedIcon sx={{ fontSize: QUICK_TOOL_ICON_SIZE }} />
        ),
      },
      {
        accent: QUICK_TOOL_LED_COLOR,
        detail: t('core:quick_tools_pad.detail.backup_wallet'),
        iconScale: 1.08,
        key: 'backup-wallet',
        label: t('quick_tools_pad.backup_wallet'),
        onAction: () => {
          executeEvent('openGlobalSnackBar', {
            message: t('quick_tools_pad.snackbar_backup_wallet'),
            type: 'info',
            duration: 5600,
          });
          executeEvent('openBackupWallet', {});
        },
        renderIcon: () => (
          <FileDownloadRoundedIcon sx={{ fontSize: QUICK_TOOL_ICON_SIZE }} />
        ),
      },
      {
        accent: QUICK_TOOL_LED_COLOR,
        detail: t('core:quick_tools_pad.detail.q_chat'),
        iconOffsetY: -0.15,
        iconScale: 0.9,
        key: 'q-chat',
        label: t('quick_tools_pad.q_chat'),
        onAction: () => {
          onOpenChat?.();
        },
        renderIcon: () => (
          <MessagingIconFilled height={20} width={20} color="currentColor" />
        ),
      },
      {
        accent: QUICK_TOOL_LED_COLOR,
        detail: notificationsMuted
          ? t('core:quick_tools_pad.detail.notifications_muted')
          : t('core:quick_tools_pad.detail.notifications_on'),
        iconScale: 1.07,
        isActive: !notificationsMuted,
        key: 'notifications',
        // The label says what a click does; the name says what the tool is.
        label: notificationsMuted
          ? t('quick_tools_pad.notifications_enable')
          : t('quick_tools_pad.notifications_mute'),
        name: t('core:quick_tools_pad.notifications'),
        onAction: () => {
          void handleToggleNotifications();
        },
        renderIcon: () =>
          notificationsMuted ? (
            <NotificationsOffRoundedIcon
              sx={{ fontSize: QUICK_TOOL_ICON_SIZE }}
            />
          ) : (
            <NotificationsActiveRoundedIcon
              sx={{ fontSize: QUICK_TOOL_ICON_SIZE }}
            />
          ),
      },
      {
        accent: QUICK_TOOL_LED_COLOR,
        detail: t('core:quick_tools_pad.detail.apps'),
        iconScale: 0.9,
        key: 'apps',
        label: t('quick_tools_pad.apps'),
        onAction: () => {
          onOpenApps?.();
        },
        renderIcon: () => (
          <AppsIcon height={20} width={20} color="currentColor" />
        ),
      },
      {
        accent: QUICK_TOOL_LED_COLOR,
        detail: t('core:quick_tools_pad.detail.qortal_land'),
        iconScale: 1.04,
        key: 'qortal-land',
        label: 'QortalLand',
        onAction: () => {
          onOpenQortalLand?.();
        },
        renderIcon: () => (
          <SportsEsportsIcon sx={{ fontSize: QUICK_TOOL_ICON_SIZE }} />
        ),
      },
    ],
    [notificationsMuted, onOpenApps, onOpenChat, onOpenQortalLand, t]
  );

  return (
    <Box
      ref={panelRef}
      sx={{
        ...dashboardPanelSx(theme, 'base'),
        borderRadius: '14px',
        display: 'flex',
        height: fillHeight ? '100%' : 'auto',
        minHeight: fillHeight ? 0 : '164px',
        padding: '10px',
        width: '100%',
      }}
      onMouseMove={handleDashboardPanelPointerMove}
      onMouseLeave={handleDashboardPanelPointerLeave}
    >
      <Box
        sx={{
          background: panelGradient,
          border: `1px solid ${
            isDarkMode
              ? 'rgba(255,255,255,0.068)'
              : alpha(theme.palette.text.primary, 0.105)
          }`,
          borderRadius: '16px',
          boxShadow: isDarkMode
            ? 'inset 0 1px 0 rgba(255,255,255,0.055), inset 0 -1px 0 rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.018), 0 0 0 1px rgba(0,0,0,0.18), 0 8px 18px rgba(0,0,0,0.16)'
            : 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(102,112,132,0.2), inset 0 0 0 1px rgba(255,255,255,0.28), 0 0 0 1px rgba(120,132,156,0.08), 0 8px 18px rgba(84,96,120,0.11)',
          display: 'grid',
          gap: '7px',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
          minHeight: 0,
          padding: '6px',
          position: 'relative',
          width: '100%',
          [HOME_WINDOW_WIDE_AND_SHORT]: {
            gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
            gridTemplateRows: 'minmax(0, 1fr)',
          },
          [HOME_WINDOW_NARROW_AND_TALL]: {
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gridTemplateRows: 'repeat(4, minmax(0, 1fr))',
          },
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: '1px',
            borderRadius: 'inherit',
            pointerEvents: 'none',
            background: panelHighlightGradient,
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            boxShadow: isDarkMode
              ? 'inset 1px 1px 0 rgba(255,255,255,0.012), inset -1px -1px 0 rgba(0,0,0,0.28)'
              : 'inset 1px 1px 0 rgba(255,255,255,0.36), inset -1px -1px 0 rgba(130,142,166,0.12)',
          },
        }}
      >
        {items.map((item) => (
          <Tooltip
            key={item.key}
            disableHoverListener={!item.label}
            enterDelay={350}
            title={item.label}
          >
            <ButtonBase
              aria-label={item.label}
              data-tour={
                item.key === 'qortal-land'
                  ? 'hub-dashboard-qortal-land'
                  : undefined
              }
              draggable={item.draggable}
              onClick={(event) => item.onAction(event)}
              onDragStart={item.onDragStart}
              sx={{
                order: QUICK_TOOL_ORDER.indexOf(item.key),
                alignItems: 'center',
                background: isDarkMode
                  ? 'linear-gradient(145deg, rgba(53,58,68,0.99) 0%, rgba(41,45,54,1) 48%, rgba(30,34,41,1) 100%)'
                  : 'linear-gradient(145deg, rgba(251,253,255,0.99) 0%, rgba(232,237,245,0.99) 48%, rgba(216,223,234,1) 100%)',
                border: `1px solid ${
                  isDarkMode
                    ? alpha(item.accent, item.isActive ? 0.16 : 0.06)
                    : alpha(theme.palette.text.primary, 0.072)
                }`,
                borderRadius: '12px',
                boxShadow: isDarkMode
                  ? `inset 0 1px 0 rgba(255,255,255,0.075), inset 0 0 0 1px rgba(255,255,255,0.012), inset 0 -1px 0 rgba(0,0,0,0.44), inset -1px -1px 0 rgba(0,0,0,0.18), 0 4px 8px rgba(0,0,0,0.17), 0 0 0 1px ${alpha(item.accent, item.isActive ? 0.03 : 0.012)}`
                  : `inset 0 1px 0 rgba(255,255,255,0.86), inset 0 0 0 1px rgba(255,255,255,0.24), inset 0 -1px 0 rgba(104,116,140,0.22), inset -1px -1px 0 rgba(146,158,182,0.14), 0 4px 8px rgba(94,108,132,0.11)`,
                color: isDarkMode
                  ? alpha(QUICK_TOOL_DARK_INK, item.isActive ? 0.96 : 0.88)
                  : alpha(
                      theme.palette.text.primary,
                      item.isActive ? 0.92 : 0.84
                    ),
                containerName: 'quick-tool',
                containerType: 'size',
                display: 'flex',
                height: '100%',
                justifyContent: 'center',
                minHeight: 0,
                position: 'relative',
                transition:
                  'transform 90ms ease, filter 120ms ease, border-color 140ms ease, box-shadow 140ms ease, color 140ms ease',
                width: '100%',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  inset: '1px',
                  borderRadius: 'inherit',
                  pointerEvents: 'none',
                  background: isDarkMode
                    ? 'linear-gradient(145deg, rgba(255,255,255,0.052) 0%, rgba(255,255,255,0.02) 24%, rgba(255,255,255,0) 58%)'
                    : 'linear-gradient(145deg, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.22) 28%, rgba(255,255,255,0) 58%)',
                  opacity: item.isActive ? 1 : 0.92,
                },
                '&::after': {
                  backgroundColor: alpha(
                    item.accent,
                    item.isActive ? 0.96 : 0.56
                  ),
                  borderRadius: '50%',
                  boxShadow: isDarkMode
                    ? `0 0 0 1px rgba(8,10,14,0.24), 0 0 4px ${alpha(item.accent, item.isActive ? 0.18 : 0.1)}`
                    : `0 0 0 1px rgba(255,255,255,0.54), 0 0 3px ${alpha(item.accent, item.isActive ? 0.14 : 0.08)}`,
                  content: '""',
                  height: QUICK_TOOL_DOT_SIZE,
                  opacity: item.isActive ? 0.95 : 0.68,
                  position: 'absolute',
                  right: QUICK_TOOL_DOT_OFFSET,
                  top: QUICK_TOOL_DOT_OFFSET,
                  width: QUICK_TOOL_DOT_SIZE,
                },
                '&:hover': {
                  filter: 'brightness(1.05)',
                  '&::after': {
                    backgroundColor: '#7cc7ff',
                    boxShadow:
                      '0 0 6px rgba(124, 199, 255, 0.8), 0 0 12px rgba(124, 199, 255, 0.4)',
                    opacity: 1,
                  },
                },
                '&:active': {
                  boxShadow:
                    'inset 2px 2px 6px rgba(0, 0, 0, 0.7), inset -1px -1px 3px rgba(255, 255, 255, 0.04)',
                  transform: 'scale(0.97)',
                  '&::after': {
                    boxShadow:
                      '0 0 4px rgba(124, 199, 255, 1), 0 0 8px rgba(124, 199, 255, 0.6)',
                  },
                },
                // The name and the detail show as the button grows. On a
                // button exactly twice as wide as it is tall, both detail
                // rules match, and "beside" wins by coming later: MUI puts
                // @container rules in min-width order (200px after 130px).
                [QUICK_TOOL_WIDE]: {
                  '& .quick-tool-face': {
                    flexDirection: 'row',
                    gap: '8px',
                    paddingInline: '10px',
                  },
                  '& .quick-tool-text': {
                    alignItems: 'flex-start',
                    paddingRight: QUICK_TOOL_TEXT_BESIDE_END_PADDING,
                    textAlign: 'left',
                  },
                  '& .quick-tool-name': { display: 'block' },
                  '& .quick-tool-name, & .quick-tool-detail': {
                    whiteSpace: 'nowrap',
                  },
                },
                [QUICK_TOOL_NAME_UNDER]: {
                  '& .quick-tool-text': { display: 'flex' },
                },
                [QUICK_TOOL_DETAIL_UNDER]: {
                  '& .quick-tool-detail': { display: '-webkit-box' },
                },
                [QUICK_TOOL_NAME_BESIDE]: {
                  '& .quick-tool-text': { display: 'flex' },
                },
                [QUICK_TOOL_DETAIL_BESIDE]: {
                  '& .quick-tool-detail': { display: 'block' },
                },
              }}
            >
              <Box
                className="quick-tool-face"
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  height: '100%',
                  justifyContent: 'center',
                  minWidth: 0,
                  padding: '4px 6px',
                  width: '100%',
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    color: 'inherit',
                    display: 'inline-flex',
                    flexShrink: 0,
                    height: `${QUICK_TOOL_ICON_BOX_SIZE_PX}px`,
                    justifyContent: 'center',
                    lineHeight: 1,
                    overflow: 'visible',
                    width: `${QUICK_TOOL_ICON_BOX_SIZE_PX}px`,
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'inline-flex',
                      justifyContent: 'center',
                      transform: `translate(${item.iconOffsetX ?? 0}px, ${
                        item.iconOffsetY ?? 0
                      }px) scale(${item.iconScale ?? 1})`,
                      transformOrigin: 'center',
                    }}
                  >
                    {item.renderIcon()}
                  </Box>
                </Box>
                {/* Hidden until the button has room (QUICK_TOOL_*). */}
                <Box
                  className="quick-tool-text"
                  sx={{
                    alignItems: 'center',
                    display: 'none',
                    flexDirection: 'column',
                    gap: '2px',
                    maxWidth: '100%',
                    minWidth: 0,
                    textAlign: 'center',
                  }}
                >
                  <Typography
                    className="quick-tool-name"
                    component="span"
                    sx={{
                      ...QUICK_TOOL_TEXT_SX,
                      display: '-webkit-box',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      lineHeight: 1.15,
                    }}
                  >
                    {item.name ?? item.label}
                  </Typography>
                  <Typography
                    className="quick-tool-detail"
                    component="span"
                    sx={{
                      ...QUICK_TOOL_TEXT_SX,
                      color: detailColor,
                      display: 'none',
                      fontSize: '0.64rem',
                      fontWeight: 500,
                      lineHeight: 1.2,
                    }}
                  >
                    {item.detail}
                  </Typography>
                </Box>
              </Box>
            </ButtonBase>
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
};
