"use strict";
/**
 * websocket.js  —  Real-Time Push Layer (Rewritten)
 * ====================================================
 * KEY CHANGES vs original
 * ────────────────────────
 * 1. SPEED  → JSON.stringify() called ONCE per broadcast, not once per client.
 *             (was O(clients) serialisations per event → now always O(1))
 *
 * 2. SPEED  → Tweet updates are BATCHED into a short flush window (default 250 ms).
 *             When Spark pushes 20 rows in one micro-batch, clients receive
 *             1 array message instead of 20 individual frames.
 *
 * 3. SPEED  → Stats broadcasts are THROTTLED to once per 2 s using a simple
 *             pending-flag pattern (no extra library needed).
 *
 * 4. SPEED  → Dead sockets are removed from the Map immediately on 'close'
 *             and on heartbeat failure, so broadcast loops stay tight.
 *
 * 5. SPEED  → broadcastTweet / broadcastSentiment share one internal
 *             _enqueue() helper that feeds the batch buffer.
 *
 * 6. CLEAN  → All public-facing function signatures are unchanged so the
 *             rest of your codebase (kafka.js, api.js) needs zero edits.
 */

const logger = require("../utils/logger");

// ── State ─────────────────────────────────────────────────────────────────────
let wss = null;

/**
 * clients  Map<clientId, { ws, topics: Set<string>, connectedAt: number }>
 * Only live, open sockets are kept here — dead ones are deleted immediately.
 */
const clients = new Map();

// ── Batch buffer ──────────────────────────────────────────────────────────────
/**
 * tweetBuffer  Map<topic, tweet[]>
 * Accumulates incoming tweets/sentiments and flushes every BATCH_INTERVAL ms.
 * Clients receive one { type:'batch', data:[...] } frame instead of N frames.
 */
const BATCH_INTERVAL_MS = Math.min(500, parseInt(process.env.WS_BATCH_INTERVAL_MS || "250", 10) || 250);
const tweetBuffer = new Map(); // topic → array of payloads

// ── Stats throttle ────────────────────────────────────────────────────────────
const STATS_THROTTLE_MS = 2000; // at most one stats push per 2 s
let pendingStats = null;        // latest stats object waiting to be sent
let statsTimerActive = false;

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────
function setupWebSocket(webSocketServer) {
  wss = webSocketServer;

  wss.on("connection", (ws, req) => {
    const clientId = generateClientId();
    const clientIp = req.socket.remoteAddress;

    clients.set(clientId, {
      ws,
      topics: new Set(),
      connectedAt: Date.now(),
    });

    logger.info("WebSocket client connected", { clientId, ip: clientIp });

    _send(ws, { type: "connected", clientId, timestamp: Date.now() });

    ws.on("message", (data) => {
      try {
        handleClientMessage(clientId, JSON.parse(data.toString()));
      } catch (err) {
        logger.error("Invalid WebSocket message:", err);
        _send(ws, { type: "error", message: "Invalid message format" });
      }
    });

    // Remove immediately — keeps broadcast loops lean
    ws.on("close", () => {
      clients.delete(clientId);
      logger.info("WebSocket client disconnected", { clientId });
    });

    ws.on("error", (err) => {
      logger.error(`WebSocket error for client ${clientId}:`, err);
      clients.delete(clientId);
    });

    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
  });

  // ── Heartbeat (unchanged logic, tightened cleanup) ────────────────────────
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) { ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  // ── Batch flush timer ─────────────────────────────────────────────────────
  const batchFlush = setInterval(_flushBatch, BATCH_INTERVAL_MS);

  wss.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(batchFlush);
  });

  logger.info("WebSocket server configured");
}

