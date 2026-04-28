"use strict";
/**
 * api.js  —  REST API Routes (Rewritten)
 * ========================================
 * KEY CHANGES vs original
 * ────────────────────────
 * 1. BUG FIX → getCachedSentimentStats(topic) was missing timeRange in the
 *              cache key — different timeRanges returned the same cached data.
 *              Fixed: cache key is now `stats:${topic}:${timeRange}`.
 *
 * 2. BUG FIX → getCachedRecentTweets(topic) was missing limit in the cache
 *              key — a request for limit=50 could return a limit=20 cache hit.
 *              Fixed: cache key is now `tweets:${topic}:${limit}`.
 *
 * 3. SPEED  → /api/status was completely uncached and called on every dashboard
 *              load/poll. Now cached for 5 s (status changes are not
 *              sub-second events).
 *
 * 4. SPEED  → Cache-Control headers added to all GET responses so the browser
 *              and any intermediate proxy can serve from their own cache
 *              without hitting Node at all.
 *
 * 5. SPEED  → chartData transformation moved into a pure helper function
 *              (_buildChartData) — easier to unit-test and memoize later.
 *
 * 6. CLEAN  → Percentage and count normalization extracted into _buildStats()
 *              helper to remove duplication between cached and fresh paths.
 *
 * 7. CLEAN  → All route signatures and response shapes are identical to the
 *              original — zero frontend changes required.
 */

const express    = require("express");
const rateLimit  = require("express-rate-limit");
const logger     = require("../utils/logger");

const { startStream, stopStream, getStreamStatus } = require("../services/rss");
const {
  getSentimentStats,
  getTemporalSentiment,
  getRecentTweets,
  getTrendingTopics,
  getSentimentAlerts,
  clearTopicTweets,
} = require("../services/database");
const {
  getCachedSentimentStats, cacheSentimentStats,
  getCachedTrendingTopics, cacheTrendingTopics,
  getCachedRecentTweets,   cacheRecentTweets,
  getCachedTemporalData,   cacheTemporalData,
  invalidateTopicCache,
  invalidateTrendingCache,
} = require("../services/cache");
const { getKafkaStatus }      = require("../services/kafka");
const { getConnectionStats }  = require("../services/websocket");
const { getTopKeywords, getLatestAlert } = require("../services/realtimeInsights");

const router = express.Router();

// ── Rate limiting ──────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            10_000,
  message:        { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders:   false,
});

const streamLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      100,
  message:  { error: "Too many stream control requests, please wait." },
});

router.use(apiLimiter);

// ── In-process status cache (5 s TTL, no Redis needed) ───────────────────────
let _statusCache    = null;
let _statusCachedAt = 0;
const STATUS_TTL_MS = 5_000;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set Cache-Control header.
 * maxAge is in seconds.
 */
