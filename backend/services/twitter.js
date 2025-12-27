const { TwitterApi } = require('twitter-api-v2');
const logger = require('../utils/logger');
const { publishTweet } = require('./kafka');
const RateLimiter = require('../utils/rateLimiter');
const { broadcastTweet } = require('./websocket');

let twitterClient = null;
let streamClient = null;
let isStreaming = false;
let currentTopic = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_BASE = 1000;

// Rate limiter: 450 requests per 15-minute window for filtered stream
const rateLimiter = new RateLimiter({
  maxRequests: 450,
  windowMs: 15 * 60 * 1000,
  retryAfterMs: 60 * 1000
});

/**
 * Initialize Twitter API client with OAuth 2.0 Bearer Token
 */
function initializeTwitterClient() {
  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  
  if (!bearerToken) {
    throw new Error('TWITTER_BEARER_TOKEN is required');
  }

  twitterClient = new TwitterApi(bearerToken);
  streamClient = twitterClient.v2;
  
  logger.info('Twitter client initialized with Bearer Token');
  return twitterClient;
}

/**
 * Get existing stream rules
 */
async function getStreamRules() {
  try {
    await rateLimiter.checkLimit();
    const rules = await streamClient.streamRules();
    return rules.data || [];
  } catch (error) {
    logger.error('Error fetching stream rules:', error);
    throw error;
  }
}

/**
 * Delete all existing stream rules
 */
async function deleteAllStreamRules() {
  try {
    const rules = await getStreamRules();
    
    if (rules.length > 0) {
      await rateLimiter.checkLimit();
      const ruleIds = rules.map(rule => rule.id);
      await streamClient.updateStreamRules({
        delete: { ids: ruleIds }
      });
      logger.info(`Deleted ${ruleIds.length} existing stream rules`);
    }
  } catch (error) {
    logger.error('Error deleting stream rules:', error);
    throw error;
  }
}

/**
 * Add a new stream rule for a topic
 */
async function addStreamRule(topic) {
  try {
    await rateLimiter.checkLimit();
    
    // Create rule with language filter for English tweets
    const rule = {
      value: `${topic} lang:en -is:retweet -is:reply`,
      tag: `topic:${topic}`
    };

    const result = await streamClient.updateStreamRules({
      add: [rule]
    });

    if (result.errors && result.errors.length > 0) {
      logger.error('Stream rule errors:', result.errors);
      throw new Error(`Failed to add stream rule: ${JSON.stringify(result.errors)}`);
    }

    logger.info(`Added stream rule for topic: ${topic}`);
    return result;
  } catch (error) {
    logger.error('Error adding stream rule:', error);
    throw error;
  }
}

/**
 * Process incoming tweet from stream
 */
async function processTweet(tweet, includes) {
  try {
    const tweetData = {
      id: tweet.id,
      text: tweet.text,
      author_id: tweet.author_id,
      created_at: tweet.created_at || new Date().toISOString(),
      topic: currentTopic,
      metrics: tweet.public_metrics || {},
      lang: tweet.lang || 'en',
      source: 'twitter_stream',
      timestamp: Date.now()
    };

    // Add author information if available
    if (includes && includes.users) {
      const author = includes.users.find(u => u.id === tweet.author_id);
      if (author) {
        tweetData.author = {
          id: author.id,
          name: author.name,
          username: author.username,
          profile_image_url: author.profile_image_url
        };
      }
    }

    // Publish to Kafka
    await publishTweet(tweetData);
    
    // Broadcast to WebSocket clients
    broadcastTweet(tweetData);

    logger.debug(`Processed tweet ${tweet.id}`);
    return tweetData;
  } catch (error) {
    logger.error('Error processing tweet:', error);
    throw error;
  }
}

/**
 * Start streaming tweets for a topic
 */
