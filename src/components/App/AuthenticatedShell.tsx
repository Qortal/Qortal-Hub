import { Box } from '@mui/material';
import { Group } from '../Group/Group';
import { AuthenticatedProfile } from '../Profile';

/**
 * Authenticated main layout: Group (left) + AuthenticatedProfile (right).
 * Lazy-loaded so the Group bundle is not loaded until the user is authenticated.
 */
export type AuthenticatedShellProps = {
  // Group props
  balance: number;
  desktopViewMode: string;
  isMain: boolean;
  isOpenDrawerProfile: boolean;
  logoutFunc: () => Promise<void>;
  myAddress: string;
  setDesktopViewMode: (mode: string) => void;
  setIsOpenDrawerProfile: (open: boolean) => void;
  userInfo: any;
  // AuthenticatedProfile props
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
      sx={{
        display: 'flex',
        flexDirection: 'row',
        height: '100vh',
        width: '100vw',
      }}
    >
      <Group
        balance={balance}
        desktopViewMode={desktopViewMode}
        isMain={isMain}
        isOpenDrawerProfile={isOpenDrawerProfile}
        logoutFunc={logoutFunc}
        myAddress={myAddress}
        setDesktopViewMode={setDesktopViewMode}
        setIsOpenDrawerProfile={setIsOpenDrawerProfile}
        userInfo={userInfo}
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
