import { Box } from '@mui/material';
import { Group } from '../Group/Group';
import { AuthenticatedProfile } from '../Profile';

/**
 * Authenticated main layout: Group (left) + AuthenticatedProfile (right).
 * Lazy-loaded so the Group bundle is not loaded until the user is authenticated.
 */
export type AuthenticatedShellProps = {
  // Group
  desktopViewMode: string;
  isMain: boolean;
  isOpenDrawerProfile: boolean;
  logoutFunc: () => Promise<void>;
  myAddress: string;
  setDesktopViewMode: (mode: string) => void;
  setIsOpenDrawerProfile: (open: boolean) => void;
  // AuthenticatedProfile
  balance: number;
  userInfo: any;
  rawWallet: any;
  qortBalanceLoading: boolean;
  setOpenSnack: (open: boolean) => void;
  setInfoSnack: (info: any) => void;
  onRefreshBalance: () => void;
  onOpenSendQort: () => void;
  onOpenRegisterName: () => void;
  extState: string;
  isMainWindow: boolean;
  onOpenSettings: () => void;
  onOpenDrawerLookup: () => void;
  onOpenWalletsApp: () => void;
  onOpenDrawerProfile: () => void;
  getUserInfo: (useTimer?: boolean) => Promise<void>;
  onOpenMinting: () => void;
  showTutorial: (key: string, force?: boolean) => void;
  onBackupWallet: () => void;
};

export function AuthenticatedShell({
  balance,
  desktopViewMode,
  isMain,
  isOpenDrawerProfile,
  logoutFunc,
  myAddress,
  setDesktopViewMode,
  setIsOpenDrawerProfile,
  userInfo,
  rawWallet,
  qortBalanceLoading,
  setOpenSnack,
  setInfoSnack,
  onRefreshBalance,
  onOpenSendQort,
  onOpenRegisterName,
  extState,
  isMainWindow,
  onOpenSettings,
  onOpenDrawerLookup,
  onOpenWalletsApp,
  onOpenDrawerProfile,
  getUserInfo,
  onOpenMinting,
  showTutorial,
  onBackupWallet,
}: AuthenticatedShellProps) {
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        isolation: 'isolate',
        position: 'relative',
        width: '100%',
        '&::before': {
          background:
            theme.palette.mode === 'dark'
              ? 'linear-gradient(to bottom, rgba(255, 255, 255, 0.03), rgba(9, 11, 15, 0.02))'
              : 'linear-gradient(to bottom, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.08))',
          content: '""',
          inset: 0,
          pointerEvents: 'none',
          position: 'absolute',
          zIndex: 0,
        },
        '& > *': {
          position: 'relative',
          zIndex: 1,
        },
      })}
    >
      <Group
        desktopViewMode={desktopViewMode}
        isMain={isMain}
        isOpenDrawerProfile={isOpenDrawerProfile}
        logoutFunc={logoutFunc}
        myAddress={myAddress}
        setDesktopViewMode={setDesktopViewMode}
        setIsOpenDrawerProfile={setIsOpenDrawerProfile}
      />
      <AuthenticatedProfile
        userInfo={userInfo}
        balance={balance}
        rawWallet={rawWallet}
        qortBalanceLoading={qortBalanceLoading}
        setOpenSnack={setOpenSnack}
        setInfoSnack={setInfoSnack}
        onRefreshBalance={onRefreshBalance}
        onOpenSendQort={onOpenSendQort}
        onOpenRegisterName={onOpenRegisterName}
        desktopViewMode={desktopViewMode}
        extState={extState}
        isMainWindow={isMainWindow}
        onLogout={logoutFunc}
        onOpenSettings={onOpenSettings}
        onOpenDrawerLookup={onOpenDrawerLookup}
        onOpenWalletsApp={onOpenWalletsApp}
        onOpenDrawerProfile={onOpenDrawerProfile}
        getUserInfo={getUserInfo}
        onOpenMinting={onOpenMinting}
        showTutorial={showTutorial}
        onBackupWallet={onBackupWallet}
      />
    </Box>
  );
}
