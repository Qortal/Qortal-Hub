import { memo } from 'react';
import { Box, ButtonBase, Tooltip, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Spacer } from '../../common/Spacer';
import {
  AuthenticatedContainer,
  AuthenticatedContainerInnerRight,
} from '../../styles/App-styles.ts';
import { ProfileLeft, ProfileLeftProps } from './ProfileLeft';
import LogoutIcon from '@mui/icons-material/Logout';
import SettingsIcon from '@mui/icons-material/Settings';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import EngineeringIcon from '@mui/icons-material/Engineering';
import HelpIcon from '@mui/icons-material/Help';
import DownloadIcon from '@mui/icons-material/Download';
import { WalletIcon } from '../../assets/Icons/WalletIcon';
import { QMailStatus } from '../QMailStatus';
import { GeneralNotifications } from '../GeneralNotifications';
import { Save } from '../Save/Save';
import { TaskManager } from '../TaskManager/TaskManager.tsx';
import { GlobalActions } from '../GlobalActions/GlobalActions';
import { ChatWidgetReopenIcon } from './ChatWidgetReopenIcon';

const tooltipSlotProps = (theme: any) => ({
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

export type AuthenticatedProfileProps = ProfileLeftProps & {
  desktopViewMode: string;
  extState: string;
  isMainWindow: boolean;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenDrawerLookup: () => void;
  onOpenWalletsApp: () => void;
  onOpenDrawerProfile: () => void;
  getUserInfo: (useTimer?: boolean) => Promise<void>;
  onOpenMinting: () => void;
  showTutorial: (key: string, force?: boolean) => void;
  onBackupWallet: () => void;
};

export const AuthenticatedProfile = ({
  userInfo,
  balance,
  rawWallet,
  qortBalanceLoading,
  setOpenSnack,
  setInfoSnack,
  onRefreshBalance,
  onOpenSendQort,
  onOpenRegisterName,
  onCloseDrawer,
  desktopViewMode,
  extState,
  isMainWindow,
  onLogout,
  onOpenSettings,
  onOpenDrawerLookup,
  onOpenWalletsApp,
  onOpenDrawerProfile,
  getUserInfo,
  onOpenMinting,
  showTutorial,
  onBackupWallet,
}: AuthenticatedProfileProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group']);

  const showLeftColumn =
    desktopViewMode !== 'apps' &&
    desktopViewMode !== 'dev' &&
    desktopViewMode !== 'chat';

  const handleLogout = () => {
    onLogout();
    onCloseDrawer?.();
  };

  return (
    <AuthenticatedContainer
      sx={{
        backgroundColor: theme.palette.background.paper,
        display: 'flex',
        justifyContent: 'flex-end',
        width: 'auto',
      }}
    >
      {showLeftColumn && (
        <ProfileLeft
          userInfo={userInfo}
          balance={balance}
          rawWallet={rawWallet}
          qortBalanceLoading={qortBalanceLoading}
          setOpenSnack={setOpenSnack}
          setInfoSnack={setInfoSnack}
          onRefreshBalance={onRefreshBalance}
          onOpenSendQort={onOpenSendQort}
          onOpenRegisterName={onOpenRegisterName}
          onCloseDrawer={onCloseDrawer}
        />
      )}

      <AuthenticatedContainerInnerRight
        sx={{
          borderLeft: `1px solid ${theme.palette.border.subtle}`,
          height: '100%',
          justifyContent: 'space-between',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
          }}
        >
          <Spacer height="20px" />

          <ButtonBase onClick={handleLogout}>
            <Tooltip
              title={
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {t('core:action.logout')}
                </span>
              }
              placement="left"
              arrow
              sx={{ fontSize: '24' }}
              slotProps={tooltipSlotProps(theme)}
            >
              <LogoutIcon
                sx={{
                  color: theme.palette.text.secondary,
                }}
              />
            </Tooltip>
          </ButtonBase>

          <Spacer height="20px" />

          <ButtonBase onClick={onOpenSettings}>
            <Tooltip
              title={
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {t('core:settings')}
                </span>
              }
              placement="left"
              arrow
              sx={{ fontSize: '24' }}
              slotProps={tooltipSlotProps(theme)}
            >
              <SettingsIcon
                sx={{
                  color: theme.palette.text.secondary,
                }}
              />
            </Tooltip>
          </ButtonBase>

          <Spacer height="20px" />

          <ButtonBase onClick={onOpenDrawerLookup}>
            <Tooltip
              title={
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                  }}
                >
                  {t('core:user_lookup', {
                    postProcess: 'capitalizeAll',
                  })}
                </span>
              }
              placement="left"
              arrow
              sx={{ fontSize: '24' }}
              slotProps={tooltipSlotProps(theme)}
            >
              <PersonSearchIcon
                sx={{
                  color: theme.palette.text.secondary,
                }}
              />
            </Tooltip>
          </ButtonBase>

          <Spacer height="20px" />

          <ButtonBase onClick={onOpenWalletsApp}>
            <Tooltip
              title={
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {t('core:wallet.wallet_other')}
                </span>
              }
              placement="left"
              arrow
              sx={{ fontSize: '24' }}
              slotProps={tooltipSlotProps(theme)}
            >
              <AccountBalanceWalletIcon
                sx={{
                  color: theme.palette.text.secondary,
                }}
              />
            </Tooltip>
          </ButtonBase>

          {desktopViewMode !== 'home' && (
            <>
              <Spacer height="20px" />

              <Tooltip
                title={
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('auth:account.your')}
                  </span>
                }
                placement="left"
                arrow
                sx={{ fontSize: '24' }}
                slotProps={tooltipSlotProps(theme)}
              >
                <ButtonBase onClick={onOpenDrawerProfile}>
                  <WalletIcon color={theme.palette.text.secondary} width="25" />
                </ButtonBase>
              </Tooltip>
            </>
          )}

          <Spacer height="20px" />

          <QMailStatus />

          <Spacer height="20px" />

          {extState === 'authenticated' && (
            <GeneralNotifications address={userInfo?.address} />
          )}

          <Spacer height="20px" />

          <Save isDesktop disableWidth={false} myName={userInfo?.name} />

          <ChatWidgetReopenIcon />
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
          }}
        >
          {extState === 'authenticated' && isMainWindow && (
            <>
              <TaskManager getUserInfo={getUserInfo} />
              <GlobalActions />
            </>
          )}

          <Spacer height="20px" />

          <ButtonBase onClick={onOpenMinting}>
            <Tooltip
              title={
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {t('core:minting.status_title')}
                </span>
              }
              placement="left"
              arrow
              sx={{ fontSize: '24' }}
              slotProps={tooltipSlotProps(theme)}
            >
              <EngineeringIcon
                sx={{
                  color: theme.palette.text.secondary,
                }}
              />
            </Tooltip>
          </ButtonBase>

          <Spacer height="20px" />

          {(desktopViewMode === 'apps' || desktopViewMode === 'home') && (
            <ButtonBase
              onClick={() => {
                if (desktopViewMode === 'apps') {
                  showTutorial('qapps', true);
                } else {
                  showTutorial('getting-started', true);
                }
              }}
            >
              <Tooltip
                title={
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('core:tutorial')}
                  </span>
                }
                placement="left"
                arrow
                sx={{ fontSize: '24' }}
                slotProps={tooltipSlotProps(theme)}
              >
                <HelpIcon
                  sx={{
                    color: theme.palette.text.secondary,
                  }}
                />
              </Tooltip>
            </ButtonBase>
          )}

          <Spacer height="20px" />

          <ButtonBase onClick={onBackupWallet}>
            <Tooltip
              title={
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {t('core:action.backup_wallet')}
                </span>
              }
              placement="left"
              arrow
              sx={{ fontSize: '24' }}
              slotProps={tooltipSlotProps(theme)}
            >
              <DownloadIcon
                sx={{
                  color: theme.palette.text.secondary,
                }}
              />
            </Tooltip>
          </ButtonBase>
          <Spacer height="40px" />
        </Box>
      </AuthenticatedContainerInnerRight>
    </AuthenticatedContainer>
  );
};
