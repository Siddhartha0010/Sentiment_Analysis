import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Heart, Frown, Minus } from "lucide-react";

interface Tweet {
  id: string;
  text: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  timestamp: string;
  confidence: number;
}

interface TweetStreamProps {
  tweets: Tweet[];
}

const getSentimentIcon = (sentiment: string) => {
  switch (sentiment) {
    case 'positive':
      return <Heart className="h-3 w-3" />;
    case 'negative':
      return <Frown className="h-3 w-3" />;
    default:
      return <Minus className="h-3 w-3" />;
  }
};

const getSentimentColor = (sentiment: string) => {
  switch (sentiment) {
    case 'positive':
      return 'bg-positive/20 text-positive border-positive/30';
    case 'negative':
      return 'bg-negative/20 text-negative border-negative/30';
    default:
      return 'bg-neutral/20 text-neutral border-neutral/30';
  }
};

export const TweetStream = ({ tweets }: TweetStreamProps) => {
  return (
    <Card className="glass-effect p-6 h-[500px] flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-xl font-display text-foreground mb-1">Live Stream</h3>
          <p className="text-sm text-muted-foreground">Real-time tweet analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-xs text-muted-foreground">Live</span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3">
          {tweets.map((tweet) => (
            <div
              key={tweet.id}
              className="p-4 rounded-lg bg-card/50 border border-border/50 hover:border-primary/50 transition-all animate-in fade-in slide-in-from-top-2 duration-300"
            >
              <div className="flex items-start justify-between mb-2">
                <Badge variant="outline" className={getSentimentColor(tweet.sentiment)}>
                  {getSentimentIcon(tweet.sentiment)}
                  <span className="ml-1 capitalize">{tweet.sentiment}</span>
                </Badge>
                <span className="text-xs text-muted-foreground">{tweet.timestamp}</span>
              </div>
              <p className="text-sm text-foreground leading-relaxed">{tweet.text}</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-accent transition-all duration-300"
                    style={{ width: `${tweet.confidence * 100}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{Math.round(tweet.confidence * 100)}%</span>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
};
