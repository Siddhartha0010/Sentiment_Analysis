const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface ApiStats {
  topic: string;
  total_tweets: number;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  avg_confidence: number;
  last_updated: string;
}

export interface TemporalDataPoint {
  time_bucket: string;
  positive: number;
  negative: number;
  neutral: number;
  total: number;
}

export interface Tweet {
  id: string;
  text: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  timestamp: string;
  confidence: number;
  topic?: string;
}

export interface StreamStatus {
  status: 'streaming' | 'stopped';
  topic: string | null;
  ruleId: string | null;
  tweetCount: number;
}

// Start streaming for a topic
export const startStream = async (topic: string): Promise<{ success: boolean; ruleId?: string; message?: string }> => {
  const response = await fetch(`${API_BASE_URL}/api/stream/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start stream');
  }
  
  return response.json();
};

// Stop streaming
export const stopStream = async (): Promise<{ success: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/api/stream/stop`, {
    method: 'POST',
  });
  
  if (!response.ok) {
    throw new Error('Failed to stop stream');
  }
  
  return response.json();
};

// Get stream status
export const getStreamStatus = async (): Promise<StreamStatus> => {
  const response = await fetch(`${API_BASE_URL}/api/stream/status`);
  
  if (!response.ok) {
    throw new Error('Failed to get stream status');
  }
  
  return response.json();
};

// Get sentiment stats for a topic
export const getSentimentStats = async (topic: string): Promise<ApiStats> => {
  const response = await fetch(`${API_BASE_URL}/api/sentiment/stats/${encodeURIComponent(topic)}`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch sentiment stats');
  }
  
  return response.json();
};

// Get temporal sentiment data
export const getTemporalSentiment = async (
  topic: string,
  interval: string = '5m',
  limit: number = 20
): Promise<TemporalDataPoint[]> => {
  const params = new URLSearchParams({ interval, limit: limit.toString() });
  const response = await fetch(
    `${API_BASE_URL}/api/sentiment/temporal/${encodeURIComponent(topic)}?${params}`
  );
  
  if (!response.ok) {
    throw new Error('Failed to fetch temporal sentiment');
  }
  
  return response.json();
};

// Get recent tweets for a topic
export const getRecentTweets = async (topic: string, limit: number = 20): Promise<Tweet[]> => {
  const params = new URLSearchParams({ limit: limit.toString() });
  const response = await fetch(
    `${API_BASE_URL}/api/tweets/${encodeURIComponent(topic)}?${params}`
  );
  
  if (!response.ok) {
    throw new Error('Failed to fetch recent tweets');
  }
  
  const data = await response.json();
  return data.map((tweet: any) => ({
    id: tweet.tweet_id || tweet.id,
    text: tweet.tweet_text || tweet.text,
    sentiment: tweet.sentiment,
    timestamp: tweet.created_at || tweet.timestamp,
    confidence: tweet.confidence,
    topic: tweet.topic,
  }));
};

// Get trending topics
export const getTrendingTopics = async (limit: number = 10): Promise<{ topic: string; count: number }[]> => {
  const params = new URLSearchParams({ limit: limit.toString() });
  const response = await fetch(`${API_BASE_URL}/api/trending?${params}`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch trending topics');
  }
  
  return response.json();
};

// Search tweets
export const searchTweets = async (
  query: string,
  options: { sentiment?: string; limit?: number; offset?: number } = {}
): Promise<Tweet[]> => {
  const params = new URLSearchParams({ q: query });
  if (options.sentiment) params.append('sentiment', options.sentiment);
  if (options.limit) params.append('limit', options.limit.toString());
  if (options.offset) params.append('offset', options.offset.toString());
  
  const response = await fetch(`${API_BASE_URL}/api/search?${params}`);
  
  if (!response.ok) {
    throw new Error('Failed to search tweets');
  }
  
  return response.json();
};

// Get system status
export const getSystemStatus = async (): Promise<{
  database: boolean;
  cache: boolean;
  kafka: boolean;
  twitter: boolean;
  websocket: { connections: number };
}> => {
  const response = await fetch(`${API_BASE_URL}/api/status`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch system status');
  }
  
  return response.json();
};
