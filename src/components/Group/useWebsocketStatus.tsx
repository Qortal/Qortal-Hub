import { useEffect, useRef } from 'react';
import {
  cleanUrl,
  getProtocol,
  groupApiSocket,
} from '../../background/background';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { useAtomValue, useSetAtom } from 'jotai';
import { nodeInfosAtom, selectedNodeInfoAtom } from '../../atoms/global';

export const useWebsocketStatus = () => {
  const lastPopup = useRef<null | number>(null);

  const setNodeInfos = useSetAtom(nodeInfosAtom);
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const socketRef = useRef(null);
  const connectionIdRef = useRef(0);
  const timeoutIdRef = useRef(null); // No-pong timeout (close if no pong in 5s)
  const groupSocketTimeoutRef = useRef(null); // Next ping in 45s
  const reconnectTimeoutRef = useRef(null);
  const verifyCoreTimeoutRef = useRef(null);

  const getStatusSocketBase = (nodeUrl?: string | null) => {
    if (!nodeUrl) return groupApiSocket;
    const protocol = getProtocol(nodeUrl) === 'http' ? 'ws://' : 'wss://';
    return `${protocol}${cleanUrl(nodeUrl)}`;
  };

  const forceCloseWebSocket = () => {
    clearTimeout(timeoutIdRef.current);
    clearTimeout(groupSocketTimeoutRef.current);
    clearTimeout(reconnectTimeoutRef.current);
    clearTimeout(verifyCoreTimeoutRef.current);
    timeoutIdRef.current = null;
    groupSocketTimeoutRef.current = null;
    reconnectTimeoutRef.current = null;
    verifyCoreTimeoutRef.current = null;
    if (socketRef.current) {
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
    const connectionId = connectionIdRef.current + 1;
    connectionIdRef.current = connectionId;
    const selectedNodeUrl = selectedNode?.url;
    const socketBase = getStatusSocketBase(selectedNodeUrl);
    const isCurrentConnection = (socket?: WebSocket | null) => {
      if (connectionIdRef.current !== connectionId) return false;
      if (socket && socketRef.current !== socket) return false;
      return true;
    };

    const pingHeads = (socket: WebSocket) => {
      try {
        if (
          isCurrentConnection(socket) &&
          socket.readyState === WebSocket.OPEN
        ) {
          socket.send('ping');
          timeoutIdRef.current = setTimeout(() => {
            if (isCurrentConnection(socket)) {
              socket.close();
              clearTimeout(groupSocketTimeoutRef.current);
            }
          }, 5000); // Close if no pong in 5 seconds
        }
      } catch (error) {
        console.error('Error during ping:', error);
      }
    };

    const initWebsocketMessageGroup = async () => {
      if (!isCurrentConnection()) return;
      forceCloseWebSocket(); // Ensure we close any existing connection
      if (!isCurrentConnection()) return;

      try {
        const socketLink = `${socketBase}/websockets/admin/status`;
        const socket = new WebSocket(socketLink);
        socketRef.current = socket;

        socket.onopen = () => {
          setTimeout(() => pingHeads(socket), 50); // Initial ping
        };

        socket.onmessage = (e) => {
          if (!isCurrentConnection(socket)) return;
          try {
            if (e.data === 'pong') {
              clearTimeout(timeoutIdRef.current);
              groupSocketTimeoutRef.current = setTimeout(
                () => pingHeads(socket),
                20000
              ); // Ping every 20 seconds
              return;
            }
            const data = JSON.parse(e.data);
            if (data?.height) {
              setNodeInfos({
                ...data,
                sourceNodeUrl: selectedNodeUrl,
                receivedAt: Date.now(),
              });
            }
          } catch (error) {
            console.error('Error parsing onmessage data:', error);
          }
        };

        socket.onclose = (event) => {
          if (!isCurrentConnection(socket)) return;
          clearTimeout(timeoutIdRef.current);
          clearTimeout(groupSocketTimeoutRef.current);
          setNodeInfos({});
          console.warn(`WebSocket closed: ${event.reason || 'unknown reason'}`);
          if (event.reason !== 'forced' && event.code !== 1000) {
            if (!lastPopup.current || Date.now() - lastPopup.current > 600000) {
              verifyCoreTimeoutRef.current = setTimeout(() => {
                if (isCurrentConnection(socket)) {
                  sendMessageVerifyCoreNotRunning();
                }
              }, 18_000);
              lastPopup.current = Date.now();
            }
            reconnectTimeoutRef.current = setTimeout(() => {
              if (isCurrentConnection()) {
                initWebsocketMessageGroup();
              }
            }, 10000); // Retry after 10 seconds
          }
        };

        socket.onerror = (error) => {
          if (!isCurrentConnection(socket)) return;
          console.error('WebSocket error:', error);
          clearTimeout(timeoutIdRef.current);
          clearTimeout(groupSocketTimeoutRef.current);
          socket.close();
        };
      } catch (error) {
        console.error('Error initializing WebSocket:', error);
      }
    };

    initWebsocketMessageGroup(); // Initialize WebSocket on component mount

    return () => {
      connectionIdRef.current += 1;
      forceCloseWebSocket(); // Clean up WebSocket on component unmount
    };
  }, [selectedNode?.apikey, selectedNode?.url]);

  return null;
};
