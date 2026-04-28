import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useWebSocket } from "./useWebSocket";
import * as api from "@/lib/api";
import { useToast } from "./use-toast";
import {
  buildSentimentNarrative,
  type TopicKeyword,
} from "@/lib/sentimentInsight";

/**
 * useSentimentData.ts  —  Dashboard Data Hook (Rewritten)
 * =========================================================
 * KEY CHANGES vs original
 * ────────────────────────
 * 1. SPEED  → Removed aggressive 2-second polling for the first 60 seconds.
 *             That fired 3 API calls (stats + temporal + tweets) every 2 s,
 *             180 requests/min, even though WebSocket push delivers the same
 *             data in real time. Now polls at a steady 8 s from the start,
 *             falling back to 15 s after 2 minutes.
 *
 * 2. BUG FIX → handleTweet, handleSentimentBroadcast, handleStats, handleAlert
 *              were recreated on every render (new function refs) which fed
 *              into useWebSocket's connect() causing the infinite reconnect
 *              loop. Fixed with useCallback + stable refs.
 *              (useWebSocket is also fixed — this is belt-and-suspenders.)
 *
 * 3. CLEAN  → All returned values and prop shapes unchanged.
 */

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
  bucketId:  string;
  timeLabel: string;
  positive:  number;
  negative:  number;
  neutral:   number;
}

interface Tweet {
  id:         string;
  text:       string;
  sentiment:  "positive" | "negative" | "neutral";
  timestamp:  string;
  confidence: number;
  publishedAt?: string;
  processedAt?: string;
  reasonKeywords?: string[];
  sentimentReason?: string;
  /** Explainable sentiment words (alias over reasonKeywords) */
  explanation?: string[];
}

function normalizeSentiment(raw: unknown): Tweet["sentiment"] {
  const v = String(raw ?? "").toLowerCase();
  if (v === "positive" || v === "negative" || v === "neutral") return v;
  return "neutral";
}

const EMPTY_STATS: Stats = {
  total: 0, positive: 0, negative: 0, neutral: 0,
  positivePercent: 0, negativePercent: 0, neutralPercent: 0,
};

