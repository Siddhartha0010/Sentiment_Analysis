require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const { WebSocketServer } = require('ws');
const http       = require('http');
const logger     = require('./utils/logger');
const { initializeKafka, getKafkaProducer } = require('./services/kafka');
const { initializeDatabase }  = require('./services/database');
const { initializeCache }     = require('./services/cache');
const { initializeRss }       = require('./services/rss');
const { initializeAggregator } = require('./services/sentimentAggregator');
const apiRoutes  = require('./routes/api');
const { setupWebSocket } = require('./services/websocket');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:      process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json());

// Request logging (skip noisy health/status polls in production)
app.use((req, res, next) => {
  const skip = ['/health', '/api/status'].includes(req.path);
  if (!skip) {
    logger.info(`${req.method} ${req.path}`, {
      ip:        req.ip,
      userAgent: req.get('User-Agent'),
    });
  }
  next();
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api', apiRoutes);

app.get('/health', async (req, res) => {
  let kafkaStatus = 'disconnected';
  try {
    kafkaStatus = getKafkaProducer() ? 'connected' : 'disconnected';
  } catch (_) {
    kafkaStatus = 'error';
  }
  res.json({
    status:    'healthy',
    timestamp: new Date().toISOString(),
    uptime:    process.uptime(),
    services:  { kafka: kafkaStatus },
  });
});

// Global error handler
app.use((err, req, res, _next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error:   'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ── Bootstrap ────────────────────────────────────────────────────────────────
async function startServer() {
  try {
    logger.info('Starting sentiment analysis backend…');

    // 1. Database first — other services may query on startup
    await initializeDatabase();
    logger.info('✔  Database initialized');

    // 2. Cache
    await initializeCache();
    logger.info('✔  Cache initialized');

    // 3. Kafka — producer + consumer setup
    await initializeKafka();
    logger.info('✔  Kafka initialized');

    // 4. WebSocket — must be attached to the http.Server before listen()
    const wss = new WebSocketServer({ server, path: '/ws' });
    setupWebSocket(wss);
    logger.info('✔  WebSocket server initialized');

    // 5. Sentiment aggregator — depends on DB + WS being ready
    initializeAggregator();
    logger.info('✔  Sentiment aggregator initialized');

    // 6. Start HTTP server BEFORE RSS so the port is open and ready
    await new Promise((resolve, reject) => {
      server.listen(PORT, (err) => (err ? reject(err) : resolve()));
    });
    logger.info(`✔  Server listening on port ${PORT}`);

    // 7. RSS last — it immediately begins polling Kafka.
    //    Delaying until after listen() means the server is fully ready to
    //    handle the first batch of articles that flow through.
    initializeRss();
    logger.info('✔  RSS service initialized');

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// ── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully…`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  // Force exit after 10 s if connections hang
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

startServer();