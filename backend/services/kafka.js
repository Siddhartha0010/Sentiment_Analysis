const { Kafka, Partitioners, logLevel } = require('kafkajs');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TWEET_TOPIC = process.env.KAFKA_TWEET_TOPIC || 'tweet_topic';
const SENTIMENT_TOPIC = process.env.KAFKA_SENTIMENT_TOPIC || 'sentiment_topic';
const CLIENT_ID = process.env.KAFKA_CLIENT_ID || 'sentiment-backend';

let kafka = null;
let producer = null;
let consumer = null;
let isConnected = false;

/**
 * Custom Kafka logger adapter
 */
const kafkaLogCreator = () => ({ namespace, level, log }) => {
  const { message, ...extra } = log;
  switch (level) {
    case logLevel.ERROR:
      logger.error(`[Kafka:${namespace}] ${message}`, extra);
      break;
    case logLevel.WARN:
      logger.warn(`[Kafka:${namespace}] ${message}`, extra);
      break;
    case logLevel.INFO:
      logger.info(`[Kafka:${namespace}] ${message}`, extra);
      break;
    default:
      logger.debug(`[Kafka:${namespace}] ${message}`, extra);
  }
};

/**
 * Initialize Kafka client and producer
 */
async function initializeKafka() {
  try {
    kafka = new Kafka({
      clientId: CLIENT_ID,
      brokers: KAFKA_BROKERS,
      logLevel: logLevel.INFO,
      logCreator: kafkaLogCreator,
      retry: {
        initialRetryTime: 100,
        retries: 8,
        maxRetryTime: 30000,
        factor: 2
      },
      connectionTimeout: 10000,
      requestTimeout: 30000
    });

    // Initialize producer
    producer = kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
      allowAutoTopicCreation: true,
      transactionTimeout: 30000
    });

    await producer.connect();
    isConnected = true;
    
    logger.info('Kafka producer connected', { brokers: KAFKA_BROKERS });

    // Handle producer events
    producer.on('producer.disconnect', () => {
      logger.warn('Kafka producer disconnected');
      isConnected = false;
    });

    producer.on('producer.connect', () => {
      logger.info('Kafka producer reconnected');
      isConnected = true;
    });

    return { producer, kafka };
  } catch (error) {
    logger.error('Failed to initialize Kafka:', error);
    throw error;
  }
}

/**
 * Publish a tweet to Kafka
 */
async function publishTweet(tweetData) {
  if (!producer || !isConnected) {
    logger.error('Kafka producer not available');
    throw new Error('Kafka producer not connected');
  }

  try {
    const message = {
      key: tweetData.id || uuidv4(),
      value: JSON.stringify({
        ...tweetData,
        published_at: Date.now()
      }),
      headers: {
        'content-type': 'application/json',
        'source': 'twitter-stream',
        'topic': tweetData.topic || 'unknown'
      }
    };

    const result = await producer.send({
      topic: TWEET_TOPIC,
      messages: [message],
      acks: 1, // Wait for leader acknowledgment
      timeout: 5000
    });

    logger.debug(`Tweet published to Kafka`, { 
      tweetId: tweetData.id, 
      partition: result[0].partition,
      offset: result[0].offset 
    });

    return result;
  } catch (error) {
    logger.error('Error publishing tweet to Kafka:', error);
    throw error;
  }
}

/**
 * Publish sentiment result to Kafka
 */
async function publishSentiment(sentimentData) {
  if (!producer || !isConnected) {
    logger.error('Kafka producer not available');
    throw new Error('Kafka producer not connected');
  }

  try {
    const message = {
      key: sentimentData.tweet_id || uuidv4(),
      value: JSON.stringify({
        ...sentimentData,
        processed_at: Date.now()
      }),
      headers: {
        'content-type': 'application/json',
        'sentiment': sentimentData.sentiment || 'unknown'
      }
    };

    const result = await producer.send({
      topic: SENTIMENT_TOPIC,
      messages: [message],
      acks: 1,
      timeout: 5000
    });

    logger.debug(`Sentiment published to Kafka`, { 
      tweetId: sentimentData.tweet_id,
      sentiment: sentimentData.sentiment
    });

    return result;
  } catch (error) {
    logger.error('Error publishing sentiment to Kafka:', error);
    throw error;
  }
}

/**
 * Publish batch of tweets to Kafka
 */
async function publishTweetBatch(tweets) {
  if (!producer || !isConnected) {
    throw new Error('Kafka producer not connected');
  }

  try {
    const messages = tweets.map(tweet => ({
      key: tweet.id || uuidv4(),
      value: JSON.stringify({
        ...tweet,
        published_at: Date.now()
      }),
      headers: {
        'content-type': 'application/json',
        'source': 'twitter-stream',
        'topic': tweet.topic || 'unknown'
      }
    }));

    const result = await producer.send({
      topic: TWEET_TOPIC,
      messages,
      acks: 1,
      timeout: 10000
    });

    logger.info(`Batch of ${tweets.length} tweets published to Kafka`);
    return result;
  } catch (error) {
    logger.error('Error publishing tweet batch to Kafka:', error);
    throw error;
  }
}

/**
 * Initialize consumer for sentiment results
 */
async function initializeConsumer(groupId, topics, messageHandler) {
  try {
    consumer = kafka.consumer({ 
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 1048576
    });

    await consumer.connect();
    
    for (const topic of topics) {
      await consumer.subscribe({ topic, fromBeginning: false });
    }

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const value = JSON.parse(message.value.toString());
          await messageHandler(topic, value, { partition, offset: message.offset });
        } catch (error) {
          logger.error('Error processing Kafka message:', error);
        }
      }
    });

    logger.info('Kafka consumer initialized', { groupId, topics });
    return consumer;
  } catch (error) {
    logger.error('Failed to initialize Kafka consumer:', error);
    throw error;
  }
}

/**
 * Get Kafka producer instance
 */
function getKafkaProducer() {
  return producer;
}

/**
 * Get Kafka connection status
 */
function getKafkaStatus() {
  return {
    connected: isConnected,
    brokers: KAFKA_BROKERS,
    topics: {
      tweets: TWEET_TOPIC,
      sentiment: SENTIMENT_TOPIC
    }
  };
}

/**
 * Disconnect from Kafka
 */
async function disconnectKafka() {
  try {
    if (consumer) {
      await consumer.disconnect();
    }
    if (producer) {
      await producer.disconnect();
    }
    isConnected = false;
    logger.info('Kafka disconnected');
  } catch (error) {
    logger.error('Error disconnecting from Kafka:', error);
  }
}

module.exports = {
  initializeKafka,
  publishTweet,
  publishSentiment,
  publishTweetBatch,
  initializeConsumer,
  getKafkaProducer,
  getKafkaStatus,
  disconnectKafka
};
