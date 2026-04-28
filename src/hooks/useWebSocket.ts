import { useState, useEffect, useRef, useCallback } from "react";

/**
 * useWebSocket.ts  —  WebSocket Client Hook (Rewritten)
 * =======================================================
 * KEY CHANGES vs original
 * ────────────────────────
 * 1. BUG FIX → INFINITE RECONNECT LOOP: `connect` was in useCallback with
 *              onTweet/onSentiment/onStats/onAlert in its deps array. These
 *              are new function references every render → connect() recreated
 *              every render → useEffect re-runs → socket reconnects endlessly.
 *              Fix: callbacks are stored in a ref (callbacksRef) so connect()
 *              has zero external deps and is stable across renders.
 *
 * 2. BUG FIX → Missing 'batch' message type — the rewritten websocket.js
 *              sends { type:'batch', topic, data:[] } instead of individual
 *              frames. Added handler that iterates data[] and calls onTweet
 *              per item, matching existing useSentimentData expectations.
 *
 * 3. CLEAN  → All returned values and signatures unchanged.
 */

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3000/ws";

export interface WebSocketMessage {
  type: "tweet" | "sentiment" | "stats" | "alert" | "batch" | "pong" | "subscribed" | "unsubscribed";
  data?: any;
  topic?: string;
  timestamp?: string;
}

interface UseWebSocketOptions {
  onTweet?:     (tweet: any)     => void;
  onSentiment?: (sentiment: any) => void;
  onStats?:     (stats: any)     => void;
  onAlert?:     (alert: any)     => void;
  autoReconnect?:     boolean;
  reconnectInterval?: number;
}

export const useWebSocket = (options: UseWebSocketOptions = {}) => {
  const {
    onTweet,
    onSentiment,
    onStats,
    onAlert,
    autoReconnect     = true,
    reconnectInterval = 3_000,
  } = options;

  const [isConnected,    setIsConnected]    = useState(false);
  const [lastMessage,    setLastMessage]    = useState<WebSocketMessage | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const wsRef                  = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef   = useRef(0);
  const subscribedTopicsRef    = useRef<Set<string>>(new Set());
  const pingIntervalRef        = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * FIX: Store callbacks in a ref so connect() doesn't need them in its
   * dependency array. This makes connect() a stable reference that never
   * triggers useEffect re-runs.
   */
  const callbacksRef = useRef({ onTweet, onSentiment, onStats, onAlert });
  useEffect(() => {
    callbacksRef.current = { onTweet, onSentiment, onStats, onAlert };
  });

  // ── connect — stable reference, zero external deps ───────────────────────
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    if (wsRef.current) wsRef.current.close();

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        setConnectionError(null);
        reconnectAttemptsRef.current = 0;

        subscribedTopicsRef.current.forEach((topic) => {
          ws.send(JSON.stringify({ action: "subscribe", topic }));
        });

        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: "ping" }));
          }
        }, 30_000);
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          setLastMessage(message);

          const { onTweet, onSentiment, onStats, onAlert } = callbacksRef.current;

          switch (message.type) {
            case "tweet":
              onTweet?.(message.data);
              break;

            case "sentiment":
              onSentiment?.(message.data);
              break;

            case "stats":
              onStats?.(message.data);
              break;

            case "alert":
              onAlert?.(message.data);
              break;

            /**
             * FIX: new batch type from websocket.js
             * data is an array — call onTweet for each item so
             * useSentimentData.handleTweet processes them individually.
             */
            case "batch":
              if (Array.isArray(message.data)) {
                message.data.forEach((item: any) => onTweet?.(item));
              }
              break;

            // pong / subscribed / unsubscribed — no action needed
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);

        if (autoReconnect) {
          reconnectAttemptsRef.current++;
          console.log(`Reconnect attempt ${reconnectAttemptsRef.current}`);
          if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
        }
      };

      ws.onerror = () => {
        setConnectionError("Connection failed");
      };
    } catch (error) {
      console.error("Failed to create WebSocket:", error);
      reconnectAttemptsRef.current++;
    }
  // FIX: empty dep array — callbacks accessed via ref, not closure capture
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    if (pingIntervalRef.current)     clearInterval(pingIntervalRef.current);
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setIsConnected(false);
    reconnectAttemptsRef.current = 0;
  }, []);

  const subscribe = useCallback((topic: string) => {
    subscribedTopicsRef.current.add(topic);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "subscribe", topic }));
    }
  }, []);

  const unsubscribe = useCallback((topic: string) => {
    subscribedTopicsRef.current.delete(topic);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "unsubscribe", topic }));
    }
  }, []);

  const send = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const forceReconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    isConnected,
    lastMessage,
    connectionError,
    subscribe,
    unsubscribe,
    send,
    connect,
    disconnect,
    forceReconnect,
  };
};