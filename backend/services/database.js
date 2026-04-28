"use strict";
/**
 * database.js  —  MariaDB Query Layer (v2 — Timezone Fix)
 * =========================================================
 * CRITICAL BUG FIX — WHY STATS SHOWED 0 / YESTERDAY'S DATA:
 *
 *   The old getTimeCondition() returned a JavaScript Date object passed
 *   as a mysql2 `?` parameter. mysql2 serialises it in Node.js's local
 *   timezone. rss.js stores created_at as a local-time string.
 *   MariaDB's NOW() runs in the DB server's own timezone.
 *
 *   When Node.js timezone ≠ MariaDB timezone (very common in IST / Docker /
 *   WSL setups), the comparison:
 *
 *       WHERE created_at >= <JS-computed UTC timestamp>
 *
 *   misses ALL recent rows — they look "hours in the future" or "hours old"
 *   depending on the UTC offset direction. This is why stats showed 0 even
 *   though the live feed was receiving and displaying articles correctly.
 *
 *   FIX: Every time comparison now uses DATE_SUB(NOW(), INTERVAL ? SECOND)
 *   so the arithmetic stays entirely inside MariaDB. NOW() and created_at
 *   share the same timezone context — JS is never involved.
 */

const mysql  = require("mysql2/promise");
const logger = require("../utils/logger");

let pool = null;

