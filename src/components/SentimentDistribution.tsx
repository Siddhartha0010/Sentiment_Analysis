import { memo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card } from "@/components/ui/card";

interface Stats {
  total:           number;
  positive:        number;
  negative:        number;
  neutral:         number;
  positivePercent: number;
  negativePercent: number;
  neutralPercent:  number;
}

interface SentimentDistributionProps {
  stats: Stats;
}

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border:          "1px solid hsl(var(--border))",
  borderRadius:    "8px",
  color:           "hsl(var(--foreground))",
} as const;

const SentimentDistributionInner = ({ stats }: SentimentDistributionProps) => {
  const data = [
    { name: "Positive", value: stats.positive, color: "hsl(var(--positive))" },
    { name: "Neutral", value: stats.neutral, color: "hsl(var(--neutral))" },
    { name: "Negative", value: stats.negative, color: "hsl(var(--negative))" },
  ].filter(d => d.value > 0 || stats.total === 0);

  // Fallback if no data yet to keep chart shape
  const chartData = stats.total === 0 
    ? [{ name: "No Data", value: 1, color: "hsl(var(--muted))" }] 
    : data;

  return (
    <Card className="glass-effect p-6 h-full flex flex-col items-center">
      <div className="w-full mb-6">
        <h3 className="text-xl font-display text-foreground mb-2 text-center md:text-left">
          Sentiment Distribution
        </h3>
        <p className="text-sm text-muted-foreground text-center md:text-left">
          Overall breakdown of current topic
        </p>
      </div>
      <div className="flex-1 w-full flex items-center justify-center min-h-[300px]">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={100}
              paddingAngle={4}
              dataKey="value"
              stroke="none"
              strokeLinejoin="round"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                ...TOOLTIP_STYLE,
                background: "rgba(15, 23, 42, 0.8)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0px 8px 30px rgba(0,0,0,0.5)",
              }}
              formatter={(value: number, name: string) => [
                stats.total === 0 ? 0 : value,
                name === "No Data" ? "Waiting for data..." : name
              ]}
              itemStyle={{ color: "#fff" }}
            />
            <Legend 
              verticalAlign="bottom" 
              height={36} 
              iconType="circle"
              formatter={(value, entry: any) => (
                 <span style={{ color: "hsl(var(--foreground))" }}>{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
};

export const SentimentDistribution = memo(SentimentDistributionInner);