// ─────────────────────────────────────────────────────────────────────────────
// Client message handler (unchanged behaviour)
// ─────────────────────────────────────────────────────────────────────────────
function handleClientMessage(clientId, message) {
  const client = clients.get(clientId);
  if (!client) return;

  const msgType = message.type || message.action;

  switch (msgType) {
    case "subscribe":
      if (message.topic) {
        client.topics.add(message.topic);
        logger.debug(`Client ${clientId} subscribed to: ${message.topic}`);
        _send(client.ws, { type: "subscribed", topic: message.topic });
      }
      break;

    case "unsubscribe":
      if (message.topic) {
        client.topics.delete(message.topic);
        logger.debug(`Client ${clientId} unsubscribed from: ${message.topic}`);
        _send(client.ws, { type: "unsubscribed", topic: message.topic });
      }
      break;

    case "ping":
      _send(client.ws, { type: "pong", timestamp: Date.now() });
      break;

    default:
      logger.debug(`Unknown message type from ${clientId}:`, msgType);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public broadcast API  (signatures unchanged — drop-in replacement)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queue a tweet for the next batch flush.
 * Called by kafka.js / api.js exactly as before.
 */
function broadcastTweet(tweetData) {
  _enqueue(tweetData);
}

/**
 * Queue a sentiment update for the next batch flush.
 */
function broadcastSentiment(sentimentData) {
  _enqueue(sentimentData);
}

/**
 * Throttled stats broadcast — at most once per STATS_THROTTLE_MS.
 * If called rapidly (e.g. every DB write), only the latest value is sent.
 */
function broadcastStats(statsData) {
  if (!wss) return;

  pendingStats = statsData; // always keep the freshest value

  if (!statsTimerActive) {
    statsTimerActive = true;
    setTimeout(() => {
      if (pendingStats) {
        const frame = _serialise({ type: "stats", data: pendingStats, timestamp: Date.now() });
        _broadcastFrame(frame, () => true); // stats go to everyone
        pendingStats = null;
      }
      statsTimerActive = false;
    }, STATS_THROTTLE_MS);
  }
}

/**
 * Alerts are time-critical — bypass the batch buffer and send immediately.
 */
function broadcastAlert(alertData) {
  if (!wss) return;

  const frame = _serialise({ type: "alert", data: alertData, timestamp: Date.now() });
  _broadcastFrame(frame, (client) =>
    client.topics.has(alertData.topic) || client.topics.size === 0
  );

  logger.info(`Alert broadcast: ${alertData.message}`);
}

/**
 * Connection stats (unchanged)
 */
function getConnectionStats() {
  const topicSubscriptions = {};
  clients.forEach((client) => {
    client.topics.forEach((topic) => {
      topicSubscriptions[topic] = (topicSubscriptions[topic] || 0) + 1;
    });
  });
  return { totalConnections: clients.size, topicSubscriptions };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Add a payload to the per-topic batch buffer */
function _enqueue(data) {
  if (!wss || !data?.topic) return;
  if (!tweetBuffer.has(data.topic)) tweetBuffer.set(data.topic, []);
  tweetBuffer.get(data.topic).push(data);
}

/**
 * Flush the batch buffer.
 * For each topic that has queued items, build ONE frame and send it only to
 * clients subscribed to that topic (or clients with no topic filter).
 * JSON.stringify is called once per topic, not once per client.
 */
function _flushBatch() {
  if (!wss || tweetBuffer.size === 0) return;

  tweetBuffer.forEach((items, topic) => {
    if (items.length === 0) return;

    // Single serialisation for this topic's batch
    const frame = _serialise({
      type: "batch",
      topic,
      data: items,          // array — frontend maps over it
      count: items.length,
      timestamp: Date.now(),
    });

    _broadcastFrame(frame, (client) =>
      client.topics.has(topic) || client.topics.size === 0
    );

    logger.debug(`Flushed batch: topic=${topic} count=${items.length}`);
  });

  tweetBuffer.clear();
}

/**
 * Serialise once → returns a Buffer (ws.send accepts Buffer directly,
 * skipping a second string→Buffer conversion inside the ws library).
 */
function _serialise(obj) {
  return Buffer.from(JSON.stringify(obj));
}

/**
 * Walk the clients Map and send the pre-serialised frame to every matching
 * open socket. Dead sockets detected here are removed immediately.
 *
 * @param {Buffer}   frame     — pre-serialised message buffer
 * @param {Function} predicate — (client) => boolean  filter
 */
function _broadcastFrame(frame, predicate) {
  const dead = [];

  clients.forEach((client, clientId) => {
    const { ws } = client;
    if (ws.readyState !== ws.OPEN) {
      dead.push(clientId); // collect dead sockets
      return;
    }
    if (predicate(client)) {
      ws.send(frame); // send the already-serialised Buffer
    }
  });

  // Clean up dead sockets discovered during this broadcast
  dead.forEach((id) => clients.delete(id));
}

/** Low-level send to a single socket (used for handshake messages) */
function _send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

/** Generate a unique client ID */
function generateClientId() {
  return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  setupWebSocket,
  broadcastTweet,
  broadcastSentiment,
  broadcastStats,
  broadcastAlert,
  getConnectionStats,
};