"use strict";
/**
 * rss.js  —  RSS Ingestion Service (Rewritten)
 * ==============================================
 * KEY CHANGES vs original
 * ────────────────────────
 * 1. SPEED  → pollAll() used sequential `for...of` with `await pollFeed()`.
 *              If feed 1 takes 9 s (timeout is 10 s), feed 2 doesn't start
 *              until 9 s later. Changed to Promise.all so all feeds are
 *              fetched concurrently within each poll cycle.
 *
 * 2. SPEED  → Added _isPolling guard flag so that if a poll cycle takes
 *              longer than POLL_INTERVAL_MS (e.g. slow Google News), the
 *              next timer tick is skipped instead of creating overlapping
 *              fetches that flood Kafka with duplicates.
 *
 * 3. CLEAN  → All public function signatures unchanged.
 */

const Parser = require("rss-parser");
const crypto = require("crypto");
const logger = require("../utils/logger");
const { publishTweet, publishSentiment } = require("./kafka");
const { analyzeHeadline } = require("./sentiment");

const parser = new Parser({
  // Fail faster so the next poll cycle can retry; 10s felt sluggish for first paint.
  timeout: 6_000,
  headers: { "User-Agent": "SentimentStream-RSS/1.0" },
});

const POLL_INTERVAL_MS = Math.max(2_000, parseInt(process.env.RSS_POLL_INTERVAL_MS || "2500", 10));
const EXTRA_GOOGLE_NEWS_FEED = (process.env.RSS_EXTRA_GOOGLE_NEWS_REGION || "true").toLowerCase() !== "false";
const ENABLE_FALLBACK_FEEDS = (process.env.RSS_ENABLE_FALLBACK_FEEDS || "false").toLowerCase() === "true";
const MAX_ARTICLE_AGE_HOURS = Math.max(1, parseInt(process.env.RSS_MAX_ARTICLE_AGE_HOURS || "24", 10));
const MAX_CONTENT_SEEN_SIZE = 20_000;

let pollTimer      = null;
let _isPolling     = false;   // FIX: guard against overlapping poll cycles
let currentTopic   = null;
let feedUrls       = [];
const seenIds      = new Set();
const MAX_SEEN_SIZE = 10_000;
const seenContentKeys = new Set();


