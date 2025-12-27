const Memcached = require('memcached');
const logger = require('../utils/logger');

let memcached = null;

const CACHE_CONFIG = {
  servers: process.env.MEMCACHED_SERVERS || 'localhost:11211',
  options: {
    retries: 3,
    retry: 10000,
    timeout: 5000,
    failures: 3,
    poolSize: 10
  }
};

// Default TTL values (in seconds)
const TTL = {
  STATS: 30,           // 30 seconds for real-time stats
  TRENDING: 60,        // 1 minute for trending topics
  TWEETS: 120,         // 2 minutes for tweet lists
  TEMPORAL: 60,        // 1 minute for temporal data
  ALERTS: 300          // 5 minutes for alerts
};

/**
 * Initialize Memcached connection
 */
async function initializeCache() {
  return new Promise((resolve, reject) => {
    try {
      memcached = new Memcached(CACHE_CONFIG.servers, CACHE_CONFIG.options);
      
      // Test connection
      memcached.stats((err, stats) => {
        if (err) {
          logger.warn('Memcached connection failed, running without cache:', err.message);
          memcached = null;
          resolve(null);
        } else {
          logger.info('Memcached connected', { servers: CACHE_CONFIG.servers });
          resolve(memcached);
        }
      });

      // Handle errors
      memcached.on('failure', (details) => {
        logger.error('Memcached server failure:', details);
      });

      memcached.on('reconnecting', (details) => {
        logger.info('Memcached reconnecting:', details);
      });

    } catch (error) {
      logger.warn('Failed to initialize Memcached:', error.message);
      resolve(null);
    }
  });
}

/**
 * Generate cache key
 */
function generateKey(prefix, ...parts) {
  return `sentiment:${prefix}:${parts.join(':')}`.replace(/[^a-zA-Z0-9:_-]/g, '_');
}

/**
 * Get value from cache
 */
async function get(key) {
  if (!memcached) return null;

  return new Promise((resolve) => {
    memcached.get(key, (err, data) => {
      if (err) {
        logger.debug('Cache get error:', err.message);
        resolve(null);
      } else {
        resolve(data ? JSON.parse(data) : null);
      }
    });
  });
}

/**
 * Set value in cache
 */
async function set(key, value, ttl = 60) {
  if (!memcached) return false;

  return new Promise((resolve) => {
    memcached.set(key, JSON.stringify(value), ttl, (err) => {
      if (err) {
        logger.debug('Cache set error:', err.message);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Delete value from cache
 */
async function del(key) {
  if (!memcached) return false;

  return new Promise((resolve) => {
    memcached.del(key, (err) => {
      if (err) {
        logger.debug('Cache delete error:', err.message);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Increment counter in cache
 */
async function increment(key, amount = 1) {
  if (!memcached) return null;

  return new Promise((resolve) => {
    memcached.incr(key, amount, (err, result) => {
      if (err) {
        // Key might not exist, try to set it
        memcached.set(key, amount.toString(), TTL.STATS, (setErr) => {
          resolve(setErr ? null : amount);
        });
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Get or set cache with callback
 */
async function getOrSet(key, ttl, fetchFn) {
  const cached = await get(key);
  if (cached !== null) {
    return cached;
  }

  const data = await fetchFn();
  await set(key, data, ttl);
  return data;
}

/**
 * Cache sentiment stats
 */
async function cacheSentimentStats(topic, stats) {
  const key = generateKey('stats', topic);
  return set(key, stats, TTL.STATS);
}

/**
 * Get cached sentiment stats
 */
async function getCachedSentimentStats(topic) {
  const key = generateKey('stats', topic);
  return get(key);
}

/**
 * Cache trending topics
 */
async function cacheTrendingTopics(topics) {
  const key = generateKey('trending', 'all');
  return set(key, topics, TTL.TRENDING);
}

/**
 * Get cached trending topics
 */
async function getCachedTrendingTopics() {
  const key = generateKey('trending', 'all');
  return get(key);
}

/**
 * Cache recent tweets
 */
async function cacheRecentTweets(topic, tweets) {
  const key = generateKey('tweets', topic);
  return set(key, tweets, TTL.TWEETS);
}

/**
 * Get cached recent tweets
 */
async function getCachedRecentTweets(topic) {
  const key = generateKey('tweets', topic);
  return get(key);
}

/**
 * Cache temporal sentiment data
 */
async function cacheTemporalData(topic, timeRange, data) {
  const key = generateKey('temporal', topic, timeRange);
  return set(key, data, TTL.TEMPORAL);
}

/**
 * Get cached temporal sentiment data
 */
async function getCachedTemporalData(topic, timeRange) {
  const key = generateKey('temporal', topic, timeRange);
  return get(key);
}

/**
 * Invalidate all caches for a topic
 */
async function invalidateTopicCache(topic) {
  const keys = [
    generateKey('stats', topic),
    generateKey('tweets', topic),
    generateKey('temporal', topic, '1h'),
    generateKey('temporal', topic, '6h'),
    generateKey('temporal', topic, '24h')
  ];

  await Promise.all(keys.map(key => del(key)));
  logger.debug(`Cache invalidated for topic: ${topic}`);
}

/**
 * Get cache status
 */
async function getCacheStatus() {
  if (!memcached) {
    return { connected: false, servers: CACHE_CONFIG.servers };
  }

  return new Promise((resolve) => {
    memcached.stats((err, stats) => {
      resolve({
        connected: !err,
        servers: CACHE_CONFIG.servers,
        stats: stats || null
      });
    });
  });
}

/**
 * Close cache connection
 */
function closeCache() {
  if (memcached) {
    memcached.end();
    logger.info('Memcached connection closed');
  }
}

module.exports = {
  initializeCache,
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
  getCacheStatus,
  closeCache,
  TTL
};
