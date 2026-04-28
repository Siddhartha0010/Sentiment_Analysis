"use strict";

const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","than","so","to","of","in","on","at","for","from","by","with",
  "is","are","was","were","be","been","being","as","it","its","that","this","these","those","he","she","they",
  "we","you","i","his","her","their","our","your","about","into","over","under","after","before","during",
  "up","down","out","off","not","no","nor","can","could","should","would","will","just","also","new","latest",
]);

const TEN_MIN_MS = 10 * 60 * 1000;
const TWENTY_MIN_MS = 20 * 60 * 1000;
const KEYWORD_WINDOW_MS = 24 * 60 * 60 * 1000;
const ALERT_COOLDOWN_MS = 2 * 60 * 1000;

const topicState = new Map();

function getTopicState(topic) {
  if (!topicState.has(topic)) {
    topicState.set(topic, {
      sentimentEvents: [], // { ts, sentiment }
      keywordEvents: [], // { ts, words[] }
      keywordFreq: new Map(),
      lastAlertAt: { positive: 0, negative: 0, neutral: 0 },
      lastAlertMessage: null,
    });
  }
  return topicState.get(topic);
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function pruneOld(state, nowTs) {
  while (state.sentimentEvents.length && nowTs - state.sentimentEvents[0].ts > TWENTY_MIN_MS) {
    state.sentimentEvents.shift();
  }

  while (state.keywordEvents.length && nowTs - state.keywordEvents[0].ts > KEYWORD_WINDOW_MS) {
    const ev = state.keywordEvents.shift();
    for (const w of ev.words) {
      const cur = state.keywordFreq.get(w) || 0;
      if (cur <= 1) state.keywordFreq.delete(w);
      else state.keywordFreq.set(w, cur - 1);
    }
  }
}

function computeSpikeAlert(state, topic, nowTs) {
  const prevStart = nowTs - TWENTY_MIN_MS;
  const split = nowTs - TEN_MIN_MS;

  const counts = {
    previous: { positive: 0, negative: 0, neutral: 0 },
    recent: { positive: 0, negative: 0, neutral: 0 },
  };

  for (const ev of state.sentimentEvents) {
    if (ev.ts < prevStart) continue;
    if (ev.ts < split) counts.previous[ev.sentiment] = (counts.previous[ev.sentiment] || 0) + 1;
    else counts.recent[ev.sentiment] = (counts.recent[ev.sentiment] || 0) + 1;
  }

  const labels = ["positive", "negative", "neutral"];
  for (const label of labels) {
    const prev = counts.previous[label] || 0;
    const recent = counts.recent[label] || 0;

    // Need at least a small base to avoid noise.
    if (prev < 3) continue;

    const change = ((recent - prev) / prev) * 100;
    if (Math.abs(change) > 30) {
      if (nowTs - (state.lastAlertAt[label] || 0) < ALERT_COOLDOWN_MS) continue;

      state.lastAlertAt[label] = nowTs;
      const direction = change > 0 ? "increased" : "dropped";
      const msg = `${label} sentiment ${direction} by ${Math.round(Math.abs(change))}% in last 10 minutes for "${topic}"`;
      state.lastAlertMessage = msg;
      return {
        topic,
        type: "sentiment_spike",
        severity: Math.abs(change) >= 60 ? "high" : "medium",
        message: msg,
        insight_message: msg,
        change_percent: Number(change.toFixed(2)),
        sentiment: label,
      };
    }
  }
  return null;
}

function ingestSentimentEvent({ topic, sentiment, text, timestamp }) {
  if (!topic) return { alert: null, topKeywords: [] };
  const label = String(sentiment || "neutral").toLowerCase();
  const safeLabel = label === "positive" || label === "negative" ? label : "neutral";
  const nowTs = Number(timestamp) || Date.now();

  const state = getTopicState(topic);
  state.sentimentEvents.push({ ts: nowTs, sentiment: safeLabel });

  const words = tokenize(text);
  state.keywordEvents.push({ ts: nowTs, words });
  for (const w of words) state.keywordFreq.set(w, (state.keywordFreq.get(w) || 0) + 1);

  pruneOld(state, nowTs);
  const alert = computeSpikeAlert(state, topic, nowTs);
  const topKeywords = getTopKeywords(topic, 5);

  return { alert, topKeywords };
}

function getTopKeywords(topic, limit = 5) {
  const state = topicState.get(topic);
  if (!state) return [];
  return [...state.keywordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

function getLatestAlert(topic) {
  const state = topicState.get(topic);
  return state?.lastAlertMessage || null;
}

module.exports = {
  ingestSentimentEvent,
  getTopKeywords,
  getLatestAlert,
};
