export type DominantSentiment = "positive" | "negative" | "neutral";

/** Minimal chart row — matches dashboard chartData shape */
export interface ChartPoint {
  bucketId: string;
  positive: number;
  negative: number;
  neutral: number;
}

export interface StatsShape {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  positivePercent: number;
  negativePercent: number;
  neutralPercent: number;
}

export interface TopicKeyword {
  word: string;
  count: number;
}

export interface SentimentNarrative {
  dominant: DominantSentiment;
  headlineLabel: string;
  reason: string;
  confidenceLabel: string;
  trendLabel: string;
  highlightTerms: string[];
}

/** Generic / high-frequency news words — excluded from “Reason” and highlights */
const WEAK_OR_GENERIC = new Set([
  "times", "time", "news", "report", "reports", "according", "sources", "source", "said", "says", "say",
  "today", "yesterday", "tomorrow", "week", "month", "year", "day", "days", "hours", "hour", "minute",
  "people", "many", "some", "new", "latest", "update", "updates", "story", "media", "press", "read", "see",
  "also", "just", "like", "make", "made", "take", "took", "come", "came", "get", "got", "way", "even",
  "first", "last", "next", "two", "one", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "india", "indian", "state", "states", "city", "cities", "area", "areas", "local", "national", "world",
  "government", "minister", "official", "officials", "chief", "party", "election", "elections",
]);

/** Curated impact terms for narrative (subset may appear in corpus) */
const IMPACT_NEGATIVE = new Set([
  "war", "attack", "attacks", "killed", "kill", "death", "deaths", "crisis", "bomb", "bombing", "strike",
  "strikes", "shortage", "shortages", "queue", "queues", "conflict", "violence", "violent", "fear",
  "protest", "protests", "disaster", "emergency", "threat", "damage", "damaged", "crash", "fires", "fire",
  "loss", "losses", "fall", "falls", "fell", "cut", "cuts", "outage", "outages",   "rumour", "rumours", "rumor", "rumors",
]);

const IMPACT_POSITIVE = new Set([
  "growth", "success", "win", "wins", "won", "peace", "profit", "profits", "gain", "gains", "breakthrough",
  "recovery", "recover", "celebrate", "celebration", "victory", "hope", "boost", "record", "rise",
  "rises", "rose", "surge", "surges", "agreement", "milestone",
]);

function dominantFromStats(s: StatsShape): DominantSentiment {
  const { positive, negative, neutral } = s;
  if (negative >= positive && negative >= neutral) return "negative";
  if (positive >= negative && positive >= neutral) return "positive";
  return "neutral";
}

/**
 * Confidence from mean |VADER compound| across visible articles (same scale as stored tweet confidence).
 * Optional "(clear majority)" when label distribution is decisive.
 */
function confidenceFromCompound(
  avgAbsCompound: number | null,
  stats: StatsShape,
  dominant: DominantSentiment
): string {
  let tier = "Low";
  if (avgAbsCompound != null && Number.isFinite(avgAbsCompound)) {
    const a = Math.abs(avgAbsCompound);
    if (a > 0.5) tier = "High";
    else if (a > 0.2) tier = "Medium";
    else tier = "Low";
  }
  const pct =
    dominant === "positive"
      ? stats.positivePercent
      : dominant === "negative"
        ? stats.negativePercent
        : stats.neutralPercent;
  const clearMajority = stats.total >= 5 && pct >= 60;
  return clearMajority ? `${tier} (clear majority)` : tier;
}

function trendFromChart(chartData: ChartPoint[], dominant: DominantSentiment): string {
  if (chartData.length < 3) return "Building timeline…";
  const sorted = [...chartData].sort((a, b) => a.bucketId.localeCompare(b.bucketId));
  const key = dominant;
  const lastTwo = sorted.slice(-2);
  const prevTwo = sorted.slice(-4, -2);
  if (prevTwo.length < 2) return "Building timeline…";

  const avg = (rows: ChartPoint[]) =>
    rows.reduce((acc, p) => acc + p[key], 0) / rows.length;
  const recent = avg(lastTwo);
  const prior = avg(prevTwo);
  const delta = recent - prior;
  const label =
    dominant === "negative"
      ? "negative"
      : dominant === "positive"
        ? "positive"
        : "neutral tone";

  if (prior === 0 && recent > 0) return `Trend: Rising ${label} ↑`;
  if (delta > 0.35) return `Trend: Increasing ${label} ↑`;
  if (delta < -0.35) return `Trend: Easing ${label} ↓`;
  return "Trend: Relatively stable";
}

