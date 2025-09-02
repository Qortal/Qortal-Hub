import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CoreSetupDialog } from './CoreSetupDialog';
import { LOCALHOST_12391 } from '../constants/constants';
import { cleanUrl } from '../background/background';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';
import {
  isOpenCoreSetup,
  isOpenDialogCoreRecommendationAtom,
  selectedNodeInfoAtom,
  statusesAtom,
} from '../atoms/global';
import { useAtom } from 'jotai';
import { CoreSetupRecommendationDialog } from './CoreSetupRecommendationDialog';
import { CoreSetupResetApikeyDialog } from './CoreSetupResetApikeyDialog';
import { CustomNodeApikeyDialog } from './CustomNodeApikeyDialog';

export const CoreSetup = () => {
  const [open, setOpen] = useAtom(isOpenCoreSetup);
  const [isReady, setIsReady] = useState(false);
  const [statuses, setStatuses] = useAtom(statusesAtom);
  const [selectedNode] = useAtom(selectedNodeInfoAtom);
  const [osType, setOsType] = useState(null);
  const [isOpenRecommendation, setIsOpenRecommendation] = useAtom(
    isOpenDialogCoreRecommendationAtom
  );
  const isLocal = cleanUrl(selectedNode?.url) === LOCALHOST_12391;
  const [customQortalPath, setCustomQortalPath] = useState('');
  const inFlight = useRef(false);
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
    initializedRef.current = true;
    if (isNotRunning) {
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
        customQortalPath={customQortalPath}
        verifyCoreNotRunningFunc={verifyCoreNotRunningFunc}
        isWindows={osType === 'win32'}
      />
      <CoreSetupRecommendationDialog
        open={isOpenRecommendation}
        openLocalSetup={() => setOpen(true)}
        onClose={() => setIsOpenRecommendation(false)}
        setOpenCoreHandler={setOpen}
      />
      <CoreSetupResetApikeyDialog />
      <CustomNodeApikeyDialog />
    </>
  );
};
