import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CoreSetupDialog } from './CoreSetupDialog';
import { LOCALHOST_12391 } from '../constants/constants';
import { cleanUrl } from '../background/background';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';

export const CoreSetup = ({ currentNode }) => {
  const [open, setOpen] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const [statuses, setStatuses] = useState({
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

  const isLocal = cleanUrl(currentNode?.url) === LOCALHOST_12391;

  const inFlight = useRef(false);
  useEffect(() => {
    if (!window?.coreSetup) return;
    const off = window.coreSetup.onProgress((p) => {
      if (p === 'ready') {
        setIsReady(true);
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
  }, []);

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
    let cancelled = false;

    if (!cancelled) {
      handleCoreSetup({ isReady, isLocal });
    }

    return () => {
      cancelled = true;
    };
  }, [isReady, isLocal]);

  const isCoreInstalledState = statuses['downloadedCore']?.status === 'done';
  const isCoreRunningState = statuses['coreRunning']?.status === 'done';
  const actionLoading = Object.keys(statuses).find(
    (key) => statuses[key]?.status === 'active'
  );
  const isNotRunning = statuses['coreRunning']?.status === 'off';
  useEffect(() => {
    if (!isReady || !isLocal) return;
    if (isNotRunning) {
      setOpen(true);
    }
  }, [isNotRunning, isReady, isLocal]);

  const verifyCoreNotRunningFunc = useCallback(
    (e) => {
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
    },
    [isLocal, isReady]
  );

  useEffect(() => {
    subscribeToEvent('verifyCoreNotRunning', verifyCoreNotRunningFunc);

    return () => {
      unsubscribeFromEvent('verifyCoreNotRunning', verifyCoreNotRunningFunc);
    };
  }, [verifyCoreNotRunningFunc]);

  return (
    <>
      <CoreSetupDialog
        open={open}
        actionLoading={!!actionLoading}
        onClose={() => setOpen(false)}
        onAction={() => {
          if (isCoreRunningState) {
            setOpen(false);
          } else if (isCoreInstalledState) {
            window.coreSetup.startCore();
          } else {
            window.coreSetup.installCore();
          }
        }}
        steps={statuses}
      />
    </>
  );
};
