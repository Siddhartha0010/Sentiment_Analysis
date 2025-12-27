const mysql = require('mysql2/promise');
const logger = require('../utils/logger');

let pool = null;

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'sentiment_user',
  password: process.env.DB_PASSWORD || 'sentiment_pass',
  database: process.env.DB_NAME || 'sentiment_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

/**
 * Initialize database connection pool
 */
async function initializeDatabase() {
  try {
    pool = mysql.createPool(DB_CONFIG);
    
    // Test connection
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    
    logger.info('Database connection pool initialized', { 
      host: DB_CONFIG.host, 
      database: DB_CONFIG.database 
    });
    
    return pool;
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Save tweet with sentiment to database
 */
async function saveTweet(tweetData) {
  const query = `
    INSERT INTO tweets (
      tweet_id, text, author_id, author_username, author_name,
      topic, sentiment, confidence, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      sentiment = VALUES(sentiment),
      confidence = VALUES(confidence)
  `;

  const values = [
    tweetData.id,
    tweetData.text,
    tweetData.author?.id || tweetData.author_id,
    tweetData.author?.username || null,
    tweetData.author?.name || null,
    tweetData.topic,
    tweetData.sentiment || 'pending',
    tweetData.confidence || 0,
    tweetData.created_at || new Date()
  ];

  try {
    const [result] = await pool.execute(query, values);
    return result;
  } catch (error) {
    logger.error('Error saving tweet:', error);
    throw error;
  }
}

/**
 * Update sentiment stats
 */
async function updateSentimentStats(topic, sentiment) {
  const query = `
    INSERT INTO sentiment_stats (topic, sentiment, count, last_updated)
    VALUES (?, ?, 1, NOW())
    ON DUPLICATE KEY UPDATE
      count = count + 1,
      last_updated = NOW()
  `;

  try {
    const [result] = await pool.execute(query, [topic, sentiment]);
    return result;
  } catch (error) {
    logger.error('Error updating sentiment stats:', error);
    throw error;
  }
}

/**
 * Get sentiment stats for a topic
 */
async function getSentimentStats(topic, timeRange = '1h') {
  const timeCondition = getTimeCondition(timeRange);
  
  const query = `
    SELECT 
      sentiment,
      COUNT(*) as count,
      AVG(confidence) as avg_confidence
    FROM tweets
    WHERE topic = ? AND created_at >= ?
    GROUP BY sentiment
  `;

  try {
    const [rows] = await pool.execute(query, [topic, timeCondition]);
    return rows;
  } catch (error) {
    logger.error('Error getting sentiment stats:', error);
    throw error;
  }
}

/**
 * Get temporal sentiment data for charts
 */
async function getTemporalSentiment(topic, timeRange = '1h', interval = '1m') {
  const timeCondition = getTimeCondition(timeRange);
  const intervalSeconds = parseInterval(interval);
  
  const query = `
    SELECT 
      FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(created_at) / ?) * ?) as time_bucket,
      sentiment,
      COUNT(*) as count
    FROM tweets
    WHERE topic = ? AND created_at >= ?
    GROUP BY time_bucket, sentiment
    ORDER BY time_bucket ASC
  `;

  try {
    const [rows] = await pool.execute(query, [
      intervalSeconds, intervalSeconds, topic, timeCondition
    ]);
    return rows;
  } catch (error) {
    logger.error('Error getting temporal sentiment:', error);
    throw error;
  }
}

/**
 * Get recent tweets with sentiment
 */
async function getRecentTweets(topic, limit = 20) {
  const query = `
    SELECT 
      tweet_id, text, author_username, author_name,
      sentiment, confidence, created_at
    FROM tweets
    WHERE topic = ?
    ORDER BY created_at DESC
    LIMIT ?
  `;

  try {
    const [rows] = await pool.execute(query, [topic, limit]);
    return rows;
  } catch (error) {
    logger.error('Error getting recent tweets:', error);
    throw error;
  }
}

/**
 * Get trending topics
 */
async function getTrendingTopics(limit = 10) {
  const query = `
    SELECT 
      topic,
      COUNT(*) as tweet_count,
      SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) as positive_count,
      SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) as negative_count,
      SUM(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) as neutral_count,
      MAX(created_at) as last_tweet_at
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
    logger.error('Error getting trending topics:', error);
    throw error;
  }
}

/**
 * Save sentiment alert
 */
async function saveSentimentAlert(alertData) {
  const query = `
    INSERT INTO sentiment_alerts (
      topic, alert_type, message, severity, created_at
    ) VALUES (?, ?, ?, ?, NOW())
  `;

  try {
    const [result] = await pool.execute(query, [
      alertData.topic,
      alertData.type,
      alertData.message,
      alertData.severity || 'info'
    ]);
    return result;
  } catch (error) {
    logger.error('Error saving sentiment alert:', error);
    throw error;
  }
}

/**
 * Get sentiment alerts
 */
async function getSentimentAlerts(topic, limit = 10) {
  const query = `
    SELECT * FROM sentiment_alerts
    WHERE topic = ?
    ORDER BY created_at DESC
    LIMIT ?
  `;

  try {
    const [rows] = await pool.execute(query, [topic, limit]);
    return rows;
  } catch (error) {
    logger.error('Error getting sentiment alerts:', error);
    throw error;
  }
}

/**
 * Helper: Get time condition based on range
 */
function getTimeCondition(timeRange) {
  const now = new Date();
  const match = timeRange.match(/^(\d+)([hmds])$/);
  
  if (!match) return new Date(now - 3600000); // Default 1 hour
  
  const [, value, unit] = match;
  const multipliers = { h: 3600000, m: 60000, d: 86400000, s: 1000 };
  
  return new Date(now - (parseInt(value) * multipliers[unit]));
}

/**
 * Helper: Parse interval to seconds
 */
function parseInterval(interval) {
  const match = interval.match(/^(\d+)([msh])$/);
  if (!match) return 60; // Default 1 minute
  
  const [, value, unit] = match;
  const multipliers = { s: 1, m: 60, h: 3600 };
  
  return parseInt(value) * multipliers[unit];
}

/**
 * Get database pool
 */
function getPool() {
  return pool;
}

/**
 * Close database connection
 */
async function closeDatabase() {
  if (pool) {
    await pool.end();
    logger.info('Database connection closed');
  }
}

module.exports = {
  initializeDatabase,
  saveTweet,
  updateSentimentStats,
  getSentimentStats,
  getTemporalSentiment,
  getRecentTweets,
  getTrendingTopics,
  saveSentimentAlert,
  getSentimentAlerts,
  getPool,
  closeDatabase
};
