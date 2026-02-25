import { useCallback } from 'react';
import {
  resourceDownloadControllerAtom,
  globalDownloadsAtom,
  useGetResourceStatus,
} from '../atoms/global';
import { getBaseApiReact } from '../App';
import { useSetAtom, useAtomValue } from 'jotai';
import { ResourceStatus, PeerDetail } from '../types/resources';

interface QortalMetadata {
  service: string;
  name: string;
  identifier: string;
}

export const useFetchResources = () => {
  const setResources = useSetAtom(resourceDownloadControllerAtom);
  const setGlobalDownloads = useSetAtom(globalDownloadsAtom);
  const getResourceStatus = useGetResourceStatus();

  const stopGlobalDownload = useCallback(
    (resourceId: string) => {
      setGlobalDownloads((prev) => {
        const entry = prev[resourceId];
        if (entry) {
          if (entry.interval !== null) clearInterval(entry.interval);
          if (entry.timeout !== null) clearTimeout(entry.timeout);
          if (entry.retryTimeout !== null) clearTimeout(entry.retryTimeout);
          const updated = { ...prev };
          delete updated[resourceId];
          return updated;
        }
        return prev;
      });
    },
    [setGlobalDownloads]
  );

  const startGlobalDownload = useCallback(
    async (
      metadata: QortalMetadata,
      retryAttempts: number = 18,
      path?: string,
      filename?: string
    ) => {
      const { service, name, identifier } = metadata;
      const resourceId = `${service}-${name}-${identifier}`;

      // Check if already downloading
      const existingValues = await getResourceStatus(resourceId);
      if (existingValues && existingValues?.isFetching) return;

      const intervalMap: Record<string, any> = {};
      const timeoutMap: Record<string, any> = {};
      const retryTimeoutMap: Record<string, any> = {};
      const calledBuildMap: Record<string, boolean> = {};

      let isCalling = false;
      let percentLoaded = 0;
      let timer = 14;
      let tries = 0;
      let calledFirstTime = false;
      let isPaused = false;

      // Track progress for ETA calculation
      let progressHistory: Array<{ percent: number; timestamp: number }> = [];

      // Track chunk download speed for slowdown detection
      let maxPeersSeen = 0;
      let chunkHistory: Array<{ chunks: number; timestamp: number }> = [];
      let baselineSpeed: number | null = null;
      let hasDetectedSlowdown = false;

      const calculateETA = (currentPercent: number) => {
        const now = Date.now();

        progressHistory.push({ percent: currentPercent, timestamp: now });

        if (progressHistory.length > 6) {
          progressHistory = progressHistory.slice(-6);
        }

        if (progressHistory.length < 2) {
          return undefined;
        }

        const firstPoint = progressHistory[0];
        const lastPoint = progressHistory[progressHistory.length - 1];
        const percentDiff = lastPoint.percent - firstPoint.percent;
        const timeDiff = (lastPoint.timestamp - firstPoint.timestamp) / 1000;

        if (percentDiff <= 0 || timeDiff <= 0) {
          return undefined;
        }

        const speed = percentDiff / timeDiff;
        const remainingPercent = 100 - currentPercent;

        if (speed <= 0.001) {
          return undefined;
        }

        const estimatedSeconds = remainingPercent / speed;
        return Math.min(estimatedSeconds, 3600);
      };

      const calculateChunkSpeed = (
        currentChunks: number,
        totalChunks: number
      ) => {
        const now = Date.now();

        chunkHistory.push({ chunks: currentChunks, timestamp: now });

        if (chunkHistory.length > 6) {
          chunkHistory = chunkHistory.slice(-6);
        }

        if (chunkHistory.length < 2) {
          return null;
        }

        const firstPoint = chunkHistory[0];
        const lastPoint = chunkHistory[chunkHistory.length - 1];
        const chunkDiff = lastPoint.chunks - firstPoint.chunks;
        const timeDiff = (lastPoint.timestamp - firstPoint.timestamp) / 1000;

        if (timeDiff <= 0) {
          return null;
        }

        if (chunkDiff <= 0) {
          if (chunkHistory.length >= 4) {
            return 0; // Stalled
          }
          return null;
        }

        const speed = chunkDiff / timeDiff;

        if (baselineSpeed === null && chunkHistory.length >= 4) {
          baselineSpeed = speed;
        }

        return speed;
      };

      const checkForSlowdown = (
        currentChunks: number,
        totalChunks: number,
        numberOfPeers: number
      ) => {
        if (numberOfPeers > maxPeersSeen) {
          maxPeersSeen = numberOfPeers;
        }

        if (maxPeersSeen <= 1 || hasDetectedSlowdown) {
          return false;
        }

        if (currentChunks === 0 || totalChunks === 0) {
          return false;
        }

        const currentSpeed = calculateChunkSpeed(currentChunks, totalChunks);

        if (
          currentSpeed === 0 &&
          baselineSpeed !== null &&
          chunkHistory.length >= 4
        ) {
          return true;
        }

        if (currentSpeed === null || baselineSpeed === null) {
          return false;
        }

        const normalizedBaseline = baselineSpeed / totalChunks;
        const normalizedCurrent = currentSpeed / totalChunks;

        const slowdownThreshold = 0.5;
        const hasSlowdown =
          normalizedCurrent < normalizedBaseline * slowdownThreshold;

        const absoluteSlowThreshold = 0.001;
        const isVerySlow = normalizedCurrent < absoluteSlowThreshold;

        return hasSlowdown || isVerySlow;
      };

      const setResourceStatus = (status: Partial<ResourceStatus>) => {
        setResources((prev) => {
          const existing = prev[resourceId] || {};
          return {
            ...prev,
            [resourceId]: {
              ...existing,
              status: {
                ...(existing.status || {}),
                ...status,
              },
              isFetching:
                status.status !== 'READY' &&
                status.status !== 'FAILED_TO_DOWNLOAD',
              service,
              name,
              identifier,
            },
          };
        });
      };

      const callFunction = async (build?: boolean, isRecalling?: boolean) => {
        try {
          if (isCalling) {
            return;
          }

          if (isPaused && !build) {
            return;
          }

          isCalling = true;

          const currentStatus = await getResourceStatus(resourceId);
          if (currentStatus?.status === 'READY') {
            if (intervalMap[resourceId]) clearInterval(intervalMap[resourceId]);
            if (timeoutMap[resourceId]) clearTimeout(timeoutMap[resourceId]);
            if (retryTimeoutMap[resourceId])
              clearTimeout(retryTimeoutMap[resourceId]);
            stopGlobalDownload(resourceId);
            isCalling = false;
            return;
          }

          if (!isRecalling) {
            setResourceStatus({
              status: 'SEARCHING',
              localChunkCount: 0,
              totalChunkCount: 0,
              percentLoaded: 0,
              path: path || '',
              filename: filename || '',
            });
          }

          let res;

          if (!build) {
            const response = await fetch(
              `${getBaseApiReact()}/arbitrary/resource/status/${service}/${name}/${identifier}`,
              {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
              }
            );
            res = await response.json();

            setResourceStatus(res);

            // Fetch peers non-blocking
            fetch(
              `${getBaseApiReact()}/arbitrary/resource/request/peers/${service}/${name}/${identifier}`
            )
              .then((response) => response.json())
              .then(async (peersData) => {
                const numberOfPeers = peersData?.peerCount ?? 0;
                const peers: PeerDetail[] = peersData?.peers ?? [];
                const currentStatus = await getResourceStatus(resourceId);
                if (currentStatus?.status) {
                  setResourceStatus({
                    ...currentStatus.status,
                    numberOfPeers,
                    peers,
                  });

                  if (
                    currentStatus.status?.localChunkCount !== undefined &&
                    currentStatus.status?.totalChunkCount !== undefined &&
                    (currentStatus.status?.status === 'DOWNLOADING' ||
                      currentStatus.status?.status === 'MISSING_DATA')
                  ) {
                    const shouldRequestAsync = checkForSlowdown(
                      currentStatus.status.localChunkCount,
                      currentStatus.status.totalChunkCount,
                      numberOfPeers
                    );
                    if (shouldRequestAsync) {
                      hasDetectedSlowdown = true;
                      console.log(
                        `Download slowdown detected. Requesting async fetch for ${resourceId}`
                      );

                      const url = `${getBaseApiReact()}/arbitrary/${service}/${name}/${identifier}?async=true`;
                      fetch(url, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                      }).catch((error) => {
                        console.debug(
                          'Failed to fetch async on slowdown:',
                          error
                        );
                      });
                    }
                  }
                }
              })
              .catch((error) => {
                console.debug('Failed to fetch peers count:', error);
              });

            if (tries > retryAttempts) {
              if (intervalMap[resourceId])
                clearInterval(intervalMap[resourceId]);
              if (timeoutMap[resourceId]) clearTimeout(timeoutMap[resourceId]);
              if (retryTimeoutMap[resourceId])
                clearTimeout(retryTimeoutMap[resourceId]);
              stopGlobalDownload(resourceId);
              setResourceStatus({
                ...res,
                status: 'FAILED_TO_DOWNLOAD',
              });
              isCalling = false;
              return;
            }
          }

          if (build || (calledFirstTime === false && res?.status !== 'READY')) {
            calledFirstTime = true;
            const url = `${getBaseApiReact()}/arbitrary/${service}/${name}/${identifier}?async=true`;
            const resCall = await fetch(url, {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' },
            });
            res = await resCall.json();
            isPaused = false;
          }

          if (res.localChunkCount) {
            if (res.percentLoaded) {
              const eta = calculateETA(res.percentLoaded);

              if (
                res.percentLoaded === percentLoaded &&
                res.percentLoaded !== 100
              ) {
                timer -= 5;
              } else {
                timer = 14;
              }

              if (timer < 0) {
                timer = 14;
                isPaused = true;
                tries += 1;
                setResourceStatus({
                  ...res,
                  status: 'REFETCHING',
                  estimatedTimeRemaining: eta,
                });

                timeoutMap[resourceId] = setTimeout(() => {
                  callFunction(true, true);
                }, 200);

                isCalling = false;
                return;
              }

              percentLoaded = res.percentLoaded;

              setResourceStatus({
                ...res,
                estimatedTimeRemaining: eta,
              });
            } else {
              setResourceStatus(res);
            }
          }

          if (res?.status === 'READY') {
            if (intervalMap[resourceId]) clearInterval(intervalMap[resourceId]);
            if (timeoutMap[resourceId]) clearTimeout(timeoutMap[resourceId]);
            if (retryTimeoutMap[resourceId])
              clearTimeout(retryTimeoutMap[resourceId]);
            stopGlobalDownload(resourceId);
            setResourceStatus(res);
            isCalling = false;
            return;
          }

          if (res?.status === 'DOWNLOADED') {
            if (!calledBuildMap[resourceId]) {
              calledBuildMap[resourceId] = true;

              try {
                const url = `${getBaseApiReact()}/arbitrary/resource/status/${service}/${name}/${identifier}?build=true`;
                const resCall = await fetch(url, {
                  method: 'GET',
                  headers: { 'Content-Type': 'application/json' },
                });
                res = await resCall.json();
                setResourceStatus(res);

                if (res?.status === 'READY') {
                  if (intervalMap[resourceId])
                    clearInterval(intervalMap[resourceId]);
                  if (timeoutMap[resourceId])
                    clearTimeout(timeoutMap[resourceId]);
                  if (retryTimeoutMap[resourceId])
                    clearTimeout(retryTimeoutMap[resourceId]);
                  stopGlobalDownload(resourceId);
                  setResourceStatus(res);
                  isCalling = false;
                  return;
                }
              } catch (error) {
                console.error('Error during build request:', error);
              } finally {
                calledBuildMap[resourceId] = false;
              }
            }
          }
        } catch (error) {
          console.error('Error during resource fetch:', error);
        } finally {
          isCalling = false;
        }
      };

      callFunction();

      intervalMap[resourceId] = setInterval(() => {
        callFunction(false, true);
      }, 5000);

      setGlobalDownloads((prev) => ({
        ...prev,
        [resourceId]: {
          interval: intervalMap[resourceId],
          timeout: timeoutMap[resourceId],
          retryTimeout: retryTimeoutMap[resourceId],
        },
      }));
    },
    [setResources, setGlobalDownloads, getResourceStatus, stopGlobalDownload]
  );

  // Legacy compatibility wrapper
  const downloadResource = useCallback(
    async (
      { service, name, identifier },
      build?: boolean,
      triesFromBefore?: number
    ) => {
      return startGlobalDownload(
        { service, name, identifier },
        triesFromBefore || 18
      );
    },
    [startGlobalDownload]
  );

  return downloadResource;
};
