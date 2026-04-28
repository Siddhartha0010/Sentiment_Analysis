import { memo, useMemo, type ReactNode } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Heart, Frown, Minus } from "lucide-react";

interface Tweet {
  id: string;
  text: string;
  sentiment: "positive" | "negative" | "neutral";
  timestamp: string;
  confidence: number;
  publishedAt?: string;
  processedAt?: string;
  reasonKeywords?: string[];
  sentimentReason?: string;
  explanation?: string[];
}

interface TweetStreamProps {
  tweets: Tweet[];
  highlightTerms?: string[];
}

const ITEM_HEIGHT = 152;
const LIST_HEIGHT = 460;

const SENTIMENT_ICON: Record<string, JSX.Element> = {
  positive: <Heart className="h-3 w-3" />,
  negative: <Frown className="h-3 w-3" />,
  neutral: <Minus className="h-3 w-3" />,
};

const SENTIMENT_COLOR: Record<string, string> = {
  positive: "bg-positive/20 text-positive border-positive/30",
  negative: "bg-negative/20 text-negative border-negative/30",
  neutral: "bg-neutral/20  text-neutral  border-neutral/30",
};

function normalizeConfidence(c: number | undefined): number {
  if (c == null || Number.isNaN(c)) return 0;
  if (c > 1) return Math.min(1, c / 100);
  return Math.min(1, Math.max(0, c));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildHighlightMatcher(terms: string[] | undefined): { re: RegExp; lowered: Set<string> } | null {
  const set = new Set<string>();
  for (const t of terms || []) {
    const w = String(t).trim().toLowerCase();
    if (w.length >= 2) set.add(w);
  }
  const list = [...set].slice(0, 14);
  if (!list.length) return null;
  const pattern = list.map(escapeRegExp).join("|");
  try {
    return { re: new RegExp(`\\b(${pattern})\\b`, "gi"), lowered: set };
  } catch {
    return null;
  }
}

function headlineWithHighlights(text: string, matcher: { re: RegExp; lowered: Set<string> } | null): ReactNode {
  if (!text || !matcher) return text;
  const parts = text.split(matcher.re);
  return parts.map((part, i) => {
    if (matcher.lowered.has(part.toLowerCase())) {
      return (
        <mark key={i} className="rounded-sm bg-amber-500/30 text-foreground px-0.5 font-medium">
          {part}
        </mark>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

interface RowData {
  tweets: Tweet[];
  highlightMatcher: ReturnType<typeof buildHighlightMatcher>;
}

const TweetRow = memo(({ index, style, data }: ListChildComponentProps<RowData>) => {
  const tweet = data.tweets[index];
  if (!tweet) return null;
  const conf = normalizeConfidence(tweet.confidence);
  const explanation =
    tweet.explanation && tweet.explanation.length ? tweet.explanation : tweet.reasonKeywords;

  return (
    <div style={{ ...style, paddingBottom: 8 }}>
      <div className="mx-1 h-full p-4 rounded-lg bg-card/50 border border-border/50 hover:border-primary/50 transition-colors">
        <div className="flex items-start justify-between mb-2">
          <Badge variant="outline" className={SENTIMENT_COLOR[tweet.sentiment] ?? SENTIMENT_COLOR.neutral}>
            {SENTIMENT_ICON[tweet.sentiment] ?? SENTIMENT_ICON.neutral}
            <span className="ml-1 capitalize">{tweet.sentiment}</span>
          </Badge>
          <span className="text-xs text-muted-foreground shrink-0 ml-2">{tweet.timestamp}</span>
        </div>

        <p className="text-sm text-foreground leading-relaxed line-clamp-2">
          {headlineWithHighlights(tweet.text, data.highlightMatcher)}
        </p>

        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all duration-300" style={{ width: `${conf * 100}%` }} />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{Math.round(conf * 100)}%</span>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground/80">
          {tweet.publishedAt ? `Published: ${tweet.publishedAt}` : ""}
          {tweet.publishedAt && tweet.processedAt ? "  |  " : ""}
          {tweet.processedAt ? `Processed: ${tweet.processedAt}` : ""}
        </div>
        {tweet.sentiment !== "neutral" && (explanation?.length || tweet.sentimentReason) ? (
          <div className="mt-1 text-[10px] text-muted-foreground/90">
            Reason: {explanation?.length ? explanation.join(", ") : tweet.sentimentReason}
          </div>
        ) : null}
      </div>
    </div>
  );
});
TweetRow.displayName = "TweetRow";

const TweetStreamInner = ({ tweets, highlightTerms = [] }: TweetStreamProps) => {
  const highlightMatcher = useMemo(() => buildHighlightMatcher(highlightTerms), [highlightTerms]);
  const itemData = useMemo<RowData>(() => ({ tweets, highlightMatcher }), [tweets, highlightMatcher]);

  return (
    <Card className="glass-effect p-6 flex flex-col" style={{ height: LIST_HEIGHT + 80 }}>
      <div className="mb-4 flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-xl font-display text-foreground mb-1">Live feed</h3>
          <p className="text-sm text-muted-foreground">Latest headlines with model sentiment</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-xs text-muted-foreground">Live</span>
        </div>
      </div>

      {tweets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/15 px-4 py-12 text-center flex-1">
          <p className="text-sm text-muted-foreground">No items yet</p>
          <p className="mt-1 text-xs text-muted-foreground/80">
            Articles appear here after RSS → Kafka → processing completes.
          </p>
        </div>
      ) : (
        <FixedSizeList height={LIST_HEIGHT} itemCount={tweets.length} itemSize={ITEM_HEIGHT} width="100%" itemData={itemData} overscanCount={4}>
          {TweetRow}
        </FixedSizeList>
      )}
    </Card>
  );
};

export const TweetStream = memo(TweetStreamInner);
