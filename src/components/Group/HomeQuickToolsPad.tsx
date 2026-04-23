import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react';
import {
  Box,
  ButtonBase,
  Tooltip,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import ManageSearchRoundedIcon from '@mui/icons-material/ManageSearchRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import NotificationsOffRoundedIcon from '@mui/icons-material/NotificationsOffRounded';
import SpaRoundedIcon from '@mui/icons-material/SpaRounded';
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
import { QORTINO_SANDBOX_EVENT } from './qortinoSandbox';

type HomeQuickToolsPadProps = {
  fillHeight?: boolean;
  onOpenApps?: () => void;
  onOpenChat?: () => void;
  onOpenSettings?: () => void;
};

type QuickToolItem = {
  accent: string;
  draggable?: boolean;
  iconOffsetX?: number;
  iconOffsetY?: number;
  iconScale?: number;
  isActive?: boolean;
  key: string;
  label: string;
  onAction: (event: MouseEvent<HTMLElement>) => void;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  renderIcon: () => React.ReactNode;
};

const QUICK_TOOL_ICON_SIZE = '1.14rem';
const QUICK_TOOL_ICON_BOX_SIZE_PX = 20;
const QUICK_TOOL_DOT_OFFSET = '7px';
const QUICK_TOOL_DOT_SIZE = '5px';
const QUICK_TOOL_LED_COLOR = '#8FD8FF';
const QUICK_TOOLS_PANEL_GRADIENT_DEFAULT = {
  angle: 197,
  spread: 76,
};

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
}: HomeQuickToolsPadProps) => {
  const theme = useTheme();
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
          message:
            'This only mutes desktop alerts. In-Hub notifications still continue.',
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

  const items = useMemo<QuickToolItem[]>(
    () => [
      {
        accent: QUICK_TOOL_LED_COLOR,
        iconScale: 1.08,
        key: 'lookup-user',
        label: 'User Search',
        onAction: () => {
          executeEvent('openUserLookupDrawer', {});
        },
        renderIcon: () => (
          <ManageSearchRoundedIcon sx={{ fontSize: QUICK_TOOL_ICON_SIZE }} />
        ),
      },
      {
        accent: QUICK_TOOL_LED_COLOR,
        draggable: true,
        iconScale: 1.08,
        key: 'wallets',
        label: 'Wallets',
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
        iconScale: 1.04,
        key: 'minting',
        label: 'Minting',
        onAction: () => {
          executeEvent('qortinoContextHint', {
            data: {
              message:
                'This panel unlocks once you’re a minter. Swing by Q-Mintership to get started!',
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
        iconScale: 1.08,
        key: 'backup-wallet',
        label: 'Backup Wallet',
        onAction: () => {
          executeEvent('openGlobalSnackBar', {
            message:
              'Backup exports your wallet locally. This stays on your device.',
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
        iconOffsetY: -0.15,
        iconScale: 0.9,
        key: 'q-chat',
        label: 'Q-Chat',
        onAction: () => {
          onOpenChat?.();
        },
        renderIcon: () => (
          <MessagingIconFilled
            height={20}
            width={20}
            color="currentColor"
          />
        ),
      },
      {
        accent: QUICK_TOOL_LED_COLOR,
        iconScale: 1.07,
        isActive: !notificationsMuted,
        key: 'notifications',
        label: notificationsMuted
          ? 'Enable Notifications'
          : 'Mute Notifications',
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
        iconScale: 0.9,
        key: 'apps',
        label: 'Apps',
        onAction: () => {
          onOpenApps?.();
        },
        renderIcon: () => (
          <AppsIcon height={20} width={20} color="currentColor" />
        ),
      },
      {
        accent: QUICK_TOOL_LED_COLOR,
        iconScale: 1.1,
        key: 'qortino-sandbox',
        label: 'QORTINO Lab',
        onAction: () => {
          executeEvent(QORTINO_SANDBOX_EVENT, {});
        },
        renderIcon: () => (
          <AddRoundedIcon sx={{ fontSize: QUICK_TOOL_ICON_SIZE }} />
        ),
      },
    ],
    [
      notificationsMuted,
      onOpenApps,
      onOpenChat,
    ]
  );

  return (
    <Box
      ref={panelRef}
      sx={{
        ...dashboardPanelSx(theme, 'base'),
        borderRadius: '14px',
        display: 'flex',
        height: fillHeight ? '100%' : 'auto',
        minHeight: '164px',
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
          <Tooltip key={item.key} enterDelay={350} title={item.label}>
            <ButtonBase
              draggable={item.draggable}
              onClick={(event) => item.onAction(event)}
              onDragStart={item.onDragStart}
              sx={{
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
                  ? alpha('#F6F8FB', item.isActive ? 0.96 : 0.88)
                  : alpha(theme.palette.text.primary, item.isActive ? 0.92 : 0.84),
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
                  backgroundColor: alpha(item.accent, item.isActive ? 0.96 : 0.56),
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
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  color: 'inherit',
                  display: 'inline-flex',
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
            </ButtonBase>
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
};
