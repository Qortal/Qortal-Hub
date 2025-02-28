import React, { useCallback, useRef } from 'react';
import { useRecoilState } from 'recoil';
import { resourceDownloadControllerAtom } from '../atoms/global';
import { getBaseApiReact } from '../App';

export const useFetchResources = () => {
  const [resources, setResources] = useRecoilState(resourceDownloadControllerAtom);

  const downloadResource = useCallback(({ service, name, identifier }, build) => {
    setResources((prev) => ({
      ...prev,
      [`${service}-${name}-${identifier}`]: {
        ...(prev[`${service}-${name}-${identifier}`] || {}),
        service,
        name,
        identifier,
      },
    }));

    try {
      let isCalling = false;
      let percentLoaded = 0;
      let timer = 24;
      let tries = 0;
      let calledFirstTime = false
      let intervalId
      let timeoutId
      const callFunction = async ()=> {
        if (isCalling) return;
        isCalling = true;

      
        
        let res 
       
        if(!build){
            const urlFirstTime = `${getBaseApiReact()}/arbitrary/resource/status/${service}/${name}/${identifier}`;
            const resCall = await fetch(urlFirstTime, {
                method: "GET",
                headers: {
                  "Content-Type": "application/json",
                },
              });
               res = await resCall.json()
               if(tries > 18 ){
                if(intervalId){
                  clearInterval(intervalId)
                }
                if(timeoutId){
                  clearTimeout(timeoutId)
                }
                setResources((prev) => ({
                  ...prev,
                  [`${service}-${name}-${identifier}`]: {
                    ...(prev[`${service}-${name}-${identifier}`] || {}),
                    status: {
                      ...res,
                      status: 'FAILED_TO_DOWNLOAD',
                    },
                  },
                }));
                return
               }
               tries = tries + 1

        }
      
        
        if(build || (calledFirstTime === false && res?.status !== 'READY')){
            const url = `${getBaseApiReact()}/arbitrary/resource/properties/${service}/${name}/${identifier}?build=true`;
            const resCall = await fetch(url, {
                method: "GET",
                headers: {
                  "Content-Type": "application/json",
                },
              });
               res = await resCall.json();

        }
        calledFirstTime = true
        isCalling = false;

        if (res.localChunkCount) {
          if (res.percentLoaded) {
            if (res.percentLoaded === percentLoaded && res.percentLoaded !== 100) {
              timer = timer - 5;
            } else {
              timer = 24;
            }

            if (timer < 0) {
              timer = 24;
              isCalling = true;

              // Update Recoil state for refetching
              setResources((prev) => ({
                ...prev,
                [`${service}-${name}-${identifier}`]: {
                  ...(prev[`${service}-${name}-${identifier}`] || {}),
                  status: {
                    ...res,
                    status: 'REFETCHING',
                  },
                },
              }));

              timeoutId = setTimeout(() => {
                isCalling = false;
                downloadResource({ name, service, identifier }, true);
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
              status: res,
            },
          }));
        }

        // Check if progress is 100% and clear interval if true
        if (res?.status === 'READY') {
          if(intervalId){
            clearInterval(intervalId);

          }
          if(timeoutId){
            clearTimeout(timeoutId)
          }
          // Update Recoil state for completion
          setResources((prev) => ({
            ...prev,
            [`${service}-${name}-${identifier}`]: {
              ...(prev[`${service}-${name}-${identifier}`] || {}),
              status: res,
            },
          }));
        }
        if(res?.status === 'DOWNLOADED'){
          const url = `${getBaseApiReact()}/arbitrary/resource/status/${service}/${name}/${identifier}?build=true`;
          const resCall = await fetch(url, {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
              },
            });
             res = await resCall.json();
        }
      }
      callFunction()
      intervalId = setInterval(async () => {
        callFunction()
      }, 5000);
     
    } catch (error) {
      console.error('Error during resource fetch:', error);
    }
  }, [setResources]);

  return { downloadResource };
};
