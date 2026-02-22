import { memo } from 'react';
import { useTheme } from '@mui/material';
import {
  AuthenticatedContainer,
} from '../../styles/App-styles.ts';
import { ProfileLeft, ProfileLeftProps } from './ProfileLeft';

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

  const showLeftColumn =
    desktopViewMode !== 'apps' &&
    desktopViewMode !== 'dev' &&
    desktopViewMode !== 'chat' &&
    desktopViewMode !== 'home';

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
    </AuthenticatedContainer>
  );
};
