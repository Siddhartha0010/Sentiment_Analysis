require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const logger = require('./utils/logger');
const { initializeKafka, getKafkaProducer } = require('./services/kafka');
const { initializeTwitterStream } = require('./services/twitter');
const { initializeDatabase } = require('./services/database');
const { initializeCache } = require('./services/cache');
const apiRoutes = require('./routes/api');
const { setupWebSocket } = require('./services/websocket');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { 
    ip: req.ip, 
    userAgent: req.get('User-Agent') 
  });
  next();
});

// API routes
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      kafka: 'unknown',
      database: 'unknown',
      cache: 'unknown',
      twitter: 'unknown'
    }
  };

  try {
    const producer = getKafkaProducer();
    health.services.kafka = producer ? 'connected' : 'disconnected';
  } catch (e) {
    health.services.kafka = 'error';
  }

  res.json(health);
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Initialize services and start server
async function startServer() {
  try {
    logger.info('Starting sentiment analysis backend...');

    // Initialize Kafka
    await initializeKafka();
    logger.info('Kafka initialized');

    // Initialize database
    await initializeDatabase();
    logger.info('Database initialized');

    // Initialize cache
    await initializeCache();
    logger.info('Cache initialized');

    // Setup WebSocket
    const wss = new WebSocketServer({ server, path: '/ws' });
    setupWebSocket(wss);
    logger.info('WebSocket server initialized');

    // Initialize Twitter stream (if credentials available)
    if (process.env.TWITTER_BEARER_TOKEN) {
      await initializeTwitterStream();
      logger.info('Twitter stream initialized');
    } else {
      logger.warn('Twitter credentials not found, running in simulation mode');
    }

    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

startServer();
