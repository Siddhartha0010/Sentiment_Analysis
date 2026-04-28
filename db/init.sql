-- =============================================================================
-- init.sql  —  Schema + Indexes (Rewritten)
-- =============================================================================
-- KEY CHANGES vs original
-- ────────────────────────
-- 1. SPEED  → Added composite covering index (topic, created_at, sentiment)
--             on tweets table. This is the single most impactful change.
--             Every stats query does WHERE topic=? AND created_at>=? GROUP BY
--             sentiment — without this, MariaDB full-scanned idx_topic then
--             filtered rows one by one. Now the whole query is served from
--             the index with zero table access.
--
-- 2. SPEED  → Added (topic, sentiment, created_at) index for GROUP BY queries
--             that filter on both topic and sentiment before time-bucketing.
--
-- 3. SPEED  → Added (topic, processed_at) index — used by "recent tweets"
--             ORDER BY processed_at DESC queries.
--
-- 4. SPEED  → Dropped the redundant single-column idx_topic and idx_sentiment
--             indexes on tweets — they are fully covered by the new composite
--             indexes and were causing unnecessary write overhead on every
--             Spark batch insert.
--
-- 5. SPEED  → Added (topic, time_window DESC) index on sentiment_stats for
--             fast time-series reads.
--
-- 6. SPEED  → Added (topic, triggered_at DESC) on sentiment_alerts for fast
--             per-topic alert queries.
--
-- 7. CLEAN  → Added ALTER TABLE ... IF NOT EXISTS guard pattern via
--             separate migration block at the bottom so this file is safe
--             to run against an existing database (idempotent).
-- =============================================================================

CREATE DATABASE IF NOT EXISTS sentiment_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE sentiment_db;

-- =============================================================================
-- tweets
-- =============================================================================
CREATE TABLE IF NOT EXISTS tweets (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    tweet_id     VARCHAR(255)   NOT NULL,
    topic        VARCHAR(255)   NOT NULL,
    text         TEXT           NOT NULL,
    cleaned_text TEXT,
    sentiment    VARCHAR(20)    NOT NULL,
    confidence   DECIMAL(5,4),

    -- kept for schema compatibility; populated by Spark if needed
    positive_score DECIMAL(5,4),
    negative_score DECIMAL(5,4),
    neutral_score  DECIMAL(5,4),

    created_at   TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- ── Uniqueness ────────────────────────────────────────────────────────────
    UNIQUE KEY uq_tweet_id (tweet_id),

    -- ── PRIMARY query pattern: WHERE topic=? AND created_at>=? GROUP BY sentiment
    --    This covering index serves the entire query from the index tree —
    --    no table row access needed.
    INDEX idx_topic_created_sentiment (topic, created_at, sentiment),

    -- ── Secondary pattern: WHERE topic=? AND sentiment=? (alert queries,
    --    filtered tweet lists)
    INDEX idx_topic_sentiment_created (topic, sentiment, created_at),

    -- ── "Recent tweets" feed: WHERE topic=? ORDER BY processed_at DESC
    INDEX idx_topic_processed (topic, processed_at)

    -- NOTE: single-column idx_topic and idx_sentiment removed — they are
    --       fully subsumed by the composite indexes above and only added
    --       extra write overhead per Spark batch insert.

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- sentiment_stats  (pre-aggregated windows — written by a future aggregator)
-- =============================================================================
CREATE TABLE IF NOT EXISTS sentiment_stats (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    topic            VARCHAR(255) NOT NULL,
    time_window      TIMESTAMP    NOT NULL,
    total_count      INT          DEFAULT 0,
    positive_count   INT          DEFAULT 0,
    negative_count   INT          DEFAULT 0,
    neutral_count    INT          DEFAULT 0,
    positive_percentage DECIMAL(5,2),
    negative_percentage DECIMAL(5,2),
    neutral_percentage  DECIMAL(5,2),
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_topic_window (topic, time_window),

    -- Descending so ORDER BY time_window DESC is index-only
    INDEX idx_topic_time_desc (topic, time_window DESC)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- trending_topics
-- =============================================================================
CREATE TABLE IF NOT EXISTS trending_topics (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    topic           VARCHAR(255)  NOT NULL,
    tweet_count     INT           DEFAULT 0,
    sentiment_score DECIMAL(5,2),
    last_updated    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_topic (topic),

    -- ORDER BY tweet_count DESC (leaderboard queries)
    INDEX idx_tweet_count_desc (tweet_count DESC),

    -- ORDER BY last_updated DESC (recency queries)
    INDEX idx_last_updated_desc (last_updated DESC)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- sentiment_alerts
-- =============================================================================
CREATE TABLE IF NOT EXISTS sentiment_alerts (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    topic            VARCHAR(255) NOT NULL,
    alert_type       VARCHAR(50)  NOT NULL,
    message          TEXT,
    sentiment_change DECIMAL(5,2),
    triggered_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- WHERE topic=? ORDER BY triggered_at DESC  (alert feed per topic)
    INDEX idx_topic_triggered_desc (topic, triggered_at DESC),

    -- Global alert feed: ORDER BY triggered_at DESC
    INDEX idx_triggered_desc (triggered_at DESC)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Application user
-- =============================================================================
CREATE USER IF NOT EXISTS 'sentiment_user'@'%' IDENTIFIED BY 'sentiment_pass';
GRANT ALL PRIVILEGES ON sentiment_db.* TO 'sentiment_user'@'%';
FLUSH PRIVILEGES;


-- =============================================================================
-- MIGRATION BLOCK
-- Run this section if applying to an EXISTING database to add the new indexes
-- without recreating the tables (safe to run multiple times — IF NOT EXISTS
-- is idempotent for indexes in MariaDB 10.5+).
-- =============================================================================

-- Drop old under-powered single-column indexes (ignore error if already gone)
ALTER TABLE tweets
    DROP INDEX IF EXISTS idx_topic,
    DROP INDEX IF EXISTS idx_sentiment,
    DROP INDEX IF EXISTS idx_created_at;

-- Add new composite indexes only if they don't already exist
ALTER TABLE tweets
    ADD INDEX IF NOT EXISTS idx_topic_created_sentiment (topic, created_at, sentiment),
    ADD INDEX IF NOT EXISTS idx_topic_sentiment_created (topic, sentiment, created_at),
    ADD INDEX IF NOT EXISTS idx_topic_processed         (topic, processed_at);

ALTER TABLE sentiment_stats
    DROP INDEX IF EXISTS idx_topic_time,
    ADD INDEX IF NOT EXISTS idx_topic_time_desc (topic, time_window DESC);

ALTER TABLE sentiment_alerts
    DROP INDEX IF EXISTS idx_topic,
    DROP INDEX IF EXISTS idx_triggered_at,
    ADD INDEX IF NOT EXISTS idx_topic_triggered_desc (topic, triggered_at DESC),
    ADD INDEX IF NOT EXISTS idx_triggered_desc       (triggered_at DESC);

ALTER TABLE trending_topics
    DROP INDEX IF EXISTS idx_tweet_count,
    DROP INDEX IF EXISTS idx_last_updated,
    ADD INDEX IF NOT EXISTS idx_tweet_count_desc  (tweet_count DESC),
    ADD INDEX IF NOT EXISTS idx_last_updated_desc (last_updated DESC);