import { TrendingUp, MessageSquare, Heart, Frown, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";

interface Stats {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  positivePercent: number;
  negativePercent: number;
  neutralPercent: number;
}

interface StatsCardsProps {
  stats: Stats;
}

export const StatsCards = ({ stats }: StatsCardsProps) => {
  const cards = [
    {
      title: "Total Tweets",
      value: stats.total.toLocaleString(),
      icon: MessageSquare,
      color: "text-primary",
      bgGradient: "from-primary/20 to-primary/5",
    },
    {
      title: "Positive",
      value: `${stats.positivePercent}%`,
      count: stats.positive,
      icon: Heart,
      color: "text-positive",
      bgGradient: "from-positive/20 to-positive/5",
    },
    {
      title: "Negative",
      value: `${stats.negativePercent}%`,
      count: stats.negative,
      icon: Frown,
      color: "text-negative",
      bgGradient: "from-negative/20 to-negative/5",
    },
    {
      title: "Neutral",
      value: `${stats.neutralPercent}%`,
      count: stats.neutral,
      icon: Minus,
      color: "text-neutral",
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
          <h3 className="text-sm font-medium text-muted-foreground mb-1">{card.title}</h3>
          <p className="text-3xl font-bold text-foreground">{card.value}</p>
          {card.count !== undefined && (
            <p className="text-xs text-muted-foreground mt-1">{card.count.toLocaleString()} tweets</p>
          )}
        </Card>
      ))}
    </div>
  );
};
