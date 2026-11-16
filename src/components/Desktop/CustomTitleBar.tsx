import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import CloseIcon from '@mui/icons-material/Close';
import MenuIcon from '@mui/icons-material/Menu';
import RemoveIcon from '@mui/icons-material/Remove';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import FilterNoneIcon from '@mui/icons-material/FilterNone';
import QortalLogo from '../../assets/svgs/Logo1Dark.svg';
import qortalLogoTitleMinting from '../../assets/sidebar/qortal-logo-title-minting.webp';
import { WalletIcon } from '../../assets/Icons/WalletIcon';
import { coreInfoSurfaceSx } from './coreInfoSurface';
import { NodeStateLogo } from './NodeStateLogo';
import { useNodeState } from './nodeState';

// Loaded when first opened: the title bar stays light.
const CoreSyncStatus = lazy(() =>
  import('../CoreSyncStatus').then((module) => ({
    default: module.CoreSyncStatus,
  }))
);

/** Calls `onMount` once it shows: after what loads with it, in Suspense. */
const WhenShown = ({ onMount }: { onMount: () => void }) => {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return null;
};

const TITLE_BAR_HEIGHT = 32;
export const APP_NAV_BAR_HEIGHT = 48;
/** Left offset so title-bar nav aligns with content vertical line (DesktopLeftSideBar width). */
const TITLE_BAR_LEFT_OFFSET_PX = 70;
const TITLE_BAR_MENU_WIDTH_PX = 40;
/** How tall the title bar is while the apps bar is in it. */
export const APPS_BAR_TITLE_BAR_HEIGHT = 44;
/** How much taller than `TITLE_BAR_HEIGHT` the title bar is, for CSS. */
export const TITLE_BAR_EXTRA_VAR = '--qortal-title-bar-extra';
export const CUSTOM_TITLE_BAR_HEIGHT = TITLE_BAR_HEIGHT;

const titleBarExtraCss = `var(${TITLE_BAR_EXTRA_VAR}, 0px)`;

/**
 * How much of the window the chrome takes. The title bar grows when the apps
 * bar is in it, so these are worked out as they are used: in CSS through the
 * variable above, and in script through the two functions below.
 */
export const appHeighOffsetPx = `calc(${TITLE_BAR_HEIGHT}px + ${titleBarExtraCss})`;
export const appHeighOffset = TITLE_BAR_HEIGHT;
export const appChromeOffsetPx = `calc(${TITLE_BAR_HEIGHT + APP_NAV_BAR_HEIGHT}px + ${titleBarExtraCss})`;
export const appChromeOffset = TITLE_BAR_HEIGHT + APP_NAV_BAR_HEIGHT;

let titleBarExtraHeight = 0;

/** The title bar says how much taller than its own height it is. */
export function setTitleBarExtraHeight(pixels: number) {
  titleBarExtraHeight = Math.max(0, pixels);
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(
    TITLE_BAR_EXTRA_VAR,
    `${titleBarExtraHeight}px`
  );
}

/** The height of the title bar as it is now. */
export const appHeighOffsetNow = () => appHeighOffset + titleBarExtraHeight;

/** The height of the title bar and the nav bar as they are now. */
export const appChromeOffsetNow = () => appChromeOffset + titleBarExtraHeight;
export const titleBarIconButtonProps = {
  disableFocusRipple: true,
  tabIndex: -1,
};

export type CustomTitleBarRightNavProps = {
  desktopViewMode: string;
  extState: string;
  isMainWindow: boolean;
  userInfo: { address?: string; name?: string } | null;
  onOpenSettings: () => void;
  onOpenDrawerLookup: () => void;
  onOpenWalletsApp: () => void;
  onLock: () => void;
  onLogout: () => void;
  getUserInfo: (useTimer?: boolean) => Promise<void>;
  onOpenMinting: () => void;
  onBackupWallet: () => void;
};

function useIsElectron(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.electronAPI?.windowMinimize === 'function'
  );
}

function usePlatform(): string {
  const [platform, setPlatform] = useState<string>('unknown');
  useEffect(() => {
    if (typeof window.electronAPI?.getPlatform !== 'function') return;
    window.electronAPI.getPlatform().then(setPlatform);
  }, []);
  return platform;
}

