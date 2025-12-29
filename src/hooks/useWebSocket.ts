import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
const MAX_RECONNECT_ATTEMPTS = 3;

export interface WebSocketMessage {
  type: 'tweet' | 'sentiment' | 'stats' | 'alert' | 'pong' | 'subscribed' | 'unsubscribed';
  data?: any;
  topic?: string;
  timestamp?: string;
}

interface UseWebSocketOptions {
  onTweet?: (tweet: any) => void;
  onSentiment?: (sentiment: any) => void;
  onStats?: (stats: any) => void;
  onAlert?: (alert: any) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

export const useWebSocket = (options: UseWebSocketOptions = {}) => {
  const {
    onTweet,
    onSentiment,
    onStats,
    onAlert,
    autoReconnect = true,
    reconnectInterval = 5000,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const subscribedTopicsRef = useRef<Set<string>>(new Set());
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    // Stop if we've exceeded max attempts
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.log('Max reconnection attempts reached, switching to demo mode');
      setIsDemoMode(true);
      setConnectionError(null);
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      wsRef.current = new WebSocket(WS_URL);

      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setIsDemoMode(false);
        setConnectionError(null);
        reconnectAttemptsRef.current = 0;

        // Resubscribe to topics
        subscribedTopicsRef.current.forEach((topic) => {
          wsRef.current?.send(JSON.stringify({ action: 'subscribe', topic }));
        });

        // Start ping interval
        pingIntervalRef.current = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: 'ping' }));
          }
        }, 30000);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          setLastMessage(message);

          switch (message.type) {
            case 'tweet':
              onTweet?.(message.data);
              break;
            case 'sentiment':
              onSentiment?.(message.data);
              break;
            case 'stats':
              onStats?.(message.data);
              break;
            case 'alert':
              onAlert?.(message.data);
              break;
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);

        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }

        if (autoReconnect && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++;
          console.log(`Reconnect attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS}`);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          setIsDemoMode(true);
          setConnectionError(null);
        }
      };

      wsRef.current.onerror = () => {
        // Silently handle - onclose will trigger reconnection
        setConnectionError('Connection failed');
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      reconnectAttemptsRef.current++;
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setIsDemoMode(true);
      }
    }
  }, [onTweet, onSentiment, onStats, onAlert, autoReconnect, reconnectInterval]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    reconnectAttemptsRef.current = 0;
  }, []);

  const subscribe = useCallback((topic: string) => {
    subscribedTopicsRef.current.add(topic);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'subscribe', topic }));
    }
  }, []);

  const unsubscribe = useCallback((topic: string) => {
    subscribedTopicsRef.current.delete(topic);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'unsubscribe', topic }));
    }
  }, []);

  const send = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    isConnected,
    isDemoMode,
    lastMessage,
    connectionError,
    subscribe,
    unsubscribe,
    send,
    connect,
    disconnect,
  };
};
