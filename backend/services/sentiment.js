const logger = require("../utils/logger");
const vader = require("vader-sentiment");

const NEGATIVE_HINTS = new Set(["war", "attack", "killed", "death", "crisis", "bomb"]);
const POSITIVE_HINTS = new Set(["growth", "success", "win", "peace", "profit"]);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildCombinedText(title, description) {
  const safeTitle = normalizeText(title);
  const safeDesc = normalizeText(description);
  if (!safeTitle) return safeDesc;
  if (!safeDesc) return safeTitle;

  const t = safeTitle.toLowerCase();
  const d = safeDesc.toLowerCase();
  // Avoid duplicated "title + same title in description" output.
  if (d === t || d.startsWith(`${t} -`) || d.startsWith(`${t}:`) || d.startsWith(t)) {
    return safeTitle;
  }
  return `${safeTitle} ${safeDesc}`.trim();
}

function clampScore(v) {
  return Math.max(-1, Math.min(1, v));
}

function applyKeywordBoost(compound, combinedText) {
  const tokens = combinedText.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let boost = 0;

  for (const t of tokens) {
    if (NEGATIVE_HINTS.has(t)) boost -= 0.12;
    if (POSITIVE_HINTS.has(t)) boost += 0.12;
  }

  // Keep this lightweight and bounded to avoid overfitting.
  boost = Math.max(-0.2, Math.min(0.2, boost));
  return clampScore(compound + boost);
}

function extractReasonKeywords(combinedText, sentimentLabel, limit = 3) {
  const tokens = combinedText.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const targetSet = sentimentLabel === "negative" ? NEGATIVE_HINTS
    : sentimentLabel === "positive" ? POSITIVE_HINTS
    : null;

  if (!targetSet) return [];
  const hits = [];
  for (const t of tokens) {
    if (targetSet.has(t) && !hits.includes(t)) hits.push(t);
    if (hits.length >= limit) break;
  }
  return hits;
}

function labelFromCompound(compound) {
  if (compound >= 0.05) return "positive";
  if (compound <= -0.05) return "negative";
  return "neutral";
}

/**
 * Analyze a headline+description pair with VADER plus lightweight keyword boost.
 * Returns a production-friendly event object for Kafka pipeline usage.
 */
function analyzeHeadline({ title, description, publishedAt }) {
  const safeTitle = normalizeText(title);
  const safeDescription = normalizeText(description);
  const combinedText = buildCombinedText(safeTitle, safeDescription);
  const processedAt = new Date().toISOString();

  if (!combinedText) {
    return {
      title: safeTitle,
      description: safeDescription,
      combined_text: "",
      sentiment_label: "neutral",
      compound_score: 0,
      confidence: 0,
      reason_keywords: [],
      explanation: [],
      published_at: publishedAt || null,
      processed_at: processedAt,
    };
  }

  try {
    const raw = vader.SentimentIntensityAnalyzer.polarity_scores(combinedText);
    const adjusted = applyKeywordBoost(Number(raw.compound) || 0, combinedText);
    const label = labelFromCompound(adjusted);
    const reasonKeywords = extractReasonKeywords(combinedText, label, 3);

    return {
      title: safeTitle,
      description: safeDescription,
      combined_text: combinedText,
      sentiment_label: label,
      compound_score: Number(adjusted.toFixed(4)),
      confidence: Number(Math.abs(adjusted).toFixed(4)),
      reason_keywords: reasonKeywords,
      explanation: [...reasonKeywords],
      published_at: publishedAt || null,
      processed_at: processedAt,
    };
  } catch (err) {
    logger.warn("Sentiment analyze error, defaulting neutral", { err: err.message });
    return {
      title: safeTitle,
      description: safeDescription,
      combined_text: combinedText,
      sentiment_label: "neutral",
      compound_score: 0,
      confidence: 0,
      reason_keywords: [],
      explanation: [],
      published_at: publishedAt || null,
      processed_at: processedAt,
    };
  }
}

// Backward compatibility for older call-sites.
function classify(text) {
  const r = analyzeHeadline({ title: text, description: "", publishedAt: null });
  return {
    sentiment: r.sentiment_label,
    confidence: r.confidence,
    score: r.compound_score,
  };
}

module.exports = { analyzeHeadline, classify };