import { useEffect, useRef, useState, useCallback } from 'react';

const MAX_RETRIES = 10;
const BASE_DELAY = 2000;  // 2s initial
const MAX_DELAY = 30000;  // 30s ceiling

export function useWebSocket() {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const listenersRef = useRef(new Set());
  const retriesRef = useRef(0);
  const timerRef = useRef(null);

  const subscribe = useCallback((callback) => {
    listenersRef.current.add(callback);
    return () => listenersRef.current.delete(callback);
  }, []);

  useEffect(() => {
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) { ws.close(); return; }
        setConnected(true);
        retriesRef.current = 0; // Reset backoff on successful connection
      };

      ws.onclose = () => {
        if (unmounted) return;
        setConnected(false);

        if (retriesRef.current >= MAX_RETRIES) {
          // Give up — user can reload the page or restart the server
          console.warn(`[nexus-ws] gave up after ${MAX_RETRIES} retries`);
          return;
        }

        // Exponential backoff: 2s, 4s, 8s, 16s, 30s, 30s, ...
        const delay = Math.min(BASE_DELAY * Math.pow(2, retriesRef.current), MAX_DELAY);
        retriesRef.current += 1;
        timerRef.current = setTimeout(connect, delay);
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
    return () => {
      unmounted = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { connected, lastMessage, subscribe };
}
