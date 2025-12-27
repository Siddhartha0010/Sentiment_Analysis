const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const { startStream, stopStream, getStreamStatus, searchTweets } = require('../services/twitter');
const { getSentimentStats, getTemporalSentiment, getRecentTweets, getTrendingTopics, getSentimentAlerts } = require('../services/database');
const { getCachedSentimentStats, cacheSentimentStats, getCachedTrendingTopics, cacheTrendingTopics, getCachedRecentTweets, cacheRecentTweets, getCachedTemporalData, cacheTemporalData, TTL } = require('../services/cache');
const { getKafkaStatus } = require('../services/kafka');
const { getConnectionStats } = require('../services/websocket');

const router = express.Router();

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Stricter rate limit for stream control
const streamLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { error: 'Too many stream control requests, please wait.' }
});

router.use(apiLimiter);

/**
 * Start streaming tweets for a topic
 * POST /api/stream/start
 */
router.post('/stream/start', streamLimiter, async (req, res) => {
  try {
    const { topic } = req.body;
    
    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Topic is required',
        message: 'Please provide a valid topic or keyword to stream'
      });
    }

    const sanitizedTopic = topic.trim().slice(0, 100); // Limit topic length
    const result = await startStream(sanitizedTopic);
    
    logger.info(`Stream started for topic: ${sanitizedTopic}`);
    res.json({ 
      success: true, 
      ...result,
      message: `Started streaming tweets for "${sanitizedTopic}"`
    });
  } catch (error) {
    logger.error('Error starting stream:', error);
    res.status(500).json({ 
      error: 'Failed to start stream',
      message: error.message 
    });
  }
});

/**
 * Stop the current stream
 * POST /api/stream/stop
 */
router.post('/stream/stop', streamLimiter, async (req, res) => {
  try {
    const result = await stopStream();
    logger.info('Stream stopped');
    res.json({ 
      success: true, 
      ...result,
      message: 'Stream stopped successfully'
    });
  } catch (error) {
    logger.error('Error stopping stream:', error);
    res.status(500).json({ 
      error: 'Failed to stop stream',
      message: error.message 
    });
  }
});

/**
 * Get current stream status
 * GET /api/stream/status
 */
router.get('/stream/status', async (req, res) => {
  try {
    const status = getStreamStatus();
    res.json(status);
  } catch (error) {
    logger.error('Error getting stream status:', error);
    res.status(500).json({ error: 'Failed to get stream status' });
  }
});

/**
 * Get sentiment stats for a topic
 * GET /api/sentiment/stats/:topic
 */
router.get('/sentiment/stats/:topic', async (req, res) => {
  try {
    const { topic } = req.params;
    const { timeRange = '1h' } = req.query;

    // Try cache first
    const cached = await getCachedSentimentStats(topic);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const stats = await getSentimentStats(topic, timeRange);
    
    // Calculate percentages
    const total = stats.reduce((sum, s) => sum + parseInt(s.count), 0);
    const result = {
      topic,
      timeRange,
      total,
      sentiments: stats.map(s => ({
        sentiment: s.sentiment,
        count: parseInt(s.count),
        percentage: total > 0 ? ((parseInt(s.count) / total) * 100).toFixed(2) : 0,
        avgConfidence: parseFloat(s.avg_confidence || 0).toFixed(2)
      }))
    };

    // Cache the result
    await cacheSentimentStats(topic, result);

    res.json(result);
  } catch (error) {
    logger.error('Error getting sentiment stats:', error);
    res.status(500).json({ error: 'Failed to get sentiment stats' });
  }
});

/**
 * Get temporal sentiment data for charts
 * GET /api/sentiment/temporal/:topic
 */
router.get('/sentiment/temporal/:topic', async (req, res) => {
  try {
    const { topic } = req.params;
    const { timeRange = '1h', interval = '1m' } = req.query;

    // Try cache first
    const cached = await getCachedTemporalData(topic, timeRange);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const data = await getTemporalSentiment(topic, timeRange, interval);
    
    // Transform data for chart consumption
    const chartData = {};
    data.forEach(row => {
      const time = new Date(row.time_bucket).toISOString();
      if (!chartData[time]) {
        chartData[time] = { time, positive: 0, negative: 0, neutral: 0 };
      }
      chartData[time][row.sentiment] = parseInt(row.count);
    });

    const result = {
      topic,
      timeRange,
      interval,
      data: Object.values(chartData)
    };

    // Cache the result
    await cacheTemporalData(topic, timeRange, result);

    res.json(result);
  } catch (error) {
    logger.error('Error getting temporal sentiment:', error);
    res.status(500).json({ error: 'Failed to get temporal sentiment data' });
  }
});

/**
 * Get recent tweets with sentiment
 * GET /api/tweets/:topic
 */
router.get('/tweets/:topic', async (req, res) => {
  try {
    const { topic } = req.params;
    const { limit = 20 } = req.query;

    // Try cache first
    const cached = await getCachedRecentTweets(topic);
    if (cached) {
      return res.json({ tweets: cached, cached: true });
    }

    const tweets = await getRecentTweets(topic, Math.min(parseInt(limit), 100));
    
    // Cache the result
    await cacheRecentTweets(topic, tweets);

    res.json({ topic, tweets });
  } catch (error) {
    logger.error('Error getting recent tweets:', error);
    res.status(500).json({ error: 'Failed to get recent tweets' });
  }
});

/**
 * Get trending topics
 * GET /api/trending
 */
router.get('/trending', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    // Try cache first
    const cached = await getCachedTrendingTopics();
    if (cached) {
      return res.json({ topics: cached, cached: true });
    }

    const topics = await getTrendingTopics(Math.min(parseInt(limit), 50));
    
    // Cache the result
    await cacheTrendingTopics(topics);

    res.json({ topics });
  } catch (error) {
    logger.error('Error getting trending topics:', error);
    res.status(500).json({ error: 'Failed to get trending topics' });
  }
});

/**
 * Get sentiment alerts for a topic
 * GET /api/alerts/:topic
 */
router.get('/alerts/:topic', async (req, res) => {
  try {
    const { topic } = req.params;
    const { limit = 10 } = req.query;

    const alerts = await getSentimentAlerts(topic, Math.min(parseInt(limit), 50));
    res.json({ topic, alerts });
  } catch (error) {
    logger.error('Error getting sentiment alerts:', error);
    res.status(500).json({ error: 'Failed to get sentiment alerts' });
  }
});

/**
 * Search tweets (historical)
 * GET /api/search
 */
router.get('/search', async (req, res) => {
  try {
    const { query, maxResults = 50 } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const tweets = await searchTweets(query, Math.min(parseInt(maxResults), 100));
    res.json({ query, count: tweets.length, tweets });
  } catch (error) {
    logger.error('Error searching tweets:', error);
    res.status(500).json({ error: 'Failed to search tweets' });
  }
});

/**
 * Get system status
 * GET /api/status
 */
router.get('/status', async (req, res) => {
  try {
    const streamStatus = getStreamStatus();
    const kafkaStatus = getKafkaStatus();
    const wsStats = getConnectionStats();

    res.json({
      timestamp: new Date().toISOString(),
      stream: streamStatus,
      kafka: kafkaStatus,
      websocket: wsStats
    });
  } catch (error) {
    logger.error('Error getting system status:', error);
    res.status(500).json({ error: 'Failed to get system status' });
  }
});

module.exports = router;
