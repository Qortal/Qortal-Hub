import { useCallback } from 'react';
import {
  resourceDownloadControllerAtom,
  useGetResourceStatus,
} from '../atoms/global';
import { getBaseApiReact } from '../App';
import { useSetAtom } from 'jotai';
import { TIME_SECONDS_30_IN_MILLISECONDS } from '../constants/constants';

export const useFetchResources = () => {
  const setResources = useSetAtom(resourceDownloadControllerAtom);
  const getResourceStatus = useGetResourceStatus();

  const downloadResource = useCallback(
    async ({ service, name, identifier }, build, triesFromBefore) => {
      const existingValues = await getResourceStatus(
        `${service}-${name}-${identifier}`
      );
      if (existingValues && existingValues?.isFetching) return;
      setResources((prev) => ({
        ...prev,
        [`${service}-${name}-${identifier}`]: {
          ...(prev[`${service}-${name}-${identifier}`] || {}),
          isFetching: true,
          service,
          name,
          identifier,
        },
      }));
      let shouldBuild = false;
      let hasCalledBuild = false;
      let isCalling = false;
      let percentLoaded = 0;
      let timer = 24;
      let tries = triesFromBefore || 0;
      let calledFirstTime = false;
      let intervalId;
      let timeoutId;

      if (build && !hasCalledBuild) {
        hasCalledBuild = true;
        shouldBuild = true;
      }
      try {
        const callFunction = async () => {
          if (isCalling) return;
          isCalling = true;

          let res;

          if (!shouldBuild) {
            const urlFirstTime = `${getBaseApiReact()}/arbitrary/resource/status/${service}/${name}/${identifier}`;
            const resCall = await fetch(urlFirstTime, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            });
            res = await resCall.json();
            if (tries > 18) {
              if (intervalId) {
                clearInterval(intervalId);
              }
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
              setResources((prev) => ({
                ...prev,
                [`${service}-${name}-${identifier}`]: {
                  ...(prev[`${service}-${name}-${identifier}`] || {}),
                  isFetching: false,
                  status: {
                    ...res,
                    status: 'FAILED_TO_DOWNLOAD',
                  },
                },
              }));
              return;
            }
            tries = tries + 1;
          }

          if (
            shouldBuild ||
            (calledFirstTime === false && res?.status !== 'READY')
          ) {
            shouldBuild = false;
            const url = `${getBaseApiReact()}/arbitrary/resource/properties/${service}/${name}/${identifier}?build=true`;
            const resCall = await fetch(url, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            });
            res = await resCall.json();
          }
          calledFirstTime = true;
          isCalling = false;
          if (res.localChunkCount) {
            if (res.percentLoaded) {
              if (
                res.percentLoaded === percentLoaded &&
                res.percentLoaded !== 100
              ) {
                timer = timer - 5;
              } else {
                timer = 24;
              }

              if (timer < 0) {
                if (intervalId) {
                  clearInterval(intervalId);
                }
                if (timeoutId) {
                  clearTimeout(timeoutId);
                }
                timer = 24;
                isCalling = true;

                // Update Recoil state for refetching
                setResources((prev) => ({
                  ...prev,
                  [`${service}-${name}-${identifier}`]: {
                    ...(prev[`${service}-${name}-${identifier}`] || {}),
                    isFetching: false,
                    status: {
                      ...res,
                      status: 'REFETCHING',
                    },
                  },
                }));

                timeoutId = setTimeout(() => {
                  downloadResource({ name, service, identifier }, true, tries);
                }, 25000);

                return;
              }

              percentLoaded = res.percentLoaded;
            }

            // Update Recoil state for progress
            setResources((prev) => ({
              ...prev,
              [`${service}-${name}-${identifier}`]: {
                ...(prev[`${service}-${name}-${identifier}`] || {}),
                isFetching: true,
                status: res,
              },
            }));
          }

          // Check if progress is 100% and clear interval if true
          if (res?.status === 'READY') {
            if (intervalId) {
              clearInterval(intervalId);
            }
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            // Update Recoil state for completion
            setResources((prev) => ({
              ...prev,
              [`${service}-${name}-${identifier}`]: {
                ...(prev[`${service}-${name}-${identifier}`] || {}),
                isFetching: false,
                status: res,
              },
            }));

            return;
          }
          if (res?.status === 'DOWNLOADED') {
            const url = `${getBaseApiReact()}/arbitrary/resource/status/${service}/${name}/${identifier}?build=true`;
            const resCall = await fetch(url, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            });
            res = await resCall.json();
          }
        };
        callFunction();
        intervalId = setInterval(async () => {
          callFunction();
        }, 5000);
      } catch (error) {
        isCalling = false;
        console.error('Error during resource fetch:', error);
      }
    },
    [setResources, getResourceStatus]
  );

  return downloadResource;
};