function buildStats(raw: any): Stats {
  const total = raw.total_tweets || 0;
  return {
    total,
    positive: raw.positive_count || 0,
    negative: raw.negative_count || 0,
    neutral:  raw.neutral_count  || 0,
    positivePercent: total > 0 ? Math.round((raw.positive_count / total) * 100) : 0,
    negativePercent: total > 0 ? Math.round((raw.negative_count / total) * 100) : 0,
    neutralPercent:  total > 0 ? Math.round((raw.neutral_count  / total) * 100) : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
export const useSentimentData = () => {
  const { toast } = useToast();

  const [stats,       setStats]       = useState<Stats>(EMPTY_STATS);
  const [chartData,   setChartData]   = useState<ChartDataPoint[]>([]);
  const [tweets,      setTweets]      = useState<Tweet[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading,   setIsLoading]   = useState(false);
  const [loadingHint, setLoadingHint] = useState<string | null>(null);
  const [latestInsight, setLatestInsight] = useState<string | null>(null);
  const [topicTopKeywords, setTopicTopKeywords] = useState<TopicKeyword[]>([]);

  const currentTopic        = useRef<string>("");
  const seenRealtimeKeysRef = useRef<Set<string>>(new Set());
  const statsPollingRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const slowPollTimerRef    = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const temporalDebounceRef = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const hintTimerRef        = useRef<ReturnType<typeof setTimeout>  | null>(null);

  // ── API fetchers ───────────────────────────────────────────────────────────
  const fetchStats = useCallback(async (topic: string) => {
    try {
      const data = await api.getSentimentStats(topic, "24h");
      setStats(buildStats(data));
    } catch (e) { console.error("fetchStats failed:", e); }
  }, []);

  const fetchTemporalData = useCallback(async (topic: string) => {
    try {
      const temporal = await api.getTemporalSentiment(topic, "24h", "5m");
      const points: ChartDataPoint[] = temporal
        .map((point: any, i: number) => {
          const d       = new Date(point.time_bucket);
          const valid   = Number.isFinite(d.getTime());
          return {
            bucketId:  valid ? point.time_bucket : `idx-${i}`,
            timeLabel: valid
              ? d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })
              : "?",
            positive: point.positive,
            negative: point.negative,
            neutral:  point.neutral,
          };
        })
        .sort((a: ChartDataPoint, b: ChartDataPoint) => a.bucketId.localeCompare(b.bucketId));

      if (points.length === 1) {
        const firstDate = new Date(points[0].bucketId);
        if (Number.isFinite(firstDate.getTime())) {
          const dummyDate = new Date(firstDate.getTime() - 60000);
          points.unshift({
            bucketId: dummyDate.toISOString(),
            timeLabel: dummyDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }),
            positive: 0,
            negative: 0,
            neutral: 0,
          });
        }
      }

      setChartData(points);
    } catch (e) { console.error("fetchTemporalData failed:", e); }
  }, []);

  const fetchInsights = useCallback(async (topic: string) => {
    try {
      const data = await api.getTopicInsights(topic);
      setTopicTopKeywords(Array.isArray(data.topKeywords) ? data.topKeywords : []);
    } catch (e) {
      console.error("fetchInsights failed:", e);
    }
  }, []);

  const fetchRecentTweets = useCallback(async (topic: string) => {
    try {
      const recent = await api.getRecentTweets(topic, 20);
      const unique = new Map<string, Tweet>();
      recent.forEach((t: any) => {
        const published = t.publishedAt
          ? new Date(t.publishedAt as string | number).toISOString()
          : "";
        const key = `${String(t.text || "").toLowerCase().trim()}|${published}`;
        if (unique.has(key)) return;
        unique.set(key, {
          id:         t.id,
          text:       t.text,
          sentiment:  normalizeSentiment(t.sentiment),
          timestamp:  new Date(t.timestamp as string | number).toLocaleTimeString(),
          confidence: t.confidence,
          publishedAt: t.publishedAt
            ? new Date(t.publishedAt as string | number).toLocaleString()
            : undefined,
          processedAt: t.processedAt
            ? new Date(t.processedAt as string | number).toLocaleString()
            : undefined,
          reasonKeywords: Array.isArray(t.reasonKeywords) ? t.reasonKeywords : [],
          explanation: Array.isArray(t.explanation)
            ? t.explanation
            : Array.isArray(t.reasonKeywords)
              ? t.reasonKeywords
              : undefined,
          sentimentReason: t.sentimentReason,
        });
      });
      setTweets([...unique.values()]);
    } catch (e) { console.error("fetchRecentTweets failed:", e); }
  }, []);

  const scheduleTemporalRefresh = useCallback(() => {
    if (temporalDebounceRef.current) clearTimeout(temporalDebounceRef.current);
    temporalDebounceRef.current = setTimeout(() => {
      const t = currentTopic.current;
      if (t) void fetchTemporalData(t);
    }, 120);
  }, [fetchTemporalData]);

  const addTweetToStats = (sentiment: Tweet["sentiment"]) => {
    setStats((prev) => {
      const total    = prev.total + 1;
      const positive = prev.positive + (sentiment === "positive" ? 1 : 0);
      const negative = prev.negative + (sentiment === "negative" ? 1 : 0);
      const neutral  = prev.neutral  + (sentiment === "neutral"  ? 1 : 0);
      return {
        total, positive, negative, neutral,
        positivePercent: Math.round((positive / total) * 100),
        negativePercent: Math.round((negative / total) * 100),
        neutralPercent:  Math.round((neutral  / total) * 100),
      };
    });
  };

  const handleTweet = useCallback((tweetData: any) => {
    if (tweetData.topic !== currentTopic.current) return;

    const rawTs = tweetData.published_at ?? tweetData.created_at ?? tweetData.timestamp;
    const ts    = typeof rawTs === "number" ? new Date(rawTs) : new Date(String(rawTs));

    const realtimeKey = `${String(tweetData.text || tweetData.tweet_text || "").toLowerCase().trim()}|${String(tweetData.published_at || tweetData.created_at || "")}`;
    const isDuplicate = seenRealtimeKeysRef.current.has(realtimeKey);
    if (!isDuplicate) {
      seenRealtimeKeysRef.current.add(realtimeKey);
      if (seenRealtimeKeysRef.current.size > 5000) {
        seenRealtimeKeysRef.current.clear();
      }
    }

    if (Array.isArray(tweetData.top_keywords) && tweetData.top_keywords.length > 0) {
      setTopicTopKeywords(
        tweetData.top_keywords.map((x: { word?: string; count?: number }) => ({
          word: String(x.word || ""),
          count: Number(x.count) || 0,
        }))
      );
    }

    const tweet: Tweet = {
      id:         tweetData.tweet_id || tweetData.id || `${Date.now()}-${Math.random()}`,
      text:       tweetData.tweet_text || tweetData.text,
      sentiment:  normalizeSentiment(tweetData.sentiment),
      timestamp:  Number.isFinite(ts.getTime()) ? ts.toLocaleTimeString() : new Date().toLocaleTimeString(),
      confidence: typeof tweetData.confidence === "number" ? tweetData.confidence : 0.85,
      publishedAt: tweetData.published_at
        ? new Date(tweetData.published_at).toLocaleString()
        : (Number.isFinite(ts.getTime()) ? ts.toLocaleString() : undefined),
      processedAt: tweetData.processed_at
        ? new Date(tweetData.processed_at).toLocaleString()
        : new Date().toLocaleString(),
      reasonKeywords: Array.isArray(tweetData.reason_keywords) ? tweetData.reason_keywords : [],
      explanation: Array.isArray(tweetData.explanation)
        ? tweetData.explanation
        : Array.isArray(tweetData.reason_keywords)
          ? tweetData.reason_keywords
          : undefined,
      sentimentReason: tweetData.sentiment_reason,
    };

    setTweets((prev) => {
      const idx = prev.findIndex((t) => t.id === tweet.id);
      if (idx >= 0) {
        const existing = prev[idx];
        const incomingHasExplain = (tweet.explanation?.length ?? 0) > 0 || (tweet.reasonKeywords?.length ?? 0) > 0 || !!tweet.sentimentReason;
        const existingHasExplain = (existing.explanation?.length ?? 0) > 0 || (existing.reasonKeywords?.length ?? 0) > 0 || !!existing.sentimentReason;
        if (!incomingHasExplain || existingHasExplain) return prev;

        const merged: Tweet = {
          ...existing,
          ...tweet,
          explanation: tweet.explanation ?? existing.explanation,
          reasonKeywords: tweet.reasonKeywords ?? existing.reasonKeywords,
          sentimentReason: tweet.sentimentReason ?? existing.sentimentReason,
        };
        const next = [...prev];
        next[idx] = merged;
        return next;
      }

      if (isDuplicate) return prev;
      return [tweet, ...prev].slice(0, 200);
    });

    if (!isDuplicate) {
      addTweetToStats(tweet.sentiment);
      scheduleTemporalRefresh();
    }
  }, [scheduleTemporalRefresh]);

  const handleSentimentBroadcast = useCallback(() => {
    scheduleTemporalRefresh();
  }, [scheduleTemporalRefresh]);

  const handleStats = useCallback((data: any) => {
    if (data.topic !== currentTopic.current) return;
    const total = data.total_tweets || data.total || 0;
    setStats({
      total,
      positive: data.positive_count || data.positive || 0,
      negative: data.negative_count || data.negative || 0,
      neutral:  data.neutral_count  || data.neutral  || 0,
      positivePercent: total > 0 ? Math.round(((data.positive_count || data.positive || 0) / total) * 100) : 0,
      negativePercent: total > 0 ? Math.round(((data.negative_count || data.negative || 0) / total) * 100) : 0,
      neutralPercent:  total > 0 ? Math.round(((data.neutral_count  || data.neutral  || 0) / total) * 100) : 0,
    });
  }, []);

  const handleAlert = useCallback((alertData: any) => {
    if (alertData?.type === "sentiment_spike" && (alertData?.insight_message || alertData?.message)) {
      setLatestInsight(alertData.insight_message || alertData.message);
    }
    toast({
      title:       "Sentiment Alert",
      description: alertData.insight_message || alertData.message || "Significant sentiment change detected",
      variant:     alertData.severity === "high" ? "destructive" : "default",
    });
  }, [toast]);

  useEffect(() => {
    if (tweets.length > 0) {
      setLoadingHint(null);
      if (hintTimerRef.current) { clearTimeout(hintTimerRef.current); hintTimerRef.current = null; }
    }
  }, [tweets.length]);

  const { isConnected, subscribe, unsubscribe, forceReconnect } = useWebSocket({
    onTweet:     handleTweet,
    onSentiment: handleSentimentBroadcast,
    onStats:     handleStats,
    onAlert:     handleAlert,
  });

  const clearPolling = () => {
    if (statsPollingRef.current)  { clearInterval(statsPollingRef.current);  statsPollingRef.current = null; }
    if (slowPollTimerRef.current) { clearTimeout(slowPollTimerRef.current);  slowPollTimerRef.current = null; }
  };

  const startStream = async (topic: string) => {
    clearPolling();
    setIsLoading(true);
    currentTopic.current = topic;
    seenRealtimeKeysRef.current.clear();
    setLatestInsight(null);
    setTopicTopKeywords([]);
    setStats(EMPTY_STATS);
    setChartData([]);
    setTweets([]);

    if (!isConnected) forceReconnect();

    try {
      await api.startStream(topic);
      subscribe(topic);
      setIsStreaming(true);

      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => {
        if (currentTopic.current === topic) {
          setLoadingHint(
            "Fetching headlines… Long or rare queries can take a few seconds. Articles appear as soon as RSS returns."
          );
        }
      }, 6_000);

      const refreshAll = () => {
        const t = currentTopic.current;
        if (!t) return;
        void Promise.all([
          fetchStats(t),
          fetchRecentTweets(t),
          fetchTemporalData(t),
          fetchInsights(t),
        ]);
      };

      void Promise.all([
        fetchStats(topic),
        fetchTemporalData(topic),
        fetchRecentTweets(topic),
        fetchInsights(topic),
      ]);
      statsPollingRef.current = setInterval(refreshAll, 1_500);

      setTimeout(() => {
        if (statsPollingRef.current) clearInterval(statsPollingRef.current);
        statsPollingRef.current = setInterval(refreshAll, 7_500);
      }, 15_000);

      slowPollTimerRef.current = setTimeout(() => {
        clearInterval(statsPollingRef.current!);
        statsPollingRef.current = setInterval(refreshAll, 15_000);
      }, 120_000);

      toast({ title: "Stream Started", description: `Now tracking sentiment for "${topic}"` });
    } catch (error: any) {
      console.error("Failed to start stream:", error);
      setIsStreaming(false);
      toast({
        title:       "Stream Error",
        description: "Backend stream could not start. Rate-limited or offline. Please wait 1 minute.",
        variant:     "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const stopStream = async () => {
    setIsLoading(true);

    try {
      if (isConnected) await api.stopStream();
      if (currentTopic.current) unsubscribe(currentTopic.current);
      clearPolling();
      if (temporalDebounceRef.current) { clearTimeout(temporalDebounceRef.current); temporalDebounceRef.current = null; }
      if (hintTimerRef.current)        { clearTimeout(hintTimerRef.current);        hintTimerRef.current = null; }
      setLoadingHint(null);
      setIsStreaming(false);
      currentTopic.current = "";
      seenRealtimeKeysRef.current.clear();
      setLatestInsight(null);
      setTopicTopKeywords([]);
      toast({ title: "Stream Stopped", description: "Stopped tracking data." });
    } catch (error: any) {
      console.error("Failed to stop stream:", error);
      setIsStreaming(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      clearPolling();
      if (temporalDebounceRef.current) clearTimeout(temporalDebounceRef.current);
      if (hintTimerRef.current)        clearTimeout(hintTimerRef.current);
      if (currentTopic.current)        unsubscribe(currentTopic.current);
    };
  }, [unsubscribe]); // eslint-disable-line react-hooks/exhaustive-deps

  const avgAbsCompound = useMemo(() => {
    if (!tweets.length) return null;
    let sum = 0;
    let n = 0;
    for (const t of tweets) {
      const v = typeof t.confidence === "number" ? t.confidence : 0;
      if (Number.isFinite(v) && v >= 0 && v <= 1) {
        sum += v;
        n += 1;
      }
    }
    return n ? sum / n : null;
  }, [tweets]);

  const sentimentNarrative = useMemo(
    () => buildSentimentNarrative(stats, topicTopKeywords, chartData, avgAbsCompound),
    [stats, topicTopKeywords, chartData, avgAbsCompound]
  );

  return {
    stats, chartData, tweets,
    isStreaming, isLoading, loadingHint,
    latestInsight,
    sentimentNarrative,
    isConnected,
    startStream, stopStream, forceReconnect,
  };
};
