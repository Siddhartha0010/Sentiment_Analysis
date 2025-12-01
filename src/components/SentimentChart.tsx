import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card } from "@/components/ui/card";

interface ChartDataPoint {
  time: string;
  positive: number;
  negative: number;
  neutral: number;
}

interface SentimentChartProps {
  data: ChartDataPoint[];
}

export const SentimentChart = ({ data }: SentimentChartProps) => {
  return (
    <Card className="glass-effect p-6">
      <div className="mb-6">
        <h3 className="text-xl font-display text-foreground mb-2">Temporal Sentiment Trends</h3>
        <p className="text-sm text-muted-foreground">Real-time sentiment distribution over time</p>
      </div>
      
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <defs>
            <linearGradient id="positiveGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--positive))" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="hsl(var(--positive))" stopOpacity={0.1}/>
            </linearGradient>
            <linearGradient id="negativeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--negative))" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="hsl(var(--negative))" stopOpacity={0.1}/>
            </linearGradient>
            <linearGradient id="neutralGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--neutral))" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="hsl(var(--neutral))" stopOpacity={0.1}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          <XAxis 
            dataKey="time" 
            stroke="hsl(var(--muted-foreground))"
            style={{ fontSize: '12px' }}
          />
          <YAxis 
            stroke="hsl(var(--muted-foreground))"
            style={{ fontSize: '12px' }}
          />
          <Tooltip 
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              color: 'hsl(var(--foreground))'
            }}
          />
          <Legend 
            wrapperStyle={{
              paddingTop: '20px'
            }}
          />
          <Line 
            type="monotone" 
            dataKey="positive" 
            stroke="hsl(var(--positive))" 
            strokeWidth={3}
            dot={{ fill: 'hsl(var(--positive))', r: 4 }}
            activeDot={{ r: 6 }}
            name="Positive"
          />
          <Line 
            type="monotone" 
            dataKey="negative" 
            stroke="hsl(var(--negative))" 
            strokeWidth={3}
            dot={{ fill: 'hsl(var(--negative))', r: 4 }}
            activeDot={{ r: 6 }}
            name="Negative"
          />
          <Line 
            type="monotone" 
            dataKey="neutral" 
            stroke="hsl(var(--neutral))" 
            strokeWidth={3}
            dot={{ fill: 'hsl(var(--neutral))', r: 4 }}
            activeDot={{ r: 6 }}
            name="Neutral"
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
};
