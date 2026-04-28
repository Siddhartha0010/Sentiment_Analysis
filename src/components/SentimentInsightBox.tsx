import { memo } from "react";
import { Brain, TrendingUp, Gauge } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { SentimentNarrative } from "@/lib/sentimentInsight";

interface SentimentInsightBoxProps {
  narrative: SentimentNarrative | null;
  /** Optional spike alert from realtime pipeline */
  spikeMessage?: string | null;
  isStreaming: boolean;
}

const BADGE: Record<string, string> = {
  negative: "text-negative border-negative/40 bg-negative/10",
  positive: "text-positive border-positive/40 bg-positive/10",
  neutral: "text-muted-foreground border-border bg-muted/20",
};

const SENTIMENT_EMOJI: Record<string, string> = {
  negative: "🔴",
  positive: "🟢",
  neutral: "⚪",
};

export const SentimentInsightBox = memo(function SentimentInsightBox({
  narrative,
  spikeMessage,
  isStreaming,
}: SentimentInsightBoxProps) {
  if (!isStreaming) return null;

  return (
    <Card className="glass-effect border-border/60 p-4 md:p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-primary/15 p-2 text-primary">
          <Brain className="h-5 w-5 shrink-0" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {narrative ? (
            <p className="text-base font-semibold text-foreground">
              Current Sentiment: {narrative.headlineLabel}{" "}
              <span aria-hidden>{SENTIMENT_EMOJI[narrative.dominant] ?? SENTIMENT_EMOJI.neutral}</span>
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Sentiment reason / insight</h3>
            {narrative ? (
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${BADGE[narrative.dominant] ?? BADGE.neutral}`}
              >
                {narrative.headlineLabel}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                Collecting headlines…
              </span>
            )}
          </div>

          {spikeMessage ? (
            <p className="text-xs text-foreground/90 rounded-md bg-amber-500/10 border border-amber-500/25 px-3 py-2">
              <span className="font-medium text-amber-200/90">Alert: </span>
              {spikeMessage}
            </p>
          ) : null}

          {narrative ? (
            <>
              <p className="text-sm text-foreground/90 leading-relaxed">
                <span className="font-medium text-foreground">Reason: </span>
                {narrative.reason}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Gauge className="h-3.5 w-3.5" />
                  Confidence: <span className="text-foreground/80">{narrative.confidenceLabel}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {narrative.trendLabel}
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Insight text appears once articles are analyzed and keyword frequencies are available.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
});
