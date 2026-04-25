import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CoreSetupDialog } from './CoreSetupDialog';
import {
  getDefaultLocalNodeUrl,
  HTTPS_EXT_NODE_QORTAL_LINK,
  LOCALHOST_12391,
} from '../constants/constants';
import { cleanUrl } from '../background/background';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';
import {
  extStateAtom,
  isOpenCoreSetup,
  isOpenDialogCoreRecommendationAtom,
  selectedNodeInfoAtom,
  statusesAtom,
} from '../atoms/global';
import { useAtom } from 'jotai';
import { CoreSetupRecommendationDialog } from './CoreSetupRecommendationDialog';
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
  const [osType, setOsType] = useState(null);
  const [isOpenRecommendation, setIsOpenRecommendation] = useAtom(
    isOpenDialogCoreRecommendationAtom
  );
  const isLocal = cleanUrl(selectedNode?.url) === LOCALHOST_12391;
  const { getBalanceFunc, handleSaveNodeInfo } = useAuth();
  const [customQortalPath, setCustomQortalPath] = useState('');
  const [showLocalReadyNotice, setShowLocalReadyNotice] = useState(false);
  const [localReadySwitchError, setLocalReadySwitchError] = useState('');
  const inFlight = useRef(false);
  const localReadyDismissedRef = useRef(false);
  const switchingToLocalRef = useRef(false);
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
        setOsType(p.osType);
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

  async function handleCoreSetup({
    isReady,
    isLocal,
  }: {
    isReady: boolean;
    isLocal: boolean;
  }) {
    if (!window?.coreSetup || inFlight.current || !isReady || !isLocal) return;

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

    handleCoreSetup({ isReady, isLocal });
  }, [isReady, isLocal]);

  const isCoreInstalledState = statuses['downloadedCore']?.status === 'done';
  const isCoreRunningState = statuses['coreRunning']?.status === 'done';
  const actionLoading = Object.keys(statuses).find(
    (key) => statuses[key]?.status === 'active'
  );
  const initializedRef = useRef(false);
  const isNotRunning = statuses['coreRunning']?.status === 'off';

  useEffect(() => {
    if (!window?.coreSetup) return;
    if (!isReady || !isLocal) return;
    if (initializedRef.current) return;

    if (isNotRunning) {
      initializedRef.current = true;
      setOpen(true);
    }
  }, [isNotRunning, isReady, isLocal, setOpen]);

  const verifyCoreNotRunningFunc = useCallback(() => {
    if (!isLocal) return;
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
    handleCoreSetup({ isReady, isLocal });
  }, [isLocal, isReady, setStatuses]);

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
      return;
    }

    let canceled = false;

    const checkLocalNodeReady = async () => {
      if (localReadyDismissedRef.current) return;

      try {
        const running = await window.coreSetup.isCoreRunning();
        if (!running) return;

        const statusResponse = await fetch(
          `${getDefaultLocalNodeUrl()}/admin/status`
        );
        if (!statusResponse.ok) return;

        const status = await statusResponse.json();
        if (!canceled && status?.syncPercent === 100) {
          setShowLocalReadyNotice(true);
        }
      } catch (error) {
        // Local Core can be starting, blocked, or still syncing; silence noisy polling.
      }
    };

    const firstCheck = window.setTimeout(checkLocalNodeReady, 4000);
    const interval = window.setInterval(checkLocalNodeReady, 30000);

    return () => {
      canceled = true;
      window.clearTimeout(firstCheck);
      window.clearInterval(interval);
    };
  }, [extState, isLocal]);

  const usePublicNode = useCallback(async () => {
    await handleSaveNodeInfo({
      url: HTTPS_EXT_NODE_QORTAL_LINK,
      apikey: '',
    });
    setOpen(false);
    setIsOpenRecommendation(false);
  }, [handleSaveNodeInfo, setIsOpenRecommendation, setOpen]);

  const switchToLocalNode = useCallback(async () => {
    if (switchingToLocalRef.current) return;
    switchingToLocalRef.current = true;

    try {
      setLocalReadySwitchError('');
      const apiKey = window?.coreSetup?.getApiKey
        ? await window.coreSetup.getApiKey()
        : '';

      await handleSaveNodeInfo({
        url: getDefaultLocalNodeUrl(),
        apikey: apiKey || '',
      });
      await getBalanceFunc();
      localReadyDismissedRef.current = true;
      setShowLocalReadyNotice(false);
    } catch (error) {
      console.error('Failed to switch to local node:', error);
      setLocalReadySwitchError(
        'Switch failed. You can log out and unlock again to use the local node.'
      );
    } finally {
      switchingToLocalRef.current = false;
    }
  }, [getBalanceFunc, handleSaveNodeInfo]);

  return (
    <>
      <CoreSetupDialog
        open={open}
        actionLoading={!!actionLoading}
        onClose={() => setOpen(false)}
        onAction={() => {
          if (!window?.coreSetup) return;
          if (isCoreRunningState) {
            setOpen(false);
          } else if (isCoreInstalledState) {
            window.coreSetup.startCore();
          } else {
            window.coreSetup.installCore();
          }
        }}
        steps={statuses}
        customQortalPath={customQortalPath}
        verifyCoreNotRunningFunc={verifyCoreNotRunningFunc}
        isWindows={osType === 'win32'}
        onUsePublicNode={usePublicNode}
      />
      <CoreSetupRecommendationDialog
        open={isOpenRecommendation}
        openLocalSetup={() => setOpen(true)}
        onClose={() => setIsOpenRecommendation(false)}
        setOpenCoreHandler={setOpen}
      />
      {showLocalReadyNotice && (
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
            zIndex: 2400,
          }}
        >
          <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1.2 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.92rem', fontWeight: 800 }}>
                Local node ready
              </Typography>
              <Typography
                sx={{
                  color: 'rgba(214,221,233,0.62)',
                  fontSize: '0.8rem',
                  lineHeight: 1.55,
                  mt: 0.45,
                }}
              >
                Qortal Core is synced. You can switch from the public node to
                your local node now.
              </Typography>
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
            <ButtonBase
              onClick={() => {
                localReadyDismissedRef.current = true;
                setShowLocalReadyNotice(false);
              }}
              sx={{
                color: theme.palette.text.secondary,
                p: 0.25,
                '&:hover': { color: theme.palette.text.primary },
              }}
            >
              <CloseRoundedIcon sx={{ fontSize: 18 }} />
            </ButtonBase>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 1.25 }}>
            <ButtonBase
              onClick={() => {
                localReadyDismissedRef.current = true;
                setShowLocalReadyNotice(false);
              }}
              sx={noticeActionSx(false)}
            >
              Later
            </ButtonBase>
            <ButtonBase onClick={switchToLocalNode} sx={noticeActionSx(true)}>
              Switch to local
            </ButtonBase>
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

const noticeActionSx = (primary: boolean) => ({
  backgroundColor: primary ? 'rgba(91, 132, 201, 0.62)' : 'rgba(255,255,255,0.035)',
  border: `1px solid ${primary ? 'rgba(174, 204, 255, 0.28)' : 'rgba(255,255,255,0.07)'}`,
  borderRadius: '7px',
  color: primary ? '#F4F8FF' : 'rgba(214,221,233,0.72)',
  fontSize: '0.78rem',
  fontWeight: 800,
  minHeight: 32,
  px: 1.25,
  transition: 'background-color 160ms ease, border-color 160ms ease',
  '&:hover': {
    backgroundColor: primary ? 'rgba(105, 150, 224, 0.72)' : 'rgba(255,255,255,0.055)',
    borderColor: primary ? 'rgba(190, 216, 255, 0.38)' : 'rgba(255,255,255,0.11)',
  },
});
