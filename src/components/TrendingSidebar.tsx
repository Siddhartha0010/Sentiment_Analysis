import { useState, useEffect } from "react";
import { TrendingUp, Hash, ThumbsUp, ThumbsDown, Minus, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import * as api from "@/lib/api";

interface TrendingTopic {
  topic: string;
  count: number;
  positive?: number;
  negative?: number;
  neutral?: number;
}

interface TrendingSidebarProps {
  onTopicSelect?: (topic: string) => void;
  isStreaming?: boolean;
}

export const TrendingSidebar = ({ onTopicSelect, isStreaming }: TrendingSidebarProps) => {
  const [topics, setTopics] = useState<TrendingTopic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrendingTopics = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getTrendingTopics(10);
      
      // Fetch sentiment breakdown for each topic
      const topicsWithSentiment = await Promise.all(
        data.map(async (topic) => {
          try {
            const stats = await api.getSentimentStats(topic.topic);
            return {
              ...topic,
              positive: stats.positive_count || 0,
              negative: stats.negative_count || 0,
              neutral: stats.neutral_count || 0,
            };
          } catch {
            return topic;
          }
        })
      );
      
      setTopics(topicsWithSentiment);
    } catch (err: any) {
      setError(err.message || "Failed to load trending topics");
      // Set mock data for demo purposes
      setTopics([
        { topic: "AI", count: 1250, positive: 45, negative: 25, neutral: 30 },
        { topic: "climate", count: 890, positive: 30, negative: 45, neutral: 25 },
        { topic: "technology", count: 756, positive: 55, negative: 15, neutral: 30 },
        { topic: "crypto", count: 543, positive: 35, negative: 40, neutral: 25 },
        { topic: "health", count: 432, positive: 50, negative: 20, neutral: 30 },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTrendingTopics();
    const interval = setInterval(fetchTrendingTopics, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const getSentimentPercentages = (topic: TrendingTopic) => {
    const total = (topic.positive || 0) + (topic.negative || 0) + (topic.neutral || 0);
    if (total === 0) return { positive: 33, negative: 33, neutral: 34 };
    return {
      positive: Math.round(((topic.positive || 0) / total) * 100),
      negative: Math.round(((topic.negative || 0) / total) * 100),
      neutral: Math.round(((topic.neutral || 0) / total) * 100),
    };
  };

  return (
    <Card className="glass-effect h-full flex flex-col">
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-gradient-to-br from-accent/20 to-accent/5">
              <TrendingUp className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h3 className="font-display text-lg text-foreground">Trending Topics</h3>
              <p className="text-xs text-muted-foreground">Most discussed today</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchTrendingTopics}
            disabled={isLoading}
            className="h-8 w-8"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-3 rounded-lg bg-muted/30">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-3 w-16 mb-3" />
                <Skeleton className="h-2 w-full" />
              </div>
            ))
          ) : error && topics.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">{error}</p>
              <Button 
                variant="link" 
                onClick={fetchTrendingTopics}
                className="mt-2 text-primary"
              >
                Try again
              </Button>
            </div>
          ) : (
            topics.map((topic, index) => {
              const percentages = getSentimentPercentages(topic);
              return (
                <button
                  key={topic.topic}
                  onClick={() => onTopicSelect?.(topic.topic)}
                  disabled={isStreaming}
                  className="w-full p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        #{index + 1}
                      </span>
                      <Hash className="h-3 w-3 text-primary" />
                      <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                        {topic.topic}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {topic.count.toLocaleString()} tweets
                    </span>
                  </div>

                  {/* Sentiment breakdown bar */}
                  <div className="h-2 rounded-full overflow-hidden flex mb-2">
                    <div 
                      className="bg-positive transition-all"
                      style={{ width: `${percentages.positive}%` }}
                    />
                    <div 
                      className="bg-neutral transition-all"
                      style={{ width: `${percentages.neutral}%` }}
                    />
                    <div 
                      className="bg-negative transition-all"
                      style={{ width: `${percentages.negative}%` }}
                    />
                  </div>

                  {/* Sentiment percentages */}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1 text-positive">
                      <ThumbsUp className="h-3 w-3" />
                      <span>{percentages.positive}%</span>
                    </div>
                    <div className="flex items-center gap-1 text-neutral">
                      <Minus className="h-3 w-3" />
                      <span>{percentages.neutral}%</span>
                    </div>
                    <div className="flex items-center gap-1 text-negative">
                      <ThumbsDown className="h-3 w-3" />
                      <span>{percentages.negative}%</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Legend */}
      <div className="p-4 border-t border-border/50">
        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-positive" />
            <span>Positive</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-neutral" />
            <span>Neutral</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-negative" />
            <span>Negative</span>
          </div>
        </div>
      </div>
    </Card>
  );
};
