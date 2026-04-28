"use strict";
/**
 * sentimentAggregator.js  —  DB-backed Stats Broadcaster (Rewritten)
 * =====================================================================
 * KEY CHANGES vs original
 * ────────────────────────
 * 1. SPEED  → broadcastAggregations used a sequential `for...of` loop with
 *              await inside. If topic A's DB query takes 200 ms, topic B
 *              doesn't start until A finishes. Changed to Promise.all so all
 *              active topics query in parallel.
 *
 * 2. CLEAN  → All public function signatures unchanged.
 */

const logger = require("../utils/logger");
const { broadcastSentiment } = require("./websocket");
const { getSentimentStats }  = require("./database");

const AGGREGATION_INTERVAL_MS = 5000;
const activeTopics = new Set();
let broadcastInterval = null;

function addSentiment(topic, sentiment, timestamp) {
  if (topic) activeTopics.add(topic);
}

/**
 * FIX: all active topics now queried in parallel via Promise.all
 */
async function broadcastAggregations() {
  if (activeTopics.size === 0) return;

  await Promise.all(
    [...activeTopics].map(async (topic) => {
      try {
        const stats = await getSentimentStats(topic, "1h");

        let total = 0, positive = 0, negative = 0, neutral = 0;
        stats.forEach((s) => {
          const cnt = parseInt(s.count, 10);
          total += cnt;
          const label = (s.sentiment || "").toLowerCase();
          if      (label === "positive") positive += cnt;
          else if (label === "negative") negative += cnt;
          else                           neutral  += cnt;
        });

        if (total > 0) {
          broadcastSentiment({
            topic,
            total,
            positive,
            negative,
            neutral,
            positivePercent: Math.round((positive / total) * 10000) / 100,
            negativePercent: Math.round((negative / total) * 10000) / 100,
            neutralPercent:  Math.round((neutral  / total) * 10000) / 100,
            timestamp: Date.now(),
          });
          logger.debug(`Aggregation broadcast: ${topic} (total: ${total})`);
        }
      } catch (err) {
        logger.error(`Error aggregating stats for topic "${topic}":`, err);
      }
    })
  );
}

function startBroadcasting() {
  if (!broadcastInterval) {
    broadcastInterval = setInterval(broadcastAggregations, AGGREGATION_INTERVAL_MS);
    logger.info("Sentiment aggregation broadcasting started");
  }
}

function stopBroadcasting() {
  if (broadcastInterval) {
    clearInterval(broadcastInterval);
    broadcastInterval = null;
    logger.info("Sentiment aggregation broadcasting stopped");
  }
}

function clearTopic(topic) {
  activeTopics.delete(topic);
  logger.debug(`Stopped tracking topic: ${topic}`);
}

function initializeAggregator() {
  startBroadcasting();
  logger.info("Sentiment aggregator initialized");
}

module.exports = {
  initializeAggregator,
  addSentiment,
  startBroadcasting,
  stopBroadcasting,
  clearTopic,
};