async function startStream(topic) {
  if (!twitterClient) {
    initializeTwitterClient();
  }

  if (isStreaming) {
    logger.warn('Stream already active, stopping previous stream');
    await stopStream();
  }

  try {
    currentTopic = topic;
    reconnectAttempts = 0;

    // Clear existing rules and add new one
    await deleteAllStreamRules();
    await addStreamRule(topic);

    // Start the filtered stream
    await rateLimiter.checkLimit();
    
    const stream = await streamClient.searchStream({
      'tweet.fields': ['created_at', 'public_metrics', 'lang', 'author_id'],
      'user.fields': ['name', 'username', 'profile_image_url'],
      expansions: ['author_id']
    });

    isStreaming = true;
    logger.info(`Started streaming tweets for topic: ${topic}`);

    // Handle stream events
    stream.on('data', async (data) => {
      try {
        if (data.data) {
          await processTweet(data.data, data.includes);
        }
      } catch (error) {
        logger.error('Error in stream data handler:', error);
      }
    });

    stream.on('error', async (error) => {
      logger.error('Stream error:', error);
      await handleStreamError(error, topic);
    });

    stream.on('end', () => {
      logger.info('Stream ended');
      isStreaming = false;
    });

    // Store stream reference for cleanup
    global.activeStream = stream;

    return { status: 'streaming', topic };
  } catch (error) {
    logger.error('Error starting stream:', error);
    isStreaming = false;
    throw error;
  }
}

/**
 * Handle stream errors with exponential backoff reconnection
 */
async function handleStreamError(error, topic) {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error('Max reconnect attempts reached, stopping stream');
    isStreaming = false;
    return;
  }

  // Check for rate limit errors
  if (error.code === 429 || error.rateLimit) {
    const resetTime = error.rateLimit?.reset || Date.now() + 60000;
    const waitTime = Math.max(resetTime - Date.now(), 60000);
    
    logger.warn(`Rate limited, waiting ${waitTime}ms before reconnecting`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  } else {
    // Exponential backoff for other errors
    const delay = RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttempts);
    logger.warn(`Stream error, reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1})`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  reconnectAttempts++;
  
  try {
    await startStream(topic);
  } catch (reconnectError) {
    logger.error('Reconnection failed:', reconnectError);
  }
}

/**
 * Stop the current stream
 */
async function stopStream() {
  if (global.activeStream) {
    try {
      global.activeStream.destroy();
      global.activeStream = null;
    } catch (error) {
      logger.error('Error destroying stream:', error);
    }
  }

  isStreaming = false;
  currentTopic = null;
  
  // Clean up stream rules
  try {
    await deleteAllStreamRules();
  } catch (error) {
    logger.warn('Error cleaning up stream rules:', error);
  }

  logger.info('Stream stopped');
  return { status: 'stopped' };
}

/**
 * Get current stream status
 */
function getStreamStatus() {
  return {
    isStreaming,
    topic: currentTopic,
    reconnectAttempts
  };
}

/**
 * Initialize Twitter stream on startup
 */
async function initializeTwitterStream() {
  try {
    initializeTwitterClient();
    logger.info('Twitter stream service ready');
  } catch (error) {
    logger.error('Failed to initialize Twitter stream:', error);
  }
}

/**
 * Search tweets by query (for historical data)
 */
async function searchTweets(query, maxResults = 100) {
  if (!twitterClient) {
    initializeTwitterClient();
  }

  try {
    await rateLimiter.checkLimit();
    
    const result = await streamClient.search(query, {
      max_results: Math.min(maxResults, 100),
      'tweet.fields': ['created_at', 'public_metrics', 'lang', 'author_id'],
      'user.fields': ['name', 'username', 'profile_image_url'],
      expansions: ['author_id']
    });

    const tweets = [];
    for await (const tweet of result) {
      tweets.push(tweet);
      if (tweets.length >= maxResults) break;
    }

    return tweets;
  } catch (error) {
    logger.error('Error searching tweets:', error);
    throw error;
  }
}

module.exports = {
  initializeTwitterStream,
  initializeTwitterClient,
  startStream,
  stopStream,
  getStreamStatus,
  searchTweets,
  getStreamRules
};
