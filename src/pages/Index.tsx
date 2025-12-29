import { useState } from "react";
import { Header } from "@/components/Header";
import { TopicInput } from "@/components/TopicInput";
import { StatsCards } from "@/components/StatsCards";
import { SentimentChart } from "@/components/SentimentChart";
import { TweetStream } from "@/components/TweetStream";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { useSentimentData } from "@/hooks/useSentimentData";

const Index = () => {
  const [topic, setTopic] = useState("");
  const { stats, chartData, tweets, isStreaming, isLoading, isConnected, startStream, stopStream } = useSentimentData();

  const handleStartStream = async (searchTopic: string) => {
    setTopic(searchTopic);
    await startStream(searchTopic);
  };

  const handleStopStream = async () => {
    await stopStream();
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-secondary/5 pointer-events-none" />
      
      <div className="relative">
        <Header />
        
        <main className="container mx-auto px-4 py-8 space-y-8">
          <div className="text-center space-y-4 mb-12">
            <h1 className="text-5xl md:text-6xl font-display gradient-text animate-float">
              SentimentStream
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Real-time temporal sentiment analysis powered by streaming NLP pipelines
            </p>
          </div>

          <ConnectionStatus isConnected={isConnected} />

          <TopicInput 
            onStartStream={handleStartStream}
            onStopStream={handleStopStream}
            isStreaming={isStreaming}
            isLoading={isLoading}
          />

          {isStreaming && (
            <>
              <StatsCards stats={stats} />
              
              <div className="grid lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <SentimentChart data={chartData} />
                </div>
                <div className="lg:col-span-1">
                  <TweetStream tweets={tweets} />
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default Index;
