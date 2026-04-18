import { Box } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  DASHBOARD_LOGIN_INTRO_PREVIEW_EVENT,
  DASHBOARD_LOGIN_INTRO_PREVIEW_STORAGE_KEY,
  parseDashboardLoginIntroMode,
  type DashboardLoginIntroMode,
} from './dashboardIntroPreview';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
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
  logoutFunc: () => Promise<void>;
  myAddress: string;
  setDesktopViewMode: (mode: string) => void;
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
  getUserInfo: (useTimer?: boolean) => Promise<void>;
  onOpenMinting: () => void;
  showTutorial: (key: string, force?: boolean) => void;
  onBackupWallet: () => void;
};

type DashboardIntroPlaybackPhase = 'idle' | 'primed' | 'playing';

export function AuthenticatedShell({
  balance,
  desktopViewMode,
  isMain,
  logoutFunc,
  myAddress,
  setDesktopViewMode,
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
  getUserInfo,
  onOpenMinting,
  showTutorial,
  onBackupWallet,
}: AuthenticatedShellProps) {
  const reduce = useReducedMotion();
  const isLocalPreview =
    typeof window !== 'undefined' &&
    (window.location.hostname === '127.0.0.1' ||
      window.location.hostname === 'localhost');
  const shouldAnimateDashboardIntro = !reduce || isLocalPreview;
  const introPlaybackFrameRefs = useRef<number[]>([]);
  const shellIntroEase = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const [dashboardIntroMode, setDashboardIntroMode] =
    useState<DashboardLoginIntroMode>(() =>
      isLocalPreview
        ? parseDashboardLoginIntroMode(
            localStorage.getItem(DASHBOARD_LOGIN_INTRO_PREVIEW_STORAGE_KEY)
          )
        : 'off'
    );
  const [dashboardIntroReplayToken, setDashboardIntroReplayToken] = useState(0);
  const [dashboardIntroPlaybackPhase, setDashboardIntroPlaybackPhase] =
    useState<DashboardIntroPlaybackPhase>('idle');

  const clearIntroPlaybackFrames = useCallback(() => {
    introPlaybackFrameRefs.current.forEach((frameId) => {
      window.cancelAnimationFrame(frameId);
    });
    introPlaybackFrameRefs.current = [];
  }, []);

  const playDashboardIntro = useCallback(
    (mode: DashboardLoginIntroMode) => {
      clearIntroPlaybackFrames();

      if (!shouldAnimateDashboardIntro || mode === 'off') {
        setDashboardIntroPlaybackPhase('idle');
        return;
      }

      setDashboardIntroPlaybackPhase('primed');

      const outerFrameId = window.requestAnimationFrame(() => {
        const innerFrameId = window.requestAnimationFrame(() => {
          setDashboardIntroPlaybackPhase('playing');
        });

        introPlaybackFrameRefs.current = [innerFrameId];
      });

      introPlaybackFrameRefs.current = [outerFrameId];
    },
    [clearIntroPlaybackFrames, shouldAnimateDashboardIntro]
  );

  useEffect(() => {
    playDashboardIntro(dashboardIntroMode);
  }, [dashboardIntroMode, dashboardIntroReplayToken, playDashboardIntro]);

  useEffect(
    () => () => {
      clearIntroPlaybackFrames();
    },
    [clearIntroPlaybackFrames]
  );

  useEffect(() => {
    const handleDashboardIntroPreview = (event: Event) => {
      const customEvent = event as CustomEvent<{
        data?: { mode?: string; replay?: boolean };
      }>;
      const nextMode = parseDashboardLoginIntroMode(
        customEvent.detail?.data?.mode
      );
      const shouldReplay = customEvent.detail?.data?.replay === true;

      setDashboardIntroMode(nextMode);

      if (shouldReplay) {
        setDashboardIntroReplayToken((currentToken) => currentToken + 1);
      }
    };

    subscribeToEvent(
      DASHBOARD_LOGIN_INTRO_PREVIEW_EVENT,
      handleDashboardIntroPreview
    );

    return () => {
      unsubscribeFromEvent(
        DASHBOARD_LOGIN_INTRO_PREVIEW_EVENT,
        handleDashboardIntroPreview
      );
    };
  }, []);

  const dashboardIntroVisuals = useMemo(() => {
    const shellFinal = {
      opacity: 1,
      transform: 'translate3d(0, 0, 0) scale(1)',
    };
    const veilFinal = { opacity: 0 };

    if (!shouldAnimateDashboardIntro || dashboardIntroMode === 'off') {
      return {
        shell: {
          ...shellFinal,
          transition: 'none',
        },
        veil: {
          ...veilFinal,
          transition: 'none',
        },
      };
    }

    const introConfig =
      dashboardIntroMode === 'fade'
        ? {
            shellInitial: {
              opacity: 0,
              transform: 'translate3d(0, 0, 0) scale(1)',
            },
            shellTransition: `opacity 260ms ${shellIntroEase}`,
            veilInitial: veilFinal,
            veilTransition: 'none',
          }
        : dashboardIntroMode === 'rise'
          ? {
              shellInitial: {
                opacity: 0,
                transform: 'translate3d(0, 12px, 0) scale(1)',
              },
              shellTransition: `opacity 320ms ${shellIntroEase}, transform 320ms ${shellIntroEase}`,
              veilInitial: veilFinal,
              veilTransition: 'none',
            }
          : {
              shellInitial: {
                opacity: 0,
                transform: 'translate3d(0, 6px, 0) scale(0.988)',
              },
              shellTransition: `opacity 340ms ${shellIntroEase}, transform 340ms ${shellIntroEase}`,
              veilInitial: {
                opacity: 0.12,
              },
              veilTransition: `opacity 400ms ${shellIntroEase}`,
            };

    const isPrimed = dashboardIntroPlaybackPhase === 'primed';

    return {
      shell: {
        ...(isPrimed ? introConfig.shellInitial : shellFinal),
        transition: isPrimed ? 'none' : introConfig.shellTransition,
      },
      veil: {
        ...(isPrimed ? introConfig.veilInitial : veilFinal),
        transition: isPrimed ? 'none' : introConfig.veilTransition,
      },
    };
  }, [
    dashboardIntroMode,
    dashboardIntroPlaybackPhase,
    shellIntroEase,
    shouldAnimateDashboardIntro,
  ]);

  return (
    <Box
      sx={(theme) => ({
        ...dashboardIntroVisuals.shell,
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        isolation: 'isolate',
        position: 'relative',
        width: '100%',
        willChange: 'opacity, transform',
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
      <Box
        aria-hidden="true"
        sx={(theme) => ({
          ...dashboardIntroVisuals.veil,
          background:
            theme.palette.mode === 'dark'
              ? 'linear-gradient(180deg, rgba(8,10,14,0.88) 0%, rgba(8,10,14,0.42) 100%)'
              : 'linear-gradient(180deg, rgba(244,247,252,0.74) 0%, rgba(244,247,252,0.24) 100%)',
          inset: 0,
          pointerEvents: 'none',
          position: 'absolute',
          zIndex: 2,
        })}
      />
      <Group
        desktopViewMode={desktopViewMode}
        isMain={isMain}
        logoutFunc={logoutFunc}
        myAddress={myAddress}
        onOpenSettings={onOpenSettings}
        setDesktopViewMode={setDesktopViewMode}
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
        getUserInfo={getUserInfo}
        onOpenMinting={onOpenMinting}
        showTutorial={showTutorial}
        onBackupWallet={onBackupWallet}
      />
    </Box>
  );
}
