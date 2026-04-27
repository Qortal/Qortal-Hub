import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CoreSetupDialog } from './CoreSetupDialog';
import {
  getDefaultLocalNodeUrl,
  HTTPS_EXT_NODE_QORTAL_LINK,
  HTTP_LOCALHOST_12391,
  LOCALHOST_12391,
} from '../constants/constants';
import { cleanUrl } from '../background/background';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';
import {
  extStateAtom,
  isOpenCoreSetup,
  isPublicNodeUnavailableAtom,
  selectedNodeInfoAtom,
  statusesAtom,
} from '../atoms/global';
import { useAtom } from 'jotai';
import { CoreSetupResetApikeyDialog } from './CoreSetupResetApikeyDialog';
import { CustomNodeApikeyDialog } from './CustomNodeApikeyDialog';
import { CoreSyncing } from './CoreSyncing';
import { CoreUrlInvalid } from './CoreUrlInvalid';
import { CoreSettingUp } from './CoreSettingUp';
import { useAuth } from '../hooks/useAuth';

export const CoreSetup = () => {
  const theme = useTheme();
  const [open, setOpen] = useAtom(isOpenCoreSetup);
  const [isReady, setIsReady] = useState(false);
  const [statuses, setStatuses] = useAtom(statusesAtom);
  const [selectedNode] = useAtom(selectedNodeInfoAtom);
  const [extState] = useAtom(extStateAtom);
  const [publicNodeUnavailable, setPublicNodeUnavailable] = useAtom(
    isPublicNodeUnavailableAtom
  );
  const isLocal = cleanUrl(selectedNode?.url) === LOCALHOST_12391;
  const { authenticate, getBalanceFunc, handleSaveNodeInfo } = useAuth();
  const [customQortalPath, setCustomQortalPath] = useState('');
  const [showLocalReadyNotice, setShowLocalReadyNotice] = useState(false);
  const [localNodeRuntimeStatus, setLocalNodeRuntimeStatus] = useState<{
    running: boolean;
    syncPercent?: number;
  } | null>(null);
  const [startCoreSetupAtIntro, setStartCoreSetupAtIntro] = useState(false);
  const [localReadySwitchError, setLocalReadySwitchError] = useState('');
  const [setupContextActionLoading, setSetupContextActionLoading] =
    useState(false);
  const inFlight = useRef(false);
  const autoStartAttemptedRef = useRef(false);
  const localReadyDismissedRef = useRef(false);
  const switchingToLocalRef = useRef(false);
  const usingDefaultPublicNode =
    cleanUrl(selectedNode?.url || '') === cleanUrl(HTTPS_EXT_NODE_QORTAL_LINK);
  const dismissLocalReadyNotice = useCallback(() => {
    localReadyDismissedRef.current = true;
    setShowLocalReadyNotice(false);
    setLocalNodeRuntimeStatus(null);
  }, []);
  useEffect(() => {
    if (!window?.coreSetup) return;
    const off = window.coreSetup.onProgress((p) => {
      if (p === 'ready') {
        setIsReady(true);
        return;
      }
      if (p?.type === 'hasCustomPath') {
        setCustomQortalPath(p.hasCustomPath ? p.customPath : '');
        return;
      }

      if (p?.type === 'osType') {
        return;
      }
      setStatuses((prev) => {
        return {
          ...prev,
          [p.step]: p,
        };
      });
    });

    return () => off();
  }, [setStatuses]);

  async function handleCoreSetup({ isReady }: { isReady: boolean }) {
    if (!window?.coreSetup || inFlight.current || !isReady) return;

    inFlight.current = true;

    try {
      const runningRes = await window.coreSetup.isCoreRunning();
      const running = Boolean(runningRes);
      if (running) {
        return;
      }

      await window.coreSetup.isCoreInstalled();
    } catch (e) {
      console.error('Core setup error:', e);
    } finally {
      inFlight.current = false;
    }
  }

  useEffect(() => {
    if (!window?.coreSetup) return;
    if (!isReady) return;
    if (extState !== 'authenticated' && !open) return;

    handleCoreSetup({ isReady });
  }, [extState, isReady, open]);

  useEffect(() => {
    if (extState !== 'authenticated' || !usingDefaultPublicNode) {
      autoStartAttemptedRef.current = false;
    }
  }, [extState, usingDefaultPublicNode]);

  useEffect(() => {
    if (!window?.coreSetup || !isReady) return;
    if (extState !== 'authenticated' || !usingDefaultPublicNode) return;
    if (autoStartAttemptedRef.current) return;

    let canceled = false;

    const startInstalledCore = async () => {
      autoStartAttemptedRef.current = true;

      try {
        const running = await window.coreSetup.isCoreRunning();
        if (canceled || running) return;

        const installed = await window.coreSetup.isCoreInstalled();
        if (canceled) return;

        if (installed) {
          window.coreSetup.startCore();
        } else {
          setStartCoreSetupAtIntro(true);
          setOpen(true);
        }
      } catch (error) {
        console.error('Failed to auto-start local Core:', error);
      }
    };

    startInstalledCore();

    return () => {
      canceled = true;
    };
  }, [extState, isReady, setOpen, usingDefaultPublicNode]);

  const isCoreInstalledState = statuses['downloadedCore']?.status === 'done';
  const isCoreRunningState = statuses['coreRunning']?.status === 'done';
  const actionLoading = Object.keys(statuses).find(
    (key) => statuses[key]?.status === 'active'
  );
  const verifyCoreNotRunningFunc = useCallback(() => {
    setStatuses({
      coreRunning: {
        status: 'idle',
        progress: 0,
        message: '',
      },
      downloadedCore: {
        status: 'idle',
        progress: 0,
        message: '',
      },
      hasJava: {
        status: 'idle',
        progress: 0,
        message: '',
      },
    });
    handleCoreSetup({ isReady });
  }, [isReady, setStatuses]);

  useEffect(() => {
    if (!window?.coreSetup) return;
    subscribeToEvent('verifyCoreNotRunning', verifyCoreNotRunningFunc);

    return () => {
      unsubscribeFromEvent('verifyCoreNotRunning', verifyCoreNotRunningFunc);
    };
  }, [verifyCoreNotRunningFunc]);

  useEffect(() => {
    if (!window?.coreSetup || isLocal || extState !== 'authenticated') {
      setShowLocalReadyNotice(false);
      setLocalNodeRuntimeStatus(null);
      return;
    }

    localReadyDismissedRef.current = false;
    setShowLocalReadyNotice(false);
    setLocalNodeRuntimeStatus(null);

    let canceled = false;

    const checkLocalNodeReady = async () => {
      if (localReadyDismissedRef.current) return;

      let running = false;
      try {
        running = Boolean(await window.coreSetup.isCoreRunning());
        if (!running) {
          if (!canceled) {
            setLocalNodeRuntimeStatus({ running: false });
          }
          return;
        }

        const statusResponse = await fetch(
          `${HTTP_LOCALHOST_12391}/admin/status`
        );
        if (!statusResponse.ok) {
          if (!canceled) {
            setLocalNodeRuntimeStatus({ running: true });
          }
          return;
        }

        const status = await statusResponse.json();
        const syncPercent = Number(status?.syncPercent);
        if (!canceled) {
          setLocalNodeRuntimeStatus({
            running: true,
            syncPercent: Number.isFinite(syncPercent) ? syncPercent : undefined,
          });
        }
        if (
          !canceled &&
          isLocalCoreStatusSynced(
            Number.isFinite(syncPercent) ? syncPercent : undefined
          )
        ) {
          setShowLocalReadyNotice(true);
        }
      } catch (error) {
        // Local Core can be starting, blocked, or still syncing; silence noisy polling.
        if (!canceled && running) {
          setLocalNodeRuntimeStatus((prev) =>
            prev?.running ? prev : { running: true }
          );
        }
      }
    };

    checkLocalNodeReady();
    const interval = window.setInterval(checkLocalNodeReady, 5000);

    return () => {
      canceled = true;
      window.clearInterval(interval);
    };
  }, [extState, isLocal, selectedNode?.url]);

  useEffect(() => {
    if (!window?.coreSetup || !open) return;

    let canceled = false;

    const checkLocalNodeStatusForSetup = async () => {
      try {
        const running = Boolean(await window.coreSetup.isCoreRunning());
        if (canceled) return;

        if (!running) {
          setLocalNodeRuntimeStatus({ running: false });
          return;
        }

        try {
          const statusResponse = await fetch(
            `${HTTP_LOCALHOST_12391}/admin/status`
          );
          if (canceled) return;

          if (!statusResponse.ok) {
            setLocalNodeRuntimeStatus({ running: true });
            return;
          }

          const status = await statusResponse.json();
          const syncPercent = Number(status?.syncPercent);
          setLocalNodeRuntimeStatus({
            running: true,
            syncPercent: Number.isFinite(syncPercent) ? syncPercent : undefined,
          });
        } catch (error) {
          if (!canceled) {
            setLocalNodeRuntimeStatus({ running: true });
          }
        }
      } catch (error) {
        if (!canceled) {
          setLocalNodeRuntimeStatus({ running: false });
        }
      }
    };

    checkLocalNodeStatusForSetup();
    const interval = window.setInterval(checkLocalNodeStatusForSetup, 5000);

    return () => {
      canceled = true;
      window.clearInterval(interval);
    };
  }, [open]);

  const switchToLocalNode = useCallback(async (options?: {
    authenticateAfterSwitch?: boolean;
  }) => {
    if (switchingToLocalRef.current) return;
    switchingToLocalRef.current = true;

    try {
      setLocalReadySwitchError('');
      const apiKey = window?.coreSetup?.getApiKey
        ? await window.coreSetup.getApiKey()
        : '';
      const localNodeUrl = getDefaultLocalNodeUrl();

      if (localNodeUrl.startsWith('https://')) {
        const certResult = await window.electronAPI?.ensureCertForBase?.(
          localNodeUrl,
          apiKey || ''
        );

        if (!certResult?.success) {
          throw new Error(
            certResult?.error || 'Unable to prepare local HTTPS certificate'
          );
        }
      }

      await handleSaveNodeInfo({
        url: localNodeUrl,
        apikey: apiKey || '',
      });

      if (options?.authenticateAfterSwitch) {
        await authenticate(true);
      } else if (extState === 'authenticated') {
        await getBalanceFunc();
      }

      dismissLocalReadyNotice();
    } catch (error) {
      console.error('Failed to switch to local node:', error);
      setLocalReadySwitchError(
        'Switch failed. You can log out and unlock again to use the local node.'
      );
    } finally {
      switchingToLocalRef.current = false;
    }
  }, [
    authenticate,
    dismissLocalReadyNotice,
    extState,
    getBalanceFunc,
    handleSaveNodeInfo,
  ]);

  const isPublicNodeReachable = useCallback(async () => {
    try {
      const response = await fetch(
        `${HTTPS_EXT_NODE_QORTAL_LINK}/admin/status`
      );
      return response.ok;
    } catch (error) {
      return false;
    }
  }, []);

  const usePublicNodeWhileSyncing = useCallback(async () => {
    setSetupContextActionLoading(true);
    try {
      if (!(await isPublicNodeReachable())) {
        setPublicNodeUnavailable(true);
        return;
      }

      setPublicNodeUnavailable(false);
      await handleSaveNodeInfo({
        url: HTTPS_EXT_NODE_QORTAL_LINK,
        apikey: '',
      });
      setOpen(false);
      setStartCoreSetupAtIntro(false);

      if (extState === 'wallet-dropped') {
        await authenticate(true);
      } else if (extState === 'authenticated') {
        await getBalanceFunc();
      }
    } catch (error) {
      console.error('Failed to use public node while Core syncs:', error);
    } finally {
      setSetupContextActionLoading(false);
    }
  }, [
    authenticate,
    extState,
    getBalanceFunc,
    handleSaveNodeInfo,
    isPublicNodeReachable,
    setOpen,
    setPublicNodeUnavailable,
  ]);

  const useLocalNodeFromSetup = useCallback(async () => {
    setSetupContextActionLoading(true);
    try {
      await switchToLocalNode({
        authenticateAfterSwitch: extState === 'wallet-dropped',
      });
      setOpen(false);
      setStartCoreSetupAtIntro(false);
    } finally {
      setSetupContextActionLoading(false);
    }
  }, [extState, setOpen, switchToLocalNode]);

  const localCoreSynced = isLocalCoreStatusSynced(
    localNodeRuntimeStatus?.syncPercent
  );
  const localCoreRunning = Boolean(
    isCoreRunningState || localNodeRuntimeStatus?.running
  );
  const isCoreSyncingForDialog = localCoreRunning && !localCoreSynced;
  const shouldOfferPublicLobby =
    isLocal &&
    isCoreSyncingForDialog &&
    !publicNodeUnavailable &&
    extState !== 'authenticated';
  const shouldOfferLocalFallback =
    !isLocal && publicNodeUnavailable && localCoreRunning;
  const contextualActionLabel = shouldOfferPublicLobby
    ? 'Use Public'
    : shouldOfferLocalFallback
      ? localCoreSynced
        ? 'Use Local'
        : 'Local not ready'
      : undefined;
  const contextualActionDisabled =
    shouldOfferLocalFallback && !localCoreSynced;
  const contextualAction = shouldOfferPublicLobby
    ? usePublicNodeWhileSyncing
    : shouldOfferLocalFallback
      ? useLocalNodeFromSetup
      : undefined;

  const coreStatusNotice = useMemo(() => {
    const downloadedState = statuses.downloadedCore;
    const runningState = statuses.coreRunning;
    const hasCoreSetupActivity =
      downloadedState?.status === 'active' ||
      runningState?.status === 'active' ||
      downloadedState?.status === 'error' ||
      runningState?.status === 'error';
    if (
      !window?.coreSetup ||
      extState !== 'authenticated' ||
      isLocal ||
      (!usingDefaultPublicNode && !hasCoreSetupActivity)
    ) {
      return null;
    }

    const translatedMessage =
      runningState?.message || downloadedState?.message || '';

    if (localReadyDismissedRef.current) {
      return null;
    }

    if (showLocalReadyNotice) {
      return {
        description:
          'Qortal Core is synced. You can switch from the public node to your local node now.',
        progress: 100,
        ready: true,
        title: 'Local node ready',
      };
    }

    const syncPercent = localNodeRuntimeStatus?.syncPercent;
    if (
      localNodeRuntimeStatus?.running &&
      isLocalCoreStatusSynced(syncPercent)
    ) {
      return {
        description:
          'Qortal Core is synced. You can switch from the public node to your local node now.',
        progress: 100,
        ready: true,
        title: 'Local node ready',
      };
    }

    if (downloadedState?.status === 'active') {
      return {
        description: 'Downloading and installing Qortal Core.',
        progress: downloadedState.progress,
        ready: false,
        title: 'Installing Qortal Core',
      };
    }

    if (runningState?.status === 'active') {
      return {
        description:
          translatedMessage === '001'
            ? 'Core is starting and preparing blockchain data.'
            : 'Starting Qortal Core.',
        progress: runningState.progress,
        ready: false,
        title: 'Starting local Core',
      };
    }

    if (
      localNodeRuntimeStatus?.running &&
      typeof syncPercent === 'number' &&
      !isLocalCoreStatusSynced(syncPercent)
    ) {
      return {
        description: 'Your local node is catching up in the background.',
        progress: Math.max(0, Math.min(100, syncPercent)),
        ready: false,
        title: 'Syncing blockchain',
      };
    }

    if (runningState?.status === 'done' || localNodeRuntimeStatus?.running) {
      return {
        description:
          typeof syncPercent === 'number'
            ? 'Your local node is catching up in the background.'
            : 'Core is running. Checking blockchain sync progress.',
        progress:
          typeof syncPercent === 'number'
            ? Math.max(0, Math.min(100, syncPercent))
            : undefined,
        ready: false,
        title: 'Syncing blockchain',
      };
    }

    if (
      runningState?.status === 'error' ||
      downloadedState?.status === 'error'
    ) {
      return {
        description: 'Core needs attention. Open setup to review the issue.',
        progress: undefined,
        ready: false,
        title: 'Core setup needs attention',
      };
    }

    return null;
  }, [
    extState,
    isLocal,
    localNodeRuntimeStatus?.running,
    localNodeRuntimeStatus?.syncPercent,
    showLocalReadyNotice,
    statuses.coreRunning,
    statuses.downloadedCore,
    usingDefaultPublicNode,
  ]);

  return (
    <>
      <CoreSetupDialog
        open={open}
        startAtIntro={startCoreSetupAtIntro}
        actionLoading={!!actionLoading}
        onClose={() => {
          setOpen(false);
          setStartCoreSetupAtIntro(false);
        }}
        onAction={() => {
          if (!window?.coreSetup) return;
          if (isCoreRunningState) {
            setOpen(false);
            setStartCoreSetupAtIntro(false);
          } else if (isCoreInstalledState) {
            window.coreSetup.startCore();
          } else {
            window.coreSetup.installCore();
          }
        }}
        steps={statuses}
        isCoreSyncing={isCoreSyncingForDialog}
        coreSyncPercent={localNodeRuntimeStatus?.syncPercent}
        customQortalPath={customQortalPath}
        verifyCoreNotRunningFunc={verifyCoreNotRunningFunc}
        publicNodeUnavailable={publicNodeUnavailable}
        contextualActionLabel={contextualActionLabel}
        contextualActionDisabled={contextualActionDisabled}
        contextualActionLoading={setupContextActionLoading}
        onContextualAction={contextualAction}
      />
      {coreStatusNotice && (
        <Box
          sx={{
            background:
              'linear-gradient(180deg, rgba(29,35,47,0.98), rgba(18,23,32,0.98))',
            border: '1px solid rgba(150, 184, 230, 0.18)',
            borderRadius: '10px',
            bottom: 20,
            boxShadow: '0 18px 44px rgba(0,0,0,0.42)',
            maxWidth: 340,
            p: 1.6,
            position: 'fixed',
            right: 20,
            width: 'calc(100vw - 40px)',
            zIndex: 12000,
          }}
        >
          <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1.2 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.92rem', fontWeight: 700 }}>
                {coreStatusNotice.title}
              </Typography>
              <Typography
                sx={{
                  color: 'rgba(214,221,233,0.62)',
                  fontSize: '0.8rem',
                  lineHeight: 1.55,
                  mt: 0.45,
                }}
              >
                {coreStatusNotice.description}
              </Typography>
              {typeof coreStatusNotice.progress === 'number' && (
                <Box
                  sx={{
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    borderRadius: '999px',
                    height: 6,
                    mt: 1,
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      backgroundColor: coreStatusNotice.ready
                        ? theme.palette.other.positive
                        : 'rgba(118,165,255,0.82)',
                      height: '100%',
                      transition: 'width 220ms ease',
                      width: `${coreStatusNotice.progress}%`,
                    }}
                  />
                </Box>
              )}
              {localReadySwitchError && (
                <Typography
                  sx={{
                    color: '#D8BA8A',
                    fontSize: '0.76rem',
                    lineHeight: 1.45,
                    mt: 0.7,
                  }}
                >
                  {localReadySwitchError}
                </Typography>
              )}
            </Box>
            {coreStatusNotice.ready && (
              <ButtonBase
                onClick={() => {
                  dismissLocalReadyNotice();
                }}
                sx={{
                  color: theme.palette.text.secondary,
                  p: 0.25,
                  '&:hover': { color: theme.palette.text.primary },
                }}
              >
                <CloseRoundedIcon sx={{ fontSize: 18 }} />
              </ButtonBase>
            )}
          </Box>
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              justifyContent: 'flex-end',
              mt: 1.25,
            }}
          >
            {coreStatusNotice.ready ? (
              <>
                <ButtonBase
                  onClick={() => {
                    dismissLocalReadyNotice();
                  }}
                  sx={noticeActionSx(false)}
                >
                  Later
                </ButtonBase>
                <ButtonBase
                  onClick={switchToLocalNode}
                  sx={noticeActionSx(true)}
                >
                  Switch to local
                </ButtonBase>
              </>
            ) : (
              <ButtonBase
                onClick={() => {
                  setStartCoreSetupAtIntro(false);
                  setOpen(true);
                }}
                sx={noticeActionSx(true)}
              >
                Open setup
              </ButtonBase>
            )}
          </Box>
        </Box>
      )}
      <CoreSetupResetApikeyDialog />
      <CustomNodeApikeyDialog />
      <CoreSyncing />
      <CoreSettingUp />
      <CoreUrlInvalid />
    </>
  );
};

