import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
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
import LogoutIcon from '@mui/icons-material/Logout';
import SettingsIcon from '@mui/icons-material/Settings';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import EngineeringIcon from '@mui/icons-material/Engineering';
import HelpIcon from '@mui/icons-material/Help';
import DownloadIcon from '@mui/icons-material/Download';
import QortalLogo from '../../assets/svgs/Logo1Dark.svg';
import { WalletIcon } from '../../assets/Icons/WalletIcon';
import { QMailStatus } from '../QMailStatus';
import { GeneralNotifications } from '../GeneralNotifications';
import { Save } from '../Save/Save';
import { TaskManager } from '../TaskManager/TaskManager';
import { GlobalActions } from '../GlobalActions/GlobalActions';
import { ChatWidgetReopenIcon } from '../Profile/ChatWidgetReopenIcon';

const TITLE_BAR_HEIGHT = 32;
export const CUSTOM_TITLE_BAR_HEIGHT = TITLE_BAR_HEIGHT;
export const appHeighOffsetPx = `${TITLE_BAR_HEIGHT}px`;
export const appHeighOffset = TITLE_BAR_HEIGHT;
declare global {
  interface Window {
    electronAPI?: {
      windowMinimize?: () => Promise<void>;
      windowMaximize?: () => Promise<void>;
      windowClose?: () => Promise<void>;
      getWindowState?: () => Promise<{ isMaximized: boolean }>;
      getPlatform?: () => Promise<string>;
      showAppMenu?: (x?: number, y?: number) => Promise<void>;
    };
  }
}

