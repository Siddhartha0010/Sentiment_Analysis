const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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
  /** ISO time string or bucket label from the API */
  time_bucket: string;
  positive: number;
  negative: number;
  neutral: number;
  total?: number;
}

export interface Tweet {
  id: string;
  text: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  timestamp: string;
  confidence: number;
  topic?: string;
  publishedAt?: string;
  processedAt?: string;
  reasonKeywords?: string[];
  sentimentReason?: string;
   /** Explainable sentiment words (alias over reasonKeywords) */
  explanation?: string[];
}

export interface StreamStatus {
  isStreaming: boolean;
  topic: string | null;
  feedCount?: number;
}

export const startStream = async (
  topic: string,
  feedUrls?: string[]
): Promise<{ success: boolean; topic?: string; message?: string }> => {
  const response = await fetch(`${API_BASE_URL}/api/stream/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, feedUrls }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start stream');
  }
  return response.json();
};

export const stopStream = async (): Promise<{ success: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/api/stream/stop`, { method: 'POST' });
  if (!response.ok) throw new Error('Failed to stop stream');
  return response.json();
};

export const getStreamStatus = async (): Promise<StreamStatus> => {
  const response = await fetch(`${API_BASE_URL}/api/stream/status`);
  if (!response.ok) throw new Error('Failed to get stream status');
  return response.json();
};

/**
 * Get sentiment stats for a topic.
 * timeRange must be passed so the cache key in api.js / cache.js is correct.
 * Defaults to '1h' (matches the dashboard default view).
 */
export const getSentimentStats = async (
  topic: string,
  timeRange: string = '1h'
): Promise<ApiStats> => {
  const params = new URLSearchParams({ timeRange });
  const response = await fetch(
    `${API_BASE_URL}/api/sentiment/stats/${encodeURIComponent(topic)}?${params}`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch sentiment stats');
  }
  return response.json();
};

/**
 * Get temporal sentiment data.
 * Backend returns { topic, timeRange, interval, data: [...] }
 */
export const getTemporalSentiment = async (
  topic: string,
  timeRange: string = '1h',
  interval: string = '1m'
): Promise<TemporalDataPoint[]> => {
  const params = new URLSearchParams({ timeRange, interval });
  const response = await fetch(
    `${API_BASE_URL}/api/sentiment/temporal/${encodeURIComponent(topic)}?${params}`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch temporal sentiment');
  }
  const body = await response.json();
  const rows = Array.isArray(body) ? body : body.data || [];
  return rows.map((point: Record<string, unknown>) => {
    const t = (point.time ?? point.time_bucket) as string;
    return {
      time_bucket: t,
      positive: Number(point.positive) || 0,
      negative: Number(point.negative) || 0,
      neutral:  Number(point.neutral)  || 0,
      total:    typeof point.total === 'number' ? point.total : undefined,
    };
  });
};

/**
 * Get recent tweets / headlines for a topic.
 * limit is passed as a query param so cache.js generates a unique key per limit.
 */
export const getRecentTweets = async (
  topic: string,
  limit: number = 20
): Promise<Tweet[]> => {
  const params = new URLSearchParams({ limit: limit.toString() });
  const response = await fetch(
    `${API_BASE_URL}/api/tweets/${encodeURIComponent(topic)}?${params}`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch recent tweets');
  }
  const data = await response.json();
  const list = Array.isArray(data) ? data : data.tweets || [];
  return list.map((tweet: Record<string, unknown>) => ({
    id:         (tweet.tweet_id  ?? tweet.id)        as string,
    text:       (tweet.tweet_text ?? tweet.text)      as string,
    sentiment:  tweet.sentiment                        as Tweet['sentiment'],
    timestamp:  (tweet.created_at ?? tweet.timestamp) as string,
    confidence: tweet.confidence                       as number,
    topic:      tweet.topic                            as string | undefined,
    publishedAt: (tweet.published_at ?? tweet.created_at) as string | undefined,
    processedAt: (tweet.processed_at as string | undefined),
    reasonKeywords: (tweet.reason_keywords as string[] | undefined),
    explanation:
      (tweet.explanation as string[] | undefined) ??
      (tweet.reason_keywords as string[] | undefined),
    sentimentReason: (tweet.sentiment_reason as string | undefined),
  }));
};

/**
 * Get trending topics.
 * Backend returns { topics: [...] } with tweet_count per row.
 */
export const getTrendingTopics = async (
  limit: number = 10
): Promise<{ topic: string; count: number }[]> => {
  const params = new URLSearchParams({ limit: limit.toString() });
  const response = await fetch(`${API_BASE_URL}/api/trending?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch trending topics');
  }
  const body = await response.json();
  const rows = body.topics ?? body;
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row: { topic?: string; tweet_count?: number; count?: number }) => ({
    topic: row.topic ?? '',
    count: row.tweet_count ?? row.count ?? 0,
  }));
};

/**
 * Get system status.
 * Cached for 5 seconds server-side (api.js), so calling this on every
 * dashboard heartbeat is safe.
 */
export const getSystemStatus = async (): Promise<{
  database: boolean;
  cache: boolean;
  kafka: boolean;
  websocket: { connections: number };
}> => {
  const response = await fetch(`${API_BASE_URL}/api/status`);
  if (!response.ok) {
    throw new Error('Failed to fetch system status');
  }
  return response.json();
};

export interface TopicInsightKeyword {
  word: string;
  count: number;
}

/** Rolling-window keywords + last spike message (lightweight GET) */
export const getTopicInsights = async (
  topic: string
): Promise<{ topic: string; topKeywords: TopicInsightKeyword[]; latestAlert: string | null }> => {
  const response = await fetch(
    `${API_BASE_URL}/api/insights/${encodeURIComponent(topic)}`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch topic insights');
  }
  return response.json();
};