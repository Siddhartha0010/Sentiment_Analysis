import { useState, useEffect, useRef, useCallback } from "react";
import { useWebSocket } from "./useWebSocket";
import * as api from "@/lib/api";
import { useToast } from "./use-toast";

interface Stats {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  positivePercent: number;
  negativePercent: number;
  neutralPercent: number;
}

interface ChartDataPoint {
  time: string;
  positive: number;
  negative: number;
  neutral: number;
}

interface Tweet {
  id: string;
  text: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  timestamp: string;
  confidence: number;
}

// Demo data for when backend is unavailable
const sampleTweets = [
  "This is absolutely amazing! Love the innovation here. #excited",
  "Disappointed with the recent changes. Not what we expected.",
  "The weather is partly cloudy today.",
  "Incredible breakthrough in technology! This will change everything.",
  "Terrible service, very frustrating experience.",
  "Just another day at work.",
  "So grateful for all the support! Best community ever.",
  "This is getting worse by the day. Unacceptable.",
  "Meeting scheduled for 3 PM tomorrow.",
  "Outstanding performance! Exceeded all expectations.",
];

const generateMockTweet = (topic: string): Tweet => {
  const sentiments: ('positive' | 'negative' | 'neutral')[] = ['positive', 'negative', 'neutral'];
  const sentiment = sentiments[Math.floor(Math.random() * sentiments.length)];
  const baseText = sampleTweets[Math.floor(Math.random() * sampleTweets.length)];
  
  return {
    id: `${Date.now()}-${Math.random()}`,
    text: `${baseText} #${topic}`,
    sentiment,
    timestamp: new Date().toLocaleTimeString(),
    confidence: 0.75 + Math.random() * 0.24,
  };
};

