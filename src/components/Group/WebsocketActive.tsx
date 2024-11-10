import React, { useEffect, useRef } from 'react';
import { getBaseApiReactSocket, pauseAllQueues, resumeAllQueues } from '../../App';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';

export const WebSocketActive = ({ myAddress, setIsLoadingGroups }) => {
  const socketRef = useRef(null); // WebSocket reference
  const timeoutIdRef = useRef(null); // Timeout ID reference
  const groupSocketTimeoutRef = useRef(null); // Group Socket Timeout reference
  const initiateRef = useRef(null)
  const forceCloseWebSocket = () => {
    if (socketRef.current) {
      console.log('Force closing the WebSocket');
      clearTimeout(timeoutIdRef.current);
      clearTimeout(groupSocketTimeoutRef.current);
      socketRef.current.close(1000, 'forced');
      socketRef.current = null;
    }
  };

  const logoutEventFunc = () => {
    forceCloseWebSocket()
  };

  useEffect(() => {
    subscribeToEvent("logout-event", logoutEventFunc);

    return () => {
      unsubscribeFromEvent("logout-event", logoutEventFunc);
    };
  }, []);

  useEffect(() => {
    if (!myAddress) return; // Only proceed if myAddress is set


    const pingHeads = () => {
      try {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send('ping');
          timeoutIdRef.current = setTimeout(() => {
            if (socketRef.current) {
              socketRef.current.close();
              clearTimeout(groupSocketTimeoutRef.current);
            }
          }, 5000); // Close if no pong in 5 seconds
        }
      } catch (error) {
        console.error('Error during ping:', error);
      }
    };

    const initWebsocketMessageGroup = async () => {
      forceCloseWebSocket(); // Ensure we close any existing connection
      const currentAddress = myAddress;

      try {
        if(!initiateRef.current) {
          setIsLoadingGroups(true)
          pauseAllQueues()
          
        }
        const socketLink = `${getBaseApiReactSocket()}/websockets/chat/active/${currentAddress}?encoding=BASE64`;
        socketRef.current = new WebSocket(socketLink);

        socketRef.current.onopen = () => {
          setTimeout(pingHeads, 50); // Initial ping
        };

        socketRef.current.onmessage = (e) => {
          try {
            if (e.data === 'pong') {
              clearTimeout(timeoutIdRef.current);
              groupSocketTimeoutRef.current = setTimeout(pingHeads, 45000); // Ping every 45 seconds
            } else {
              if(!initiateRef.current) {
                setIsLoadingGroups(false)
                initiateRef.current = true
                resumeAllQueues()
      
              }
              const data = JSON.parse(e.data);
              const filteredGroups = data.groups?.filter(item => item?.groupId !== 0) || [];
              const sortedGroups = filteredGroups.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
              const sortedDirects = (data?.direct || []).filter(item =>
                item?.name !== 'extension-proxy' && item?.address !== 'QSMMGSgysEuqDCuLw3S4cHrQkBrh3vP3VH'
              ).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
           
              window.sendMessage("handleActiveGroupDataFromSocket", {
                groups: sortedGroups,
                directs: sortedDirects,
              }).catch((error) => {
                  console.error("Failed to handle active group data from socket:", error.message || "An error occurred");
                });
              
            }
          } catch (error) {
            console.error('Error parsing onmessage data:', error);
          }
        };

        socketRef.current.onclose = (event) => {
          clearTimeout(groupSocketTimeoutRef.current);
          clearTimeout(timeoutIdRef.current);
          console.warn(`WebSocket closed: ${event.reason || 'unknown reason'}`);
          if (event.reason !== 'forced' && event.code !== 1000) {
            setTimeout(() => initWebsocketMessageGroup(), 10000); // Retry after 10 seconds
          }
        };

        socketRef.current.onerror = (error) => {
          console.error('WebSocket error:', error);
          clearTimeout(groupSocketTimeoutRef.current);
          clearTimeout(timeoutIdRef.current);
          if (socketRef.current) {
            socketRef.current.close();
          }
        };
      } catch (error) {
        console.error('Error initializing WebSocket:', error);
      }
    };

   
      initWebsocketMessageGroup(); // Initialize WebSocket on component mount
   

    return () => {
      forceCloseWebSocket(); // Clean up WebSocket on component unmount
    };
  }, [myAddress]);

  return null;
};
