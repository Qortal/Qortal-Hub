import React, { useContext, useEffect, useMemo,  useState } from "react";

import { Avatar, Box,  } from "@mui/material";
import { Add } from "@mui/icons-material";
import { MyContext, getBaseApiReact, isMobile } from "../../App";

import { executeEvent, subscribeToEvent, unsubscribeFromEvent } from "../../utils/events";
import { useFrame } from "react-frame-component";
import { useQortalMessageListener } from "./useQortalMessageListener";




export const AppViewer = React.forwardRef(({ app , hide, isDevMode}, iframeRef) => {
  const { rootHeight } = useContext(MyContext);
  // const iframeRef = useRef(null);
  const { document, window: frameWindow } = useFrame();
  const {path, history, changeCurrentIndex, resetHistory} = useQortalMessageListener(frameWindow, iframeRef, app?.tabId, isDevMode, app?.name, app?.service) 
  const [url, setUrl] = useState('')


  useEffect(()=> {
    if(app?.isPreview) return
    if(isDevMode){
      setUrl(app?.url)
      return
    }
   
    setUrl(`${getBaseApiReact()}/render/${app?.service}/${app?.name}${app?.path != null ? `/${app?.path}` : ''}?theme=dark&identifier=${(app?.identifier != null && app?.identifier != 'null') ? app?.identifier : ''}`)
  }, [app?.service, app?.name, app?.identifier, app?.path, app?.isPreview])

  useEffect(()=> {
    if(app?.isPreview && app?.url){
      resetHistory()
      setUrl(app.url)
    }
  }, [app?.url, app?.isPreview])
  const defaultUrl = useMemo(()=> {
    return  url
  }, [url, isDevMode])


  const refreshAppFunc = (e) => {
    const {tabId} = e.detail
    if(tabId === app?.tabId){
      if(isDevMode){
        
        resetHistory()
        if(!app?.isPreview || app?.isPrivate){
          setUrl(app?.url + `?time=${Date.now()}`)
        }
        return

      }

      const constructUrl = `${getBaseApiReact()}/render/${app?.service}/${app?.name}${path != null ? path : ''}?theme=dark&identifier=${app?.identifier != null ? app?.identifier : ''}&time=${new Date().getMilliseconds()}`
      setUrl(constructUrl)
    }
  };

  useEffect(() => {
    subscribeToEvent("refreshApp", refreshAppFunc);

    return () => {
      unsubscribeFromEvent("refreshApp", refreshAppFunc);
    };
  }, [app, path, isDevMode]);

  const removeTrailingSlash = (str) => str.replace(/\/$/, '');
  const copyLinkFunc = (e) => {
    const {tabId} = e.detail
    if(tabId === app?.tabId){
      let link = 'qortal://' + app?.service + '/' + app?.name 
      if(path && path.startsWith('/')){
        link = link +  removeTrailingSlash(path)
      }
      if(path && !path.startsWith('/')){
        link = link + '/' +  removeTrailingSlash(path)
      }
      navigator.clipboard.writeText(link)
      .then(() => {
        console.log("Path copied to clipboard:", path);
      })
      .catch((error) => {
        console.error("Failed to copy path:", error);
      });
    }
  };

  useEffect(() => {
    subscribeToEvent("copyLink", copyLinkFunc);

    return () => {
      unsubscribeFromEvent("copyLink", copyLinkFunc);
    };
  }, [app, path]);

 // Function to navigate back in iframe
 const navigateBackInIframe = async () => {
  if (iframeRef.current && iframeRef.current.contentWindow && history?.currentIndex > 0) {
    // Calculate the previous index and path
    const previousPageIndex = history.currentIndex - 1;
    const previousPath = history.customQDNHistoryPaths[previousPageIndex];
    const targetOrigin = iframeRef.current ? new URL(iframeRef.current.src).origin : "*"; 
    // Signal non-manual navigation
    iframeRef.current.contentWindow.postMessage(
      { action: 'PERFORMING_NON_MANUAL', currentIndex: previousPageIndex },targetOrigin
    );
    // Update the current index locally
    changeCurrentIndex(previousPageIndex);

    // Create a navigation promise with a 200ms timeout
    const navigationPromise = new Promise((resolve, reject) => {
      function handleNavigationSuccess(event) {
        if (event.data?.action === 'NAVIGATION_SUCCESS' && event.data.path === previousPath) {
          frameWindow.removeEventListener('message', handleNavigationSuccess);
          resolve();
        }
      }

      frameWindow.addEventListener('message', handleNavigationSuccess);

      // Timeout after 200ms if no response
      setTimeout(() => {
        window.removeEventListener('message', handleNavigationSuccess);
        reject(new Error("Navigation timeout"));
      }, 200);
      const targetOrigin = iframeRef.current ? new URL(iframeRef.current.src).origin : "*"; 
      // Send the navigation command after setting up the listener and timeout
      iframeRef.current.contentWindow.postMessage(
        { action: 'NAVIGATE_TO_PATH', path: previousPath, requestedHandler: 'UI' }, targetOrigin
      );
    });

    // Execute navigation promise and handle timeout fallback
    try {
      await navigationPromise;
    } catch (error) {
     if(isDevMode){
        setUrl(`${url}${previousPath != null ? previousPath : ''}?theme=dark&time=${new Date().getMilliseconds()}&isManualNavigation=false`)
      return
     }
      setUrl(`${getBaseApiReact()}/render/${app?.service}/${app?.name}${previousPath != null ? previousPath : ''}?theme=dark&identifier=${(app?.identifier != null && app?.identifier != 'null') ? app?.identifier : ''}&time=${new Date().getMilliseconds()}&isManualNavigation=false`)
      // iframeRef.current.contentWindow.location.href = previousPath; // Fallback URL update
    }
  } else {
    console.log('Iframe not accessible or does not have a content window.');
  }
};

 const navigateBackAppFunc = (e) => {

  navigateBackInIframe()
  };

  useEffect(() => {
    if(!app?.tabId) return
    subscribeToEvent(`navigateBackApp-${app?.tabId}`, navigateBackAppFunc);

    return () => {
      unsubscribeFromEvent(`navigateBackApp-${app?.tabId}`, navigateBackAppFunc);
    };
  }, [app, history]);


 // Function to navigate back in iframe
 const navigateForwardInIframe = async () => {

 
  if (iframeRef.current && iframeRef.current.contentWindow) {
    const targetOrigin = iframeRef.current ? new URL(iframeRef.current.src).origin : "*";
      iframeRef.current.contentWindow.postMessage(
          { action: 'NAVIGATE_FORWARD'},
          targetOrigin
      );
  } else {
      console.log('Iframe not accessible or does not have a content window.');
  }
};


  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
    }}>

       <iframe ref={iframeRef} style={{
          height: !isMobile ? '100vh' : `calc(${rootHeight} - 60px - 45px )`,
          border: 'none',
          width: '100%'
        }} id="browser-iframe" src={defaultUrl}   sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals" 
        allow="fullscreen; clipboard-read; clipboard-write">
    						
    						</iframe>
    </Box>
       
  );
});