const LOCAL_CORE_READY_SYNC_PERCENT = 99.95;

function isLocalCoreStatusSynced(
  syncPercent?: number
) {
  return (
    typeof syncPercent === 'number' &&
    syncPercent >= LOCAL_CORE_READY_SYNC_PERCENT
  );
}

const noticeActionSx = (primary: boolean) => ({
  backgroundColor: primary
    ? 'rgba(91, 132, 201, 0.62)'
    : 'rgba(255,255,255,0.035)',
  border: `1px solid ${primary ? 'rgba(174, 204, 255, 0.28)' : 'rgba(255,255,255,0.07)'}`,
  borderRadius: '7px',
  color: primary ? '#F4F8FF' : 'rgba(214,221,233,0.72)',
  fontFamily: 'inherit',
  fontSize: '0.78rem',
  fontWeight: 600,
  letterSpacing: 0,
  minHeight: 32,
  px: 1.25,
  textTransform: 'none',
  transition: 'background-color 160ms ease, border-color 160ms ease',
  '&:hover': {
    backgroundColor: primary
      ? 'rgba(105, 150, 224, 0.72)'
      : 'rgba(255,255,255,0.055)',
    borderColor: primary
      ? 'rgba(190, 216, 255, 0.38)'
      : 'rgba(255,255,255,0.11)',
  },
});
