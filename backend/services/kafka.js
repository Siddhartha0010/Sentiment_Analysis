"use strict";
/**
 * kafka.js  —  Kafka Producer + Consumer (Rewritten)
 * ====================================================
 * KEY CHANGES vs original
 * ────────────────────────
 * 1. SPEED  → eachMessage → eachBatch
 *             Processes the whole Kafka fetch in one call instead of
 *             one async function invocation per message. Dramatically
 *             reduces per-message overhead at high throughput.
 *
 * 2. SPEED  → require('./websocket') and require('./sentimentAggregator')
 *             are now resolved ONCE at first use and cached in module-level
 *             variables. Previously they were resolved on EVERY message,
 *             which hits Node's module registry on each iteration.
 *
 * 3. SPEED  → autoCommitInterval set to 1000 ms (was: commit after every
 *             message). Reduces broker round-trips by ~10-20x at typical
 *             RSS ingestion rates.
 *
 * 4. SPEED  → Consumer heartbeatInterval / sessionTimeout tuned so the
 *             broker doesn't trigger unnecessary rebalances during Spark
 *             processing pauses.
 *
 * 5. CLEAN  → All public-facing function signatures unchanged — drop-in
 *             replacement for the rest of the codebase.
 */

const { Kafka, Partitioners, logLevel } = require("kafkajs");
const logger = require("../utils/logger");
const { v4: uuidv4 } = require("uuid");
const { saveTweet } = require("./database");

// ── Config ─────────────────────────────────────────────────────────────────────
const KAFKA_BROKERS    = (process.env.KAFKA_BROKERS || "127.0.0.1:9092").split(",");
const TWEET_TOPIC      = process.env.KAFKA_TWEET_TOPIC     || "tweet_topic";
const SENTIMENT_TOPIC  = process.env.KAFKA_SENTIMENT_TOPIC || "sentiment_topic";
const CLIENT_ID        = process.env.KAFKA_CLIENT_ID       || "sentiment-backend";

let kafka       = null;
let producer    = null;
let consumer    = null;
let isConnected = false;

// ── Lazy-loaded service refs (resolved once, not on every message) ────────────
let _broadcastTweet    = null;
let _addSentiment      = null;
let _broadcastAlert    = null;
let _ingestSentimentEvent = null;

function _getBroadcastTweet() {
  if (!_broadcastTweet) _broadcastTweet = require("./websocket").broadcastTweet;
  return _broadcastTweet;
}

function _getAddSentiment() {
  if (!_addSentiment) _addSentiment = require("./sentimentAggregator").addSentiment;
  return _addSentiment;
}

function _getBroadcastAlert() {
  if (!_broadcastAlert) _broadcastAlert = require("./websocket").broadcastAlert;
  return _broadcastAlert;
}

function _getIngestSentimentEvent() {
  if (!_ingestSentimentEvent) {
    _ingestSentimentEvent = require("./realtimeInsights").ingestSentimentEvent;
  }
  return _ingestSentimentEvent;
}

