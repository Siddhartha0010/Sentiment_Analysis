"use strict";
/**
 * cache.js  —  Memcached Cache Layer (Rewritten)
 * =================================================
 * KEY CHANGES vs original
 * ────────────────────────
 * 1. BUG FIX → cacheSentimentStats / getCachedSentimentStats now accept
 *              `timeRange` as a parameter and include it in the cache key.
 *              Previously `1h` and `24h` collided on the same key.
 *
 * 2. BUG FIX → cacheRecentTweets / getCachedRecentTweets now accept
 *              `limit` as a parameter and include it in the cache key.
 *              Previously limit=20 and limit=50 returned the same cached data.
 *
 * 3. BUG FIX → invalidateTopicCache now deletes tweet keys for all common
 *              limit variants (20, 50, 100) instead of silently leaving
 *              stale tweet caches after a stream restart.
 *
 * 4. CLEAN  → All low-level helpers (get/set/del/increment/getOrSet) and
 *              all other public signatures are UNCHANGED — drop-in replacement.
 */

const Memcached = require("memcached");
const logger    = require("../utils/logger");

let memcached = null;

const CACHE_CONFIG = {
  servers: process.env.MEMCACHED_SERVERS || "localhost:11211",
  options: {
    retries:  3,
    retry:    10_000,
    timeout:  5_000,
    failures: 3,
    poolSize: 10,
  },
};

// Default TTL values (seconds)
const TTL = {
  STATS:    30,   // real-time sentiment stats
  TRENDING: 60,   // trending topics sidebar
  TWEETS:   120,  // recent tweet lists
  TEMPORAL: 60,   // chart time-series data
  ALERTS:   300,  // alert history
};

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────
async function initializeCache() {
  return new Promise((resolve) => {
    try {
      memcached = new Memcached(CACHE_CONFIG.servers, CACHE_CONFIG.options);

      memcached.stats((err, stats) => {
        if (err) {
          logger.warn("Memcached connection failed, running without cache:", err.message);
          memcached = null;
          resolve(null);
        } else {
          logger.info("Memcached connected", { servers: CACHE_CONFIG.servers });
          resolve(memcached);
        }
      });

      memcached.on("failure",     (d) => logger.error("Memcached server failure:", d));
      memcached.on("reconnecting",(d) => logger.info("Memcached reconnecting:", d));
    } catch (err) {
      logger.warn("Failed to initialize Memcached:", err.message);
      resolve(null);
    }
  });
}

