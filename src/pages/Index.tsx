import { useState } from "react";
import { Header } from "@/components/Header";
import { TopicInput } from "@/components/TopicInput";
import { StatsCards } from "@/components/StatsCards";
import { SentimentChart } from "@/components/SentimentChart";
import { TweetStream } from "@/components/TweetStream";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { TrendingSidebar } from "@/components/TrendingSidebar";
import { useSentimentData } from "@/hooks/useSentimentData";

const Index = () => {
  const [topic, setTopic] = useState("");
  const { stats, chartData, tweets, isStreaming, isLoading, isConnected, isDemoMode, startStream, stopStream } = useSentimentData();

  const handleStartStream = async (searchTopic: string) => {
    setTopic(searchTopic);
    await startStream(searchTopic);
  };

  const handleStopStream = async () => {
    await stopStream();
  };

  const handleTopicSelect = (selectedTopic: string) => {
    if (!isStreaming) {
      handleStartStream(selectedTopic);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-secondary/5 pointer-events-none" />
      
      <div className="relative">
        <Header />
        
        <div className="flex">
          {/* Trending Sidebar */}
          <aside className="hidden xl:block w-80 min-h-[calc(100vh-4rem)] p-4 border-r border-border/50">
            <TrendingSidebar 
              onTopicSelect={handleTopicSelect}
              isStreaming={isStreaming}
            />
          </aside>

          {/* Main Content */}
          <main className="flex-1 px-4 py-8 space-y-8">
            <div className="text-center space-y-4 mb-12">
              <h1 className="text-5xl md:text-6xl font-display gradient-text animate-float">
                SentimentStream
              </h1>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                Real-time temporal sentiment analysis powered by streaming NLP pipelines
              </p>
            </div>

            <ConnectionStatus isConnected={isConnected} isDemoMode={isDemoMode} />

            <div className="max-w-4xl mx-auto">
              <TopicInput 
                onStartStream={handleStartStream}
                onStopStream={handleStopStream}
                isStreaming={isStreaming}
                isLoading={isLoading}
              />
            </div>

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

            {/* Mobile Trending Section */}
            {!isStreaming && (
              <div className="xl:hidden">
                <h2 className="text-2xl font-display text-foreground mb-4">Trending Topics</h2>
                <TrendingSidebar 
                  onTopicSelect={handleTopicSelect}
                  isStreaming={isStreaming}
                />
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default Index;