// ── Helpers ───────────────────────────────────────────────────────────────────
function getItemId(item) {
  const id = item.guid || item.link || null;
  if (id) return id;
  return `${item.title || ""}-${item.pubDate || Date.now()}`.trim()
    || `rss-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function trimSeenIfNeeded() {
  if (seenIds.size > MAX_SEEN_SIZE) {
    const arr      = [...seenIds];
    const toRemove = arr.length - Math.floor(MAX_SEEN_SIZE * 0.5);
    for (let i = 0; i < toRemove; i++) seenIds.delete(arr[i]);
    logger.debug(`RSS seen set trimmed to ${seenIds.size}`);
  }
}

function trimContentSeenIfNeeded() {
  if (seenContentKeys.size > MAX_CONTENT_SEEN_SIZE) {
    const arr = [...seenContentKeys];
    const toRemove = arr.length - Math.floor(MAX_CONTENT_SEEN_SIZE * 0.5);
    for (let i = 0; i < toRemove; i++) seenContentKeys.delete(arr[i]);
  }
}

function itemToPayload(item, topic) {
  // We append Date.now() to ensure that if the user restarts the stream,
  // re-ingested articles are treated as fresh live events rather than crashing PySpark with duplicate primary keys.
  const id = (item.guid || item.id || crypto.randomUUID()) + "-" + Date.now();
  const title = (item.title || "").trim();
  const description = (item.contentSnippet || item.content || item.summary || "").trim();
  const text = `${title} ${description}`.trim().substring(0, 1_000);

  const publishedRaw = item.pubDate || item.isoDate || item.published || null;
  const publishedDate = publishedRaw ? new Date(publishedRaw) : null;
  const effectivePublishedAt = publishedDate && Number.isFinite(publishedDate.getTime())
    ? publishedDate
    : new Date();
  const processedAt = new Date();

  return {
    id,
    title,
    description,
    text,
    author_id:  "rss",
    topic:      topic || currentTopic || "rss",
    created_at: effectivePublishedAt.toISOString(),
    published_at: effectivePublishedAt.toISOString(),
    processed_at: processedAt.toISOString(),
    timestamp:  effectivePublishedAt.getTime(),
    processed_timestamp: processedAt.getTime(),
    author:     { id: "rss", name: "RSS Feed", username: "rss", profile_image_url: null },
    metrics:    {},
    source:     "rss_stream",
  };
}

function getContentKey(item, topic) {
  const title = (item?.title || "").toLowerCase().replace(/\s+/g, " ").trim();
  const snippet = (item?.contentSnippet || item?.content || item?.summary || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const published = item?.pubDate || item?.isoDate || item?.published || "";
  // Topic + title/snippet + publish date is stable enough to suppress duplicates.
  return `${String(topic || "").toLowerCase()}|${title}|${snippet}|${published}`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Shorter Google News queries return faster; full topic string still used for relevance filtering. */
function compactGoogleNewsQuery(topic) {
  const t = String(topic || "").trim().replace(/\s+/g, " ");
  if (t.length <= 96) return t;
  const words = t.split(" ");
  if (words.length > 12) return words.slice(0, 12).join(" ");
  return t.slice(0, 96);
}

function topicKeywords(topic) {
  return String(topic || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 2);
}

function isRelevantToTopic(item, topic) {
  const keywords = topicKeywords(topic);
  if (keywords.length === 0) return true;

  const haystack = [
    item?.title || "",
    item?.contentSnippet || "",
    item?.content || "",
    item?.summary || "",
  ].join(" ").toLowerCase();

  // For short tokens like "ipl", enforce whole-word match.
  // For longer tokens, substring is acceptable.
  return keywords.some((kw) => {
    if (kw.length <= 4) {
      const re = new RegExp(`\\b${escapeRegex(kw)}\\b`, "i");
      return re.test(haystack);
    }
    return haystack.includes(kw);
  });
}

function isWithinAgeWindow(item) {
  const publishedRaw = item?.pubDate || item?.isoDate || item?.published || null;
  if (!publishedRaw) return true; // if feed doesn't expose pubDate, don't hard-drop
  const publishedDate = new Date(publishedRaw);
  if (!Number.isFinite(publishedDate.getTime())) return true;
  const ageMs = Date.now() - publishedDate.getTime();
  return ageMs >= 0 && ageMs <= MAX_ARTICLE_AGE_HOURS * 60 * 60 * 1000;
}

async function pollFeed(url, topic) {
  let publishedCount = 0;
  try {
    const feed       = await parser.parseURL(url);
    const topicLabel = topic || currentTopic || feed.title || "rss";

    for (const item of feed.items || []) {
      if (!isRelevantToTopic(item, topicLabel)) continue;
      if (!isWithinAgeWindow(item)) continue;

      const contentKey = getContentKey(item, topicLabel);
      if (seenContentKeys.has(contentKey)) continue;

      const id = getItemId(item);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      seenContentKeys.add(contentKey);
      trimSeenIfNeeded();
      trimContentSeenIfNeeded();

      const payload = itemToPayload(item, topicLabel);
      try {
        const result = analyzeHeadline({
          title: payload.title,
          description: payload.description,
          publishedAt: payload.published_at,
        });
        const explanation = Array.isArray(result.explanation)
          ? result.explanation
          : Array.isArray(result.reason_keywords)
            ? result.reason_keywords
            : [];
        await Promise.all([
          // Keep raw tweet topic flow for observability / future Spark usage.
          publishTweet(payload),
          publishSentiment({
            tweet_id: payload.id,
            title: result.title,
            description: result.description,
            tweet_text: result.combined_text,
            combined_text: result.combined_text,
            text: result.combined_text,
            topic: payload.topic,
            sentiment: result.sentiment_label,
            confidence: result.confidence,
            compound_score: result.compound_score,
            reason_keywords: result.reason_keywords || [],
            explanation,
            sentiment_reason: explanation.join(", "),
            created_at: result.published_at || payload.published_at,
            published_at: result.published_at || payload.published_at,
            processed_at: result.processed_at || payload.processed_at,
            timestamp: payload.timestamp,
            processed_timestamp: payload.processed_timestamp,
            source: "rss_stream_vader",
            model: "vader+boost",
          }),
        ]);
        publishedCount += 1;
        logger.debug(`RSS item published: ${payload.id}`);
      } catch (err) {
        logger.error("RSS publish error:", err);
      }
    }
  } catch (err) {
    logger.error(`RSS poll error for ${url}:`, err.message);
  }
  return publishedCount;
}

/**
 * FIX: Promise.all for concurrent feed fetching + _isPolling guard
 */
async function pollAll() {
  if (!currentTopic || feedUrls.length === 0) return;
  if (_isPolling) {
    logger.debug("RSS: skipping poll cycle — previous cycle still running");
    return;
  }

  _isPolling = true;
  try {
    const counts = await Promise.all(feedUrls.map((url) => pollFeed(url.trim(), currentTopic)));
    const totalPublished = counts.reduce((sum, n) => sum + (n || 0), 0);

    // Optional fallback (disabled by default): still guarded by relevance filter.
    if (ENABLE_FALLBACK_FEEDS && totalPublished === 0) {
      await pollFeed("https://feeds.bbci.co.uk/news/rss.xml", currentTopic);
      await pollFeed("https://news.ycombinator.com/rss", currentTopic);
    }
  } finally {
    _isPolling = false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
function startStream(topic, urls) {
  if (pollTimer) stopStream();

  // FIX: Unconditionally clear the anti-spam memory.
  // If the user wiped Kafka manually, we need to re-send the articles we already "saw" 
  // so that the empty Kafka/DB gets populated instantly without waiting 2 hours for fresh news.
  seenIds.clear();
  seenContentKeys.clear();

  if (!topic || typeof topic !== "string" || !topic.trim()) {
    throw new Error("Topic is required");
  }
  currentTopic = topic.trim();

  // Two Google News endpoints in parallel (US + IN) so regional/political queries resolve faster
  // without enabling generic fallback feeds. Duplicates are still filtered by content key.
  const q = compactGoogleNewsQuery(currentTopic);
  const usNews = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const inNews = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
  if (Array.isArray(urls) && urls.length > 0) {
    feedUrls = urls;
  } else if (EXTRA_GOOGLE_NEWS_FEED) {
    feedUrls = [usNews, inNews];
  } else {
    feedUrls = [usNews];
  }

  logger.info(`RSS stream started for "${currentTopic}" with ${feedUrls.length} feed(s)`);
  pollAll(); // immediate first poll
  pollTimer = setInterval(pollAll, POLL_INTERVAL_MS);
  return { status: "streaming", topic: currentTopic };
}

function stopStream() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  currentTopic = null;
  feedUrls     = [];
  _isPolling   = false;
  seenIds.clear();
  seenContentKeys.clear();
  logger.info("RSS stream stopped");
  return { status: "stopped" };
}

function getStreamStatus() {
  return { isStreaming: !!pollTimer, topic: currentTopic, feedCount: feedUrls.length };
}

function initializeRss() {
  logger.info("RSS service ready");
}

module.exports = { initializeRss, startStream, stopStream, getStreamStatus };