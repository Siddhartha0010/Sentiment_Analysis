import { useState, useEffect, useRef } from "react";

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
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const chartIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentTopic = useRef<string>("");

  const updateStats = (newTweet: Tweet) => {
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
        positivePercent: Math.round((positive / total) * 100),
        negativePercent: Math.round((negative / total) * 100),
        neutralPercent: Math.round((neutral / total) * 100),
      };
    });
  };

  const updateChartData = () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    
    setChartData(prev => {
      const newPoint: ChartDataPoint = {
        time: timeStr,
        positive: stats.positive,
        negative: stats.negative,
        neutral: stats.neutral,
      };
      
      const updated = [...prev, newPoint];
      return updated.slice(-10); // Keep last 10 data points
    });
  };

  const startStream = (topic: string) => {
    currentTopic.current = topic;
    setIsStreaming(true);
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

    // Add tweets at varying intervals
    intervalRef.current = setInterval(() => {
      const newTweet = generateMockTweet(currentTopic.current);
      setTweets(prev => [newTweet, ...prev].slice(0, 20)); // Keep last 20 tweets
      updateStats(newTweet);
    }, 2000 + Math.random() * 2000); // Random interval between 2-4 seconds

    // Update chart every 5 seconds
    chartIntervalRef.current = setInterval(() => {
      updateChartData();
    }, 5000);
  };

  const stopStream = () => {
    setIsStreaming(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (chartIntervalRef.current) {
      clearInterval(chartIntervalRef.current);
      chartIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (chartIntervalRef.current) clearInterval(chartIntervalRef.current);
    };
  }, []);

  return {
    stats,
    chartData,
    tweets,
    isStreaming,
    startStream,
    stopStream,
  };
};
