import { lazy, Suspense, useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { TopicInput } from "@/components/TopicInput";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { SentimentInsightBox } from "@/components/SentimentInsightBox";
import { useSentimentData } from "@/hooks/useSentimentData";

const StatsCards = lazy(() => import("@/components/StatsCards").then(m => ({ default: m.StatsCards })));
const SentimentChart = lazy(() => import("@/components/SentimentChart").then(m => ({ default: m.SentimentChart })));
const SentimentDistribution = lazy(() => import("@/components/SentimentDistribution").then(m => ({ default: m.SentimentDistribution })));
const TweetStream = lazy(() => import("@/components/TweetStream").then(m => ({ default: m.TweetStream })));
const TrendingSidebar = lazy(() => import("@/components/TrendingSidebar").then(m => ({ default: m.TrendingSidebar })));

const Index = () => {
  const [topic, setTopic] = useState("");
  const { stats, chartData, tweets, isStreaming, isLoading, loadingHint, latestInsight, sentimentNarrative, isConnected, startStream, stopStream } = useSentimentData();

  // Prefetch lazy dashboard chunks after first paint so "Start stream" feels instant.
  useEffect(() => {
    void import("@/components/StatsCards");
    void import("@/components/SentimentChart");
    void import("@/components/SentimentDistribution");
    void import("@/components/TweetStream");
  }, []);

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
            <Suspense fallback={<div className="text-sm text-muted-foreground">Loading topics...</div>}>
              <TrendingSidebar 
                onTopicSelect={handleTopicSelect}
                isStreaming={isStreaming}
              />
            </Suspense>
          </aside>

          {/* Main Content */}
          <main className="flex-1 px-4 py-8 space-y-8 max-w-[1600px] mx-auto">
            <div className="text-center space-y-4 mb-12">
              <h1 className="text-5xl md:text-6xl font-display gradient-text animate-float">
                SentimentStream
              </h1>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                Live RSS headlines, per-article sentiment, and time-bucket trends from your pipeline
              </p>
            </div>

            <ConnectionStatus isConnected={isConnected} />

            <div className="max-w-4xl mx-auto">
              <TopicInput 
                currentTopic={topic}
                onStartStream={handleStartStream}
                onStopStream={handleStopStream}
                isStreaming={isStreaming}
                isLoading={isLoading}
                loadingHint={loadingHint}
              />
            </div>
            {isStreaming && (
              <>
                <Suspense fallback={<div className="text-sm text-muted-foreground">Loading dashboard...</div>}>
                  <StatsCards stats={stats} />
                </Suspense>

                <div className="max-w-[1600px] mx-auto w-full px-0">
                  <SentimentInsightBox
                    isStreaming={isStreaming}
                    narrative={sentimentNarrative}
                    spikeMessage={latestInsight}
                  />
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 flex">
                    <div className="flex-1 w-full">
                      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading chart...</div>}>
                        <SentimentChart data={chartData} />
                      </Suspense>
                    </div>
                  </div>
                  <div className="lg:col-span-1 flex">
                    <div className="flex-1 w-full">
                      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading distribution...</div>}>
                        <SentimentDistribution stats={stats} />
                      </Suspense>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6">
                  <div className="w-full">
                    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading feed...</div>}>
                      <TweetStream
                        tweets={tweets}
                        highlightTerms={sentimentNarrative?.highlightTerms ?? []}
                      />
                    </Suspense>
                  </div>
                </div>
              </>
            )}

            {/* Mobile Trending Section */}
            {!isStreaming && (
              <div className="xl:hidden">
                <h2 className="text-2xl font-display text-foreground mb-4">Trending Topics</h2>
                <Suspense fallback={<div className="text-sm text-muted-foreground">Loading topics...</div>}>
                  <TrendingSidebar 
                    onTopicSelect={handleTopicSelect}
                    isStreaming={isStreaming}
                  />
                </Suspense>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default Index;