// ── Kafka logger adapter (unchanged) ──────────────────────────────────────────
const kafkaLogCreator = () => ({ namespace, level, log }) => {
  const { message, ...extra } = log;
  switch (level) {
    case logLevel.ERROR: logger.error(`[Kafka:${namespace}] ${message}`, extra); break;
    case logLevel.WARN:  logger.warn(`[Kafka:${namespace}] ${message}`, extra);  break;
    case logLevel.INFO:  logger.info(`[Kafka:${namespace}] ${message}`, extra);  break;
    default:             logger.debug(`[Kafka:${namespace}] ${message}`, extra);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Initialize
// ─────────────────────────────────────────────────────────────────────────────
async function initializeKafka() {
  try {
    kafka = new Kafka({
      clientId: CLIENT_ID,
      brokers:  KAFKA_BROKERS,
      logLevel: logLevel.INFO,
      logCreator: kafkaLogCreator,
      retry: {
        initialRetryTime: 100,
        retries:          8,
        maxRetryTime:     30_000,
        factor:           2,
      },
      connectionTimeout: 10_000,
      requestTimeout:    30_000,
    });

    // ── Producer ──────────────────────────────────────────────────────────────
    producer = kafka.producer({
      createPartitioner:   Partitioners.DefaultPartitioner,
      allowAutoTopicCreation: true,
      transactionTimeout:  30_000,
    });

    await producer.connect();
    isConnected = true;
    logger.info("Kafka producer connected", { brokers: KAFKA_BROKERS });

    producer.on("producer.disconnect", () => {
      logger.warn("Kafka producer disconnected");
      if (!consumer) isConnected = false;
    });
    producer.on("producer.connect", () => {
      logger.info("Kafka producer reconnected");
      isConnected = true;
    });

    // ── Consumer ──────────────────────────────────────────────────────────────
    consumer = kafka.consumer({
      groupId: "sentiment-dashboard-group",
      // SPEED: commit offsets every 1 s instead of after every message
      autoCommit:         true,
      autoCommitInterval: 1000,
      // SPEED: prevent spurious rebalances during Spark processing pauses
      heartbeatInterval:  3000,
      sessionTimeout:     30_000,
      maxWaitTimeInMs:    500,   // how long broker waits before returning empty fetch
    });

    await consumer.connect();

    consumer.on("consumer.disconnect", () => {
      logger.warn("Kafka consumer disconnected");
      if (!producer) isConnected = false;
    });
    consumer.on("consumer.connect", () => {
      logger.info("Kafka consumer reconnected");
      isConnected = true;
    });

    await consumer.subscribe({ topic: SENTIMENT_TOPIC, fromBeginning: false });

    // ── SPEED: eachBatch instead of eachMessage ───────────────────────────────
    await consumer.run({
      // Resolve service refs once outside the loop
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning }) => {
        const broadcastTweet = _getBroadcastTweet();
        const addSentiment   = _getAddSentiment();
        const broadcastAlert = _getBroadcastAlert();
        const ingestSentimentEvent = _getIngestSentimentEvent();
        const dbWrites = [];

        for (const message of batch.messages) {
          if (!isRunning()) break;

          try {
            const sentimentData = JSON.parse(message.value.toString());

            // Normalise sentiment label
            if (sentimentData.sentiment != null && sentimentData.sentiment !== "") {
              sentimentData.sentiment = String(sentimentData.sentiment).toLowerCase();
            }

            logger.debug(
              `Sentiment received: ${sentimentData.tweet_id} → ${sentimentData.sentiment}`
            );

            // Persist for API-driven chart/stat endpoints without blocking
            // per-message stream processing.
            dbWrites.push(
              saveTweet({
                id: sentimentData.tweet_id || sentimentData.id,
                text: sentimentData.tweet_text || sentimentData.text || "",
                topic: sentimentData.topic || "rss",
                sentiment: sentimentData.sentiment || "neutral",
                confidence: Number(sentimentData.confidence) || 0.5,
                published_at: sentimentData.published_at || sentimentData.created_at,
                processed_at: sentimentData.processed_at,
              }).catch((dbErr) => {
                logger.warn("DB write failed for sentiment event", { error: dbErr.message });
              })
            );

            // Aggregate for stats
            addSentiment(
              sentimentData.topic,
              sentimentData.sentiment,
              sentimentData.timestamp || Date.now()
            );

            const { alert, topKeywords } = ingestSentimentEvent({
              topic: sentimentData.topic || "rss",
              sentiment: sentimentData.sentiment,
              text: sentimentData.tweet_text || sentimentData.text || "",
              timestamp: sentimentData.timestamp || Date.now(),
            });

            // Push to WebSocket batch buffer (batched in websocket.js)
            broadcastTweet({
              ...sentimentData,
              id: sentimentData.tweet_id,
              top_keywords: topKeywords,
            });

            if (alert) {
              broadcastAlert(alert);
            }

            resolveOffset(message.offset);
          } catch (err) {
            logger.error("Error processing Kafka batch message:", err);
          }
        }

        // Keep consumer alive during large batches
        if (dbWrites.length > 0) {
          await Promise.allSettled(dbWrites);
        }
        await heartbeat();
      },
    });

    return { producer, consumer, kafka };
  } catch (error) {
    logger.error("Failed to initialize Kafka:", error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Publish helpers (unchanged signatures)
// ─────────────────────────────────────────────────────────────────────────────

async function publishTweet(tweetData) {
  _assertProducer();
  const result = await producer.send({
    topic: TWEET_TOPIC,
    messages: [_makeTweetMessage(tweetData)],
    acks:    1,
    timeout: 5_000,
  });
  logger.debug("Tweet published", {
    tweetId:   tweetData.id,
    partition: result[0].partition,
    offset:    result[0].offset,
  });
  return result;
}

async function publishSentiment(sentimentData) {
  _assertProducer();
  const message = {
    key:   sentimentData.tweet_id || uuidv4(),
    value: JSON.stringify({
      ...sentimentData,
      processed_at: sentimentData.processed_at || new Date().toISOString(),
    }),
    headers: {
      "content-type": "application/json",
      "sentiment":    sentimentData.sentiment || "unknown",
    },
  };
  const result = await producer.send({
    topic: SENTIMENT_TOPIC,
    messages: [message],
    acks:    1,
    timeout: 5_000,
  });
  logger.debug("Sentiment published", {
    tweetId:   sentimentData.tweet_id,
    sentiment: sentimentData.sentiment,
  });
  return result;
}

async function publishTweetBatch(tweets) {
  _assertProducer();
  const result = await producer.send({
    topic:    TWEET_TOPIC,
    messages: tweets.map(_makeTweetMessage),
    acks:     1,
    timeout:  10_000,
  });
  logger.info(`Batch of ${tweets.length} tweets published to Kafka`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status / lifecycle (unchanged signatures)
// ─────────────────────────────────────────────────────────────────────────────

function getKafkaProducer() {
  return producer;
}

function getKafkaStatus() {
  return {
    connected: isConnected,
    brokers:   KAFKA_BROKERS,
    topics:    { tweets: TWEET_TOPIC, sentiment: SENTIMENT_TOPIC },
  };
}

async function disconnectKafka() {
  try {
    if (producer) await producer.disconnect();
    if (consumer) await consumer.disconnect();
    isConnected = false;
    logger.info("Kafka disconnected");
  } catch (err) {
    logger.error("Error disconnecting from Kafka:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────
function _assertProducer() {
  if (!producer || !isConnected) throw new Error("Kafka producer not connected");
}

function _makeTweetMessage(tweet) {
  return {
    key:   tweet.id || uuidv4(),
    value: JSON.stringify({ ...tweet }),
    headers: {
      "content-type": "application/json",
      "source":       "rss-stream",
      "topic":        tweet.topic || "unknown",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  initializeKafka,
  publishTweet,
  publishSentiment,
  publishTweetBatch,
  getKafkaProducer,
  getKafkaStatus,
  disconnectKafka,
};