/**
 * Keep only impact-relevant tokens for Reason / highlights (ordered by hint priority then count).
 */
function selectImpactKeywords(
  topKeywords: TopicKeyword[],
  dominant: DominantSentiment
): string[] {
  const hintSet =
    dominant === "negative"
      ? IMPACT_NEGATIVE
      : dominant === "positive"
        ? IMPACT_POSITIVE
        : new Set<string>();

  const scored = topKeywords
    .map((k) => ({
      w: String(k.word || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ""),
      c: Number(k.count) || 0,
    }))
    .filter((x) => x.w.length >= 3 && !WEAK_OR_GENERIC.has(x.w));

  const withRealWord = scored.filter((x) => x.w.length > 0);
  const impactHits = withRealWord.filter((x) => hintSet.has(x.w)).sort((a, b) => b.c - a.c);
  const otherStrong = withRealWord
    .filter((x) => !hintSet.has(x.w) && x.w.length >= 4)
    .sort((a, b) => b.c - a.c);

  const ordered =
    dominant === "neutral"
      ? withRealWord.filter((x) => x.w.length >= 5).sort((a, b) => b.c - a.c)
      : [...impactHits, ...otherStrong];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const { w } of ordered) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 12) break;
  }
  return out;
}

function buildReason(
  dominant: DominantSentiment,
  impactWords: string[],
  s: StatsShape
): string {
  const k = impactWords.slice(0, 5);
  const list =
    k.length > 0 ? `"${k.join('", "')}"` : "";

  if (dominant === "negative") {
    if (!list) {
      return "Negative labels dominate recent items; more distinctive conflict- or stress-related terms will appear here as the keyword window fills.";
    }
    return `Negative sentiment is driven by conflict- and stress-related terms such as ${list}, indicating tension and public concern.`;
  }
  if (dominant === "positive") {
    if (!list) {
      return "Positive labels lead recent coverage; upbeat or progress-related terms will sharpen this summary as more articles arrive.";
    }
    return `Positive sentiment is reflected in constructive language around ${list}, suggesting favorable developments or outlook in the coverage.`;
  }
  if (!list) {
    return `Coverage is mostly neutral or informational (${s.neutralPercent}% neutral), with limited strongly charged language in recent headlines.`;
  }
  return `Coverage skews neutral or informational (${s.neutralPercent}% neutral). Notable recurring terms include ${list}, with limited strong polarity overall.`;
}

/**
 * Pure narrative for the dashboard insight box — no network, O(n) on chart length.
 * @param avgAbsCompound mean of per-article |compound| (0–1), from tweet confidences in UI
 */
export function buildSentimentNarrative(
  stats: StatsShape,
  topKeywords: TopicKeyword[],
  chartData: ChartPoint[],
  avgAbsCompound: number | null = null
): SentimentNarrative | null {
  if (stats.total <= 0) return null;

  const dominant = dominantFromStats(stats);
  const pct =
    dominant === "positive"
      ? stats.positivePercent
      : dominant === "negative"
        ? stats.negativePercent
        : stats.neutralPercent;

  const headlineLabel = `${dominant.toUpperCase()} (${pct}%)`;
  const highlightTerms = selectImpactKeywords(topKeywords, dominant);
  const reason = buildReason(dominant, highlightTerms, stats);
  const confidenceLabel = confidenceFromCompound(avgAbsCompound, stats, dominant);
  const trendLabel = trendFromChart(chartData, dominant);

  return {
    dominant,
    headlineLabel,
    reason,
    confidenceLabel,
    trendLabel,
    highlightTerms,
  };
}
