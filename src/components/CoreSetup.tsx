import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CoreSetupDialog } from './CoreSetupDialog';
import { LOCALHOST_12391 } from '../constants/constants';
import { cleanUrl } from '../background/background';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';
import {
  isOpenDialogCoreRecommendationAtom,
  localApiKeyAtom,
  selectedNodeInfoAtom,
  statusesAtom,
} from '../atoms/global';
import { useAtom } from 'jotai';
import { CoreSetupRecommendationDialog } from './CoreSetupRecommendationDialog';
import { CoreSetupResetApikeyDialog } from './CoreSetupResetApikeyDialog';
import { CustomNodeApikeyDialog } from './CustomNodeApikeyDialog';

export const CoreSetup = () => {
  const [open, setOpen] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [localApiKey, setLocalApiKey] = useAtom(localApiKeyAtom);
  const [statuses, setStatuses] = useAtom(statusesAtom);
  const [selectedNode, setSelectedNode] = useAtom(selectedNodeInfoAtom);
  const [isOpenRecommendation, setIsOpenRecommendation] = useAtom(
    isOpenDialogCoreRecommendationAtom
  );
  const isLocal = cleanUrl(selectedNode?.url) === LOCALHOST_12391;

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

  const validateApiKey = useCallback(async () => {
    try {
      const apiKey = await window.coreSetup.getApiKey();
      console.log('apiKey', apiKey);
      const url2 = `${LOCALHOST_12391}/admin/apikey/test?apiKey=${apiKey}`;
      const response2 = await fetch(url2);
      let isValid = false;
      // Assuming the response is in plain text and will be 'true' or 'false'
      const data2 = await response2.text();
      if (data2 === 'true') {
        isValid = true;
      }

      if (isValid) {
        setLocalApiKey(apiKey);
      }
    } catch (error) {
      console.error(error);
    }
  }, [setLocalApiKey]);

  useEffect(() => {
    if (!isCoreRunningState) return;
    validateApiKey();
  }, [isCoreRunningState, validateApiKey]);

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