function closeCache() {
  if (memcached) {
    memcached.end();
    logger.info("Memcached connection closed");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level primitives (UNCHANGED)
// ─────────────────────────────────────────────────────────────────────────────

/** Build a safe Memcached key — no spaces, slashes or special chars */
function generateKey(prefix, ...parts) {
  return `sentiment:${prefix}:${parts.join(":")}`.replace(/[^a-zA-Z0-9:_-]/g, "_");
}

async function get(key) {
  if (!memcached) return null;
  return new Promise((resolve) => {
    memcached.get(key, (err, data) => {
      if (err) { logger.debug("Cache get error:", err.message); resolve(null); return; }
      resolve(data ? JSON.parse(data) : null);
    });
  });
}

async function set(key, value, ttl = 60) {
  if (!memcached) return false;
  return new Promise((resolve) => {
    memcached.set(key, JSON.stringify(value), ttl, (err) => {
      if (err) { logger.debug("Cache set error:", err.message); resolve(false); return; }
      resolve(true);
    });
  });
}

async function del(key) {
  if (!memcached) return false;
  return new Promise((resolve) => {
    memcached.del(key, (err) => {
      if (err) { logger.debug("Cache delete error:", err.message); resolve(false); return; }
      resolve(true);
    });
  });
}

async function increment(key, amount = 1) {
  if (!memcached) return null;
  return new Promise((resolve) => {
    memcached.incr(key, amount, (err, result) => {
      if (err) {
        memcached.set(key, amount.toString(), TTL.STATS, (setErr) =>
          resolve(setErr ? null : amount)
        );
      } else {
        resolve(result);
      }
    });
  });
}

async function getOrSet(key, ttl, fetchFn) {
  const cached = await get(key);
  if (cached !== null) return cached;
  const data = await fetchFn();
  await set(key, data, ttl);
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sentiment stats
 * FIX: timeRange is now part of the cache key so "1h" and "24h" don't collide.
 * api.js calls: cacheSentimentStats(topic, timeRange, result)
 */
async function cacheSentimentStats(topic, timeRange, stats) {
  const key = generateKey("stats", topic, timeRange);  // ← FIX
  return set(key, stats, TTL.STATS);
}

async function getCachedSentimentStats(topic, timeRange) {
  const key = generateKey("stats", topic, timeRange);  // ← FIX
  return get(key);
}

// ── Trending topics (unchanged — no extra dimension needed) ──────────────────
async function cacheTrendingTopics(topics) {
  return set(generateKey("trending", "all"), topics, TTL.TRENDING);
}

async function getCachedTrendingTopics() {
  return get(generateKey("trending", "all"));
}

/**
 * Recent tweets
 * FIX: limit is now part of the cache key so limit=20 and limit=50 don't collide.
 * api.js calls: cacheRecentTweets(topic, limit, tweets)
 */
async function cacheRecentTweets(topic, limit, tweets) {
  const key = generateKey("tweets", topic, String(limit));  // ← FIX
  return set(key, tweets, TTL.TWEETS);
}

async function getCachedRecentTweets(topic, limit) {
  const key = generateKey("tweets", topic, String(limit));  // ← FIX
  return get(key);
}

// ── Temporal chart data (unchanged — topic+timeRange already unique) ──────────
async function cacheTemporalData(topic, timeRange, data) {
  return set(generateKey("temporal", topic, timeRange), data, TTL.TEMPORAL);
}

async function getCachedTemporalData(topic, timeRange) {
  return get(generateKey("temporal", topic, timeRange));
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache invalidation
// ─────────────────────────────────────────────────────────────────────────────

// All timeRange values used by the frontend
const TIME_RANGES  = ["5m", "1h", "6h", "24h"];
// All limit values used by the frontend (matches api.js max of 100)
const TWEET_LIMITS = ["20", "50", "100"];           // ← FIX: cover all limit variants

async function invalidateTopicCache(topic) {
  const keys = [
    // Stats — one key per timeRange
    ...TIME_RANGES.map((tr) => generateKey("stats", topic, tr)),
    // Tweets — one key per limit variant              ← FIX
    ...TWEET_LIMITS.map((lim) => generateKey("tweets", topic, lim)),
    // Temporal — one key per timeRange
    ...TIME_RANGES.map((tr) => generateKey("temporal", topic, tr)),
  ];

  await Promise.all(keys.map((k) => del(k)));
  logger.debug(`Cache invalidated for topic: ${topic} (${keys.length} keys)`);
}

async function invalidateTrendingCache() {
  await del(generateKey("trending", "all"));
  logger.debug("Trending cache invalidated");
}

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────
async function getCacheStatus() {
  if (!memcached) return { connected: false, servers: CACHE_CONFIG.servers };
  return new Promise((resolve) => {
    memcached.stats((err, stats) => {
      resolve({ connected: !err, servers: CACHE_CONFIG.servers, stats: stats || null });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  initializeCache,
  closeCache,
  get,
  set,
  del,
  increment,
  getOrSet,
  cacheSentimentStats,
  getCachedSentimentStats,
  cacheTrendingTopics,
  getCachedTrendingTopics,
  cacheRecentTweets,
  getCachedRecentTweets,
  cacheTemporalData,
  getCachedTemporalData,
  invalidateTopicCache,
  invalidateTrendingCache,
  getCacheStatus,
  TTL,
};