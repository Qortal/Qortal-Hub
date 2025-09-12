import { useEffect, useRef } from 'react';
import { getBaseApiReactSocket } from '../../App';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { useSetAtom } from 'jotai';
import { nodeInfosAtom } from '../../atoms/global';

export const useWebsocketStatus = () => {
  const lastPopup = useRef<null | number>(null);

  const setNodeInfos = useSetAtom(nodeInfosAtom);
  const socketRef = useRef(null); // WebSocket reference
  const groupSocketTimeoutRef = useRef(null); // Group Socket Timeout reference
  const forceCloseWebSocket = () => {
    if (socketRef.current) {
      clearTimeout(groupSocketTimeoutRef.current);
      socketRef.current.close(1000, 'forced');
      socketRef.current = null;
    }
  };

  const logoutEventFunc = () => {
    forceCloseWebSocket();
  };

  useEffect(() => {
    subscribeToEvent('logout-event', logoutEventFunc);

    return () => {
      unsubscribeFromEvent('logout-event', logoutEventFunc);
    };
  }, []);

  const sendMessageVerifyCoreNotRunning = () => {
    executeEvent('verifyCoreNotRunning', {});
  };

  useEffect(() => {
    const initWebsocketMessageGroup = async () => {
      forceCloseWebSocket(); // Ensure we close any existing connection

      try {
        const socketLink = `${getBaseApiReactSocket()}/websockets/admin/status`;
        socketRef.current = new WebSocket(socketLink);

        socketRef.current.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data?.height) {
              setNodeInfos(data);
            }
          } catch (error) {
            console.error('Error parsing onmessage data:', error);
          }
        };

        socketRef.current.onclose = (event) => {
          clearTimeout(groupSocketTimeoutRef.current);
          setNodeInfos({});
          console.warn(`WebSocket closed: ${event.reason || 'unknown reason'}`);
          if (event.reason !== 'forced' && event.code !== 1000) {
            if (!lastPopup.current || Date.now() - lastPopup.current > 600000) {
              setTimeout(() => {
                sendMessageVerifyCoreNotRunning();
              }, 18_000);
              lastPopup.current = Date.now();
            }
            setTimeout(() => initWebsocketMessageGroup(), 10000); // Retry after 10 seconds
          }
        };

        socketRef.current.onerror = (error) => {
          console.error('WebSocket error:', error);
          clearTimeout(groupSocketTimeoutRef.current);
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
  }, []);

  return null;
};