export type CustomTitleBarRightNavProps = {
  desktopViewMode: string;
  extState: string;
  isMainWindow: boolean;
  userInfo: { address?: string; name?: string } | null;
  onOpenSettings: () => void;
  onOpenDrawerLookup: () => void;
  onOpenWalletsApp: () => void;
  onOpenDrawerProfile: () => void;
  onLogout: () => void;
  getUserInfo: (useTimer?: boolean) => Promise<void>;
  onOpenMinting: () => void;
  showTutorial: (key: string, force?: boolean) => void;
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
}) {
  const { rightNav } = props ?? {};
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group']);
  const isElectron = useIsElectron();
  const platform = usePlatform();
  const [isMaximized, setIsMaximized] = useState(false);

  const isMac = platform === 'darwin';

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
    if (!isElectron || typeof window.electronAPI?.getWindowState !== 'function')
      return;
    const interval = setInterval(refreshMaximized, 500);
    return () => clearInterval(interval);
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
    theme.palette.mode === 'dark' ? '#27282c' : theme.palette.background.paper;
  const borderColor = theme.palette.divider;
  const controlColor = theme.palette.text.secondary;
  const controlHover = theme.palette.action.hover;

  const macColors = {
    close: '#ff5f57',
    minimize: '#febc2e',
    maximize: '#28c840',
  };

  const titleBarIconButtonProps = {
    disableFocusRipple: true,
    tabIndex: -1,
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
          height: TITLE_BAR_HEIGHT,
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
          height: TITLE_BAR_HEIGHT,
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
          height: TITLE_BAR_HEIGHT,
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
        height: TITLE_BAR_HEIGHT,
        padding: 0,
        WebkitAppRegion: 'no-drag',
        '&:hover': { backgroundColor: controlHover },
      }}
      aria-label="Application menu"
    >
      <MenuIcon sx={{ fontSize: 20 }} />
    </IconButton>
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
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
        }}
      >
        <Box
          component="img"
          src={QortalLogo}
          alt=""
          sx={{ height: 20, width: 'auto', display: 'block' }}
        />
        <Typography
          variant="body2"
          sx={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.02em',
            lineHeight: 1,
            color: theme.palette.text.primary,
          }}
        >
          Qortal Hub
        </Typography>
      </Box>
    </Box>
  );

  const tooltipTitle = (text: string) => (
    <span
      style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase' }}
    >
      {text}
    </span>
  );

  const navIconSx = {
    color: controlColor,
    width: 32,
    height: 32,
    borderRadius: 1,
    '&:hover': { backgroundColor: controlHover },
  };

  /** Uniform 32x32 cell for widgets so all title-bar icons align; scales inner icons to 20px */
  const navCellSx = {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
    '& .MuiSvgIcon-root': { fontSize: 20 },
    '& .MuiIconButton-root': { width: 32, height: 32, padding: 0, minWidth: 0 },
    '& svg': { width: 20, height: 20 },
  };

  const rightNavSection = rightNav && (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexShrink: 0,
        gap: 0.5,
        height: '100%',
        pl: 0.5,
        pr: 0.5,
        ...(isElectron && { WebkitAppRegion: 'no-drag' }),
      }}
    >
      <Tooltip
        title={tooltipTitle(t('core:settings'))}
        placement="bottom"
        arrow
        slotProps={tooltipSlotProps(theme)}
      >
        <IconButton
          {...titleBarIconButtonProps}
          size="small"
          onClick={rightNav.onOpenSettings}
          sx={navIconSx}
          aria-label={t('core:settings')}
        >
          <SettingsIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Tooltip>
      <Tooltip
        title={tooltipTitle(
          t('core:user_lookup', { postProcess: 'capitalizeAll' })
        )}
        placement="bottom"
        arrow
        slotProps={tooltipSlotProps(theme)}
      >
        <IconButton
          {...titleBarIconButtonProps}
          size="small"
          onClick={rightNav.onOpenDrawerLookup}
          sx={navIconSx}
          aria-label={t('core:user_lookup')}
        >
          <PersonSearchIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Tooltip>
      <Tooltip
        title={tooltipTitle(t('core:wallet.wallet_other'))}
        placement="bottom"
        arrow
        slotProps={tooltipSlotProps(theme)}
      >
        <IconButton
          {...titleBarIconButtonProps}
          size="small"
          onClick={rightNav.onOpenWalletsApp}
          sx={navIconSx}
          aria-label={t('core:wallet.wallet_other')}
        >
          <AccountBalanceWalletIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Tooltip>
      {rightNav.desktopViewMode !== 'home' && (
        <Tooltip
          title={tooltipTitle(t('auth:account.your'))}
          placement="bottom"
          arrow
          slotProps={tooltipSlotProps(theme)}
        >
          <IconButton
            {...titleBarIconButtonProps}
            size="small"
            onClick={rightNav.onOpenDrawerProfile}
            sx={navIconSx}
            aria-label={t('auth:account.your')}
          >
            <WalletIcon color={controlColor} width="22" />
          </IconButton>
        </Tooltip>
      )}
      <Box sx={{ width: 2 }} />
      <QMailStatus compact />
      {rightNav.extState === 'authenticated' && (
        <Box sx={navCellSx}>
          <GeneralNotifications
            address={rightNav.userInfo?.address}
            tooltipPlacement="bottom"
          />
        </Box>
      )}
      <Tooltip
        title={tooltipTitle(
          t('core:action.save', { postProcess: 'capitalizeFirstChar' })
        )}
        placement="bottom"
        arrow
        slotProps={tooltipSlotProps(theme)}
      >
        <Box sx={navCellSx} component="span">
          <Save
            isDesktop
            disableWidth={false}
            myName={rightNav.userInfo?.name}
          />
        </Box>
      </Tooltip>
      <ChatWidgetReopenIcon inTitleBar />
      {rightNav.extState === 'authenticated' && rightNav.isMainWindow && (
        <>
          <Tooltip
            title={tooltipTitle(t('core:message.generic.ongoing_transactions'))}
            placement="bottom"
            arrow
            slotProps={tooltipSlotProps(theme)}
          >
            <Box sx={navCellSx} component="span">
              <TaskManager getUserInfo={rightNav.getUserInfo} />
            </Box>
          </Tooltip>
          <Box sx={navCellSx}>
            <GlobalActions />
          </Box>
        </>
      )}
      <Box sx={{ width: 2 }} />
      <Tooltip
        title={tooltipTitle(t('core:minting.status_title'))}
        placement="bottom"
        arrow
        slotProps={tooltipSlotProps(theme)}
      >
        <IconButton
          {...titleBarIconButtonProps}
          size="small"
          onClick={rightNav.onOpenMinting}
          sx={navIconSx}
          aria-label={t('core:minting.status_title')}
        >
          <EngineeringIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Tooltip>
      {/* {(rightNav.desktopViewMode === 'apps' || rightNav.desktopViewMode === 'home') && (
        <Tooltip title={tooltipTitle(t('core:tutorial'))} placement="bottom" arrow slotProps={tooltipSlotProps(theme)}>
          <IconButton
            {...titleBarIconButtonProps}
            size="small"
            onClick={() => (rightNav.desktopViewMode === 'apps' ? rightNav.showTutorial('qapps', true) : rightNav.showTutorial('getting-started', true))}
            sx={navIconSx}
            aria-label={t('core:tutorial')}
          >
            <HelpIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Tooltip>
      )} */}
      <Tooltip
        title={tooltipTitle(t('core:action.backup_wallet'))}
        placement="bottom"
        arrow
        slotProps={tooltipSlotProps(theme)}
      >
        <IconButton
          {...titleBarIconButtonProps}
          size="small"
          onClick={rightNav.onBackupWallet}
          sx={navIconSx}
          aria-label={t('core:action.backup_wallet')}
        >
          <DownloadIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Tooltip>
      <Box
        sx={{
          width: '1px',
          minWidth: '1px',
          alignSelf: 'stretch',
          backgroundColor: borderColor,
          mx: 0.5,
          my: 0.75,
        }}
        aria-hidden
      />
      <Tooltip
        title={tooltipTitle(t('core:action.logout'))}
        placement="bottom"
        arrow
        slotProps={tooltipSlotProps(theme)}
      >
        <IconButton
          {...titleBarIconButtonProps}
          size="small"
          onClick={rightNav.onLogout}
          sx={navIconSx}
          aria-label={t('core:action.logout')}
        >
          <LogoutIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Tooltip>
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
        display: 'flex',
        flexDirection: 'row',
        height: TITLE_BAR_HEIGHT,
        minHeight: TITLE_BAR_HEIGHT,
        width: '100%',
        ...(isElectron && { WebkitAppRegion: 'drag' }),
      }}
    >
      {titleContent}
      {isElectron &&
        (isMac ? (
          <>
            {macWindowControls}
            {menuButton}
            <Box sx={{ flex: 1 }} />
            {rightNavSection}
            <Box sx={{ width: 52 }} />
          </>
        ) : (
          <>
            {menuButton}
            <Box sx={{ flex: 1 }} />
            {rightNavSection}
            <Box
              sx={{
                width: '1px',
                minWidth: '1px',
                alignSelf: 'stretch',
                backgroundColor: borderColor,
                mx: 0.5,
                my: 0.75,
              }}
              aria-hidden
            />
            {winWindowControls}
          </>
        ))}
      {!isElectron && (
        <>
          <Box sx={{ flex: 1 }} />
          {rightNavSection}
        </>
      )}
    </Box>
  );
}