const tooltipSlotProps = (theme: {
  palette: { text: { primary: string }; background: { paper: string } };
}) => ({
  tooltip: {
    sx: {
      color: theme.palette.text.primary,
      backgroundColor: theme.palette.background.paper,
    },
  },
  arrow: {
    sx: {
      color: theme.palette.text.primary,
    },
  },
});

export function CustomTitleBar(props?: {
  rightNav?: CustomTitleBarRightNavProps | null;
  /**
   * The account's pinned apps and bookmarks, to show in this bar. With one,
   * the bar is taller and the title moves out of the middle to make room.
   */
  appsBar?: ReactNode;
}) {
  const { appsBar, rightNav } = props ?? {};
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group']);
  const isElectron = useIsElectron();
  const platform = usePlatform();
  const [isMaximized, setIsMaximized] = useState(false);
  const nodeState = useNodeState();
  // Signed in, in the main window: the title shows the node's information.
  const canShowNodeInfo = !!rightNav;
  const [isNodeInfoOpen, setIsNodeInfoOpen] = useState(false);
  // The information loads the first time it opens: it's placed again then.
  const nodeInfoPopper = useRef<{ update: () => unknown } | null>(null);
  const placeNodeInfo = useCallback(() => {
    void nodeInfoPopper.current?.update();
  }, []);

  const isMac = platform === 'darwin';

  const hasAppsBar = !!appsBar;
  const barHeight = hasAppsBar ? APPS_BAR_TITLE_BAR_HEIGHT : TITLE_BAR_HEIGHT;

  useEffect(() => {
    // What the rest of the window has to leave for the chrome.
    setTitleBarExtraHeight(barHeight - TITLE_BAR_HEIGHT);
    return () => setTitleBarExtraHeight(0);
  }, [barHeight]);

  const refreshMaximized = useCallback(() => {
    if (typeof window.electronAPI?.getWindowState !== 'function') return;
    window.electronAPI
      .getWindowState()
      .then((s) => setIsMaximized(s.isMaximized));
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    refreshMaximized();
  }, [isElectron, refreshMaximized]);

  useEffect(() => {
    if (
      !isElectron ||
      typeof window.electronAPI?.onWindowStateChange !== 'function'
    )
      return;
    return window.electronAPI.onWindowStateChange((state) => {
      setIsMaximized(Boolean(state?.isMaximized));
    });
  }, [isElectron, refreshMaximized]);

  const handleMinimize = useCallback(() => {
    window.electronAPI?.windowMinimize?.();
  }, []);

  const handleMaximize = useCallback(() => {
    window.electronAPI?.windowMaximize?.().then(refreshMaximized);
  }, [refreshMaximized]);

  const handleClose = useCallback(() => {
    window.electronAPI?.windowClose?.();
  }, []);

  const handleShowAppMenu = useCallback((e: React.MouseEvent) => {
    window.electronAPI?.showAppMenu?.(e.clientX, e.clientY);
  }, []);

  const handleTitleBarDoubleClick = useCallback(() => {
    if (platform === 'win32' || platform === 'linux') {
      window.electronAPI?.windowMaximize?.().then(refreshMaximized);
    } else if (platform === 'darwin') {
      window.electronAPI?.windowMaximize?.().then(refreshMaximized);
    }
  }, [platform, refreshMaximized]);

  const bg =
    theme.palette.mode === 'dark'
      ? 'rgba(34, 37, 43, 0.97)'
      : theme.palette.background.paper;
  const borderColor =
    theme.palette.mode === 'dark'
      ? theme.palette.border.subtle
      : theme.palette.divider;
  const controlColor = theme.palette.text.secondary;
  const controlHover =
    theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.09)'
      : theme.palette.action.hover;
  const toolbarShadow =
    theme.palette.mode === 'dark'
      ? '0 1px 0 rgba(255,255,255,0.05), 0 10px 20px rgba(0,0,0,0.14)'
      : '0 1px 0 rgba(15,23,42,0.06), 0 6px 14px rgba(15,23,42,0.05)';

  const macColors = {
    close: '#ff5f57',
    minimize: '#febc2e',
    maximize: '#28c840',
  };

  const macWindowControls = (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexShrink: 0,
        gap: 0.5,
        pl: 1.5,
        WebkitAppRegion: 'no-drag',
      }}
    >
      <IconButton
        {...titleBarIconButtonProps}
        size="small"
        onClick={handleClose}
        sx={{
          width: 12,
          height: 12,
          minWidth: 12,
          minHeight: 12,
          borderRadius: '50%',
          backgroundColor: macColors.close,
          '&:hover': { backgroundColor: '#bf4942', filter: 'brightness(0.95)' },
        }}
        aria-label="Close"
      />
      <IconButton
        {...titleBarIconButtonProps}
        size="small"
        onClick={handleMinimize}
        sx={{
          width: 12,
          height: 12,
          minWidth: 12,
          minHeight: 12,
          borderRadius: '50%',
          backgroundColor: macColors.minimize,
          '&:hover': { backgroundColor: '#c9972a', filter: 'brightness(0.95)' },
        }}
        aria-label="Minimize"
      />
      <IconButton
        {...titleBarIconButtonProps}
        size="small"
        onClick={handleMaximize}
        sx={{
          width: 12,
          height: 12,
          minWidth: 12,
          minHeight: 12,
          borderRadius: '50%',
          backgroundColor: macColors.maximize,
          '&:hover': { backgroundColor: '#1aab29', filter: 'brightness(0.95)' },
        }}
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
      />
    </Box>
  );

  const winWindowControls = (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexShrink: 0,
        height: '100%',
        WebkitAppRegion: 'no-drag',
      }}
    >
      <IconButton
        {...titleBarIconButtonProps}
        size="small"
        onClick={handleMinimize}
        sx={{
          color: controlColor,
          borderRadius: 0,
          width: 46,
          height: barHeight,
          padding: 0,
          '&:hover': { backgroundColor: controlHover },
        }}
        aria-label="Minimize"
      >
        <RemoveIcon sx={{ fontSize: 16 }} />
      </IconButton>
      <IconButton
        {...titleBarIconButtonProps}
        size="small"
        onClick={handleMaximize}
        sx={{
          color: controlColor,
          borderRadius: 0,
          width: 46,
          height: barHeight,
          padding: 0,
          '&:hover': { backgroundColor: controlHover },
        }}
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <FilterNoneIcon sx={{ fontSize: 14 }} />
        ) : (
          <CropSquareIcon sx={{ fontSize: 14 }} />
        )}
      </IconButton>
      <IconButton
        {...titleBarIconButtonProps}
        size="small"
        onClick={handleClose}
        sx={{
          color: controlColor,
          borderRadius: 0,
          width: 46,
          height: barHeight,
          padding: 0,
          '&:hover': {
            backgroundColor: '#e81123',
            color: '#fff',
          },
        }}
        aria-label="Close"
      >
        <CloseIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );

  const menuButton = (
    <IconButton
      {...titleBarIconButtonProps}
      size="small"
      onClick={handleShowAppMenu}
      sx={{
        color: controlColor,
        borderRadius: 0,
        width: 40,
        height: barHeight,
        padding: 0,
        WebkitAppRegion: 'no-drag',
        transition:
          'background-color 140ms ease, color 140ms ease, transform 120ms ease',
        '&:hover': { backgroundColor: controlHover },
        '&:focus-visible': {
          outline: `1px solid ${theme.palette.primary.main}`,
          outlineOffset: '-1px',
        },
      }}
      aria-label="Application menu"
    >
      <MenuIcon sx={{ fontSize: 20 }} />
    </IconButton>
  );

  // The logo and name are grey on the public node and blue on the user's
  // own, with the logo's small cube in gold while it mints.
  const titleInner = (
    <>
      <NodeStateLogo
        alt=""
        highlighted={isNodeInfoOpen}
        mintingSrc={qortalLogoTitleMinting}
        size={20}
        src={QortalLogo}
        state={nodeState}
      />
      <Typography
        variant="body2"
        sx={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.02em',
          lineHeight: 1,
          color:
            nodeState === 'public'
              ? theme.palette.text.secondary
              : theme.palette.primary.main,
          transition: 'color 0.2s ease',
        }}
      >
        Qortal Hub
      </Typography>
    </>
  );

  // The title, clickable for the node's information once signed in. It
  // sits in the middle, or on the left when the apps bar takes the middle.
  const titleBadge = canShowNodeInfo ? (
    <Tooltip
      // On hover, at once; a click or the keyboard opens it too.
      enterDelay={0}
      enterNextDelay={0}
      leaveDelay={120}
      onClose={() => setIsNodeInfoOpen(false)}
      onOpen={() => setIsNodeInfoOpen(true)}
      open={isNodeInfoOpen}
      placement="bottom"
      slotProps={{
        popper: { popperRef: nodeInfoPopper as never },
        tooltip: { sx: coreInfoSurfaceSx(theme) },
      }}
      title={
        // The same information as the side panel's logo on hover.
        <Suspense fallback={null}>
          <CoreSyncStatus panelOnly />
          <WhenShown onMount={placeNodeInfo} />
        </Suspense>
      }
    >
      <ButtonBase
        aria-expanded={isNodeInfoOpen}
        aria-label={t('core:core.information', {
          postProcess: 'capitalizeFirstChar',
        })}
        onClick={() => setIsNodeInfoOpen(true)}
        // A double click here isn't the title bar's maximize.
        onDoubleClick={(event) => event.stopPropagation()}
        sx={{
          alignItems: 'center',
          borderRadius: 999,
          display: 'flex',
          gap: 0.5,
          pl: 0.5,
          pr: 1,
          pointerEvents: 'auto',
          py: 0.25,
          transition: 'background-color 140ms ease',
          WebkitAppRegion: 'no-drag',
          '&:hover': { backgroundColor: controlHover },
          '&.Mui-focusVisible': {
            outline: `1px solid ${theme.palette.primary.main}`,
          },
        }}
      >
        {titleInner}
      </ButtonBase>
    </Tooltip>
  ) : (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
      }}
    >
      {titleInner}
    </Box>
  );

  const titleContent = (
    <Box
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      {titleBadge}
    </Box>
  );

  // With the apps bar in it the middle is taken, so the title sits on the
  // left, after the menu button.
  const titleAtTheLeft = (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexShrink: 0,
        pl: 1,
        pr: 0.5,
      }}
    >
      {titleBadge}
    </Box>
  );

  /** What fills the middle: the apps bar, or nothing but room to drag. */
  const middle = hasAppsBar ? appsBar : <Box sx={{ flex: 1 }} />;

  const tooltipTitle = (text: string) => (
    <span
      style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase' }}
    >
      {text}
    </span>
  );

  const leftPushCluster = (children: React.ReactNode) => (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      {children}
    </Box>
  );

  return (
    <Box
      onDoubleClick={isElectron ? handleTitleBarDoubleClick : undefined}
      sx={{
        position: 'relative',
        alignItems: 'center',
        borderBottom: '1px solid',
        borderColor,
        backgroundColor: bg,
        boxShadow: toolbarShadow,
        display: 'flex',
        flexDirection: 'row',
        height: barHeight,
        minHeight: barHeight,
        width: '100%',
        ...(isElectron && { WebkitAppRegion: 'drag' }),
      }}
    >
      {!hasAppsBar && titleContent}
      {isElectron &&
        (isMac ? (
          <>
            {leftPushCluster(
              <>
                {macWindowControls}
                {menuButton}
                {hasAppsBar && titleAtTheLeft}
              </>
            )}
            {middle}
            <Box sx={{ width: 52 }} />
          </>
        ) : (
          <>
            {leftPushCluster(
              <>
                {menuButton}
                {hasAppsBar && titleAtTheLeft}
              </>
            )}
            {middle}
            {winWindowControls}
          </>
        ))}
      {!isElectron && (
        <>
          {leftPushCluster(
            <>
              <Box
                sx={{
                  width: TITLE_BAR_LEFT_OFFSET_PX,
                  minWidth: TITLE_BAR_LEFT_OFFSET_PX,
                }}
              />
              {hasAppsBar && titleAtTheLeft}
            </>
          )}
          {middle}
        </>
      )}
    </Box>
  );
}
