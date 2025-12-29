import { useState } from "react";
import { Search, Play, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TopicInputProps {
  onStartStream: (topic: string) => void;
  onStopStream: () => void;
  isStreaming: boolean;
  isLoading?: boolean;
}

export const TopicInput = ({ onStartStream, onStopStream, isStreaming, isLoading = false }: TopicInputProps) => {
  const [inputValue, setInputValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && !isStreaming) {
      onStartStream(inputValue.trim());
    }
  };

  return (
    <div className="glass-effect rounded-2xl p-8 max-w-3xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5" />
            <Input
              type="text"
              placeholder="Enter topic or keyword (e.g., #AI, climate change, etc.)"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={isStreaming || isLoading}
              className="pl-12 h-14 bg-background/50 border-border/50 focus:border-primary transition-all text-lg"
            />
          </div>
          {!isStreaming ? (
            <Button 
              type="submit" 
              size="lg"
              disabled={!inputValue.trim() || isLoading}
              className="h-14 px-8 bg-gradient-primary hover:opacity-90 transition-all glow-effect"
            >
              <Play className="mr-2 h-5 w-5" />
              {isLoading ? 'Connecting...' : 'Start Stream'}
            </Button>
          ) : (
            <Button 
              type="button"
              onClick={onStopStream}
              size="lg"
              variant="destructive"
              disabled={isLoading}
              className="h-14 px-8"
            >
              <StopCircle className="mr-2 h-5 w-5" />
              {isLoading ? 'Stopping...' : 'Stop'}
            </Button>
          )}
        </div>
        {isStreaming && (
          <div className="flex items-center justify-center gap-2 text-accent">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-sm font-medium">Streaming live data for: {inputValue}</span>
          </div>
        )}
      </form>
    </div>
  );
};
