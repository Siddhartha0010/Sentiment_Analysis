import { Activity } from "lucide-react";

export const Header = () => {
  return (
    <header className="border-b border-border/50 backdrop-blur-sm bg-card/30">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-primary glow-effect">
              <Activity className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-xl font-display text-foreground">SentimentStream</h2>
              <p className="text-xs text-muted-foreground">Real-Time Analytics</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse-slow" />
            <span className="text-sm text-muted-foreground">System Active</span>
          </div>
        </div>
      </div>
    </header>
  );
};
