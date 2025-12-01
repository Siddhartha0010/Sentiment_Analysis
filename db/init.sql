-- Create database if not exists
CREATE DATABASE IF NOT EXISTS sentiment_db;
USE sentiment_db;

-- Tweets table to store processed tweets
CREATE TABLE IF NOT EXISTS tweets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tweet_id VARCHAR(255) UNIQUE NOT NULL,
    topic VARCHAR(255) NOT NULL,
    text TEXT NOT NULL,
    cleaned_text TEXT,
    sentiment VARCHAR(20) NOT NULL,
    confidence DECIMAL(5,4),
    positive_score DECIMAL(5,4),
    negative_score DECIMAL(5,4),
    neutral_score DECIMAL(5,4),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_topic (topic),
    INDEX idx_sentiment (sentiment),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sentiment statistics table for aggregated data
CREATE TABLE IF NOT EXISTS sentiment_stats (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    topic VARCHAR(255) NOT NULL,
    time_window TIMESTAMP NOT NULL,
    total_count INT DEFAULT 0,
    positive_count INT DEFAULT 0,
    negative_count INT DEFAULT 0,
    neutral_count INT DEFAULT 0,
    positive_percentage DECIMAL(5,2),
    negative_percentage DECIMAL(5,2),
    neutral_percentage DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_topic_window (topic, time_window),
    INDEX idx_topic_time (topic, time_window)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trending topics table
CREATE TABLE IF NOT EXISTS trending_topics (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    topic VARCHAR(255) NOT NULL,
    tweet_count INT DEFAULT 0,
    sentiment_score DECIMAL(5,2),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_topic (topic),
    INDEX idx_tweet_count (tweet_count),
    INDEX idx_last_updated (last_updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sentiment alerts table for spike detection
CREATE TABLE IF NOT EXISTS sentiment_alerts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    topic VARCHAR(255) NOT NULL,
    alert_type VARCHAR(50) NOT NULL,
    message TEXT,
    sentiment_change DECIMAL(5,2),
    triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_topic (topic),
    INDEX idx_triggered_at (triggered_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create user for application access
CREATE USER IF NOT EXISTS 'sentiment_user'@'%' IDENTIFIED BY 'sentiment_pass';
GRANT ALL PRIVILEGES ON sentiment_db.* TO 'sentiment_user'@'%';
FLUSH PRIVILEGES;
