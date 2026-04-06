import { useEffect, useRef, useState, useCallback } from 'react';

export function useWebSocket() {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const listenersRef = useRef(new Set());

  const subscribe = useCallback((callback) => {
    listenersRef.current.add(callback);
    return () => listenersRef.current.delete(callback);
  }, []);

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 3000); // Auto-reconnect
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          setLastMessage(data);
          for (const cb of listenersRef.current) cb(data);
        } catch {}
      };
    }

    connect();
    return () => wsRef.current?.close();
  }, []);

  return { connected, lastMessage, subscribe };
}
