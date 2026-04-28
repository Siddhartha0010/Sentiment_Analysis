import { memo } from "react";
import { TrendingUp, MessageSquare, Heart, Frown, Minus } from "lucide-react";
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

interface StatsCardsProps {
  stats: Stats;
}

/**
 * StatsCards — wrapped in React.memo.
 * The parent (useSentimentData) updates on every WebSocket push, but stats
 * values change much less frequently.  Without memo, all 4 cards re-render
 * on every incoming tweet even when the percentages haven't moved.
 */
const StatsCardsInner = ({ stats }: StatsCardsProps) => {
  const cards = [
    {
      title:      "Total analyzed",
      subtitle:   "RSS articles in this topic",
      value:      stats.total.toLocaleString(),
      icon:       MessageSquare,
      color:      "text-primary",
      bgGradient: "from-primary/20 to-primary/5",
    },
    {
      title:      "Positive",
      subtitle:   "Share of total",
      value:      `${stats.positivePercent}%`,
      count:      stats.positive,
      icon:       Heart,
      color:      "text-positive",
      bgGradient: "from-positive/20 to-positive/5",
    },
    {
      title:      "Negative",
      subtitle:   "Share of total",
      value:      `${stats.negativePercent}%`,
      count:      stats.negative,
      icon:       Frown,
      color:      "text-negative",
      bgGradient: "from-negative/20 to-negative/5",
    },
    {
      title:      "Neutral",
      subtitle:   "Share of total",
      value:      `${stats.neutralPercent}%`,
      count:      stats.neutral,
      icon:       Minus,
      color:      "text-neutral",
      bgGradient: "from-neutral/20 to-neutral/5",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, index) => (
        <Card
          key={card.title}
          className="glass-effect p-6 hover:scale-105 transition-transform duration-300"
          style={{ animationDelay: `${index * 100}ms` }}
        >
          <div className="flex items-start justify-between mb-4">
            <div className={`p-3 rounded-lg bg-gradient-to-br ${card.bgGradient}`}>
              <card.icon className={`h-6 w-6 ${card.color}`} />
            </div>
            <TrendingUp className="h-4 w-4 text-accent" />
          </div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">
            {card.title}
          </h3>
          {'subtitle' in card && card.subtitle && (
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1">
              {card.subtitle}
            </p>
          )}
          <p className="text-3xl font-bold text-foreground">{card.value}</p>
          {card.count !== undefined && (
            <p className="text-xs text-muted-foreground mt-1">
              {card.count.toLocaleString()} items
            </p>
          )}
        </Card>
      ))}
    </div>
  );
};

export const StatsCards = memo(StatsCardsInner);