export const useSentimentData = () => {
  const { toast } = useToast();
  const [stats, setStats] = useState<Stats>({
    total: 0,
    positive: 0,
    negative: 0,
    neutral: 0,
    positivePercent: 0,
    negativePercent: 0,
    neutralPercent: 0,
  });
  
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const currentTopic = useRef<string>("");
  const statsPollingRef = useRef<NodeJS.Timeout | null>(null);
  const chartPollingRef = useRef<NodeJS.Timeout | null>(null);
  const demoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const demoChartIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // WebSocket handlers
  const handleTweet = useCallback((tweetData: any) => {
    if (tweetData.topic !== currentTopic.current) return;

    const newTweet: Tweet = {
      id: tweetData.tweet_id || tweetData.id || `${Date.now()}-${Math.random()}`,
      text: tweetData.tweet_text || tweetData.text,
      sentiment: tweetData.sentiment,
      timestamp: new Date(tweetData.created_at || tweetData.timestamp).toLocaleTimeString(),
      confidence: tweetData.confidence || 0.85,
    };

    setTweets(prev => [newTweet, ...prev].slice(0, 50));
    updateStatsWithTweet(newTweet);
  }, []);

  const updateStatsWithTweet = (newTweet: Tweet) => {
    setStats(prev => {
      const total = prev.total + 1;
      const positive = prev.positive + (newTweet.sentiment === 'positive' ? 1 : 0);
      const negative = prev.negative + (newTweet.sentiment === 'negative' ? 1 : 0);
      const neutral = prev.neutral + (newTweet.sentiment === 'neutral' ? 1 : 0);

      return {
        total,
        positive,
        negative,
        neutral,
        positivePercent: total > 0 ? Math.round((positive / total) * 100) : 0,
        negativePercent: total > 0 ? Math.round((negative / total) * 100) : 0,
        neutralPercent: total > 0 ? Math.round((neutral / total) * 100) : 0,
      };
    });
  };

  const handleSentiment = useCallback((sentimentData: any) => {
    if (sentimentData.topic !== currentTopic.current) return;
    
    const timeStr = new Date(sentimentData.timestamp).toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    setChartData(prev => {
      const newPoint: ChartDataPoint = {
        time: timeStr,
        positive: sentimentData.positive || 0,
        negative: sentimentData.negative || 0,
        neutral: sentimentData.neutral || 0,
      };
      
      const updated = [...prev, newPoint];
      return updated.slice(-20);
    });
  }, []);

  const handleStats = useCallback((statsData: any) => {
    if (statsData.topic !== currentTopic.current) return;
    
    const total = statsData.total_tweets || 0;
    setStats({
      total,
      positive: statsData.positive_count || 0,
      negative: statsData.negative_count || 0,
      neutral: statsData.neutral_count || 0,
      positivePercent: total > 0 ? Math.round((statsData.positive_count / total) * 100) : 0,
      negativePercent: total > 0 ? Math.round((statsData.negative_count / total) * 100) : 0,
      neutralPercent: total > 0 ? Math.round((statsData.neutral_count / total) * 100) : 0,
    });
  }, []);

  const handleAlert = useCallback((alertData: any) => {
    toast({
      title: "Sentiment Alert",
      description: alertData.message || "Significant sentiment change detected",
      variant: alertData.severity === 'high' ? 'destructive' : 'default',
    });
  }, [toast]);

  const { isConnected, isDemoMode, subscribe, unsubscribe } = useWebSocket({
    onTweet: handleTweet,
    onSentiment: handleSentiment,
    onStats: handleStats,
    onAlert: handleAlert,
  });

  // Demo mode functions
  const startDemoMode = (topic: string) => {
    // Generate mock tweets at intervals
    demoIntervalRef.current = setInterval(() => {
      const newTweet = generateMockTweet(topic);
      setTweets(prev => [newTweet, ...prev].slice(0, 50));
      updateStatsWithTweet(newTweet);
    }, 2000 + Math.random() * 2000);

    // Update chart every 5 seconds
    demoChartIntervalRef.current = setInterval(() => {
      const timeStr = new Date().toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      
      setStats(currentStats => {
        const newPoint: ChartDataPoint = {
          time: timeStr,
          positive: currentStats.positive,
          negative: currentStats.negative,
          neutral: currentStats.neutral,
        };
        
        setChartData(prev => [...prev, newPoint].slice(-20));
        
        return currentStats;
      });
    }, 5000);
  };

  const stopDemoMode = () => {
    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
    if (demoChartIntervalRef.current) {
      clearInterval(demoChartIntervalRef.current);
      demoChartIntervalRef.current = null;
    }
  };

  // Real API functions
  const fetchStats = useCallback(async (topic: string) => {
    try {
      const statsData = await api.getSentimentStats(topic);
      const total = statsData.total_tweets || 0;
      setStats({
        total,
        positive: statsData.positive_count || 0,
        negative: statsData.negative_count || 0,
        neutral: statsData.neutral_count || 0,
        positivePercent: total > 0 ? Math.round((statsData.positive_count / total) * 100) : 0,
        negativePercent: total > 0 ? Math.round((statsData.negative_count / total) * 100) : 0,
        neutralPercent: total > 0 ? Math.round((statsData.neutral_count / total) * 100) : 0,
      });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  }, []);

  const fetchTemporalData = useCallback(async (topic: string) => {
    try {
      const temporal = await api.getTemporalSentiment(topic, '5m', 20);
      const chartPoints: ChartDataPoint[] = temporal.map(point => ({
        time: new Date(point.time_bucket).toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        positive: point.positive,
        negative: point.negative,
        neutral: point.neutral,
      }));
      setChartData(chartPoints);
    } catch (error) {
      console.error('Failed to fetch temporal data:', error);
    }
  }, []);

  const fetchRecentTweets = useCallback(async (topic: string) => {
    try {
      const recentTweets = await api.getRecentTweets(topic, 20);
      const formattedTweets: Tweet[] = recentTweets.map(tweet => ({
        id: tweet.id,
        text: tweet.text,
        sentiment: tweet.sentiment,
        timestamp: new Date(tweet.timestamp).toLocaleTimeString(),
        confidence: tweet.confidence,
      }));
      setTweets(formattedTweets);
    } catch (error) {
      console.error('Failed to fetch recent tweets:', error);
    }
  }, []);

  const startStream = async (topic: string) => {
    setIsLoading(true);
    currentTopic.current = topic;

    // Reset state
    setStats({
      total: 0,
      positive: 0,
      negative: 0,
      neutral: 0,
      positivePercent: 0,
      negativePercent: 0,
      neutralPercent: 0,
    });
    setChartData([]);
    setTweets([]);

    // Check if we should use demo mode
    if (isDemoMode) {
      setIsStreaming(true);
      startDemoMode(topic);
      toast({
        title: "Demo Mode Active",
        description: `Showing simulated data for "${topic}". Deploy backend for live data.`,
      });
      setIsLoading(false);
      return;
    }

    try {
      // Try to start backend stream
      await api.startStream(topic);
      
      // Subscribe to WebSocket topic
      subscribe(topic);
      
      // Fetch initial data
      await Promise.all([
        fetchStats(topic),
        fetchTemporalData(topic),
        fetchRecentTweets(topic),
      ]);
      
      setIsStreaming(true);

      // Set up polling as backup
      statsPollingRef.current = setInterval(() => fetchStats(topic), 10000);
      chartPollingRef.current = setInterval(() => fetchTemporalData(topic), 5000);

      toast({
        title: "Stream Started",
        description: `Now tracking sentiment for "${topic}"`,
      });
    } catch (error: any) {
      console.error('Failed to start stream:', error);
      
      // Fall back to demo mode
      setIsStreaming(true);
      startDemoMode(topic);
      toast({
        title: "Demo Mode Active",
        description: `Backend unavailable. Showing simulated data for "${topic}".`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const stopStream = async () => {
    setIsLoading(true);

    // Stop demo mode if active
    stopDemoMode();

    try {
      if (!isDemoMode) {
        await api.stopStream();
      }
      
      // Unsubscribe from WebSocket topic
      if (currentTopic.current) {
        unsubscribe(currentTopic.current);
      }
      
      // Clear polling intervals
      if (statsPollingRef.current) {
        clearInterval(statsPollingRef.current);
        statsPollingRef.current = null;
      }
      if (chartPollingRef.current) {
        clearInterval(chartPollingRef.current);
        chartPollingRef.current = null;
      }

      setIsStreaming(false);

      toast({
        title: "Stream Stopped",
        description: `Stopped tracking "${currentTopic.current}"`,
      });
    } catch (error: any) {
      console.error('Failed to stop stream:', error);
      setIsStreaming(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopDemoMode();
      if (statsPollingRef.current) clearInterval(statsPollingRef.current);
      if (chartPollingRef.current) clearInterval(chartPollingRef.current);
      if (currentTopic.current) {
        unsubscribe(currentTopic.current);
      }
    };
  }, [unsubscribe]);

  return {
    stats,
    chartData,
    tweets,
    isStreaming,
    isLoading,
    isConnected: isConnected || isDemoMode,
    isDemoMode,
    startStream,
    stopStream,
  };
};
