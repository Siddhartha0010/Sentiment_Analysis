import { memo, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/card";

export interface SentimentChartPoint {
  bucketId:  string;
  timeLabel: string;
  positive:  number;
  negative:  number;
  neutral:   number;
}

interface SentimentChartProps {
  data: SentimentChartPoint[];
}

// Tooltip style is static — defined outside the component so it's not
// recreated on every render, which would cause Recharts to re-mount.
const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border:          "1px solid hsl(var(--border))",
  borderRadius:    "8px",
  color:           "hsl(var(--foreground))",
} as const;

const LEGEND_STYLE = { paddingTop: 16 } as const;
const CHART_MARGIN = { top: 8, right: 12, left: 4, bottom: 48 } as const;

/**
 * SentimentChart — wrapped in React.memo so it only re-renders when `data`
 * actually changes.  Without memo, every WebSocket push that updates parent
 * state (useSentimentData) triggers a full Recharts re-mount even when chart
 * data is unchanged.
 */
const SentimentChartInner = ({ data }: SentimentChartProps) => {
  const hasData = data.length > 0;

  const maxVal = useMemo(() => {
    if (!hasData) return 1;
    return Math.max(1, ...data.map((d) => d.positive + d.negative + d.neutral));
  }, [data, hasData]);

  const labelFormatter = useMemo(
    () =>
      (_: unknown, payload: { payload?: SentimentChartPoint }[] | undefined) =>
        (payload?.[0]?.payload as SentimentChartPoint)?.timeLabel ?? "",
    []
  );

  return (
    <Card className="glass-effect p-6 h-full flex flex-col">
      <div className="mb-6">
        <h3 className="text-xl font-display text-foreground mb-2">
          Sentiment Trend over Time
        </h3>
        <p className="text-sm text-muted-foreground">
          Count of positive, negative, and neutral items per time bucket
        </p>
      </div>

      <div className="flex-1 w-full min-h-[380px]">
        {!hasData ? (
          <div className="flex h-full min-h-[380px] flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/20 px-6 text-center">
            <p className="text-sm font-medium text-foreground">No chart data yet</p>
            <p className="mt-2 max-w-md text-xs text-muted-foreground leading-relaxed">
              Buckets appear after processed articles are stored. If you just
              started the stream, wait a few seconds. Uncommon search terms may
              return few or no news items.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={380}>
            <LineChart data={data} margin={CHART_MARGIN}>
              <defs>
                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>
              <CartesianGrid
                strokeDasharray="4 4"
                stroke="hsl(var(--border))"
                opacity={0.3}
                vertical={false}
              />
              <XAxis
                dataKey="timeLabel"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                interval="preserveStartEnd"
                angle={-35}
                textAnchor="end"
                height={56}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                domain={[0, maxVal]}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                width={36}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ ...TOOLTIP_STYLE, boxShadow: "0px 8px 30px rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(15, 23, 42, 0.8)", backdropFilter: "blur(10px)" }}
                formatter={(value: number, name: string) => [value, name]}
                labelFormatter={labelFormatter}
                cursor={{ stroke: "rgba(255,255,255,0.1)", strokeWidth: 2 }}
              />
              <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" />
              <Line
                type="monotone"
                dataKey="positive"
                name="Positive"
                stroke="hsl(var(--positive))"
                strokeWidth={3}
                dot={{ r: 2, fill: "hsl(var(--positive))", strokeWidth: 0 }}
                activeDot={{ r: 6, fill: "hsl(var(--positive))", stroke: "rgba(255,255,255,0.8)", strokeWidth: 2 }}
                filter="url(#glow)"
              />
              <Line
                type="monotone"
                dataKey="negative"
                name="Negative"
                stroke="hsl(var(--negative))"
                strokeWidth={3}
                dot={{ r: 2, fill: "hsl(var(--negative))", strokeWidth: 0 }}
                activeDot={{ r: 6, fill: "hsl(var(--negative))", stroke: "rgba(255,255,255,0.8)", strokeWidth: 2 }}
                filter="url(#glow)"
              />
              <Line
                type="monotone"
                dataKey="neutral"
                name="Neutral"
                stroke="hsl(var(--neutral))"
                strokeWidth={3}
                dot={{ r: 2, fill: "hsl(var(--neutral))", strokeWidth: 0 }}
                activeDot={{ r: 6, fill: "hsl(var(--neutral))", stroke: "rgba(255,255,255,0.8)", strokeWidth: 2 }}
                filter="url(#glow)"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
};

export const SentimentChart = memo(SentimentChartInner);