const DB_CONFIG = {
  host:               process.env.DB_HOST     || "localhost",
  port:               parseInt(process.env.DB_PORT || "3306"),
  user:               process.env.DB_USER     || "sentiment_user",
  password:           process.env.DB_PASSWORD || "sentiment_pass",
  database:           process.env.DB_NAME     || "sentiment_db",
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  enableKeepAlive:    true,
  keepAliveInitialDelay: 0,
  timezone:           "local", // tell mysql2 to match the DB server timezone
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────
async function initializeDatabase() {
  try {
    pool = mysql.createPool(DB_CONFIG);
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    logger.info("Database pool initialized", {
      host: DB_CONFIG.host, database: DB_CONFIG.database,
    });
    return pool;
  } catch (error) {
    logger.error("Failed to initialize database:", error);
    throw error;
  }
}

async function closeDatabase() {
  if (pool) { await pool.end(); logger.info("Database connection closed"); }
}

function getPool() { return pool; }

// ── Time helpers ──────────────────────────────────────────────────────────────

/**
 * Convert timeRange string → seconds integer.
 * Used with DATE_SUB(NOW(), INTERVAL ? SECOND) — keeps everything in DB.
 */
function timeRangeToSeconds(timeRange) {
  const match = timeRange.match(/^(\d+)([hmds])$/);
  if (!match) return 3600; // default 1 hour
  const [, value, unit] = match;
  return parseInt(value, 10) * ({ s: 1, m: 60, h: 3600, d: 86400 }[unit]);
}

function parseInterval(interval) {
  const match = interval.match(/^(\d+)([msh])$/);
  if (!match) return 60;
  const [, value, unit] = match;
  return parseInt(value, 10) * ({ s: 1, m: 60, h: 3600 }[unit]);
}

// ── Writes ────────────────────────────────────────────────────────────────────

async function saveTweet(tweetData) {
  const query = `
    INSERT INTO tweets (tweet_id, text, topic, sentiment, confidence, created_at, processed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      sentiment  = VALUES(sentiment),
      confidence = VALUES(confidence),
      created_at = VALUES(created_at),
      processed_at = VALUES(processed_at)
  `;
  try {
    const publishedAt = tweetData.published_at ? new Date(tweetData.published_at) : new Date();
    const processedAt = tweetData.processed_at ? new Date(tweetData.processed_at) : new Date();
    const [result] = await pool.execute(query, [
      tweetData.id, tweetData.text, tweetData.topic,
      tweetData.sentiment || "pending", tweetData.confidence || 0,
      Number.isFinite(publishedAt.getTime()) ? publishedAt : new Date(),
      Number.isFinite(processedAt.getTime()) ? processedAt : new Date(),
    ]);
    return result;
  } catch (error) {
    logger.error("Error saving tweet:", error);
    throw error;
  }
}

/**
 * Minute-bucket upsert — uses DATE_FORMAT(NOW(),...) for the bucket key
 * so the rounding happens in DB timezone context, not JS.
 */
async function updateSentimentStats(topic, sentiment) {
  const posInc  = sentiment === "positive" ? 1 : 0;
  const negInc  = sentiment === "negative" ? 1 : 0;
  const neutInc = sentiment === "neutral"  ? 1 : 0;

  const query = `
    INSERT INTO sentiment_stats
      (topic, time_window, total_count, positive_count, negative_count, neutral_count)
    VALUES (?, DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:00'), 1, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      total_count    = total_count    + 1,
      positive_count = positive_count + ?,
      negative_count = negative_count + ?,
      neutral_count  = neutral_count  + ?
  `;
  try {
    await pool.execute(query, [
      topic,
      posInc, negInc, neutInc, // INSERT
      posInc, negInc, neutInc, // UPDATE
    ]);
  } catch (error) {
    logger.error("Error updating sentiment stats:", error); // non-fatal
  }
}

async function saveSentimentAlert(alertData) {
  const query = `
    INSERT INTO sentiment_alerts (topic, alert_type, message, sentiment_change)
    VALUES (?, ?, ?, ?)
  `;
  try {
    const [result] = await pool.execute(query, [
      alertData.topic, alertData.type, alertData.message,
      alertData.severity === "high" ? 1.0 : 0.5,
    ]);
    return result;
  } catch (error) {
    logger.error("Error saving sentiment alert:", error);
    throw error;
  }
}

// ── Reads — all time comparisons use DATE_SUB(NOW(), INTERVAL ? SECOND) ──────

/**
 * THE KEY FIX:
 * DATE_SUB(NOW(), INTERVAL ? SECOND) replaces the old JS Date parameter.
 * Both NOW() and stored created_at values are in MariaDB's timezone — no
 * JS offset mismatch possible.
 */
async function getSentimentStats(topic, timeRange = "1h") {
  const seconds = timeRangeToSeconds(timeRange);
  const query = `
    SELECT
      sentiment,
      COUNT(*)        AS count,
      AVG(confidence) AS avg_confidence
    FROM tweets
    WHERE topic = ?
      AND created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)
    GROUP BY sentiment
  `;
  try {
    const [rows] = await pool.execute(query, [topic, seconds]);
    return rows;
  } catch (error) {
    logger.error("Error getting sentiment stats:", error);
    throw error;
  }
}

async function getTemporalSentiment(topic, timeRange = "1h", interval = "1m") {
  const seconds         = timeRangeToSeconds(timeRange);
  const intervalSeconds = parseInterval(interval);
  const query = `
    SELECT
      FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(created_at) / ?) * ?) AS time_bucket,
      sentiment,
      COUNT(*) AS count
    FROM tweets
    WHERE topic = ?
      AND created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)
    GROUP BY time_bucket, sentiment
    ORDER BY time_bucket ASC
  `;
  try {
    const [rows] = await pool.execute(query, [
      intervalSeconds, intervalSeconds, topic, seconds,
    ]);
    return rows;
  } catch (error) {
    logger.error("Error getting temporal sentiment:", error);
    throw error;
  }
}

async function getRecentTweets(topic, limit = 20) {
  // No time filter here — shows the most recent regardless of when
  const query = `
    SELECT tweet_id, text, sentiment, confidence, created_at, processed_at
    FROM tweets
    WHERE topic = ?
    ORDER BY created_at DESC
    LIMIT ?
  `;
  try {
    const [rows] = await pool.execute(query, [topic, limit]);
    return rows;
  } catch (error) {
    logger.error("Error getting recent tweets:", error);
    throw error;
  }
}

async function getTrendingTopics(limit = 10) {
  const query = `
    SELECT
      topic,
      COUNT(*) AS tweet_count,
      SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) AS positive_count,
      SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) AS negative_count,
      SUM(CASE WHEN sentiment = 'neutral'  THEN 1 ELSE 0 END) AS neutral_count,
      MAX(created_at) AS last_tweet_at
    FROM tweets
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
    GROUP BY topic
    ORDER BY tweet_count DESC
    LIMIT ?
  `;
  try {
    const [rows] = await pool.execute(query, [limit]);
    return rows;
  } catch (error) {
    logger.error("Error getting trending topics:", error);
    throw error;
  }
}

async function getSentimentAlerts(topic, limit = 10) {
  const query = `
    SELECT * FROM sentiment_alerts
    WHERE topic = ?
    ORDER BY triggered_at DESC
    LIMIT ?
  `;
  try {
    const [rows] = await pool.execute(query, [topic, limit]);
    return rows;
  } catch (error) {
    logger.error("Error getting sentiment alerts:", error);
    throw error;
  }
}

async function clearTopicTweets(topic) {
  const query = `DELETE FROM tweets WHERE topic = ?`;
  try {
    const [result] = await pool.execute(query, [topic]);
    return result;
  } catch (error) {
    logger.error("Error clearing topic tweets:", error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  initializeDatabase, closeDatabase, getPool,
  saveTweet, updateSentimentStats, saveSentimentAlert,
  getSentimentStats, getTemporalSentiment, getRecentTweets,
  getTrendingTopics, getSentimentAlerts, clearTopicTweets,
};