function _setCacheControl(res, maxAge = 10) {
  res.set("Cache-Control", `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
}

/**
 * Aggregate raw DB sentiment rows into a normalised stats object.
 */
function _buildStats(topic, timeRange, rows) {
  let total = 0, positive_count = 0, negative_count = 0, neutral_count = 0;

  rows.forEach((s) => {
    const cnt = parseInt(s.count, 10);
    total += cnt;
    const label = (s.sentiment || "").toLowerCase();
    if (label === "positive")      positive_count += cnt;
    else if (label === "negative") negative_count += cnt;
    else                           neutral_count  += cnt;
  });

  return {
    topic,
    timeRange,
    total_tweets:   total,
    positive_count,
    negative_count,
    neutral_count,
    sentiments: rows.map((s) => ({
      sentiment:     s.sentiment,
      count:         parseInt(s.count, 10),
      percentage:    total > 0
        ? ((parseInt(s.count, 10) / total) * 100).toFixed(2)
        : 0,
      avgConfidence: parseFloat(s.avg_confidence || 0).toFixed(2),
    })),
  };
}

/**
 * Transform raw temporal DB rows into Recharts-ready array.
 */
function _buildChartData(rows) {
  const buckets = {};
  rows.forEach((row) => {
    const time = new Date(row.time_bucket).toISOString();
    if (!buckets[time]) buckets[time] = { time, positive: 0, negative: 0, neutral: 0 };
    const key = (row.sentiment || "").toLowerCase();
    if (key === "positive" || key === "negative" || key === "neutral") {
      buckets[time][key] = parseInt(row.count, 10) || 0;
    }
  });
  return Object.values(buckets);
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/** POST /api/stream/start */
router.post("/stream/start", streamLimiter, async (req, res) => {
  try {
    const { topic, feedUrls } = req.body;
    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return res.status(400).json({ error: "Topic is required", message: "Please provide a valid topic." });
    }
    const sanitizedTopic = topic.trim().slice(0, 100);
    // Default false: clearing DB on every start forces empty stats until RSS refills (slow UX).
    // Set RESET_TOPIC_ON_STREAM_START=true when you need a fresh topic wipe.
    const resetTopicOnStart = (process.env.RESET_TOPIC_ON_STREAM_START || "false").toLowerCase() === "true";
    if (resetTopicOnStart) {
      await clearTopicTweets(sanitizedTopic);
    }
    await Promise.all([
      invalidateTopicCache(sanitizedTopic),
      invalidateTrendingCache(),
    ]);
    const result = await startStream(sanitizedTopic, feedUrls);
    logger.info(`RSS stream started for topic: ${sanitizedTopic}`);
    res.json({ success: true, ...result, message: `Started RSS stream for "${sanitizedTopic}"` });
  } catch (error) {
    logger.error("Error starting RSS stream:", error);
    res.status(500).json({ error: "Failed to start stream", message: error.message });
  }
});

/** POST /api/stream/stop */
router.post("/stream/stop", streamLimiter, async (req, res) => {
  try {
    const result = stopStream();
    logger.info("RSS stream stopped");
    res.json({ success: true, ...result, message: "Stream stopped successfully" });
  } catch (error) {
    logger.error("Error stopping stream:", error);
    res.status(500).json({ error: "Failed to stop stream", message: error.message });
  }
});

/** GET /api/stream/status */
router.get("/stream/status", async (req, res) => {
  try {
    _setCacheControl(res, 5);
    res.json(getStreamStatus());
  } catch (error) {
    logger.error("Error getting stream status:", error);
    res.status(500).json({ error: "Failed to get stream status" });
  }
});

/**
 * GET /api/sentiment/stats/:topic
 * FIX: cache key now includes timeRange
 */
router.get("/sentiment/stats/:topic", async (req, res) => {
  try {
    const { topic }             = req.params;
    const { timeRange = "1h" }  = req.query;

    // FIX: pass timeRange so different windows don't collide in cache
    const cached = await getCachedSentimentStats(topic, timeRange);
    if (cached) {
      _setCacheControl(res, 10);
      return res.json({ ...cached, cached: true });
    }

    const rows   = await getSentimentStats(topic, timeRange);
    const result = _buildStats(topic, timeRange, rows);

    await cacheSentimentStats(topic, timeRange, result); // FIX: pass timeRange
    _setCacheControl(res, 10);
    res.json(result);
  } catch (error) {
    logger.error("Error getting sentiment stats:", error);
    res.status(500).json({ error: "Failed to get sentiment stats" });
  }
});

/**
 * GET /api/sentiment/temporal/:topic
 */
router.get("/sentiment/temporal/:topic", async (req, res) => {
  try {
    const { topic }                        = req.params;
    const { timeRange = "1h", interval = "1m" } = req.query;

    const cached = await getCachedTemporalData(topic, timeRange);
    if (cached) {
      _setCacheControl(res, 10);
      return res.json({ ...cached, cached: true });
    }

    const rows   = await getTemporalSentiment(topic, timeRange, interval);
    const result = { topic, timeRange, interval, data: _buildChartData(rows) };

    await cacheTemporalData(topic, timeRange, result);
    _setCacheControl(res, 10);
    res.json(result);
  } catch (error) {
    logger.error("Error getting temporal sentiment:", error);
    res.status(500).json({ error: "Failed to get temporal sentiment data" });
  }
});

/**
 * GET /api/tweets/:topic
 * FIX: cache key now includes limit
 */
router.get("/tweets/:topic", async (req, res) => {
  try {
    const { topic }        = req.params;
    const limit            = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    // FIX: pass limit so different page sizes don't collide in cache
    const cached = await getCachedRecentTweets(topic, limit);
    if (cached) {
      _setCacheControl(res, 5);
      return res.json({ tweets: cached, cached: true });
    }

    const tweets = await getRecentTweets(topic, limit);
    await cacheRecentTweets(topic, limit, tweets); // FIX: pass limit
    _setCacheControl(res, 5);
    res.json({ topic, tweets });
  } catch (error) {
    logger.error("Error getting recent tweets:", error);
    res.status(500).json({ error: "Failed to get recent tweets" });
  }
});

/** GET /api/trending */
router.get("/trending", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

    const cached = await getCachedTrendingTopics();
    if (cached) {
      _setCacheControl(res, 15);
      return res.json({ topics: cached, cached: true });
    }

    const topics = await getTrendingTopics(limit);
    await cacheTrendingTopics(topics);
    _setCacheControl(res, 15);
    res.json({ topics });
  } catch (error) {
    logger.error("Error getting trending topics:", error);
    res.status(500).json({ error: "Failed to get trending topics" });
  }
});

/** GET /api/alerts/:topic */
router.get("/alerts/:topic", async (req, res) => {
  try {
    const { topic } = req.params;
    const limit     = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const alerts    = await getSentimentAlerts(topic, limit);
    _setCacheControl(res, 5);
    res.json({ topic, alerts });
  } catch (error) {
    logger.error("Error getting sentiment alerts:", error);
    res.status(500).json({ error: "Failed to get sentiment alerts" });
  }
});

/** GET /api/insights/:topic */
router.get("/insights/:topic", async (req, res) => {
  try {
    const { topic } = req.params;
    const topKeywords = getTopKeywords(topic, 5);
    const latestAlert = getLatestAlert(topic);
    _setCacheControl(res, 5);
    res.json({ topic, topKeywords, latestAlert });
  } catch (error) {
    logger.error("Error getting realtime insights:", error);
    res.status(500).json({ error: "Failed to get realtime insights" });
  }
});

/**
 * GET /api/status
 * SPEED: cached for 5 s in-process — was completely uncached before
 */
router.get("/status", async (req, res) => {
  try {
    const now = Date.now();
    if (_statusCache && now - _statusCachedAt < STATUS_TTL_MS) {
      _setCacheControl(res, 5);
      return res.json({ ..._statusCache, cached: true });
    }

    _statusCache = {
      timestamp: new Date().toISOString(),
      stream:    getStreamStatus(),
      kafka:     getKafkaStatus(),
      websocket: getConnectionStats(),
    };
    _statusCachedAt = now;

    _setCacheControl(res, 5);
    res.json(_statusCache);
  } catch (error) {
    logger.error("Error getting system status:", error);
    res.status(500).json({ error: "Failed to get system status" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
module.exports = router;