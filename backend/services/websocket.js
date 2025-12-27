const logger = require('../utils/logger');

let wss = null;
const clients = new Map(); // Map of clientId -> { ws, topics }

/**
 * Setup WebSocket server
 */
function setupWebSocket(webSocketServer) {
  wss = webSocketServer;

  wss.on('connection', (ws, req) => {
    const clientId = generateClientId();
    const clientIp = req.socket.remoteAddress;
    
    clients.set(clientId, { 
      ws, 
      topics: new Set(),
      connectedAt: Date.now()
    });
    
    logger.info(`WebSocket client connected`, { clientId, ip: clientIp });

    // Send welcome message
    sendToClient(ws, {
      type: 'connected',
      clientId,
      timestamp: Date.now()
    });

    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleClientMessage(clientId, message);
      } catch (error) {
        logger.error('Invalid WebSocket message:', error);
        sendToClient(ws, { type: 'error', message: 'Invalid message format' });
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      clients.delete(clientId);
      logger.info(`WebSocket client disconnected`, { clientId });
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error(`WebSocket error for client ${clientId}:`, error);
      clients.delete(clientId);
    });

    // Ping/pong for connection health
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  logger.info('WebSocket server configured');
}

/**
 * Handle incoming client messages
 */
function handleClientMessage(clientId, message) {
  const client = clients.get(clientId);
  if (!client) return;

  switch (message.type) {
    case 'subscribe':
      if (message.topic) {
        client.topics.add(message.topic);
        logger.debug(`Client ${clientId} subscribed to topic: ${message.topic}`);
        sendToClient(client.ws, {
          type: 'subscribed',
          topic: message.topic
        });
      }
      break;

    case 'unsubscribe':
      if (message.topic) {
        client.topics.delete(message.topic);
        logger.debug(`Client ${clientId} unsubscribed from topic: ${message.topic}`);
        sendToClient(client.ws, {
          type: 'unsubscribed',
          topic: message.topic
        });
      }
      break;

    case 'ping':
      sendToClient(client.ws, { type: 'pong', timestamp: Date.now() });
      break;

    default:
      logger.debug(`Unknown message type from client ${clientId}:`, message.type);
  }
}

/**
 * Send message to specific client
 */
function sendToClient(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Broadcast tweet to all subscribed clients
 */
function broadcastTweet(tweetData) {
  if (!wss) return;

  const message = {
    type: 'tweet',
    data: tweetData,
    timestamp: Date.now()
  };

  let sentCount = 0;
  clients.forEach((client, clientId) => {
    if (client.topics.has(tweetData.topic) || client.topics.size === 0) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(JSON.stringify(message));
        sentCount++;
      }
    }
  });

  logger.debug(`Tweet broadcast to ${sentCount} clients`);
}

/**
 * Broadcast sentiment update to subscribed clients
 */
function broadcastSentiment(sentimentData) {
  if (!wss) return;

  const message = {
    type: 'sentiment',
    data: sentimentData,
    timestamp: Date.now()
  };

  clients.forEach((client) => {
    if (client.topics.has(sentimentData.topic) || client.topics.size === 0) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(JSON.stringify(message));
      }
    }
  });
}

/**
 * Broadcast stats update to all clients
 */
function broadcastStats(statsData) {
  if (!wss) return;

  const message = {
    type: 'stats',
    data: statsData,
    timestamp: Date.now()
  };

  clients.forEach((client) => {
    if (client.ws.readyState === client.ws.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  });
}

/**
 * Broadcast sentiment alert
 */
function broadcastAlert(alertData) {
  if (!wss) return;

  const message = {
    type: 'alert',
    data: alertData,
    timestamp: Date.now()
  };

  clients.forEach((client) => {
    if (client.topics.has(alertData.topic) || client.topics.size === 0) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(JSON.stringify(message));
      }
    }
  });

  logger.info(`Alert broadcast: ${alertData.message}`);
}

/**
 * Get WebSocket connection stats
 */
function getConnectionStats() {
  const topicSubscriptions = {};
  
  clients.forEach((client) => {
    client.topics.forEach((topic) => {
      topicSubscriptions[topic] = (topicSubscriptions[topic] || 0) + 1;
    });
  });

  return {
    totalConnections: clients.size,
    topicSubscriptions
  };
}

/**
 * Generate unique client ID
 */
function generateClientId() {
  return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = {
  setupWebSocket,
  broadcastTweet,
  broadcastSentiment,
  broadcastStats,
  broadcastAlert,
  getConnectionStats
};
